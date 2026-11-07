// Headless checks of the 2026-11-07 playtest fixes, group A (Factory and Coal mine; src/mpb.js, src/duo.js, src/game.js):
//  - A1: Duo.teamOf carries the other lane's buildings with progress, level and fell (both boards draw them), and
//    Game.teamBuildingShown is bldgSeen's rule (the team's always, the other team's from the round after it was placed)
//  - A2: Mpb.resting (the shared out-of-action look): the 2v2 Factory the round after it fell, a shut Coal mine
//  - A3: a Coal mine destroyed in a fight is shut the next round only: nobody goes down it, it still stands as a
//    target, its exit still blocks its ring, both skills can still be bought; then it works again
//  - A5: Dig a new exit once a round per mine, 150 then +50 for each earlier dig; a take-back refunds it and lowers the
//    price; the opponents' record is exactly the round-start one after a second dig; a dig bought is one move; bots dig again
// Run: node tools/tests/fixes-1107-A.js
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

// ----- helpers (as tools/tests/mpb-b3.js) -----
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
const lanesOf = (D) => D.lanes.map(R => R.m);
const sameTeam = (D, sd) => { for (const f of ['mpb', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
const CM = Mpb.kindOf('coalMine'), COAL = CM.COAL;
function addMine(D, sd, col, row, xc, xr) {
  for (const R of D.lanes) { const r = Mpb.addRec(R.m, sd, 'coalMine', col, row); r.parts.exit = { col: xc, row: xr }; }
  const rec = Mpb.recs(D.lanes[0].m, sd).slice(-1)[0];
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
function squad(m, sd, name, col, row) {
  const ui = m.units.findIndex(u => u.name === name);
  const q = { id: 500 + m.armies[sd].length + sd * 50, unit: ui, col, row, level: 0, xp: 0, round: 1 };
  m.armies[sd].push(q);
  return q;
}
function battleOf(D) { const lanes = lanesOf(D); Duo.settle(lanes); for (const m of lanes) delete m.team; const bt = Duo.battle(lanes, { record: false }); Duo.setTeams(lanes); return bt; }
function clear(D) { for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; } Duo.setTeams(lanesOf(D)); }
const fellIn = (D, sd, key, round) => { for (const R of D.lanes) Mpb.recOf(R.m, sd, key).fell = round; };

// ===================================== A3: the shut Coal mine =====================================
check('A3: a Coal mine destroyed in the last fight is shut this round (nobody goes down it), a target still; then it works again', () => {
  const x = match(1107, [true, true, true, true]), { D } = x;
  clear(D);
  const key = addMine(D, 0, 11, 16, 11, 10);
  const m = x.m(0);
  for (const R of D.lanes) R.m.round = 3;
  fellIn(D, 0, key, 2); // destroyed in round 2's fight
  const q = squad(m, 0, 'Brute', 12, 15); squad(m, 1, 'Brute', 11, 3);
  const rec = Mpb.recOf(m, 0, key);
  assert.ok(CM.cmResting(m, rec) && Mpb.resting(m, 0, rec), 'shut this round (the boards\' out-of-action look too)');
  let bt = battleOf(D);
  assert.ok(Game.tileToWorld && bt.bodies.filter(b => b.side === 0 && b.squad === q.id).every(b => !b.mineTo && !(b.mineT > 0)), 'the squad round the entrance fights from its own tile');
  const ent = bt.bodies.find(b => b.u.mpb === 'coalMine' && b.side === 0);
  assert.ok(ent && ent.u.hp === COAL.hp, 'the entrance still stands in the fight as a target');
  assert.ok(Game.occupied(m, 1, 12, 9) && Game.occupied(m, 0, 10, 11), 'its exit still blocks its ring');
  for (const R of D.lanes) R.m.gold[0] = 1000;
  assert.ok(!Mpb.whyNot(m, 0, key, 'air') && !Mpb.whyNot(m, 0, key, 'shaft'), 'Fresh air and Dig a new exit can still be bought');
  const info = CM.hooks.info(m, 0, rec).join(' · ');
  assert.ok(/Shut this round/.test(info) && /shut this round/.test(CM.hooks.fellText(m, 0, rec)), 'the sheet says it: ' + info);
  // destroyed two rounds ago: open again
  for (const R of D.lanes) R.m.round = 4;
  assert.ok(!CM.cmResting(m, rec) && !Mpb.resting(m, 0, rec), 'the round after: open');
  bt = battleOf(D);
  assert.ok(bt.bodies.filter(b => b.side === 0 && b.squad === q.id).every(b => b.mineT === COAL.travel), 'down the mine again');
  assert.ok(!/Shut/.test(CM.hooks.info(m, 0, rec).join(' ')), 'no shut line');
  // destroyed again in the round it was shut: shut again the round after
  fellIn(D, 0, key, 4); for (const R of D.lanes) R.m.round = 5;
  assert.ok(CM.cmResting(m, rec), 'destroyed again: shut again');
});

check('A3: afterFight: the entrance destroyed in round 1’s fight → shut in round 2 (bots leave it), open in round 3', () => {
  const x = match(1108, [true, true, true, true]), { D } = x;
  clear(D);
  const key = addMine(D, 0, 11, 16, 11, 10);
  // round 1's fight with the entrance knocked down by hand (as Duo.fight does it: afterFight reads res.squads)
  const lanes = lanesOf(D), res = { squads: {} };
  res.squads['0:' + Mpb.squadOf(Mpb.recs(lanes[0], 0).findIndex(r => r.key === key))] = { total: 1, alive: 0 };
  Mpb.afterFight(lanes, res, [{ round: 1 }, { round: 1 }], [0, 0]);
  assert.strictEqual(Mpb.recOf(lanes[0], 0, key).fell, 1, 'fell in round 1');
  for (const R of D.lanes) { R.m.round = 2; Mpb.recOf(R.m, 0, key).fell = 1; }
  // a bot turn of team A: no squad moved round the entrance while it is shut (botAfter)
  const m = x.m(0), rec = Mpb.recOf(m, 0, key);
  m.armies[0].push({ id: 900, unit: m.units.findIndex(u => u.name === 'Brute'), col: 5, row: 14, level: 0, xp: 0, round: 2 });
  for (let s = 0; s < 40; s++) { const r = Mpb.rng(s); CM.hooks.botAfter(m, 0, rec, r); }
  assert.ok(!Mpb.kindOf('coalMine').mineOut(m, rec, m.armies[0][0].col, m.armies[0][0].row), 'the bot left its squad off the entrance');
  for (const R of D.lanes) R.m.round = 3;
  assert.ok(!CM.cmResting(m, rec), 'round 3: open');
});

// ===================================== A2: Mpb.resting =====================================
check('A2: Mpb.resting: the 2v2 Factory the round after it fell (and only then); kinds without the hook never', () => {
  const m = { round: 4, mpb: [[], []] };
  const fa = { key: 'fa1', kind: 'factory', col: 5, row: 15, parts: {}, round: 1, fell: 3, skills: {}, data: {} };
  assert.ok(Mpb.resting(m, 0, fa) && Mpb.facResting(m, fa), 'rebuilt this round');
  assert.ok(/being rebuilt this round/.test(Mpb.kindOf('factory').hooks.fellText(m, 0, fa)), 'the sheet line says so');
  m.round = 5; assert.ok(!Mpb.resting(m, 0, fa), 'the round after: working');
  assert.ok(!Mpb.resting(m, 0, { ...fa, kind: 'vault', fell: 4 }), 'a kind with no resting hook: never');
  assert.ok(!Mpb.resting(m, 0, null), 'no record: no');
});

// ===================================== A1: the other lane's buildings =====================================
check('A1: m.team.buildings carries progress, level and fell; the teammate\'s always shown, the other team\'s from the round after', () => {
  const x = match(1109), { D } = x;
  const lanes = lanesOf(D);
  lanes[1].buildings = [[{ id: 'factory', col: 18, row: 15, round: 1, progress: 0.5, built: false, xp: 0, level: 1, fell: 1 }], [{ id: 'factory', col: 18, row: 2, round: lanes[1].round, progress: 0, built: false, xp: 0, level: 0 }]];
  Duo.setTeams(lanes);
  const tb = Game.teamBuildings(lanes[0], 0)[0];
  assert.deepStrictEqual(tb, { id: 'factory', col: 18, row: 15, round: 1, built: false, progress: 0.5, level: 1, fell: 1 }, 'the teammate\'s Factory as lane 0 gets it');
  assert.ok(Game.buildingFell(tb), 'destroyed, being rebuilt: the boards\' out-of-action look');
  assert.ok(Game.teamBuildingShown(lanes[0], 0, true, 0, tb), 'your teammate\'s: always');
  const foe = Game.teamBuildings(lanes[0], 1)[0];
  assert.ok(!Game.teamBuildingShown(lanes[0], 0, true, 1, foe) && Game.teamBuildingShown(lanes[0], 0, false, 1, foe), 'the other opponent\'s new one: only from the fight on');
  assert.ok(Game.teamBuildingShown(lanes[0], 0, true, 1, { ...foe, round: lanes[0].round - 1 }), '... and from the round after it was placed');
  // a seat's view (what the page draws): the teammate's with its rebuild, the other opponent's new one not at all
  const v = Duo.viewFor(D, 0).m;
  assert.strictEqual(v.team.buildings[0][0].fell, 1, 'seat A1 sees the teammate\'s rebuild');
  assert.strictEqual(v.team.buildings[1].length, 0, 'and not the other opponent\'s new one (Referee.view)');
});

// ===================================== A5: Dig a new exit again =====================================
check('A5: Dig a new exit: once a round per mine, 150 / 200 / 250, take-back refunds and lowers the price, one move a buy', () => {
  const x = match(1110), { D } = x;
  const key = addMine(D, 0, 11, 16, 11, 10);
  const gold = (g) => { for (const R of D.lanes) R.m.gold[0] = g; };
  gold(1000); Duo.setTeams(lanesOf(D));
  const price = () => Mpb.skillCost(x.m(0), 0, key, 'shaft');
  assert.strictEqual(price(), COAL.moveCost, 'the 1st dig: 150');
  assert.ok(x.act(0, 'mpbBuy', key, 'shaft').ok, 'bought');
  assert.ok(!x.act(1, 'mpbBuy', key, 'shaft').ok, 'not twice a round (the team)');
  assert.ok(x.act(0, 'mpbAct', key, 'exit', 12, 8).ok, 'dug');
  assert.ok(!x.act(0, 'mpbAct', key, 'exit', 13, 8).ok, 'one move a buy');
  sameTeam(D, 0);
  playTo(x, 2); assert.notStrictEqual(D.phase, 'end', 'the match goes on');
  gold(1000);
  assert.strictEqual(price(), COAL.moveCost + COAL.moveRise, 'the 2nd dig: 200');
  const start = copy(Mpb.recOf(x.m(0), 0, key)), startV = copy(Duo.viewFor(D, 2).m.mpb[0].find(r => r.key === key));
  assert.ok(x.act(1, 'mpbBuy', key, 'shaft').ok && x.m(1).gold[0] === 1000 - 200, 'A2 pays 200');
  // (the page's copy hashes as the server's)
  const pm = W(Duo.viewFor(D, 1).m);
  assert.ok(Game.mpbAct(pm, 0, key, 'exit', 14, 8), 'the page allows the move');
  const r = x.act(1, 'mpbAct', key, 'exit', 14, 8);
  assert.ok(r.ok && Ref.sideHash(pm, 0) === r.h, 'moved: page and server agree');
  assert.strictEqual(Mpb.recOf(x.m(0), 0, key).data.digs, 2, 'two digs made');
  for (const seat of [2, 3]) assert.deepStrictEqual(Duo.viewFor(D, seat).m.mpb[0].find(q => q.key === key), startV, `seat ${seat}: the record exactly as the round began (old exit, dig count, skills)`);
  assert.ok(x.act(1, 'mpbUndo', key, 'shaft').ok && x.m(1).gold[0] === 1000, 'taken back: 200 back');
  assert.deepStrictEqual(Mpb.recOf(x.m(0), 0, key), start, 'the record as the round began (exit, data, skills)'); sameTeam(D, 0);
  assert.strictEqual(price(), 200, 'the price back to 200');
  assert.ok(x.act(0, 'mpbBuy', key, 'shaft').ok && x.act(0, 'mpbAct', key, 'exit', 14, 8).ok, 'dug again this round');
  playTo(x, 3); assert.notStrictEqual(D.phase, 'end', 'the match goes on');
  assert.strictEqual(price(), COAL.moveCost + 2 * COAL.moveRise, 'the 3rd dig: 250');
  // a dig is used the round it is bought: one bought and not used is lost as the next round begins
  gold(1000);
  assert.ok(x.act(0, 'mpbBuy', key, 'shaft').ok, 'bought, not used');
  assert.ok(CM.canMoveExit(x.m(0), 0, Mpb.recOf(x.m(0), 0, key)), 'it could move the exit this round');
  const exit3 = copy(Mpb.recOf(x.m(0), 0, key).parts.exit);
  playTo(x, 4); assert.notStrictEqual(D.phase, 'end', 'the match goes on');
  gold(1000);
  const rec4 = Mpb.recOf(x.m(0), 0, key);
  assert.deepStrictEqual(rec4.parts.exit, exit3, 'the exit stayed put');
  assert.ok(!CM.canMoveExit(x.m(0), 0, rec4) && !x.act(0, 'mpbAct', key, 'exit', 13, 8).ok, 'last round’s unused dig is lost');
  assert.strictEqual(price(), COAL.moveCost + 3 * COAL.moveRise, 'it still counts as a dig: 300');
  assert.ok(x.act(0, 'mpbBuy', key, 'shaft').ok && x.act(0, 'mpbAct', key, 'exit', 13, 8).ok, 'a new dig moves it');
  assert.ok(!x.act(0, 'mpbBuy', key, 'shaft').ok, 'no buy after a move this round');
  sameTeam(D, 0);
});

check('A5: the bots may dig again (each dig dearer)', () => {
  const x = match(1111), { D } = x;
  const key = addMine(D, 0, 11, 16, 11, 10);
  const m = x.m(0), rec = Mpb.recOf(m, 0, key);
  rec.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; rec.data = { digs: 1, moved: 0 };
  m.gold[0] = 5000;
  const zero = () => 0; // (always under the bot's odds)
  CM.hooks.botAfter(m, 0, rec, zero);
  assert.strictEqual(Mpb.skillN(rec, 'shaft'), 2, 'a 2nd dig bought');
  assert.strictEqual(rec.data.digs, 2, 'and used at once');
  assert.strictEqual(rec.skills.shaft.log[0].cost, COAL.moveCost + COAL.moveRise, 'at 200');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall fixes-1107 group A checks passed');
