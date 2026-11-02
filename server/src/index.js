// No Mans Land game server. See docs/SERVER.md for the plan.
//
// Routes
//   GET /                  -> a short note that the server is running
//   GET /health            -> { ok, version }
//   GET /selftest          -> plays one bot-vs-bot round of the real game inside a Durable Object
//   GET /room/<CODE>       -> WebSocket into the match Room for that code (step 3 makes it the referee)
//   GET /tour/<CODE>       -> WebSocket into the tournament for that code (TourRoom: the server keeps the tournament)
import { json } from './limits.js';
import { VERSION } from './version.js';
export { Room } from './room.js';
export { TourRoom } from './tour.js';

const CODE_RE = /^[A-Z0-9]{4,8}$/;

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = allowedOrigin(request, env) ? { 'access-control-allow-origin': request.headers.get('Origin'), vary: 'Origin' } : {};
    if (request.method !== 'GET') return json({ error: 'method' }, 405);

    if (url.pathname === '/') {
      return new Response(`No Mans Land game server is running (${VERSION}).\nPlay at https://snetendare.github.io/phone-bellum/\n`, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/health') return json({ ok: true, version: VERSION }, 200, cors);
    if (url.pathname === '/selftest') return env.ROOM.getByName('selftest').fetch(new Request('https://room/selftest'));

    const m = url.pathname.match(/^\/(room|tour)\/([^/]+)$/);
    if (m) {
      const code = m[2].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'bad code' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      // Browsers always send Origin, so this keeps other websites from opening connections from a visitor's
      // browser. It is not a lock against scripts (they can fake it); the rooms' own checks handle those.
      if (!allowedOrigin(request, env)) return json({ error: 'origin' }, 403);
      const ns = m[1] === 'room' ? env.ROOM : env.TOUR;
      const headers = new Headers(request.headers); headers.set('x-code', code);
      return ns.getByName(code).fetch(new Request(request, { headers }));
    }

    return json({ error: 'not found' }, 404);
  },
};
