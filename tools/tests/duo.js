// Headless check of 2v2 (src/duo.js; one shared board since 2026-11-03): no server needed.
//  - the board: Game's 'duo' map, 24 x 19, two flank columns on each edge, one tower per team (no treasury since 2026-11-05)
//  - the fight: both lanes' bodies on the one board, only lane 0's tower/walls, ids split back exactly
//  - team tiles: a teammate's squad takes its tile, the other opponent's squads hold theirs
//  - the tower spots (right of centre), walls by the tower
//  - direction arrows (sq.aim): the teammate's reach m.team, the opponents' never while deploying; so do skills (m.team.tech)
//  - whole matches with four bots: no two squads of a team on one tile, one tower type per team, shared health,
//    the same result when played back from pre
//  - the refereed match D: no leaders, no tower vote (the artifact draft since 2026-11-06), shared tower buys (only the buyer takes one back), Undo all,
//    what each seat sees, Ready, forfeit, rematch, save / load, the clock
//  - the tower portal: opens where a tower fell, the team that took it goes through once and comes out at its own
//    tower; never in 1v1
//  - the 2v2 units (Duo.unitSet): the built-in ones plus Rollers, Cog Builder, Mechite Guards (no Altar of Build); the
//    Factory: placed, built, its tile taken for the teammate, seen by the teammate only, the same fight played back
// Run: node tools/tests/duo.js
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

const lane = (seed) => Ref.newMatch(units, matrix, Ref.cleanSettings({}, units) && { ...Ref.cleanSettings({}, units), map: Duo.MAP, noChars: true }, seed);
const ui = (name) => units.findIndex(u => u.name === name);
function setup(lanes) { lanes.forEach((m, L) => { Duo.setTeam(lanes, L); for (const sd of [0, 1]) { Game.choosePack(m, sd, 0); Game.aiDeploy(m, sd); } }); }
// no two squads of one side on a tile, across both lanes
function clashes(lanes) {
  const seen = new Set(); let n = 0;
  for (const m of lanes) for (const sd of [0, 1]) for (const q of m.armies[sd]) { if (q.in != null || Game.mpbHeld(q)) continue; const k = sd + ':' + q.col + ',' + q.row; if (seen.has(k)) n++; seen.add(k); }
  return n;
}
const freeTile = (m, sd, unit) => { for (const row of Game.zoneRows(sd)) for (let c = 0; c < Game.COLS; c++) if (Game.canPlaceAt(m, sd, c, row, unit) && Game.spotFree(m, sd, c, row, unit)) return [c, row]; return null; };

check('the 2v2 board', () => {
  const m = lane(3);
  assert.strictEqual(m.map.id, 'duo');
  assert.strictEqual(Game.COLS, 24); assert.strictEqual(Game.ROWS, 19); // (19 rows since 2026-11-07: a middle row of no man's land)
  assert.deepStrictEqual(Game.towerSpot(m, 0), { col: 17, row: 17 }); assert.deepStrictEqual(Game.towerSpot(m, 1), { col: 6, row: 1 });
  assert.ok(!Game.treasuryOn(m), 'no treasury in 2v2 (2026-11-05)');
  const cols = new Set(Game.flankTiles(0).map(t => t.col));
  assert.deepStrictEqual([...cols].sort((a, b) => a - b), [0, 1, 22, 23], 'two flank columns on each edge');
  assert.ok(!Game.MAPS.some(x => x.id === 'duo'), 'not offered as a 1v1 map');
});

check('one board: one tower per team and no treasury, lane 1 ids moved and split back', () => {
  const a = lane(11), b = lane(12); [a, b].forEach(m => { m.round = 1; }); setup([a, b]);
  assert.strictEqual(clashes([a, b]), 0, 'package squads never share a tile');
  Duo.settle([a, b]);
  const bt = Duo.battle([a, b]);
  for (const sd of [0, 1]) {
    assert.strictEqual(bt.bodies.filter(x => x.side === sd && x.squad === -2).length, 1, 'one tower for side ' + sd);
    assert.strictEqual(bt.bodies.filter(x => x.side === sd && x.squad === Game.TREASURY_SQ).length, 0, 'no treasury for side ' + sd);
    assert.ok(!bt.bodies.some(x => x.side === sd && Duo.laneOfId(x.squad) === 1 && Duo.teamBody(Duo.unmap(x.squad))), 'no lane 1 tower bodies');
  }
  const l1 = bt.bodies.filter(x => x.lane === 1);
  assert.ok(l1.length && l1.filter(x => x.squad >= 0).every(x => x.squad >= Duo.OFF), 'lane 1 ids moved');
  while (bt.step()) {}
  const res = bt.result();
  for (const L of [0, 1]) {
    const m = [a, b][L], r = Duo.laneResult(res, L, m);
    for (const sd of [0, 1]) for (const sq of m.armies[sd]) assert.ok(r.squads[sd + ':' + sq.id], `lane ${L} side ${sd} squad ${sq.id} has its result`);
    if (L === 1) assert.ok(!r.squads['0:-2'] && !r.squads['1:-2'], 'the tower counts in lane 0 only');
  }
});

check('team tiles: a teammate takes the tile, the other opponent holds theirs', () => {
  const a = lane(21), b = lane(22);
  for (const m of [a, b]) { m.armies = [[], []]; for (const sd of [0, 1]) { m.pack[sd] = 0; m.chars[sd] = null; } }
  const sk = ui('Skeleton Archers');
  for (const m of [a, b]) for (const sd of [0, 1]) m.unlocks[sd][sk] = 1;
  a.armies[0].push({ id: 5, unit: sk, col: 6, row: 15, round: 1, xp: 0, level: 0, cost: 100 });
  Duo.setTeams([a, b]);
  assert.ok(!Game.place(b, 0, sk, 6, 15), 'the teammate\'s tile is taken');
  assert.ok(Game.place(b, 0, sk, 7, 15), 'the tile beside it is free');
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
  Duo.mpbSettle(D, T); // the artifact draft and any placement vote (2026-11-06): settled at once,
  D.tlog = [[], []]; D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd)); // as if dealt as the round began
  return { D, T };
}

// (2026-11-06) the round 3 tower vote is gone from 2v2: the artifact draft (src/mpb.js, tools/tests/mpb.js) gives
// towers now, and a team keeps the Outpost until a tower card comes
check('no tower vote in 2v2: no pick, no offer, the Outpost until a tower card', () => {
  const { D, T } = toRound3(5);
  for (const R of D.lanes) for (const sd of [0, 1]) {
    assert.ok(!Game.needsTowerPick(R.m, sd), 'no tower pick');
    assert.ok(!R.m.towerOffer, 'no tower offer');
    if (!R.m.towers[sd].type) assert.strictEqual(Game.towerType(R.m, sd).id, 'outpost');
  }
  assert.ok(!Duo.act(D, 0, { seq: 10, fn: 'setTowerType', a: ['keep'] }, T).ok, 'setTowerType refused');
  assert.ok(!('settleVote' in Duo) && !D.vote, 'the vote is gone');
});

check('shared tower buys: both lanes get it, only the buyer takes it back, Undo all', () => {
  const { D, T } = toRound3(7);
  const [a, b] = D.lanes.map(R => R.m);
  // (2026-11-06: no tower vote in 2v2) team A gets a tower card with a skill, in both lanes, as the draft gives it
  for (const m of [a, b]) Mpb.giveCard(m, 0, { type: 'tower', id: 'keep' });
  assert.strictEqual(a.towers[0].type, 'keep'); assert.strictEqual(b.towers[0].type, 'keep');
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

check('the new spots: tower right of centre, both lanes, walls and bots keep to them', () => {
  const a = lane(31), b = lane(32); [a, b].forEach(m => { m.round = 1; }); setup([a, b]);
  Duo.settle([a, b]);
  for (const m of [a, b]) {
    assert.deepStrictEqual({ col: m.towers[0].col, row: m.towers[0].row }, { col: 17, row: 17 }, 'side 0 tower');
    assert.deepStrictEqual({ col: m.towers[1].col, row: m.towers[1].row }, { col: 6, row: 1 }, 'side 1 tower');
    for (const sd of [0, 1]) {
      const t = Game.towerSpot(m, sd);
      assert.ok(!m.armies[sd].some(q => q.in == null && q.col === t.col && q.row === t.row), 'the bot keeps clear of the tower');
    }
  }
  // Bastion walls go up by the tower where it now stands
  const w = lane(33); w.round = 4; Game.ensureTower(w, 0); Game.ensureTower(w, 1);
  w.towers[0].type = 'bastion'; w.towerSkill = [w.round, 0]; w.towerSkill2 = [w.round, 0];
  Game.ensureBwalls(w, 0);
  const ws = Game.bwallsOf(w, 0);
  assert.ok(ws.length > 0, 'walls go up');
  assert.ok(ws.every(x => Math.abs(x.col - 17) <= 6 && x.row >= 13), 'walls by the tower: ' + ws.map(x => x.col + ',' + x.row).join(' '));
  // the fight: one tower body per side, on its tile
  const bt = Duo.battle([a, b]);
  for (const sd of [0, 1]) {
    const tb = bt.bodies.find(x => x.side === sd && x.squad === -2), want = Game.tileToWorld(Game.towerSpot(a, sd).col, Game.towerSpot(a, sd).row);
    assert.ok(tb && Math.abs(tb.x - want.x) < 0.01 && Math.abs(tb.y - want.y) < 0.01, 'tower body on its spot, side ' + sd);
  }
});

check('direction arrows: the teammate gets them in m.team, the opponents don\'t while deploying', () => {
  const D = Duo.create({}, units);
  let T = 1e12;
  Duo.start(D, units, matrix, T, 78, [false, false, false, false]);
  for (let k = 0; k < 4; k++) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok);
  const m0 = D.lanes[0].m;
  let sq = m0.armies[0].find(q => Game.canAim(m0, 0, q));
  if (!sq) { // no melee squad in the package: place one
    const mu = m0.units.findIndex((u, i) => Game.isUnlocked(m0, 0, i) && !u.building && !u.stay && !u.idle && u.speed > 0 && u.range <= Game.AIM.melee);
    assert.ok(mu >= 0, 'a melee unit unlocked');
    const t = freeTile(m0, 0, mu); m0.gold[0] += 5000;
    assert.ok(Duo.act(D, 0, { seq: 2, fn: 'place', a: [mu, t[0], t[1]] }, T).ok);
    sq = m0.armies[0].find(q => q.unit === mu && q.col === t[0] && q.row === t[1]);
  }
  const r = Duo.act(D, 0, { seq: 3, fn: 'setAim', a: [sq.id, 0, -2] }, T);
  assert.ok(r.ok, 'seat 0 sets an arrow: ' + r.why);
  const mine = Duo.viewFor(D, 1).m.team.armies[0].find(q => q.id === Duo.move(sq.id));
  assert.ok(mine && mine.aim && mine.aim.dr === -2, 'the teammate (A2) sees the arrow');
  for (const k of [2, 3]) {
    const v = Duo.viewFor(D, k).m;
    assert.ok(!v.armies[0].some(q => q.aim) && !v.team.armies[0].some(q => q.aim), 'opponent seat ' + k + ' doesn\'t');
  }
  // the other lane's skills (m.team.tech), for the unit sheets: the teammate sees one bought this round, the opponents don't
  const ui0 = sq.unit, k0 = 0, had = m0.tech[0][ui0];
  if (!had) m0.tech[0][ui0] = Engine.SLOTS.map(() => 0);
  m0.tech[0][ui0][k0] = m0.round;
  const t1 = Duo.viewFor(D, 1).m.team.tech, t3 = Duo.viewFor(D, 3).m.team.tech;
  assert.strictEqual(t1[0][ui0][k0], m0.round, 'the teammate sees it');
  assert.ok(!t3[0][ui0][k0], 'the other lane\'s opponent doesn\'t (this round)');
  if (had) m0.tech[0][ui0][k0] = 0; else delete m0.tech[0][ui0];
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

// ---------- the tower portal ----------
// side's squads stand still in a far back corner of the board, harmless and unhurt, so the other side takes the tower
// and the fight goes on (to the time cap) after it falls
function pin(bt, side) {
  const c = Game.tileToWorld(side === 0 ? 0 : Game.COLS - 1, side === 0 ? Game.ROWS - 1 : 0);
  for (const x of bt.bodies) if (x.side === side && !x.u.structure && x.squad >= -1) {
    x.u = { ...x.u, stay: true, hit: 0, hp: 1e9, flee: 0 }; x.hp = 1e9; x.x = c.x; x.y = c.y;
  }
}
// a 2v2 fight where side 0 takes side 1's tower: side 0's portal opens on its spot
function portalFight(seed) {
  const a = lane(seed), b = lane(seed + 1); [a, b].forEach(m => { m.round = 1; }); setup([a, b]);
  a.armies[1] = a.armies[1].slice(0, 1); b.armies[1] = []; // one squad left on side 1, out of the way
  Duo.settle([a, b]);
  const bt = Duo.battle([a, b]);
  const tw = [0, 1].map(sd => bt.bodies.find(x => x.side === sd && x.squad === -2));
  pin(bt, 1);
  const home = tw.map(t => ({ x: t.x, y: t.y }));
  let gate = null, steps = 0;
  const out = new Map(); // body -> where it was just after going through
  while (bt.step()) {
    steps++;
    if (!gate && bt.gates().length) gate = { ...bt.gates()[0], at: bt.time() };
    for (const x of bt.bodies) if (x.ported && !out.has(x)) out.set(x, { x: x.x, y: x.y });
  }
  return { bt, tw, home, gate, out, res: bt.result() };
}
check('the tower portal: opens where a tower fell, the team goes through once and comes out at its own tower', () => {
  let through = 0;
  const lanesThrough = new Set();
  for (const seed of [31, 41, 51]) {
    const { bt, tw, home, gate, out } = portalFight(seed);
    assert.ok(!tw[1].alive, 'side 1\'s tower fell');
    assert.ok(gate, 'a portal opened');
    assert.strictEqual(gate.side, 0, 'for the team that took the tower');
    assert.ok(gate.x === home[1].x && gate.y === home[1].y, 'on the fallen tower\'s spot');
    assert.strictEqual(bt.gates().length, tw[0].alive ? 1 : 2);
    for (const [x, p] of out) {
      assert.strictEqual(x.side, 0, 'only the team that took the tower');
      assert.ok(!x.u.structure, 'no structures');
      assert.ok(Math.hypot(p.x - home[0].x, p.y - home[0].y) <= 5 * Game.SETTINGS.spacing, 'comes out in front of its own tower');
    }
    assert.strictEqual(bt.gateFx().length, 2 * out.size, 'each body goes through once (a flash at both ends)');
    for (const x of out.keys()) lanesThrough.add(x.lane);
    through += out.size;
    console.log(`      seed ${seed}: portal at ${gate.at.toFixed(1)} s, ${out.size} bodies through (lanes ${[...new Set([...out.keys()].map(x => x.lane))].join(', ')})`);
  }
  assert.ok(through > 0, 'bodies go through');
  assert.strictEqual(lanesThrough.size, 2, 'both players\' squads use it');
  // the same fight played again comes out the same (playback on every phone)
  const a = portalFight(31), b = portalFight(31);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.res)), JSON.parse(JSON.stringify(b.res)), 'deterministic');
  assert.strictEqual(a.out.size, b.out.size);
});
check('the tower portal: never in 1v1', () => {
  const m = Ref.newMatch(units, matrix, Ref.cleanSettings({}, units), 5);
  m.round = 1; for (const sd of [0, 1]) { Game.choosePack(m, sd, 0); Game.aiDeploy(m, sd); }
  m.armies[1] = m.armies[1].slice(0, 1);
  const bt = Game.startBattle(m), t1 = bt.bodies.find(x => x.side === 1 && x.squad === -2);
  pin(bt, 1);
  while (bt.step()) {}
  assert.ok(!t1.alive, 'the tower fell');
  assert.strictEqual(bt.gates().length, 0, 'no portal');
  assert.ok(!bt.bodies.some(x => x.ported), 'nobody went through');
});

// ---------- the 2v2 units: Mechites ----------
check('the 2v2 units: built-in plus Rollers, Cog Builder, Mechite Guards; no Altar of Build', () => {
  const names = units.map(u => u.name);
  assert.deepStrictEqual(names.slice(0, demo.units.length), demo.units.map(u => u.name), 'the built-in units first, as they are');
  assert.deepStrictEqual(names.slice(demo.units.length), ['Rollers', 'Cog Builder', 'Mechite Guards', 'Shadowhands']); // (Shadowhands: the Shadow Den's, src/mpb.js; only a team with a Den has it)
  assert.ok(!names.includes('Altar of Build'));
  assert.ok(units.every(u => !u.faction), 'no faction (no faction trait)');
  assert.strictEqual(matrix.length, units.length); assert.ok(matrix.every(r => r.length === units.length));
  const cb = units[ui('Cog Builder')];
  assert.ok(cb.skillDefs.some(d => d && d.type === 'building'), 'Cog Builder can build its Factory');
  assert.ok(Game.buildingInfo('factory'), 'the Factory is known (Duo.unitSet sets it for the server and node)');
  for (const n of Duo.MECHITES) assert.ok(Game.tierOf(units, ui(n)) >= 1, n + ' has a tier');
  // the shop and the packages: a 1v1 match on the built-in units is unchanged
  const bm = require('../../server/src/prepare-units.cjs')(Engine, demo);
  assert.strictEqual(bm.units.length, demo.units.length);
});

// a refereed match of four humans in round 1 with A1 owning a Cog Builder and gold to spare
function mechMatch(seed) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, [false, false, false, false]);
  for (let k = 0; k < 4; k++) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok);
  for (const R of D.lanes) for (const sd of [0, 1]) R.m.gold[sd] += 3000;
  return { D, T };
}
check('the Factory in 2v2: placed, its tile the team\'s, seen by the teammate only, built, played back the same', () => {
  const { D, T } = mechMatch(13);
  const a = D.lanes[0].m, b = D.lanes[1].m, cb = ui('Cog Builder'), k = units[cb].skillDefs.findIndex(d => d && d.type === 'building');
  let seq = 2;
  const go = (seat, fn, args) => Duo.act(D, seat, { seq: seq++, fn, a: args }, T);
  if (!Game.isUnlocked(a, 0, cb)) assert.ok(go(0, 'unlock', [cb]).ok, 'A1 unlocks the Cog Builder');
  const t = freeTile(a, 0, cb);
  assert.ok(go(0, 'place', [cb, t[0], t[1]]).ok, 'A1 places a Cog Builder');
  const spot = (() => { for (const row of Game.zoneRows(0).slice().reverse()) for (let c = 2; c < Game.COLS - 2; c++) if (Game.buildingSpotOk(a, 0, c, row)) return [c, row]; return null; })();
  assert.ok(go(0, 'buyBuilding', [cb, k, spot[0], spot[1]]).ok, 'A1 buys the Factory');
  assert.ok(Game.buildingOf(a, 0, 'factory'));
  // the teammate's lane: the tile is taken, for squads and buildings
  assert.ok(Game.teamBuildings(b, 0).some(x => x.col === spot[0] && x.row === spot[1]), 'm.team carries the building');
  assert.ok(Game.occupied(b, 0, spot[0], spot[1]), 'taken in the teammate\'s lane');
  const sk = Object.keys(b.unlocks[0]).map(Number).find(u => !units[u].building);
  assert.ok(!go(1, 'place', [sk, spot[0], spot[1]]).ok, 'A2 can\'t place a squad on it');
  // what each seat sees: the teammate sees it, the other team doesn't while they deploy
  assert.ok(Duo.viewFor(D, 1).m.team.buildings[0].some(x => x.id === 'factory'), 'A2 sees it');
  assert.ok(!Duo.viewFor(D, 2).m.buildings || !(Duo.viewFor(D, 2).m.buildings[0] || []).some(x => x.id === 'factory'), 'B1 doesn\'t');
  assert.ok(!Duo.viewFor(D, 3).m.team.buildings[0].some(x => x.id === 'factory'), 'B2 doesn\'t');
  // fights until it is built (or a few rounds), each played back the same from pre
  let built = false, rounds = 0;
  while (!built && rounds < 6 && D.phase !== 'end') {
    let f = null;
    for (let s = 0; s < 4; s++) f = Duo.setReady(D, s, true, T) || f;
    assert.ok(f, 'the fight ran');
    const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
    assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback: same winner');
    rounds++;
    built = !!(Game.buildingOf(D.lanes[0].m, 0, 'factory') || {}).built;
    if (D.phase === 'result') for (let s = 0; s < 4; s++) Duo.next(D, s, D.summary[0].round, T);
  }
  const fac = Game.buildingOf(D.lanes[0].m, 0, 'factory');
  console.log(`      the Factory after ${rounds} fight(s): progress ${fac.progress.toFixed(2)}, built ${fac.built}`);
  assert.ok(fac.progress > 0, 'work done on it in the fights');
  assert.ok(fac.built, 'built');
  // the teammate's lane keeps the tile taken for the rest of the match
  assert.ok(Game.occupied(D.lanes[1].m, 0, spot[0], spot[1]));
});
check('Mechites in a 2v2 fight: the Factory site stands in its lane, ids split back, played back the same', () => {
  const { D, T } = mechMatch(17);
  const cb = ui('Cog Builder'), k = units[cb].skillDefs.findIndex(d => d && d.type === 'building');
  let seq = 2;
  const go = (seat, fn, args) => Duo.act(D, seat, { seq: seq++, fn, a: args }, T);
  // lane 1 (A2) builds this time, with Rollers and Mechite Guards beside it; the other team gets Mechite Guards
  const m1 = D.lanes[1].m;
  for (const n of ['Cog Builder', 'Rollers', 'Mechite Guards']) {
    const u = ui(n);
    if (!Game.isUnlocked(m1, 0, u)) assert.ok(go(1, 'unlock', [u]).ok, 'A2 unlocks ' + n);
    const t = freeTile(m1, 0, u); assert.ok(go(1, 'place', [u, t[0], t[1]]).ok, 'A2 places ' + n);
  }
  const spot = (() => { for (const row of Game.zoneRows(0).slice().reverse()) for (let c = 2; c < Game.COLS - 2; c++) if (Game.buildingSpotOk(m1, 0, c, row)) return [c, row]; return null; })();
  assert.ok(go(1, 'buyBuilding', [cb, k, spot[0], spot[1]]).ok, 'A2 buys the Factory');
  assert.ok(Game.occupied(D.lanes[0].m, 0, spot[0], spot[1]), 'A1 can\'t use the tile');
  const mg = ui('Mechite Guards'), m3 = D.lanes[1].m;
  if (!Game.isUnlocked(m3, 1, mg)) assert.ok(go(3, 'unlock', [mg]).ok);
  { const t = freeTile(m3, 1, mg); assert.ok(go(3, 'place', [mg, t[0], t[1]]).ok, 'B2 places Mechite Guards'); }
  let f = null;
  for (let s = 0; s < 4; s++) f = Duo.setReady(D, s, true, T) || f;
  assert.ok(f, 'the fight ran');
  const bt = Duo.battle(f.pres.map(W));
  const site = bt.bodies.find(x => x.u.building === 'factory');
  assert.ok(site && site.lane === 1 && site.squad <= -Duo.OFF, 'the Factory site stands in the fight, under lane 1');
  while (bt.step()) {}
  const res = bt.result();
  assert.strictEqual(res.winner, f.summaries[0].duo.winner, 'playback: same winner');
  const r1 = Duo.laneResult(res, 1, Ref.withUnits(copy(f.pres[1]), units, matrix));
  assert.ok(r1.buildings.some(x => x.squad === Game.BUILDING_SQUAD && x.side === 0), 'its result goes back to lane 1 under its own id');
  assert.ok(!Duo.laneResult(res, 0, Ref.withUnits(copy(f.pres[0]), units, matrix)).buildings.length, 'not to lane 0');
  const fac = Game.buildingOf(D.lanes[1].m, 0, 'factory');
  assert.ok(fac && fac.progress > 0, 'lane 1 got its work: ' + (fac && fac.progress));
});
check('bots in 2v2 with the Mechites: whole matches, no clashes', () => {
  let facs = 0, mech = 0;
  for (let seed = 21; seed <= 24; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12;
    Duo.start(D, units, matrix, T, seed, [true, true, true, true]);
    let rounds = 0;
    while (D.phase !== 'end' && rounds < 40) {
      T += 1000;
      assert.strictEqual(clashes(D.lanes.map(R => R.m)), 0, 'no two squads of a team on one tile');
      for (const sd of [0, 1]) {
        const tiles = new Set();
        for (const R of D.lanes) for (const x of Game.buildingsOf(R.m, sd)) { const k = x.col + ',' + x.row; assert.ok(!tiles.has(k), 'no two buildings of a team on one tile'); tiles.add(k);
          for (const R2 of D.lanes) assert.ok(!R2.m.armies[sd].some(q => q.in == null && q.col === x.col && q.row === x.row), 'no squad on a building'); }
      }
      const f = Duo.tick(D, T + 200000);
      assert.ok(f);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback: same winner');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    for (const R of D.lanes) for (const sd of [0, 1]) { facs += Game.buildingsOf(R.m, sd).length; mech += R.m.armies[sd].filter(q => Duo.MECHITES.includes(units[q.unit].name)).length; }
    assert.strictEqual(D.phase, 'end');
  }
  console.log(`      4 matches: ${mech} Mechite squads at the end, ${facs} Factories`);
});

// ---------- riding in the teammate's horse ----------
// a refereed match of four humans: A2 (seat 1, lane 1) has a horse on the board, everyone has gold to spare
function horseMatch(seed) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, [false, false, false, false]);
  for (let k = 0; k < 4; k++) assert.ok(Duo.act(D, k, { seq: 1, fn: 'choosePack', a: [0] }, T).ok);
  for (const R of D.lanes) for (const sd of [0, 1]) R.m.gold[sd] += 3000;
  const seq = [0, 2, 2, 2, 2];
  const go = (seat, fn, args) => Duo.act(D, seat, { seq: seq[seat + 1]++, fn, a: args }, T);
  const hu = ui('Just a horse'), m1 = D.lanes[1].m;
  if (!Game.isUnlocked(m1, 0, hu)) assert.ok(go(1, 'unlock', [hu]).ok, 'A2 unlocks the horse');
  const ht = freeTile(m1, 0, hu);
  assert.ok(go(1, 'place', [hu, ht[0], ht[1]]).ok, 'A2 places a horse');
  const horse = m1.armies[0].find(q => q.unit === hu && q.col === ht[0] && q.row === ht[1]);
  return { D, T, go, horse, ht };
}
// the next round, everybody ready
function nextRound(D, T) {
  let f = null;
  for (let k = 0; k < 4; k++) f = Duo.setReady(D, k, true, T) || f;
  assert.ok(f, 'the fight ran');
  if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  assert.strictEqual(D.phase, 'deploy');
  return f;
}
const own = (D, k) => D.lanes[Duo.SEATS[k].lane].m;
check('the teammate\'s horse: board it, the teammate sees it, the opponents never do, one rider only', () => {
  const { D, T, go, horse, ht } = horseMatch(61);
  const m0 = own(D, 0), sk = ui('Skeleton Archers');
  if (!Game.isUnlocked(m0, 0, sk)) assert.ok(go(0, 'unlock', [sk]).ok);
  assert.ok(Game.boardable(m0, 0, ht[0], ht[1], sk), 'A1 sees room in A2\'s horse');
  assert.ok(go(0, 'place', [sk, ht[0], ht[1]]).ok, 'A1 places a squad into it');
  const rider = m0.armies[0].find(q => q.unit === sk && q.col === ht[0] && q.row === ht[1]);
  assert.ok(rider && rider.in === horse.id + Duo.OFF && Game.isRider(rider) && Game.mateRide(rider), 'a rider in the teammate\'s horse');
  assert.strictEqual(Game.carrierOf(m0, 0, rider).id, horse.id + Duo.OFF);
  // A2's lane: the rider is in m.team, pointing at A2's own horse
  const v1 = Duo.viewFor(D, 1).m;
  assert.ok(v1.team.armies[0].some(q => q.in === horse.id && q.id === rider.id + Duo.OFF), 'A2 sees it in their horse');
  assert.strictEqual(Game.riderOf(own(D, 1), 0, horse).id, rider.id + Duo.OFF);
  // one rider per horse: A2 can't put its own squad in now
  const m1 = own(D, 1), sk1 = Object.keys(m1.unlocks[0]).map(Number).find(u => !units[u].carrier && !units[u].building);
  assert.ok(!Game.boardable(m1, 0, ht[0], ht[1], sk1), 'no room left');
  assert.ok(!go(1, 'place', [sk1, ht[0], ht[1]]).ok, 'A2\'s squad is refused');
  // the rider is A1's: A1's gold paid, A2's didn't change for it
  assert.strictEqual(rider.cost > 0 || rider.free, true);
  nextRound(D, T);
  // the opponents: never (from the next round on, as with a rider in your own horse)
  for (const k of [2, 3]) {
    const v = Duo.viewFor(D, k).m, all = [...v.armies[0], ...((v.team && v.team.armies[0]) || [])];
    assert.ok(!all.some(q => Game.isRider(q)), 'seat ' + k + ' sees no rider');
    assert.ok(all.some(q => q.unit === ui('Just a horse')), 'seat ' + k + ' sees the horse');
  }
});
check('the teammate\'s horse: both board it in one round, the first one holds it', () => {
  const { D, go, ht } = horseMatch(62);
  const m0 = own(D, 0), m1 = own(D, 1), sk = ui('Skeleton Archers');
  for (const [k, m] of [[0, m0], [1, m1]]) if (!Game.isUnlocked(m, 0, sk)) assert.ok(go(k, 'unlock', [sk]).ok);
  assert.ok(go(1, 'place', [sk, ht[0], ht[1]]).ok, 'A2 boards its own horse first');
  assert.ok(!go(0, 'place', [sk, ht[0], ht[1]]).ok, 'A1 is refused');
  assert.ok(!m0.armies[0].some(q => Game.isRider(q)));
});
check('the teammate\'s horse: moved, the rider goes with it; sold, the rider steps out', () => {
  const { D, T, go, horse, ht } = horseMatch(63);
  const m0 = own(D, 0), m1 = own(D, 1), sk = ui('Skeleton Archers');
  if (!Game.isUnlocked(m0, 0, sk)) assert.ok(go(0, 'unlock', [sk]).ok);
  assert.ok(go(0, 'place', [sk, ht[0], ht[1]]).ok);
  const rid = m0.armies[0].find(q => Game.isRider(q)).id;
  nextRound(D, T);
  const rider = () => m0.armies[0].find(q => q.id === rid);
  assert.ok(Game.isRider(rider()), 'still inside after the fight');
  // A2 moves the horse: the rider's tile follows in A1's lane
  const to = freeTile(m1, 0, horse.unit);
  assert.ok(go(1, 'moveSquad', [horse.id, to[0], to[1]]).ok, 'A2 moves the horse');
  assert.deepStrictEqual([rider().col, rider().row], to, 'the rider went with it');
  assert.ok(Game.isRider(rider()));
  assert.ok(Duo.viewFor(D, 0).m.armies[0].some(q => q.id === rid && q.col === to[0] && q.row === to[1]), 'A1\'s own view has it');
  // A2 takes the move back: the rider comes back too
  assert.ok(go(1, 'undoMove', []).ok);
  assert.deepStrictEqual([rider().col, rider().row], ht);
  // A2 sells the horse: the rider steps out onto the tile, the opponents still think it is inside
  assert.ok(go(1, 'sell', [horse.id]).ok, 'A2 sells the horse');
  assert.ok(!Game.isRider(rider()), 'stepped out');
  assert.deepStrictEqual([rider().col, rider().row], ht, 'on the horse\'s tile');
  assert.strictEqual(rider().outRound, m0.round);
  assert.ok(!Duo.viewFor(D, 2).m.armies[0].some(q => q.id === rid), 'B1 doesn\'t see it step out');
  assert.ok(!Duo.viewFor(D, 3).m.team.armies[0].some(q => q.id === rid + Duo.OFF), 'nor does B2');
  // A1 can't remove A2's squads, and A2 can't touch the rider: its actions only reach its own lane
  assert.ok(!go(1, 'sell', [rid]).ok || !m1.armies[0].some(q => q.id === rid), 'A2 can\'t sell A1\'s squad');
});
check('the teammate\'s horse: one squad in and one out per round, for the whole team', () => {
  const { D, T, go, horse, ht } = horseMatch(67);
  const m0 = own(D, 0), m1 = own(D, 1), sk = ui('Skeleton Archers');
  if (!Game.isUnlocked(m0, 0, sk)) assert.ok(go(0, 'unlock', [sk]).ok);
  assert.ok(go(0, 'place', [sk, ht[0], ht[1]]).ok, 'A1 boards the horse');
  const rid = m0.armies[0].find(q => Game.isRider(q)).id;
  // A2 has a squad of its own from round 1 too
  const x = m1.armies[0].find(q => q.id !== horse.id && !units[q.unit].carrier && !units[q.unit].building);
  assert.ok(x, 'A2 has another squad');
  nextRound(D, T);
  const out = freeTile(m0, 0, sk);
  assert.ok(go(0, 'moveSquad', [rid, out[0], out[1]]).ok, 'A1\'s squad steps out (the horse\'s one out)');
  assert.ok(go(1, 'moveSquad', [x.id, ht[0], ht[1]]).ok, 'A2 puts its squad in (the horse\'s one in)');
  const t2 = freeTile(m1, 0, x.unit);
  assert.ok(!go(1, 'moveSquad', [x.id, t2[0], t2[1]]).ok, 'A2 can\'t take it out again: the horse let A1\'s out already');
  assert.ok(!go(0, 'moveSquad', [rid, ht[0], ht[1]]).ok, 'and A1 can\'t get back in (no room)');
});
check('the teammate\'s horse in the fight: inside until it falls, the rider\'s damage goes to its own lane', () => {
  let seen = 0;
  for (const seed of [64, 65, 66]) {
    const { D, T, go, horse, ht } = horseMatch(seed);
    const m0 = own(D, 0), sk = ui('Skeleton Archers');
    if (!Game.isUnlocked(m0, 0, sk)) assert.ok(go(0, 'unlock', [sk]).ok);
    assert.ok(go(0, 'place', [sk, ht[0], ht[1]]).ok);
    const rid = m0.armies[0].find(q => Game.isRider(q)).id;
    const f = nextRound(D, T);
    const bt = Duo.battle(f.pres.map(W));
    const hb = bt.bodies.find(x => x.squad === horse.id + Duo.OFF && x.side === 0), rb = bt.bodies.filter(x => x.squad === rid && x.side === 0);
    assert.ok(hb && hb.lane === 1, 'the horse is lane 1\'s');
    assert.ok(rb.length && rb.every(x => x.boarded && !x.alive && x.carrier === hb && x.lane === 0), 'the rider sits inside it');
    let out = false;
    while (bt.step()) if (!out && rb.some(x => x.alive)) { out = true; assert.ok(!hb.alive, 'out only once the horse fell'); }
    const res = bt.result();
    assert.strictEqual(res.winner, f.summaries[0].duo.winner, 'playback: same winner');
    if (out) {
      seen++;
      const r0 = Duo.laneResult(res, 0, W(f.pres[0])), r1 = Duo.laneResult(res, 1, W(f.pres[1]));
      assert.ok(r0.squads['0:' + rid], 'the rider\'s result is in A1\'s lane');
      assert.ok(!r1.squads['0:' + rid], 'not in A2\'s');
    }
  }
  assert.ok(seen > 0, 'a horse fell and its rider came out');
});
check('the teammate\'s horse: a bot teammate sells or moves it, nothing breaks', () => {
  for (const seed of [71, 72]) {
    const D = Duo.create({}, units);
    let T = 1e12;
    Duo.start(D, units, matrix, T, seed, [false, true, true, true]);
    assert.ok(Duo.act(D, 0, { seq: 1, fn: 'choosePack', a: [0] }, T).ok);
    const m0 = own(D, 0), m1 = own(D, 1), hu = ui('Just a horse'), sk = ui('Skeleton Archers');
    m0.gold[0] += 5000; m1.gold[0] += 5000;
    // the bot's lane gets a horse (as if it had bought one)
    m1.unlocks[0][hu] = m1.unlocks[0][hu] || 1;
    const ht = freeTile(m1, 0, hu); assert.ok(Game.place(m1, 0, hu, ht[0], ht[1]));
    Duo.setTeams(D.lanes.map(R => R.m));
    let seq = 2;
    if (!Game.isUnlocked(m0, 0, sk)) assert.ok(Duo.act(D, 0, { seq: seq++, fn: 'unlock', a: [sk] }, T).ok);
    assert.ok(Duo.act(D, 0, { seq: seq++, fn: 'place', a: [sk, ht[0], ht[1]] }, T).ok, 'A1 rides in the bot\'s horse');
    let rounds = 0;
    while (D.phase !== 'end' && rounds < 12) {
      T += 1000;
      for (const R of D.lanes) for (const sd of [0, 1]) for (const q of R.m.armies[sd]) if (Game.isRider(q)) assert.ok(Game.carrierOf(R.m, sd, q), 'every rider has its carrier');
      assert.strictEqual(clashes(D.lanes.map(R => R.m)), 0);
      let f = null; for (let k = 1; k <= 4 && !f; k++) f = Duo.tick(D, T + 200000 * k); // (a draft pick, then a placement vote A1 left to its 15 s, each hold the clock until a tick)
      assert.ok(f);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback: same winner');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
      if (D.phase === 'deploy' && rounds % 2 === 0) { // the bot sells its horse now and then (the AI may too)
        const h = m1.armies[0].find(q => q.unit === hu && q.round < m1.round);
        if (h) { Game.sell(m1, 0, h.id); Duo.setTeams(D.lanes.map(R => R.m)); }
      }
    }
  }
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
