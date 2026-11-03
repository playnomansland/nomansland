// Server step 3 check: the match Room is the referee. Starts the server locally (wrangler dev), then:
//  - whole matches between two scripted phones over WebSockets (a grid map, Otto's slot machine, a mirror match):
//    every action is acked with the server's fingerprint of that side, which matches the phone's own copy, and every
//    fight the server sends plays back the same in node (the phones' replay): same winner, same time
//  - hidden info: a phone's view and a watcher's never show the opponent's new squads while they deploy
//  - cheating over the wire: unknown functions, extra arguments, the other side's squads, locked units, bad tiles,
//    a made-up gold amount, actions after Ready: all refused, and the server's view comes back to put the phone right
//  - a phone that reloads gets its side back with its key; the clock waits while it is away; leaving while the
//    opponent is away counts as their loss
//  - the clock: when it runs out, the server starts the fight by itself
//  - a tournament match: only the two players (with their tournament keys) get in, it starts by itself, and the
//    result goes from the server to the tournament (a forfeit here)
// Run: cd server && npm test
const assert = require('assert');
const { startServer, open, sleep, waitFor } = require('./harness.js');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Bot = require('../../tools/net-bot.js');
const { units, matrix } = require('../src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));

const copy = (o) => JSON.parse(JSON.stringify(o));
const local = (view) => Ref.withUnits(copy(view), units, matrix);
const newCode = () => 'M' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');

setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref(); // a test never hangs CI
(async () => {
  const srv = await startServer(8797);
  const step = (x) => process.env.VERBOSE && console.log(x);
  const roomUrl = (code, tour) => `${srv.ws}/room/${code}${tour ? '?t=' + tour : ''}`;
  // a phone: hello, then waits for its welcome
  async function phone(code, hello = {}, tour) {
    const ws = await open(roomUrl(code, tour));
    ws.json({ t: 'hello', ...hello });
    ws.welcome = await ws.next('welcome', 8000);
    return ws;
  }
  // asks for a sync and waits for it
  async function fresh(ws) {
    const n = ws.inbox.filter((x) => x.t === 'sync').length;
    ws.json({ t: 'sync' });
    await waitFor(() => ws.inbox.filter((x) => x.t === 'sync').length > n, 8000);
    return ws.inbox.filter((x) => x.t === 'sync').pop();
  }
  // the latest sync a socket has that matches
  const syncOf = (ws, ok) => waitFor(() => [...ws.inbox].reverse().find((x) => x.t === 'sync' && ok(x)), 15000);
  // one side's deploy over the wire: the bot plays on its view, each action is sent and acked
  async function deploySide(ws, side, view, r, spins) {
    const m = local(view);
    const acts = Bot.deploy(m, side, { r, spins });
    let seq = ws.seq || 0, refused = 0;
    for (const a of acts) {
      await sleep(15); // a phone is never faster than a tap
      ws.json({ t: 'act', seq: ++seq, fn: a.fn, a: a.a });
      const ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000)
        .catch((e) => { console.log('no ack for', JSON.stringify(a), 'socket state', ws.readyState, 'last in', JSON.stringify(ws.inbox.slice(-3)).slice(0, 600)); throw e; });
      if (!ack.ok) { refused++; break; }
      ws.lastH = ack.h;
    }
    ws.seq = seq;
    if (!refused && acts.length) assert.strictEqual(ws.lastH, Ref.sideHash(m, side), 'phone and server in step');
    return { m, acts: acts.length, refused };
  }
  // plays a whole match between a and b (already in deploy); returns the end
  async function playMatch(a, b, opts = {}) {
    const r = Bot.rng(opts.seed || 1);
    let fights = 0, refused = 0, acts = 0;
    for (let guard = 0; guard < 40; guard++) {
      const round = guard + 1;
      const va = await syncOf(a, (x) => x.phase === 'deploy' && x.round === round);
      const vb = await syncOf(b, (x) => x.phase === 'deploy' && x.round === round);
      const ra = await deploySide(a, 0, va.m, r, opts.spins);
      // side 1 looks after side 0 has placed: none of it may show
      const vb2 = await fresh(b);
      assert.strictEqual(vb2.round, vb.round);
      assert.ok(!vb2.m.armies[0].some((q) => q.round === round), 'side 1 sees none of side 0\'s new squads');
      if (round === 1) assert.strictEqual(vb2.m.chars[0], null, 'nor their leader in round 1');
      const rb = await deploySide(b, 1, vb2.m, r, opts.spins);
      refused += ra.refused + rb.refused; acts += ra.acts + rb.acts;
      if (opts.watch) {
        const vw = await fresh(opts.watch);
        assert.ok(vw && !vw.m.armies[0].some((q) => q.round === round) && !vw.m.armies[1].some((q) => q.round === round), 'a watcher sees nobody\'s new squads');
      }
      const nFights = (s) => s.inbox.filter((x) => x.t === 'fight').length;
      const before = nFights(a);
      a.json({ t: 'ready', v: true });
      b.json({ t: 'ready', v: true });
      const f = await waitFor(() => nFights(a) > before && a.inbox.filter((x) => x.t === 'fight').pop(), 20000);
      await waitFor(() => nFights(b) > before, 8000);
      fights++;
      // the phones' playback of `pre` gives the server's result
      const bt = Game.startBattle(local(f.pre));
      while (bt.step()) {}
      const res = bt.result();
      assert.strictEqual(res.winner, f.summary.winner, `round ${round}: playback winner`);
      assert.ok(Math.abs(res.time - f.summary.time) < 1e-9, `round ${round}: playback time`);
      if (f.post.over) return { post: f.post, fights, refused, acts };
      a.json({ t: 'next', round: f.summary.round });
      b.json({ t: 'next', round: f.summary.round });
    }
    throw new Error('match did not end');
  }

  try {
    // ----- whole matches -----
    const configs = [
      { name: 'test grid, Otto spins', settings: { map: 'testgrid', offChars: Game.CHARACTERS.map((c) => c.id).filter((id) => id !== 'otto') }, spins: 3 },
      { name: 'cavern, mirror, Zoe', settings: { map: 'cavern', mirror: true, offChars: Game.CHARACTERS.map((c) => c.id).filter((id) => id !== 'zoe') } },
      { name: 'random map and leaders', settings: {} },
    ];
    for (const [k, c] of configs.entries()) {
      const code = newCode();
      const a = await phone(code, { create: true }), b = await phone(code);
      assert.deepStrictEqual([a.welcome.side, b.welcome.side], [0, 1]);
      const w = k === 0 ? await phone(code, { watch: true }) : null;
      b.json({ t: 'start', settings: c.settings }); // only side 0 starts
      await sleep(300);
      assert.ok(!a.inbox.some((x) => x.t === 'sync'), 'side 1 can\'t start the match');
      a.json({ t: 'start', settings: c.settings });
      const res = await playMatch(a, b, { seed: 10 + k, spins: c.spins, watch: w });
      if (c.settings.map) assert.strictEqual(res.post.map.id, c.settings.map);
      console.log(`match (${c.name}): ${res.fights} fights, ${res.acts} actions, ${res.refused} refused, all played back the same`);
      for (const s of [a, b, w]) if (s) s.close();
    }
    step('whole matches ok');

    // ----- cheating over the wire, reconnects, the clock -----
    {
      const code = newCode();
      const a = await phone(code, { create: true }), b = await phone(code);
      a.json({ t: 'start', settings: { map: 'forest', deploy1: 15 } });
      const v0 = await syncOf(a, (x) => x.phase === 'deploy');
      assert.ok(v0.remaining > 10000 && v0.remaining <= 15000, 'the clock runs');
      const act = async (ws, fn, args, extra = {}) => { ws.seq = (ws.seq || 0) + 1; const seq = ws.seq; ws.json({ t: 'act', seq, fn, a: args, ...extra }); return waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000); };
      assert.ok((await act(a, 'choosePack', [0])).ok);
      assert.ok((await act(b, 'choosePack', [0])).ok);
      const gold = (await fresh(a)).m.gold[0];
      for (const [fn, args, why] of [['addAltar', ['x'], 'not an action'], ['aiDeploy', [], 'not an action'], ['fortify', [3, 12, 'n', false], 'extra argument'],
        ['place', [0, 3, 2], 'enemy zone'], ['sell', [9999], 'no such squad'], ['place', ['0', 1, 13], 'a string']]) {
        const ack = await act(a, fn, args);
        assert.ok(!ack.ok, `${fn}: ${why}`);
      }
      // a phone that says it has more gold, or sends another side: nothing of it is taken
      a.json({ t: 'act', seq: 99, fn: 'buyDeploy', a: [], side: 1, gold: 99999 });
      a.json({ t: 'side', round: 1, army: [], gold: 99999 }); // the old PeerJS message: ignored here
      await sleep(200);
      const s1 = await fresh(a);
      assert.ok(s1.ack >= 99);
      assert.ok(s1.m.gold[0] <= gold, 'no gold out of nowhere');
      a.seq = 99;
      // after Ready: refused (and the phone gets the server's view back)
      a.json({ t: 'ready', v: true });
      await waitFor(() => a.inbox.find((x) => x.t === 'status' && x.ready[0]));
      const late = await act(a, 'buyDeploy', []);
      assert.ok(!late.ok && late.why === 'ready', 'after Ready');
      a.json({ t: 'ready', v: false });
      step('cheating ok');
      // side 1 reloads: same side with its key; the clock is held while it is away
      const key = b.welcome.key;
      b.close();
      const held = await waitFor(() => [...a.inbox].reverse().find((x) => (x.t === 'status' || x.t === 'sync') && x.here && !x.here[1]), 8000);
      assert.strictEqual(held.remaining, 0, 'clock held while side 1 is away');
      const b2 = await phone(code, { key });
      assert.strictEqual(b2.welcome.side, 1, 'same side back');
      const back = await syncOf(b2, (x) => x.phase === 'deploy');
      assert.strictEqual(back.m.pack[1], 0, 'its own package is still picked');
      assert.ok(back.remaining >= 9000, 'clock runs again');
      const stranger = await open(roomUrl(code));
      stranger.json({ t: 'hello', key: 'not-a-key' });
      await stranger.next('full');
      step('reconnect ok');
      // nobody presses Ready: the clock runs out and the server fights by itself
      const f = await waitFor(() => a.inbox.find((x) => x.t === 'fight'), 25000);
      assert.ok(f.summary && f.pre && f.post, 'the fight came by itself');
      await waitFor(() => b2.inbox.find((x) => x.t === 'fight'), 5000);
      for (const s of [a, b2, stranger]) s.close();
      console.log('cheating refused, reconnect and clock ok');
    }

    // ----- leaving while the opponent is disconnected: they lose, not the one who leaves (2026-11-03) -----
    {
      const code = newCode();
      const a = await phone(code, { create: true }), b = await phone(code);
      a.json({ t: 'start', settings: {} });
      await syncOf(a, (x) => x.phase === 'deploy');
      b.close();
      await waitFor(() => [...a.inbox].reverse().find((x) => (x.t === 'status' || x.t === 'sync') && x.here && !x.here[1]), 8000);
      a.json({ t: 'forfeit' });
      const ff = await a.next('forfeit', 8000);
      assert.deepStrictEqual([ff.side, ff.left], [1, 0], 'the disconnected side loses');
      a.close();
      console.log('leaving while the opponent is away: their loss');
    }

    // ----- a tournament match -----
    {
      const tcode = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      const org = await open(`${srv.ws}/tour/${tcode}`);
      org.json({ t: 'create', name: 'Test cup', orgName: 'Org', settings: { format: 'elim' } });
      const made = await org.next('created');
      const p1 = await open(`${srv.ws}/tour/${tcode}`);
      p1.json({ t: 'hello', name: 'Otto' });
      const j1 = await p1.next('joined');
      await waitFor(() => { const s = org.last('state'); return s && s.tour.players.length === 2 ? s : null; });
      org.json({ t: 'org', op: 'advance' });
      const st = await waitFor(() => { const s = org.last('state'); return s && s.tour.status === 'running' ? s : null; });
      const mt = st.tour.rounds[0].matches[0];
      const hostId = mt[mt.host || 'a'];
      const keyOf = { [made.id]: made.key, [j1.id]: j1.key };
      // the wrong key: denied
      const fake = await open(roomUrl(mt.code, tcode));
      fake.json({ t: 'hello', id: j1.id, tkey: 'nope' });
      await fake.next('denied');
      // the two players: the host is side 0
      const ph = await phone(mt.code, { id: hostId, tkey: keyOf[hostId] }, tcode);
      const otherId = hostId === made.id ? j1.id : made.id;
      const pg = await phone(mt.code, { id: otherId, tkey: keyOf[otherId] }, tcode);
      assert.deepStrictEqual([ph.welcome.side, pg.welcome.side], [0, 1]);
      await syncOf(ph, (x) => x.phase === 'deploy' && x.round === 1); // it started by itself
      // a phone can't report this match itself
      p1.json({ t: 'result', match: mt.id, game: 0, code: mt.code, winner: mt.a === j1.id ? 'a' : 'b', hp: [99, 0], rounds: 1 });
      await sleep(300);
      assert.ok(!org.last('state').tour.rounds[0].matches[0].result, 'no result from a phone');
      // the guest forfeits: the host wins, reported by the server
      pg.json({ t: 'forfeit' });
      await ph.next('forfeit');
      const done = await waitFor(() => { const s = org.last('state'); return s && s.tour.rounds[0].matches[0].result ? s : null; }, 8000);
      const result = done.tour.rounds[0].matches[0].result;
      assert.strictEqual(result.winner, mt.host || 'a', 'the host won by forfeit');
      for (const s of [org, p1, fake, ph, pg]) s.close();
      console.log('tournament match: keys checked, started by itself, result from the server');
    }
    console.log('server step 3 ok (the server referees live matches)');
  } catch (e) {
    console.log('--- server log (end) ---\n' + srv.log().slice(-4000));
    throw e;
  } finally {
    srv.stop();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
