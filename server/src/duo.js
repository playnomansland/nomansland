// A 2v2 match (developer test, 2026-11-02; one shared board since 2026-11-03): one Durable Object per code
// (/duo/<CODE>). The rules are src/duo.js (two lanes on one board, each a 1v1 match through the same Referee checks,
// a shared tower and treasury per team); this file is the plumbing: sockets, seats, the lobby, storage and the clock
// (alarms).
//
// Who is who
// - Only a developer account may make a 2v2 room (hello { create, session }): it becomes the host. Anyone with the code
//   or the invite link may join (hello {}); a key gets the same seat back after a reload (hello { key }).
// - Four seats: 0 = A1, 1 = A2 (team A), 2 = B1, 3 = B2 (team B); A1 and B1 are lane 0, A2 and B2 lane 1. A joining
//   phone takes the first empty seat. In the lobby the host can swap any two seats (move a player, or a player to an
//   empty seat) and start; seats still empty when it starts are played by the AI.
//
// Messages in:  hello { create, session } | { key } | {}, seat { a, b } (host, lobby: swap two seats), kick { seat } (host,
//               lobby), start { settings } (host), act { seq, fn, a }, ready { v }, next { round }, rematch, forfeit,
//               mark { kind, col, row } (a ping; 'ping' is the keep-alive), emote { id } (both to the team only), sync,
//               chat { text, team? } (Google-signed-in phones only; team: the teammate only), emote { id } with id one of
//               bababa, golem, shock (the lobby's emotes: to everyone)
// The online lobby (2026-11-04, docs/LOBBY.md): hello { create, public: true } lists the 2v2 room in the lobby
// (kind 'duo', dev while config 'lobby_duo' is 'dev'); when it is 'all', anyone may make a 2v2 room.
// Messages out: welcome { side, key, seq, seat, lane, host }, duolobby { seats, host, seat }, full, denied { why },
//               mark { from, kind, col, row }, emote { from, id }, chat { from, tag, text, at, team? }, chatLog { lines },
//               roomset { pub, spectate: false, chat }, team { team } (only the other lane changed: m.team),
//               sync / status / fight as in a 1v1 room (server/src/room.js) for the seat's own lane (sync's m carries
//               m.team, the other lane as this seat may see it), plus duo ({ seat, lane, names, here, bots, hp, ready,
//               nextReady, vote }) and, in fight, duo.pres (both lanes before the fight, for the playback).
import { DurableObject } from 'cloudflare:workers';
import Ref from '../../src/referee.js';
import Duo from '../../src/duo.js';
import { LIMITS, LOBBY, CHAT, json, readMessage, secret, ipHash } from './limits.js';
import { Chat } from './chat.js';
import { builtin } from './units.js';
import { sessionPlayer, lobbyDuo } from './accounts.js';

const KEEP_MS = 24 * 3600 * 1000;

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
      const { units, matrix } = builtin();
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
    await this.ctx.storage.setAlarm(at);
  }
  hbMs() { return +this.env.LOBBY_HEARTBEAT_MS || LOBBY.heartbeatMs; } // LOBBY_HEARTBEAT_MS: tests only
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
      t: 'sync', phase: D.phase, round: R.m.round, m: v.m, remaining: D.deadline ? D.deadline - now : 0, held: D.held,
      ready: pair(D.ready), nextReady: pair(D.nextReady), rematch: pair(D.rematch), summary: D.summary ? D.summary[own.lane] : null, fights: D.fights,
      ack: R.seq[own.side], here: pair(here.map((h, k) => h || D.bots[k])), forfeit: D.forfeit != null ? Duo.SEATS[D.forfeit].side : null,
      names: pair(this.names()), players: null, ranked: null,
      duo: this.duoInfo(seat, here),
    };
  }
  duoInfo(seat, here) {
    const D = this.D, sd = Duo.SEATS[seat].side;
    return { seat, lane: Duo.SEATS[seat].lane, names: this.names(), here, bots: D.bots, hp: D.hp, ready: D.ready, nextReady: D.nextReady, vote: (D.vote && D.vote[sd]) || null };
  }
  push(opts = {}) {
    for (const s of this.sockets(opts.gone)) {
      if (this.att(s).role !== 'p') continue;
      const msg = this.syncMsg(s, opts.gone);
      // the other lane (m.team) goes on its own ('team'), so a teammate's change doesn't resend this phone's own lane
      const team = msg.m ? msg.m.team : undefined, tk = team === undefined ? '' : Ref.fnv(JSON.stringify(team));
      const key = Ref.fnv(JSON.stringify({ ...msg, remaining: 0, ack: 0, held: 0, m: msg.m ? { ...msg.m, team: null } : msg.m }));
      if (s === opts.skip) { this.sent.set(s, key); this.teamSent.set(s, tk); continue; }
      if (opts.force || this.sent.get(s) !== key) { this.sent.set(s, key); this.teamSent.set(s, tk); this.send(s, msg); continue; }
      if (tk && this.teamSent.get(s) !== tk) { this.teamSent.set(s, tk); this.send(s, { t: 'team', team }); }
    }
  }
  broadcastFight(f) {
    const D = this.D;
    for (const s of this.sockets()) {
      const a = this.att(s);
      if (a.role !== 'p') continue;
      const L = Duo.SEATS[a.seat].lane;
      this.send(s, { t: 'fight', pre: f.pres[L], post: f.posts[L], summary: f.summaries[L], fights: D.fights, duo: { ...this.duoInfo(a.seat, this.here()), pres: f.pres } });
      this.sent.delete(s);
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
    const { units, matrix } = builtin();
    const inLobby = !D || !D.lanes[0] || D.phase === 'lobby';
    switch (d.t) {
      case 'sync': return this.send(ws, this.syncMsg(ws));
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
        Duo.start(this.D, units, matrix, now, this.seed(), this.meta.seats.map((p) => !p));
        await this.save(); this.push({ force: true });
        this.report();
        return;
      }
      case 'act': {
        if (inLobby) return;
        const res = Duo.act(D, seat, d, now);
        this.send(ws, { t: 'ack', seq: Number.isInteger(d.seq) ? d.seq : 0, ok: res.ok, h: res.h || null, why: res.why || null });
        if (!res.ok) { this.sent.delete(ws); this.send(ws, this.syncMsg(ws)); if (res.why !== 'time') await this.save(); return; }
        await this.save();
        this.push({ skip: ws }); // the others' views (the teammate's m.team, a shared tower buy, the vote) and the clock
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
        const again = Duo.rematch(D, seat, units, matrix, now, this.seed());
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
  // the status line of each seat's lane (Ready ticks, the clock)
  status(gone) {
    const D = this.D, now = Date.now();
    if (!D || !D.lanes[0]) return this.push({ gone, force: true });
    const here = this.here(gone);
    for (const s of this.sockets(gone)) {
      const a = this.att(s);
      if (a.role !== 'p') continue;
      const own = Duo.SEATS[a.seat], pair = (arr) => [arr[Duo.seatOf(own.lane, 0)], arr[Duo.seatOf(own.lane, 1)]];
      this.send(s, { t: 'status', ready: pair(D.ready), nextReady: pair(D.nextReady), rematch: pair(D.rematch), here: pair(here.map((h, k) => h || D.bots[k])),
        remaining: D.deadline ? D.deadline - now : 0, held: D.held, phase: D.phase, duo: this.duoInfo(a.seat, here) });
    }
  }
  welcome(seat) {
    const own = Duo.SEATS[seat], R = this.D && this.D.lanes[own.lane];
    return { side: own.side, seat, lane: own.lane, key: this.meta.seats[seat] ? this.meta.seats[seat].key : '', seq: R ? R.seq[own.side] : 0, host: seat === this.meta.host, code: this.meta.code, duo: true };
  }

  async hello(ws, a, d) {
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
    this.sent.delete(ws);
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
  webSocketClose(ws) { return this.left(ws); }
  webSocketError(ws) { return this.left(ws); }

  async alarm() {
    const D = this.D, now = Date.now();
    const dueAt = D && D.lanes[0] ? Duo.due(D, now) : 0;
    if (dueAt && dueAt > now + 20 && this.meta && this.meta.pub) { // the listing's heartbeat only (room.js alarm)
      this.report({ force: true });
      await this.ctx.storage.setAlarm(this.listing() ? Math.min(dueAt, now + this.hbMs()) : dueAt);
      return;
    }
    if (D && D.lanes[0] && Duo.due(D, now)) {
      const f = Duo.tick(D, now);
      await this.save();
      if (f) this.broadcastFight(f); else this.push({ force: true });
      if (f) this.report();
      return;
    }
    const active = (await this.ctx.storage.get('active')) || 0;
    if (now - active >= KEEP_MS && !this.sockets().length) { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.D = null; this.meta = null; this.chat.lines = []; return; }
    if (this.meta && this.meta.pub) this.report({ force: true });
    await this.ctx.storage.setAlarm(this.listing() ? now + this.hbMs() : now + KEEP_MS);
  }
}
