// Headless check of group B5's 2v2 buildings (src/mpb.js regions factory and shadowDen; docs/MPB-2V2.md, docs/mpb-notes/b5.md):
//  - the Factory: placement (interior, 2 tiles of room), its prices are the Cog Builder's Factory's, one unit a round for
//    the team (whoever buys pays, the teammate can't take it back), hidden from the opponents until the fight, the unit
//    fights in a real Duo fight (made by Game.buildingMakes, in the buyer's lane's colour) beside a Cog Builder's own
//    Factory, destroyed: nothing the next round
//  - the Shadow Den: Shadowhands only for a team with a Den (half a Rogue, 1 body, tier 1, no man's land), the Shadow
//    deployment (+1 a player, only for Rogues, Assassins, Shadowhands), no flank delay for them, Impersonate (a body
//    becomes a Shadowhand 5 s into a real fight, either lane), Sabotage (no deploying that type next round, both
//    opponents; the page's red X), Insider information (the opponents' deployment seen live, their clock 15 s shorter,
//    free for the opponents when the Den falls in that fight), destroyed: Shadowhands lost and no Den skills next round
//  - hidden info, the page's copy hashing as the server's after each action, mirror symmetry of the fight effects,
//    and full bot 2v2s to round 10 with both kinds on both teams
// Run: node tools/tests/mpb-b5.js
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
const ui = (name) => units.findIndex(u => u.name === name);
const SH = ui('Shadowhands'), ROGUE = ui('Rogue'), ASSASSIN = ui('Assassin'), BRUTE = ui('Brute'), WISPS = ui('Wisps');

// a refereed 2v2; bots: which seats the AI plays (as tools/tests/mpb.js)
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
  if (D.phase !== 'end') assert.strictEqual(D.lanes[0].m.round, round, 'reached round ' + round);
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
const teams = (D) => Duo.setTeams(D.lanes.map(R => R.m));
// a building of kind on its first allowed tile in both lanes, as if it stood when the round began (addHut in mpb.js)
function addKind(D, sd, kind) {
  teams(D);
  const m = D.lanes[0].m, t = Mpb.autoSpot(m, sd, kind, null);
  assert.ok(t, 'room for ' + kind);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  const rec = Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1];
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
const recIn = (x, L, sd, key) => Mpb.recOf(x.m(L), sd, key);
// the first tile where seat may put unit u (rows: a list to look in, else the whole board)
function tileFor(x, seat, u, rows, ok) {
  teams(x.D);
  const S = Duo.SEATS[seat], m = x.m(S.lane);
  for (const row of rows || [...Array(Game.ROWS).keys()]) for (let col = 0; col < Game.COLS; col++) if ((!ok || ok(col, row)) && Game.canPlaceAt(m, S.side, col, row, u) && Game.spotFree(m, S.side, col, row, u)) return { col, row };
  return null;
}
function placeAt(x, seat, u, rows, ok) { const S = Duo.SEATS[seat]; if (!Game.isUnlocked(x.m(S.lane), S.side, u)) x.act(seat, 'unlock', u); const t = tileFor(x, seat, u, rows, ok); assert.ok(t, 'a tile for ' + units[u].name); const r = x.act(seat, 'place', u, t.col, t.row); return r.ok ? { ...t, id: x.m(Duo.SEATS[seat].lane).armies[Duo.SEATS[seat].side].slice(-1)[0].id } : null; }
const gold = (x, L, sd, g) => { x.m(L).gold[sd] = g; };
// the page's copy (the seat's view) runs the action too, and both hash as the server's (as in mpb.js)
function try1(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ': allowed on the page as on the server');
  if (r.ok) {
    assert.strictEqual(Ref.sideHash(Duo.viewFor(D, seat).m, sd), r.h, fn + ': the view hashes as the server');
    assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  }
  return r;
}
const inStep = (D) => { for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); } };
// a fight of the lanes as they stand, stepped until time t (or the end)
function fightTo(x, t) { Duo.settle(x.D.lanes.map(R => R.m)); const bt = Duo.battle(x.D.lanes.map(R => R.m), { record: false }); while (bt.time() < t && bt.step()) {} return bt; }
// a crafted result: building key of side sd fell in this round's fight; run the buildings' afterFight on both lanes
function fallen(x, sd, key) {
  const lanes = x.D.lanes.map(R => R.m), k = Mpb.recs(lanes[0], sd).findIndex(r => r.key === key), sq = Mpb.squadOf(k);
  const sums = lanes.map(m => ({ round: m.round }));
  Mpb.afterFight(lanes, { squads: { [sd + ':' + sq]: { side: sd, squad: sq, total: 1, alive: 0 } } }, sums, [200, 200]);
  Duo.copyAll(lanes[0], lanes[1]);
  return sums;
}

// =================================== the Factory ===================================
check('Factory: placed by the vote on an interior tile with room, prices as the Cog Builder\'s Factory', () => {
  const x = match(11), { D } = x;
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'factory');
  D.tbase[0] = Duo.teamState(x.m(0), 0);
  Duo.tick(D, x.T);
  teams(D);
  const ok = Mpb.spots(x.m(0), 0, 'factory', null);
  assert.ok(ok.length > 5 && ok.every(t => Mpb.interior(0, t.col, t.row) && Mpb.spaced(x.m(0), t.col, t.row)), 'interior tiles with 2 tiles of room');
  assert.ok(!x.act(0, 'mpbVote', 10, 18).ok, 'not on the back row');
  assert.ok(x.act(0, 'mpbVote', ok[0].col, ok[0].row).ok && x.act(1, 'mpbVote', ok[0].col, ok[0].row).ok, 'both vote the same tile');
  for (const L of [0, 1]) assert.ok(Mpb.recs(x.m(L), 0).some(r => r.kind === 'factory' && r.col === ok[0].col && r.row === ok[0].row), 'placed in both lanes');
  for (const L of [0, 1]) for (const sd of [0, 1]) assert.ok(Game.occupied(x.m(L), sd, ok[0].col, ok[0].row), 'its tile is taken for squads');
  const info = Game.buildingInfo('factory');
  for (const sk of Mpb.KINDS.factory.skills) { const b = Game.buildingSkillInfo('factory', sk.id); assert.ok(b && b.cost === sk.cost && b.name === sk.name, sk.id + ': the Cog Builder Factory\'s ' + (b && b.name) + ' at ' + (b && b.cost)); }
  assert.strictEqual(Mpb.KINDS.factory.hp, info.hp, 'its health is the Cog Builder Factory\'s');
});

check('Factory: one unit a round for the team, the buyer pays, only their own take-back, hidden from the opponents', () => {
  const x = match(12), { D } = x, key = addKind(D, 0, 'factory');
  for (const L of [0, 1]) gold(x, L, 0, 1000);
  assert.ok(x.act(0, 'mpbBuy', key, 'fighter').ok, 'A1 buys a Cogbot Fighter');
  assert.strictEqual(x.m(0).gold[0], 900); assert.strictEqual(x.m(1).gold[0], 1000, 'A2 pays nothing');
  sameTeam(D, 0);
  assert.strictEqual(Mpb.whyNot(x.m(1), 0, key, 'gunner', []), 'rules', 'one unit a round for the team');
  assert.ok(!x.act(1, 'mpbBuy', key, 'cogmech').ok && !x.act(0, 'mpbBuy', key, 'gunner').ok, 'nor another for either');
  assert.ok(!x.act(1, 'mpbUndo', key, 'fighter').ok, 'A2 can\'t take back A1\'s');
  assert.deepStrictEqual(Mpb.facNow(x.m(1), recIn(x, 1, 0, key)), { id: 'fighter', lane: 0 }, 'lane 1 knows it too');
  assert.ok(!Mpb.facNow(Duo.viewFor(D, 2).m, Mpb.recOf(Duo.viewFor(D, 2).m, 0, key)) && !Mpb.facNow(Duo.viewFor(D, 3).m, Mpb.recOf(Duo.viewFor(D, 3).m, 0, key)), 'the opponents don\'t see it');
  assert.ok(Mpb.facNow(Duo.viewFor(D, 1).m, Mpb.recOf(Duo.viewFor(D, 1).m, 0, key)), 'the teammate does');
  assert.ok(x.act(0, 'mpbUndo', key, 'fighter').ok && x.m(0).gold[0] === 1000, 'A1 takes it back, gold back');
  assert.ok(try1(x, 1, 'mpbBuy', key, 'cogmech').ok, 'then A2 buys the CogMech');
  assert.strictEqual(x.m(1).gold[0], 700);
  assert.ok(x.act(0, 'undoAll').ok, 'A1\'s Undo all');
  assert.deepStrictEqual(Mpb.facNow(x.m(0), recIn(x, 0, 0, key)), { id: 'cogmech', lane: 1 }, 'keeps A2\'s buy'); sameTeam(D, 0);
  inStep(D);
  playTo(x, 2);
  assert.ok(!Mpb.facNow(x.m(0), recIn(x, 0, 0, key)), 'a new round: nothing bought yet');
  assert.ok(Mpb.canBuy(x.m(0), 0, key, 'fighter') || x.m(0).gold[0] < 100, 'and it can be bought again');
});

check('Factory: its unit fights for the team in a real fight, beside a Cog Builder\'s own Factory', () => {
  const x = match(13), { D } = x, key = addKind(D, 0, 'factory');
  // A1 has a built Cog Builder Factory of their own with a Cogbot Fighter bought
  teams(D);
  const t = Mpb.spots(x.m(0), 0, 'factory', null).find(s => Game.buildingSpotOk(x.m(0), 0, s.col, s.row));
  x.m(0).buildings[0].push({ id: 'factory', col: t.col, row: t.row, round: 1, progress: 1, built: true, xp: 0, level: 0 });
  for (const L of [0, 1]) gold(x, L, 0, 1000);
  assert.ok(x.act(0, 'buyBuildingSkill', 'factory', 'fighter').ok, 'A1 buys a unit at their own Factory');
  assert.ok(x.act(1, 'mpbBuy', key, 'gunner').ok, 'A2 buys a Machinegunner at the team\'s');
  const bt = fightTo(x, 3);
  const fac = bt.bodies.find(b => b.u.mpb === 'factory'), cog = bt.bodies.find(b => b.u.building === 'factory');
  assert.ok(fac && fac.u.structure && fac.u.lesser && fac.side === 0 && fac.u.hp === 1000, 'the team Factory stands (a structure, not a unit for winning)');
  assert.ok(fac.produce && fac.produce.units[0].name === 'Cogbot Machinegunner' && fac.produce.lane === 1, 'it makes A2\'s Machinegunner');
  const own = Game.buildingMakes(x.m(1), 0, Game.buildingInfo('factory'), Game.buildingSkillInfo('factory', 'gunner'), 0, Mpb.FAC.noBuff, null);
  assert.deepStrictEqual(fac.produce.units, own.units, 'made by the Cog Builder Factory\'s own code (Game.buildingMakes)');
  assert.ok(cog && cog.produce && cog.produce.units[0].name === 'Cogbot Fighter', 'the Cog Builder\'s Factory makes A1\'s Fighter too');
  const made = bt.bodies.filter(b => b.credit === fac), mine = bt.bodies.filter(b => b.credit === cog);
  assert.ok(made.length === 1 && made[0].u.name === 'Cogbot Machinegunner' && made[0].side === 0 && made[0].lane === 1, 'the Machinegunner is out at 2 s, A2\'s (lane 1)');
  assert.ok(mine.length === 1 && mine[0].u.name === 'Cogbot Fighter', 'and the Fighter');
  while (bt.step()) {}
  const res = bt.result(), k = Mpb.recs(x.m(0), 0).findIndex(r => r.key === key);
  assert.ok(res.squads['0:' + Mpb.squadOf(k)].dealt > 0, 'what it made dealt damage (credited to the Factory): ' + res.squads['0:' + Mpb.squadOf(k)].dealt);
  // the same fight without the buy: no such unit
  const y = match(13), key2 = addKind(y.D, 0, 'factory');
  const bt2 = fightTo(y, 3);
  assert.ok(!bt2.bodies.some(b => b.credit && b.credit.u.mpb === 'factory') && !bt2.bodies.find(b => b.u.mpb === 'factory').produce, 'nothing bought: nothing made');
  assert.ok(key2);
});

check('Factory: destroyed in a fight, it makes nothing the next round', () => {
  const x = match(14), { D } = x, key = addKind(D, 0, 'factory');
  playTo(x, 2);
  fallen(x, 0, key);
  for (const L of [0, 1]) assert.strictEqual(recIn(x, L, 0, key).fell, 2);
  playTo(x, 3); // (it fell in round 2's fight)
  for (const L of [0, 1]) gold(x, L, 0, 1000);
  assert.strictEqual(Mpb.whyNot(x.m(0), 0, key, 'fighter', []), 'rules', 'being rebuilt: nothing to buy');
  assert.ok(Mpb.KINDS.factory.hooks.info(x.m(0), 0, recIn(x, 0, 0, key)).some(l => /rebuilt/.test(l)), 'the sheet says so');
  playTo(x, 4);
  for (const L of [0, 1]) gold(x, L, 0, 1000);
  assert.ok(x.act(1, 'mpbBuy', key, 'fighter').ok, 'the round after: it makes units again');
});

// =================================== the Shadow Den ===================================
check('Shadow Den: Shadowhands only with a Den: half a Rogue, 1 body, tier 1, 100 gold, no man\'s land', () => {
  const x = match(21), { D } = x;
  const u = units[SH], r = units[ROGUE];
  assert.deepStrictEqual([u.hp, u.hit, u.bodies, u.aps, u.speed, u.range, Game.unitCostOf(u), Game.tierOf(units, SH), u.unlock], [r.hp / 2, r.hit / 2, 1, r.aps, r.speed, r.range, 100, 1, 0], 'a Rogue at half health and hit, 1 body, tier 1, 100 gold');
  assert.ok(u.skillsInnate[0] && u.skillDefs[0].type === 'stealth' && u.skillsInnate[1] && u.skillDefs[1].type === 'forward', 'Stealth and Forward planting built in');
  for (const sd of [0, 1]) assert.ok(Game.isOff(x.m(0), SH, sd), 'no Den: not in the shop of side ' + sd);
  for (const L of [0, 1]) gold(x, L, 0, 1000);
  assert.ok(!tileFor(x, 0, SH), 'no tile for it either');
  addKind(D, 0, 'shadowDen');
  assert.ok(!Game.isOff(x.m(0), SH, 0) && !Game.isOff(x.m(1), SH, 0), 'with a Den: in both players\' shops');
  assert.ok(Game.isOff(x.m(0), SH, 1), 'not the other team\'s');
  assert.ok(Game.isUnlocked(x.m(0), 0, SH), 'no unlock');
  const nml = tileFor(x, 0, SH, [8, 9]);
  assert.ok(nml && Game.inNoMans(nml.row), 'it may go in no man\'s land');
  assert.ok(!Game.canPlaceAt(x.m(0), 0, nml.col, nml.row, ROGUE), 'a Rogue may not');
  const r1 = try1(x, 0, 'place', SH, nml.col, nml.row);
  assert.ok(r1.ok && x.m(0).gold[0] === 900, 'A1 recruits one for 100 gold ' + JSON.stringify(r1) + ' ' + x.m(0).gold[0]);
  assert.ok(try1(x, 1, 'place', SH, tileFor(x, 1, SH, [9]).col, 9).ok, 'A2 too');
  const bt = fightTo(x, 0.1), hb = bt.bodies.filter(b => b.u.name === 'Shadowhands');
  assert.strictEqual(hb.length, 2, 'one body each in the fight');
  assert.ok(hb.every(b => b.tier === 1 && b.u.mpb === 'shadowDen' && b.u.mpbSkin === 'hand'), 'tier 1 (artifacts), its own look');
  assert.ok(x.act(0, 'unplaceSquad', x.m(0).armies[0].find(q => q.unit === SH).id).ok && x.m(0).gold[0] === 1000, 'taken back: 100 back');
});

check('Shadow deployment: +1 a round for each player, only for Rogues, Assassins and Shadowhands', () => {
  const x = match(22), { D } = x;
  addKind(D, 0, 'shadowDen');
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 3000);
  for (const seat of [0, 1, 2]) for (const u of [ROGUE, ASSASSIN, BRUTE]) x.act(seat, 'unlock', u);
  const m = x.m(0), left = Game.deploysLeft(m, 0);
  assert.strictEqual(Game.deploysLeft(m, 0, SH), left + 1, 'one more for a Den unit');
  assert.strictEqual(Game.deploysLeft(m, 0, BRUTE), left, 'not for a Brute');
  for (let k = 0; k < left; k++) assert.ok(placeAt(x, 0, WISPS, Game.zoneRows(0)), 'A1 uses their own deployments');
  assert.strictEqual(Game.deploysLeft(m, 0), 0);
  assert.ok(!tileFor(x, 0, BRUTE) || !x.act(0, 'place', BRUTE, ...Object.values(tileFor(x, 0, BRUTE))).ok, 'no Brute now');
  assert.ok(placeAt(x, 0, ROGUE, Game.zoneRows(0)), 'but a Rogue, on the Shadow deployment');
  assert.ok(!x.act(0, 'place', SH, ...Object.values(tileFor(x, 0, SH, Game.zoneRows(0)))).ok, 'only one');
  assert.ok(x.act(0, 'unplaceSquad', m.armies[0].slice(-1)[0].id).ok, 'taken back');
  assert.ok(placeAt(x, 0, SH, Game.zoneRows(0)), 'a Shadowhands instead');
  // the teammate has their own; a Den unit first, then all their own deployments still
  const m1 = x.m(1), l1 = Game.deploysLeft(m1, 0);
  assert.ok(placeAt(x, 1, ASSASSIN), 'A2: an Assassin first');
  assert.strictEqual(Game.deploysLeft(m1, 0), l1, 'their own deployments are all still there');
  for (let k = 0; k < l1; k++) assert.ok(placeAt(x, 1, WISPS, Game.zoneRows(0)));
  assert.strictEqual(Game.deploysLeft(m1, 0, SH), 0, 'and then none');
  // team B has no Den: no Shadow deployment
  assert.strictEqual(Game.deploysLeft(x.m(0), 1, ROGUE), Game.deploysLeft(x.m(0), 1), 'no Den, no Shadow deployment');
  // the AI uses deployments the same way and never trips on it
  Game.aiDeploy(x.m(0), 1);
  inStep(D);
});

check('No flank delay for Rogues, Assassins and Shadowhands while the Den stands (and only for them)', () => {
  const x = match(23), { D } = x;
  playTo(x, 3);
  addKind(D, 0, 'shadowDen');
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 3000);
  for (const seat of [0, 1, 2, 3]) for (const u of [ROGUE, ASSASSIN, BRUTE]) x.act(seat, 'unlock', u);
  const fl0 = Game.flankRows(0), fl1 = Game.flankRows(1);
  const r = placeAt(x, 0, ROGUE, fl0.filter(row => Game.inNoMans(row))), b = placeAt(x, 0, BRUTE, fl0.filter(row => Game.inNoMans(row)));
  assert.ok(r && b && Game.isFlank(0, r.col, r.row) && Game.isFlank(0, b.col, b.row), 'a Rogue and a Brute on flank tiles');
  const a = placeAt(x, 1, ASSASSIN, Game.zoneRows(1).slice(2)), h = placeAt(x, 1, SH, fl0.filter(row => Game.inNoMans(row)), (c, rw) => Game.isFlank(0, c, rw));
  assert.ok(a && Game.inZone(1, a.row) && h && Game.isFlank(0, h.col, h.row), 'an Assassin in their zone, a Shadowhands on a flank');
  const rb = placeAt(x, 2, ROGUE, fl1.filter(row => Game.inNoMans(row)));
  assert.ok(rb, 'team B (no Den): a Rogue on a flank');
  const bt = fightTo(x, 0);
  const delay = (side, L, id) => bt.bodies.filter(q => q.side === side && q.squad === (L ? id + Duo.OFF : id)).map(q => q.delay || 0);
  assert.deepStrictEqual(delay(0, 0, r.id), [0, 0], 'Rogue: no delay');
  assert.deepStrictEqual(delay(0, 1, a.id), [0], 'Assassin in the enemy zone: no delay');
  assert.deepStrictEqual(delay(0, 1, h.id), [0], 'Shadowhands: no delay');
  assert.ok(delay(0, 0, b.id).every(d => d === Game.FLANK.delay), 'a Brute still waits ' + Game.FLANK.delay + ' s');
  assert.ok(delay(1, 0, rb.id).every(d => d === Game.FLANK.delay), 'their Rogue (no Den) still waits');
});

// round 2 with a Den for team A; enemy package squads (round 1) are visible targets
const standUp = (x, key) => { for (const L of [0, 1]) recIn(x, L, 0, key).fell = 0; const t = x.D.tbase[0] && x.D.tbase[0].mpb.find(r => r.key === key); if (t) t.fell = 0; }; // (as if it wasn't destroyed in the fights so far; Undo all starts from tbase)
function denRound2(seed, round = 2) {
  const x = match(seed), { D } = x, key = addKind(D, 0, 'shadowDen');
  playTo(x, round);
  standUp(x, key);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 2000);
  teams(D);
  return { x, D, key };
}

check('Impersonate: an enemy tier 1-2 squad you can see, once a round each; 5 s in, one body becomes your Shadowhand', () => {
  const { x, D, key } = denRound2(31);
  const t0 = Mpb.impTargets(x.m(0), 0), t1 = Mpb.impTargets(x.m(1), 0);
  assert.ok(t0.some(t => t.who === 0) && t0.some(t => t.who === 1) && t1.some(t => t.who === 1), 'A1 sees targets in front of them and on their teammate\'s side');
  assert.ok(t0.every(t => Game.tierOf(units, t.sq.unit) <= 2 && t.sq.round < x.m(0).round), 'only tier 1-2 squads of earlier rounds');
  // a tier 3 squad or one placed this round is no target
  x.act(2, 'unlock', ROGUE);
  const fresh = placeAt(x, 2, WISPS, Game.zoneRows(1));
  teams(D);
  assert.ok(!Mpb.impTargets(x.m(0), 0).some(t => t.who === 0 && t.id === fresh.id), 'a squad placed this round is hidden: no target');
  assert.ok(!x.act(0, 'mpbBuy', key, 'impersonate', 0, fresh.id).ok, 'refused');
  assert.ok(!x.act(0, 'mpbBuy', key, 'impersonate').ok, 'a target is needed');
  const a = t0.find(t => t.who === 1), b = t1.find(t => t.who === 1); // A1: B2's squad (lane 1), A2: B1's (lane 0)
  assert.ok(try1(x, 0, 'mpbBuy', key, 'impersonate', a.who, a.id).ok, 'A1 impersonates ' + units[a.sq.unit].name);
  assert.ok(!x.act(0, 'mpbBuy', key, 'impersonate', a.who, a.id).ok, 'once a round for A1');
  assert.ok(try1(x, 1, 'mpbBuy', key, 'impersonate', b.who, b.id).ok, 'A2 impersonates ' + units[b.sq.unit].name + ' in the other lane');
  assert.strictEqual(x.m(0).gold[0], 1800); assert.strictEqual(x.m(1).gold[0], 1800, '200 each');
  sameTeam(D, 0);
  // hidden from the opponents, seen by the teammate
  for (const seat of [2, 3]) assert.deepStrictEqual(Mpb.recOf(Duo.viewFor(D, seat).m, 0, key).data.imp || [], [], 'seat ' + seat + ' doesn\'t see the targets');
  assert.strictEqual(Mpb.recOf(Duo.viewFor(D, 1).m, 0, key).data.imp.length, 2);
  inStep(D);
  // the fight: lane 0's target (A1's: B1's squad, its own id) and lane 1's (A2's: B1's too, seen from lane 1 as the other lane)
  const fid = (t, L) => { const tl = t.who === 0 ? L : 1 - L; return tl === 0 ? t.id : t.id + Duo.OFF; };
  const ids = [fid(a, 0), fid(b, 1)];
  const bt = fightTo(x, Mpb.DEN.impAt - 0.2);
  const alive = (id) => bt.bodies.filter(q => q.side === 1 && q.squad === id && q.alive).length;
  const before = ids.map(alive);
  assert.ok(!bt.bodies.some(q => q.impersonated), 'nothing yet before 5 s');
  while (bt.time() < Mpb.DEN.impAt + 0.2 && bt.step()) {}
  const kids = bt.bodies.filter(q => q.impersonated);
  assert.strictEqual(kids.length, 2, 'two Shadowhands at 5 s');
  assert.ok(kids.every(k => k.side === 0 && k.u.name === 'Shadowhands' && k.tier === 1 && Mpb.isSquad(k.squad)), 'side 0\'s, tier 1, a squad of the Den');
  assert.deepStrictEqual(kids.map(k => k.lane).sort(), [0, 1], 'each in its buyer\'s colour');
  ids.forEach((id, i) => { if (ids.indexOf(id) === i) assert.ok(alive(id) <= before[i] - ids.filter(y => y === id).length, 'the target lost a body: ' + before[i] + ' -> ' + alive(id)); });
  assert.ok(bt.bodies.filter(q => q.sacrificed && q.side === 1).length >= 2, 'the bodies left the fight (no kill)');
  // the whole round: the news, and a playback from the snapshots is the same fight
  for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
  assert.ok((D.summary[0].mpbNews || [[], []])[0].some(n => n.kind === 'shadowDen' && n.imp === 2), 'the results say so');
});

check('Sabotage: the other team can\'t deploy that unit type next round (both lanes, a red X), hidden until then', () => {
  const { x, D, key } = denRound2(32);
  for (const seat of [2, 3]) x.act(seat, 'unlock', BRUTE);
  assert.ok(!x.act(0, 'mpbBuy', key, 'sabotage', 99999).ok && !x.act(0, 'mpbBuy', key, 'sabotage').ok, 'a unit type is needed');
  assert.ok(try1(x, 1, 'mpbBuy', key, 'sabotage', BRUTE).ok, 'A2 sabotages the Brute');
  assert.ok(!x.act(0, 'mpbBuy', key, 'sabotage', WISPS).ok, 'once a round for the team');
  assert.strictEqual(x.m(1).gold[0], 1900);
  for (const seat of [2, 3]) { const v = Duo.viewFor(D, seat).m; assert.ok(!Mpb.sabNow(v, Mpb.recOf(v, 0, key)), 'hidden from seat ' + seat); }
  assert.ok(placeAt(x, 2, BRUTE, Game.zoneRows(1)), 'this round they still may');
  playTo(x, 3);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 2000);
  for (const seat of [2, 3]) {
    const v = W(Duo.viewFor(D, seat).m);
    assert.ok(Game.mpbLocked(v, 1, BRUTE) && !Game.mpbLocked(v, 1, WISPS), 'seat ' + seat + '\'s page: the red X on the Brute only');
    const t = tileFor(x, seat, BRUTE, Game.zoneRows(1));
    assert.ok(t && !x.act(seat, 'place', BRUTE, t.col, t.row).ok, 'seat ' + seat + ' can\'t deploy a Brute');
    assert.ok(!Game.place(v, 1, BRUTE, t.col, t.row), 'nor on their page');
    assert.ok(placeAt(x, seat, WISPS, Game.zoneRows(1)), 'other units fine');
  }
  x.act(0, 'unlock', BRUTE);
  assert.ok(!Game.mpbLocked(x.m(0), 0, BRUTE) && placeAt(x, 0, BRUTE, Game.zoneRows(0)), 'the team that sabotaged may');
  Game.aiDeploy(x.m(1), 1); // the AI passes over it
  assert.ok(!x.m(1).armies[1].some(q => q.unit === BRUTE && q.round === x.m(1).round), 'the AI deploys no Brute');
  inStep(D);
  playTo(x, 4);
  for (const L of [0, 1]) gold(x, L, 1, 2000);
  assert.ok(!Game.mpbLocked(x.m(0), 1, BRUTE) && placeAt(x, 2, BRUTE, Game.zoneRows(1)), 'one round only');
});

check('Insider information: next round they see the opponents\' deployment live; the watched team has 15 s less and is told', () => {
  const { x, D, key } = denRound2(34, 3); // (round 4 has no draft holding the clock; seed 34 since 2026-11-07: with the new combat rules seed 33's Den falls in round 3's fight)
  assert.ok(try1(x, 1, 'mpbBuy', key, 'insider').ok, 'A2 buys Insider information');
  assert.strictEqual(x.m(1).gold[0], 2000 - Mpb.DEN.insider);
  for (const seat of [2, 3]) assert.ok(!Mpb.recOf(Duo.viewFor(D, seat).m, 0, key).data.insider, 'hidden from seat ' + seat);
  assert.ok(!Mpb.watching(x.m(0), 0) && Duo.cutFor(D, 2) === 0, 'nothing this round');
  playTo(x, 4);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 2000);
  assert.ok(Mpb.watching(x.m(0), 0) && Mpb.watching(x.m(1), 0) && !Mpb.watching(x.m(0), 1), 'team A watches team B this round');
  for (const seat of [2, 3]) { const v = Duo.viewFor(D, seat).m; assert.ok(Mpb.watching(v, 0) && Mpb.deployCut(v, 1) === Mpb.DEN.cut, 'seat ' + seat + ' is told: "You are being watched"'); }
  const b1 = placeAt(x, 2, WISPS, Game.zoneRows(1)), b2 = placeAt(x, 3, WISPS, Game.zoneRows(1)), a1 = placeAt(x, 0, WISPS, Game.zoneRows(0));
  const vA1 = Duo.viewFor(D, 0).m, vA2 = Duo.viewFor(D, 1).m;
  assert.ok(vA1.armies[1].some(q => q.id === b1.id) && Game.foeSeen(W(vA1), 1).some(q => q.id === b1.id), 'A1 sees B1\'s new squad (and draws it: foeSeen)');
  assert.ok(Game.teamSeen(W(vA1), 1).some(q => q.id === b2.id + Duo.OFF), 'and B2\'s on the other half');
  assert.ok(vA2.armies[1].some(q => q.id === b2.id) && Game.teamSeen(W(vA2), 1).some(q => q.id === b1.id + Duo.OFF), 'A2 sees both too');
  const vB1 = Duo.viewFor(D, 2).m;
  assert.ok(!vB1.armies[0].some(q => q.id === a1.id) && !Game.foeSeen(W(vB1), 0).some(q => q.id === a1.id), 'team B still doesn\'t see team A\'s');
  // a tile they took is held for the watchers; a squad they move shows where it is now
  assert.ok(Game.enemyHolds(W(vA1), 0, b1.col, b1.row), 'their new squad\'s tile is held for A1');
  const to = tileFor(x, 2, WISPS, Game.zoneRows(1));
  assert.ok(x.act(2, 'moveSquad', b1.id, to.col, to.row).ok, 'B1 moves it');
  const mv = Duo.viewFor(D, 0).m.armies[1].find(q => q.id === b1.id);
  assert.ok(mv.col === to.col && mv.row === to.row, 'A1 sees it on its new tile');
  inStep(D);
  // the clock: team B's actions stop 15 s before the deadline, team A's go on
  assert.strictEqual(Duo.cutFor(D, 2), Mpb.DEN.cut); assert.strictEqual(Duo.cutFor(D, 3), Mpb.DEN.cut); assert.strictEqual(Duo.cutFor(D, 0), 0);
  assert.ok(D.deadline > 0, 'the clock runs');
  D.now = D.deadline - Mpb.DEN.cut + Ref.GRACE_MS + 1;
  const tB = tileFor(x, 2, WISPS, Game.zoneRows(1)), tA = tileFor(x, 0, WISPS, Game.zoneRows(0));
  assert.strictEqual(x.act(2, 'place', WISPS, tB.col, tB.row).why, 'time', 'B1: time is up');
  assert.ok(x.act(0, 'place', WISPS, tA.col, tA.row).ok, 'A1 still deploys');
  D.now = 0;
  playTo(x, 5);
  assert.ok(!Mpb.watching(x.m(0), 0) && Duo.cutFor(D, 2) === 0, 'one round only');
});

check('Insider information bought in a round whose fight destroys the Den: the opponents get it, free', () => {
  const { x, D, key } = denRound2(34);
  assert.ok(x.act(0, 'mpbBuy', key, 'insider').ok);
  const sums = fallen(x, 0, key);
  for (const L of [0, 1]) assert.deepStrictEqual(recIn(x, L, 0, key).data.watch, { round: 3, by: 1, free: true }, 'lane ' + L + ': team B watches next round');
  assert.ok(sums[0].mpbNews[0].some(n => n.flip), 'the results say so');
  const next = { ...x.m(0), round: 3 };
  assert.ok(Mpb.watching(next, 1) && !Mpb.watching(next, 0) && Mpb.deployCut(next, 0) === Mpb.DEN.cut, 'team A is watched and has 15 s less');
});

check('Den destroyed: the team\'s Shadowhands are lost, no Den skills next round', () => {
  const x = match(35), { D } = x, key = addKind(D, 0, 'shadowDen');
  for (const L of [0, 1]) gold(x, L, 0, 2000);
  const h0 = placeAt(x, 0, SH, Game.zoneRows(0)), h1 = placeAt(x, 1, SH, Game.zoneRows(0));
  playTo(x, 2);
  standUp(x, key);
  for (const L of [0, 1]) gold(x, L, 0, 2000);
  const rg = placeAt(x, 0, ROGUE, Game.zoneRows(0));
  assert.ok(h0 && h1 && rg);
  for (const L of [0, 1]) assert.ok(x.m(L).armies[0].some(q => q.unit === SH), 'lane ' + L + ' has its Shadowhands');
  // round 2's fight destroys the Den (a crafted result, as round 2 ends)
  const sums = fallen(x, 0, key);
  for (const L of [0, 1]) assert.ok(!x.m(L).armies[0].some(q => q.unit === SH), 'lane ' + L + ': its Shadowhands are gone');
  assert.ok(x.m(0).armies[0].some(q => q.unit === ROGUE), 'a Rogue stays');
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'shadowDen' && n.lost === 2), 'the news: 2 squads lost');
  sameTeam(D, 0);
  playTo(x, 3);
  for (const L of [0, 1]) { recIn(x, L, 0, key).fell = 2; gold(x, L, 0, 2000); } // (last destroyed in round 2's fight)
  teams(D);
  const t = Mpb.impTargets(x.m(0), 0)[0];
  for (const [id, a] of [['impersonate', [t.who, t.id]], ['sabotage', [WISPS]], ['insider', []]]) assert.strictEqual(Mpb.whyNot(x.m(0), 0, key, id, a), 'rules', id + ': no Den skills this round');
  assert.ok(!x.act(1, 'mpbBuy', key, 'insider').ok, 'refused for A2 too');
  assert.ok(!Game.isOff(x.m(0), SH, 0) && placeAt(x, 0, SH, Game.zoneRows(0)), 'Shadowhands can still be recruited (the Den stands again)');
  playTo(x, 4);
  for (const L of [0, 1]) { recIn(x, L, 0, key).fell = 2; gold(x, L, 0, 2000); }
  assert.ok(x.act(1, 'mpbBuy', key, 'insider').ok, 'the round after: Den skills again');
});

// ----- after review (2026-11-05): fixes of the Den and the Factory -----
check('Sabotage two rounds in a row: the lock in force holds through its round (a new buy, its take-back, Undo all), the new one locks the next', () => {
  const { x, D, key } = denRound2(37);
  for (const seat of [2, 3]) x.act(seat, 'unlock', BRUTE);
  assert.ok(x.act(1, 'mpbBuy', key, 'sabotage', BRUTE).ok, 'round 2: A2 sabotages the Brute');
  playTo(x, 3);
  standUp(x, key);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 2000);
  teams(D);
  const locked = (ui) => [0, 1].map(L => Game.mpbLocked(x.m(L), 1, ui));
  const seen = () => [2, 3].map(seat => Game.mpbLocked(W(Duo.viewFor(D, seat).m), 1, BRUTE) && !Game.mpbLocked(W(Duo.viewFor(D, seat).m), 1, WISPS));
  assert.deepStrictEqual(locked(BRUTE), [true, true], 'round 3: the Brute is locked in both lanes');
  assert.ok(try1(x, 0, 'mpbBuy', key, 'sabotage', WISPS).ok, 'A1 sabotages the Wisps for round 4');
  assert.deepStrictEqual(locked(BRUTE), [true, true], 'the Brute stays locked');
  assert.deepStrictEqual(locked(WISPS), [false, false], 'the Wisps not yet');
  assert.deepStrictEqual(seen(), [true, true], 'their pages: still the X on the Brute only (the new buy stays hidden)');
  const t = tileFor(x, 2, BRUTE, Game.zoneRows(1));
  assert.ok(!x.act(2, 'place', BRUTE, t.col, t.row).ok, 'B1 still can\'t deploy a Brute');
  assert.ok(try1(x, 0, 'mpbUndo', key, 'sabotage').ok, 'A1 takes it back');
  assert.deepStrictEqual(locked(BRUTE), [true, true], 'the Brute stays locked after the take-back');
  assert.ok(try1(x, 0, 'mpbBuy', key, 'sabotage', WISPS).ok, 'and buys it again');
  assert.ok(placeAt(x, 1, WISPS, Game.zoneRows(0)) && x.act(1, 'undoAll').ok, 'A2 places a squad, then Undo all');
  for (const L of [0, 1]) { assert.deepStrictEqual(locked(BRUTE)[L], true); assert.strictEqual((Mpb.sabNow(x.m(L), recIn(x, L, 0, key)) || {}).ui, WISPS, 'lane ' + L + ': A1\'s new buy stays'); }
  sameTeam(D, 0); inStep(D);
  assert.ok(!x.act(2, 'place', BRUTE, t.col, t.row).ok, 'still no Brute for B1');
  playTo(x, 4);
  for (const L of [0, 1]) gold(x, L, 1, 2000);
  assert.deepStrictEqual(locked(BRUTE), [false, false], 'round 4: the Brute is free again');
  assert.deepStrictEqual(locked(WISPS), [true, true], 'the Wisps are locked');
  assert.ok(recIn(x, 0, 0, key).data.sab.every(e => e.round === 3), 'round 2\'s buy is dropped');
  assert.ok(placeAt(x, 2, BRUTE, Game.zoneRows(1)), 'B1 deploys a Brute');
});

check('Impersonate: a squad sold this round stays a target (server and page agree, either lane); Undo all keeps the teammate\'s paid buy', () => {
  const { x, D, key } = denRound2(31);
  const tA2 = Mpb.impTargets(x.m(1), 0).filter(t => t.who === 1); // A2: B1's squads (lane 0)
  assert.ok(tA2.length >= 2, 'B1 has two targets');
  const [s0, s1] = tA2;
  assert.ok(x.act(2, 'sell', s0.id).ok, 'B1 sells one');
  teams(D);
  assert.ok(Mpb.impTargets(x.m(1), 0).some(t => t.who === 1 && t.id === s0.id), 'the server still offers it to A2 (the sale is hidden)');
  assert.ok(Mpb.impTargets(W(Duo.viewFor(D, 1).m), 0).some(t => t.who === 1 && t.id === s0.id), 'and A2\'s page');
  assert.ok(try1(x, 1, 'mpbBuy', key, 'impersonate', 1, s0.id).ok, 'A2 impersonates the sold squad');
  assert.ok(x.act(2, 'sell', s1.id).ok, 'B1 sells the other too');
  assert.ok(placeAt(x, 0, WISPS, Game.zoneRows(0)) && x.act(0, 'undoAll').ok, 'A1 places a squad and does Undo all');
  for (const L of [0, 1]) {
    const r = recIn(x, L, 0, key);
    assert.ok(Mpb.impNow(x.m(L), r).some(e => e.lane === 1 && e.id === s0.id) && r.skills.impersonate.by[1] === 1, 'lane ' + L + ': A2\'s Impersonate stays');
  }
  assert.strictEqual(x.m(1).gold[0], 1800, 'A2 paid for it');
  sameTeam(D, 0); inStep(D);
  // the sold squad isn't in the fight: nothing happens
  const bt = fightTo(x, Mpb.DEN.impAt + 0.3);
  assert.ok(!bt.bodies.some(b => b.impersonated), 'no Shadowhand from a squad that was sold');
  assert.ok(x.act(1, 'mpbUndo', key, 'impersonate').ok && x.m(1).gold[0] === 2000, 'A2 can take it back, gold back');
});

check('Impersonate a live squad while watching: a squad id used again after their Undo all is no target', () => {
  const { x, D, key } = denRound2(38, 3);
  assert.ok(x.act(1, 'mpbBuy', key, 'insider').ok);
  playTo(x, 4);
  standUp(x, key);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 3000);
  const t1 = units.findIndex((u, i) => Game.tierOf(units, i) === 1 && !u.building && !u.mpbUnit && !u.carrier && !Game.isOff(x.m(0), i, 1));
  const t3 = units.findIndex((u, i) => Game.tierOf(units, i) >= 3 && !u.building && !u.carrier && !Game.isOff(x.m(0), i, 1));
  const s1 = placeAt(x, 2, t1, [0, 1, 2]); // (at the back: alive 5 s in)
  teams(D);
  assert.ok(Mpb.impTargets(x.m(0), 0).some(t => t.who === 0 && t.id === s1.id), 'A1 (watching) may pick B1\'s new ' + units[t1].name);
  assert.ok(try1(x, 0, 'mpbBuy', key, 'impersonate', 0, s1.id).ok, 'A1 impersonates it');
  assert.strictEqual(Mpb.impNow(x.m(0), recIn(x, 0, 0, key))[0].u, t1, 'the buy keeps its unit type');
  // the target stays: the Shadowhand comes
  let bt = fightTo(x, Mpb.DEN.impAt + 0.3);
  assert.strictEqual(bt.bodies.filter(b => b.impersonated).length, 1, 'with the squad there: a Shadowhand');
  assert.ok(x.act(2, 'undoAll').ok, 'B1\'s Undo all');
  x.act(2, 'unlock', t3);
  const s3 = placeAt(x, 2, t3, [0, 1, 2]);
  assert.strictEqual(s3.id, s1.id, 'their ' + units[t3].name + ' (tier ' + Game.tierOf(units, t3) + ') gets the same id');
  bt = fightTo(x, Mpb.DEN.impAt + 0.3);
  assert.ok(!bt.bodies.some(b => b.impersonated) && !bt.bodies.some(b => b.side === 1 && b.sacrificed), 'no body of it is taken, no Shadowhand');
});

check('Insider information: the watchers see the squads live, but not the watched team\'s gold, buys, Vault or levels', () => {
  const { x, D, key } = denRound2(34, 3);
  const fkey = addKind(D, 1, 'factory');
  assert.ok(x.act(1, 'mpbBuy', key, 'insider').ok);
  playTo(x, 4);
  standUp(x, key);
  for (const L of [0, 1]) { recIn(x, L, 1, fkey).fell = 0; for (const sd of [0, 1]) gold(x, L, sd, 2000); }
  for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
  assert.ok(Mpb.watching(x.m(0), 0));
  assert.ok(x.act(2, 'mpbBuy', fkey, 'cogmech').ok && x.act(2, 'vaultPut', 150).ok, 'B1 buys a CogMech and puts 150 in the Vault');
  const old = x.m(0).armies[1].find(q => q.round < x.m(0).round);
  assert.ok(x.act(2, 'levelUp', old.id).ok, 'B1 levels a squad');
  const nw = placeAt(x, 2, WISPS, Game.zoneRows(1));
  for (const seat of [0, 1]) {
    const v = Duo.viewFor(D, seat).m, vb = seat === 0 ? v.armies[1] : v.team.armies[1].map(q => ({ ...q, id: q.id - Duo.OFF }));
    assert.ok(vb.some(q => q.id === nw.id), 'seat ' + seat + ' sees B1\'s new squad');
    if (seat === 0) {
      assert.strictEqual(v.gold[1], 2000, 'A1: their gold as the round began');
      assert.ok(!Mpb.facNow(v, Mpb.recOf(v, 1, fkey)), 'nor their Factory buy');
      assert.strictEqual(v.vault[1].gold, 0, 'nor their Vault move');
      assert.strictEqual(v.armies[1].find(q => q.id === old.id).level, old.level - 1, 'nor the level bought this round');
    }
  }
  inStep(D);
});

check('Insider information\'s cut after a pause: the watched team keeps at least 5 s, and its clock reads time up, not paused', () => {
  const { x, D, key } = denRound2(34, 3);
  assert.ok(x.act(1, 'mpbBuy', key, 'insider').ok);
  playTo(x, 4);
  for (const L of [0, 1]) for (const sd of [0, 1]) gold(x, L, sd, 2000);
  assert.strictEqual(Duo.remainingFor(D, 2, x.T), D.deadline - x.T - Mpb.DEN.cut, 'a full round: 15 s less');
  assert.strictEqual(Duo.remainingFor(D, 0, x.T), D.deadline - x.T, 'the watchers: all of it');
  const t1 = D.deadline - 12000;
  Duo.setAway(D, 0, true, t1);
  assert.ok(!D.deadline && D.held === 12000);
  assert.ok(Duo.heldFor(D, 2) >= 5000 && Duo.heldFor(D, 2) < 12000 && Duo.heldFor(D, 0) === 12000, 'held: ' + Duo.heldFor(D, 2) + ' for team B');
  const t2 = t1 + 3000;
  Duo.setAway(D, 0, false, t2);
  assert.strictEqual(Duo.remainingFor(D, 0, t2), 12000, 'team A: 12 s');
  assert.strictEqual(Duo.remainingFor(D, 2, t2), 5000, 'team B: 5 s, not less than nothing');
  D.now = t2 + 100;
  const tB = tileFor(x, 2, WISPS, Game.zoneRows(1));
  assert.ok(x.act(2, 'place', WISPS, tB.col, tB.row).ok, 'B1 may still act');
  assert.strictEqual(Duo.remainingFor(D, 2, t2 + 8000), 1, 'once their time is up the server sends 1 ms (the page says time\'s up)');
  D.now = t2 + 5000 + Ref.GRACE_MS + 1;
  const tB2 = tileFor(x, 2, WISPS, Game.zoneRows(1));
  assert.strictEqual(x.act(2, 'place', WISPS, tB2.col, tB2.row).why, 'time', 'then refused');
  D.now = 0;
});

check('the buyer\'s own lane: a lane-1 Impersonate gets A2\'s Shadowhands skills, a lane-1 Factory unit is made from lane 1', () => {
  const { x, D, key } = denRound2(39), fkey = addKind(D, 0, 'factory');
  for (const L of [0, 1]) recIn(x, L, 0, fkey).fell = 0;
  // A2 has Frenzy for Shadowhands (lane 1 only)
  x.m(1).tech[0][SH] = Engine.SLOTS.map((s, k) => (k === 2 ? 1 : 0));
  const u0 = Engine.leveled(Game.unitFor(x.m(0), 0, SH), 0), u1 = Engine.leveled(Game.unitFor(x.m(1), 0, SH), 0);
  assert.notDeepStrictEqual(JSON.parse(JSON.stringify(u0)), JSON.parse(JSON.stringify(u1)), 'the two lanes\' Shadowhands differ');
  const t = Mpb.impTargets(x.m(1), 0)[0];
  assert.ok(x.act(1, 'mpbBuy', key, 'impersonate', t.who, t.id).ok, 'A2 impersonates');
  assert.ok(x.act(1, 'mpbBuy', fkey, 'fighter').ok, 'A2 buys the Factory\'s Fighter');
  const seen = [], orig = Game.buildingMakes;
  Game.buildingMakes = (m, ...a) => { seen.push(m.duoLane); return orig(m, ...a); };
  let bt;
  try { bt = fightTo(x, Mpb.DEN.impAt + 0.3); } finally { Game.buildingMakes = orig; }
  assert.deepStrictEqual(seen, [1], 'the Factory unit is made from A2\'s lane');
  const k = bt.bodies.find(b => b.impersonated);
  assert.ok(k && k.lane === 1, 'a Shadowhand in A2\'s colour');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(k.u.skills || null)), JSON.parse(JSON.stringify(u1.skills || null)), 'with A2\'s skills');
  assert.strictEqual(k.u.frenzy, u1.frenzy, 'Frenzy as lane 1 has it');
});

check('the Den\'s sheet lines read right for both teams', () => {
  const { x, D, key } = denRound2(40, 3);
  for (const seat of [2, 3]) x.act(seat, 'unlock', BRUTE);
  assert.ok(x.act(0, 'mpbBuy', key, 'sabotage', BRUTE).ok && x.act(1, 'mpbBuy', key, 'insider').ok);
  playTo(x, 4);
  standUp(x, key);
  const info = Mpb.kindOf('shadowDen').hooks.info, rec = recIn(x, 0, 0, key);
  assert.deepStrictEqual(info(x.m(0), 0, rec, 0), ['Sabotage: their Brute can’t be deployed this round.', 'Insider information: you see their deployment live.'], 'the owners');
  assert.deepStrictEqual(info(x.m(0), 0, rec, 1), ['Sabotage: your Brute can’t be deployed this round.', 'Insider information: they see your deployment live.'], 'the opponents');
});

check('the Shadow deployment: once the normal deployments are used, a bot places a Den unit on it instead of buying one', () => {
  const { x, D } = denRound2(41);
  const m = x.m(0);
  for (const L of [0, 1]) gold(x, L, 0, 3000);
  let guard = 0;
  while (Game.deploysLeft(m, 0) > 0 && guard++ < 20) assert.ok(placeAt(x, 0, WISPS, Game.zoneRows(0)), 'a Wisps');
  assert.ok(Game.deploysLeft(m, 0) <= 0 && Game.deploysLeft(m, 0, SH) === 1, 'no normal deployment left, the Shadow one is');
  const extra = m.extraDeploys[0], n = m.armies[0].length;
  teams(D);
  Game.aiDeploy(m, 0);
  const fresh = m.armies[0].slice(n);
  assert.ok(fresh.length >= 1 && Mpb.denUnit(m, fresh[0].unit), 'its first squad is a Den unit: ' + (fresh[0] ? units[fresh[0].unit].name : 'none'));
  assert.ok(m.extraDeploys[0] >= extra, '(it may buy deployments after)');
  assert.ok(fresh.filter(q => Mpb.denUnit(m, q.unit)).length >= 1 && m.extraDeploys[0] - extra <= fresh.length - 1, 'the Den unit came without a bought deployment');
});

check('mirror: both teams\' Impersonate and Factory give mirrored fight effects', () => {
  Game.useGrid('duo');
  const Wb = Engine.withTraits(units[WISPS]), fac = Mpb.unitOf({}, 0, { kind: 'factory' });
  const pr = Game.buildingMakes({ units, armies: [[], []] }, 0, Game.buildingInfo('factory'), Game.buildingSkillInfo('factory', 'fighter'), 0, Mpb.FAC.noBuff, null);
  const side = (sd) => {
    const s = sd === 0 ? 1 : -1, out = [];
    out.push(...Engine.buildSquad(Wb, sd, -12 * s, -20 * s, 1, Game.TILE, 0));
    out.push(...Engine.buildSquad(Wb, sd, 10 * s, -24 * s, 2, Game.TILE, 2));
    const [fb] = Engine.buildSquad(fac, sd, 0, -36 * s, Mpb.SQ, Game.TILE, 4); fb.produce = { ...pr, lane: 0 }; out.push(fb);
    return out;
  };
  const hand = Engine.leveled(Engine.withTraits(units[SH]), 0);
  const imp = [0, 1].map(sd => ({ side: sd, squad: 2, at: Mpb.DEN.impAt, unit: hand, sq: Mpb.extraOf(0, 0), lane: 0 }));
  const bt = Engine.createBattle(side(0), side(1), { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } }, { mpb: { shadowImpersonate: imp } });
  while (bt.time() < Mpb.DEN.impAt + 0.1 && bt.step()) {}
  const k = (sd) => bt.bodies.filter(b => b.impersonated && b.side === sd), made = (sd) => bt.bodies.filter(b => b.credit && b.credit.u.mpb === 'factory' && b.side === sd);
  assert.ok(k(0).length === 1 && k(1).length === 1, 'one Shadowhand each');
  assert.ok(Math.abs(k(0)[0].x + k(1)[0].x) < 1e-6 && Math.abs(k(0)[0].y + k(1)[0].y) < 1e-6, 'at mirrored spots: ' + [k(0)[0].x, k(0)[0].y, k(1)[0].x, k(1)[0].y].map(v => v.toFixed(2)).join(','));
  assert.ok(made(0).length === 1 && made(1).length === 1 && made(0)[0].u.name === made(1)[0].u.name, 'each Factory made its Fighter');
  while (bt.step()) {}
  const r = bt.result();
  assert.ok(Math.abs(r.frac[0] - r.frac[1]) < 0.15, 'a mirrored fight ends about even: ' + r.frac.map(v => v.toFixed(3)).join(' / '));
  // and without the field nothing changes: the same armies, no opts.mpb
  const bt0 = Engine.createBattle(side(0), side(1), { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } }, {});
  while (bt0.step()) {}
  assert.ok(!bt0.bodies.some(b => b.impersonated), 'no opts.mpb: no Impersonate');
});

check('hidden info and the page\'s copy: Den and Factory actions hash as the server\'s, every seat in step', () => {
  const { x, D, key } = denRound2(36), fkey = addKind(D, 0, 'factory');
  const t = Mpb.impTargets(W(Duo.viewFor(D, 0).m), 0)[0];
  try1(x, 0, 'mpbBuy', key, 'impersonate', t.who, t.id);
  try1(x, 1, 'mpbBuy', key, 'sabotage', WISPS);
  try1(x, 0, 'mpbBuy', key, 'insider');
  try1(x, 0, 'mpbUndo', key, 'insider');
  try1(x, 1, 'mpbBuy', fkey, 'cogmech');
  try1(x, 0, 'mpbBuy', fkey, 'fighter');
  const tl = tileFor(x, 0, SH, [8, 9]);
  try1(x, 0, 'place', SH, tl.col, tl.row);
  inStep(D);
  for (const seat of [2, 3]) {
    const v = Duo.viewFor(D, seat).m, r = Mpb.recOf(v, 0, key), f = Mpb.recOf(v, 0, fkey);
    assert.ok(!(r.data.imp || []).length && !Mpb.sabNow(v, r) && !r.data.insider && !r.skills.impersonate && !Mpb.facNow(v, f), 'seat ' + seat + ' sees none of this round\'s buys');
  }
});

check('full bot 2v2s, rounds 1 to 10, both kinds on both teams: no exception, team state equal, views in step, playback', () => {
  const used = { imp: 0, sab: 0, ins: 0, fac: 0, hands: 0 };
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 5000 + seed, [true, true, true, true]);
    for (const sd of [0, 1]) { addKind(D, sd, 'shadowDen'); addKind(D, sd, 'factory'); }
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      inStep(D);
      const m = D.lanes[0].m;
      for (const sd of [0, 1]) for (const r of Mpb.recs(m, sd)) {
        if (r.kind === 'shadowDen') { used.imp += Mpb.impNow(m, r).length; used.sab += Mpb.sabNow(m, r) ? 1 : 0; used.ins += r.data.insider && r.data.insider.round === m.round ? 1 : 0; }
        if (r.kind === 'factory' && Mpb.facNow(m, r)) used.fac++;
      }
      for (const R of D.lanes) for (const sd of [0, 1]) used.hands += R.m.armies[sd].filter(q => q.unit === SH && q.round === R.m.round).length;
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + m.round);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}`);
  }
  console.log('      bots used: ' + JSON.stringify(used));
  assert.ok(used.imp > 0 && used.sab > 0 && used.fac > 0, 'the bots use the Den\'s and the Factory\'s skills');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall B5 checks passed');
