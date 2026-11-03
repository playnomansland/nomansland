// Headless check of 2v2 (src/duo.js; one shared board since 2026-11-03): no server needed.
//  - the board: Game's 'duo' map, 24 x 18, two flank columns on each edge, one tower and one treasury per team
//  - the fight: both lanes' bodies on the one board, only lane 0's tower/treasury/walls, ids split back exactly
//  - team tiles: a teammate's squad takes its tile, the other opponent's squads hold theirs
//  - whole matches with four bots: no two squads of a team on one tile, one tower type per team, shared health,
//    the same result when played back from pre
//  - the refereed match D: no leaders, the tower vote, shared tower buys (only the buyer takes one back), Undo all,
//    what each seat sees, Ready, forfeit, rematch, save / load, the clock
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
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };

const lane = (seed) => Ref.newMatch(units, matrix, Ref.cleanSettings({}, units) && { ...Ref.cleanSettings({}, units), map: Duo.MAP, noChars: true }, seed);
const ui = (name) => units.findIndex(u => u.name === name);
function setup(lanes) { lanes.forEach((m, L) => { Duo.setTeam(lanes, L); for (const sd of [0, 1]) { Game.choosePack(m, sd, 0); Game.aiDeploy(m, sd); } }); }
// no two squads of one side on a tile, across both lanes
function clashes(lanes) {
  const seen = new Set(); let n = 0;
  for (const m of lanes) for (const sd of [0, 1]) for (const q of m.armies[sd]) { if (q.in != null) continue; const k = sd + ':' + q.col + ',' + q.row; if (seen.has(k)) n++; seen.add(k); }
  return n;
}
const freeTile = (m, sd, unit) => { for (const row of Game.zoneRows(sd)) for (let c = 0; c < Game.COLS; c++) if (Game.canPlaceAt(m, sd, c, row, unit) && Game.spotFree(m, sd, c, row, unit)) return [c, row]; return null; };

check('the 2v2 board', () => {
  const m = lane(3);
  assert.strictEqual(m.map.id, 'duo');
  assert.strictEqual(Game.COLS, 24); assert.strictEqual(Game.ROWS, 18);
  assert.deepStrictEqual(Game.towerSpot(m, 0), { col: 12, row: 16 }); assert.deepStrictEqual(Game.towerSpot(m, 1), { col: 11, row: 1 });
  assert.ok(Game.treasuryOn(m) && Game.treasurySpot(m, 0) && Game.treasurySpot(m, 1));
  const cols = new Set(Game.flankTiles(0).map(t => t.col));
  assert.deepStrictEqual([...cols].sort((a, b) => a - b), [0, 1, 22, 23], 'two flank columns on each edge');
  assert.ok(!Game.MAPS.some(x => x.id === 'duo'), 'not offered as a 1v1 map');
});

check('one board: one tower and treasury per team, lane 1 ids moved and split back', () => {
  const a = lane(11), b = lane(12); [a, b].forEach(m => { m.round = 1; }); setup([a, b]);
  assert.strictEqual(clashes([a, b]), 0, 'package squads never share a tile');
  Duo.settle([a, b]);
  const bt = Duo.battle([a, b]);
  for (const sd of [0, 1]) {
    assert.strictEqual(bt.bodies.filter(x => x.side === sd && x.squad === -2).length, 1, 'one tower for side ' + sd);
    assert.strictEqual(bt.bodies.filter(x => x.side === sd && x.squad === Game.TREASURY_SQ).length, 1, 'one treasury for side ' + sd);
    assert.ok(!bt.bodies.some(x => x.side === sd && Duo.laneOfId(x.squad) === 1 && Duo.teamBody(Duo.unmap(x.squad))), 'no lane 1 tower bodies');
  }
  const l1 = bt.bodies.filter(x => x.lane === 1);
  assert.ok(l1.length && l1.filter(x => x.squad >= 0).every(x => x.squad >= Duo.OFF), 'lane 1 ids moved');
  while (bt.step()) {}
  const res = bt.result();
  for (const L of [0, 1]) {
    const m = [a, b][L], r = Duo.laneResult(res, L, m);
    for (const sd of [0, 1]) for (const sq of m.armies[sd]) assert.ok(r.squads[sd + ':' + sq.id], `lane ${L} side ${sd} squad ${sq.id} has its result`);
    for (const sd of [0, 1]) assert.ok(r.squads[sd + ':' + Game.TREASURY_SQ], `lane ${L} sees the shared treasury`);
    if (L === 1) assert.ok(!r.squads['0:-2'] && !r.squads['1:-2'], 'the tower counts in lane 0 only');
  }
});

check('team tiles: a teammate takes the tile, the other opponent holds theirs', () => {
  const a = lane(21), b = lane(22);
  for (const m of [a, b]) { m.armies = [[], []]; for (const sd of [0, 1]) { m.pack[sd] = 0; m.chars[sd] = null; } }
  const sk = ui('Skeleton Archers');
  for (const m of [a, b]) for (const sd of [0, 1]) m.unlocks[sd][sk] = 1;
  a.armies[0].push({ id: 5, unit: sk, col: 6, row: 14, round: 1, xp: 0, level: 0, cost: 100 });
  Duo.setTeams([a, b]);
  assert.ok(!Game.place(b, 0, sk, 6, 14), 'the teammate\'s tile is taken');
  assert.ok(Game.place(b, 0, sk, 7, 14), 'the tile beside it is free');
  // the other opponent's squad from an earlier round holds its tile (as your own opponent's does)
  a.round = b.round = 2;
  a.armies[1].push({ id: 9, unit: sk, col: 3, row: 4, round: 1, xp: 0, level: 0, cost: 100 });
  Duo.setTeams([a, b]);
  assert.ok(Game.enemyHolds(b, 0, 3, 4), 'held by the other opponent');
  assert.ok(Game.teamArmy(b, 0).every(q => q.id >= Duo.OFF), 'ids moved in m.team');
});

check('whole matches with four bots: shared tiles, one tower per team, team health, playback', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12;
    Duo.start(D, units, matrix, T, seed, [true, true, true, true]);
    assert.strictEqual(D.phase, 'deploy');
    assert.ok(D.lanes.every(R => R.m.chars.every(c => c == null)), 'no leaders');
    let rounds = 0;
    while (D.phase !== 'end' && rounds < 40) {
      T += 1000;
      assert.strictEqual(clashes(D.lanes.map(R => R.m)), 0, 'no two squads of a team on one tile');
      const f = Duo.tick(D, T + 200000);
      assert.ok(f, 'the clock starts the fight');
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      const res = bt.result();
      assert.strictEqual(res.winner, f.summaries[0].duo.winner, 'playback: same winner');
      assert.deepStrictEqual(D.lanes[0].m.hp, D.hp); assert.deepStrictEqual(D.lanes[1].m.hp, D.hp);
      assert.deepStrictEqual(f.summaries[0].dmg, f.summaries[1].dmg, 'both lanes show the team damage');
      if (D.lanes[0].m.round >= Game.TOWER_PICK_ROUND) for (const sd of [0, 1]) assert.strictEqual(D.lanes[0].m.towers[sd].type, D.lanes[1].m.towers[sd].type, 'one tower type per team');
      for (const sd of [0, 1]) for (const f2 of ['towerSkill', 'bwalls']) assert.deepStrictEqual(D.lanes[0].m[f2][sd], D.lanes[1].m[f2][sd], 'shared ' + f2);
      rounds++;
      if (D.phase === 'result') { for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T); assert.strictEqual(D.phase, 'deploy'); }
    }
    assert.strictEqual(D.phase, 'end');
    assert.ok(D.hp[0] <= 0 || D.hp[1] <= 0);
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, winner ${D.lanes[0].m.winner}`);
  }
});

// a match of four humans moved to round 3 (the vote) with every pick done
function toRound3(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  let T = 1e12;
  Duo.start(D, units, matrix, T, seed, bots);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok, 'seat ' + k + ' picks');
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  }
  assert.strictEqual(D.lanes[0].m.round, Game.TOWER_PICK_ROUND);
  return { D, T };
}

check('the tower vote: same pick, coin flip, a human beats the AI', () => {
  { const { D, T } = toRound3(5);
    const ch = Game.towerChoices(D.lanes[0].m, 0).map(x => x.id);
    assert.ok(!Duo.act(D, 0, { seq: 10, fn: 'buyTowerSkill', a: [] }, T).ok, 'no tower buys before the vote');
    assert.ok(Duo.act(D, 0, { seq: 11, fn: 'setTowerType', a: [ch[0]] }, T).ok);
    assert.ok(Duo.viewFor(D, 1).m.team.vote === ch[0], 'the teammate sees the vote');
    assert.ok(!Duo.viewFor(D, 2).m.team.vote, 'the other team doesn\'t');
    const ch1 = Game.towerChoices(D.lanes[1].m, 0).map(x => x.id), other = ch1.find(id => id !== ch[0]) || ch1[0];
    const r = Duo.act(D, 1, { seq: 11, fn: 'setTowerType', a: [other] }, T);
    assert.ok(r.ok);
    const v = D.vote[0];
    assert.ok(v && v.flip === (other !== ch[0]) && [ch[0], other].includes(v.type));
    assert.strictEqual(D.lanes[0].m.towers[0].type, v.type); assert.strictEqual(D.lanes[1].m.towers[0].type, v.type);
    assert.strictEqual(r.h, Ref.sideHash(D.lanes[1].m, 0), 'the fingerprint is the settled lane\'s');
  }
  { const { D, T } = toRound3(6, [false, true, true, true]); // seat 1 (A2) is the AI: it voted at the round's start
    const botVote = D.lanes[1].m.towers[0].type, mine = Game.towerChoices(D.lanes[0].m, 0).map(x => x.id).find(id => id !== botVote);
    assert.ok(Duo.act(D, 0, { seq: 11, fn: 'setTowerType', a: [mine] }, T).ok);
    assert.strictEqual(D.lanes[1].m.towers[0].type, mine, 'the human\'s vote wins');
    assert.strictEqual(D.vote[0].flip, false);
  }
});

check('shared tower buys: both lanes get it, only the buyer takes it back, Undo all', () => {
  const { D, T } = toRound3(7);
  const [a, b] = D.lanes.map(R => R.m);
  const pick = (sd) => (Game.towerChoices(a, sd).find(x => x.skill) || Game.towerChoices(a, sd)[0]).id;
  for (let k = 0; k < 4; k++) { const st = Duo.SEATS[k]; Duo.act(D, k, { seq: 20, fn: 'setTowerType', a: [pick(st.side)] }, T); }
  assert.strictEqual(a.towers[0].type, pick(0)); assert.strictEqual(b.towers[0].type, pick(0));
  assert.ok(Game.towerType(a, 0).skill, 'a tower with a skill on offer (seed)');
  const g0 = a.gold[0], g1 = b.gold[0];
  assert.ok(Duo.act(D, 0, { seq: 21, fn: 'buyTowerSkill', a: [] }, T).ok, 'A1 buys Guards');
  assert.ok(a.towerSkill[0] > 0 && b.towerSkill[0] > 0, 'both lanes have it');
  assert.strictEqual(a.gold[0], g0 - Game.TOWER_SKILL.cost); assert.strictEqual(b.gold[0], g1, 'A2 paid nothing');
  assert.ok(!Duo.act(D, 1, { seq: 21, fn: 'buyTowerSkill', a: [] }, T).ok, 'A2 can\'t buy it again');
  assert.ok(!Duo.act(D, 1, { seq: 22, fn: 'undoTowerSkill', a: [] }, T).ok, 'A2 can\'t take back A1\'s buy');
  assert.ok(Duo.act(D, 0, { seq: 22, fn: 'undoTowerSkill', a: [] }, T).ok, 'A1 takes it back');
  assert.ok(!a.towerSkill[0] && !b.towerSkill[0]); assert.strictEqual(a.gold[0], g0);
  // A2 buys it, A1 places a squad; A1's Undo all keeps A2's buy, A2's Undo all takes it back
  assert.ok(Duo.act(D, 1, { seq: 23, fn: 'buyTowerSkill', a: [] }, T).ok);
  const sk = Object.keys(a.unlocks[0]).map(Number)[0], t = freeTile(a, 0, sk);
  assert.ok(Duo.act(D, 0, { seq: 23, fn: 'place', a: [sk, t[0], t[1]] }, T).ok);
  assert.ok(Duo.act(D, 0, { seq: 24, fn: 'undoAll', a: [] }, T).ok);
  assert.ok(a.towerSkill[0] > 0 && b.towerSkill[0] > 0, 'A2\'s buy stays for both');
  assert.strictEqual(a.gold[0], g0, 'A1 has their gold back');
  assert.ok(Duo.act(D, 1, { seq: 24, fn: 'undoAll', a: [] }, T).ok);
  assert.ok(!a.towerSkill[0] && !b.towerSkill[0], 'gone for both');
  assert.strictEqual(b.gold[0], g1);
});

check('refereed: what each seat sees, Ready, forfeit, rematch, save / load', () => {
  const D = Duo.create({}, units);
  let T = 1e12;
  Duo.start(D, units, matrix, T, 77, [false, false, false, false]);
  for (let k = 0; k < 4; k++) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok, 'seat ' + k + ' picks');
  assert.strictEqual(clashes(D.lanes.map(R => R.m)), 0, 'package squads never share a tile');
  const m0 = D.lanes[0].m, before = m0.armies[0].length, unit = m0.armies[0][0].unit, t = freeTile(m0, 0, unit);
  assert.ok(Duo.act(D, 0, { seq: 2, fn: 'place', a: [unit, t[0], t[1]] }, T).ok, 'seat 0 places');
  const v1 = Duo.viewFor(D, 1).m, v2 = Duo.viewFor(D, 2).m, v3 = Duo.viewFor(D, 3).m;
  assert.strictEqual(v1.team.armies[0].length, before + 1, 'the teammate sees it (in m.team)');
  assert.ok(v1.team.armies[0].some(q => q.col === t[0] && q.row === t[1] && q.id >= Duo.OFF), 'with its id moved');
  assert.ok(!v2.armies[0].some(q => q.col === t[0] && q.row === t[1]), 'its opponent doesn\'t');
  assert.ok(!v3.team.armies[0].some(q => q.col === t[0] && q.row === t[1]), 'nor does the other opponent');
  assert.ok(!Duo.act(D, 1, { seq: 2, fn: 'place', a: [unit, t[0], t[1]] }, T).ok || !Game.isUnlocked(D.lanes[1].m, 0, unit), 'the teammate can\'t place on it');
  for (let k = 0; k < 3; k++) assert.strictEqual(Duo.setReady(D, k, true, T), null);
  assert.ok(!Duo.act(D, 0, { seq: 3, fn: 'unplaceSquad', a: [0] }, T).ok, 'no actions after Ready');
  const f = Duo.setReady(D, 3, true, T);
  assert.ok(f && f.summaries.length === 2, 'all ready: fight');
  assert.ok(!f.pres.some(p => p.team), 'no team copies in the fight snapshots');
  const pic = Duo.view(f.pres, 1);
  assert.strictEqual(pic.armies[0].length, f.pres[0].armies[0].length + f.pres[1].armies[0].length, 'the picture has both lanes');
  assert.strictEqual(D.phase, 'result');
  for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  assert.strictEqual(D.phase, 'deploy');
  assert.ok(Duo.forfeit(D, 3));
  assert.strictEqual(D.lanes[0].m.winner, 0); assert.strictEqual(D.lanes[1].m.winner, 0); assert.strictEqual(D.phase, 'end');
  for (let k = 0; k < 3; k++) assert.strictEqual(Duo.rematch(D, k, units, matrix, T, 5), false);
  assert.ok(Duo.rematch(D, 3, units, matrix, T, 5)); assert.strictEqual(D.phase, 'deploy');
  assert.strictEqual(D.lanes[0].m.map.id, 'duo');
  const back = Duo.load(copy(Duo.save(D)), units, matrix);
  assert.deepStrictEqual(Ref.snapshot(back.lanes[1].m), Ref.snapshot(D.lanes[1].m));
  assert.strictEqual(Duo.load({ v: 1, lanes: [] }, units, matrix), null, 'an old two-board match isn\'t loaded');
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
