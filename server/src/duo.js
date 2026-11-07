// A 2v2 match (developer test, 2026-11-02; one shared board since 2026-11-03): one Durable Object per code
// (/duo/<CODE>). The rules are src/duo.js (two lanes on one board, each a 1v1 match through the same Referee checks,
// a shared tower and Vault per team, the 2v2 buildings of src/mpb.js); this file is the plumbing: sockets, seats, the lobby, storage and the clock
// (alarms).
//
// Who is who
// - Only a developer account may make a 2v2 room (hello { create, session }): it becomes the host. Anyone with the code
//   or the invite link may join (hello {}); a key gets the same seat back after a reload (hello { key }).
// - Four seats: 0 = A1, 1 = A2 (team A), 2 = B1, 3 = B2 (team B); A1 and B1 are lane 0, A2 and B2 lane 1. A joining
//   phone takes the first empty seat. In the lobby the host can swap any two seats (move a player, or a player to an
//   empty seat) and start; seats still empty when it starts are played by the AI.
//
// Messages in:  hello { v, create, session } | { v, key } | { v } (v: the page's Duo.V; another V is denied { why:
//               'version' }: the page and the server would play on different boards, 2026-11-07), seat { a, b } (host, lobby: swap two seats), kick { seat } (host,
//               lobby), start { settings } (host), act { seq, fn, a }, ready { v }, next { round }, rematch, forfeit,
//               mark { kind, col, row } (a ping; 'ping' is the keep-alive), emote { id } (both to the team only), sync,
//               chat { text, team? } (Google-signed-in phones only; team: the teammate only), emote { id } with id one of
//               bababa, golem, shock (the lobby's emotes: to everyone)
// The online lobby (2026-11-04, docs/LOBBY.md): hello { create, public: true } lists the 2v2 room in the lobby
// (kind 'duo', dev while config 'lobby_duo' is 'dev'); when it is 'all', anyone may make a 2v2 room.
// A room nobody is in closes by itself EMPTY_MS after the last phone went (its code stops working), unless a match is
// running: that one plays on without the players and ends by itself.
// Messages out: welcome { side, key, seq, seat, lane, host, v (Duo.V) }, duolobby { seats, host, seat }, full, denied { why },
//               mark { from, kind, col, row }, emote { from, id }, chat { from, tag, text, at, team? }, chatLog { lines },
//               roomset { pub, spectate: false, chat }, team { team } (only the other lane changed: m.team),
//               sync / status / fight as in a 1v1 room (server/src/room.js) for the seat's own lane (sync's m carries
//               m.team, the other lane as this seat may see it), plus duo ({ seat, lane, names, here, bots, hp, ready,
//               nextReady, clock: { vote, draft } ms left for the team's placement vote and the artifact draft (src/mpb.js) })
//               and, in fight, duo.pres (both lanes before the fight, for the playback).
import { DurableObject } from 'cloudflare:workers';
import Ref from '../../src/referee.js';
import Duo from '../../src/duo.js';
import { LIMITS, LOBBY, CHAT, json, readMessage, secret, ipHash } from './limits.js';
import { Chat } from './chat.js';
import { duoUnits } from './units.js';
import { sessionPlayer, lobbyDuo } from './accounts.js';

const KEEP_MS = 24 * 3600 * 1000;
const EMPTY_MS = 60_000; // a 2v2 room nobody is in closes by itself this soon after the last phone went (room.js EMPTY_MS)

export class DuoRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.rate = new Map();
    this.sent = new Map();
    this.teamSent = new Map(); // socket -> fingerprint of the m.team it last got
    this.chat = new Chat(ctx.storage);
    this.listed = null;
    ctx.blockConcurrencyWhile(async () => {
      await this.chat.load();
      const { units, matrix } = duoUnits();
      this.meta = (await ctx.storage.get('meta')) || null; // { code, seats: [{ key, tag, title } | null x4], host: seat }
      this.D = Duo.load(await ctx.storage.get('D'), units, matrix);
    });
  }

  async fetch(request) {
    if (this.ctx.getWebSockets().length >= LIMITS.maxSockets) return json({ error: 'room full' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code: request.headers.get('x-code') || '', ip: await ipHash(request.headers.get('CF-Connecting-IP') || '') });
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, more) { ws.serializeAttachment({ ...this.att(ws), ...more }); }
  send(ws, obj) { try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {} }
  sockets(gone) { return this.ctx.getWebSockets().filter((s) => s !== gone && s.readyState <= 1); }
  atSeat(seat, gone) { return this.sockets(gone).filter((s) => { const a = this.att(s); return a.role === 'p' && a.seat === seat; }); }
  here(gone) { return [0, 1, 2, 3].map((k) => this.atSeat(k, gone).length > 0); }
  seed() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
  async save() {
    await this.ctx.storage.put({ meta: this.meta, D: this.D ? Duo.save(this.D) : null, active: Date.now() });
    const due = this.D && this.D.lanes[0] ? Duo.due(this.D, Date.now()) : 0;
    let at = due || Date.now() + KEEP_MS;
    if (this.listing()) at = Math.min(at, Date.now() + this.hbMs()); // a listed room's heartbeat
    if (!this.sockets().length) at = Math.min(at, Date.now() + this.emptyMs()); // nobody here: look again, then close
    await this.ctx.storage.setAlarm(at);
  }
  async alarmAt(t) { const cur = await this.ctx.storage.getAlarm(); if (!cur || cur > t) await this.ctx.storage.setAlarm(t); }
  hbMs() { return +this.env.LOBBY_HEARTBEAT_MS || LOBBY.heartbeatMs; } // LOBBY_HEARTBEAT_MS: tests only
  emptyMs() { return +this.env.ROOM_EMPTY_MS || EMPTY_MS; }            // ROOM_EMPTY_MS: tests only
  // nobody is in the room: may it close now? (a match in play stays: it runs on by itself)
  canClose() {
    if (this.sockets().length) return false;
    const D = this.D;
    return !(D && D.lanes[0] && D.phase !== 'lobby' && D.phase !== 'end');
  }
  async close() {
    if (this.meta) { this.meta.pub = false; this.report({ force: true }); } // off the lobby list
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.D = null; this.meta = null; this.chat.lines = []; this.listed = null;
    this.sent.clear(); this.teamSent.clear(); this.rate.clear();
  }
  // ----- the online lobby (docs/LOBBY.md): this room's card, sent to LobbyRoom like a 1v1 room's (room.js report) -----
  listing(gone) {
    const M = this.meta, D = this.D, now = Date.now();
    if (!M || !M.pub) return null;
    const playing = !!(D && D.lanes[0] && D.phase !== 'lobby'), here = this.here(gone);
    if (playing && D.phase === 'end') return null;
    if (!playing && (!here[M.host] || now - (M.waitAt || 0) > (+this.env.LOBBY_IDLE_MS || LOBBY.waitIdleMs))) return null;
    const h = M.seats[M.host];
    return { code: M.code, kind: 'duo', mode: '2v2', host: { tag: h ? h.tag : 'Player', title: h ? h.title || '' : '' }, map: '2v2', look: '',
      players: playing ? 4 : M.seats.filter((p, k) => p && here[k]).length, phase: playing ? 'playing' : 'waiting',
      round: playing ? D.lanes[0].m.round : 0, watchers: 0, spectate: false, at: M.made || now };
  }
  report(opts = {}) {
    if (!this.env.LOBBY || !this.meta) return;
    const l = this.listing(opts.gone), key = l ? JSON.stringify(l) : '';
    if (!l && !this.meta.listed) return;
    if (!opts.force && this.listed === key) return;
    this.listed = key; this.meta.listed = !!l;
    const lobby = this.env.LOBBY.getByName('all');
    const run = (l ? lobby.upsert(l, this.meta.owner || '') : lobby.drop(this.meta.code)).catch((e) => console.warn('lobby report', e && e.message));
    try { this.ctx.waitUntil(run); } catch {}
  }
  roomset(seat) { const p = this.meta && this.meta.seats[seat]; return { t: 'roomset', pub: !!(this.meta && this.meta.pub), spectate: false, chat: !!(p && p.chat) }; }
  async chatIn(ws, seat, d) {
    const p = this.meta.seats[seat];
    if (!p || !p.chat) return this.send(ws, { t: 'denied', why: 'sign in' });
    const team = d.team === true;
    const res = await this.chat.add('s' + seat, seat, p.tag, d.text, team ? { team: true, side: Duo.SEATS[seat].side } : {});
    if (res.why === 'slow down') return this.send(ws, { t: 'denied', why: 'slow down' });
    if (!res.line) return;
    if (team) this.team(seat, Chat.out(res.line));
    else { const text = JSON.stringify(Chat.out(res.line)); for (const s of this.sockets()) if (this.att(s).role === 'p') this.send(s, text); }
  }
  names() { return (this.meta ? this.meta.seats : [null, null, null, null]).map((p, k) => p ? p.tag : this.D && this.D.bots[k] ? 'AI' : ''); }
  lobbyMsg(ws, gone) {
    const a = this.att(ws), here = this.here(gone);
    return { t: 'duolobby', code: this.meta.code, host: a.seat === this.meta.host, seat: a.seat,
      seats: this.meta.seats.map((p, k) => p ? { tag: p.tag, title: p.title || '', here: here[k] } : null) };
  }
  // the seat's own lane as a 1v1 room sends it, plus the 2v2 part
  syncMsg(ws, gone) {
    const a = this.att(ws), D = this.D;
    if (!D || !D.lanes[0] || D.phase === 'lobby') return this.lobbyMsg(ws, gone);
    const seat = a.seat, own = Duo.SEATS[seat], R = D.lanes[own.lane], here = this.here(gone), now = Date.now();
    const pair = (arr) => [arr[Duo.seatOf(own.lane, 0)], arr[Duo.seatOf(own.lane, 1)]];
    const v = Duo.viewFor(D, seat);
    return {
      t: 'sync', phase: D.phase, round: R.m.round, m: v.m, remaining: Duo.remainingFor(D, seat, now), held: Duo.heldFor(D, seat), // (the Shadow Den's Insider information cuts a watched team's clock, src/duo.js)
      ready: pair(D.ready), nextReady: pair(D.nextReady), rematch: pair(D.rematch), summary: D.summary ? D.summary[own.lane] : null, fights: D.fights,
      ack: R.seq[own.side], here: pair(here.map((h, k) => h || D.bots[k])), forfeit: D.forfeit != null ? Duo.SEATS[D.forfeit].side : null,
      names: pair(this.names()), players: null, ranked: null,
      duo: this.duoInfo(seat, here),
    };
  }
  duoInfo(seat, here) {
    const D = this.D;
    // clock: ms left for the team's placement vote and the artifact draft's pick (src/mpb.js; 0: none open)
    return { seat, lane: Duo.SEATS[seat].lane, names: this.names(), here, bots: D.bots, hp: D.hp, ready: D.ready, nextReady: D.nextReady, clock: D.lanes[0] ? Duo.clocks(D, seat, Date.now()) : null };
  }
  push(opts = {}) {
    for (const s of this.sockets(opts.gone)) {
      if (this.att(s).role !== 'p') continue;
      const msg = this.syncMsg(s, opts.gone);
      // the other lane (m.team) goes on its own ('team'), so a teammate's change doesn't resend this phone's own lane
      const team = msg.m ? msg.m.team : undefined, tk = team === undefined ? '' : Ref.fnv(JSON.stringify(team));
      const key = Ref.fnv(JSON.stringify({ ...msg, remaining: 0, ack: 0, held: 0, m: msg.m ? { ...msg.m, team: null } : msg.m, duo: msg.duo ? { ...msg.duo, clock: null } : msg.duo }));
      if (s === opts.skip) { this.mark(s, key, tk); continue; }
      if (opts.force || this.sentKey(s) !== key) { this.mark(s, key, tk); this.send(s, msg); continue; }
      if (tk && this.teamKey(s) !== tk) { this.mark(s, key, tk); this.send(s, { t: 'team', team }); }
    }
  }
  // what each phone last got from push(): in memory and in the socket's attachment, which outlives hibernation (a room
  // woken by an alarm or a message starts with empty Maps). Without it, the alarm of a hidden vote's 15 s (or any act
  // after a wake-up) would send every phone a sync, and the other team would learn when it happened.
  sentKey(s) { return this.sent.has(s) ? this.sent.get(s) : this.att(s).sk; }
  teamKey(s) { return this.teamSent.has(s) ? this.teamSent.get(s) : this.att(s).tk; }
  mark(s, key, tk) {
    this.sent.set(s, key); this.teamSent.set(s, tk);
    const a = this.att(s);
    if (a.sk !== key || a.tk !== tk) this.setAtt(s, { sk: key, tk });
  }
  // the next push() sends this phone a sync whatever it holds
  forget(s) { this.sent.delete(s); if (this.att(s).sk != null) this.setAtt(s, { sk: null }); }
  broadcastFight(f) {
    const D = this.D;
    for (const s of this.sockets()) {
      const a = this.att(s);
      if (a.role !== 'p') continue;
      const L = Duo.SEATS[a.seat].lane;
      this.send(s, { t: 'fight', pre: f.pres[L], post: f.posts[L], summary: f.summaries[L], fights: D.fights, duo: { ...this.duoInfo(a.seat, this.here()), pres: f.pres } });
      this.forget(s);
    }
    this.push();
  }

  async webSocketMessage(ws, message) {
    const d = readMessage(ws, message, this.rate, LIMITS.matchRatePerWindow);
    if (!d) return;
    const a = this.att(ws);
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });
    if (d.t === 'hello') return this.hello(ws, a, d);
    if (a.role !== 'p') return;
    const seat = a.seat, D = this.D, now = Date.now(), host = seat === this.meta.host;
    const { units, matrix } = duoUnits();
    const inLobby = !D || !D.lanes[0] || D.phase === 'lobby';
    switch (d.t) {
      case 'sync': return this.send(ws, this.syncMsg(ws));
      case 'evict': // tests only (DUO_TEST_EVICT): the in-memory state a room woken from hibernation starts with
        if (this.env.DUO_TEST_EVICT === '1') { this.sent.clear(); this.teamSent.clear(); }
        return;
      case 'seat': { // the host swaps two seats (a player and an empty seat, or two players)
        const x = d.a | 0, y = d.b | 0;
        if (!host || !inLobby || x === y || x < 0 || x > 3 || y < 0 || y > 3) return;
        const S = this.meta.seats;
        [S[x], S[y]] = [S[y], S[x]];
        if (this.meta.host === x) this.meta.host = y; else if (this.meta.host === y) this.meta.host = x;
        for (const s of this.sockets()) { const b = this.att(s); if (b.role !== 'p') continue; if (b.seat === x) this.setAtt(s, { seat: y }); else if (b.seat === y) this.setAtt(s, { seat: x }); }
        await this.save();
        for (const s of this.sockets()) if (this.att(s).role === 'p') this.send(s, { t: 'welcome', ...this.welcome(this.att(s).seat) });
        this.push({ force: true });
        return;
      }
      case 'mark': { // a ping (a marker on the board) for the team: ? (a question), ! (look here), go (attack here)
        if (inLobby || !Duo.PINGS.includes(d.kind)) return;
        const col = d.col | 0, row = d.row | 0;
        if (col < 0 || col >= 40 || row < 0 || row >= 40) return;
        this.team(seat, { t: 'mark', from: seat, kind: d.kind, col, row });
        return;
      }
      case 'chat': return this.chatIn(ws, seat, d);
      case 'emote': { // a quick line for the team, or one of the lobby's emotes (to everyone)
        if (CHAT.emotes.includes(d.id)) {
          const res = this.chat.emote('s' + seat, d.id);
          if (res.why === 'slow down') return this.send(ws, { t: 'denied', why: 'slow down' });
          const text = JSON.stringify({ t: 'emote', from: seat, id: d.id });
          for (const s of this.sockets()) if (this.att(s).role === 'p') this.send(s, text);
          return;
        }
        if (inLobby || !Duo.EMOTES.includes(d.id)) return;
        this.team(seat, { t: 'emote', from: seat, id: d.id });
        return;
      }
      case 'kick': {
        const k = d.seat | 0;
        if (!host || !inLobby || k === seat || k < 0 || k > 3 || !this.meta.seats[k]) return;
        this.meta.seats[k] = null;
        for (const s of this.atSeat(k)) { this.setAtt(s, { role: 'x' }); this.send(s, { t: 'denied', why: 'kicked' }); try { s.close(1000, 'kicked'); } catch {} }
        await this.save(); this.push({ force: true });
        return;
      }
      case 'start': {
        if (!host || !inLobby) return;
        // a seat whose player isn't here when it starts goes to the AI (their phone can't come back into it)
        const here = this.here();
        this.meta.seats = this.meta.seats.map((p, k) => p && here[k] ? p : null);
        this.D = Duo.create(d.settings, units);
        Duo.start(this.D, units, matrix, now, this.seed(), this.meta.seats.map((p) => !p), this.seed()); // (the second: D.secret, in no view)
        await this.save(); this.push({ force: true });
        this.report();
        return;
      }
      case 'act': {
        if (inLobby) return;
        const was = this.clocks(now);
        const res = Duo.act(D, seat, d, now);
        this.send(ws, { t: 'ack', seq: Number.isInteger(d.seq) ? d.seq : 0, ok: res.ok, h: res.h || null, why: res.why || null });
        if (!res.ok) { this.forget(ws); this.send(ws, this.syncMsg(ws)); if (res.why !== 'time') await this.save(); return; }
        await this.save();
        this.push({ skip: ws }); // the others' views (the teammate's m.team, a shared tower buy, the vote)
        if (d.fn === 'undoAll') this.send(ws, this.syncMsg(ws)); // 2v2 Undo all: the team's part as the server rebuilt it (the page keeps its own until then)
        this.clockNews(was, now, d.fn === 'undoAll' ? ws : null); // whose clock this changed (a vote or the draft opened or closed): theirs
        return;
      }
      case 'ready': {
        if (inLobby) return;
        const f = Duo.setReady(D, seat, !!d.v, now);
        await this.save();
        if (f) this.broadcastFight(f); else this.status();
        if (f) this.report();
        return;
      }
      case 'next': {
        if (inLobby) return;
        const began = Duo.next(D, seat, d.round | 0, now);
        await this.save();
        if (began) this.push({ force: true }); else this.status();
        if (began) this.report();
        return;
      }
      case 'rematch': {
        if (inLobby) return;
        const again = Duo.rematch(D, seat, units, matrix, now, this.seed(), this.seed());
        await this.save();
        if (again) this.push({ force: true }); else this.status();
        if (again) this.report();
        return;
      }
      case 'forfeit': {
        if (inLobby || !Duo.forfeit(D, seat)) return;
        await this.save();
        for (const s of this.sockets()) { const b = this.att(s); if (b.role === 'p') this.send(s, { t: 'forfeit', side: Duo.SEATS[seat].side, seat, duo: this.duoInfo(b.seat, this.here()) }); }
        this.report();
        return;
      }
    }
  }
  // to every phone on the seat's team (the sender's included, so its own ping shows the way the team sees it)
  team(seat, msg) {
    const sd = Duo.SEATS[seat].side, text = JSON.stringify(msg);
    for (const s of this.sockets()) { const a = this.att(s); if (a.role === 'p' && Duo.SEATS[a.seat].side === sd) this.send(s, text); }
  }
  // each seat's clock as its phone shows it (the deploy clock, held or running, and its team's vote and the draft's)
  clocks(now) { const D = this.D; return [0, 1, 2, 3].map((k) => D && D.lanes[0] ? JSON.stringify([D.phase, Duo.remainingFor(D, k, now), Duo.heldFor(D, k), Duo.clocks(D, k, now)]) : ''); }
  // a 'status' to each phone whose clock changed since `was` (clocks()). The other team's placements are hidden until the
  // fight (src/mpb.js), so their view, and the sync, stays the same; and no vote holds the shared deploy clock (each
  // has its own 15 s, only the team's own phones get it: Duo.clocks), so a team's votes never reach the other team's
  // clock either (docs/MPB-2V2.md). skip: a phone sent a sync just now.
  clockNews(was, now, skip) {
    const cur = this.clocks(now), here = this.here();
    for (const s of this.sockets()) {
      const a = this.att(s);
      if (a.role !== 'p' || s === skip || cur[a.seat] === was[a.seat]) continue;
      this.send(s, this.statusMsg(s, here));
    }
  }
  // the status line of each seat's lane (Ready ticks, the clock)
  status(gone) {
    const D = this.D, now = Date.now();
    if (!D || !D.lanes[0]) return this.push({ gone, force: true });
    const here = this.here(gone);
    for (const s of this.sockets(gone)) if (this.att(s).role === 'p') this.send(s, this.statusMsg(s, here));
  }
  // one player's 'status': Ready, who is here, the clock (theirs: Duo.remainingFor / heldFor, duo.clock)
  statusMsg(s, here) {
    const D = this.D, now = Date.now(), a = this.att(s), own = Duo.SEATS[a.seat], pair = (arr) => [arr[Duo.seatOf(own.lane, 0)], arr[Duo.seatOf(own.lane, 1)]];
    return { t: 'status', ready: pair(D.ready), nextReady: pair(D.nextReady), rematch: pair(D.rematch), here: pair(here.map((h, k) => h || D.bots[k])),
      remaining: Duo.remainingFor(D, a.seat, now), held: Duo.heldFor(D, a.seat), phase: D.phase, duo: this.duoInfo(a.seat, here) };
  }
  welcome(seat) {
    const own = Duo.SEATS[seat], R = this.D && this.D.lanes[own.lane];
    return { side: own.side, seat, lane: own.lane, key: this.meta.seats[seat] ? this.meta.seats[seat].key : '', seq: R ? R.seq[own.side] : 0, host: seat === this.meta.host, code: this.meta.code, duo: true, v: Duo.V };
  }

  async hello(ws, a, d) {
    if (d.v !== Duo.V) { this.send(ws, { t: 'denied', why: 'version' }); return; } // a page of another version: another board (2026-11-07)
    const now = Date.now();
    let who = null;
    if (typeof d.session === 'string' && d.session) { try { who = await sessionPlayer(this.env, d.session); } catch (e) { who = null; } }
    const k = typeof d.key === 'string' ? d.key : '';
    let seat = this.meta ? this.meta.seats.findIndex((p) => p && k && p.key === k) : -1;
    if (seat < 0) {
      if (d.create) {
        if (this.meta && this.meta.seats.some(Boolean)) { this.send(ws, { t: 'taken' }); return; }
        let open = this.env.DUO_ANYONE === '1'; // developers only (DUO_ANYONE: local tests), or everyone once config lobby_duo is 'all'
        if (!(who && who.dev) && !open) { try { open = (await lobbyDuo(this.env)) === 'all'; } catch (e) { open = false; } }
        if (!(who && who.dev) && !open) { this.send(ws, { t: 'denied', why: 'dev' }); return; }
        if (d.public === true && this.env.LOBBY) {
          let ok = true;
          try { ok = await this.env.LOBBY.getByName('all').claim(a.ip); } catch (e) { ok = true; }
          if (!ok) { this.send(ws, { t: 'denied', why: 'slow down' }); return; }
        }
        this.meta = { code: a.code, seats: [null, null, null, null], host: 0, pub: d.public === true, made: now, waitAt: now, owner: who ? 'p:' + who.id : 'g:' + a.ip };
        seat = 0;
      } else {
        if (!this.meta || !this.meta.seats.some(Boolean)) { this.send(ws, { t: 'nomatch' }); return; }
        const started = this.D && this.D.lanes[0] && this.D.phase !== 'lobby';
        seat = started ? -1 : this.meta.seats.findIndex((p) => !p);
        if (seat < 0) { this.send(ws, { t: 'full' }); return; }
      }
      this.meta.seats[seat] = { key: secret(), tag: who ? who.tag : 'Player ' + (seat + 1), title: who ? who.title || '' : '', chat: !!(who && who.google) };
    } else if (who) { this.meta.seats[seat].tag = who.tag; this.meta.seats[seat].title = who.title || ''; this.meta.seats[seat].chat = !!who.google; }
    if (this.meta.pub) this.meta.waitAt = now;
    for (const s of this.atSeat(seat)) if (s !== ws) { this.setAtt(s, { role: 'x' }); try { s.close(1000, 'replaced'); } catch {} }
    this.setAtt(ws, { role: 'p', seat });
    this.forget(ws);
    this.send(ws, { t: 'welcome', ...this.welcome(seat) });
    if (this.D && this.D.lanes[0]) Duo.setAway(this.D, seat, false, now);
    await this.save();
    this.push({ force: true });
    this.send(ws, this.roomset(seat));
    const lines = this.chat.lines.filter((l) => !l.team || l.side === Duo.SEATS[seat].side);
    if (lines.length) this.send(ws, { t: 'chatLog', lines: lines.map(Chat.out) });
    this.report();
  }

  async left(ws) {
    this.rate.delete(ws); this.sent.delete(ws); this.teamSent.delete(ws);
    const a = this.att(ws);
    if (a.role !== 'p') return;
    if (this.atSeat(a.seat, ws).length) return;
    if (this.D && this.D.lanes[0] && this.D.phase !== 'lobby') {
      const began = Duo.setAway(this.D, a.seat, true, Date.now());
      await this.save();
      if (began) this.push({ gone: ws, force: true }); else this.status(ws);
    } else this.push({ gone: ws, force: true });
    if (this.meta && this.meta.pub) this.meta.waitAt = Date.now();
    this.report({ gone: ws });
  }
  // the last phone went: the room closes by itself a moment from now (alarm -> canClose)
  async gone(ws) {
    await this.left(ws);
    if (!this.sockets(ws).length) await this.alarmAt(Date.now() + this.emptyMs());
  }
  webSocketClose(ws) { return this.gone(ws); }
  webSocketError(ws) { return this.gone(ws); }

  async alarm() {
    const D = this.D, now = Date.now();
    const dueAt = D && D.lanes[0] ? Duo.due(D, now) : 0;
    if (dueAt && dueAt > now + 20 && this.meta && this.meta.pub) { // the listing's heartbeat only (room.js alarm)
      this.report({ force: true });
      await this.ctx.storage.setAlarm(this.listing() ? Math.min(dueAt, now + this.hbMs()) : dueAt);
      return;
    }
    if (D && D.lanes[0] && Duo.due(D, now)) {
      const was = this.clocks(now);
      const f = Duo.tick(D, now);
      await this.save();
      // (no forced sync to all: a team's vote running out, or a hidden Grow's 15 s, must not reach the other team as a
      // message; each phone gets what changed for it: a sync if its view did, a status if its clock did)
      if (f) this.broadcastFight(f); else { this.push(); this.clockNews(was, now); }
      if (f) this.report();
      return;
    }
    const active = (await this.ctx.storage.get('active')) || 0;
    // nobody is in the room (and no match is running): close it, so the code stops working
    if (this.canClose() && now - active >= Math.min(this.emptyMs(), KEEP_MS)) return this.close();
    if (now - active >= KEEP_MS && !this.sockets().length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.D = null; this.meta = null; this.chat.lines = []; return; }
    if (this.meta && this.meta.pub) this.report({ force: true });
    let at = this.listing() ? now + this.hbMs() : now + KEEP_MS;
    if (!this.sockets().length) at = Math.min(at, now + this.emptyMs());
    await this.ctx.storage.setAlarm(at);
  }
}
