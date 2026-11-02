// A live match: one Durable Object per match code. Since server step 3 (2026-11-02) the room is the referee: both
// phones connect to it as equal players, send actions (never their gold or army), and get back only what they may
// see. The rules themselves are src/referee.js (shared with the page and the node tests); this file is the plumbing:
// sockets, who is who, storage, the clock (alarms) and the tournament report. Also runs the self test.
//
// Who is who
// - A friend's match: the first phone in is side 0 (it picks the settings and starts), the second side 1. Each gets a
//   secret key on joining and shows it again on a reconnect; a third phone can only watch.
// - A tournament match (/room/<CODE>?t=<TOURNAMENT>): the tournament (TourRoom.matchFor) checks the player's own
//   tournament key and says which side they are. The match starts by itself once both are in, and the result goes
//   straight from here to the tournament (TourRoom.serverResult): no phone reports it.
// - A ranked match (hello { create, ranked, session }): a friend's match played as a best of 3 with fixed settings
//   (RANKED). Both players need an account: each phone sends its session in hello and the room checks it
//   (accounts.js sessionPlayer); the same player can't take both sides. Rematch plays the next game of the series;
//   once it is decided (2 wins, or 3 games played) the result goes to the leaderboard (recordSeries) and a rematch
//   starts a new series. Leaving a ranked match (forfeit) loses the whole series.
//
// Messages in:  hello { create | key | (nothing: join) | tour id + tkey | watch }, start { settings }, act { seq, fn, a }, ready { v },
//               next { round }, rematch, forfeit, speed { s }, sync, ping
// Messages out: welcome { side, key, seq }, taken, nomatch, lobby { here }, sync { phase, m (view), remaining, held, ready, nextReady,
//               rematch, summary, ack, here }, ack { seq, ok, h }, status {...}, fight { pre, post, summary },
//               speed { s }, forfeit { side }, full, denied { why? }, pong. welcome, lobby, sync and fight carry ranked
//               (the series: { tags, wins, ties, games, best, done, result, forfeit }) in a ranked match, and players
//               ([side 0, side 1]: { tag, title } of a phone that sent its account session, or null).
import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import Ref from '../../src/referee.js';
import { LIMITS, json, readMessage, secret } from './limits.js';
import { builtin } from './units.js';
import { roundRow, forfeitRow } from './history.js';
import { sessionPlayer, rankedOn, recordSeries } from './accounts.js';
import { VERSION } from './version.js';

const KEEP_MS = 24 * 3600 * 1000; // a match nobody touched for a day is deleted
const SPEEDS = [1, 1.5, 2];
// Ranked: the Standard map, all units, every leader but Blixten, and both players draw from the same 5 packages
// (leaders) and the same 3 towers, as in the tournaments. Only the look is the creator's pick.
export const RANKED = { map: 'testgrid', packOptions: 5, mirror: true, offChars: ['blixten'], offUnits: [], offTowers: [] };
const BEST_OF = 3;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings are answered without waking the object up (no cost, no CPU)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.rate = new Map();      // socket -> { start, count }; resets if the room hibernates, which is fine
    this.sent = new Map();      // socket -> fingerprint of the last view it got (resend after hibernation: harmless)
    this.lastSelftest = 0;
    ctx.blockConcurrencyWhile(async () => {
      const { units, matrix } = builtin();
      this.meta = (await ctx.storage.get('meta')) || null;
      this.R = Ref.load(await ctx.storage.get('R'), units, matrix);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/selftest') return this.selftest();
    if (this.ctx.getWebSockets().length >= LIMITS.maxSockets) return json({ error: 'room full' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code: request.headers.get('x-code') || '', tour: request.headers.get('x-tour') || '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ----- helpers -----
  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, more) { ws.serializeAttachment({ ...this.att(ws), ...more }); }
  send(ws, obj) { try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {} }
  sockets(gone) { return this.ctx.getWebSockets().filter((s) => s !== gone && s.readyState <= 1); }
  players(side, gone) { return this.sockets(gone).filter((s) => { const a = this.att(s); return a.role === 'p' && a.side === side; }); }
  here(gone) { return [0, 1].map((sd) => this.players(sd, gone).length > 0); }
  units() { return builtin(); }
  async save() {
    // a finished ranked game is counted before anything is stored: the room may sleep (and reload from storage)
    // between games, so a win counted only in memory would be lost (the bug of 2026-11-02: 1-0, then 0-1)
    this.tally();
    await this.ctx.storage.put({ meta: this.meta, R: this.R ? Ref.save(this.R) : null, active: Date.now() });
    const due = this.R ? Ref.due(this.R, Date.now()) : 0;
    await this.ctx.storage.setAlarm(due || Date.now() + KEEP_MS);
  }

  // what one socket should know now
  syncMsg(ws, gone) {
    const a = this.att(ws), R = this.R, now = Date.now();
    const side = a.role === 'p' ? a.side : -1;
    if (!R || !R.m || R.phase === 'lobby') return { t: 'lobby', here: this.here(gone), names: this.meta && this.meta.tour ? this.meta.tour.names : null, ranked: this.rankedView(), players: this.playersView() };
    return {
      t: 'sync', phase: R.phase, round: R.m.round, m: Ref.viewOf(R, side), remaining: R.deadline ? R.deadline - now : 0, held: R.held,
      ready: R.ready, nextReady: R.nextReady, rematch: R.rematch, summary: R.summary, fights: R.fights,
      ack: side >= 0 ? R.seq[side] : 0, here: this.here(gone), forfeit: R.forfeit != null ? R.forfeit : null,
      names: this.meta && this.meta.tour ? this.meta.tour.names : null, ranked: this.rankedView(), players: this.playersView(),
    };
  }
  // each side's account gamertag and title (friends' matches; null = no account)
  playersView() { return (this.meta && this.meta.players) || null; }
  // ----- ranked play -----
  rankedView() {
    const rk = this.meta && this.meta.ranked;
    return rk ? { tags: rk.tags, titles: rk.titles || ['', ''], wins: rk.wins, ties: rk.ties, games: rk.games, best: BEST_OF, done: rk.done, result: rk.result, forfeit: rk.forfeit } : null;
  }
  // a game of the series is over (forfeitSide: that side left, which loses the series); counted once per game
  tally(forfeitSide) {
    const rk = this.meta && this.meta.ranked, R = this.R;
    if (!rk || rk.done || !R || !R.m || !R.m.over || rk.counted === R.seed) return;
    rk.counted = R.seed; rk.games++;
    if (forfeitSide === 0 || forfeitSide === 1) { rk.done = true; rk.result = 1 - forfeitSide; rk.forfeit = forfeitSide; }
    else {
      const w = R.m.winner;
      if (w === 0 || w === 1) rk.wins[w]++; else rk.ties++;
      const need = Math.floor(BEST_OF / 2) + 1;
      if (rk.wins[0] >= need || rk.wins[1] >= need || rk.games >= BEST_OF) { rk.done = true; rk.result = rk.wins[0] > rk.wins[1] ? 0 : rk.wins[1] > rk.wins[0] ? 1 : -1; }
    }
    if (rk.done) {
      const run = recordSeries(this.env, rk.ids, rk.result).catch((e) => console.warn('ranked result not saved', e && e.message));
      try { this.ctx.waitUntil(run); } catch {}
    }
  }
  // Sends every socket its view if it changed since the last one it got. skip: a socket that is in step already
  // (the player whose own action this was: it only needs the ack), noted as up to date.
  push(opts = {}) {
    for (const s of this.sockets(opts.gone)) {
      const msg = this.syncMsg(s, opts.gone);
      const key = Ref.fnv(JSON.stringify({ ...msg, remaining: 0, ack: 0, held: 0 }));
      if (s === opts.skip) { this.sent.set(s, key); continue; }
      if (!opts.force && this.sent.get(s) === key) continue;
      this.sent.set(s, key);
      this.send(s, msg);
    }
  }
  status(gone) {
    const R = this.R, now = Date.now();
    const msg = R ? { t: 'status', ready: R.ready, nextReady: R.nextReady, rematch: R.rematch, here: this.here(gone), remaining: R.deadline ? R.deadline - now : 0, held: R.held, phase: R.phase }
      : { t: 'lobby', here: this.here(gone) };
    const text = JSON.stringify(msg);
    for (const s of this.sockets(gone)) this.send(s, text);
  }
  broadcastFight(f) {
    this.tally();
    const text = JSON.stringify({ t: 'fight', pre: f.pre, post: f.post, summary: f.summary, fights: this.R.fights, ranked: this.rankedView() });
    for (const s of this.sockets()) { this.send(s, text); this.sent.delete(s); }
    this.push(); // the result screen's state (nextReady, rematch) right after
    this.record(f);
  }

  // ----- match history (step 4) -----
  // Saves the round to the History object once the fight has gone out. Never awaited by the match and never throws:
  // if saving fails it is logged and the match goes on.
  historyInfo() {
    const t = this.meta && this.meta.tour, R = this.R;
    const room = t ? t.room : (this.code || (this.meta && this.meta.code) || '');
    const rk = this.meta && this.meta.ranked;
    return { room, tour: t ? t.code : null, match: t ? t.match : null, matchId: `${room}-${((R && R.seed) >>> 0).toString(36)}`, names: t ? t.names : rk ? rk.tags : null };
  }
  record(f, forfeitSide) {
    if (!this.env.HISTORY) return;
    const R = this.R;
    const run = (async () => {
      await null; // after the current message is handled
      const info = this.historyInfo();
      if (!info.room) return;
      let row, replay = null;
      if (f) {
        const { units, matrix } = this.units();
        row = roundRow(Ref.withUnits(f.pre, units, matrix), f.summary, f.post, info);
        replay = { pre: f.pre, summary: f.summary };
      } else row = forfeitRow(Ref.withUnits(Ref.snapshot(R.m), null, null), forfeitSide, info);
      await this.env.HISTORY.getByName('all').add(row, replay);
    })().catch((e) => console.warn('history not saved', e && e.message));
    try { this.ctx.waitUntil(run); } catch {}
  }

  // ----- messages -----
  async webSocketMessage(ws, message) {
    const d = readMessage(ws, message, this.rate, LIMITS.matchRatePerWindow);
    if (!d) return;
    const a = this.att(ws);
    if (!this.code && a.code) this.code = a.code;
    if (this.meta && !this.meta.code && a.code) this.meta.code = a.code; // kept for match history (saved with the next save)
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });
    if (d.t === 'hello') return this.hello(ws, a, d);
    if (a.role !== 'p') { if (d.t === 'sync') this.send(ws, this.syncMsg(ws)); return; } // watchers only listen
    const side = a.side, R = this.R, now = Date.now();
    const { units, matrix } = this.units();
    switch (d.t) {
      case 'sync': return this.send(ws, this.syncMsg(ws));
      case 'speed': {
        if (!SPEEDS.includes(d.s)) return;
        for (const s of this.players(1 - side)) this.send(s, { t: 'speed', s: d.s });
        return;
      }
      case 'start': {
        if (side !== 0 || (this.meta && this.meta.tour) || (R && R.m && R.phase !== 'lobby') || !this.here()[1]) return;
        const rk = this.meta && this.meta.ranked;
        if (rk && !(rk.ids[0] && rk.ids[1])) return;
        this.R = Ref.create(rk ? { ...RANKED, skin: d.settings && typeof d.settings.skin === 'string' ? d.settings.skin : '' } : d.settings, units);
        Ref.start(this.R, units, matrix, now, this.seed());
        await this.save(); this.push({ force: true });
        return;
      }
      case 'act': {
        if (!R || !R.m) return;
        const res = Ref.act(R, side, d, now);
        this.send(ws, { t: 'ack', seq: Number.isInteger(d.seq) ? d.seq : 0, ok: res.ok, h: res.h || null, why: res.why || null });
        if (!res.ok) { this.sent.delete(ws); this.push({ force: false }); this.send(ws, this.syncMsg(ws)); if (res.why !== 'time') await this.save(); return; }
        await this.save();
        this.push({ skip: ws });
        return;
      }
      case 'ready': {
        if (!R || !R.m) return;
        const f = Ref.setReady(R, side, !!d.v, now);
        await this.save();
        if (f) { this.broadcastFight(f); await this.ended(); } else this.status();
        return;
      }
      case 'next': {
        if (!R) return;
        const began = Ref.next(R, side, d.round | 0, now);
        await this.save();
        if (began) this.push({ force: true }); else this.status();
        return;
      }
      case 'rematch': {
        if (!R || (this.meta && this.meta.tour)) return;
        const again = Ref.rematch(R, side, units, matrix, now, this.seed());
        const rk = this.meta && this.meta.ranked;
        if (again && rk && rk.done) Object.assign(rk, { wins: [0, 0], ties: 0, games: 0, done: false, result: null, forfeit: null, counted: null }); // a new series
        await this.save();
        if (again) this.push({ force: true }); else this.status();
        return;
      }
      case 'forfeit': {
        if (!R || !Ref.forfeit(R, side)) return;
        this.tally(side);
        await this.save();
        const text = JSON.stringify({ t: 'forfeit', side, ranked: this.rankedView() });
        for (const s of this.sockets()) this.send(s, text);
        this.record(null, side);
        await this.ended();
        return;
      }
    }
  }

  seed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }

  async hello(ws, a, d) {
    const now = Date.now();
    if (d.watch) {
      this.setAtt(ws, { role: 'w', side: -1 });
      this.send(ws, { t: 'welcome', side: -1, version: VERSION });
      this.sent.delete(ws);
      return this.send(ws, this.syncMsg(ws));
    }
    let side = -1, key = '';
    if (a.tour) {
      // a tournament match: the tournament says who this is
      let info = null;
      try { info = await this.env.TOUR.getByName(a.tour).matchFor(String(d.id || '').slice(0, 24), String(d.tkey || '').slice(0, 64), a.code); } catch (e) { info = null; }
      if (!info) { this.send(ws, { t: 'denied' }); try { ws.close(1000, 'denied'); } catch {} return; }
      if (!this.meta) this.meta = { tour: { code: a.tour, room: a.code, match: info.match, game: info.game, keys: info.keys, ids: info.ids, names: info.names }, keys: ['', ''] };
      if (this.meta.tour.match !== info.match || this.meta.tour.game !== info.game) { this.send(ws, { t: 'denied' }); return; }
      side = info.side;
      if (!this.R) this.R = Ref.create(info.settings, this.units().units);
    } else {
      // a friend's match: create makes side 0 (the code must be free), a join takes side 1, a key gets its side back
      const k = typeof d.key === 'string' ? d.key : '';
      // a ranked match needs an account on both sides: look the player up first (the slots are checked after, so two
      // phones joining at once can't both take side 1 while this waits)
      const wantsRanked = d.create ? d.ranked === true : !!(this.meta && this.meta.ranked);
      let who = null, on = true;
      // any phone with an account: its gamertag and title show on the other phone (players); never needed to play
      if (typeof d.session === 'string' && d.session) { try { who = await sessionPlayer(this.env, d.session); } catch (e) { who = null; } }
      if (wantsRanked && !(k && this.meta && this.meta.keys.includes(k))) {
        try { if (d.create && who && !who.dev) on = await rankedOn(this.env); } catch (e) { on = false; } // developers may play while it is off
        if (!who) { this.send(ws, { t: 'denied', why: 'account' }); return; }
        if (!on) { this.send(ws, { t: 'denied', why: 'ranked off' }); return; }
      }
      const keys = (this.meta && this.meta.keys) || ['', ''];
      side = [0, 1].find((sd) => k && keys[sd] === k);
      if (side == null) {
        if (d.create) { if (keys[0]) { this.send(ws, { t: 'taken' }); return; } side = 0; }
        else if (!keys[0]) { this.send(ws, { t: 'nomatch' }); return; } // nobody made this match here (maybe a phone-to-phone one)
        else if (!keys[1]) side = 1;
        else { this.send(ws, { t: 'full' }); return; } // two players already: Watch instead
        if (!this.meta) this.meta = { tour: null, keys: ['', ''], code: a.code || '' };
        if (side === 0 && wantsRanked) this.meta.ranked = { ids: [who.id, ''], tags: [who.tag, ''], titles: [who.title || '', ''], wins: [0, 0], ties: 0, games: 0, done: false, result: null, forfeit: null, counted: null };
        if (side === 1 && this.meta.ranked) {
          if (who.id === this.meta.ranked.ids[0]) { this.send(ws, { t: 'denied', why: 'self' }); return; }
          this.meta.ranked.ids[1] = who.id; this.meta.ranked.tags[1] = who.tag; if (this.meta.ranked.titles) this.meta.ranked.titles[1] = who.title || '';
        }
        this.meta.keys[side] = secret();
      }
      key = this.meta.keys[side];
      if (!this.meta.players) this.meta.players = [null, null];
      if (who) this.meta.players[side] = { tag: who.tag, title: who.title || '' };
    }
    // one socket per side: an older one of this side (a reload) is let go
    for (const s of this.players(side)) if (s !== ws) { this.setAtt(s, { role: 'x' }); try { s.close(1000, 'replaced'); } catch {} }
    this.setAtt(ws, { role: 'p', side });
    this.sent.delete(ws);
    this.send(ws, { t: 'welcome', side, key, seq: this.R ? this.R.seq[side] : 0, version: VERSION, tour: this.meta.tour ? { names: this.meta.tour.names } : null, ranked: this.rankedView(), players: this.playersView() });
    const R = this.R;
    if (R) Ref.setAway(R, side, false, now);
    // a tournament match starts by itself once both players are in
    if (R && this.meta.tour && R.phase === 'lobby' && !R.m && this.here()[0] && this.here()[1]) {
      const { units, matrix } = this.units();
      Ref.start(R, units, matrix, now, this.seed());
    }
    await this.save();
    this.push({ force: true });
  }

  async left(ws) {
    this.rate.delete(ws); this.sent.delete(ws);
    const a = this.att(ws);
    if (a.role !== 'p') return;
    if (this.players(a.side, ws).length) return; // still here on another socket
    if (this.R && this.R.m) {
      const began = Ref.setAway(this.R, a.side, true, Date.now());
      await this.save();
      if (began) this.push({ gone: ws, force: true }); else this.status(ws);
    } else this.status(ws);
  }
  webSocketClose(ws) { return this.left(ws); }
  webSocketError(ws) { return this.left(ws); }

  // the clock ran out (or a player away for too long), or the match has been idle for a day
  async alarm() {
    const R = this.R, now = Date.now();
    if (R && Ref.due(R, now)) {
      const f = Ref.tick(R, now);
      await this.save();
      if (f) { this.broadcastFight(f); await this.ended(); } else this.push({ force: true });
      return;
    }
    const active = (await this.ctx.storage.get('active')) || 0;
    if (now - active >= KEEP_MS && !this.sockets().length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.R = null; this.meta = null; return; }
    await this.ctx.storage.setAlarm(now + KEEP_MS);
  }

  // a tournament match that is over: the result goes to the tournament, once
  async ended() {
    const R = this.R, t = this.meta && this.meta.tour;
    if (!R || !R.m || !R.m.over || !t || t.reported) return;
    const keys = t.keys; // [side 0's key in the tournament ('a' or 'b'), side 1's]
    const winner = R.m.winner === 0 ? keys[0] : R.m.winner === 1 ? keys[1] : 'draw';
    const sa = keys[0] === 'a' ? 0 : 1;
    const hp = [R.m.hp[sa], R.m.hp[1 - sa]];
    try {
      await this.env.TOUR.getByName(t.code).serverResult(t.room, winner, hp, (R.m.history || []).length);
      t.reported = true;
      await this.save();
    } catch (e) { console.warn('tournament report', e); }
  }

  selftest() {
    const now = Date.now();
    if (now - this.lastSelftest < LIMITS.selftestEveryMs) return json({ error: 'try again in a few seconds' }, 429);
    this.lastSelftest = now;
    const t0 = performance.now();
    const { units, matrix } = builtin();
    const m = Game.createMatch(units, matrix, 7, 'standard');
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
    const sim = Game.startBattle(m);
    while (sim.step()) {}
    const summary = Game.resolve(m, sim.result());
    // In a deployed Worker the clock only moves on I/O, so ms can read 0 there; locally it is real.
    return json({ ok: true, version: VERSION, ms: Math.round(performance.now() - t0), dmg: summary.dmg, hp: m.hp });
  }
}
