// Ranked play (2026-11-02): a friend's match played as a best of 3 with fixed settings, results on the leaderboard.
// Checks:
//  - a ranked match needs an account on both sides (session in hello), and not the same player twice
//  - the developer switch: only a developer can turn ranked off and on; while off, nobody can make a ranked match
//  - the creator's settings are ignored except the look: Standard map (testgrid), 5 mirrored packages, no Blixten
//  - games are counted, rematch plays the next game, a decided series goes to GET /leaderboard once, a rematch after
//    that starts a new series, and leaving (forfeit) loses the series
//  - a normal friend's match is unchanged (no ranked field, the creator's settings count)
// Run: cd server && node test/ranked.test.js (also in npm test)
const assert = require('assert');
const { open, sleep, waitFor } = require('./harness.js');
const { idToken, startAccounts } = require('./accounts-env.js');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Bot = require('../../tools/net-bot.js');
const { units, matrix } = require('../src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));

const ORIGIN = 'http://localhost:8766';
const copy = (o) => JSON.parse(JSON.stringify(o));
const local = (view) => Ref.withUnits(copy(view), units, matrix);
const newCode = () => 'R' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 9 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8793, { DEV_EMAILS: 'dev@example.com', ACCOUNT_TAG_FRESH_MS: 0 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const board = async () => (await fetch(`${srv.base}/leaderboard`, { headers: { Origin: ORIGIN } })).json();
  async function phone(code, hello) {
    const ws = await open(`${srv.ws}/room/${code}`);
    ws.json({ t: 'hello', ...hello });
    await waitFor(() => ws.inbox.find((x) => ['welcome', 'denied', 'full', 'nomatch', 'taken'].includes(x.t)), 8000);
    ws.first = ws.inbox.find((x) => ['welcome', 'denied', 'full', 'nomatch', 'taken'].includes(x.t));
    return ws;
  }
  // the latest sync that matches; asks again now and then (CI machines are slow, and a view may have gone by)
  const syncOf = async (ws, ok) => {
    let asked = Date.now();
    return waitFor(() => {
      const hit = [...ws.inbox].reverse().find((x) => x.t === 'sync' && ok(x));
      if (!hit && Date.now() - asked > 3000) { asked = Date.now(); ws.json({ t: 'sync' }); }
      return hit;
    }, 60000);
  };
  async function deploySide(ws, side, view, r) {
    const m = local(view);
    let seq = ws.seq || 0;
    for (const a of Bot.deploy(m, side, { r })) {
      await sleep(5);
      ws.json({ t: 'act', seq: ++seq, fn: a.fn, a: a.a });
      const ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 20000);
      if (!ack.ok) break;
    }
    ws.seq = seq;
  }
  // plays one game of the series (both phones already in deploy of round 1); returns the last fight message
  async function playGame(a, b, seed) {
    const r = Bot.rng(seed);
    const nF = (s) => s.inbox.filter((x) => x.t === 'fight').length;
    const startA = nF(a);
    for (let round = 1; round < 40; round++) {
      const va = await syncOf(a, (x) => x.phase === 'deploy' && x.round === round && a.inbox.indexOf(x) >= a.gameStart);
      await deploySide(a, 0, va.m, r);
      b.json({ t: 'sync' }); await sleep(60);
      const vb = await syncOf(b, (x) => x.phase === 'deploy' && x.round === round && b.inbox.indexOf(x) >= b.gameStart);
      await deploySide(b, 1, vb.m, r);
      const before = nF(a);
      a.json({ t: 'ready', v: true }); b.json({ t: 'ready', v: true });
      const f = await waitFor(() => nF(a) > before && a.inbox.filter((x) => x.t === 'fight').pop(), 60000);
      await waitFor(() => nF(b) > before, 30000);
      if (f.post.over) { assert.ok(nF(a) > startA); return f; }
      a.json({ t: 'next', round: f.summary.round }); b.json({ t: 'next', round: f.summary.round });
    }
    throw new Error('game did not end');
  }
  const mark = (...ws) => ws.forEach((w) => { w.gameStart = w.inbox.length; w.seq = 0; });

  try {
    const A = (await call('guest', { tag: 'Alpha' })), B = (await call('guest', { tag: 'Bravo' })), C = (await call('guest', { tag: 'Charlie' }));
    assert.strictEqual(A.status, 200);
    const dev = await call('google', { credential: idToken({ email: 'dev@example.com', email_verified: true }) });
    assert.ok(dev.player.dev, 'the developer account');

    // ----- gamertags: once a week, developers any time -----
    const ren = await call('tag', { tag: 'Charlie2' }, C.session);
    assert.strictEqual(ren.status, 200); assert.ok(ren.player.tagNext > Date.now() + 6 * 24 * 3600e3, 'next change in a week');
    const again = await call('tag', { tag: 'Charlie3' }, C.session);
    assert.deepStrictEqual([again.status, again.error], [429, 'too soon'], 'not twice in a week'); assert.strictEqual(again.next, ren.player.tagNext);
    assert.strictEqual((await call('tag', { tag: 'Charlie2' }, C.session)).status, 200, 'the same name is no change');
    for (const n of ['DevOne', 'DevTwo']) assert.strictEqual((await call('tag', { tag: n }, dev.session)).player.tag, n, 'a developer renames any time');
    assert.strictEqual((await call('me', {}, dev.session)).player.tagNext, 0);

    // ----- titles -----
    assert.deepStrictEqual([A.player.titles, A.player.title], [['day1'], 'day1'], 'a first-week account has Day 1');
    assert.deepStrictEqual([dev.player.titles, dev.player.title], [['dev', 'day1'], 'dev'], 'a developer has DEV too, shown first');
    assert.strictEqual((await call('title', { title: 'dev' }, A.session)).status, 400, 'not someone else\'s title');
    assert.strictEqual((await call('title', { title: '' }, A.session)).player.title, '', 'no title shown');
    assert.strictEqual((await call('me', {}, A.session)).player.title, '', 'and it stays that way');
    assert.strictEqual((await call('title', { title: 'day1' }, A.session)).player.title, 'day1');
    assert.strictEqual((await call('title', { title: 'day1' }, dev.session)).player.title, 'day1', 'a developer can pick Day 1');

    // ----- accounts are needed -----
    let ws = await phone(newCode(), { create: true, ranked: true });
    assert.deepStrictEqual([ws.first.t, ws.first.why], ['denied', 'account'], 'no session: no ranked match');
    ws.close();
    ws = await phone(newCode(), { create: true, ranked: true, session: 'f'.repeat(64) });
    assert.deepStrictEqual([ws.first.t, ws.first.why], ['denied', 'account'], 'a made-up session: no ranked match');
    ws.close();

    // ----- the developer switch -----
    assert.strictEqual((await call('ranked', { on: false }, A.session)).status, 403, 'a guest is not a developer');
    assert.strictEqual((await board()).on, true, 'ranked is on to begin with');
    assert.deepStrictEqual(await call('ranked', { on: false }, dev.session), { status: 200, on: false });
    assert.strictEqual((await board()).on, false);
    assert.strictEqual((await call('me', {}, A.session)).rankedOn, false, '/me says so too');
    ws = await phone(newCode(), { create: true, ranked: true, session: A.session });
    assert.deepStrictEqual([ws.first.t, ws.first.why], ['denied', 'ranked off'], 'switched off: no ranked match');
    ws.close();
    assert.deepStrictEqual(await call('ranked', { on: true }, dev.session), { status: 200, on: true });

    // ----- a series -----
    const code = newCode();
    const a = await phone(code, { create: true, ranked: true, session: A.session });
    assert.strictEqual(a.first.t, 'welcome');
    assert.deepStrictEqual(a.first.ranked.tags, ['Alpha', ''], 'welcome carries the series');
    const self = await phone(code, { session: A.session });
    assert.deepStrictEqual([self.first.t, self.first.why], ['denied', 'self'], 'not against yourself');
    self.close();
    const noAcc = await phone(code, {});
    assert.deepStrictEqual([noAcc.first.t, noAcc.first.why], ['denied', 'account'], 'the joiner needs an account too');
    noAcc.close();
    const b = await phone(code, { session: B.session });
    assert.strictEqual(b.first.t, 'welcome'); assert.strictEqual(b.first.side, 1);
    const lob = await waitFor(() => [...a.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]), 8000);
    assert.deepStrictEqual(lob.ranked.tags, ['Alpha', 'Bravo']);
    mark(a, b);
    a.json({ t: 'start', settings: { map: 'cavern', skin: 'snow', offUnits: ['Sniper'], packOptions: 2, mirror: false } });
    const v1 = await syncOf(a, (x) => x.phase === 'deploy' && x.round === 1);
    assert.strictEqual(v1.m.map.id, 'testgrid', 'ranked plays the Standard map');
    assert.strictEqual(v1.m.skin, 'snow', 'in the creator\'s look');
    assert.ok(v1.m.mirror, 'mirrored packages and towers');
    assert.strictEqual(v1.m.packages[0].length, 5, '5 packages to pick from');
    assert.ok(!v1.m.packages[0].some((p) => p.char === 'blixten'), 'never Blixten');
    assert.ok(!(v1.m.offUnits || []).length, 'every unit');

    let games = 0, f;
    for (; games < 3; games++) {
      if (games) {
        mark(a, b);
        a.json({ t: 'rematch' }); b.json({ t: 'rematch' });
      }
      f = await playGame(a, b, 7 + games);
      assert.strictEqual(f.ranked.games, games + 1, 'the game is counted');
      if (f.ranked.done) break;
    }
    const rk = f.ranked;
    assert.ok(rk.done, 'decided within 3 games');
    const want = rk.result === -1 ? ['t', 't'] : rk.result === 0 ? ['w', 'l'] : ['l', 'w'];
    console.log(`series: ${rk.wins[0]}-${rk.wins[1]}, ${rk.ties} tied, ${rk.games} games`);
    const lb = await waitFor(async () => { const x = await board(); return x.rows.length === 2 && x; }, 8000);
    const row = (id) => lb.rows.find((r) => r.id === id);
    assert.strictEqual(row(A.player.id)[want[0]], 1, 'Alpha\'s result');
    assert.strictEqual(row(B.player.id)[want[1]], 1, 'Bravo\'s result');
    assert.strictEqual(row(A.player.id).tag, 'Alpha');
    assert.strictEqual(row(A.player.id).title, 'day1', 'the leaderboard shows titles');
    assert.deepStrictEqual(f.ranked.titles, ['day1', 'day1'], 'so does the series');

    // a rematch after a decided series starts a new one; leaving loses it
    mark(a, b);
    a.json({ t: 'rematch' }); b.json({ t: 'rematch' });
    const fresh = await syncOf(b, (x) => x.phase === 'deploy' && x.round === 1 && b.inbox.indexOf(x) >= b.gameStart);
    assert.deepStrictEqual([fresh.ranked.games, fresh.ranked.done], [0, false], 'a new series');
    b.json({ t: 'forfeit' });
    const ff = await a.next('forfeit', 8000);
    assert.deepStrictEqual([ff.ranked.done, ff.ranked.result, ff.ranked.forfeit], [true, 0, 1], 'leaving loses the series');
    const lb2 = await waitFor(async () => { const x = await board(); const r = x.rows.find((q) => q.id === B.player.id); return r && r.w + r.t + r.l === 2 && x; }, 8000);
    assert.strictEqual(lb2.rows.find((q) => q.id === B.player.id).l, want[1] === 'l' ? 2 : 1, 'Bravo has one more loss');
    a.close(); b.close();

    // ----- a normal match is as before -----
    const n = newCode();
    const na = await phone(n, { create: true, session: C.session });
    assert.strictEqual(na.first.ranked, null, 'no series');
    const nb = await phone(n, {});
    assert.strictEqual(nb.first.t, 'welcome', 'no account needed');
    await waitFor(() => [...na.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]), 8000);
    na.json({ t: 'start', settings: { map: 'cavern' } });
    const nv = await syncOf(na, (x) => x.phase === 'deploy');
    assert.strictEqual(nv.m.map.id, 'cavern', 'the creator\'s settings count');
    assert.strictEqual(nv.ranked, null);
    na.close(); nb.close();

    console.log('ranked: all checks passed');
    srv.stop(); process.exit(0);
  } catch (e) {
    console.error(e); console.error(srv.log().slice(-3000)); srv.stop(); process.exit(1);
  }
})();
