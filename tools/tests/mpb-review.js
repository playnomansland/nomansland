// Headless checks of the fixes after the 2v2 buildings integration review (6 Nov 2026; docs/MPB-2V2.md, PATCH-NOTES
// 6 November "Fixes after review"). Each check is a finding the reviewers' probes showed:
//  - Impersonate on a squad in a Tree kojja's Nest, or on a horse with a rider: the riders step out (not lost)
//  - a Shadow Den destroyed while its Shadowhands is jailed this round: the same outcome whichever side is side 0
//  - Impersonate: no target held in a Jail; a target that sat the fight out in its School: the gold back
//  - the opponents' view doesn't change with a hidden buy (a repeat click's round, empty data keys, bwalls)
//  - a hidden Grow click doesn't stop the deploy clock
//  - Second wind keeps its squad's unit type (an id used again after Undo all is no target)
//  - "if things are placed on the same tile, they find another spot close to it" (Vilhelm): a vote on a tile with a
//    hidden enemy squad (page and server agree; the building moves at the fight), two squads on one tile (the newer
//    moves), a teammate's Undo all onto a tile taken meanwhile (a Nest too), a lake tile on a hidden squad (the nearest
//    tile to the one chosen)
//  - artifacts never on a building's tile or one a Coal mine's exit keeps free; Dig a new exit not next to one
// Run: node tools/tests/mpb-review.js
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
const ui = (name) => { const i = units.findIndex(u => u.name === name); if (i < 0) throw new Error('no unit ' + name); return i; };
const lanesOf = (D) => D.lanes.map(R => R.m);
const teams = (D) => Duo.setTeams(lanesOf(D));

function match(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, bots);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, T, act, m: (L) => D.lanes[L].m };
}
function playTo(x, round) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  }
}
// a building of kind at t (or autoSpot) in both lanes, as if it stood when the round began
function put(D, sd, kind, t) {
  teams(D);
  t = t || Mpb.autoSpot(D.lanes[0].m, sd, kind, null);
  assert.ok(t, 'room for ' + kind);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  const rec = Mpb.recs(D.lanes[0].m, sd).slice(-1)[0];
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
function owned(D, sd, key, id) {
  for (const st of [...D.lanes.map(R => R.m.mpb[sd]), D.tbase[sd] && D.tbase[sd].mpb]) { if (!st) continue; const r = st.find(q => q.key === key); r.skills[id] = { round: 0, n: 1, by: [1, 0], log: [] }; }
}
// a squad of an earlier round in lane L (exact: on that very tile, else the nearest free one)
function addSq(D, L, sd, name, col, row, extra = {}) {
  const lanes = lanesOf(D), m = lanes[L];
  teams(D);
  if (!extra.exact) { const t = Mpb.homeTile([m], sd, { unit: 0 }, { col, row }); col = t.col; row = t.row; }
  delete extra.exact;
  const sq = { id: m.nextId[sd]++, unit: ui(name), col, row, round: Math.max(0, m.round - 1), xp: 0, level: 0, cost: 100, ...extra };
  m.armies[sd].push(sq);
  for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
  teams(D);
  return sq;
}
const rich = (D) => { for (const R of D.lanes) { R.m.gold = [5000, 5000]; R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; } };
const clearArmies = (D) => { for (const R of D.lanes) { R.m.armies = [[], []]; R.m.artifacts = null; } teams(D); };
const fresh = (D) => { D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd)); D.tlog = [[], []]; for (let k = 0; k < 4; k++) Duo.stamp(D, k, true); };
function battleNow(D) { const lanes = lanesOf(D); Duo.settle(lanes); for (const m of lanes) delete m.team; return Duo.battle(lanes); }
const steps = (bt, secs) => { for (let k = 0; k < Math.round(secs / Game.SETTINGS.dt); k++) if (!bt.step()) return false; return true; };
// the page's copy (the seat's view) runs the action too: allowed the same; hashes as the server's
function try1(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ': allowed on the page as on the server (' + r.why + ')');
  if (r.ok) assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  return r;
}
const oppView = (D, seat) => { const v = copy(Duo.viewFor(D, seat).m); delete v.team; return JSON.stringify(v); };

// =================================== the fight ===================================
check('Impersonate on a squad in a Tree kojja\'s Nest: one body goes, the rest of the squad steps out and fights', () => {
  const x = match(21), { D } = x;
  playTo(x, 2); clearArmies(D); rich(D);
  const tk = put(D, 0, 'treeKojja'); owned(D, 0, tk, 'nest');
  const k = Mpb.recOf(x.m(0), 0, tk);
  const sq = addSq(D, 0, 0, 'Skeleton Archers', k.col, k.row, { exact: true });
  const den = put(D, 1, 'shadowDen');
  addSq(D, 0, 1, 'Brute', 12, 1);
  fresh(D);
  assert.ok(x.act(2, 'mpbBuy', den, 'impersonate', 0, sq.id).ok, 'B1 impersonates the archers in the Nest');
  const bt = battleNow(D), mine = () => bt.bodies.filter(b => b.side === 0 && b.squad === sq.id);
  assert.ok(mine().filter(b => b.boarded).length === units[sq.unit].bodies - 1, 'one body in the kojja, the rest ride in it');
  steps(bt, Mpb.DEN.impAt + 0.2);
  assert.strictEqual(bt.bodies.filter(b => b.impersonated).length, 1, 'one Shadowhand');
  assert.ok(!mine().some(b => b.boarded), 'nobody left inside a body that is gone');
  assert.strictEqual(mine().filter(b => b.alive).length, units[sq.unit].bodies - 1, 'the other bodies fight on');
});

check('Impersonate on a horse with a rider: the horse goes, the rider steps out', () => {
  const x = match(22), { D } = x;
  playTo(x, 2); clearArmies(D); rich(D);
  const horse = addSq(D, 0, 0, 'Just a horse', 11, 14), rider = addSq(D, 0, 0, 'Brute', horse.col, horse.row, { exact: true, in: horse.id });
  const den = put(D, 1, 'shadowDen');
  addSq(D, 0, 1, 'Brute', 12, 1);
  fresh(D);
  assert.ok(x.act(2, 'mpbBuy', den, 'impersonate', 0, horse.id).ok);
  const bt = battleNow(D), of = (id) => bt.bodies.filter(b => b.side === 0 && b.squad === id);
  assert.ok(of(rider.id).every(b => b.boarded), 'riding at first');
  steps(bt, Mpb.DEN.impAt + 0.2);
  assert.ok(of(horse.id).every(b => !b.alive), 'the horse is taken');
  assert.ok(of(rider.id).every(b => b.alive && !b.boarded), 'its rider fights on foot');
});

check('A Shadow Den destroyed with its Shadowhands jailed this round: the same outcome whichever team is side 0', () => {
  const SH = units.findIndex(u => u.mpbUnit === 'shadowDen');
  const out = [1, 0].map(denSide => {
    const jailSide = 1 - denSide, x = match(31), { D } = x;
    playTo(x, 2); clearArmies(D); rich(D);
    const den = put(D, denSide, 'shadowDen'), jail = put(D, jailSide, 'jail');
    const hands = addSq(D, 0, denSide, 'Shadowhands', 11, Game.zoneRows(denSide)[1]);
    fresh(D);
    const g0 = x.m(0).gold[jailSide];
    assert.ok(x.act(Duo.seatOf(0, jailSide), 'mpbBuy', jail, 'jail', 0, hands.id).ok, 'the Shadowhands is jailed');
    const lanes = lanesOf(D), k = Mpb.recs(lanes[0], denSide).findIndex(q => q.key === den), sums = lanes.map(m => ({ round: m.round }));
    Mpb.afterFight(lanes, { squads: { [denSide + ':' + Mpb.squadOf(k)]: { side: denSide, squad: Mpb.squadOf(k), total: 1, alive: 0 } } }, sums, [200, 200]);
    return { gold: lanes[0].gold[jailSide] - g0, cells: (Mpb.recOf(lanes[0], jailSide, jail).data.cells || []).length, hands: lanes[0].armies[denSide].filter(q => q.unit === SH).length };
  });
  assert.deepStrictEqual(out[0], out[1], 'mirrored, the same: ' + JSON.stringify(out));
  assert.deepStrictEqual(out[0], { gold: 0, cells: 0, hands: 0 }, 'the Shadowhands are lost, the jailer gets the 100 back, no cell left');
});

check('Impersonate: a squad in your own Jail is no target; one that sat the fight out in its School gives the gold back', () => {
  for (const lane of [0, 1]) {
    const x = match(51 + lane), { D } = x;
    playTo(x, 2); clearArmies(D); for (const R of D.lanes) { R.m.gold = [800, 800]; R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; }
    const sch = put(D, 0, 'school'), den = put(D, 1, 'shadowDen');
    const sq = addSq(D, lane, 0, 'Skeleton Archers', 11, 15);
    addSq(D, 0, 0, 'Brute', 5, 18); addSq(D, 0, 1, 'Brute', 12, 1);
    fresh(D);
    assert.ok(x.act(Duo.seatOf(lane, 0), 'mpbAct', sch, 'enroll', sq.id).ok, 'enrolled this round (the opponents still see it on its tile)');
    const who = lane === 0 ? 0 : 1;
    assert.ok(try1(x, 2, 'mpbBuy', den, 'impersonate', who, sq.id).ok, 'B1 may impersonate it (page and server agree)');
    const g = x.m(0).gold[1];
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    const n = D.summary[0].mpbNews[1].find(q => q.kind === 'shadowDen' && q.back);
    assert.ok(n, 'a results line says so');
    assert.ok(x.m(0).gold[1] >= g + Mpb.DEN.impersonate, 'B1 gets the 200 back');
  }
  // jailed in the buyer's own team's Jail: not offered (page and server alike)
  const x = match(53), { D } = x;
  playTo(x, 3); rich(D);
  const jail = put(D, 0, 'jail'), den = put(D, 0, 'shadowDen');
  fresh(D);
  teams(D);
  const t = Mpb.impTargets(x.m(0), 0).find(q => q.who === 0);
  assert.ok(t, 'a target to start with');
  assert.ok(x.act(0, 'mpbBuy', jail, 'jail', 0, t.id).ok);
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  const q = x.m(0).armies[1].find(s => s.id === t.id);
  assert.ok(q && q.jailed, 'locked up');
  teams(D);
  for (const v of [x.m(0), W(Duo.viewFor(D, 0).m)]) assert.ok(!Mpb.impTargets(v, 0).some(z => z.who === 0 && z.id === t.id), 'no longer an Impersonate target');
  assert.ok(!x.act(0, 'mpbBuy', den, 'impersonate', 0, t.id).ok, 'refused');
});

check('The Nest takes one squad\'s bodies only (two squads on its tile never become one carrier)', () => {
  const x = match(61), { D } = x;
  playTo(x, 2); clearArmies(D); rich(D);
  const tk = put(D, 0, 'treeKojja'); owned(D, 0, tk, 'nest');
  const k = Mpb.recOf(x.m(0), 0, tk);
  const a = addSq(D, 0, 0, 'Skeleton Archers', k.col, k.row, { exact: true }), b = addSq(D, 1, 0, 'Skeleton Archers', k.col, k.row, { exact: true });
  addSq(D, 0, 1, 'Brute', 12, 1);
  const lanes = lanesOf(D); for (const m of lanes) delete m.team;
  const bt = Duo.battle(lanes);
  const nest = bt.bodies.filter(q => q.side === 0 && (q.inside || q.boarded) && q.u.name === 'Skeleton Archers');
  assert.deepStrictEqual([...new Set(nest.map(q => q.squad))], [a.id], 'only the first squad is inside');
  assert.ok(bt.bodies.filter(q => q.squad === b.id + Duo.OFF).every(q => q.alive && !q.boarded), 'the other fights as it is');
});

// =================================== hidden info ===================================
check('A hidden buy changes nothing the opponents see: a repeat click\'s round, first buys of every kind, the first team action', () => {
  const x = match(11), { D } = x;
  playTo(x, 2); rich(D);
  const fac = put(D, 0, 'factory'), oak = put(D, 0, 'oak'), fh = put(D, 0, 'fieldHospital'), jail = put(D, 0, 'jail'), sch = put(D, 0, 'school'), den = put(D, 0, 'shadowDen');
  fresh(D);
  for (const R of D.lanes) R.m.hp = [150, 150];
  assert.ok(x.act(0, 'mpbBuy', fac, 'fighter').ok && x.act(0, 'mpbBuy', oak, 'boost').ok && x.act(0, 'mpbBuy', oak, 'heal').ok, 'round 2 buys');
  playTo(x, 3); rich(D);
  for (const R of D.lanes) R.m.hp = [150, 150];
  teams(D);
  const before = [2, 3].map(s => oppView(D, s));
  const act = (seat, fn, ...a) => assert.ok(try1(x, seat, fn, ...a).ok, fn + ' ' + JSON.stringify(a));
  act(1, 'mpbBuy', fac, 'fighter'); act(1, 'mpbBuy', oak, 'boost'); act(0, 'mpbBuy', oak, 'heal'); // bought again
  act(0, 'mpbBuy', 'v1', 'golem'); act(1, 'mpbBuy', 'v1', 'golem'); act(0, 'mpbUndo', 'v1', 'golem'); // a golem, one click taken back
  act(0, 'mpbBuy', fh, 'wind', 0, x.m(0).armies[0][0].id);
  const j = Mpb.jailable(x.m(1), 0, Mpb.recOf(x.m(1), 0, jail))[0];
  act(1, 'mpbBuy', jail, 'jail', j.lane, j.id);
  const pupil = x.m(0).armies[0].find(q => !Mpb.schoolWhy(x.m(0), 0, Mpb.recOf(x.m(0), 0, sch), 'enroll', [q.id]));
  act(0, 'mpbAct', sch, 'enroll', pupil.id);
  const t = Mpb.impTargets(x.m(0), 0)[0];
  act(0, 'mpbBuy', den, 'impersonate', t.who, t.id); act(1, 'mpbBuy', den, 'sabotage', 0);
  teams(D);
  [2, 3].forEach((s, i) => assert.strictEqual(oppView(D, s), before[i], 'seat ' + s + ' sees no change at all'));
  const v = copy(Duo.viewFor(D, 2).m);
  assert.strictEqual(Mpb.recOf(v, 0, oak).skills.boost.round, 2, 'Double restoration still reads round 2 for them');
  assert.ok(Array.isArray(v.bwalls) && v.bwalls.length === 2, 'every team field there from the start');
  assert.ok(Mpb.recOf(x.m(0), 0, oak).skills.boost.round === 3, 'the team\'s own state has this round\'s buy');
  // a take-back of this round's only click puts the round back as it was
  assert.ok(x.act(1, 'mpbUndo', oak, 'boost').ok && Mpb.recOf(x.m(0), 0, oak).skills.boost.round === 2, 'taken back: round 2 again');
});

check('A hidden Grow click doesn\'t stop the deploy clock (its own 15 s still runs)', () => {
  const x = match(41), { D } = x;
  playTo(x, 2); rich(D);
  const tk = put(D, 0, 'treeKojja');
  fresh(D);
  Duo.tick(D, x.T);
  assert.ok(D.deadline > 0 && !Duo.mpbPending(D), 'the clock runs');
  const before = [0, 1, 2, 3].map(s => [Duo.remainingFor(D, s, x.T), Duo.heldFor(D, s)]);
  assert.ok(x.act(1, 'mpbBuy', tk, 'grow').ok);
  Duo.tick(D, x.T);
  assert.deepStrictEqual([0, 1, 2, 3].map(s => [Duo.remainingFor(D, s, x.T), Duo.heldFor(D, s)]), before, 'nobody\'s clock stops');
  assert.ok(Duo.clocks(D, 1, x.T).vote > 0 && !Duo.clocks(D, 2, x.T).vote, 'the placement\'s 15 s for team A only');
});

check('Second wind keeps its squad\'s unit type: after an Undo all its id is a new squad, which it doesn\'t cover', () => {
  const x = match(13), { D } = x;
  playTo(x, 2); rich(D);
  const fh = put(D, 0, 'fieldHospital');
  fresh(D);
  const BR = ui('Brute'), AR = ui('Skeleton Archers');
  for (const u of [BR, AR]) if (!Game.isUnlocked(x.m(0), 0, u)) x.act(0, 'unlock', u);
  fresh(D);
  teams(D);
  const t = Mpb.homeTile([x.m(0)], 0, { unit: BR }, { col: 12, row: 15 });
  assert.ok(x.act(0, 'place', BR, t.col, t.row).ok);
  const id = x.m(0).armies[0].slice(-1)[0].id;
  assert.ok(x.act(1, 'mpbBuy', fh, 'wind', 0, id).ok, 'A2 buys Second wind on A1\'s new Brute');
  assert.strictEqual(Mpb.recOf(x.m(0), 0, fh).data.wind.u, BR);
  assert.ok(x.act(0, 'undoAll').ok);
  for (const u of [BR, AR]) if (!Game.isUnlocked(x.m(0), 0, u)) x.act(0, 'unlock', u); // (Undo all took the unlocks back too)
  teams(D);
  const t2 = Mpb.homeTile([x.m(0)], 0, { unit: AR }, { col: 12, row: 15 });
  assert.ok(x.act(0, 'place', AR, t2.col, t2.row).ok);
  const q = x.m(0).armies[0].find(s => s.id === id);
  assert.ok(q && q.unit === AR, 'the id is used again');
  const lanes = lanesOf(D); for (const m of lanes) Game.useGrid(m);
  const bodies = Game.bodiesFor(x.m(0), 0).filter(b => b.squad === id);
  assert.ok(bodies.length && bodies.every(b => !b.fhRevive), 'the archers are not covered');
});

// =================================== the same tile ===================================
// (6 Nov, "hidden until the fight": the building moves to the nearest tile its rules allow, next to it; the Assassin
// stays in that spot, next to a building now (Vilhelm's answer, 6 Nov; it used to move away too); tools/tests/mpb-hidden.js)
// (updated 6 Nov, Vilhelm's answer 5 "You always have 'prio' in your own zone": the Oak stays and the Assassin moves;
// the Oak used to move next to it)
check('A vote on a tile where a hidden enemy Assassin stands: the page and the server agree; at the fight the Assassin moves off', () => {
  const x = match(11), { D } = x;
  playTo(x, 2); rich(D);
  const ASS = ui('Assassin');
  teams(D);
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
  fresh(D);
  if (!Game.isUnlocked(x.m(0), 1, ASS)) x.act(2, 'unlock', ASS);
  let t = null;
  for (const s of Mpb.spots(x.m(0), 0, 'oak', null)) if (x.act(2, 'place', ASS, s.col, s.row).ok) { t = s; break; }
  assert.ok(t, 'an Assassin on a tile the Oak may go on');
  Duo.tick(D, x.T);
  const pv = W(Duo.viewFor(D, 0).m);
  assert.ok(!Game.foeSeen(pv, 1).some(q => q.col === t.col && q.row === t.row), 'A1 can\'t see it');
  teams(D);
  assert.strictEqual(Mpb.spotOk(x.m(0), 0, 'oak', null, t.col, t.row), Mpb.spotOk(pv, 0, 'oak', null, t.col, t.row), 'spotOk: the server as the page');
  assert.deepStrictEqual(Mpb.autoSpot(x.m(0), 0, 'oak', null), Mpb.autoSpot(pv, 0, 'oak', null), 'autoSpot: the server as the page');
  assert.ok(try1(x, 0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok, 'both vote that tile: placed');
  const oak = Mpb.recs(x.m(0), 0).find(r => r.kind === 'oak');
  assert.deepStrictEqual([oak.col, oak.row], [t.col, t.row]);
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  for (const L of [0, 1]) {
    const o = Mpb.recs(x.m(L), 0).find(r => r.kind === 'oak');
    assert.ok(o.col === t.col && o.row === t.row, 'the Oak stays where it was voted (lane ' + L + ')');
  }
  const a = x.m(0).armies[1].find(q => q.unit === ASS);
  teams(D);
  assert.ok(a && !(a.col === t.col && a.row === t.row) && !Game.nearBldg(x.m(0), 1, a.col, a.row), 'the Assassin moved off, not next to a building: ' + JSON.stringify(a && [a.col, a.row]));
});

// (updated 6 Nov, Vilhelm: "the mine exit tiles can be blocked": the exit stays where it was voted, on the Shadowhands,
// and is just blocked; it used to move next to it)
check('A Coal mine exit voted onto a hidden Shadowhands in no man\'s land: allowed, and both stay at the fight (the exit blocked)', () => {
  const x = match(12), { D } = x;
  playTo(x, 2); rich(D);
  put(D, 1, 'shadowDen');
  const SH = units.findIndex(u => u.mpbUnit === 'shadowDen');
  const mk = put(D, 0, 'coalMine');
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'coalMine', 'exit', mk);
  fresh(D);
  let t = null;
  for (const s of Mpb.spots(x.m(0), 0, 'coalMine', 'exit')) if (x.act(2, 'place', SH, s.col, s.row).ok) { t = s; break; }
  assert.ok(t);
  Duo.tick(D, x.T);
  assert.ok(try1(x, 0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok, 'the exit vote passes');
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  const ex = Mpb.recOf(x.m(0), 0, mk).parts.exit;
  assert.ok(ex && ex.col === t.col && ex.row === t.row, 'the exit stays: ' + JSON.stringify(ex));
  assert.ok(x.m(0).armies[1].some(q => q.unit === SH && q.col === t.col && q.row === t.row), 'the Shadowhands stays');
});

// (updated 6 Nov, answer 5: on team A's zone A's squad stays whichever came first; the newer used to move)
check('Two squads on one tile of team A\'s zone (a hidden Assassin of B\'s and a squad of A\'s, both orders): A\'s stays, the Assassin moves', () => {
  const D = Duo.create({}, units), T = 1e12;
  Duo.start(D, units, matrix, T, 7, [false, false, false, false]);
  const seq = [0, 0, 0, 0], act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, T);
  for (let k = 0; k < 4; k++) act(k, 'choosePack', 0);
  const ASS = ui('Assassin'), m = D.lanes[0].m;
  m.gold[1] = 5000; act(2, 'unlock', ASS);
  assert.ok(act(2, 'place', ASS, 12, 13).ok, 'B1\'s Assassin in team A\'s zone');
  let placed = null;
  for (let u = 0; u < units.length && !placed; u++) if (Game.isUnlocked(m, 0, u) && !units[u].building && act(0, 'place', u, 12, 13).ok) placed = u;
  assert.ok(placed != null, 'A1 puts a squad on that very tile (they can\'t see it)');
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
  const a = m.armies[1].find(q => q.unit === ASS), b = m.armies[0].find(q => q.unit === placed && q.round === 1 && Math.max(Math.abs(q.col - 12), Math.abs(q.row - 12)) <= 1);
  const b0 = m.armies[0].find(q => q.unit === placed && q.round === 1 && q.col === 12 && q.row === 13);
  assert.ok(b0, 'A\'s squad (newer, on its own zone) stays');
  assert.ok(!(a.col === 12 && a.row === 13) && Math.max(Math.abs(a.col - 12), Math.abs(a.row - 13)) === 1, 'the Assassin (first there) moves next to it: ' + JSON.stringify([a.col, a.row]));
  void b;
  // the other way round: the squad first, then the Assassin on it
  const D2 = Duo.create({}, units);
  Duo.start(D2, units, matrix, T, 7, [false, false, false, false]);
  const s2 = [0, 0, 0, 0], act2 = (seat, fn, ...x) => Duo.act(D2, seat, { seq: ++s2[seat] + 10, fn, a: x }, T);
  for (let k = 0; k < 4; k++) act2(k, 'choosePack', 0);
  const m2 = D2.lanes[0].m;
  m2.gold[1] = 5000; act2(2, 'unlock', ASS);
  let p2 = null;
  for (let u = 0; u < units.length && p2 == null; u++) if (Game.isUnlocked(m2, 0, u) && !units[u].building && act2(0, 'place', u, 12, 13).ok) p2 = u;
  assert.ok(act2(2, 'place', ASS, 12, 13).ok, 'the Assassin can\'t see it either');
  for (let k = 0; k < 4; k++) Duo.setReady(D2, k, true, T);
  const a2 = m2.armies[1].find(q => q.unit === ASS), b2 = m2.armies[0].find(q => q.unit === p2 && q.round === 1 && q.col === 12 && q.row === 13);
  assert.ok(b2, 'the squad (first there) stays');
  assert.ok(!(a2.col === 12 && a2.row === 13) && Math.max(Math.abs(a2.col - 12), Math.abs(a2.row - 13)) === 1, 'the Assassin moves next to it');
});

check('A teammate\'s Undo all onto a tile taken meanwhile (a Nest too): the presser\'s squad moves, the teammate\'s stays', () => {
  for (const how of ['plain', 'nest', 'school']) {
    const x = match(61), { D } = x;
    playTo(x, 2); clearArmies(D); rich(D);
    let tile = { col: 11, row: 15 }, sch = null;
    if (how !== 'plain') { const tk = put(D, 0, 'treeKojja'); owned(D, 0, tk, 'nest'); const k = Mpb.recOf(x.m(0), 0, tk); tile = { col: k.col, row: k.row }; }
    if (how === 'school') sch = put(D, 0, 'school');
    const S = addSq(D, 1, 0, 'Skeleton Archers', tile.col, tile.row, { exact: true }); // A2's
    addSq(D, 0, 1, 'Brute', 12, 1);
    fresh(D);
    const out = how === 'school' ? x.act(1, 'mpbAct', sch, 'enroll', S.id) : x.act(1, 'moveSquad', S.id, tile.col - 1, tile.row - 1);
    assert.ok(out.ok, how + ': A2 takes it off the tile');
    const AR = ui('Skeleton Archers');
    if (!Game.isUnlocked(x.m(0), 0, AR)) x.act(0, 'unlock', AR);
    assert.ok(x.act(0, 'place', AR, tile.col, tile.row).ok, how + ': A1 puts their archers there');
    const mine = x.m(0).armies[0].slice(-1)[0];
    assert.ok(x.act(1, 'undoAll').ok, how + ': A2 presses Undo all');
    const back = x.m(1).armies[0].find(q => q.id === S.id);
    assert.deepStrictEqual([mine.col, mine.row], [tile.col, tile.row], how + ': A1\'s stays');
    assert.ok(back && !back.school && !(back.col === tile.col && back.row === tile.row) && Math.max(Math.abs(back.col - tile.col), Math.abs(back.row - tile.row)) === 1, how + ': A2\'s moves next to it');
    assert.ok(back.from && back.movedRound === x.m(1).round, how + ': the opponents still see it where it was');
  }
});

// (Mpb.settle alone: the fallback for a fight without the server's D, as node tests' Duo.settle. A real fight's start,
// Duo.settleBoard, keeps the water on its team's own zone and moves the Assassin: tools/tests/mpb-prio.js)
check('A lake tile put on a hidden squad goes to the allowed tile nearest the one chosen', () => {
  const D = Duo.create({}, units), T = 1e12;
  Duo.start(D, units, matrix, T, 7, [false, false, false, false]);
  const seq = [0, 0, 0, 0], act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, T);
  for (let k = 0; k < 4; k++) act(k, 'choosePack', 0);
  for (const L of D.lanes) Mpb.giveCard(L.m, 0, { type: 'mpb', id: 'magicLake' });
  teams(D);
  const ASS = ui('Assassin'), m = D.lanes[0].m;
  m.gold[1] = 5000; act(2, 'unlock', ASS);
  assert.ok(act(2, 'place', ASS, 12, 13).ok);
  const lk = Mpb.recs(m, 0).find(r => r.kind === 'magicLake' && r.data.lane === 0);
  assert.ok(act(0, 'mpbAct', lk.key, 'place', 12, 13).ok, 'the page and the server allow it (it can\'t be seen)');
  Mpb.settle(lanesOf(D));
  const a = Mpb.recOf(m, 0, lk.key);
  assert.strictEqual(Math.max(Math.abs(a.col - 12), Math.abs(a.row - 13)), 1, 'next to the tile chosen, not the first tile of the board');
});

check('Artifacts never on a building\'s tile or one a Coal mine\'s exit keeps free; Dig a new exit not next to an artifact', () => {
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, 1e12, 7, [false, false, false, false]);
  const m = D.lanes[0].m; teams(D); Game.useGrid(m);
  const t = Mpb.autoSpot(m, 0, 'coalMine', null), rec = Mpb.addRec(m, 0, 'coalMine', t.col, t.row);
  rec.parts.exit = { col: 4, row: 10 };
  for (let s = 1; s <= 600; s++) {
    let a = s * 7919; const r = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
    const A = Mpb.rollArtifacts(m, r);
    assert.ok(A.list.every(x => !Mpb.at(m, x.col, x.row)), 'seed ' + s + ': a fair pair, off the exit and its ring');
  }
  m.round = 8; m.artifacts = { round: 8, list: [{ id: 0, col: 12, row: 9, card: null, won: null }, { id: 1, col: 11, row: 9, card: null, won: null }] };
  rec.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] };
  assert.ok(!Mpb.KINDS.coalMine.exitMoveOk(m, 0, rec, 13, 9) && !Mpb.KINDS.coalMine.exitMoveOk(m, 0, rec, 12, 9), 'no new exit on or next to an artifact');
  assert.ok(Mpb.KINDS.coalMine.exitMoveOk(m, 0, rec, 16, 9), 'further off it may go');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall review checks passed');
