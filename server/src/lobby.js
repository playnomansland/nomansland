// The online lobby (2026-11-04, docs/LOBBY.md): one LobbyRoom ('all', like HistoryRoom) holds the listing of every
// public room. Match rooms (Room, DuoRoom) report their own listing to it by Durable Object RPC (upsert / drop) when
// something on the card changes, and again every LOBBY.heartbeatMs while public; a listing not heard from for
// LOBBY.staleMs goes by itself (a room that crashed or was evicted). The lobby never touches a match: joining a listed
// room is the usual hello {} to /room/<CODE>, watching the usual hello { watch }.
//
// Listings: { code, kind: 'match'|'duo', mode: 'standard'|'ranked'|'2v2', host: { tag, title }, map, look, players,
// seats, phase: 'waiting'|'playing', round, watchers, spectate, dev, at (made) }. dev: 2v2 while config 'lobby_duo' is
// 'dev' (accounts.js lobbyDuo): only sent to lobby sockets whose session is a developer (the server's own dev column).
//
// WebSocket /lobby
//   in:  hello { session? }, quick, ping
//   out: rooms { list } (on hello), then room { listing } / gone { code } (changes, batched once a second),
//        quick { code } (the oldest open public Standard room, never this player's own) or quick { create: true }
//        (none: make one), pong
// GET /lobby: the same list without a socket (developer-only listings left out), for a quick first paint.
// RPC (match rooms): upsert(listing, owner), drop(code), claim(ip) (may this IP make one more public room?)
import { DurableObject } from 'cloudflare:workers';
import { LOBBY, json, readMessage, Window } from './limits.js';
import { sessionPlayer, lobbyDuo } from './accounts.js';

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+v) ? Math.round(+v) : lo));

// a listing as the lobby keeps it, from what a room sent (rooms are ours, but nothing odd goes out to phones)
export function cleanListing(l, now = Date.now()) {
  if (!l || typeof l !== 'object' || !/^[A-Z0-9]{4,8}$/.test(l.code || '')) return null;
  const kind = l.kind === 'duo' ? 'duo' : 'match';
  return {
    code: l.code, kind, mode: kind === 'duo' ? '2v2' : l.mode === 'ranked' ? 'ranked' : 'standard',
    host: { tag: str(l.host && l.host.tag, 24) || 'Player', title: str(l.host && l.host.title, 24) },
    map: str(l.map, 24), look: str(l.look, 24), players: int(l.players, 0, 4), seats: kind === 'duo' ? 4 : 2,
    phase: l.phase === 'playing' ? 'playing' : 'waiting', round: int(l.round, 0, 99), watchers: int(l.watchers, 0, 12),
    spectate: l.spectate !== false, dev: false, at: int(l.at, 0, now + 60_000) || now,
  };
}

export class LobbyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.rate = new Map();
    this.creates = new Window(LOBBY.createPerIp[0], LOBBY.createPerIp[1]);
    this.dirty = new Map();      // code -> listing | null: changes not sent to the lobby screens yet
    this.duo = { v: 'dev', at: 0 };
    ctx.blockConcurrencyWhile(async () => {
      // the listings live in this object's storage too, so a lobby that slept still has them (the rooms' heartbeats
      // would bring them back within a minute anyway)
      this.list = new Map(); this.seen = new Map(); this.owner = new Map();
      for (const [k, v] of await ctx.storage.list({ prefix: 'L:' })) {
        this.list.set(v.l.code, v.l); this.seen.set(v.l.code, v.seen); if (v.owner) this.owner.set(v.owner, v.l.code);
      }
    });
  }

  // the stale sweep runs every heartbeat (LOBBY_STALE_MS, a test-only setting, makes both short)
  sweepMs() { return Math.min(LOBBY.heartbeatMs, +this.env.LOBBY_STALE_MS || LOBBY.heartbeatMs); }
  async duoGate() {
    const now = Date.now();
    if (now - this.duo.at > 60_000) { try { this.duo = { v: await lobbyDuo(this.env), at: now }; } catch (e) { this.duo.at = now; } }
    return this.duo.v;
  }

  // ----- RPC from the match rooms -----
  // may this IP make one more public room? (LOBBY.createPerIp)
  claim(ip) { return this.creates.hit(String(ip || 'none')); }
  async upsert(raw, owner) {
    const now = Date.now(), l = cleanListing(raw, now);
    if (!l) return false;
    l.dev = l.kind === 'duo' && (await this.duoGate()) !== 'all';
    // one listed room per player (by account, guests by key + IP): a new one takes the old one's place
    if (owner) { const old = this.owner.get(owner); if (old && old !== l.code) await this.drop(old); }
    if (!this.list.has(l.code) && this.list.size >= LOBBY.maxListings) {
      // full: the oldest waiting room makes way (it stays joinable by code); if none is waiting, this one isn't listed
      const waiting = [...this.list.values()].filter((x) => x.phase === 'waiting').sort((a, b) => a.at - b.at)[0];
      if (!waiting || waiting.at > l.at) return false;
      await this.drop(waiting.code);
    }
    const prev = this.list.get(l.code);
    this.list.set(l.code, l); this.seen.set(l.code, now);
    if (owner) this.owner.set(owner, l.code);
    await this.ctx.storage.put('L:' + l.code, { l, seen: now, owner: owner || '' });
    if (!prev || JSON.stringify(prev) !== JSON.stringify(l)) this.changed(l.code, l);
    else await this.wake();
    return true;
  }
  async drop(code) {
    if (!this.list.has(code)) return false;
    this.list.delete(code); this.seen.delete(code);
    for (const [o, c] of this.owner) if (c === code) this.owner.delete(o);
    await this.ctx.storage.delete('L:' + code);
    this.changed(code, null);
    return true;
  }
  changed(code, l) { this.dirty.set(code, l); return this.wake(true); }
  // the next alarm: a batch to send within a second, else the stale sweep
  async wake(soon) {
    const at = await this.ctx.storage.getAlarm(), want = Date.now() + (soon ? LOBBY.batchMs : this.sweepMs());
    if (!this.list.size && !this.dirty.size) return;
    if (!at || at > want) await this.ctx.storage.setAlarm(want);
  }
  async alarm() {
    const now = Date.now();
    for (const [code, t] of this.seen) if (now - t > (+this.env.LOBBY_STALE_MS || LOBBY.staleMs)) await this.drop(code);
    this.flush();
    if (this.list.size) await this.ctx.storage.setAlarm(now + this.sweepMs());
  }
  flush() {
    if (!this.dirty.size) return;
    const changes = [...this.dirty]; this.dirty.clear();
    for (const s of this.sockets()) {
      const a = this.att(s);
      if (!a.hello) continue;
      for (const [code, l] of changes) this.send(s, l && (a.dev || !l.dev) ? { t: 'room', listing: l } : { t: 'gone', code });
    }
  }

  // ----- lobby screens -----
  att(ws) { return ws.deserializeAttachment() || {}; }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  sockets() { return this.ctx.getWebSockets().filter((s) => s.readyState <= 1); }
  view(dev) { return [...this.list.values()].filter((l) => dev || !l.dev).sort((a, b) => b.at - a.at); }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ rooms: this.view(false) }, 200, { 'access-control-allow-origin': request.headers.get('x-origin') || '', vary: 'Origin' });
    const ip = request.headers.get('x-ip') || 'none';
    if (this.sockets().filter((s) => this.att(s).ip === ip).length >= LOBBY.socketsPerIp) return json({ error: 'too many lobby screens' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ip, dev: false, hello: false });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    const d = readMessage(ws, message, this.rate, LOBBY.ratePerWindow);
    if (!d) return;
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });
    if (d.t === 'hello') {
      let who = null;
      if (typeof d.session === 'string' && d.session) { try { who = await sessionPlayer(this.env, d.session); } catch (e) { who = null; } }
      ws.serializeAttachment({ ...this.att(ws), dev: !!(who && who.dev), pid: who ? who.id : '', hello: true });
      return this.send(ws, { t: 'rooms', list: this.view(!!(who && who.dev)), dev: !!(who && who.dev) });
    }
    if (d.t === 'quick') {
      // the oldest open public Standard room (never ranked, never 2v2, never this player's own room: nobody is in a
      // room twice); none: the phone makes one
      const pid = this.att(ws).pid, mine = pid ? this.owner.get('p:' + pid) || '' : '';
      const open = [...this.list.values()].filter((l) => l.kind === 'match' && l.mode === 'standard' && l.phase === 'waiting' && l.players < l.seats && l.code !== mine && l.code !== (typeof d.not === 'string' ? d.not : ''))
        .sort((a, b) => a.at - b.at)[0];
      return this.send(ws, open ? { t: 'quick', code: open.code } : { t: 'quick', create: true });
    }
  }
  webSocketClose(ws) { this.rate.delete(ws); }
  webSocketError(ws) { this.rate.delete(ws); }
}
