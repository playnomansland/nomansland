// No Mans Land game server. See docs/SERVER.md for the plan.
//
// Routes
//   GET /                  -> a short note that the server is running
//   GET /health            -> { ok, version }
//   GET /selftest          -> plays one bot-vs-bot round of the real game inside a Durable Object
//   GET /room/<CODE>       -> WebSocket into the match Room for that code: the referee of a live match (step 3)
//   GET /room/<CODE>?t=<T> -> the same for a match of tournament T
//   GET /tour/<CODE>       -> WebSocket into the tournament for that code (TourRoom: the server keeps the tournament)
//   GET /duo/<CODE>        -> WebSocket into a 2v2 match (DuoRoom; only a developer account can make one)
//   GET /history?limit=&before= -> saved rounds of server matches, newest first, paged (HistoryRoom, step 4)
//   GET /history/<MATCH>   -> one match's rounds (<ROOM>-<seed>, or a bare room code for that room's newest match)
//   GET /history/<MATCH>?replay=<round> -> that round's replay { pre, summary } (Match history's Replay)
//   GET /lobby            -> WebSocket into the online lobby (LobbyRoom: the list of public rooms); without Upgrade: the list once
//   GET /leaderboard       -> ranked players with wins, ties and losses, and whether ranked play is on (accounts.js)
//   POST /account/<route>  -> accounts (step 5; guest, me, google, tag, signout, delete, title, skin, ranked, invite, discord): see accounts.js
// Cron (wrangler.toml [triggers], hourly): month end, the Legend title for the leaderboard's top 5 (accounts.js awardLegends),
// and skins given to a gamertag (accounts.js grantSkins)
import { json } from './limits.js';
import { handleAccount, leaderboard, awardLegends, grantSkins } from './accounts.js';
import { VERSION } from './version.js';
export { Room } from './room.js';
export { TourRoom } from './tour.js';
export { HistoryRoom } from './history.js';
export { DuoRoom } from './duo.js';
export { LobbyRoom } from './lobby.js';

const CODE_RE = /^[A-Z0-9]{4,8}$/;

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

export default {
  // LEGEND_NOW (ms) is for tests only: it stands in for the clock, so a test can end a month.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(awardLegends(env, +env.LEGEND_NOW || event.scheduledTime).then((r) => { if (r) console.log('legend', r.month, r.players.length); })
      .catch((e) => console.warn('legend', e && e.message)));
    ctx.waitUntil(grantSkins(env).catch((e) => console.warn('skins', e && e.message))); // skins given to a gamertag (accounts.js SKIN_GRANTS)
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = allowedOrigin(request, env) ? { 'access-control-allow-origin': request.headers.get('Origin'), vary: 'Origin' } : {};
    if (url.pathname.startsWith('/account/')) {
      // Only the game's own pages; the session token goes in the Authorization header, so browsers ask first (OPTIONS).
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors,
        'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' } });
      return handleAccount(request, env, cors);
    }
    if (request.method !== 'GET') return json({ error: 'method' }, 405);

    if (url.pathname === '/') {
      return new Response(`No Mans Land game server is running (${VERSION}).\nPlay at https://playnomansland.github.io/\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/health') return json({ ok: true, version: VERSION }, 200, cors);
    if (url.pathname === '/leaderboard') {
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      return leaderboard(env, cors);
    }
    if (url.pathname === '/selftest') return env.ROOM.getByName('selftest').fetch(new Request('https://room/selftest'));

    if (url.pathname === '/lobby') {
      // the online lobby (docs/LOBBY.md): the same origin check as the rooms; the IP goes on only for its limits
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      const headers = new Headers(request.headers);
      headers.set('x-ip', request.headers.get('CF-Connecting-IP') || ''); headers.set('x-origin', request.headers.get('Origin') || '');
      // LOBBY_TEST (tests only, never set in production): ?fake=CODE lists a room that sends no heartbeat
      if (env.LOBBY_TEST === '1' && url.searchParams.has('fake')) {
        await env.LOBBY.getByName('all').upsert({ code: url.searchParams.get('fake').toUpperCase(), kind: url.searchParams.get('kind') || 'match', host: { tag: 'Fake' }, players: 1, at: Date.now() }, '');
        return json({ ok: true });
      }
      try { return await env.LOBBY.getByName('all').fetch(new Request(request, { headers })); }
      catch (e) { console.warn('lobby', e && e.message); return json({ error: 'lobby unavailable' }, 503, cors); }
    }
    const h = url.pathname.match(/^\/history(?:\/([^/]+))?\/?$/);
    if (h) {
      // Browsers send Origin on these cross-site reads, so only the game's own pages can read from a visitor's browser.
      // Like the rooms' check, a first filter: the History object also limits reads per IP.
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      const q = new URLSearchParams();
      if (h[1]) q.set('id', h[1].toUpperCase().replace(/-(.*)$/, (_, s) => '-' + s.toLowerCase()));
      for (const k of ['limit', 'before', 'replay']) if (url.searchParams.has(k)) q.set(k, url.searchParams.get(k).slice(0, 12));
      const headers = new Headers({ 'x-origin': request.headers.get('Origin'), 'x-ip': request.headers.get('CF-Connecting-IP') || '' });
      try { return await env.HISTORY.getByName('all').fetch(new Request('https://history/?' + q, { headers })); }
      catch (e) { console.warn('history read', e && e.message); return json({ error: 'history unavailable' }, 503, cors); }
    }

    const m = url.pathname.match(/^\/(room|tour|duo)\/([^/]+)$/);
    if (m) {
      const code = m[2].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
      // a tournament match: its own room, apart from a friend's match that happens to have the same code
      const tour = m[1] === 'room' ? (url.searchParams.get('t') || '').toUpperCase() : '';
      if (tour && !CODE_RE.test(tour)) return json({ error: 'bad code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      // Browsers always send Origin, so this keeps other websites from opening connections from a visitor's
      // browser. It is not a lock against scripts (they can fake it); the rooms' own checks handle those.
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      const ns = m[1] === 'room' ? env.ROOM : m[1] === 'duo' ? env.DUO : env.TOUR;
      const headers = new Headers(request.headers); headers.set('x-code', code);
      if (tour) headers.set('x-tour', tour);
      return ns.getByName(tour ? `${tour}.${code}` : code).fetch(new Request(request, { headers }));
    }

    return json({ error: 'not found' }, 404);
  },
};
