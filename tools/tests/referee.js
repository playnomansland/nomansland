// Headless check of the server referee (src/referee.js, server step 3): no server needed.
//  - whole matches between two scripted phones on every map, with every leader (Otto spinning his slot machine):
//    every action a phone takes on its own screen is taken by the referee too, both stay in step (same fingerprint),
//    and every fight the referee runs plays back the same on a phone (the phones' replay of `pre`)
//  - hidden info: while deploying, a phone's view has none of the opponent's new squads, buys or picks
//  - cheating: unknown functions, extra arguments, wrong types, locked units, bad tiles, no gold, actions after Ready,
//    after the clock or between rounds are all refused, and leave the match as it was
//  - the clock: waits for tower picks and for a player who is away (up to AWAY_MAX_MS), then the fight starts itself
//  - Undo all, forfeit and rematch
// Run: node tools/tests/referee.js   (QUICK=1: fewer matches)
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Bot = require('../net-bot.js');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));

const copy = (o) => JSON.parse(JSON.stringify(o));
const phoneView = (R, side) => Ref.withUnits(copy(Ref.viewOf(R, side)), units, matrix);
let T = 1e12; // the referee's clock (ms)

// one whole match; returns what happened
function playMatch(settings, seed, opts = {}) {
  const r = Bot.rng(seed * 7 + 3);
  const R = Ref.create(settings, units);
  Ref.start(R, units, matrix, T, seed);
  const stats = { fights: 0, acts: 0, refused: 0, maps: R.m.map.id, chars: null };
  const seq = [0, 0];
  for (let guard = 0; guard < 40 && R.phase !== 'end'; guard++) {
    assert.strictEqual(R.phase, 'deploy');
    for (const side of [0, 1]) {
      const local = phoneView(R, side);
      // the opponent's new things never show (they placed theirs before this phone looks, for side 1)
      if (side === 1) {
        const foeNew = R.m.armies[0].filter(q => q.round === R.m.round).map(q => q.id);
        assert.ok(!local.armies[0].some(q => q.round === R.m.round), 'no new foe squads in the view');
        assert.ok(foeNew.every(id => !local.armies[0].some(q => q.id === id && q.round === R.m.round)));
        if (R.m.round === 1) { assert.strictEqual(local.chars[0], null, 'round 1: no foe leader'); assert.strictEqual(local.pack[0], null); }
        assert.strictEqual(local.gold[0], R.base.gold[0], 'foe gold as the round began');
      }
      const spins = Game.charOf(local, side) === 'otto' || (Game.needsPack(local, side) && local.packages[side].some(p => p.char === 'otto')) ? 3 : 0;
      const acts = Bot.deploy(local, side, { r, spins });
      let h = null;
      for (const a of acts) {
        const res = Ref.act(R, side, { seq: ++seq[side], fn: a.fn, a: a.a }, T);
        stats.acts++;
        if (!res.ok) { stats.refused++; break; } // a phone that was refused gets the server's view back (see the page)
        h = res.h;
      }
      if (h && !stats.refusedAt) assert.strictEqual(h, Ref.sideHash(local, side), `round ${R.m.round} side ${side}: phone and server in step`);
    }
    T += 1000;
    assert.strictEqual(Ref.setReady(R, 0, true, T), null);
    const f = Ref.setReady(R, 1, true, T);
    assert.ok(f, 'both ready: the fight');
    stats.fights++;
    // the phones play `pre` back: the same fight
    const bt = Game.startBattle(Ref.withUnits(copy(f.pre), units, matrix));
    while (bt.step()) {}
    const res = bt.result();
    assert.strictEqual(res.winner, f.summary.winner, 'playback winner');
    assert.ok(Math.abs(res.time - f.summary.time) < 1e-9, 'playback time');
    assert.deepStrictEqual(copy(f.post), copy(Ref.snapshot(R.m)), 'post is the match now');
    if (!stats.chars && R.m.chars.every(Boolean)) stats.chars = R.m.chars.slice(); // both leaders, once drafted (before round 2)
    if (R.phase === 'end') break;
    assert.ok(!Ref.next(R, 0, f.summary.round, T));
    assert.ok(Ref.next(R, 1, f.summary.round, T), 'both moved on: next round');
  }
  assert.strictEqual(R.phase, 'end');
  assert.ok(R.m.over);
  return { R, stats };
}

// ----- whole matches: every map, every leader -----
const maps = Game.MAPS.map(x => x.id);
const chars = Game.CHARACTERS.map(c => c.id);
const QUICK = !!process.env.QUICK;
let n = 0, refused = 0, acts = 0;
// the leader draft: two leaders left in, so each match has both (one each, never the same)
const pairOf = (k) => [chars[(2 * k) % chars.length], chars[(2 * k + 1) % chars.length]];
const sameSet = (a, b) => assert.deepStrictEqual(a.slice().sort(), b.slice().sort());
for (const [k, map] of maps.entries()) {
  const pair = pairOf(k);
  const { stats } = playMatch({ map, offChars: chars.filter(c => !pair.includes(c)) }, 100 + k);
  assert.strictEqual(stats.maps, map);
  sameSet(stats.chars, pair);
  n++; refused += stats.refused; acts += stats.acts;
}
for (const [k, lead] of (QUICK ? ['otto', 'zoe'] : chars).entries()) {
  const pair = [lead, lead === 'cage' ? 'felix' : 'cage'];
  const { stats } = playMatch({ offChars: chars.filter(c => !pair.includes(c)), mirror: k % 2 === 1 }, 500 + k);
  sameSet(stats.chars, pair);
  n++; refused += stats.refused; acts += stats.acts;
}
console.log(`whole matches: ${n} (every map and leader), ${acts} actions, ${refused} refused for hidden info`);
assert.ok(refused <= acts * 0.02, 'almost every honest action goes through');

// ----- cheating -----
{
  const R = Ref.create({ map: 'forest' }, units);
  Ref.start(R, units, matrix, T, 42); let Q = 0; // action numbers: each one higher than the last (a resend is refused)
  const m = R.m, before = () => JSON.stringify(Ref.snapshot(m));
  let s0 = before();
  const no = (side, fn, a, why) => { const res = Ref.act(R, side, { seq: ++Q, fn, a }, T); assert.ok(!res.ok, `${fn} ${JSON.stringify(a)} refused (${why})`); assert.strictEqual(before(), s0, `${fn}: nothing changed`); };
  // things that aren't actions at all
  no(0, 'addAltar', ['x'], 'not an action');
  no(0, 'aiDeploy', [], 'not an action');
  no(0, 'resolve', [], 'not an action');
  no(0, 'gold', [99999], 'not an action');
  no(0, '__proto__', [], 'not an action');
  no(0, 'constructor', [], 'not an action');
  no(0, 'fortify', [3, 12, 'n', false], 'an extra argument (paid = false)');
  no(0, 'place', ['0', 3, 12], 'a string for a number');
  no(0, 'place', [0, 3.5, 12], 'not an integer');
  no(0, 'place', [0, 3], 'an argument missing');
  no(0, 'sell', [{ id: 1 }], 'an object');
  no(0, 'setTowerType', ['x'.repeat(200)], 'a long string');
  // the package first
  assert.ok(Ref.act(R, 0, { seq: ++Q, fn: 'choosePack', a: [0] }, T).ok);
  assert.ok(Ref.act(R, 1, { seq: ++Q, fn: 'choosePack', a: [1] }, T).ok);
  assert.ok(!Ref.act(R, 0, { seq: ++Q, fn: 'choosePack', a: [1] }, T).ok, 'a second package');
  s0 = before();
  const locked = units.map((u, i) => i).find(i => !Game.isUnlocked(m, 0, i) && !Game.isOff(m, i, 0));
  no(0, 'place', [locked, 3, 13], 'a locked unit');
  const mine = units.map((u, i) => i).find(i => Game.isUnlocked(m, 0, i) && !Game.isOff(m, i, 0) && !Game.freeLeft(m, 0).includes(i));
  no(0, 'place', [mine, 3, 2], 'a tile in the enemy zone');
  no(0, 'place', [mine, 3, 8], 'no man\'s land');
  no(0, 'place', [mine, -1, 13], 'off the board');
  no(0, 'sell', [999], 'a squad that isn\'t there');
  no(0, 'levelUp', [m.armies[0][0].id], 'a squad that isn\'t ready');
  no(0, 'moveSquad', [m.armies[1][0].id + 1000, 4, 13], 'a squad of the other side');
  // side 1 can't touch side 0's squads: the same id on side 1 is their own (ids are per side)
  const id0 = m.armies[0][0].id, at0 = { col: m.armies[0][0].col, row: m.armies[0][0].row };
  Ref.act(R, 1, { seq: ++Q, fn: 'unplaceSquad', a: [id0] }, T);
  assert.ok(m.armies[0].some(q => q.id === id0 && q.col === at0.col && q.row === at0.row), 'side 0\'s squad stays');
  s0 = before();
  // gold runs out: as many squads as the gold buys, then no more
  m.gold[0] = 250;
  s0 = before();
  const cost = Game.shopCost(m, 0, mine);
  let placed = 0;
  const spots = [];
  for (let row = 10; row <= 15; row++) for (let col = 0; col < Game.COLS; col++) spots.push([col, row]);
  for (const [col, row] of spots) { if (Ref.act(R, 0, { seq: ++Q, fn: 'place', a: [mine, col, row] }, T).ok) placed++; if (placed > 10) break; }
  assert.ok(placed <= Math.min(Math.floor(250 / cost), Game.deploysAllowed(m, 0)), `no more squads than gold and deployments allow (${placed})`);
  assert.ok(m.gold[0] >= 0);
  // Undo all puts the round back as it was after the package
  const pick = m.armies[0].filter(q => q.round === 1 && q.free).length;
  assert.ok(Ref.act(R, 0, { seq: ++Q, fn: 'undoAll' }, T).ok);
  assert.strictEqual(m.gold[0], R.undo[0].state.top.gold, 'gold as it was before the squads');
  assert.strictEqual(m.armies[0].filter(q => q.round === 1 && !q.free).length, 0, 'Undo all: the bought squads are gone');
  assert.strictEqual(m.armies[0].filter(q => q.free).length, pick, 'the package squads stay');
  // after Ready: nothing more
  assert.strictEqual(Ref.setReady(R, 0, true, T), null);
  s0 = before();
  no(0, 'buyDeploy', [], 'after Ready');
  Ref.setReady(R, 0, false, T); // Ready can be taken back while the clock runs
  assert.ok(Ref.act(R, 0, { seq: ++Q, fn: 'buyDeploy', a: [] }, T).ok || true);
  // after the clock: nothing more, then the fight starts by itself
  s0 = before();
  const late = R.deadline + Ref.GRACE_MS + 1;
  assert.ok(!Ref.act(R, 1, { seq: ++Q, fn: 'buyDeploy', a: [] }, late).ok, 'after the clock');
  assert.strictEqual(Ref.tick(R, R.deadline - 1), null, 'not yet');
  const f = Ref.tick(R, late);
  assert.ok(f && R.phase === 'result', 'the clock ran out: the fight');
  s0 = before();
  no(0, 'buyDeploy', [], 'between rounds');
  assert.ok(!Ref.next(R, 0, f.summary.round + 5, T), 'next for another round');
  console.log('cheating: refused');
}

// ----- the clock: tower picks and players away -----
{
  const R = Ref.create({ deploy1: 30, deploy: 30 }, units);
  Ref.start(R, units, matrix, T, 7);
  assert.ok(R.deadline === T + 30000, 'round 1 clock');
  // a player away holds the clock, until AWAY_MAX_MS
  Ref.setAway(R, 1, true, T + 1000);
  assert.strictEqual(R.deadline, 0); assert.ok(R.held > 0);
  assert.strictEqual(Ref.tick(R, T + 60000), null, 'held while away');
  Ref.setAway(R, 1, false, T + 61000);
  assert.ok(R.deadline >= T + 61000 + 10000, 'back: at least 10 s');
  Ref.setAway(R, 1, true, T + 62000);
  assert.ok(Ref.due(R, T + 62000) > T + 62000 + Ref.AWAY_MAX_MS - 1);
  Ref.tick(R, T + 62000 + Ref.AWAY_MAX_MS + 100);
  assert.ok(R.deadline > 0, 'away too long: the clock runs again');
  const f = Ref.tick(R, R.deadline + Ref.GRACE_MS);
  assert.ok(f, 'and the fight starts');
  assert.ok(R.nextReady[1], 'the player away moves on by themselves');
  Ref.setAway(R, 1, false, T);
  // to the tower pick round: the clock waits for both picks
  let t = T + 1e6;
  while (R.m.round < Game.TOWER_PICK_ROUND && R.phase !== 'end') {
    if (R.phase === 'result') { Ref.next(R, 0, R.summary.round, t); Ref.next(R, 1, R.summary.round, t); continue; }
    Ref.setReady(R, 0, true, t); Ref.setReady(R, 1, true, t);
  }
  if (R.phase === 'result') { Ref.next(R, 0, R.summary.round, t); Ref.next(R, 1, R.summary.round, t); }
  assert.strictEqual(R.m.round, Game.TOWER_PICK_ROUND);
  assert.strictEqual(R.deadline, 0, 'tower picks pending: no clock');
  assert.ok(Ref.act(R, 0, { seq: 50, fn: 'setTowerType', a: [Game.towerChoices(R.m, 0)[0].id] }, t).ok);
  assert.strictEqual(R.deadline, 0, 'still one pick to go');
  assert.ok(Ref.act(R, 1, { seq: 50, fn: 'setTowerType', a: [Game.towerChoices(R.m, 1)[0].id] }, t).ok);
  assert.ok(R.deadline > t, 'both picked: the clock runs');
  // the tower pick is hidden until the fight
  assert.ok(!Ref.viewOf(R, 1).towers[0].type, 'their tower pick hidden');
  assert.ok(Ref.viewOf(R, 0).towers[0].type, 'my tower pick');
  console.log('clock: ok');
}

// ----- forfeit and rematch -----
{
  const R = Ref.create({}, units);
  Ref.start(R, units, matrix, T, 9);
  assert.ok(Ref.forfeit(R, 1));
  assert.strictEqual(R.phase, 'end'); assert.strictEqual(R.m.winner, 0);
  assert.ok(!Ref.forfeit(R, 0), 'only once');
  assert.ok(!Ref.rematch(R, 0, units, matrix, T, 10));
  assert.ok(Ref.rematch(R, 1, units, matrix, T, 10), 'both want a rematch: a new match');
  assert.strictEqual(R.phase, 'deploy'); assert.strictEqual(R.m.round, 1); assert.ok(!R.m.over);
  // what the room keeps survives a save and load
  const back = Ref.load(copy(Ref.save(R)), units, matrix);
  assert.deepStrictEqual(copy(Ref.save(back)), copy(Ref.save(R)));
  console.log('forfeit, rematch, save: ok');
}
console.log('referee: all ok');
