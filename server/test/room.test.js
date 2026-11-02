// Server step 1 check. Starts the server locally (wrangler dev), then:
//  - /health answers
//  - /selftest plays the same round as plain node (same engine = same result on the server)
//  - two players in a room see each other's messages; a third room code doesn't
//  - a wrong website (Origin) is turned away, a bad code is refused
//  - flooding and oversized messages get the connection closed
// Run: cd server && npm test
const { spawn } = require('child_process');
const assert = require('assert');
const path = require('path');
const Game = require('../../src/game.js');
const demo = require('../../src/demo-units.json');

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
    const m = Game.createMatch(demo.units, demo.matrix, 7, 'standard');
    Game.aiDeploy(m, 0); Game.aiDeploy(m, 1);
    const sim = Game.startBattle(m); while (sim.step()) {}
    const want = Game.resolve(m, sim.result());
    const st = await (await fetch(`${BASE}/selftest`)).json();
    assert.deepStrictEqual(st.dmg, want.dmg, 'server battle matches node');
    assert.deepStrictEqual(st.hp, m.hp);
    assert.strictEqual((await fetch(`${BASE}/selftest`)).status, 429, 'selftest throttled');

    step('selftest ok');
    // relay between two players
    const a = await open('ABCD'); const b = await open('ABCD'); const c = await open('WXYZ');
    await waitFor(() => a.inbox.find((x) => x.t === 'join'));
    b.send(JSON.stringify({ t: 'hi', n: 1 }));
    const got = await waitFor(() => a.inbox.find((x) => x.t === 'msg'));
    assert.deepStrictEqual(got.d, { t: 'hi', n: 1 });
    await sleep(200);
    assert.ok(!c.inbox.some((x) => x.t === 'msg'), 'other room hears nothing');

    step('relay ok');
    // refused
    assert.strictEqual((await fetch(`${BASE}/room/ab`)).status, 400);
    await assert.rejects(open('ab'));
    await assert.rejects(open('ABCD', 'https://evil.example'));

    step('refused ok');
    // flooding closes the connection
    const f = await open('FLOOD');
    for (let i = 0; i < 60; i++) f.send('{"t":"x"}');
    assert.strictEqual(await closed(f), 1008);

    step('flood ok');
    // too big closes the connection
    const g = await open('BIGGY');
    g.send(JSON.stringify({ t: 'x', pad: 'x'.repeat(300 * 1024) }));
    assert.strictEqual(await closed(g), 1009);

    for (const s of [a, b, c]) s.close();
    console.log('server step 1 ok (battle on server matches node; rooms, limits and origin check work)');
  } finally {
    dev.kill('SIGTERM');
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
