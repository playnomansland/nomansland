// Headless check of 2v2 (src/duo.js): no server needed.
//  - the wide fight: both lanes' bodies on one field, lane 1 to the right, squad ids split back exactly
//  - a 1v1 fight is unchanged by the lane offset (Game.withXOff(0) / a lane fought alone gives the same result)
//  - awareness crosses lanes: a squad near the middle fights the other lane's enemies
//  - whole matches with four bots: shared team health, both lanes resolved, results the same when played back from pre
//  - the refereed match D: seats act on their own lane only, hidden info per seat, Ready, the clock, forfeit, rematch
// Run: node tools/tests/duo.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Duo = require('../../src/duo.js');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));

const copy = (o) => JSON.parse(JSON.stringify(o));
const W = (s) => Ref.withUnits(copy(s), units, matrix);
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.message); } };

const lane = (seed) => Ref.newMatch(units, matrix, Ref.cleanSettings({ map: 'testgrid' }, units), seed);
const ui = (name) => units.findIndex(u => u.name === name);
function setup(m) { for (const sd of [0, 1]) { Game.choosePack(m, sd, 0); Game.aiDeploy(m, sd); } }

check('wide field: lane 1 to the right, ids moved and split back', () => {
  const a = lane(11), b = lane(12); setup(a); setup(b);
  const bt = Duo.battle([a, b]);
  const l0 = bt.bodies.filter(x => x.lane === 0), l1 = bt.bodies.filter(x => x.lane === 1);
  assert.ok(l0.length && l1.length);
  assert.ok(l0.every(x => x.x < 0.01), 'lane 0 on the left');
  assert.ok(l1.every(x => x.x > -0.01), 'lane 1 on the right');
  assert.ok(l1.filter(x => x.squad >= 0).every(x => x.squad >= Duo.OFF), 'lane 1 ids moved');
  while (bt.step()) {}
  const res = bt.result();
  for (const L of [0, 1]) {
    const r = Duo.laneResult(res, L, [a, b][L]);
    const m = [a, b][L];
    for (const sd of [0, 1]) for (const sq of m.armies[sd]) assert.ok(r.squads[sd + ':' + sq.id], `lane ${L} side ${sd} squad ${sq.id} has its result`);
  }
});

check('the lane offset changes nothing in 1v1', () => {
  const m = lane(21); setup(m);
  const run = (dx) => Game.withXOff(dx, () => { const bt = Game.startBattle(copy2(m)); while (bt.step()) {} return bt.result(); });
  const r0 = run(0), r1 = run(-42);
  assert.strictEqual(r0.winner, r1.winner); assert.ok(Math.abs(r0.time - r1.time) < 1e-9, 'same length'); assert.deepStrictEqual(r0.survivors, r1.survivors);
});
function copy2(m) { return W(Ref.snapshot(m)); }

check('awareness crosses the lanes', () => {
  // lane 0: only side 0 has a squad, right at the middle edge; lane 1: only side 1 has one, right at the middle edge
  const a = lane(31), b = lane(32);
  for (const m of [a, b]) for (const sd of [0, 1]) Game.choosePack(m, sd, 0);
  for (const m of [a, b]) { m.armies = [[], []]; }
  const sk = ui('Skeleton Archers');
  a.armies[0].push({ id: 900, unit: sk, col: 13, row: 11, round: a.round, xp: 0, level: 0, cost: 0 });
  b.armies[1].push({ id: 901, unit: sk, col: 0, row: 6, round: b.round, xp: 0, level: 0, cost: 0 });
  const bt = Duo.battle([a, b]);
  while (bt.step()) {}
  const res = bt.result();
  const lA = res.squads['0:900'], lB = res.squads['1:' + (901 + Duo.OFF)];
  assert.ok(lA && lB, 'both squads in the result');
  assert.ok(lA.dealt > 0 || lB.dealt > 0, 'they fought each other across the lanes');
});

check('whole matches with four bots: team health, determinism', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12;
    Duo.start(D, units, matrix, T, seed, [true, true, true, true]);
    assert.strictEqual(D.phase, 'deploy');
    let rounds = 0;
    while (D.phase !== 'end' && rounds < 40) {
      T += 1000;
      const f = Duo.tick(D, T + 200000);
      assert.ok(f, 'the clock starts the fight');
      // a phone plays it back from pre: the same result
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      const res = bt.result();
      assert.strictEqual(res.winner, f.summaries[0].duo.winner, 'playback: same winner');
      assert.deepStrictEqual(D.lanes[0].m.hp, D.hp); assert.deepStrictEqual(D.lanes[1].m.hp, D.hp);
      assert.deepStrictEqual(f.summaries[0].dmg, f.summaries[1].dmg, 'both lanes show the team damage');
      rounds++;
      if (D.phase === 'result') { for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T); assert.strictEqual(D.phase, 'deploy'); }
    }
    assert.strictEqual(D.phase, 'end');
    assert.ok(D.hp[0] <= 0 || D.hp[1] <= 0);
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, winner ${D.lanes[0].m.winner}`);
  }
});

check('refereed: own lane only, hidden info, Ready, forfeit', () => {
  const D = Duo.create({}, units);
  let T = 1e12;
  Duo.start(D, units, matrix, T, 77, [false, false, false, false]);
  // each seat picks its package in its own lane
  for (let k = 0; k < 4; k++) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok, 'seat ' + k + ' picks');
  // seat 0 places something; seat 1 (teammate, other lane) sees it in mate; seat 2 (opponent, same lane) doesn't
  const m0 = D.lanes[0].m, before = m0.armies[0].length;
  const pick = m0.armies[0][0];
  const spot = (() => { for (const row of Game.zoneRows(0)) for (let c = 0; c < Game.COLS; c++) if (Game.canPlaceAt(m0, 0, c, row, pick.unit)) return [c, row]; })();
  const r = Duo.act(D, 0, { seq: 2, fn: 'place', a: [pick.unit, spot[0], spot[1]] }, T);
  assert.ok(r.ok, 'seat 0 places');
  assert.strictEqual(m0.armies[0].length, before + 1);
  const v1 = Duo.viewFor(D, 1), v2 = Duo.viewFor(D, 2);
  assert.strictEqual(v1.mate.armies[0].length, before + 1, 'the teammate sees it');
  assert.ok(!v2.m.armies[0].some(q => q.round === m0.round && q.col === spot[0] && q.row === spot[1] && q.id >= before + 100), 'opponent: hidden');
  assert.ok(v2.m.armies[0].length <= before, 'opponent: new squad hidden');
  // Ready: the fight waits for all four
  for (let k = 0; k < 3; k++) assert.strictEqual(Duo.setReady(D, k, true, T), null);
  assert.ok(!Duo.act(D, 0, { seq: 3, fn: 'unplaceSquad', a: [0] }, T).ok, 'no actions after Ready');
  const f = Duo.setReady(D, 3, true, T);
  assert.ok(f && f.summaries.length === 2, 'all ready: fight');
  assert.strictEqual(D.phase, 'result');
  for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  assert.strictEqual(D.phase, 'deploy');
  // forfeit: seat 3's team (B) loses
  assert.ok(Duo.forfeit(D, 3));
  assert.strictEqual(D.lanes[0].m.winner, 0); assert.strictEqual(D.lanes[1].m.winner, 0); assert.strictEqual(D.phase, 'end');
  // rematch once every human asks
  for (let k = 0; k < 3; k++) assert.strictEqual(Duo.rematch(D, k, units, matrix, T, 5), false);
  assert.ok(Duo.rematch(D, 3, units, matrix, T, 5)); assert.strictEqual(D.phase, 'deploy');
  // save / load
  const back = Duo.load(copy(Duo.save(D)), units, matrix);
  assert.deepStrictEqual(Ref.snapshot(back.lanes[1].m), Ref.snapshot(D.lanes[1].m));
});

check('the clock waits for a player who is away, then goes on', () => {
  const D = Duo.create({}, units);
  let T = 1e12;
  Duo.start(D, units, matrix, T, 9, [false, true, true, true]);
  Duo.act(D, 0, { seq: 1, fn: 'choosePack', a: [0] }, T);
  assert.ok(D.deadline > T);
  Duo.setAway(D, 0, true, T + 1000);
  assert.strictEqual(D.deadline, 0, 'held while away');
  assert.strictEqual(Duo.tick(D, T + 5000), null);
  const f = Duo.tick(D, T + 1000 + Ref.AWAY_MAX_MS + 100000);
  assert.ok(f || D.deadline, 'goes on after AWAY_MAX_MS');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
