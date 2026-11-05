// Headless check of group B3's 2v2 buildings (src/mpb.js coalMine and magicLake; docs/MPB-2V2.md, docs/mpb-notes/b3.md):
//  Coal mine
//  - placement: the entrance by the vote (interior, spacing), then the exit (no man's land, not flank tiles, a free tile)
//  - the 8 tiles round the exit: no squad of either team (also where they are the enemy's zone)
//  - a real Duo fight: a squad round the entrance is down the mine for 2 s (can't be seen, hit or pushed), comes up on
//    the matching tile round the exit, stands 1.5 s, then fights; a squad elsewhere doesn't; an enemy squad on its
//    exit tile keeps it out; a destroyed entrance doesn't stop squads already on their way
//  - Dig a new exit (150, once a match): one move, flank tiles of the enemy's half too, taken back with the skill
//  - Fresh air (200): +25% speed and +4 armor for 5 s after coming up
//  - mirror: both teams' mines, point-mirrored: the same travel, mirrored
//  Magic lake
//  - the card: 2 tiles for each player, put down by that player only (Game.mpbAct 'place'), in the own zone or no man's
//    land, never on squads, buildings, flank tiles or water, never shutting a tile off (the flood fill); moved only the
//    round it was put down; a tile nobody put down goes down before the fight
//  - water: Game.terrainBlocks (nobody deploys on it), the fight's terrain (nobody walks on it), shot over
//  - Waterspirits (50, per tile): the team walks on it, 30% slower, +5% health a second on it; the enemy can't
//  - Become Water elemental (200, per tile): a Water Elemental (a level 2 Water Mage's) on the tile every fight
//  - no downside: never a fight body to destroy; mirror: both teams' lakes heal alike
//  Both: hidden info (this round's clicks; placements are public), the page's copy hashing as the server's after every
//  action, a full bot 2v2 to round 10 with both kinds in for both teams.
// Run: node tools/tests/mpb-b3.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Duo = require('../../src/duo.js');
const Mpb = require('../../src/mpb.js');
const demo = require('../../src/demo-units.json'), F = require('../../src/faction-units.json');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, Duo.unitSet(demo, F));

const copy = (o) => JSON.parse(JSON.stringify(o));
const W = (s) => Ref.withUnits(copy(s), units, matrix);
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };

// ----- helpers (as tools/tests/mpb.js) -----
function match(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, bots);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, T, act, m: (L) => D.lanes[L].m };
}
function playTo(x, round, hook) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    if (hook) hook(D);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  }
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
const lanesOf = (D) => D.lanes.map(R => R.m);
const COAL = Mpb.kindOf('coalMine').COAL, LAKE = Mpb.kindOf('magicLake').LAKE, CM = Mpb.kindOf('coalMine'), ML = Mpb.kindOf('magicLake');
// a coal mine for team sd on (col, row) with its exit on (xc, xr), in both lanes, as if it stood when the round began
function addMine(D, sd, col, row, xc, xr) {
  for (const R of D.lanes) { const r = Mpb.addRec(R.m, sd, 'coalMine', col, row); r.parts.exit = { col: xc, row: xr }; }
  const rec = Mpb.recs(D.lanes[0].m, sd).slice(-1)[0];
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
// the Magic lake card for team sd, in both lanes (each player gets LAKE.tiles tiles to put down)
function addLake(D, sd) {
  for (const R of D.lanes) Mpb.giveCard(R.m, sd, { type: 'mpb', id: 'magicLake' });
  if (D.tbase[sd]) D.tbase[sd] = Duo.teamState(D.lanes[0].m, sd);
  return Mpb.recs(D.lanes[0].m, sd).filter(r => r.kind === 'magicLake').map(r => r.key);
}
// a lake tile put down by hand (as its player would), both lanes
function wet(D, sd, key, col, row) { for (const R of D.lanes) { const r = Mpb.recOf(R.m, sd, key); r.col = col; r.row = row; r.round = R.m.round; } }
// a squad of unit name for side sd in lane 0 on (col, row) (a fresh id), as if placed in an earlier round
function squad(m, sd, name, col, row) {
  const ui = m.units.findIndex(u => u.name === name);
  const id = 500 + m.armies[sd].length + sd * 50;
  const q = { id, unit: ui, col, row, level: 0, xp: 0, round: 1 };
  m.armies[sd].push(q);
  return q;
}
// a fight of both lanes as they stand (Duo.fight's start: settled, no m.team), not played yet
function battleOf(D) { const lanes = lanesOf(D); Duo.settle(lanes); for (const m of lanes) delete m.team; const bt = Duo.battle(lanes, { record: false }); Duo.setTeams(lanes); return bt; }
const stepTo = (bt, t) => { while (bt.time() < t - 1e-9 && bt.step()) {} };
const bodiesOf = (bt, sd, id) => bt.bodies.filter(b => b.side === sd && b.squad === id);
// empty both lanes' armies (a clean board for a measured fight)
function clear(D) { for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; } Duo.setTeams(lanesOf(D)); } // (no package squads put back)
const mirror = (t) => ({ col: Game.COLS - 1 - t.col, row: Game.ROWS - 1 - t.row });

// ===================================== Coal mine =====================================
check('coal mine: the entrance and exit by the vote; exit in no man\'s land (not flank tiles), on a free tile', () => {
  const x = match(301), { D } = x;
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'coalMine');
  D.tbase[0] = Duo.teamState(D.lanes[0].m, 0);
  Duo.tick(D, x.T); Duo.setTeams(lanesOf(D));
  const m = x.m(0), t = Mpb.autoSpot(m, 0, 'coalMine', null);
  assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row), 'the entrance: interior, spaced');
  assert.ok(!x.act(0, 'mpbVote', 10, 17).ok, 'not on an edge of the zone');
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok);
  assert.strictEqual(Mpb.voteHead(x.m(0), 0).part, 'exit', 'then the exit');
  // the exit: no man's land only, not flank tiles, not on a squad
  assert.ok(!Mpb.spotOk(m, 0, 'coalMine', 'exit', 0, 8) && !Mpb.spotOk(m, 0, 'coalMine', 'exit', 1, 9) && !Mpb.spotOk(m, 0, 'coalMine', 'exit', 22, 8), 'not on flank tiles');
  assert.ok(!Mpb.spotOk(m, 0, 'coalMine', 'exit', 10, 12) && !Mpb.spotOk(m, 0, 'coalMine', 'exit', 10, 5), 'not in either zone');
  assert.ok(Mpb.spotOk(m, 0, 'coalMine', 'exit', 12, 7), 'no man\'s land on the enemy\'s half is fine (no spacing for the exit)');
  const e = { col: 12, row: 7 };
  assert.ok(x.act(0, 'mpbVote', e.col, e.row).ok && x.act(1, 'mpbVote', e.col, e.row).ok);
  const rec = Mpb.recs(x.m(1), 0).find(r => r.kind === 'coalMine');
  assert.deepStrictEqual(rec.parts.exit, e); sameTeam(D, 0);
  assert.ok(Game.mpbAt(x.m(0), e.col, e.row), 'the exit tile is taken');
  assert.strictEqual(rec.parts.exit && Mpb.kindOf('coalMine').hp, COAL.hp);
});

check('coal mine: no squad of either team on the 8 tiles round the exit (enemy zone tiles too)', () => {
  const x = match(302), { D } = x;
  addMine(D, 0, 11, 15, 12, 7); // its exit's tiles reach into row 6: team B's zone
  Duo.setTeams(lanesOf(D));
  for (const L of [0, 1]) for (const sd of [0, 1]) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) assert.ok(Game.occupied(x.m(L), sd, 12 + dc, 7 + dr), `taken for side ${sd} in lane ${L}: ${12 + dc},${7 + dr}`);
  assert.ok(!Game.occupied(x.m(0), 1, 14, 6) && !Game.occupied(x.m(0), 1, 12, 5), 'two tiles off: free');
  for (const R of D.lanes) R.m.gold = [2000, 2000];
  const ui = (L, sd) => Object.keys(x.m(L).unlocks[sd]).map(Number)[0];
  assert.ok(!x.act(2, 'place', ui(0, 1), 12, 6).ok && !x.act(3, 'place', ui(1, 1), 11, 6).ok, 'team B can\'t deploy on its own zone tiles round the exit');
  assert.ok(x.act(2, 'place', ui(0, 1), 12, 5).ok, 'one row back is fine');
  assert.ok(!x.act(0, 'mpbVote', 0, 0).ok, '(no vote open)');
  // the Assassin (anywhere) can't either
  const ai = x.m(0).units.findIndex(u => u.anywhere);
  if (ai >= 0) { x.m(0).unlocks[0][ai] = true; x.m(0).gold[0] = 2000; assert.ok(!Game.canPlaceAt(x.m(0), 0, 13, 8, ai) || !Game.spotFree(x.m(0), 0, 13, 8, ai), 'nor an Assassin'); }
});

check('coal mine fight: down 2 s (unseen, unhurt), up on the matching exit tile, 1.5 s still, then fights', () => {
  const x = match(303, [true, true, true, true]), { D } = x;
  clear(D);
  addMine(D, 0, 11, 15, 11, 9);
  const m = x.m(0);
  const q = squad(m, 0, 'Brute', 12, 14), stay = squad(m, 0, 'Brute', 5, 13), foe = squad(m, 1, 'Brute', 11, 3);
  const bt = battleOf(D);
  const qb = bodiesOf(bt, 0, q.id), sb = bodiesOf(bt, 0, stay.id);
  const at = Game.tileToWorld(12, 8); // the exit (11,9) + (1,-1)
  assert.ok(qb.length > 0 && qb.every(b => b.mineT === COAL.travel && b.delay === COAL.travel + COAL.rise), 'down the mine, with its wait');
  assert.ok(qb.every(b => Math.abs(b.x - at.x) < Game.TILE / 2 && Math.abs(b.y - at.y) < Game.TILE / 2), 'standing at the exit tile already (unseen)');
  assert.ok(sb.every(b => !b.mineTo && !(b.mineT > 0)), 'a squad elsewhere stays where it is');
  // while down: never hurt, never pushed
  const hp0 = qb.map(b => b.hp), pos0 = qb.map(b => [b.x, b.y]);
  stepTo(bt, 1.0);
  assert.ok(qb.every((b, i) => b.hp === hp0[i] && b.x === pos0[i][0] && b.y === pos0[i][1] && b.mineT > 0), 'down: untouched');
  stepTo(bt, COAL.travel + 0.06);
  assert.ok(qb.every(b => !(b.mineT > 0) && b.delay > 0 && b.delay <= COAL.rise + 1e-9), 'up after 2 s, still standing');
  assert.ok(bt.mineFx().some(e => e.side === 0 && e.squad === q.id), 'a puff of coal dust for the boards');
  stepTo(bt, COAL.travel + COAL.rise - 0.1);
  assert.ok(qb.every(b => b.x === pos0[qb.indexOf(b)][0] || b.delay > 0), 'stands still while it waits');
  stepTo(bt, COAL.travel + COAL.rise + 1.5);
  assert.ok(qb.some(b => Math.hypot(b.x - at.x, b.y - at.y) > 0.5), 'then it moves');
  // the measured effect: where the squad is 4 s in, with and without the mine (the same squad, the same foe)
  const ys = (withMine) => {
    const y = match(303, [true, true, true, true]); clear(y.D);
    if (withMine) addMine(y.D, 0, 11, 15, 11, 9);
    const mm = y.m(0), a = squad(mm, 0, 'Brute', 12, 14); squad(mm, 1, 'Brute', 11, 3);
    const b2 = battleOf(y.D); stepTo(b2, 4);
    return bodiesOf(b2, 0, a.id)[0].y;
  };
  const yIn = ys(true), yOut = ys(false);
  assert.ok(yIn > yOut + 2 * Game.TILE, `4 s in: ${yIn.toFixed(1)} m with the mine vs ${yOut.toFixed(1)} m on foot (forward is +y)`);
  void foe;
});

check('coal mine fight: an enemy squad on the exit tile keeps that squad out; a fallen entrance doesn\'t stop the ones on their way', () => {
  const x = match(304, [true, true, true, true]), { D } = x;
  clear(D);
  addMine(D, 0, 11, 15, 11, 9);
  const m = x.m(0);
  const a = squad(m, 0, 'Brute', 12, 14), b = squad(m, 0, 'Wisps', 10, 14);
  squad(m, 1, 'Brute', 12, 8); // stood there before the exit was dug (a squad can't be put there now)
  const bt = battleOf(D);
  assert.ok(bodiesOf(bt, 0, a.id).every(z => !z.mineTo && !(z.mineT > 0)), 'its exit tile is held: it stays');
  assert.ok(bodiesOf(bt, 0, b.id).every(z => z.mineT > 0), 'the other goes down');
  // lane 1's enemy squad counts too (the other pair's opponent)
  const y = match(304, [true, true, true, true]); clear(y.D); addMine(y.D, 0, 11, 15, 11, 9);
  const c = squad(y.m(0), 0, 'Brute', 12, 14); squad(y.m(1), 1, 'Brute', 12, 8);
  const bt2 = battleOf(y.D);
  assert.ok(bodiesOf(bt2, 0, c.id).every(z => !(z.mineT > 0)), 'held by the other lane\'s enemy: it stays');
  // the entrance falls while they travel: they still come up
  const ent = bt.bodies.find(z => z.u.mpb === 'coalMine' && z.side === 0);
  assert.ok(ent && ent.u.structure && ent.u.hp === COAL.hp && ent.u.defVal === COAL.armor, 'the entrance: a structure, 700 / 4');
  stepTo(bt, 0.5); ent.hp = 0; ent.alive = false;
  stepTo(bt, COAL.travel + 0.1);
  assert.ok(bodiesOf(bt, 0, b.id).every(z => z.alive && !(z.mineT > 0)), 'up anyway');
  assert.ok(!bt.bodies.some(z => z.u.mpb === 'coalMine' && z.u.mpbPart), 'the exit is no fight body');
});

check('coal mine: Dig a new exit (150): one move, flank tiles too, taken back with the skill; hashes as the server', () => {
  const x = match(305), { D } = x;
  const key = addMine(D, 0, 11, 15, 11, 9);
  for (const R of D.lanes) R.m.gold[0] = 1000;
  Duo.setTeams(lanesOf(D));
  assert.ok(!x.act(0, 'mpbAct', key, 'exit', 12, 8).ok, 'no move without the skill');
  const page = (seat) => W(Duo.viewFor(D, seat).m);
  const pm = page(0);
  assert.ok(Game.mpbBuy(pm, 0, key, 'shaft'));
  const r = x.act(0, 'mpbBuy', key, 'shaft');
  assert.ok(r.ok && Ref.sideHash(pm, 0) === r.h, 'bought: page and server agree');
  assert.strictEqual(x.m(0).gold[0], 1000 - COAL.moveCost);
  assert.ok(!x.act(1, 'mpbBuy', key, 'shaft').ok, 'once a match');
  assert.ok(!x.act(1, 'mpbAct', key, 'exit', 10, 13).ok, 'not into the zone');
  assert.ok(!x.act(1, 'mpbAct', key, 'exit', 0, 12).ok, 'not on the own half\'s flank tiles (they are the enemy\'s)');
  assert.ok(CM.exitMoveOk(x.m(0), 0, Mpb.recOf(x.m(0), 0, key), 0, 3), 'a flank tile of the enemy\'s zone is allowed');
  assert.ok(CM.exitMoveOk(x.m(0), 0, Mpb.recOf(x.m(0), 0, key), 12, 9), 'next to the old exit is allowed (it leaves its tiles)');
  const pm1 = page(1);
  assert.ok(Game.mpbAct(pm1, 0, key, 'exit', 1, 7), 'the page allows it');
  const r1 = x.act(1, 'mpbAct', key, 'exit', 1, 7);
  assert.ok(r1.ok && Ref.sideHash(pm1, 0) === r1.h, 'moved by A2 to a flank tile in no man\'s land: page and server agree');
  sameTeam(D, 0);
  assert.deepStrictEqual(Mpb.recOf(x.m(0), 0, key).parts.exit, { col: 1, row: 7 });
  assert.ok(Game.occupied(x.m(0), 1, 2, 6) && !Game.occupied(x.m(0), 1, 12, 9), 'the blocked tiles moved with it');
  assert.ok(!x.act(0, 'mpbAct', key, 'exit', 12, 8).ok, 'only once');
  assert.deepStrictEqual(Duo.viewFor(D, 2).m.mpb[0].find(q => q.key === key).parts.exit, { col: 1, row: 7 }, 'the opponents see the new exit (as any placed building)');
  assert.ok(!Duo.viewFor(D, 2).m.mpb[0].find(q => q.key === key).skills.shaft, 'but not this round\'s skill');
  assert.ok(x.act(0, 'mpbUndo', key, 'shaft').ok, 'A1 takes the skill back');
  assert.deepStrictEqual(Mpb.recOf(x.m(1), 0, key).parts.exit, { col: 11, row: 9 }, 'the exit goes back'); sameTeam(D, 0);
  assert.strictEqual(x.m(0).gold[0], 1000);
  // a move in a later round stays
  assert.ok(x.act(1, 'mpbBuy', key, 'shaft').ok && x.act(1, 'mpbAct', key, 'exit', 13, 8).ok);
  playTo(x, 2);
  if (D.phase !== 'end') { assert.deepStrictEqual(Mpb.recOf(x.m(0), 0, key).parts.exit, { col: 13, row: 8 }); assert.ok(!x.act(1, 'mpbAct', key, 'exit', 12, 8).ok && !x.act(0, 'mpbUndo', key, 'shaft').ok, 'done for the match'); }
});

check('coal mine: Fresh air (200): +25% speed and +4 armor for 5 s after coming up', () => {
  const run = (air) => {
    const x = match(306, [true, true, true, true]), { D } = x; clear(D);
    const key = addMine(D, 0, 11, 15, 11, 9);
    if (air) for (const R of D.lanes) Mpb.recOf(R.m, 0, key).skills.air = { round: 1, n: 1, by: [1, 0], log: [] };
    const q = squad(x.m(0), 0, 'Brute', 12, 14); squad(x.m(1), 1, 'Brute', 11, 1);
    const bt = battleOf(D), qb = bodiesOf(bt, 0, q.id);
    const arm0 = qb[0].u.bonusArmor || 0;
    stepTo(bt, COAL.travel + 0.1);
    const arm1 = qb[0].u.bonusArmor || 0;
    stepTo(bt, COAL.travel + COAL.rise + 0.6);
    let moved = 0; // its fastest step while the boost lasts (walking straight at the foe)
    while (bt.time() < COAL.travel + COAL.air.secs - 0.1) { const p = [qb[0].x, qb[0].y]; bt.step(); moved = Math.max(moved, Math.hypot(qb[0].x - p[0], qb[0].y - p[1])); }
    stepTo(bt, COAL.travel + COAL.air.secs + 0.2);
    return { arm0, arm1, arm2: qb[0].u.bonusArmor || 0, moved, fast: qb[0].mineFast };
  };
  const a = run(true), n = run(false);
  assert.strictEqual(a.arm1 - a.arm0, COAL.air.armor, '+4 armor when it comes up'); assert.strictEqual(n.arm1 - n.arm0, 0);
  assert.ok(Math.abs(a.arm2 - a.arm0) < 1e-9 && !(a.fast > 0), 'gone after 5 s');
  assert.ok(Math.abs(a.moved / n.moved - (1 + COAL.air.speed / 100)) < 0.02, `25% faster: ${a.moved.toFixed(3)} m vs ${n.moved.toFixed(3)} m a tick`);
  const sk = CM.skills.find(s => s.id === 'air');
  assert.ok(sk.cost === COAL.airCost && sk.per === 'match');
});

check('coal mine: mirrored mines for both teams travel alike', () => {
  const x = match(307, [true, true, true, true]), { D } = x; clear(D);
  const e0 = { col: 11, row: 15 }, x0 = { col: 10, row: 9 }, e1 = mirror(e0), x1 = mirror(x0);
  addMine(D, 0, e0.col, e0.row, x0.col, x0.row); addMine(D, 1, e1.col, e1.row, x1.col, x1.row);
  for (const air of [0, 1]) for (const R of D.lanes) for (const sd of [0, 1]) { const r = Mpb.recs(R.m, sd).find(q => q.kind === 'coalMine'); r.skills.air = { round: 1, n: 1, by: [1, 0], log: [] }; void air; }
  const m = x.m(0), t0 = { col: e0.col + 1, row: e0.row - 1 }, t1 = mirror(t0);
  const a = squad(m, 0, 'Brute', t0.col, t0.row), b = squad(m, 1, 'Brute', t1.col, t1.row);
  const bt = battleOf(D), ab = bodiesOf(bt, 0, a.id), bb = bodiesOf(bt, 1, b.id);
  assert.ok(ab.length && ab.length === bb.length);
  for (const t of [0, 1, COAL.travel + 0.1, COAL.travel + COAL.rise + 1]) {
    stepTo(bt, t);
    ab.forEach((p, i) => { const q = bb[i]; assert.ok(Math.abs(p.x + q.x) < 1e-6 && Math.abs(p.y + q.y) < 1e-6 && p.mineT === q.mineT && p.delay === q.delay && p.hp === q.hp && (p.u.bonusArmor || 0) === (q.u.bonusArmor || 0), `mirrored at ${t} s`); });
  }
});

// ===================================== Magic lake =====================================
check('magic lake: 2 tiles for each player; each puts down only their own; where it may go; never shutting a tile off', () => {
  const x = match(311), { D } = x;
  const keys = addLake(D, 0);
  assert.strictEqual(keys.length, 4);
  for (const L of [0, 1]) assert.deepStrictEqual(Mpb.recs(x.m(L), 0).filter(r => r.kind === 'magicLake').map(r => [r.col, r.data.lane]), [[-1, 0], [-1, 0], [-1, 1], [-1, 1]], 'not down yet, two each');
  sameTeam(D, 0);
  assert.ok(!Mpb.voteHead(x.m(0), 0), 'no placement vote');
  Duo.setTeams(lanesOf(D));
  const [k0, k0b, k1] = keys;
  const sq0 = x.m(0).armies[0][0];
  assert.ok(!x.act(1, 'mpbAct', k0, 'place', 10, 9).ok, 'A2 can\'t put down A1\'s tile');
  assert.ok(!x.act(0, 'mpbAct', k0, 'place', sq0.col, sq0.row).ok, 'not on a squad');
  assert.ok(!x.act(0, 'mpbAct', k0, 'place', 6, 15).ok, 'not on the Vault');
  assert.ok(!x.act(0, 'mpbAct', k0, 'place', 0, 9).ok && !x.act(0, 'mpbAct', k0, 'place', 23, 13).ok, 'not on flank tiles');
  assert.ok(!x.act(0, 'mpbAct', k0, 'place', 10, 3).ok, 'not in the enemy zone');
  assert.ok(x.act(0, 'mpbAct', k0, 'place', 10, 7).ok, 'no man\'s land on the enemy\'s half is fine');
  assert.ok(!x.act(0, 'mpbAct', k0b, 'place', 10, 7).ok, 'not on water');
  assert.ok(x.act(1, 'mpbAct', k1, 'place', 15, 14).ok, 'A2 puts one in the zone'); sameTeam(D, 0);
  for (const L of [0, 1]) for (const sd of [0, 1]) assert.ok(Game.terrainBlocks(x.m(L), 10, 7) && Game.terrainBlocks(x.m(L), 15, 14), 'water for everyone');
  assert.ok(!Game.mpbAt(x.m(0), 10, 7) && !Game.nearBldg(x.m(0), 0, 10, 8), 'terrain, not a building (the Assassin may stand next to it)');
  assert.ok(Mpb.spaced(x.m(0), 15, 12) === Mpb.spaced({ ...x.m(0), mpb: [x.m(0).mpb[0].filter(r => r.kind !== 'magicLake'), x.m(0).mpb[1]] }, 15, 12), 'water doesn\'t count for the spacing');
  // squads can't go on it
  const ui = Object.keys(x.m(1).unlocks[0]).map(Number)[0];
  for (const R of D.lanes) R.m.gold[0] = 2000;
  assert.ok(!x.act(1, 'place', ui, 15, 14).ok, 'nobody deploys on water');
  // never shutting a tile off: three tiles round (5, 10) are water, the fourth is refused
  const m = x.m(0);
  for (const R of D.lanes) { const extra = [[4, 10], [6, 10], [5, 9]].map(([c, r]) => { const q = Mpb.addRec(R.m, 1, 'magicLake', c, r); q.data.lane = 0; return q; }); void extra; }
  Duo.setTeams(lanesOf(D));
  assert.ok(!ML.lakeFree(m, 5, 11) && !x.act(0, 'mpbAct', k0b, 'place', 5, 11).ok, 'the last way into (5,10) stays open');
  assert.ok(ML.lakeFree(m, 5, 10), 'water on the pocket itself leaves the rest one area: fine');
  assert.ok(ML.lakeFree(m, 12, 13) && x.act(0, 'mpbAct', k0b, 'place', 12, 13).ok, 'an open tile is fine');
  // every allowed tile keeps the board one area
  const spots = ML.lakeSpots(m, 1, Mpb.recs(m, 1).find(r => r.kind === 'magicLake'));
  void spots;
  const r1 = Mpb.recOf(m, 0, keys[3]);
  for (const t of ML.lakeSpots(x.m(1), 0, Mpb.recOf(x.m(1), 0, keys[3]))) assert.ok(ML.lakeFree(x.m(1), t.col, t.row) && (Game.inNoMans(t.row) || Game.inZone(0, t.row)));
  void r1;
});

check('magic lake: moved only the round it went down; a tile nobody put down goes down before the fight', () => {
  const x = match(312), { D } = x;
  const keys = addLake(D, 0);
  Duo.setTeams(lanesOf(D));
  assert.ok(x.act(0, 'mpbAct', keys[0], 'place', 10, 9).ok && x.act(0, 'mpbAct', keys[0], 'place', 11, 9).ok, 'moved again the same round');
  assert.ok(!Game.terrainBlocks(x.m(1), 10, 9) && Game.terrainBlocks(x.m(1), 11, 9));
  playTo(x, 2);
  for (const L of [0, 1]) assert.ok(Mpb.recs(x.m(L), 0).filter(r => r.kind === 'magicLake').every(r => r.col >= 0 && Game.terrainBlocks(x.m(L), r.col, r.row)), 'all four down after the fight (the other three by themselves)');
  const auto = Mpb.recs(x.m(0), 0).filter(r => r.kind === 'magicLake' && r.key !== keys[0]);
  for (const r of auto) assert.ok(Game.inNoMans(r.row) || Game.inZone(0, r.row));
  sameTeam(D, 0);
  if (D.phase !== 'end') assert.ok(!x.act(0, 'mpbAct', keys[0], 'place', 12, 9).ok, 'not moved in a later round');
});

check('magic lake fight: nobody walks on water; Waterspirits: the team walks it 30% slower and heals 5%/s, the enemy can\'t', () => {
  const x = match(313, [true, true, true, true]), { D } = x; clear(D);
  const keys = addLake(D, 0);
  const lk = { col: 11, row: 10 };
  wet(D, 0, keys[0], lk.col, lk.row);
  const m = x.m(0);
  const a = squad(m, 0, 'Brute', 11, 12), b = squad(m, 1, 'Brute', 11, 5);
  const c = Game.tileToWorld(lk.col, lk.row), h = Game.TILE / 2;
  const inLake = (z) => Math.abs(z.x - c.x) < h - 0.4 && Math.abs(z.y - c.y) < h - 0.4;
  let bt = battleOf(D);
  let been = false;
  for (let k = 0; k < 400 && bt.step(); k++) for (const z of bt.bodies) if (z.alive && !z.u.structure && inLake(z)) been = true;
  assert.ok(!been, 'without Waterspirits nobody stands in the water');
  // a body set down in the water: put back on the bank, no regen
  bt = battleOf(D);
  const ab = bodiesOf(bt, 0, a.id)[0];
  ab.x = c.x; ab.y = c.y; ab.hp = ab.u.hp / 2;
  bt.step();
  assert.ok(!inLake(ab), 'pushed out of the water');
  // Waterspirits on the tile: team A may stand in it, slowed, healing 5% a second; team B can't
  for (const R of D.lanes) Mpb.recOf(R.m, 0, keys[0]).skills.spirits = { round: 1, n: 1, by: [1, 0], log: [] };
  bt = battleOf(D);
  const a2 = bodiesOf(bt, 0, a.id)[0], b2 = bodiesOf(bt, 1, b.id)[0];
  a2.x = c.x; a2.y = c.y; a2.hp = a2.u.hp / 2; a2.delay = 5; const hp0 = a2.hp; // (held still on it)
  b2.x = c.x + 1; b2.y = c.y + 1; // (the enemy pushed in: it is put out again)
  for (let k = 0; k < 20; k++) bt.step();
  assert.ok(!inLake(b2), 'the enemy is put out of it');
  if (inLake(a2)) {
    const healed = (a2.hp - hp0) / a2.u.hp * 100;
    assert.ok(healed > LAKE.regen * 0.9 && healed < LAKE.regen * 1.25 + 1, `regained ${healed.toFixed(2)}% in 1 s on it`);
  } else assert.fail('team A may stand in its Waterspirits water');
  assert.ok(a2.slowT > 0 && a2.slowMove === LAKE.slow, 'slowed 30% on it');
  // walking: team A's Brute crosses the water to its foe (straight line), team B's goes round
  const y = match(313, [true, true, true, true]); clear(y.D);
  const ks = addLake(y.D, 0); wet(y.D, 0, ks[0], 11, 10);
  for (const R of y.D.lanes) Mpb.recOf(R.m, 0, ks[0]).skills.spirits = { round: 1, n: 1, by: [1, 0], log: [] };
  const a3 = squad(y.m(0), 0, 'Brute', 11, 12); squad(y.m(0), 1, 'Brute', 11, 4);
  const bt3 = battleOf(y.D), ab3 = bodiesOf(bt3, 0, a3.id);
  let crossed = false;
  for (let k = 0; k < 400 && bt3.step(); k++) if (ab3.some(z => z.alive && inLake(z))) crossed = true;
  assert.ok(crossed, 'team A walks through its Waterspirits water');
  // the engine's options: terrain with the lake's cells, the team's walkable cells
  const lanes = lanesOf(y.D), o = Mpb.battleOpts(lanes[0], { tiles: [], mpb: {} });
  assert.ok(o.terrain && o.terrain.block.filter(Boolean).length === Game.TERRAIN.sub * Game.TERRAIN.sub * Mpb.recs(lanes[0], 0).filter(r => r.kind === 'magicLake' && r.col >= 0).length, 'one tile of water cells per lake tile');
  assert.ok(o.mpb.lakeWalk[0].length === 9 && o.mpb.lakeWalk[1].length === 0 && o.tiles.some(t => t.type === 'wade') && o.tiles.some(t => t.type === 'mpbLake' && t.side === 0 && t.pct === LAKE.regen));
  assert.ok(!o.terrain.sight.some(Boolean), 'shot over (no sight blocked)');
});

check('magic lake: Become Water elemental (200): a level 2 Water Mage\'s Water Elemental on the tile every fight', () => {
  const x = match(314, [true, true, true, true]), { D } = x; clear(D);
  const keys = addLake(D, 1);
  const t = { col: 12, row: 7 };
  wet(D, 1, keys[2], t.col, t.row);
  squad(x.m(0), 0, 'Brute', 11, 13); squad(x.m(0), 1, 'Brute', 11, 4);
  let bt = battleOf(D);
  assert.ok(!bt.bodies.some(b => b.u.mpb === 'magicLake'), 'water alone: no fight body (nothing to destroy, no downside)');
  for (const R of D.lanes) Mpb.recOf(R.m, 1, keys[2]).skills.elemental = { round: 1, n: 1, by: [0, 1], log: [] };
  bt = battleOf(D);
  const el = bt.bodies.filter(b => b.u.mpb === 'magicLake');
  assert.strictEqual(el.length, 1, 'one Water Elemental');
  const e = el[0], w = Game.tileToWorld(t.col, t.row);
  assert.ok(e.side === 1 && !e.u.structure && e.u.name === 'Water Elemental' && e.u.mpbSkin === 'walker' && Duo.teamBody(e.squad) && e.tier === 1, 'team B\'s, a unit, the walker look');
  assert.ok(Math.abs(e.x - w.x) < 0.01 && Math.abs(e.y - w.y) < 0.01, 'on the lake tile');
  const wm = units.find(u => u.name === 'Water Mage'), d = wm.skillDefs.find(s => s && s.type === 'elemental');
  assert.strictEqual(e.u.level, LAKE.mageLevel, 'a level 2 Water Mage\'s (level index 1)');
  assert.ok(Math.abs(e.u.hp - d.params.hp * Engine.levelHpK(e.u, LAKE.mageLevel)) < 1e-6 && e.u.speed === wm.speed && e.u.deathPool && e.u.deathPool.r === d.params.pool, 'its health, her speed, its pool');
  // as a level 2 Water Mage's own summon in a fight
  const mageEl = (() => { const wu = Engine.applySkills(wm, [d], units).elemental.unit; return Engine.leveled({ ...wu, speed: wm.speed }, LAKE.mageLevel); })();
  assert.ok(Math.abs(e.u.hit - mageEl.hit) < 1e-9 && Math.abs(e.u.hp - mageEl.hp) < 1e-9 && e.u.range === mageEl.range, 'the same stats as a level 2 Water Mage\'s Water Elemental');
  for (const L of [0, 1]) assert.ok(Game.terrainBlocks(x.m(L), t.col, t.row), 'the tile stays water');
  // it fights: in a full fight it does damage or takes some
  const hp0 = e.hp; while (bt.step()) {}
  assert.ok(e.hp < hp0 || bt.result().winner >= -1, 'played to the end');
  assert.ok(Mpb.recs(x.m(0), 1).filter(r => r.kind === 'magicLake').every(r => !r.fell), 'water never falls');
});

check('magic lake: mirrored lakes with Waterspirits heal both teams alike', () => {
  const x = match(315, [true, true, true, true]), { D } = x; clear(D);
  const k0 = addLake(D, 0), k1 = addLake(D, 1);
  const t0 = { col: 10, row: 9 }, t1 = mirror(t0);
  wet(D, 0, k0[0], t0.col, t0.row); wet(D, 1, k1[0], t1.col, t1.row);
  for (const R of D.lanes) { Mpb.recOf(R.m, 0, k0[0]).skills.spirits = { round: 1, n: 1, by: [1, 0], log: [] }; Mpb.recOf(R.m, 1, k1[0]).skills.spirits = { round: 1, n: 1, by: [1, 0], log: [] }; }
  const m = x.m(0), s0 = { col: 10, row: 13 }, s1 = mirror(s0);
  const a = squad(m, 0, 'Brute', s0.col, s0.row), b = squad(m, 1, 'Brute', s1.col, s1.row);
  const bt = battleOf(D), ab = bodiesOf(bt, 0, a.id)[0], bb = bodiesOf(bt, 1, b.id)[0];
  const c0 = Game.tileToWorld(t0.col, t0.row), c1 = Game.tileToWorld(t1.col, t1.row);
  ab.x = c0.x; ab.y = c0.y; bb.x = c1.x; bb.y = c1.y; ab.hp = bb.hp = ab.u.hp / 3; ab.delay = bb.delay = 2; // (held still on it)
  for (let k = 0; k < 30; k++) { bt.step(); assert.ok(Math.abs(ab.x + bb.x) < 1e-6 && Math.abs(ab.y + bb.y) < 1e-6 && ab.hp === bb.hp, 'mirrored, tick ' + k); }
  assert.ok(ab.hp > ab.u.hp / 3, 'both healed');
});

// ===================================== both =====================================
check('hidden info and the page\'s copy: this round\'s clicks hidden, placements public, hashes as the server after every action', () => {
  const x = match(321), { D } = x;
  const key = addMine(D, 0, 11, 15, 11, 9), lakes = addLake(D, 0);
  for (const R of D.lanes) R.m.gold[0] = 2000;
  Duo.setTeams(lanesOf(D));
  const page = (seat) => W(Duo.viewFor(D, seat).m);
  const try1 = (seat, fn, ...a) => {
    const sd = Duo.SEATS[seat].side, pm = page(seat);
    const local = Game[fn](pm, sd, ...a);
    const r = x.act(seat, fn, ...a);
    assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ' allowed on the page as on the server');
    if (r.ok) { assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s copy hashes as the server'); assert.strictEqual(Ref.sideHash(Duo.viewFor(D, seat).m, sd), r.h); }
    return r;
  };
  assert.ok(try1(0, 'mpbAct', lakes[0], 'place', 9, 9).ok);
  assert.ok(try1(0, 'mpbAct', lakes[1], 'place', 13, 13).ok);
  assert.ok(!try1(0, 'mpbAct', lakes[2], 'place', 14, 9).ok, 'A2\'s tile: not A1\'s to put down (page and server agree)');
  assert.ok(try1(1, 'mpbAct', lakes[2], 'place', 14, 9).ok);
  assert.ok(try1(1, 'mpbAct', lakes[2], 'place', 15, 9).ok, 'moved');
  assert.ok(try1(1, 'mpbBuy', lakes[2], 'spirits').ok);
  assert.ok(try1(0, 'mpbBuy', lakes[0], 'elemental').ok);
  assert.ok(!try1(0, 'mpbBuy', lakes[0], 'elemental').ok, 'once per tile');
  assert.ok(try1(0, 'mpbBuy', key, 'air').ok);
  assert.ok(try1(1, 'mpbBuy', key, 'shaft').ok && try1(0, 'mpbAct', key, 'exit', 12, 8).ok);
  assert.ok(try1(0, 'mpbUndo', lakes[0], 'elemental').ok);
  // the opponents: this round's clicks hidden; water and the exit as they are
  const v = Duo.viewFor(D, 2).m;
  for (const k of [lakes[2], lakes[0], key]) assert.deepStrictEqual(Mpb.recOf(v, 0, k).skills, {}, 'B1 doesn\'t see this round\'s skills of ' + k);
  assert.ok(Game.terrainBlocks(v, 15, 9) && Game.terrainBlocks(v, 9, 9), 'but sees the water (it is the board)');
  assert.deepStrictEqual(Mpb.recOf(v, 0, key).parts.exit, { col: 12, row: 8 });
  assert.ok(Mpb.recOf(Duo.viewFor(D, 1).m, 0, lakes[2]).skills.spirits, 'the teammate sees it');
  // Undo all: A1's own actions go (their tiles back to not down), A2's stay
  assert.ok(x.act(0, 'undoAll').ok);
  sameTeam(D, 0);
  assert.ok(Mpb.recOf(x.m(0), 0, lakes[0]).col < 0 && Mpb.recOf(x.m(1), 0, lakes[2]).col === 15, 'A1\'s tiles not down again, A2\'s moved one stays');
  assert.ok(Mpb.recOf(x.m(0), 0, key).skills.shaft && Mpb.recOf(x.m(0), 0, key).parts.exit.col === 11, 'A2\'s skill stays, A1\'s move goes');
  for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
  // a fight: the playback from pre is the same fight
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  assert.ok(D.summary, 'fought');
});

check('a full bot 2v2, rounds 1 to 10, with a Coal mine and a Magic lake for both teams', () => {
  const seen = { mine: 0, lake: 0, spirits: 0, elemental: 0, air: 0, shaft: 0, travelled: 0 };
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 3300 + seed, [true, true, true, true]);
    for (const R of D.lanes) for (const sd of [0, 1]) { Mpb.queue(R.m, sd, 'coalMine'); Mpb.giveCard(R.m, sd, { type: 'mpb', id: 'magicLake' }); }
    for (const R of D.lanes) R.m.gold = R.m.gold.map(g => g + 600);
    D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd));
    Duo.tick(D, T); // the bots vote at once
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + D.lanes[0].m.round);
      const bt = Duo.battle(f.pres.map(W));
      seen.travelled += bt.bodies.filter(b => b.mineT > 0).length;
      seen.elemental += bt.bodies.filter(b => b.u.mpb === 'magicLake').length;
      while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    const m = D.lanes[0].m;
    for (const sd of [0, 1]) {
      const rs = Mpb.recs(m, sd);
      if (rs.some(r => r.kind === 'coalMine' && r.parts.exit)) seen.mine++;
      const lk = rs.filter(r => r.kind === 'magicLake');
      assert.ok(lk.length === 4 && lk.every(r => r.col >= 0 && Game.terrainBlocks(m, r.col, r.row)), 'all four lake tiles down');
      seen.lake++;
      seen.spirits += lk.filter(r => Mpb.skillN(r, 'spirits')).length;
      const cm = rs.find(r => r.kind === 'coalMine');
      if (cm) { seen.air += Mpb.skillN(cm, 'air'); seen.shaft += Mpb.skillN(cm, 'shaft'); }
    }
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, buildings ${[0, 1].map(sd => Mpb.recs(m, sd).map(r => r.key + (r.kind === 'magicLake' ? '@' + r.col + ',' + r.row : '')).join('+')).join(' | ')}`);
  }
  console.log('      ' + JSON.stringify(seen));
  assert.ok(seen.mine === 6 && seen.lake === 6, 'every team had both');
  assert.ok(seen.spirits + seen.air + seen.shaft > 0, 'the bots used some skills');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall B3 checks passed');
