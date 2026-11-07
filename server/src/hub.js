// PlayerHub (2026-11-04; docs/FRIENDS.md): one Durable Object per player, named by the player id. The live part of
// friends: online status (the green and grey dots), friend requests arriving, game invites and private messages.
// Everything that lasts is in D1 (accounts.js FRIENDS); a hub only keeps open invites in its own storage.
//
// The page opens one socket to its own hub while the app is open: /hub?p=<player id> (ids are public), then
// hello { session } (the session never goes in the URL). The hub checks that the session belongs to that player and
// that it is a signed-in (Google) account. Several phones of one player may be connected at once.
//
// Messages in:  hello { session }, status { where: 'menu'|'room'|'match', code?, round? }, invite { to, code, mode? },
//               inviteCancel { code }, decline { code }, dm { to, text }, ping (answered without waking the hub)
// Messages out: welcome { id, invites }, denied { why }, status { id, online, status, seen }, request { from },
//               accepted { by }, removed { by }, invite { from, code, mode, expires }, invited { to, code, expires },
//               inviteFail { to, why }, inviteGone { from?, code }, declined { by, code }, dm { from, to?, text, at, k },
//               dmFail { to, why }, gg { from (gamertag) } (room.js: a GG after a match the player has left, 2026-11-07)
// Hub to hub and accounts.js to hub (Durable Object RPC): friendStatus, event, inviteIn, inviteGone, declined, deliver, presence.
import { DurableObject } from 'cloudflare:workers';
import { readMessage, LIMITS } from './limits.js';
import { hubPlayer, setPresence, friendIds, areFriends, saveDm, FRIENDS } from './accounts.js';
import { cleanText, filterWords, rateOk } from './text.js';

const CODE_RE = /^[A-Z0-9]{4,8}$/;
const WHERE = ['menu', 'room', 'match'];
const RANK = { menu: 0, room: 1, match: 2 };
const HELLO_MS = 10e3;          // a socket that hasn't said hello by then is closed
const BEAT_MS = 60e3;           // the status is written to D1 at most this often while unchanged (pages resend it every 2 min)
// test-only settings (never set in production): HUB_INVITE_MS (invite lifetime), HUB_DM_BURST ('n,ms'), HUB_DM_HOUR (n)
const knobs = (env) => {
  const b = String(env.HUB_DM_BURST || '').split(',').map(Number);
  return { inviteMs: +env.HUB_INVITE_MS || FRIENDS.inviteMs, burst: b[0] > 0 && b[1] > 0 ? b : FRIENDS.dmBurst, hour: +env.HUB_DM_HOUR || FRIENDS.dmHour };
};

export class PlayerHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.rate = new Map();      // socket -> message rate (limits.js)
    this.lim = {};              // invites a minute, messages per 10 s (rateOk); resets if the hub sleeps, D1 keeps the hourly one
    this.last = '';             // the status last written and sent to friends
    this.lastAt = 0;
  }

  async fetch(request) {
    const pid = request.headers.get('x-player') || '';
    if (this.ctx.getWebSockets().length >= LIMITS.maxHubSockets) return new Response('hub full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, ok: false, at: Date.now() });
    await this.alarmAt(Date.now() + HELLO_MS + 500);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ----- helpers -----
  att(ws) { return ws.deserializeAttachment() || {}; }
  setAtt(ws, more) { ws.serializeAttachment({ ...this.att(ws), ...more }); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  live(gone) { return this.ctx.getWebSockets().filter((s) => s !== gone && s.readyState <= 1 && this.att(s).ok); }
  toAll(obj, gone) { for (const s of this.live(gone)) this.send(s, obj); }
  me(gone) { const s = this.live(gone)[0]; return s ? this.att(s) : null; }
  hub(id) { return this.env.HUB.getByName(id); }
  // the busiest status of this player's phones (a match beats a room beats the menu); null when none is open
  combined(gone) {
    let best = null;
    for (const s of this.live(gone)) { const st = this.att(s).st || { where: 'menu' }; if (!best || RANK[st.where] > RANK[best.where]) best = st; }
    return best;
  }
  async alarmAt(t) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || cur > t) await this.ctx.storage.setAlarm(t);
  }
  async invites(prefix) { return [...(await this.ctx.storage.list({ prefix })).entries()]; }

  // the status changed (or a heartbeat): write it to D1 and tell each friend's hub. force: always send.
  async publish(gone, force) {
    const pid = (this.me(gone) || {}).pid || this.pid;
    if (!pid) return;
    this.pid = pid;
    const st = this.combined(gone);
    const key = JSON.stringify(st), now = Date.now();
    if (!force && key === this.last && now - this.lastAt < BEAT_MS) return;
    const changed = key !== this.last;
    this.last = key; this.lastAt = now;
    await setPresence(this.env, pid, st, now);
    // open invites to a room none of this player's phones is in any more are cancelled
    const codes = new Set(this.live(gone).map((s) => (this.att(s).st || {}).code).filter(Boolean));
    for (const [k, v] of await this.invites('out:')) if (!codes.has(v.code) || v.expires < now) await this.cancelOut(k.slice(4), v);
    // an invite to a room this player is now in is used
    for (const [k, v] of await this.invites('in:')) if (codes.has(v.code)) await this.ctx.storage.delete(k);
    if (!changed && !force) return;
    const pub = { online: !!st, status: st ? { where: st.where, ...(st.where === 'match' && st.round ? { round: st.round } : {}) } : null, seen: now };
    const ids = await friendIds(this.env, pid);
    await Promise.all(ids.map((id) => this.hub(id).friendStatus(pid, pub, st ? st.code || '' : '').catch((e) => console.warn('hub status', e && e.message))));
  }
  async cancelOut(to, v) {
    await this.ctx.storage.delete('out:' + to);
    try { await this.hub(to).inviteGone(this.pid, v.code); } catch (e) { console.warn('hub invite', e && e.message); }
  }

  // ----- sockets -----
  async webSocketMessage(ws, message) {
    const d = readMessage(ws, message, this.rate, LIMITS.hubRatePerWindow);
    if (!d) return;
    const a = this.att(ws);
    if (d.t === 'ping') return this.send(ws, { t: 'pong' });
    if (d.t === 'hello') return this.hello(ws, a, d);
    if (!a.ok) return;
    this.pid = a.pid;
    try {
      switch (d.t) {
        case 'status': return await this.status(ws, a, d);
        case 'invite': return await this.invite(ws, a, d);
        case 'inviteCancel': {
          const code = String(d.code || '').toUpperCase();
          for (const [k, v] of await this.invites('out:')) if (v.code === code) await this.cancelOut(k.slice(4), v);
          return;
        }
        case 'decline': {
          const code = String(d.code || '').toUpperCase();
          for (const [k, v] of await this.invites('in:')) if (v.code === code) {
            await this.ctx.storage.delete(k);
            this.toAll({ t: 'inviteGone', from: v.from.id, code });
            try { await this.hub(v.from.id).declined({ id: a.pid, tag: a.tag }, code); } catch (e) { console.warn('hub decline', e && e.message); }
          }
          return;
        }
        case 'dm': return await this.dm(ws, a, d);
      }
    } catch (e) { console.warn('hub', d.t, e && e.message); }
  }

  async hello(ws, a, d) {
    if (a.ok) return;
    const p = await hubPlayer(this.env, d.session).catch(() => null);
    if (!p || p.id !== a.pid) { this.send(ws, { t: 'denied', why: 'session' }); ws.close(1008, 'session'); return; }
    if (!p.google) { this.send(ws, { t: 'denied', why: 'google' }); ws.close(1008, 'google'); return; }
    this.pid = p.id;
    this.setAtt(ws, { ok: true, tag: p.tag, title: p.title, st: { where: 'menu' } });
    const now = Date.now();
    const invites = (await this.invites('in:')).map(([, v]) => v).filter((v) => v.expires > now);
    this.send(ws, { t: 'welcome', id: p.id, invites });
    await this.publish(null, this.live(ws).length === 0); // the first phone: friends see the green dot at once
  }

  async status(ws, a, d) {
    if (!WHERE.includes(d.where)) return;
    const st = { where: d.where };
    if (d.where !== 'menu' && typeof d.code === 'string' && CODE_RE.test(d.code.toUpperCase())) st.code = d.code.toUpperCase();
    if (d.where === 'match' && Number.isInteger(d.round) && d.round > 0 && d.round < 100) st.round = d.round;
    this.setAtt(ws, { st });
    await this.publish();
  }

  async invite(ws, a, d) {
    const to = typeof d.to === 'string' ? d.to : '', code = String(d.code || '').toUpperCase();
    const fail = (why) => this.send(ws, { t: 'inviteFail', to, why });
    if (!CODE_RE.test(code)) return fail('room');
    if (!this.live().some((s) => (this.att(s).st || {}).code === code)) return fail('room'); // only to a room you're in
    if (!(await areFriends(this.env.ACCOUNTS, a.pid, to))) return fail('not friends');
    const now = Date.now();
    const open = await this.ctx.storage.get('out:' + to);
    if (open && open.expires > now && open.code !== code) return fail('open');
    if (!rateOk(this.lim, 'invite', FRIENDS.invitesPerMin, 60e3, now)) return fail('slow down');
    let there = null;
    try { there = await this.hub(to).presence(); } catch (e) { there = null; }
    if (!there || !there.online) return fail('offline');
    const mode = d.mode === 'ranked' ? 'ranked' : 'standard';
    const inv = { from: { id: a.pid, tag: a.tag, title: a.title || '' }, code, mode, expires: now + knobs(this.env).inviteMs };
    await this.ctx.storage.put('out:' + to, { code, expires: inv.expires });
    await this.alarmAt(inv.expires);
    await this.hub(to).inviteIn(inv);
    this.toAll({ t: 'invited', to, code, expires: inv.expires });
  }

  async dm(ws, a, d) {
    const to = typeof d.to === 'string' ? d.to : '';
    const fail = (why) => this.send(ws, { t: 'dmFail', to, why });
    const text = filterWords(cleanText(d.text, FRIENDS.dmMax));
    if (!text) return;
    const k = knobs(this.env);
    if (!rateOk(this.lim, 'dm', k.burst[0], k.burst[1])) return fail('slow down');
    const r = await saveDm(this.env, a.pid, to, text, Date.now(), k.hour);
    if (r.error) return fail(r.error);
    const from = { id: a.pid, tag: a.tag, title: a.title || '' };
    this.toAll({ t: 'dm', from, to, text, at: r.at, k: r.k }); // this player's phones (the sender's own copy)
    if (!r.muted) { try { await this.hub(to).deliver({ t: 'dm', from, text, at: r.at, k: r.k }); } catch (e) { console.warn('hub dm', e && e.message); } }
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) {
    const a = this.att(ws);
    if (!a.ok) return;
    this.pid = a.pid;
    try { await this.publish(ws); } catch (e) { console.warn('hub close', e && e.message); }
  }

  async alarm() {
    const now = Date.now();
    for (const s of this.ctx.getWebSockets()) { const a = this.att(s); if (!a.ok && now - (a.at || 0) > HELLO_MS) { try { s.close(1008, 'hello'); } catch {} } }
    let next = 0;
    for (const [k, v] of await this.invites('in:')) {
      if (v.expires <= now) { await this.ctx.storage.delete(k); this.toAll({ t: 'inviteGone', from: v.from.id, code: v.code }); }
      else next = next ? Math.min(next, v.expires) : v.expires;
    }
    for (const [k, v] of await this.invites('out:')) {
      if (v.expires <= now) await this.ctx.storage.delete(k);
      else next = next ? Math.min(next, v.expires) : v.expires;
    }
    if (this.ctx.getWebSockets().some((s) => !this.att(s).ok)) next = next ? Math.min(next, now + HELLO_MS) : now + HELLO_MS;
    if (next) await this.ctx.storage.setAlarm(next);
  }

  // ----- RPC from other hubs and from accounts.js -----
  // a friend's status changed; code: the room they are in (kept here: an invite to it is then used)
  async friendStatus(id, pub, code) {
    if (code) { const v = await this.ctx.storage.get('out:' + id); if (v && v.code === code) await this.ctx.storage.delete('out:' + id); }
    this.toAll({ t: 'status', id, ...pub });
  }
  event(msg) { if (msg && typeof msg.t === 'string') this.toAll(msg); }
  async inviteIn(inv) {
    const old = await this.ctx.storage.get('in:' + inv.from.id);
    if (old && old.code !== inv.code) this.toAll({ t: 'inviteGone', from: inv.from.id, code: old.code });
    await this.ctx.storage.put('in:' + inv.from.id, inv);
    await this.alarmAt(inv.expires);
    this.toAll({ t: 'invite', ...inv });
  }
  async inviteGone(from, code) {
    const v = await this.ctx.storage.get('in:' + from);
    if (!v || v.code !== code) return;
    await this.ctx.storage.delete('in:' + from);
    this.toAll({ t: 'inviteGone', from, code });
  }
  async declined(by, code) {
    const v = await this.ctx.storage.get('out:' + by.id);
    if (v && v.code === code) await this.ctx.storage.delete('out:' + by.id);
    this.toAll({ t: 'declined', by, code });
  }
  deliver(msg) { this.toAll(msg); }
  // is this player online? (an invite only goes to an online friend): any phone with a hub socket open
  presence() {
    const st = this.combined();
    return st ? { online: true, where: st.where } : { online: false };
  }
}
