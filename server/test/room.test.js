// Server step 1 check. Starts the server locally (wrangler dev), then:
//  - /health answers
//  - /selftest plays the same round as plain node (same engine = same result on the server)
//  - the first two phones in a room become side 0 and side 1 with their own keys; a third is turned away
//  - a wrong website (Origin) is turned away, a bad code is refused
//  - flooding and oversized messages get the connection closed
// Run: cd server && npm test
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');
const Game = require('../../src/game.js');
const { units, matrix } = require('../src/prepare-units.cjs')(require('../../src/engine.js'), require('../../src/demo-units.json'));

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
const ORIGIN = 'http://localhost:8766';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function open(code, origin = ORIGIN) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/room/${code}`, { headers: { Origin: origin } });
    ws.inbox = [];
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws error'));
  });
}
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(25); }
  throw new Error('timed out');
}
const closed = (ws) => new Promise((r) => { if (ws.readyState === 3) r(ws.closeCode); ws.onclose = (e) => r(e.code); });

setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref(); // a test never hangs CI
(async () => {
  const step = (x) => process.env.VERBOSE && console.log(x);
  const dev = process.env.SERVER_UP ? { kill() {} } : spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false' },
  });
  let log = '';
  if (dev.stdout) { dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d)); }
  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
      if (i > 120) throw new Error('server did not start:\n' + log);
      await sleep(500);
    }

    step('up');
    const h = await (await fetch(`${BASE}/health`)).json();
    assert.strictEqual(h.ok, true);

    // same round in node and on the server
    const m = Game.createMatch(units, matrix, 7, 'standard');
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
    const sim = Game.startBattle(m); while (sim.step()) {}
    const want = Game.resolve(m, sim.result());
    const st = await (await fetch(`${BASE}/selftest`)).json();
    assert.deepStrictEqual(st.dmg, want.dmg, 'server battle matches node');
    assert.deepStrictEqual(st.hp, m.hp);
    assert.strictEqual((await fetch(`${BASE}/selftest`)).status, 429, 'selftest throttled');

    step('selftest ok');
    // who is who: the first phone is side 0, the second side 1 (each with a key), a third can only watch
    const rc = 'R' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'Q'); // a fresh room (wrangler dev keeps old ones)
    const a = await open(rc); const b = await open(rc); const c = await open(rc);
    b.send(JSON.stringify({ t: 'hello' }));
    await waitFor(() => b.inbox.find((x) => x.t === 'nomatch')); // nobody made this match yet
    a.send(JSON.stringify({ t: 'hello', create: true }));
    const wa = await waitFor(() => a.inbox.find((x) => x.t === 'welcome'));
    b.send(JSON.stringify({ t: 'hello' }));
    const wb = await waitFor(() => b.inbox.find((x) => x.t === 'welcome'));
    assert.strictEqual(wa.side, 0); assert.strictEqual(wb.side, 1);
    assert.ok(wa.key && wb.key && wa.key !== wb.key);
    c.send(JSON.stringify({ t: 'hello' }));
    await waitFor(() => c.inbox.find((x) => x.t === 'full'));
    c.send(JSON.stringify({ t: 'hello', create: true }));
    await waitFor(() => c.inbox.find((x) => x.t === 'taken')); // the code is in use
    const lobby = await waitFor(() => [...a.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]));
    assert.deepStrictEqual(lobby.here, [true, true]);
    // another room code is another match
    const d = await open(rc + 'X');
    d.send(JSON.stringify({ t: 'hello', create: true }));
    assert.strictEqual((await waitFor(() => d.inbox.find((x) => x.t === 'welcome'))).side, 0);

    step('sides ok');
    // refused
    assert.strictEqual((await fetch(`${BASE}/room/ab`)).status, 400);
    assert.strictEqual((await fetch(`${BASE}/room/${rc}?t=x-y`)).status, 400);
    await assert.rejects(open('ab'));
    await assert.rejects(open(rc, 'https://evil.example'));

    step('refused ok');
    // flooding closes the connection
    const f = await open('FLOOD');
    for (let i = 0; i < 200; i++) f.send('{"t":"x"}'); // over the match room's limit (LIMITS.matchRatePerWindow)
    assert.strictEqual(await closed(f), 1008);

    step('flood ok');
    // too big closes the connection
    const g = await open('BIGGY');
    g.send(JSON.stringify({ t: 'x', pad: 'x'.repeat(300 * 1024) }));
    assert.strictEqual(await closed(g), 1009);

    for (const s of [a, b, c, d]) s.close();
    console.log('server step 1 ok (battle on server matches node; sides, limits and origin check work)');
  } finally {
    dev.kill('SIGTERM');
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
