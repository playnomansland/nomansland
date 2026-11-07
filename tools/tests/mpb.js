// Headless check of the 2v2 buildings framework (src/mpb.js, docs/MPB-2V2.md; group F, 2026-11-06): no server needed.
//  - placement: interior tiles only (all 8 around in the own zone, not flank tiles), 2 tiles of room round every other
//    building, MPB tiles taken for both teams' squads (Game.mpbAt in Game.occupied)
//  - team state in both lanes (m.mpb, m.mpbVote, m.vault), what each seat sees (the opponents don't see this round's
//    skills, votes or Vault moves)
//  - skills: the 'per' rules, costStep, who paid, take-backs (own only), Undo all keeps the teammate's
//  - the Vault: on the old treasury tiles, put / take limits and the put / take round, Compound interest, the Coin
//    golem (both click; stats and looks), destroyed: 80% lost, +50 to each opponent; the loan without a treasury
//  - artifacts at rounds 2 and 8 (mirrored, in no man's land, not flank tiles, 10+ tiles apart, two valid cards),
//    +50 to each player of the team that won one, summary.artifacts; no Engine part: nobody won
//  - the draft in rounds 3 and 9: both won / one each / one won / none won; a tower card replaces the Outpost (and in
//    round 9 the tower with its skills); no tower vote in 2v2
//  - the placement vote: same tile at once, two tiles -> one of them after 15 s, one vote, no vote, two votes in a row
//    (a mine's entrance and exit), bots follow their human teammate, the deploy clock never waits (6 Nov)
//  - a full bot 2v2, rounds 1 to 10, and the page's copy of each lane hashing as the server's after every action
// Run: node tools/tests/mpb.js
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

// a refereed 2v2; bots: which seats the AI plays
function match(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, bots);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, T, act, m: (L) => D.lanes[L].m };
}
// every seat ready, then the next round (round: the one to reach)
function playTo(x, round, hook) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    if (hook) hook(D);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  }
  if (D.phase !== 'end') assert.strictEqual(D.lanes[0].m.round, round, 'reached round ' + round); // (a match may end first: callers look at D.phase)
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };

// a test kind with one skill of each 'per' (never a draft card)
Mpb.def({ id: 'testKind', name: 'Test hut', short: 'tt', hp: 300, armor: 1, draft: false, skills: [
  { id: 'r', name: 'Once a round', cost: 20, per: 'round' },
  { id: 'rp', name: 'Once a round each', cost: 20, per: 'roundPlayer' },
  { id: 'mt', name: 'Once a match', cost: 30, per: 'match' },
  { id: 'b', name: 'Once per building', cost: 10, per: 'building' },
  { id: 'f', name: 'Many', cost: 50, costStep: 50, per: 'free' },
] });
// put a test hut on the first allowed tile in both lanes (as a placed vote would)
function addHut(D, sd) {
  const m = D.lanes[0].m, t = Mpb.autoSpot(m, sd, 'testKind', null);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, 'testKind', t.col, t.row);
  D.tbase[sd].mpb.push(copy(Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1])); // as if it stood when the round began (Undo all goes back to that)
  return Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1].key;
}

check('the Vault on the old treasury tiles, no treasury, no tower vote', () => {
  const x = match(3);
  for (const L of [0, 1]) {
    const m = x.m(L);
    assert.deepStrictEqual(Mpb.recs(m, 0).map(r => [r.kind, r.col, r.row]), [['vault', 6, 16]]);
    assert.deepStrictEqual(Mpb.recs(m, 1).map(r => [r.kind, r.col, r.row]), [['vault', 17, 2]]);
    assert.ok(!Game.treasuryOn(m), 'no treasury');
    assert.strictEqual(m.duoLane, L); assert.ok(m.duoTowers);
    assert.ok(!m.towerOffer, 'no tower offer');
  }
  playTo(x, 3);
  for (const L of [0, 1]) for (const sd of [0, 1]) {
    assert.ok(!Game.needsTowerPick(x.m(L), sd), 'no tower pick in 2v2');
    if (!x.m(L).towers[sd].type) assert.strictEqual(Game.towerType(x.m(L), sd).id, 'outpost', 'the Outpost until a tower card');
  }
  playTo(x, 5);
  for (const sd of [0, 1]) if (!x.m(0).towers[sd].type) assert.strictEqual(Game.towerType(x.m(0), sd).id, 'outpost', 'still the Outpost in round 5 (1v1 falls back to the Keep)');
  // 1v1 untouched: a 1v1 match in round 5 with no pick still gets the Keep
  const one = Ref.newMatch(units, matrix, Ref.cleanSettings({}, units), 9);
  one.round = 5; Game.ensureTower(one, 0); assert.strictEqual(Game.towerType(one, 0).id, 'keep');
  one.round = 3; assert.ok(Game.needsTowerPick(one, 0), '1v1 still picks in round 3');
});

check('placement: interior, spacing, MPB tiles taken for both teams', () => {
  const x = match(4), m = x.m(0);
  Duo.setTeams(x.D.lanes.map(R => R.m));
  // the edges of the zone: the back row, the front row, next to the flank columns
  for (const [c, r] of [[10, 18], [10, 12], [2, 15], [21, 15], [3, 18]]) assert.ok(!Mpb.spotOk(m, 0, 'oak', null, c, r), 'edge tile ' + c + ',' + r + ' refused');
  assert.ok(Mpb.interior(0, 3, 13) && Mpb.interior(0, 20, 17) && !Mpb.interior(0, 2, 13) && !Mpb.interior(0, 21, 17), 'interior: cols 3-20, rows 13-17');
  // spacing: within 2 tiles of the tower (17,16) or the Vault (6,15) refused, 3 away fine
  assert.ok(!Mpb.spotOk(m, 0, 'oak', null, 15, 15), 'two tiles from the tower');
  assert.ok(!Mpb.spotOk(m, 0, 'oak', null, 8, 14), 'two tiles from the Vault');
  assert.ok(Mpb.spotOk(m, 0, 'oak', null, 9, 13) || Game.occupied(m, 0, 9, 13), 'three from the Vault is fine (if free)');
  assert.ok(!Mpb.spotOk(m, 0, 'oak', null, 10, 5), 'never in the enemy zone');
  // all allowed tiles keep the rules
  const ok = Mpb.spots(m, 0, 'oak', null);
  assert.ok(ok.length > 10, 'room for buildings: ' + ok.length);
  for (const t of ok) { assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row)); assert.ok(!Game.occupied(m, 0, t.col, t.row)); }
  // a building's tile is taken for both teams (and both lanes' squads)
  const t = ok[0];
  for (const R of x.D.lanes) Mpb.addRec(R.m, 0, 'oak', t.col, t.row);
  for (const L of [0, 1]) for (const sd of [0, 1]) { assert.ok(Game.mpbAt(x.m(L), t.col, t.row)); assert.ok(Game.occupied(x.m(L), sd, t.col, t.row), 'taken for side ' + sd); assert.ok(!Game.spotFree(x.m(L), sd, t.col, t.row, 0)); }
  if (Game.nearBldg) for (const sd of [0, 1]) assert.ok(Game.nearBldg(m, sd, t.col + 1, t.row + 1) && Game.nearBldg(m, sd, t.col, t.row), 'next to a building for the Assassin (Game.mpbAt in nearBldg), side ' + sd);
  const ui = Object.keys(m.unlocks[0]).map(Number)[0];
  m.gold[0] += 1000;
  assert.ok(!x.act(0, 'place', ui, t.col, t.row).ok, 'A1 can\'t place on it');
  assert.ok(!x.act(1, 'place', ui, t.col, t.row).ok, 'A2 can\'t either');
  assert.ok(!x.act(0, 'place', ui, 6, 16).ok, 'nor on the Vault');
  // the coal mine's exit: no man's land, not flank tiles
  assert.ok(Mpb.spotOk(m, 0, 'coalMine', 'exit', 10, 8) && !Mpb.spotOk(m, 0, 'coalMine', 'exit', 0, 8) && !Mpb.spotOk(m, 0, 'coalMine', 'exit', 10, 14), 'the exit in no man\'s land only');
});

check('skills: per rules, costStep, who paid, take-backs, Undo all, opponents don\'t see this round\'s', () => {
  const x = match(5), { D } = x, a = x.m(0), b = x.m(1), key = addHut(D, 0);
  for (const m of [a, b]) m.gold[0] = 1000;
  const g = (L) => x.m(L).gold[0];
  // 'round': once for the team
  assert.ok(x.act(0, 'mpbBuy', key, 'r').ok, 'A1 buys r');
  assert.strictEqual(g(0), 980); assert.strictEqual(g(1), 1000, 'A2 paid nothing');
  sameTeam(D, 0);
  assert.deepStrictEqual(Mpb.recOf(b, 0, key).skills.r.by, [1, 0], 'who paid: lane 0');
  assert.ok(!x.act(1, 'mpbBuy', key, 'r').ok, 'r: once a round for the team');
  assert.ok(!x.act(1, 'mpbUndo', key, 'r').ok, 'A2 can\'t take back A1\'s buy');
  // 'roundPlayer': once each
  assert.ok(x.act(0, 'mpbBuy', key, 'rp').ok && x.act(1, 'mpbBuy', key, 'rp').ok, 'rp: each player once');
  assert.ok(!x.act(0, 'mpbBuy', key, 'rp').ok, 'rp: not twice');
  // 'match' and 'building'
  const key2 = addHut(D, 0);
  assert.ok(x.act(1, 'mpbBuy', key, 'mt').ok, 'mt once');
  assert.ok(!x.act(0, 'mpbBuy', key2, 'mt').ok, 'mt: once a match, across the kind\'s buildings');
  assert.ok(x.act(0, 'mpbBuy', key, 'b').ok && x.act(0, 'mpbBuy', key2, 'b').ok, 'b: once per building');
  assert.ok(!x.act(1, 'mpbBuy', key, 'b').ok, 'b: not twice on one');
  // 'free' with costStep (per player): 50, 100, 150 for A1; A2's first is 50
  const g0 = g(0);
  assert.strictEqual(Mpb.skillCost(a, 0, key, 'f'), 50);
  assert.ok(x.act(0, 'mpbBuy', key, 'f').ok && x.act(0, 'mpbBuy', key, 'f').ok);
  assert.strictEqual(g(0), g0 - 150, 'A1 paid 50 + 100');
  assert.strictEqual(Mpb.skillCost(b, 0, key, 'f'), 50, 'A2\'s first click is 50');
  assert.ok(x.act(1, 'mpbBuy', key, 'f').ok);
  assert.deepStrictEqual(Mpb.recOf(a, 0, key).skills.f.by, [2, 1]);
  assert.ok(x.act(0, 'mpbUndo', key, 'f').ok, 'A1 takes back their own last one');
  assert.strictEqual(g(0), g0 - 50, 'refunded what was paid (100)');
  sameTeam(D, 0);
  // the opponents: this round's skills hidden; the teammate sees them
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, key).skills.r, 'B1 doesn\'t see A1\'s skill of this round');
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 3).m, 0, key).skills.f, 'B2 neither');
  assert.ok(Mpb.recOf(Duo.viewFor(D, 1).m, 0, key).skills.r, 'A2 sees it');
  // Undo all: A1's buys go, A2's stay (in both lanes); A1 has their gold back
  const before = Mpb.recOf(a, 0, key).skills;
  assert.ok(before.rp.n === 2 && before.mt.n === 1);
  assert.ok(x.act(0, 'undoAll').ok);
  const after = Mpb.recOf(a, 0, key).skills;
  assert.ok(!after.r, 'A1\'s r is gone'); assert.strictEqual(after.rp.n, 1, 'A2\'s rp stays'); assert.strictEqual(after.mt.n, 1, 'A2\'s mt stays'); assert.strictEqual(after.f.n, 1, 'A2\'s f stays');
  assert.strictEqual(g(0), 1000, 'A1 has all their gold back');
  sameTeam(D, 0);
  // the next round: per-round skills open again, the fight shows the skills
  playTo(x, 2);
  assert.ok(Mpb.recOf(Duo.viewFor(D, 2).m, 0, key).skills.rp, 'seen after the fight');
  x.m(0).gold[0] += 100;
  assert.ok(x.act(0, 'mpbBuy', key, 'r').ok, 'r again in a new round');
});

check('the Vault: limits, put and take rounds, interest, the loan', () => {
  const x = match(6), { D } = x;
  for (const R of D.lanes) R.m.gold[0] = 1000;
  assert.ok(!x.act(0, 'vaultPut', 201).ok, 'not more than 200 a round');
  assert.ok(x.act(0, 'vaultPut', 150).ok && x.act(0, 'vaultPut', 50).ok, 'A1 puts 150 + 50');
  assert.ok(!x.act(0, 'vaultPut', 10).ok, 'A1\'s 200 is used up');
  assert.ok(x.act(1, 'vaultPut', 120).ok, 'A2 has their own 200');
  assert.ok(!x.act(1, 'vaultTake', 10).ok, 'a put round: no taking');
  assert.strictEqual(x.m(0).vault[0].gold, 320); sameTeam(D, 0);
  assert.strictEqual(x.m(0).gold[0], 800); assert.strictEqual(x.m(1).gold[0], 880);
  assert.strictEqual(Duo.viewFor(D, 2).m.vault[0].gold, 0, 'the opponents see the vault as the round began');
  assert.strictEqual(Duo.viewFor(D, 1).m.vault[0].gold, 320, 'the teammate sees it all');
  assert.ok(x.act(0, 'undoAll').ok);
  assert.strictEqual(x.m(0).vault[0].gold, 120, 'Undo all takes back A1\'s moves only'); assert.strictEqual(x.m(0).gold[0], 1000); sameTeam(D, 0);
  assert.ok(x.act(0, 'vaultPut', 200).ok);
  // interest: bought, then the next round's start adds 10%
  assert.ok(x.act(1, 'mpbBuy', 'v1', 'interest').ok, 'A2 buys Compound interest');
  assert.ok(!x.act(0, 'mpbBuy', 'v1', 'interest').ok, 'once a match');
  playTo(x, 2);
  const v = x.m(0).vault[0];
  assert.strictEqual(v.gold, 320 + 32, 'interest: +10%'); sameTeam(D, 0);
  // a take round
  for (const R of D.lanes) R.m.gold[0] = 0;
  assert.ok(x.act(1, 'vaultTake', 200).ok, 'A2 takes 200');
  assert.ok(!x.act(0, 'vaultPut', 10).ok, 'a take round: no putting');
  assert.ok(x.act(0, 'vaultTake', 152).ok && !x.act(0, 'vaultTake', 1).ok, 'only what is in it');
  assert.strictEqual(x.m(0).vault[0].gold, 0); assert.strictEqual(x.m(0).gold[0], 152); assert.strictEqual(x.m(1).gold[0], 200);
  // the loan: every player's own, no treasury or Bank needed
  const g = x.m(0).gold[0];
  assert.ok(Game.canTakeLoan(x.m(0), 0) && x.act(0, 'takeLoan').ok, 'the loan works in 2v2');
  assert.strictEqual(x.m(0).gold[0], g + Game.LOAN.gold); assert.strictEqual(x.m(1).gold[0], 200, 'the teammate\'s gold untouched');
});

check('the Coin golem: both click, stats and looks, take-back', () => {
  const x = match(7), { D } = x;
  for (const R of D.lanes) R.m.gold[0] = 1000;
  assert.ok(x.act(0, 'vaultPut', 200).ok && x.act(1, 'vaultPut', 200).ok);
  assert.ok(x.act(0, 'mpbBuy', 'v1', 'golem').ok, 'A1 clicks');
  assert.ok(!Mpb.golemOf(x.m(0), 0), 'no golem with one click');
  assert.ok(x.act(1, 'mpbBuy', 'v1', 'golem').ok, 'A2 clicks: summoned');
  const gl = Mpb.golemOf(x.m(0), 0);
  assert.ok(gl && gl.g === 400 && x.m(1).vault[0].gold === 0, 'all the gold spent on it'); sameTeam(D, 0);
  assert.strictEqual(x.m(0).gold[0], 700); assert.strictEqual(x.m(1).gold[0], 700, 'each paid 100');
  assert.ok(x.act(1, 'mpbUndo', 'v1', 'golem').ok, 'A2 takes it back');
  assert.ok(!Mpb.golemOf(x.m(0), 0) && x.m(0).vault[0].gold === 400, 'the gold is back in the vault');
  assert.ok(x.act(1, 'mpbBuy', 'v1', 'golem').ok);
  // stats: g = 400
  const u = Mpb.golemUnit(400);
  assert.deepStrictEqual([u.hp, u.hit, u.aps, u.range, u.splash, u.speed, u.defVal, u.bodies, u.tier, u.mpbSkin], [1500, 78, 0.7, 3, 1.5, 4, 2 + 400 / 250, 1, 3, 'silver']);
  assert.strictEqual(Mpb.golemUnit(399).mpbSkin, 'bronze'); assert.strictEqual(Mpb.golemUnit(900).mpbSkin, 'gold'); assert.strictEqual(Mpb.golemUnit(5000).defVal, 8, 'armor at most 8');
  // the fight: the golem stands in front of the vault (lane 0 builds it once), the vault doesn't count as a unit
  Duo.settle(D.lanes.map(R => R.m));
  const bt = Duo.battle(D.lanes.map(R => R.m));
  const gb = bt.bodies.filter(b => b.u.mpb === 'golem'), vb = bt.bodies.filter(b => b.u.mpb === 'vault');
  assert.strictEqual(gb.length, 1, 'one golem'); assert.strictEqual(gb[0].side, 0); assert.strictEqual(gb[0].u.hp, 1500);
  assert.strictEqual(vb.length, 2, 'one vault a team');
  assert.ok(vb.every(b => b.u.structure && b.u.lesser && b.u.hp === Mpb.VAULT.hp && b.u.defVal === Mpb.VAULT.armor), 'a structure: not a unit for winning');
  assert.ok(Duo.teamBody(vb[0].squad) && Duo.teamBody(gb[0].squad), 'team bodies');
  // the opponents don't see the golem until the fight
  assert.ok(!Mpb.golemOf(Duo.viewFor(D, 2).m, 0), 'hidden from B1');
  playTo(x, 2);
  assert.ok(!Mpb.golemOf(x.m(0), 0), 'one round only');
});

check('MPB structures don\'t win a round, the Vault destroyed: 80% lost, +50 to each opponent', () => {
  const x = match(8, [true, true, true, true]), { D } = x;
  // only buildings left on side 1: side 0 wins the round
  const lanes = D.lanes.map(R => R.m);
  Duo.settle(lanes);
  const A = [], B = [];
  const bt0 = Duo.battle(lanes);
  for (const b of bt0.bodies) (b.side === 0 ? A : B).push(b);
  const onlyB = B.filter(b => b.u.structure);
  const bt = Engine.createBattle(A.filter(b => !b.u.structure).slice(0, 3), onlyB, { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } }, {});
  for (let k = 0; k < 20 && bt.step(); k++) {}
  const r = bt.result();
  assert.strictEqual(r.survivors[1], 0, 'side 1 has no unit that counts (Vault, tower)');
  // destroyed: afterFight with a result where side 0's vault fell
  for (const m of lanes) { m.vault[0].gold = 333; }
  const sums = lanes.map(m => ({ round: m.round }));
  const g = lanes.map(m => m.gold[1]);
  const res = { squads: { ['0:' + Mpb.squadOf(0)]: { side: 0, squad: Mpb.squadOf(0), total: 1, alive: 0 } } };
  Mpb.afterFight(lanes, res, sums, [200, 200]);
  assert.strictEqual(lanes[0].vault[0].gold, 333 - 260, '80% of 333 = 266, down to 10s: 260 lost');
  assert.strictEqual(Mpb.recs(lanes[0], 0)[0].fell, lanes[0].round);
  assert.deepStrictEqual(lanes.map(m => m.gold[1]), g.map(v => v + 50), 'each opponent player +50');
  assert.ok(sums.every(s => s.mpbNews[0].some(n => n.kind === 'vault' && n.lost === 260)), 'the news in both summaries');
});

check('artifacts: rounds 2 and 8, mirrored, apart, cards; rewards; none without the Engine part', () => {
  let seen = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const x = match(seed, [true, true, true, true]), { D } = x;
    playTo(x, 2);
    for (const L of [0, 1]) {
      const A = x.m(L).artifacts;
      assert.ok(A && A.round === 2 && A.list.length === 2, 'two artifacts in round 2');
      const [a, b] = A.list;
      assert.ok(a.col === Game.COLS - 1 - b.col && a.row === Game.ROWS - 1 - b.row, 'point mirrors');
      assert.ok(Math.hypot(a.col - b.col, a.row - b.row) >= 10, 'at least 10 tiles apart');
      assert.ok(a.row === (Game.ROWS - 1) / 2 && b.row === a.row, 'both on the middle row (2026-11-07)');
      for (const t of A.list) { assert.ok(Game.inNoMans(t.row) && !Game.isFlank(0, t.col, t.row) && !Game.isFlank(1, t.col, t.row), 'in no man\'s land, not flank tiles'); }
      assert.ok(a.card && b.card && (a.card.type !== b.card.type || a.card.id !== b.card.id), 'two different cards');
      for (const c of [a.card, b.card]) assert.ok(c.type === 'tower' ? Game.TOWER_TYPES.some(t => t.id === c.id) : !!Mpb.KINDS[c.id] && c.id !== 'vault' && Mpb.KINDS[c.id].draft !== false, 'a valid card ' + JSON.stringify(c));
    }
    assert.deepStrictEqual(x.m(0).artifacts, x.m(1).artifacts, 'the same in both lanes');
    assert.deepStrictEqual(Duo.viewFor(D, 2).m.artifacts, x.m(0).artifacts, 'the opponents see them too, cards included');
    const opts = Mpb.artifactsFor(x.m(0));
    assert.ok(opts.length === 2 && opts.every(o => o.r === 9 && o.cap === 100 && isFinite(o.x) && isFinite(o.y)), 'Engine opts.artifacts');
    // the fight: without the Engine's artifacts (group A) nobody wins, nothing breaks
    const g = D.lanes.map(R => R.m.gold.slice());
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    const s = D.summary[0];
    assert.ok(Array.isArray(s.artifacts) && s.artifacts.length === 2);
    if (s.artifacts.some(a => a.won >= 0)) seen++;
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
    playTo(x, 8);
    if (D.phase === 'end') continue; // a match that ended in round 7
    const A8 = x.m(0).artifacts;
    assert.ok(A8 && A8.round === 8, 'again in round 8');
    for (const c of A8.list.map(a => a.card)) {
      if (c.type === 'tower') assert.ok(![0, 1].some(sd => x.m(0).towers[sd].type === c.id), 'not a tower type a team has');
      else assert.ok(!Mpb.has(x.m(0), 0, c.id) && !Mpb.has(x.m(0), 1, c.id), 'not a kind a team has');
    }
    if (seed > 3) continue;
  }
  if (!Engine.createBattle.toString().includes('artifacts')) assert.strictEqual(seen, 0, 'no Engine part: nobody wins');
  // rewards with a result that has them
  const x = match(2, [true, true, true, true]); playTo(x, 2);
  const lanes = x.D.lanes.map(R => R.m), g = lanes.map(m => m.gold.slice()), sums = lanes.map(m => ({ round: m.round }));
  Mpb.afterFight(lanes, { squads: {}, artifacts: [{ won: 1 }, { won: -1 }] }, sums, [200, 200]);
  assert.deepStrictEqual(lanes.map(m => m.gold), g.map(v => [v[0], v[1] + 50]), '+50 to each player of the team that won one');
  assert.deepStrictEqual(sums[0].artifacts.map(a => a.won), [1, -1]); assert.deepStrictEqual(sums[1].artifacts.map(a => a.gold), [50, 0]);
  assert.deepStrictEqual(lanes[1].artifacts.list.map(a => a.won), [1, -1], 'kept for the draft in both lanes');
});

// a match played to round 2's fight with the artifacts' winners set by hand (won: [w0, w1]), then round 3
function draftWith(seed, won, bots = [true, true, true, true]) {
  const x = match(seed, bots);
  playTo(x, 2);
  playTo(x, 3, (D) => { for (const R of D.lanes) R.m.artifacts.list.forEach((a, i) => { a.won = won[i]; }); });
  return x;
}
const give = (d) => d.cards.map((c, i) => [d.owner[i], c]);
const teamHas = (m, team, c) => c.type === 'tower' ? m.towers[team].type === c.id : Mpb.has(m, team, c.id);

check('the draft: both won, one each, one won, none won', () => {
  { const x = draftWith(21, [0, 1]), d = x.m(0).draft;
    assert.strictEqual(d.how, 'split'); assert.deepStrictEqual(d.owner, [0, 1], 'each gets its own');
    for (const [t, c] of give(d)) for (const L of [0, 1]) assert.ok(teamHas(x.m(L), t, c), 'team ' + t + ' has ' + c.id + ' in lane ' + L); }
  { const x = draftWith(22, [1, -1]), d = x.m(0).draft;
    assert.strictEqual(d.how, 'one'); assert.deepStrictEqual(d.owner, [1, 0], 'the unwon card to the team with none'); }
  { const x = draftWith(23, [-1, 0]), d = x.m(0).draft;
    assert.deepStrictEqual(d.owner, [1, 0]); }
  { const x = draftWith(24, [1, 1]), d = x.m(0).draft;
    assert.strictEqual(d.how, 'both'); assert.strictEqual(d.first, 1); assert.ok(d.owner[0] === 1 || d.owner[1] === 1);
    assert.ok(d.owner.includes(0), 'the other team gets the card left'); assert.ok(d.done); }
  { const firsts = new Set();
    for (let s = 30; s < 40; s++) { const d = draftWith(s, [-1, -1]).m(0).draft; assert.strictEqual(d.how, 'none'); firsts.add(d.first); assert.ok(d.owner[0] != null && d.owner[0] !== d.owner[1]); }
    assert.strictEqual(firsts.size, 2, 'a coin flip: both teams pick first sometimes'); }
  // humans: the picking team picks (either player, the first pick counts), 15 s, then a seeded pick
  { const x = draftWith(25, [0, 0], [false, false, false, false]), { D } = x, d = x.m(0).draft;
    assert.ok(Mpb.draftOpen(x.m(0)) && d.first === 0);
    assert.ok(Duo.mpbPending(D) && D.deadline > 0 && !D.held, 'the deploy clock runs while the draft is open (updated 6 Nov: it used to wait; "Votes don\'t hold the clock")');
    assert.ok(Duo.clocks(D, 0, x.T).draft === Mpb.DRAFT_MS && Duo.clocks(D, 3, x.T).draft === Mpb.DRAFT_MS, 'everyone sees the draft clock');
    assert.ok(!x.act(2, 'draftPick', 0).ok, 'the other team can\'t pick');
    assert.ok(x.act(1, 'draftPick', 1).ok, 'A2 picks card 1');
    assert.ok(!x.act(0, 'draftPick', 0).ok, 'the first pick counts');
    for (const L of [0, 1]) assert.deepStrictEqual(x.m(L).draft.owner, [1, 0]);
    for (const [t, c] of give(x.m(0).draft)) for (const L of [0, 1]) assert.ok(teamHas(x.m(L), t, c)); }
  { const x = draftWith(26, [1, 1], [false, false, false, false]), { D } = x;
    assert.ok(Mpb.draftOpen(x.m(0)));
    assert.ok(!Duo.tick(D, x.T + Mpb.DRAFT_MS - 10) && Mpb.draftOpen(x.m(0)), 'still open before 15 s');
    Duo.tick(D, x.T + Mpb.DRAFT_MS + 1);
    assert.ok(!Mpb.draftOpen(x.m(0)) && x.m(1).draft.owner[0] != null, 'a seeded pick after 15 s'); }
});

check('a tower card replaces the Outpost (round 3) and the tower with its skills (round 9)', () => {
  let done = false;
  for (let s = 40; s < 80 && !done; s++) {
    const x = draftWith(s, [0, 1]), d = x.m(0).draft, i = d.cards.findIndex(c => c.type === 'tower');
    if (i < 0) continue;
    const t = d.owner[i], id = d.cards[i].id;
    for (const L of [0, 1]) { assert.strictEqual(x.m(L).towers[t].type, id); assert.strictEqual(Game.towerType(x.m(L), t).id, id); assert.ok(Game.towerPicked(x.m(L), t)); }
    // round 9: a new tower card for that team replaces it, its skill goes
    const { D } = x;
    for (const R of D.lanes) { R.m.towerSkill = R.m.towerSkill || [0, 0]; R.m.towerSkill[t] = 3; }
    playTo(x, 8);
    if (D.phase === 'end') continue;
    playTo(x, 9, (DD) => { for (const R of DD.lanes) R.m.artifacts.list.forEach((a, k) => { a.won = t; a.card = k === 0 ? { type: 'tower', id: Game.TOWER_TYPES.find(y => y.id !== id).id } : a.card.type === 'tower' ? { type: 'mpb', id: 'jail' } : a.card; }); });
    if (D.phase === 'end') continue;
    const d9 = x.m(0).draft;
    assert.strictEqual(d9.how, 'both');
    const k = d9.owner.indexOf(t), c9 = d9.cards[k];
    if (c9.type === 'tower') for (const L of [0, 1]) { assert.strictEqual(x.m(L).towers[t].type, c9.id, 'replaced'); assert.ok(!x.m(L).towerSkill[t], 'the old tower\'s skill goes'); }
    done = true;
  }
  assert.ok(done, 'a seed with a tower card');
});

check('the placement vote: same tile, two tiles, one vote, none, two in a row, bots', () => {
  // humans in team A: card 0 made the oak (by hand) for team 0
  const open = (seed, kind = 'oak', bots = [false, false, false, false]) => {
    const x = match(seed, bots);
    for (const R of x.D.lanes) Mpb.queue(R.m, 0, kind);
    x.D.tbase[0] = Duo.teamState(x.D.lanes[0].m, 0); // as if the vote opened when the round began
    Duo.tick(x.D, x.T); // the clock opens
    return x;
  };
  { const x = open(51), { D } = x, m = x.m(0);
    Duo.setTeams(D.lanes.map(R => R.m));
    const [t1, t2] = Mpb.spots(m, 0, 'oak', null);
    assert.ok(Duo.mpbPending(D) && D.deadline > 0 && !D.held, 'the deploy clock runs while the vote is open (updated 6 Nov: it used to wait)');
    assert.strictEqual(Duo.clocks(D, 0, x.T).vote, Mpb.VOTE_MS); assert.strictEqual(Duo.clocks(D, 2, x.T).vote, 0, 'the other team has no vote');
    assert.ok(!x.act(0, 'mpbVote', 10, 18).ok, 'not on an edge tile');
    assert.ok(x.act(0, 'mpbVote', t1.col, t1.row).ok);
    assert.deepStrictEqual(Duo.viewFor(D, 1).m.mpbVote[0][0].votes[0], t1, 'the teammate sees the vote');
    assert.deepStrictEqual(Duo.viewFor(D, 2).m.mpbVote[0][0].votes, [null, null], 'the opponents don\'t');
    assert.ok(!x.act(2, 'mpbVote', t1.col, Game.ROWS - 1 - t1.row).ok, 'the other team has nothing to vote on');
    assert.ok(x.act(1, 'mpbVote', t1.col, t1.row).ok, 'A2: the same tile');
    for (const L of [0, 1]) assert.ok(Mpb.recs(x.m(L), 0).some(r => r.kind === 'oak' && r.col === t1.col && r.row === t1.row), 'placed at once, both lanes');
    assert.ok(!Duo.mpbPending(D) && D.deadline > 0, 'the clock still runs');
    sameTeam(D, 0);
    assert.ok(!x.act(0, 'undoAll').ok || Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak'), 'Undo all keeps a placed building'); }
  { const picks = new Set();
    for (let s = 60; s < 70; s++) {
      const x = open(s), { D } = x; Duo.setTeams(D.lanes.map(R => R.m));
      const [t1, t2] = Mpb.spots(x.m(0), 0, 'oak', null);
      assert.ok(x.act(0, 'mpbVote', t1.col, t1.row).ok && x.act(1, 'mpbVote', t2.col, t2.row).ok);
      assert.ok(Duo.mpbPending(D), 'two tiles: not yet');
      Duo.tick(D, x.T + Mpb.VOTE_MS - 1); assert.ok(Duo.mpbPending(D), 'not before 15 s');
      Duo.tick(D, x.T + Mpb.VOTE_MS);
      const r = Mpb.recs(x.m(1), 0).find(q => q.kind === 'oak');
      assert.ok(r && [t1, t2].some(t => t.col === r.col && t.row === r.row), 'one of the two');
      picks.add(r.col + ',' + r.row === t1.col + ',' + t1.row ? 1 : 2);
      sameTeam(D, 0);
    }
    assert.strictEqual(picks.size, 2, 'seeded: sometimes one, sometimes the other'); }
  { const x = open(71), { D } = x; Duo.setTeams(D.lanes.map(R => R.m));
    const t2 = Mpb.spots(x.m(0), 0, 'oak', null)[3];
    assert.ok(x.act(1, 'mpbVote', t2.col, t2.row).ok);
    Duo.tick(D, x.T + Mpb.VOTE_MS);
    assert.ok(Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak' && r.col === t2.col && r.row === t2.row), 'only one voted: theirs'); }
  { const x = open(72), { D } = x; Duo.setTeams(D.lanes.map(R => R.m));
    const a = Mpb.autoSpot(x.m(0), 0, 'oak', null);
    assert.strictEqual(Duo.due(D, x.T), x.T + Mpb.VOTE_MS, 'the server wakes up for it');
    Duo.tick(D, x.T + Mpb.VOTE_MS);
    assert.ok(Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak' && r.col === a.col && r.row === a.row), 'nobody voted: the first allowed tile'); }
  { const x = open(73, 'coalMine'), { D } = x; Duo.setTeams(D.lanes.map(R => R.m));
    const t = Mpb.autoSpot(x.m(0), 0, 'coalMine', null);
    assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok, 'the entrance');
    const head = Mpb.voteHead(x.m(1), 0);
    assert.ok(head && head.part === 'exit', 'then the exit, one vote after the other');
    assert.ok(Duo.mpbPending(D) && Duo.clocks(D, 0, x.T + 1).vote > 0);
    const e = Mpb.autoSpot(x.m(0), 0, 'coalMine', 'exit');
    assert.ok(Game.inNoMans(e.row));
    assert.ok(x.act(1, 'mpbVote', e.col, e.row).ok && x.act(0, 'mpbVote', e.col, e.row).ok);
    const r = Mpb.recs(x.m(0), 0).find(q => q.kind === 'coalMine');
    assert.deepStrictEqual(r.parts.exit, e); assert.ok(Game.mpbAt(x.m(1), e.col, e.row), 'its exit tile is taken too');
    assert.ok(!Duo.mpbPending(D)); sameTeam(D, 0); }
  { const x = open(74, 'oak', [false, true, true, true]), { D } = x; Duo.setTeams(D.lanes.map(R => R.m));
    const head = Mpb.voteHead(x.m(0), 0), a = Mpb.autoSpot(x.m(0), 0, 'oak', null);
    assert.deepStrictEqual(head.votes[1], a, 'the bot voted at once (the first allowed tile)');
    const t = Mpb.spots(x.m(0), 0, 'oak', null)[5];
    assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok);
    assert.ok(Mpb.recs(x.m(1), 0).some(r => r.kind === 'oak' && r.col === t.col && r.row === t.row), 'the bot takes the human\'s tile: placed at once'); }
  { const x = match(75, [true, true, true, true]);
    for (const R of x.D.lanes) { Mpb.queue(R.m, 1, 'jail'); Mpb.queue(R.m, 1, 'school'); }
    Duo.tick(x.D, x.T);
    for (let k = 0; k < 4; k++) Duo.setReady(x.D, k, true, x.T);
    assert.ok(['jail', 'school'].every(k => Mpb.recs(x.m(0), 1).some(r => r.kind === k)), 'bots: both placed before the fight'); }
});

check('the page\'s copy hashes as the server\'s after every action (vault, skills, votes, draft)', () => {
  const x = draftWith(25, [0, 0], [false, false, false, false]), { D } = x;
  const page = (seat) => W(Duo.viewFor(D, seat).m);
  const try1 = (seat, fn, ...a) => {
    const sd = Duo.SEATS[seat].side, pm = page(seat);
    const local = Game[fn](pm, sd, ...a);
    const r = x.act(seat, fn, ...a);
    assert.strictEqual(!!local, !!r.ok, fn + ' allowed on the page as on the server');
    if (r.ok) {
      const fresh = Duo.viewFor(D, seat).m;
      assert.strictEqual(Ref.sideHash(fresh, sd), r.h, fn + ': the view hashes as the server');
      // a bot or the teammate may have changed the team again (then the page asks for a sync, as for a shared tower buy)
      if (!['mpbVote'].includes(fn)) assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
    }
    return r;
  };
  for (const R of D.lanes) R.m.gold[0] += 600;
  try1(0, 'draftPick', 0);
  try1(0, 'vaultPut', 100);
  try1(1, 'vaultPut', 60);
  try1(0, 'mpbBuy', 'v1', 'interest');
  try1(1, 'mpbBuy', 'v1', 'golem');
  try1(0, 'mpbBuy', 'v1', 'golem');
  try1(1, 'mpbUndo', 'v1', 'golem');
  try1(0, 'takeLoan');
  const head = Mpb.voteHead(x.m(0), 0);
  if (head) { Duo.setTeams(D.lanes.map(R => R.m)); const t = Mpb.autoSpot(x.m(0), 0, head.kind, head.part); try1(0, 'mpbVote', t.col, t.row); try1(1, 'mpbVote', t.col, t.row); }
  for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
});

check('a full bot 2v2, rounds 1 to 10: no exception, team state equal, views in step, playback', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 1000 + seed, [true, true, true, true]);
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + D.lanes[0].m.round);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    const m = D.lanes[0].m;
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, buildings ${[0, 1].map(sd => Mpb.recs(m, sd).map(r => r.kind).join('+')).join(' | ')}, towers ${[0, 1].map(sd => Game.towerType(m, sd).id).join(' / ')}`);
  }
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall MPB checks passed');
