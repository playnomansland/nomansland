// No Mans Land game server: step 1 (setup). See docs/SERVER.md for the plan.
//
// Routes
//   GET /health            -> { ok, version }
//   GET /selftest          -> plays one bot-vs-bot round of the real game inside a Durable Object and reports the time
//   GET /room/<CODE>       -> WebSocket into the Room for that code (4-8 letters/digits)
//
// A Room is one Durable Object per code. For now it only relays messages between the people in it, with the
// safety limits below. Step 2 puts the tournament hub in it, step 3 the match itself (the server as referee).

import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import demo from '../../src/demo-units.json';

const VERSION = 'step1-2026-11-02';

// Safety limits. Kept small on purpose: a round-based game never needs more.
const LIMITS = {
  maxMessageBytes: 256 * 1024,  // the biggest real message (a whole side) is far below this
  maxSockets: 12,               // 2 players + spectators
  ratePerWindow: 40,            // messages one connection may send ...
  rateWindowMs: 10_000,         // ... per 10 seconds; more and it's disconnected
  selftestEveryMs: 10_000,      // the self test runs at most once per 10 s
};

const CODE_RE = /^[A-Z0-9]{4,8}$/;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = allowedOrigin(request, env) ? { 'access-control-allow-origin': request.headers.get('Origin') } : {};
    if (request.method !== 'GET') return json({ error: 'method' }, 405);

    if (url.pathname === '/health') return json({ ok: true, version: VERSION }, 200, cors);

    if (url.pathname === '/selftest') {
      const stub = env.ROOM.getByName('selftest');
      return stub.fetch(new Request('https://room/selftest'));
    }

    const m = url.pathname.match(/^\/room\/([^/]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      // Browsers always send Origin, so this keeps other websites from opening connections from a visitor's
      // browser. It is not a lock against scripts (they can fake it); the room's own checks handle those.
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      return env.ROOM.getByName(code).fetch(request);
    }

    return json({ error: 'not found' }, 404);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map();      // socket -> { start, count }; resets if the room hibernates, which is fine
    this.lastSelftest = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/selftest') return this.selftest();

    if (this.ctx.getWebSockets().length >= LIMITS.maxSockets) return json({ error: 'room full' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    const id = crypto.randomUUID().slice(0, 8);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id });
    server.send(JSON.stringify({ t: 'welcome', id, peers: this.ctx.getWebSockets().length - 1, version: VERSION }));
    this.broadcast(server, { t: 'join', id });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const size = typeof message === 'string' ? message.length : message.byteLength;
    if (size > LIMITS.maxMessageBytes) return ws.close(1009, 'message too big');

    const now = Date.now();
    const r = this.rate.get(ws) || { start: now, count: 0 };
    if (now - r.start > LIMITS.rateWindowMs) { r.start = now; r.count = 0; }
    r.count++;
    this.rate.set(ws, r);
    if (r.count > LIMITS.ratePerWindow) return ws.close(1008, 'too many messages');

    if (typeof message !== 'string') return ws.close(1003, 'text only');
    let data;
    try { data = JSON.parse(message); } catch { return ws.close(1007, 'not json'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ws.close(1007, 'not an object');

    if (data.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }));
    const { id } = ws.deserializeAttachment() || {};
    this.broadcast(ws, { t: 'msg', from: id, d: data });
  }

  webSocketClose(ws) { this.leave(ws); }
  webSocketError(ws) { this.leave(ws); }

  leave(ws) {
    this.rate.delete(ws);
    const { id } = ws.deserializeAttachment() || {};
    this.broadcast(ws, { t: 'leave', id });
  }

  broadcast(except, obj) {
    const text = JSON.stringify(obj);
    for (const s of this.ctx.getWebSockets()) if (s !== except) { try { s.send(text); } catch {} }
  }

  selftest() {
    const now = Date.now();
    if (now - this.lastSelftest < LIMITS.selftestEveryMs) return json({ error: 'try again in a few seconds' }, 429);
    this.lastSelftest = now;
    const t0 = performance.now();
    const m = Game.createMatch(demo.units, demo.matrix, 7, 'standard');
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
    const sim = Game.startBattle(m);
    while (sim.step()) {}
    const summary = Game.resolve(m, sim.result());
    // In a deployed Worker the clock only moves on I/O, so ms can read 0 there; locally it is real.
    return json({ ok: true, version: VERSION, ms: Math.round(performance.now() - t0), dmg: summary.dmg, hp: m.hp });
  }
}
