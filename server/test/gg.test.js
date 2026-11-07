// GG, My matches and replays (2026-11-04): room.js 'gg', accounts.js GG and /account/history, history.js mine/replay.
// Checks:
//  - after a whole online match between two accounts, each player can say GG once; both phones (and a watcher) see it;
//    a second GG, a GG before the match is over and a watcher's GG do nothing
//  - a GG counts on the other player's account (player.gg); a match someone left doesn't count
//  - /account/history lists the player's own matches with their side, usernames, ranked flag and replays;
//    another player doesn't see them; GET /history/<match>?replay=<round> gives the fight with its units, and playing
//    it back gives the saved result
// Run: cd server && node test/gg.test.js (also in npm test)
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
const newCode = () => 'G' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 6 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8779, { ACCOUNT_TAG_FRESH_MS: 0 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  async function phone(code, hello) {
    const ws = await open(`${srv.ws}/room/${code}`);
    ws.json({ t: 'hello', ...hello });
    ws.welcome = await waitFor(() => ws.inbox.find((x) => x.t === 'welcome'), 8000);
    return ws;
  }
  const syncOf = (ws, ok) => waitFor(() => { const s = [...ws.inbox].reverse().find((x) => x.t === 'sync' && ok(x)); if (!s) ws.json({ t: 'sync' }); return s; }, 20000);
  async function deploySide(ws, side, view, r) {
    const m = local(view);
    let seq = ws.seq || 0;
    for (const a of Bot.deploy(m, side, { r })) {
      await sleep(10);
      ws.json({ t: 'act', seq: ++seq, fn: a.fn, a: a.a });
      const ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000);
      if (!ack.ok) break;
    }
    ws.seq = seq;
  }
  const nFights = (s) => s.inbox.filter((x) => x.t === 'fight').length;
  // plays rounds until the match is over (or `upTo` rounds, then side `leaver` forfeits)
  async function play(a, b, seed, upTo, leaver) {
    const r = Bot.rng(seed);
    for (let round = 1; round <= 40; round++) {
      const va = await syncOf(a, (x) => x.phase === 'deploy' && x.round === round);
      await deploySide(a, 0, va.m, r);
      const vb = await syncOf(b, (x) => x.phase === 'deploy' && x.round === round);
      await deploySide(b, 1, vb.m, r);
      const before = nFights(a);
      a.json({ t: 'ready', v: true }); b.json({ t: 'ready', v: true });
      const f = await waitFor(() => nFights(a) > before && a.inbox.filter((x) => x.t === 'fight').pop(), 20000);
      if (f.post.over) return f;
      if (upTo && round >= upTo) {
        a.json({ t: 'next', round }); b.json({ t: 'next', round });
        await syncOf(a, (x) => x.phase === 'deploy' && x.round === round + 1);
        (leaver === 0 ? a : b).json({ t: 'forfeit' });
        await waitFor(() => a.inbox.find((x) => x.t === 'forfeit'), 8000);
        return null;
      }
      a.json({ t: 'next', round }); b.json({ t: 'next', round });
    }
    throw new Error('match did not end');
  }
  const ggs = (ws) => ws.inbox.filter((x) => x.t === 'gg');

  try {
    const A = await call('google', { credential: idToken({ sub: '7001' }) });
    await call('tag', { tag: 'Alpha' }, A.session);
    const B = await call('guest', { tag: 'Bravo' });
    const C = await call('guest', { tag: 'Charlie' });

    // ----- a whole match, then GG -----
    const code = newCode();
    let a = await phone(code, { create: true, session: A.session });
    const b = await phone(code, { session: B.session });
    const w = await phone(code, { watch: true });
    await waitFor(() => [...a.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]), 8000);
    a.json({ t: 'start', settings: { map: 'testgrid' } });
    await syncOf(a, (x) => x.phase === 'deploy');
    a.json({ t: 'gg' });
    await sleep(300);
    assert.strictEqual(ggs(b).length, 0, 'no GG before the match is over');
    const end = await play(a, b, 41);
    assert.ok(end.post.over, 'the match ended');
    const fights = nFights(a);
    a.json({ t: 'gg' }); a.json({ t: 'gg' }); w.json({ t: 'gg' });
    const g1 = await waitFor(() => ggs(b)[0], 8000);
    assert.deepStrictEqual([g1.from, g1.gg], [0, [true, false]], 'side 1 sees side 0\'s GG');
    await waitFor(() => ggs(w)[0], 8000);
    await sleep(400);
    assert.strictEqual(ggs(b).length, 1, 'a second GG and a watcher\'s GG do nothing');
    // Alpha has left the room (the menu): Alpha's friends hub brings Bravo's GG (2026-11-07)
    const keyA = a.welcome.key;
    a.close(); await sleep(400);
    const hubA = await open(`${srv.ws}/hub?p=${A.player.id}`, ORIGIN);
    hubA.json({ t: 'hello', session: A.session });
    await waitFor(() => hubA.inbox.find((x) => x.t === 'welcome'), 8000);
    b.json({ t: 'gg' });
    const g2 = await waitFor(() => ggs(b).find((x) => x.from === 1), 8000);
    assert.deepStrictEqual(g2.gg, [true, true]);
    const hg = await waitFor(() => hubA.inbox.find((x) => x.t === 'gg'), 8000);
    assert.strictEqual(hg.from, 'Bravo', 'the hub says who said GG');
    hubA.close();
    a = await phone(code, { key: keyA, session: A.session }); // back in the room
    const sy = await (async () => { const n = a.inbox.length; a.json({ t: 'sync' }); return waitFor(() => a.inbox.slice(n).find((x) => x.t === 'sync'), 8000); })();
    assert.deepStrictEqual(sy.gg, [true, true], 'a reloaded phone gets the GGs in its sync');
    const meB = await waitFor(async () => { const x = await call('me', {}, B.session); return x.player.gg === 1 && x; }, 8000);
    assert.strictEqual(meB.player.gg, 1, 'counted on Bravo');
    assert.strictEqual((await call('me', {}, A.session)).player.gg, 1, 'and on Alpha');
    console.log(`gg: a ${fights}-fight match, GGs shown and counted once`);

    // ----- My matches -----
    const hist = await waitFor(async () => { const x = await call('history', {}, A.session); return x.matches && x.matches.length && x.matches[0].rounds.length === fights && x; }, 10000);
    const mm = hist.matches[0];
    assert.strictEqual(mm.side, 0);
    assert.deepStrictEqual(mm.rounds[0].names, ['Alpha', 'Bravo'], 'usernames saved for account players');
    assert.strictEqual(mm.rounds[0].ranked, false);
    assert.ok(mm.rounds.every((q) => q.replay), 'every round has a replay');
    assert.ok(mm.rounds[mm.rounds.length - 1].over);
    assert.ok(!JSON.stringify(hist).includes('"p0"') && !JSON.stringify(hist).includes(B.player.id), 'account ids never go out');
    assert.strictEqual((await call('history', {}, B.session)).matches[0].side, 1, 'Bravo sees it as side 1');
    assert.strictEqual((await call('history', {}, C.session)).matches.length, 0, 'someone else doesn\'t see it');
    assert.strictEqual((await call('history', {})).status, 401, 'signed in only');

    // ----- a replay -----
    const k = Math.min(2, mm.rounds.length);
    const rr = await fetch(`${srv.base}/history/${mm.matchId}?replay=${k}`, { headers: { Origin: ORIGIN } });
    assert.strictEqual(rr.status, 200);
    const rep = await rr.json();
    assert.ok(Array.isArray(rep.pre.units) && rep.pre.units.length && rep.pre.matrix, 'the units it was played with come along');
    assert.strictEqual(rep.summary.round, k);
    const bt = Game.startBattle(rep.pre);
    while (bt.step()) {}
    assert.strictEqual(bt.result().winner, rep.summary.winner, 'playing the replay gives the saved result');
    assert.ok(Math.abs(bt.result().time - rep.summary.time) < 1e-9);
    assert.strictEqual((await fetch(`${srv.base}/history/${mm.matchId}?replay=99`, { headers: { Origin: ORIGIN } })).status, 404);
    assert.strictEqual((await fetch(`${srv.base}/history/${mm.matchId}?replay=x`, { headers: { Origin: ORIGIN } })).status, 400);
    console.log('history: my matches (sides, usernames, ids kept back), replays play back the same');
    for (const s of [a, b, w]) s.close();

    // ----- a match someone left: the GG shows but doesn't count -----
    const code2 = newCode();
    const a2 = await phone(code2, { create: true, session: A.session });
    const c2 = await phone(code2, { session: C.session });
    await waitFor(() => [...a2.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]), 8000);
    a2.json({ t: 'start', settings: { map: 'testgrid' } });
    await play(a2, c2, 42, 3, 1); // Charlie leaves after 3 fights
    const hubA2 = await open(`${srv.ws}/hub?p=${A.player.id}`, ORIGIN);
    hubA2.json({ t: 'hello', session: A.session });
    await waitFor(() => hubA2.inbox.find((x) => x.t === 'welcome'), 8000);
    a2.json({ t: 'gg' });
    await waitFor(() => ggs(a2).find((x) => x.from === 0), 8000);
    await sleep(400);
    assert.ok(!hubA2.inbox.some((x) => x.t === 'gg'), 'no hub GG to yourself, nor while the other is in the room');
    hubA2.close();
    await sleep(800);
    assert.strictEqual((await call('me', {}, C.session)).player.gg, 0, 'a match someone left doesn\'t count');
    a2.close(); c2.close();
    console.log('gg: a left match doesn\'t count');
    console.log('gg.test: all pass');
  } finally { srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
