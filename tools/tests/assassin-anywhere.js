// Headless check of the Assassin changes of 2026-11-06 (docs/MPB-2V2.md, "Global fixes"):
//  - placement: any free tile of the board from round 1 (own zone, no man's land, the enemy's zone, flank tiles), not on
//    or next to a building (both towers, treasuries, buildings, MPBs through Game.mpbAt); an opponent's building counts
//    only once that player may see it; moves follow the same rule; the referee takes the same placements
//  - hidden info: one put in the enemy zone this round isn't in the opponent's view until the fight, and they may put a
//    squad on that very tile; from the next round on it holds the tile
//  - in its first fight one in the enemy zone or on a flank tile stands still FLANK.delay s
//  - it ignores the tower and every building while an enemy unit can be picked (a wall in its way it hits), and with
//    nothing else left it attacks after all
//  - Bloodrush: 3 bleed stacks a hit
// Run from the repo root: node tools/tests/assassin-anywhere.js
const assert = require('assert');
const Game = require('../../src/game.js');
const E = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const demo = require('../../src/demo-units.json');
const ui = (name) => { const i = demo.units.findIndex(u => u.name === name); assert.ok(i >= 0, name); return i; };
const AS = ui('Assassin'), BR = ui('Brute');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };

// a match on map `map`, both towers down, both packages taken, lots of gold, the Assassin and the Brute unlocked
function match(map = 'standard', round = 1) {
  const m = Game.createMatch(demo.units, demo.matrix, 7, map);
  Game.ensureTower(m, 0); Game.ensureTower(m, 1); Game.ensurePack(m, 0); Game.ensurePack(m, 1);
  m.round = round; m.gold = [5000, 5000];
  for (const sd of [0, 1]) { m.unlocks[sd][AS] = 1; m.unlocks[sd][BR] = 1; m.extraDeploys[sd] = 5; }
  return m;
}
const around = (col, row) => { const out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push([col + dc, row + dr]); return out; };

assert.ok(demo.units[AS].anywhere && demo.units[AS].noBldg, 'the Assassin carries anywhere and noBldg');
assert.ok(!demo.units.some((u, i) => i !== AS && (u.anywhere || u.noBldg)), 'no other unit does');

// ----- placement -----
{
  const m = match();
  const t1 = m.towers[1], t0 = m.towers[0];
  // the enemy's zone, no man's land, flank tiles (theirs and ours), in round 1
  for (const [col, row, what] of [[3, 2, 'the enemy zone'], [5, 0, 'the enemy back row'], [4, 8, 'no man\'s land'], [0, 3, 'a flank tile, round 1'], [11, 12, 'a flank tile the enemy reserved in our zone'], [3, 13, 'our own zone']]) {
    assert.ok(Game.canPlaceAt(m, 0, col, row, AS), `Assassin: ${what} (${col}, ${row})`);
  }
  assert.ok(!Game.canPlaceAt(m, 0, 3, 2, BR), 'a Brute can\'t go to the enemy zone');
  assert.ok(!Game.canPlaceAt(m, 0, 0, 3, BR), '...nor to a flank tile in round 1');
  // not on or next to a tower, either side's
  for (const t of [t0, t1]) for (const [c, r] of around(t.col, t.row)) if (c >= 0 && c < Game.COLS) assert.ok(!Game.canPlaceAt(m, 0, c, r, AS), `next to a tower (${c}, ${r})`);
  assert.ok(Game.canPlaceAt(m, 0, t1.col - 2, t1.row, AS) && Game.canPlaceAt(m, 0, t1.col, t1.row + 2, AS), 'two tiles off the tower is fine');
  // it really goes there, through place (gold, deployments) and through the referee
  const sq = Game.place(m, 0, AS, 3, 2);
  assert.ok(sq && sq.col === 3 && sq.row === 2, 'placed in the enemy zone');
  assert.ok(!Game.place(m, 0, BR, 3, 2), 'its tile is taken for its own side');
  assert.ok(Game.moveSquad(m, 0, sq.id, 2, 3), 'moved within the enemy zone (this round: free)');
  assert.ok(!Game.moveSquad(m, 0, sq.id, t1.col - 1, t1.row), 'not moved next to the tower');
  assert.ok(Game.moveSquad(m, 0, sq.id, 3, 2), 'and back');
}
// a treasury (Standard / testgrid) and a building, an MPB through Game.mpbAt
{
  const m = match('testgrid');
  for (const sd of [0, 1]) { const t = Game.treasurySpot(m, sd); for (const [c, r] of around(t.col, t.row)) assert.ok(!Game.canPlaceAt(m, 0, c, r, AS), `next to treasury ${sd} (${c}, ${r})`); }
  // the opponent's building: hidden while it is new (it was put down this round), counted from the next round on
  m.buildings = [[], [{ id: 'factory', col: 6, row: 3, round: 1, progress: 0, built: false, xp: 0, level: 0 }]];
  assert.ok(Game.canPlaceAt(m, 0, 6, 4, AS), 'next to their new building: allowed (they put it down this round, we can\'t see it)');
  assert.ok(!Game.canPlaceAt(m, 1, 6, 4, AS), '...but not for its owner');
  m.round = 2;
  assert.ok(!Game.canPlaceAt(m, 0, 6, 4, AS) && !Game.canPlaceAt(m, 0, 7, 2, AS), 'from the next round on it counts');
  // MPBs (2v2): src/mpb.js replaces Game.mpbAt
  const was = Game.mpbAt;
  assert.strictEqual(Game.mpbAt(m, 2, 8), false, 'the stub: no MPBs');
  Game.mpbAt = (mm, col, row) => col === 2 && row === 8;
  assert.ok(!Game.canPlaceAt(m, 0, 3, 9, AS) && !Game.canPlaceAt(m, 0, 2, 8, AS) && Game.canPlaceAt(m, 0, 4, 9, AS), 'not on or next to an MPB');
  Game.mpbAt = was;
}
// ----- hidden info -----
{
  const m = match();
  const sq = Game.place(m, 0, AS, 3, 2);
  assert.ok(sq);
  const v = Ref.view(m, 1, true);
  assert.ok(!v.armies[0].some(q => q.id === sq.id), 'not in the opponent\'s view while deploying');
  assert.ok(!Game.seenBy(m, 1).armies[0].some(q => q.id === sq.id), 'nor in seenBy');
  assert.ok(!Game.enemyHolds(m, 1, 3, 2), 'its tile isn\'t held as they see it');
  assert.ok(Game.canPlaceAt(m, 1, 3, 2, BR) && Game.place(m, 1, BR, 3, 2), 'they may put a squad on that very tile (shared: the fight starts them close)');
  assert.ok(Ref.view(m, 1, false).armies[0].some(q => q.id === sq.id), 'the fight shows it');
  m.round = 2;
  assert.ok(Ref.view(m, 1, true).armies[0].some(q => q.id === sq.id), 'next round they see it');
  assert.ok(!Game.canPlaceAt(m, 1, 3, 2, BR), '...and its tile is held');
}
// ----- the referee takes it (the same Game rules) -----
{
  const { units, matrix } = require('../../server/src/prepare-units.cjs')(E, demo);
  const R = Ref.create({ map: 'standard' }, units);
  Ref.start(R, units, matrix, 1e12, 5);
  const m = R.m;
  assert.ok(Ref.act(R, 0, { seq: 1, fn: 'choosePack', a: [0] }, 1e12).ok && Ref.act(R, 1, { seq: 1, fn: 'choosePack', a: [0] }, 1e12).ok);
  m.gold[0] = 5000; m.unlocks[0][AS] = 1;
  const t1 = m.towers[1];
  assert.ok(!Ref.act(R, 0, { seq: 2, fn: 'place', a: [AS, t1.col - 1, t1.row + 1] }, 1e12).ok, 'referee: next to their tower refused');
  assert.ok(Ref.act(R, 0, { seq: 3, fn: 'place', a: [AS, 2, 2] }, 1e12).ok, 'referee: the enemy zone allowed');
  assert.ok(!Ref.viewOf(R, 1).armies[0].some(q => q.unit === AS), 'referee: hidden from the opponent');
}
// ----- the flank delay in its first fight -----
{
  const m = match();
  const deep = Game.place(m, 0, AS, 3, 2), home = Game.place(m, 0, AS, 3, 13), flank = Game.place(m, 0, AS, 0, 6), mine = Game.place(m, 0, AS, 11, 12);
  assert.ok(deep && home && flank && mine);
  const delay = (sq) => Game.bodiesFor(m, 0).find(b => b.squad === sq.id).delay || 0;
  assert.strictEqual(delay(deep), Game.FLANK.delay, 'in the enemy zone: the flank delay');
  assert.strictEqual(delay(flank), Game.FLANK.delay, 'on a flank tile: the flank delay');
  assert.strictEqual(delay(mine), Game.FLANK.delay, 'on a flank tile on our side (the enemy\'s): the flank delay');
  assert.strictEqual(delay(home), 0, 'in its own zone: none');
  assert.strictEqual(delay(Game.place(m, 0, AS, 5, 8)), 0, 'in no man\'s land: none');
  m.round = 2;
  assert.strictEqual(delay(deep), 0, 'only in its first fight');
  // a Brute on a flank tile still gets it, as before
  m.round = 3; const br = Game.place(m, 0, BR, 0, 4);
  assert.ok(br && delay(br) === Game.FLANK.delay, 'flank squads as before');
}
// ----- it ignores buildings -----
{
  const ass = () => ({ ...demo.units[AS], cost: demo.units[AS].cost });
  const body = (u, side, x, y, sq) => E.buildSquad(u, side, x, y, sq, 6)[0];
  const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
  for (const mode of [undefined, 'indexed']) { // the fast paths give the same
    const o = mode ? { targetingMode: mode } : {};
    // the tower, the treasury, a building next to it: all walked past for the unit beyond
    const a = body(ass(), 0, 0, -1.5, 1), tw = body(dummy(3000, { structure: true }), 1, 0, 0, 90), tr = body(dummy(3000, { structure: true, lesser: true }), 1, 2, 0, 91), bd = body(dummy(3000, { structure: true, lesser: true, building: 'factory' }), 1, -2, 0, 92), far = body(dummy(1e5), 1, 0, 25, 93);
    const bt = E.createBattle([a], [tw, tr, bd, far], G, o);
    steps(bt, 8);
    assert.ok(tw.hp === 3000 && tr.hp === 3000 && bd.hp === 3000 && far.hp < far.u.hp, `${mode || 'reference'}: buildings left alone, the unit hit`);
    // nothing else it could pick (a stealthed unit far off): it hits the building after all
    const b = body(ass(), 0, 0, -1.5, 1), tw2 = body(dummy(3000, { structure: true }), 1, 0, 0, 90), hid = body(dummy(1e5, { stealth: true }), 1, 0, 40, 94);
    const bt2 = E.createBattle([b], [tw2, hid], G, o);
    steps(bt2, 6);
    assert.ok(tw2.hp < 3000, `${mode || 'reference'}: with nothing else left it attacks the tower (${3000 - tw2.hp})`);
    // a Bastion wall in its way (the unit behind it beyond its dash): it breaks the wall rather than freeze in front
    // of it, then gets through (without the wall rule it stood at the wall all fight)
    const c = body(ass(), 0, 0.5, -10, 1), wall = body(Game.bwallUnit('n'), 1, 0, 0, 95), v = body(dummy(1e5), 1, 0, 14, 96);
    const bt3 = E.createBattle([c], [wall, v], G, o);
    steps(bt3, 30);
    assert.ok(!wall.alive, `${mode || 'reference'}: the wall in its way is broken (${Game.BWALL.hp - wall.hp})`);
    assert.ok(v.hp < v.u.hp, `${mode || 'reference'}: and it gets to the unit behind it (${v.u.hp - v.hp})`);
    // a wall off to the side it leaves alone
    const d = body(ass(), 0, 0.5, -10, 1), side = body(Game.bwallUnit('n'), 1, 9, 0, 95), v2 = body(dummy(1e5), 1, 0, 14, 96);
    const bt4 = E.createBattle([d], [side, v2], G, o);
    steps(bt4, 10);
    assert.ok(side.hp === side.u.hp && v2.hp < v2.u.hp, `${mode || 'reference'}: a wall not in its way is left alone`);
  }
}
// ----- Bloodrush: 3 stacks a hit -----
{
  const u = demo.units[AS];
  assert.strictEqual(u.bleedHit, 3);
  assert.ok(/3 bleed/.test(u.trait3.text), 'its trait says 3');
  const a = E.buildSquad(u, 0, 0, -1.5, 1, 6)[0], v = E.buildSquad(E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp: 1e5, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true }), 1, 0, 0, 2, 6)[0];
  const bt = E.createBattle([a], [v], G);
  for (let k = 0; k < 200 && v.hp === v.u.hp; k++) bt.step();
  assert.ok(v.bleed && v.bleed.n === Math.min(3, E.BLEED.max), `3 stacks from one hit (${v.bleed && v.bleed.n})`);
}
// ----- the AI: it keeps placing Assassins, sometimes on the enemy's back rows, always on tiles the rules allow -----
{
  let deep = 0, placed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const m = match('standard', 2); m.seed = seed;
    m.off = demo.units.map((u, i) => i).filter(i => i !== AS); // only Assassins to buy
    const rec = [];
    Game.aiDeploy(m, 0, rec);
    for (const q of m.armies[0].filter(q => q.unit === AS && q.round === m.round)) { placed++; if (Game.inZone(1, q.row)) deep++; }
    for (const a of rec.filter(a => a.fn === 'place')) assert.ok(a.a[0] === AS, 'only Assassins');
  }
  assert.ok(placed > 0 && deep > 0 && deep < placed, `the AI places Assassins (${placed}), some deep in the enemy zone (${deep})`);
}
console.log('assassin-anywhere ok');
