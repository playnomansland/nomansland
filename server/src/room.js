// A match room: one Durable Object per match code. For now it only relays messages between the people in it
// (step 3 makes it the referee). Also runs the self test.
import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import { LIMITS, json, readMessage } from './limits.js';
import { builtin } from './units.js';
import { VERSION } from './version.js';

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings are answered without waking the object up (no cost, no CPU)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
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
    const data = readMessage(ws, message, this.rate);
    if (!data) return;
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
