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
//   (RANKED). Both players need an account logged in with Google (a guest gets denied { why: 'login' }): each phone
//   sends its session in hello and the room checks it
//   (accounts.js sessionPlayer); the same player can't take both sides. Rematch plays the next game of the series;
//   once it is decided (2 wins, or 3 games played) the result goes to the leaderboard (recordSeries) and a rematch
//   starts a new series. Leaving a ranked match (forfeit) loses the whole series.
//
// The online lobby (2026-11-04, docs/LOBBY.md): hello { create, public: true } makes a public room, listed in the lobby
// (LobbyRoom, server/src/lobby.js) while it is open: the room reports its card (listing()) on every change and every
// LOBBY.heartbeatMs, and drops it when the match is over, the host leaves the waiting room or it sits idle. A public
// waiting room lets a new player take side 1 when the one who had it left before the start. Spectating is on unless
// the host turns it off (spectate { on }); off turns watchers away with denied { why: 'no watchers' }.
// Nobody is in the same room twice (2026-11-04): the account that has side 0 is refused side 1 from another phone or
// tab with denied { why: 'here' } (a ranked room says 'self' for the same thing); its own phone comes back by its key.
// A room nobody is in at all closes by itself EMPTY_MS after the last phone went: it leaves the lobby, its storage is
// deleted and its code stops working (nomatch). A match that has started is never closed that way: it plays on
// without the players and ends by itself, and only then does the room close.
// Chat and emotes (server/src/chat.js): chat { text } from a phone signed in with Google, emote { id } from a player.
// Players' lines go to everyone; a watcher's line goes to watchers only while the match runs, and when it ends the
// players get them (chatMerge { lines }) and from then on every line goes to everyone, until a rematch starts.
//
// Messages in:  hello { create | key | (nothing: join) | tour id + tkey | watch, session?, public?, spectate?, map?, skin? }, start { settings },
//               act { seq, fn, a }, ready { v }, next { round }, rematch, forfeit, speed { s }, sync, ping, gg (after the match: GG to the other player),
//               chat { text }, emote { id }, spectate { on } (host), public { on } (host, before the start), report
// Messages out: welcome { side, key, seq }, taken, nomatch, lobby { here }, sync { phase, m (view), remaining, held, ready, nextReady,
//               rematch, summary, ack, here }, ack { seq, ok, h }, status {...}, fight { pre, post, summary },
//               speed { s }, forfeit { side }, full, denied { why? }, pong. welcome, lobby, sync and fight carry ranked
//               (the series: { tags, wins, ties, games, best, done, result, forfeit }) in a ranked match, and players
//               ([side 0, side 1]: { tag, title, skins } of a phone that sent its account session, or null).
//               Lobby and chat: roomset { pub, spectate, chat (this phone may type) }, chat { from, tag, text, at, w? },
//               chatLog { lines } (on hello), chatMerge { lines }, emote { from, id }, reported { ok, why? },
//               denied { why: 'slow down' | 'sign in' | 'no watchers' } (the first two leave the phone in the room),
//               denied { why: 'here' } (you already have the other side of this room).
import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import Ref from '../../src/referee.js';
import { LIMITS, LOBBY, json, readMessage, secret, ipHash } from './limits.js';
import { Chat } from './chat.js';
import { builtin } from './units.js';
import { roundRow, forfeitRow } from './history.js';
import { sessionPlayer, rankedOn, recordSeries, countOnline, recordGG, chatReport, hubEvent } from './accounts.js';
import { VERSION } from './version.js';

const KEEP_MS = 24 * 3600 * 1000; // a match nobody touched for a day is deleted
// A room nobody is in closes by itself this soon after the last phone went (2026-11-04): its code stops working and it
// leaves the lobby. The minute's grace is for a phone that lost its connection and comes back with its key. A match
// that has started is never closed this way: it plays on without the players (Ref.AWAY_MAX_MS) and ends by itself.
const EMPTY_MS = 60_000;          // ROOM_EMPTY_MS (tests only) makes it short
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
    this.chat = new Chat(ctx.storage);
    this.listed = null;         // the last listing sent to the lobby ({ key, at, l }), in memory
    ctx.blockConcurrencyWhile(async () => {
      await this.chat.load();
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
    server.serializeAttachment({ code: request.headers.get('x-code') || '', tour: request.headers.get('x-tour') || '', ip: await ipHash(request.headers.get('CF-Connecting-IP') || '') });
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
    let at = due || Date.now() + KEEP_MS;
    if (this.listing()) at = Math.min(at, Date.now() + this.hbMs()); // a listed room's heartbeat (alarm)
    if (!this.sockets().length) at = Math.min(at, Date.now() + this.emptyMs()); // nobody here: look again, then close
    await this.ctx.storage.setAlarm(at);
  }
  // moves the alarm earlier (never later)
  async alarmAt(t) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > t) await this.ctx.storage.setAlarm(t);
  }

  hbMs() { return +this.env.LOBBY_HEARTBEAT_MS || LOBBY.heartbeatMs; } // LOBBY_HEARTBEAT_MS: tests only
  emptyMs() { return +this.env.ROOM_EMPTY_MS || EMPTY_MS; }            // ROOM_EMPTY_MS: tests only
  // Nobody is in the room: may it close now? A match in play stays (it runs on by itself and both phones may be
  // reconnecting), and a tournament match whose result hasn't reached the tournament yet stays too.
  canClose() {
    if (this.sockets().length) return false;
    const R = this.R, t = this.meta && this.meta.tour;
    if (R && R.m && R.phase !== 'lobby' && !R.m.over) return false;
    if (t && !t.reported && R && R.m && R.m.over) return false;
    return true;
  }
  // closes the room: off the lobby list, everything forgotten, the code free again (a join gets nomatch)
  async close() {
    if (this.meta) { this.meta.pub = false; this.report({ force: true }); } // takes the card down (listing() is null now)
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.R = null; this.meta = null; this.chat.lines = []; this.listed = null;
    this.sent.clear(); this.rate.clear();
  }
  // ----- the online lobby (docs/LOBBY.md) -----
  isPub() { return !!(this.meta && this.meta.pub && !this.meta.tour); }
  watchers(gone) { return this.sockets(gone).filter((s) => this.att(s).role === 'w'); }
  // this room's card in the lobby, or null when it shouldn't be listed
  listing(gone) {
    if (!this.isPub()) return null;
    const R = this.R, M = this.meta, now = Date.now(), here = this.here(gone);
    const playing = !!(R && R.m && R.phase !== 'lobby');
    if (playing && R.m.over) return null;
    if (!playing && (!here[0] || now - (M.waitAt || 0) > (+this.env.LOBBY_IDLE_MS || LOBBY.waitIdleMs))) return null; // the host left, or nobody came
    const rk = M.ranked, p0 = M.players && M.players[0];
    const mapId = playing && R.m.map ? R.m.map.id : M.map, map = Game.MAPS.find((x) => x.id === mapId);
    return {
      code: M.code || this.code || '', kind: 'match', mode: rk ? 'ranked' : 'standard',
      host: { tag: rk ? rk.tags[0] : p0 ? p0.tag : 'Player', title: rk ? (rk.titles || [''])[0] : p0 ? p0.title : '' },
      map: rk ? 'Standard' : map ? map.name : 'Random', look: (R && R.settings && R.settings.skin) || M.look || '',
      players: playing ? 2 : here.filter(Boolean).length, phase: playing ? 'playing' : 'waiting', round: playing ? R.m.round : 0,
      watchers: this.watchers(gone).length, spectate: M.spectate !== false, at: M.made || now,
    };
  }
  // tells the lobby about a change of the card (force: the heartbeat). Never awaited by the match; errors are logged.
  report(opts = {}) {
    if (!this.env.LOBBY || !this.meta || this.meta.tour) return;
    const l = this.listing(opts.gone), key = l ? JSON.stringify(l) : '', now = Date.now(), last = this.listed;
    if (!l && !this.meta.listed) return; // never listed: nothing to take down
    if (!opts.force && last && last.key === key) return;
    // only the watcher count moved, and it was sent a moment ago: the next change or heartbeat brings it
    if (!opts.force && l && last && last.l && now - last.at < LOBBY.watcherEveryMs && JSON.stringify({ ...last.l, watchers: 0 }) === JSON.stringify({ ...l, watchers: 0 })) return;
    this.listed = { key, at: now, l };
    this.meta.listed = !!l;
    const lobby = this.env.LOBBY.getByName('all');
    const run = (l ? lobby.upsert(l, this.meta.owner || '') : lobby.drop(this.meta.code || this.code || '')).catch((e) => console.warn('lobby report', e && e.message));
    try { this.ctx.waitUntil(run); } catch {}
  }
  roomset(ws) {
    const a = this.att(ws), side = a.role === 'p' ? a.side : -1;
    const chat = side >= 0 ? !!(this.meta && this.meta.chatOk && this.meta.chatOk[side]) : !!a.chat;
    return { t: 'roomset', pub: this.isPub(), spectate: !this.meta || this.meta.spectate !== false, chat };
  }
  // ----- chat and emotes -----
  merged() { const R = this.R; return !R || !R.m || R.phase === 'lobby' || !!R.m.over; }
  tagOf(side) {
    const M = this.meta || {};
    if (M.tour && M.tour.names) return M.tour.names[side] || 'Player';
    if (M.ranked && M.ranked.tags[side]) return M.ranked.tags[side];
    return (M.players && M.players[side] && M.players[side].tag) || 'Player ' + (side + 1);
  }
  visibleLines(ws) { const w = this.att(ws).role === 'w'; return this.chat.lines.filter((l) => w || !l.hid).slice(-50).map(Chat.out); }
  async chatIn(ws, a, d) {
    const side = a.role === 'p' ? a.side : -1, watcher = a.role === 'w';
    const ok = watcher ? !!a.chat : !!(this.meta && this.meta.chatOk && this.meta.chatOk[side]);
    if (!ok) return this.send(ws, { t: 'denied', why: 'sign in' });
    const hidden = watcher && !this.merged();
    const res = await this.chat.add(watcher ? 'w:' + a.ip + ':' + a.chat : 'p' + side, side, watcher ? a.chat : this.tagOf(side), d.text,
      watcher ? { w: true, ...(hidden ? { hid: true, seed: this.R.seed } : {}) } : {});
    if (res.why === 'slow down') return this.send(ws, { t: 'denied', why: 'slow down' });
    if (!res.line) return;
    const text = JSON.stringify(Chat.out(res.line));
    for (const s of this.sockets()) { const r = this.att(s).role; if (r === 'w' || (r === 'p' && !hidden)) this.send(s, text); }
  }
  // the match is over: the players get the watchers' lines from it, and from now on every line goes to everyone
  async mergeChat() {
    const R = this.R;
    if (!R || !this.merged()) return;
    const lines = this.chat.lines.filter((l) => l.hid);
    if (!lines.length) return;
    for (const l of lines) delete l.hid;
    await this.chat.save();
    const text = JSON.stringify({ t: 'chatMerge', lines: lines.map(Chat.out) });
    for (const s of this.sockets()) if (this.att(s).role === 'p') this.send(s, text);
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
      gg: this.meta && this.meta.gg && this.meta.gg.seed === R.seed ? this.meta.gg.sent : null,
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
    // usernames: a tournament's, a ranked series', or (2026-11-04) any side whose phone has an account
    const pl = this.meta && this.meta.players, tags = pl && (pl[0] || pl[1]) ? [pl[0] ? pl[0].tag : null, pl[1] ? pl[1].tag : null] : null;
    return { room, tour: t ? t.code : null, match: t ? t.match : null, matchId: `${room}-${((R && R.seed) >>> 0).toString(36)}`, ranked: !!rk, names: t ? t.names : rk ? rk.tags : tags };
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
        const pre = Ref.withUnits(f.pre, units, matrix);
        row = roundRow(pre, f.summary, f.post, info);
        replay = { pre, summary: f.summary }; // with the units it was played with, so a replay holds after balance changes
      } else row = forfeitRow(Ref.withUnits(Ref.snapshot(R.m), null, null), forfeitSide, info);
      // which accounts played (Match history's own list); tournament players have no account in the match
      const pids = this.meta && !this.meta.tour && this.meta.pids ? this.meta.pids.slice() : null;
      await this.env.HISTORY.getByName('all').add(row, replay, pids);
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
    if (a.role === 'w' && d.t === 'chat') return this.chatIn(ws, a, d); // watchers chat among themselves (see chatIn)
    if (a.role !== 'p') { if (d.t === 'sync') this.send(ws, this.syncMsg(ws)); return; } // watchers only listen
    const side = a.side, R = this.R, now = Date.now();
    const { units, matrix } = this.units();
    switch (d.t) {
      case 'sync': return this.send(ws, this.syncMsg(ws));
      case 'chat': return this.chatIn(ws, a, d);
      case 'emote': {
        const res = this.chat.emote('p' + side, d.id);
        if (res.why === 'slow down') return this.send(ws, { t: 'denied', why: 'slow down' });
        if (!res.ok) return;
        const text = JSON.stringify({ t: 'emote', from: side, id: d.id });
        for (const s of this.sockets()) this.send(s, text);
        return;
      }
      case 'spectate': { // the host lets watchers in or not (a tournament match always has them)
        if (side !== 0 || !this.meta || this.meta.tour) return;
        this.meta.spectate = d.on !== false;
        if (!this.meta.spectate) for (const s of this.watchers()) { this.setAtt(s, { role: 'x' }); this.send(s, { t: 'denied', why: 'no watchers' }); try { s.close(1000, 'no watchers'); } catch {} }
        await this.save();
        for (const s of this.sockets()) this.send(s, this.roomset(s));
        this.report();
        return;
      }
      case 'public': { // the host lists the room in the lobby or takes it off (before the start)
        if (side !== 0 || !this.meta || this.meta.tour || (R && R.m && R.phase !== 'lobby')) return;
        this.meta.pub = d.on === true; this.meta.waitAt = now;
        await this.save();
        for (const s of this.sockets()) this.send(s, this.roomset(s));
        this.report();
        return;
      }
      case 'report': { // reports the opponent's chat: the room's own last lines go to the moderators (accounts.js chatReport)
        if (!this.chat.report('p' + side)) return this.send(ws, { t: 'reported', ok: false, why: 'slow down' });
        const info = this.historyInfo();
        const run = chatReport(this.env, { ip: a.ip, room: info.room, match: info.matchId, by: this.tagOf(side), about: this.tagOf(1 - side),
          lines: this.chat.lines.filter((l) => !l.hid).slice(-20) }).catch(() => ({ ok: false, why: 'error' }));
        const res = await run;
        this.send(ws, { t: 'reported', ok: !!res.ok, ...(res.why ? { why: res.why } : {}) });
        return;
      }
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
        this.report();
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
        if (began) this.report();
        return;
      }
      case 'rematch': {
        if (!R || (this.meta && this.meta.tour)) return;
        const again = Ref.rematch(R, side, units, matrix, now, this.seed());
        const rk = this.meta && this.meta.ranked;
        if (again && rk && rk.done) Object.assign(rk, { wins: [0, 0], ties: 0, games: 0, done: false, result: null, forfeit: null, counted: null }); // a new series
        await this.save();
        if (again) this.push({ force: true }); else this.status();
        if (again) this.report(); // a rematch: listed again (and the watchers' chat apart again)
        return;
      }
      case 'gg': {
        // after a match (2026-11-04): one GG from each player to the other. Shown to everyone in the room; between two
        // accounts it counts towards the other's Good sport title (accounts.js GG), unless someone left the match.
        if (!R || !R.m || !R.m.over) return;
        if (!this.meta) this.meta = { tour: null, keys: ['', ''] };
        if (!this.meta.gg || this.meta.gg.seed !== R.seed) this.meta.gg = { seed: R.seed, sent: [false, false] };
        if (this.meta.gg.sent[side]) return;
        this.meta.gg.sent[side] = true;
        await this.save();
        const text = JSON.stringify({ t: 'gg', from: side, gg: this.meta.gg.sent });
        for (const s of this.sockets()) this.send(s, text);
        const pids = this.meta.pids || [], left = this.meta.left && this.meta.left.seed === R.seed;
        // the other player has left the room already (the menu): their friends hub tells them, if they're signed in (2026-11-07)
        if (pids[1 - side] && !this.players(1 - side).length) { try { this.ctx.waitUntil(hubEvent(this.env, pids[1 - side], { t: 'gg', from: this.tagOf(side) })); } catch {} }
        if (!this.meta.tour && !left && pids[side] && pids[1 - side]) {
          const run = recordGG(this.env, pids[side], pids[1 - side], this.historyInfo().matchId, R.fights).catch((e) => console.warn('gg', e && e.message));
          try { this.ctx.waitUntil(run); } catch {}
        }
        return;
      }
      case 'forfeit': {
        // leaving while the opponent is disconnected isn't a loss: the one who went away first loses (2026-11-03)
        const loser = R && R.away && R.away[1 - side] ? 1 - side : side;
        if (!R || !Ref.forfeit(R, loser)) return;
        if (this.meta) this.meta.left = { seed: R.seed, side }; // who left this match (countOnline)
        this.tally(loser);
        await this.save();
        await this.mergeChat(); // before the forfeit: the winner's phone leaves the room on it
        const text = JSON.stringify({ t: 'forfeit', side: loser, left: side, ranked: this.rankedView() });
        for (const s of this.sockets()) this.send(s, text);
        this.record(null, loser);
        await this.ended();
        return;
      }
    }
  }

  seed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }

  async hello(ws, a, d) {
    const now = Date.now();
    if (d.watch) {
      if (this.meta && !this.meta.tour && this.meta.spectate === false) { this.send(ws, { t: 'denied', why: 'no watchers' }); try { ws.close(1000, 'no watchers'); } catch {} return; }
      let who = null; // a watcher signed in with Google may chat with the other watchers
      if (typeof d.session === 'string' && d.session) { try { who = await sessionPlayer(this.env, d.session); } catch (e) { who = null; } }
      this.setAtt(ws, { role: 'w', side: -1, chat: who && who.google ? who.tag : '' });
      this.send(ws, { t: 'welcome', side: -1, version: VERSION });
      this.sent.delete(ws);
      this.send(ws, this.roomset(ws));
      if (this.chat.lines.length) this.send(ws, { t: 'chatLog', lines: this.visibleLines(ws) });
      this.report();
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
        // a guest can't play ranked (2026-11-04): a Google login on both sides; developers are always let through
        if (!who.google && !who.dev) { this.send(ws, { t: 'denied', why: 'login' }); return; }
        if (!on) { this.send(ws, { t: 'denied', why: 'ranked off' }); return; }
      }
      const keys = (this.meta && this.meta.keys) || ['', ''];
      side = [0, 1].find((sd) => k && keys[sd] === k);
      // a public room (the lobby): at most LOBBY.createPerIp made per IP
      if (side == null && d.create && d.public === true && !keys[0] && this.env.LOBBY) {
        let ok = true;
        try { ok = await this.env.LOBBY.getByName('all').claim(a.ip); } catch (e) { ok = true; } // the lobby being down never stops a match
        if (!ok) { this.send(ws, { t: 'denied', why: 'slow down' }); return; }
      }
      // a public room that hasn't started: side 1 is free again once its player has gone (someone else from the list may take it)
      const reopen = side == null && !d.create && this.isPub() && keys[0] && keys[1] && !(this.R && this.R.m && this.R.phase !== 'lobby') && !this.here()[1];
      if (side == null) {
        if (d.create) { if (keys[0]) { this.send(ws, { t: 'taken' }); return; } side = 0; }
        else if (!keys[0]) { this.send(ws, { t: 'nomatch' }); return; } // nobody made this match here (maybe a phone-to-phone one)
        else if (!keys[1] || reopen) {
          // nobody is in the same room twice: the account that has side 0 can't take side 1 too, from another phone
          // or another tab (a ranked room says 'self' for the same thing). Its own phone comes back by its key above.
          if (who && !this.meta.ranked && this.meta.pids && this.meta.pids[0] === who.id) { this.send(ws, { t: 'denied', why: 'here' }); return; }
          side = 1; if (reopen && this.meta.players) this.meta.players[1] = null;
        }
        else { this.send(ws, { t: 'full' }); return; } // two players already: Watch instead
        if (!this.meta) this.meta = { tour: null, keys: ['', ''], code: a.code || '' };
        if (side === 0 && d.create) { // the lobby's settings for this room
          const M = this.meta;
          M.pub = d.public === true; M.spectate = d.spectate !== false; M.made = now; M.waitAt = now;
          M.map = typeof d.map === 'string' ? d.map.slice(0, 24) : ''; M.look = typeof d.skin === 'string' ? d.skin.slice(0, 24) : '';
          M.owner = who ? 'p:' + who.id : 'g:' + a.ip; // one listed room per player (lobby.js upsert)
        }
        if (side === 0 && wantsRanked) this.meta.ranked = { ids: [who.id, ''], tags: [who.tag, ''], titles: [who.title || '', ''], wins: [0, 0], ties: 0, games: 0, done: false, result: null, forfeit: null, counted: null };
        if (side === 1 && this.meta.ranked) {
          if (who.id === this.meta.ranked.ids[0]) { this.send(ws, { t: 'denied', why: 'self' }); return; }
          this.meta.ranked.ids[1] = who.id; this.meta.ranked.tags[1] = who.tag; if (this.meta.ranked.titles) this.meta.ranked.titles[1] = who.title || '';
        }
        this.meta.keys[side] = secret();
      }
      key = this.meta.keys[side];
      if (!this.meta.players) this.meta.players = [null, null];
      if (who) this.meta.players[side] = { tag: who.tag, title: who.title || '', skins: who.skins || [] }; // skins: looks only (Shapes.SKINS)
      if (!this.meta.pids) this.meta.pids = [null, null];
      if (who) this.meta.pids[side] = who.id; // kept on the server only (countOnline: invite a friend)
      if (!this.meta.chatOk) this.meta.chatOk = [false, false];
      this.meta.chatOk[side] = !!(who && who.google); // text chat: signed in with Google
      if (this.meta.pub && !(this.R && this.R.m && this.R.phase !== 'lobby')) this.meta.waitAt = now;
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
    this.send(ws, this.roomset(ws));
    if (this.chat.lines.length) this.send(ws, { t: 'chatLog', lines: this.visibleLines(ws) });
    this.report();
  }

  async left(ws) {
    this.rate.delete(ws); this.sent.delete(ws);
    const a = this.att(ws);
    if (a.role === 'w') this.report({ gone: ws }); // the watcher count
    if (a.role !== 'p') return;
    if (this.players(a.side, ws).length) return; // still here on another socket
    if (this.R && this.R.m) {
      const began = Ref.setAway(this.R, a.side, true, Date.now());
      await this.save();
      if (began) this.push({ gone: ws, force: true }); else this.status(ws);
    } else this.status(ws);
    if (this.meta && this.meta.pub && !(this.R && this.R.m && this.R.phase !== 'lobby')) this.meta.waitAt = Date.now();
    this.report({ gone: ws });
  }
  // a socket went: whatever it was, if it was the last one the room closes by itself a moment from now (alarm -> canClose)
  async gone(ws) {
    await this.left(ws);
    if (!this.sockets(ws).length) await this.alarmAt(Date.now() + this.emptyMs());
  }
  webSocketClose(ws) { return this.gone(ws); }
  webSocketError(ws) { return this.gone(ws); }

  // the clock ran out (or a player away for too long), or the match has been idle for a day
  async alarm() {
    const R = this.R, now = Date.now();
    // a listed room's heartbeat, before the match's own wake-up: only the listing, the match isn't touched
    const dueAt = R ? Ref.due(R, now) : 0;
    if (dueAt && dueAt > now + 20 && this.isPub()) {
      this.report({ force: true });
      await this.ctx.storage.setAlarm(this.listing() ? Math.min(dueAt, now + this.hbMs()) : dueAt);
      return;
    }
    if (R && Ref.due(R, now)) {
      const f = Ref.tick(R, now);
      await this.save();
      if (f) { this.broadcastFight(f); await this.ended(); } else this.push({ force: true });
      return;
    }
    const active = (await this.ctx.storage.get('active')) || 0;
    // nobody is in the room (and no match is running): close it, so the code stops working and nothing is left behind
    if (this.canClose() && now - active >= Math.min(this.emptyMs(), KEEP_MS)) return this.close();
    if (now - active >= KEEP_MS && !this.sockets().length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.R = null; this.meta = null; this.chat.lines = []; return; }
    if (this.isPub()) this.report({ force: true }); // the heartbeat (or the drop, once it shouldn't be listed any more)
    let at = this.listing() ? now + this.hbMs() : now + KEEP_MS;
    if (!this.sockets().length) at = Math.min(at, now + this.emptyMs()); // a match playing on alone: look again
    await this.ctx.storage.setAlarm(at);
  }

  // a tournament match that is over: the result goes to the tournament, once. A friend's match that is over counts
  // as an online match for each player's account (accounts.js countOnline: invite a friend), once per match.
  async ended() {
    const R = this.R, t = this.meta && this.meta.tour;
    if (R && R.m && R.m.over) { await this.mergeChat(); this.report(); } // the watchers' chat joins the players'; off the list
    if (R && R.m && R.m.over && !t && this.meta && this.meta.pids && this.meta.onlineCounted !== R.seed) {
      this.meta.onlineCounted = R.seed;
      await this.save();
      const run = countOnline(this.env, this.meta.pids.slice(), this.meta.left && this.meta.left.seed === R.seed ? this.meta.left.side : null, R.fights).catch((e) => console.warn('online count', e && e.message));
      try { this.ctx.waitUntil(run); } catch {}
    }
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
