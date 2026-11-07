// Headless check of the 7 Nov playtest fixes, group F (School & levelling; 2026-11-07): no server needed.
//  F1: Level all (Game.levelAllPlan) spreads the levels: every ready squad gets its next level before any squad gets
//    a second one (lowest level first, then the most XP, then the oldest).
//  F2: the 2v2 School's Respec (src/mpb.js, mpbAct 'respec' from, to / 'unrespec'): the pupil's player only, a pupil
//    inside since an earlier round, an either-or skill owned since an earlier round; free (no gold, the next skill's
//    price the same), once a School a round, Undo respec gives the use back; the unit sheet's Undo refunds nothing for
//    it; hidden from the opponents until the fight; in this round's fight (unitFor); a teammate's Undo all keeps it,
//    the player's own Undo all takes it back; it stands when the School falls; the page's copy hashes as the server's.
// Run: node tools/tests/fixes-1107-F.js
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
const UI = (name) => { const i = units.findIndex(u => u.name === name); assert.ok(i >= 0, name); return i; };
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };

// ----- helpers (as tools/tests/mpb-b4.js) -----
function match(seed) {
  const D = Duo.create({}, units), T = 1e12;
  Duo.start(D, units, matrix, T, seed, [false, false, false, false]);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, T, act, m: (L) => D.lanes[L].m };
}
function next(x) {
  const { D } = x, round = D.lanes[0].m.round;
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  assert.ok(D.phase !== 'end' && D.lanes[0].m.round === round + 1, 'on to round ' + (round + 1));
}
function addKind(D, sd, kind) {
  const m = D.lanes[0].m;
  Duo.setTeams(D.lanes.map(R => R.m));
  const t = Mpb.autoSpot(m, sd, kind, null);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  const rec = Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1];
  D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
function addSq(D, L, sd, name, col0, row0) {
  const lanes = D.lanes.map(R => R.m), m = lanes[L];
  Duo.setTeams(lanes);
  const { col, row } = Mpb.homeTile([m], sd, { unit: 0 }, { col: col0, row: row0 });
  const sq = { id: m.nextId[sd]++, unit: UI(name), col, row, round: Math.max(0, m.round - 1), xp: 0, level: 0, cost: 100 };
  m.armies[sd].push(sq);
  for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
  Duo.setTeams(lanes);
  return sq;
}
const rich = (D) => { for (const R of D.lanes) { R.m.gold = [5000, 5000]; R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; } };
function pageTry(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ' allowed on the page as on the server');
  if (r.ok) assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  return r;
}
const inStep = (D) => { for (let s = 0; s < 4; s++) { const sd = Duo.SEATS[s].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, s).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[s].lane].m, sd), 'seat ' + s + ' in step'); } };
function tough(fn) {
  return () => {
    const was = Mpb.KINDS.school.hp;
    Mpb.KINDS.school.hp = 1e8;
    try { fn(); } finally { Mpb.KINDS.school.hp = was; }
  };
}

// =====================================================================
// F1: Level all spreads the levels
// =====================================================================
check('F1: Level all gives every ready squad its next level before any squad gets a second one', () => {
  const x = match(201), m = x.m(0), ui = UI('Brute'), u = m.units[ui], cost = Game.levelCost(u);
  m.armies[0] = [];
  // A: level 1 (shown "Level 2") with XP for the top level; B, C: level 0, ready (C has more XP, B is older)
  const A = { id: 50, unit: ui, col: 3, row: 12, round: 1, level: 1, xp: Game.xpNeeded(u, 1) + 5, cost: 100 };
  const B = { id: 51, unit: ui, col: 5, row: 12, round: 1, level: 0, xp: Game.xpNeeded(u, 0), cost: 100 };
  const C = { id: 52, unit: ui, col: 7, row: 12, round: 1, level: 0, xp: Game.xpNeeded(u, 0) + 3, cost: 100 };
  m.armies[0].push(A, B, C);
  const plan = (g) => { m.gold[0] = g; return Game.levelAllPlan(m, 0, ui); };
  assert.deepStrictEqual(plan(cost), [C.id], 'gold for one: the level-0 squad with the most XP');
  assert.deepStrictEqual(plan(2 * cost), [C.id, B.id], 'gold for two: both level-0 squads, not the level-1 one');
  assert.deepStrictEqual(plan(3 * cost), [C.id, B.id, A.id], 'gold for three: then the level-1 squad');
  // a squad with XP for two levels gets its second only after every ready squad (A too) got one (2026-11-07)
  C.xp = Game.xpNeeded(u, 1) + 100;
  assert.deepStrictEqual(plan(10 * cost), [C.id, B.id, A.id, C.id], 'all levels: one pass for every ready squad first');
  assert.deepStrictEqual(plan(3 * cost), [C.id, B.id, A.id], 'gold for three: A before the second level of C');
  // the reviewer's case: B (level 0) has more XP than A (level 1, ready); A still gets a level before B's second
  C.xp = Game.xpNeeded(u, 0); B.xp = Game.xpNeeded(u, 1) + 10; A.xp = Game.xpNeeded(u, 1);
  assert.deepStrictEqual(plan(2 * cost), [B.id, C.id], 'gold for two: both level 0s');
  assert.deepStrictEqual(plan(3 * cost), [B.id, C.id, A.id], 'gold for three: A, not B again');
  C.xp = Game.xpNeeded(u, 1) + 100;
  // all on one level: as before, the most XP first, then the oldest
  for (const q of [A, B, C]) { q.level = 0; q.xp = Game.xpNeeded(u, 0); }
  A.xp += 1;
  assert.deepStrictEqual(plan(3 * cost), [A.id, B.id, C.id], 'one tier: most XP, then the oldest');
  // levelAll does the plan and spends the gold
  m.gold[0] = 2 * cost + 7;
  assert.strictEqual(Game.levelAll(m, 0, ui), 2);
  assert.deepStrictEqual([A.level, B.level, C.level, m.gold[0]], [1, 1, 0, 7], 'two levels, the gold spent');
});

// =====================================================================
// F2: the School's Respec
// =====================================================================
// round 2: a School for team A, A1's Brute with Kill stack (slot 1, bought in round 2) and two squads of it on the
// board; one goes in the School in round 2; round 3: the respec (Kill stack -> Bull, slot 2)
function setup(seed) {
  const x = match(seed), { D } = x;
  next(x); // (round 2)
  const key = addKind(D, 0, 'school');
  rich(D);
  const ui = UI('Brute'), a1 = addSq(D, 0, 0, 'Brute', 5, 12);
  addSq(D, 0, 0, 'Brute', 9, 12);
  assert.ok(x.act(0, 'buySkill', ui, 1).ok, 'Kill stack bought');
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', a1.id).ok, 'a Brute goes in');
  const rec = () => Mpb.recOf(x.m(0), 0, key);
  assert.strictEqual(Mpb.schoolWhy(x.m(0), 0, rec(), 'respec', [1, 2]), 'new', 'not in the round it went in');
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'respec', 1, 2).ok, '(refused on the page and the server)');
  next(x); // (round 3)
  rich(D);
  return { x, D, key, ui, a1, rec, t: () => x.m(0).tech[0][ui] };
}

check('F2: respec swaps the either-or skill, free, once a round; Undo respec; the unit sheet\'s Undo refunds nothing', tough(() => {
  const { x, D, key, ui, rec, t } = setup(211), m = () => x.m(0);
  assert.deepStrictEqual(Mpb.respecs(m(), 0, Mpb.pupilSq(m(), 0, rec())), [{ from: 1, to: 2 }], 'the one swap open');
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'respec', 0, 1).ok, 'not a skill outside an either-or pair');
  assert.ok(!pageTry(x, 1, 'mpbAct', key, 'respec', 1, 2).ok, 'not the teammate (the pupil isn\'t theirs)');
  assert.ok(!pageTry(x, 2, 'mpbAct', key, 'respec', 1, 2).ok, 'not an opponent');
  const g = m().gold[0], price = Game.skillCost(m(), ui, 0, 0), fromRound = t()[1], round = m().round;
  assert.ok(fromRound > 0 && fromRound < round);
  const before = JSON.stringify(Game.unitFor(m(), 0, ui));
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'respec', 1, 2).ok, 'respec Kill stack -> Bull');
  assert.deepStrictEqual([t()[1], t()[2], m().gold[0], Game.skillCost(m(), ui, 0, 0)], [0, round, g, price], 'swapped, no gold, the next skill\'s price the same');
  assert.ok(Game.hasSkill(m(), 0, ui, 2) && !Game.hasSkill(m(), 0, ui, 1));
  assert.strictEqual(JSON.stringify(Game.unitFor(m(), 0, ui)), JSON.stringify(Engine.applySkills(units[ui], [Game.skillDef(m(), ui, 2)], units)), 'in this round\'s fight: the unit has Bull, not Kill stack');
  assert.notStrictEqual(JSON.stringify(Game.unitFor(m(), 0, ui)), before);
  assert.strictEqual(Mpb.schoolWhy(m(), 0, rec(), 'respec', [2, 1]), 'used', 'once a round');
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'respec', 2, 1).ok, '(refused on both)');
  assert.ok(!Game.canBuySkill(m(), 0, ui, 1), 'Kill stack can\'t be bought back (either-or)');
  assert.ok(Game.respecNow(m(), 0, ui, 2) && !pageTry(x, 0, 'undoSkill', ui, 2).ok, 'the unit sheet\'s Undo: refused (no gold that was never paid)');
  assert.strictEqual(m().gold[0], g);
  inStep(D);
  // Undo respec: back as it was, the use back
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'unrespec').ok, 'Undo respec');
  assert.deepStrictEqual([t()[1], t()[2], m().gold[0]], [fromRound, 0, g]);
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'unrespec').ok, 'nothing more to undo');
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'respec', 1, 2).ok, 'and it can respec again');
  // the pupil may leave after it; Undo respec still works then
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'leave').ok, 'taken out');
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'unrespec').ok && t()[1] === fromRound && !t()[2], 'Undo respec with the School empty');
  inStep(D);
}));

check('F2: respec refused for a skill bought this round, and while a skill bought on top needs the new one', tough(() => {
  const { x, key, ui, rec, t } = setup(212), m = () => x.m(0);
  // a this-round buy uses the normal Undo: set the tech as if Kill stack had been bought this round
  const was = t()[1];
  t()[1] = m().round;
  assert.strictEqual(Mpb.schoolWhy(m(), 0, rec(), 'respec', [1, 2]), 'skill', 'bought this round: no respec');
  assert.ok(Game.undoSkill(m(), 0, ui, 1) && m().gold[0] > 5000, '(the normal Undo refunds it)');
  m().gold[0] = 5000; t()[1] = was;
  // Rage (slot 3, Awaken: needs Kill stack or Bull) on an awakened squad: the swap still leaves it one of the two
  const q = m().armies[0].find(s => s.unit === ui && !s.school);
  q.awaken = 2;
  assert.deepStrictEqual(Mpb.respecs(m(), 0, Mpb.pupilSq(m(), 0, rec())), [{ from: 1, to: 2 }], 'an awakened squad doesn\'t stop it (needs either)');
  delete q.awaken;
  // after a respec, a skill bought since that needs the new one (as if slot 3 needed slot 2 only) holds Undo respec up
  assert.ok(x.act(0, 'mpbAct', key, 'respec', 1, 2).ok);
  const need = units[ui].skillNeeds;
  units[ui].skillNeeds = [null, null, null, [2]];
  try {
    t()[3] = m().round;
    assert.strictEqual(Mpb.schoolWhy(m(), 0, rec(), 'unrespec', []), 'held', 'Undo respec waits for the skill on top');
    t()[3] = 0;
    assert.strictEqual(Mpb.schoolWhy(m(), 0, rec(), 'unrespec', []), null);
  } finally { units[ui].skillNeeds = need; }
}));

check('F2: hidden from the opponents until the fight; the respec stands after it', tough(() => {
  const { x, D, key, ui, t } = setup(213);
  const fromRound = t()[1];
  assert.ok(x.act(0, 'mpbAct', key, 'respec', 1, 2).ok);
  for (const seat of [2]) { // B1, A1's opponent in lane 0
    const v = Duo.viewFor(D, seat).m;
    assert.deepStrictEqual([v.tech[0][ui][1], v.tech[0][ui][2]], [fromRound, 0], 'B1 still sees Kill stack, not Bull');
    assert.ok(!(v.respec && v.respec[0] && v.respec[0].length), 'and no respec record');
    const sv = Game.seenBy(W(v), 1);
    assert.ok(!Game.hasSkill(sv, 0, ui, 2));
  }
  const tv = Duo.viewFor(D, 0).m;
  assert.ok(tv.respec[0].length === 1 && tv.tech[0][ui][2] === tv.round, 'A1 sees its own');
  const pv = Game.seenBy(x.m(0), 1);
  assert.deepStrictEqual([pv.tech[0][ui][1], pv.tech[0][ui][2], pv.respec[0].length], [fromRound, 0, 0], 'Game.seenBy hides it too');
  const r = x.m(0).round;
  next(x);
  const v = Duo.viewFor(D, 2).m;
  assert.deepStrictEqual([v.tech[0][ui][1], v.tech[0][ui][2]], [0, r], 'after the fight B1 sees Bull');
  assert.ok(!Game.respecNow(x.m(0), 0, ui, 2), 'last round\'s respec is a plain skill now');
  assert.ok(!Mpb.schoolWhy(x.m(0), 0, Mpb.recOf(x.m(0), 0, key), 'respec', [2, 1]), 'and a new round, a new respec');
}));

check('F2: a teammate\'s Undo all keeps it; the player\'s own Undo all takes it back', tough(() => {
  const { x, D, key, ui, t, rec } = setup(214), m = () => x.m(0);
  const fromRound = t()[1], g = m().gold[0];
  addSq(D, 1, 0, 'Brute', 9, 13);
  assert.ok(x.act(1, 'buySkill', ui, 0).ok, 'A2 buys a skill (of their own Brutes)');
  assert.ok(x.act(0, 'mpbAct', key, 'respec', 1, 2).ok, 'A1 respecs');
  assert.ok(x.act(1, 'undoAll').ok, 'A2\'s Undo all');
  assert.deepStrictEqual([t()[1], t()[2], m().gold[0]], [0, m().round, g], 'A1\'s respec stands');
  assert.strictEqual(Mpb.schoolWhy(m(), 0, rec(), 'respec', [2, 1]), 'used', 'still used');
  assert.ok(!pageTry(x, 0, 'undoSkill', ui, 2).ok && m().gold[0] === g, 'still no refund on the unit sheet');
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'unrespec').ok && t()[1] === fromRound && !t()[2], 'Undo respec still works');
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'respec', 1, 2).ok);
  inStep(D);
  // A1's own Undo all: the swap goes back, the use with it (the pupil stays: it went in last round)
  assert.ok(x.act(0, 'undoAll').ok);
  assert.deepStrictEqual([t()[1], t()[2], m().gold[0]], [fromRound, 0, g], 'back as the round began');
  assert.ok(rec().data.pupil && !Mpb.schoolWhy(m(), 0, rec(), 'respec', [1, 2]), 'it may respec again');
  assert.ok(!Game.respecNow(m(), 0, ui));
  inStep(D);
}));

check('F2: the School destroyed in that fight: the respec stands', tough(() => {
  const { x, D, key, ui, t } = setup(215);
  assert.ok(x.act(0, 'mpbAct', key, 'respec', 1, 2).ok);
  const lanes = D.lanes.map(R => R.m), round = lanes[0].round;
  const k = Mpb.recs(lanes[0], 0).findIndex(r => r.key === key);
  Mpb.afterFight(lanes, { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } }, killedBy: [] }, [{ round }, { round }], [100, 100]);
  assert.strictEqual(Mpb.recOf(lanes[0], 0, key).data.pupil, null, 'the School fell, its pupil is out');
  assert.deepStrictEqual([t()[1], t()[2]], [0, round], 'Bull stays');
}));

if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log('\nall fixes-1107 group F checks passed');
