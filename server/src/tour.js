// A tournament: one Durable Object per tournament code. It keeps the tournament (src/tournament.js) in its own
// storage, so it lives on when the organizer's phone closes. Everyone (organizer, players, watchers) talks to it
// over one WebSocket each.
//
// Who may do what:
// - The organizer gets a secret key when creating it; only a connection that shows that key runs organizer
//   actions (Tour.apply: start rounds, set results, change pairings, settings...).
// - Each player gets their own secret key on joining. Player ids are public (everyone sees the standings), keys
//   never leave the server except to their owner, so nobody can report a result as someone else.
// - A player can only report results for their own match (step 3 makes the server the referee of the match itself).
//
// Messages in:  create, hello, name, result, leave, org { op, a }, ping
// Messages out: created { id, key }, joined { id, key }, state { tour, online }, taken, closed, full, kicked, ended, gone, pong
import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import Tour from '../../src/tournament.js';
import { LIMITS, json, readMessage, secret } from './limits.js';
import { builtin } from './units.js';

const KEEP_MS = 14 * 24 * 3600 * 1000;   // a tournament nobody touched for 14 days is deleted
const BOT_STEP_MS = 400;                  // pause between simulated bot matches
const MAPS = Game.MAPS.filter((x) => !x.plain).map((x) => x.id);
const newId = () => secret(5);            // 10 hex characters, like the page's ids

export class TourRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keep-alive pings are answered without waking the object up (no cost, no CPU)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.rate = new Map();
    ctx.blockConcurrencyWhile(async () => {
      this.t = (await ctx.storage.get('t')) || null;
      this.keys = (await ctx.storage.get('keys')) || {};
    });
  }

  async fetch(request) {
    if (this.ctx.getWebSockets().length >= LIMITS.maxTourSockets) return json({ error: 'full' }, 429);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ code: request.headers.get('x-code') || '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ----- helpers -----
  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, more) { ws.serializeAttachment({ ...this.att(ws), ...more }); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  online(gone) {
    const ids = new Set();
    for (const s of this.ctx.getWebSockets()) { if (s === gone || s.readyState > 1) continue; const a = this.att(s); if (a.id && !a.watch) ids.add(a.id); }
    return [...ids];
  }
  stateMsg(gone) { return { t: 'state', tour: this.t, online: this.online(gone) }; }
  broadcast(gone) {
    if (!this.t) return;
    const text = JSON.stringify(this.stateMsg(gone));
    for (const s of this.ctx.getWebSockets()) { if (s === gone) continue; const a = this.att(s); if (a.id || a.watch) { try { s.send(text); } catch {} } }
  }
  async save() {
    await this.ctx.storage.put({ t: this.t, keys: this.keys, active: Date.now() });
    await this.schedule();
  }
  async changed() { await this.save(); this.broadcast(); }
  kick(id, why) {
    for (const s of this.ctx.getWebSockets()) if (this.att(s).id === id) { this.send(s, { t: why }); try { s.close(1000, why); } catch {} }
  }

  // ----- messages -----
  async webSocketMessage(ws, message) {
    const d = readMessage(ws, message, this.rate);
    if (!d) return;
    const a = this.att(ws);
    switch (d.t) {
      case 'ping': return this.send(ws, { t: 'pong' });
      case 'create': return this.create(ws, a, d);
      case 'hello': return this.hello(ws, a, d);
    }
    if (!this.t) return this.send(ws, { t: 'gone' });
    const t = this.t;
    if (d.t === 'name') {
      if (t.status === 'lobby' && a.id && Tour.rename(t, a.id, d.name)) await this.changed();
    } else if (d.t === 'result') {
      const f = Tour.findMatch(t, String(d.match).slice(0, 40));
      if (!a.id || !f || (f.match.a !== a.id && f.match.b !== a.id)) return; // only the two players report
      const game = d.game | 0;
      if (d.code && Tour.gameOf(f.match, String(d.code).slice(0, 12)) !== game) return this.send(ws, this.stateMsg()); // an old code: doesn't count
      const hp = Array.isArray(d.hp) ? d.hp.slice(0, 2).map((x) => Math.max(0, Math.min(1000, x | 0))) : [0, 0];
      if (Tour.report(t, f.match.id, d.winner, hp, Math.max(0, Math.min(200, d.rounds | 0)), 'auto', game)) await this.changed();
      else this.send(ws, this.stateMsg()); // already known: tell them so they stop sending
    } else if (d.t === 'leave') {
      if (a.id && t.status === 'lobby' && a.id !== t.org && Tour.remove(t, a.id)) { delete this.keys[a.id]; this.setAtt(ws, { id: '' }); await this.changed(); }
    } else if (d.t === 'org') {
      if (!a.org) return;
      const op = String(d.op || '');
      if (op === 'end') return this.end();
      const dropId = op === 'drop' && d.a && typeof d.a.id === 'string' ? d.a.id : '';
      const wasLobby = t.status === 'lobby';
      if (Tour.apply(t, op, d.a, { maps: MAPS, orgName: 'Organizer' })) {
        if (dropId && wasLobby) { delete this.keys[dropId]; this.kick(dropId, 'kicked'); }
        await this.changed();
      } else this.send(ws, this.stateMsg());
    }
  }

  async create(ws, a, d) {
    if (this.t) return this.send(ws, { t: 'taken' });
    const code = a.code;
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return this.send(ws, { t: 'taken' });
    const t = Tour.create(code, typeof d.name === 'string' ? d.name : 'NML Tournament', {});
    Tour.applySettings(t, d.settings);
    const id = newId(), key = secret();
    Tour.join(t, id, d.orgName || 'Organizer');
    t.org = id; t.orgPlays = true;
    const bots = Math.max(0, Math.min(15, d.bots | 0));
    for (let k = 0; k < bots; k++) Tour.addBot(t);
    this.t = t; this.keys = { [id]: key };
    this.setAtt(ws, { id, org: true, watch: false });
    this.send(ws, { t: 'created', id, key });
    await this.changed();
  }

  async hello(ws, a, d) {
    const t = this.t;
    if (!t) { this.send(ws, { t: 'gone' }); try { ws.close(1000, 'gone'); } catch {} return; }
    if (d.watch) { this.setAtt(ws, { watch: true, id: '', org: false }); return this.send(ws, this.stateMsg()); }
    const id = typeof d.id === 'string' ? d.id.slice(0, 24) : '';
    if (id && this.keys[id] && d.key === this.keys[id]) {
      if (id !== t.org && !Tour.player(t, id)) { delete this.keys[id]; this.send(ws, { t: 'kicked' }); try { ws.close(1000, 'kicked'); } catch {} return; }
      this.setAtt(ws, { id, org: id === t.org, watch: false });
      if (t.status === 'lobby' && d.name && Tour.player(t, id)) Tour.rename(t, id, d.name);
      return this.changed();
    }
    // someone new
    if (t.status !== 'lobby') { this.send(ws, { t: 'closed' }); try { ws.close(1000, 'closed'); } catch {} return; }
    if (t.players.length >= LIMITS.maxTourPlayers) { this.send(ws, { t: 'full' }); try { ws.close(1000, 'full'); } catch {} return; }
    const nid = newId(), key = secret();
    if (!Tour.join(t, nid, d.name)) { this.send(ws, { t: 'closed' }); return; }
    this.keys[nid] = key;
    this.setAtt(ws, { id: nid, org: false, watch: false });
    this.send(ws, { t: 'joined', id: nid, key });
    await this.changed();
  }

  async end() {
    const socks = this.ctx.getWebSockets();
    for (const s of socks) this.send(s, { t: 'ended' });
    this.t = null; this.keys = {};
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const s of socks) { try { s.close(1000, 'ended'); } catch {} }
  }

  webSocketClose(ws) { this.rate.delete(ws); this.broadcast(ws); }
  webSocketError(ws) { this.rate.delete(ws); this.broadcast(ws); }

  // ----- bots and clean-up (one alarm does both) -----
  pendingBotMatch() {
    const t = this.t;
    if (!t || t.status !== 'running') return null;
    const r = Tour.current(t);
    const mt = r && r.matches.find((x) => x.b != null && !x.result && Tour.isBot(t, x.a) && Tour.isBot(t, x.b));
    return mt ? { r, mt } : null;
  }
  async schedule() {
    await this.ctx.storage.setAlarm(Date.now() + (this.pendingBotMatch() ? BOT_STEP_MS : KEEP_MS));
  }
  async alarm() {
    if (!this.t) return;
    const p = this.pendingBotMatch();
    if (!p) {
      const active = (await this.ctx.storage.get('active')) || 0;
      if (Date.now() - active >= KEEP_MS) { await this.end(); return; }
      await this.schedule();
      return;
    }
    this.simBotMatch(p.r, p.mt);
    await this.changed();
  }
  // a whole bot-vs-bot match with the tournament's settings, as the organizer's phone used to play it
  simBotMatch(r, mt) {
    const t = this.t, s = t.settings, { units, matrix } = builtin();
    const off = units.map((u, i) => ((s.offUnits || []).includes(u.name) ? i : -1)).filter((i) => i >= 0);
    const mapId = r.map && Game.MAPS.some((x) => x.id === r.map) ? r.map : (s.map || null);
    const game = Tour.gameOf(mt, mt.code);
    let sm;
    try {
      sm = Game.createMatch(units, matrix, (Math.random() * 1e9) >>> 0, mapId, null, (s.offChars || []).filter((id) => Game.charInfo(id)),
        { skin: s.skin || null, offUnits: off, offTowers: s.offTowers || [], mirror: s.mirror !== false, packOptions: s.packOptions || 3 });
      while (!sm.over && sm.round < 40) {
        for (const sd of [0, 1]) { if (Game.needsPack(sm, sd)) Game.choosePack(sm, sd, Math.floor(Math.random() * sm.packages[sd].length)); Game.aiDeploy(sm, sd); Game.aiLevel(sm, sd); }
        for (const sd of [0, 1]) { Game.ensureTower(sm, sd); Game.ensurePack(sm, sd); Game.ensureBwalls(sm, sd); }
        Game.settleTowerPicks(sm);
        const sim = Game.startBattle(sm); while (sim.step()) {}
        Game.resolve(sm, sim.result());
      }
    } catch (e) {
      console.warn('bot match', e);
      sm = { over: true, winner: Math.random() < 0.5 ? 0 : 1, hp: [0, 0], history: [] };
    }
    const w = sm.winner === 0 ? 'a' : sm.winner === 1 ? 'b' : 'draw';
    if (w === 'draw' && r.stage === 'playoff' && !(mt.bo > 1)) { Tour.replay(t, mt.id, Math.random); return; }
    if (!Tour.report(t, mt.id, w, [sm.hp[0], sm.hp[1]], (sm.history || []).length, 'auto', game)) {
      // a series game that didn't change anything would loop forever: settle the match as a draw-free coin flip
      Tour.report(t, mt.id, Math.random() < 0.5 ? 'a' : 'b', [0, 0], 0, 'org');
    }
  }
}
