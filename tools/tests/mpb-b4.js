// Headless check of group B4's 2v2 buildings (src/mpb.js regions jail and school, docs/MPB-2V2.md; 2026-11-06): no
// server needed.
//  Jail: placement (interior, spacing); Jail a squad (an enemy squad from an earlier round the buyer can see, in either
//    enemy lane; one cell per player, two in all; take-back; hidden from the opponents until the fight; it sits that
//    fight out already); after the fight it is locked up in its own lane (on the jail's tile, can't move, can be sold:
//    its cell frees up; sold before the fight: the gold back); a carrier jailed leaves its rider behind; Skywatch (the
//    Engine's opts.mpb.discover: stealthed enemies in its light are seen, measured in a real Duo fight), the lit tiles;
//    Jail guards (4 Keep guards that hold until an enemy is in their awareness); destroyed: the squads go free, their
//    unit types can't be jailed again, the next round it does nothing; a mirrored fight with a Jail on both sides
//  School: placement; enroll (either player, own squads only; off the board, its tile free, can't move, sell or be taken
//    back, no new squad of its unit type for its player), hidden from the opponents this round; Study (+a level's XP a
//    round; Double study: twice); Learn (free, 2 rounds later; Quick learning: 1; can't leave meanwhile; Stop
//    learning this round); Take out (nearest free tile or a tile tapped); doesn't fight (a real Duo fight);
//    destroyed: the squad that did it gets half a level's XP (the Engine's killedBy, a real fight), the squad inside
//    comes out as it went in; a mirrored fight with a School on both sides
//  both: the page's copy hashes as the server's after every action; a full bot 2v2 to round 10 with both kinds on both
//    teams (no exception, team state equal, views in step, playback the same)
// Run: node tools/tests/mpb-b4.js
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
const OFF = Duo.OFF;
const UI = (name) => { const i = units.findIndex(u => u.name === name); assert.ok(i >= 0, name); return i; };
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
  assert.ok(D.phase !== 'end', 'the match goes on to round ' + round);
  assert.strictEqual(D.lanes[0].m.round, round, 'reached round ' + round);
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
// a building of kind for team sd on its first allowed tile, in both lanes, as if it stood when the round began
function addKind(D, sd, kind) {
  const m = D.lanes[0].m;
  Duo.setTeams(D.lanes.map(R => R.m));
  const t = Mpb.autoSpot(m, sd, kind, null);
  assert.ok(t, 'room for a ' + kind);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  const rec = Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1];
  D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
// a free tile of side sd's zone in lane L (both lanes' squads, buildings): (col, row) if it is, else the nearest
function freeNear(D, L, sd, col, row) {
  const lanes = D.lanes.map(R => R.m), m = lanes[L];
  Duo.setTeams(lanes);
  const t = Mpb.homeTile([m], sd, { unit: 0 }, { col, row });
  assert.ok(t, 'a free tile near ' + col + ',' + row);
  return t;
}
// a squad of unit `name` for lane L's side sd on (col, row) or the free tile nearest it, as if placed in an earlier round
function addSq(D, L, sd, name, col0, row0, extra = {}) {
  const lanes = D.lanes.map(R => R.m), m = lanes[L], { col, row } = freeNear(D, L, sd, col0, row0);
  Duo.setTeams(lanes);
  assert.ok(!Game.occupied(m, sd, col, row) && Game.inZone(sd, row), `tile ${col},${row} free for side ${sd}`);
  const sq = { id: m.nextId[sd]++, unit: UI(name), col, row, round: Math.max(0, m.round - 1), xp: 0, level: 0, cost: 100, ...extra };
  m.armies[sd].push(sq);
  for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
  Duo.setTeams(lanes);
  return sq;
}
const rich = (D) => { for (const R of D.lanes) R.m.gold = [5000, 5000]; for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; };
const recOf = (x, sd, key, L = 0) => Mpb.recOf(x.m(L), sd, key);
// the fight as it would start now (Duo.battle on the lanes as they stand)
function battleNow(D) { const lanes = D.lanes.map(R => R.m); Duo.settle(lanes); return Duo.battle(lanes); }
const bodiesOf = (bt, sd, L, id) => bt.bodies.filter(b => b.side === sd && b.squad === (L ? id + OFF : id));
// the page's own copy of a seat's view does the action as the server does: allowed the same, the same hash
function pageTry(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ' allowed on the page as on the server');
  if (r.ok) {
    assert.strictEqual(Ref.sideHash(Duo.viewFor(D, seat).m, sd), r.h, fn + ': the view hashes as the server');
    assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  }
  return r;
}
const inSquare = (b, d) => Math.abs(b.x - d.x) <= d.r && Math.abs(b.y - d.y) <= d.r;
// the Jail and the School can't fall in fn's fights (the tests that look at them over several rounds)
function tough(fn) {
  return () => {
    const was = [Mpb.KINDS.jail.hp, Mpb.KINDS.school.hp];
    Mpb.KINDS.jail.hp = Mpb.KINDS.school.hp = 1e8;
    try { fn(); } finally { [Mpb.KINDS.jail.hp, Mpb.KINDS.school.hp] = was; }
  };
}
const next = (x, hook) => playTo(x, x.m(0).round + 1, hook);
const litCount = (rec) => { let n = 0; for (let r = rec.row - 3; r <= rec.row + 3; r++) for (let c = rec.col - 3; c <= rec.col + 3; c++) if (c >= 0 && c < Game.COLS && r >= 0 && r < Game.ROWS && !(c === rec.col && r === rec.row)) n++; return n; };

// =====================================================================
// Jail
// =====================================================================
check('jail: the kind, placement (interior, spacing)', () => {
  const K = Mpb.KINDS.jail;
  assert.deepStrictEqual([K.hp, K.armor, K.kind, K.place.where, K.place.spacing], [1500, 8, 'technical', 'interior', true]);
  assert.deepStrictEqual(K.skills.map(s => [s.id, s.cost, s.per]), [['jail', 100, 'free'], ['guards', 150, 'match']]);
  const x = match(101), m = x.m(0);
  Duo.setTeams(x.D.lanes.map(R => R.m));
  for (const [c, r] of [[10, 18], [10, 12], [2, 15]]) assert.ok(!Mpb.spotOk(m, 0, 'jail', null, c, r), 'an edge tile ' + c + ',' + r);
  assert.ok(!Mpb.spotOk(m, 0, 'jail', null, 8, 14), 'two tiles from the Vault');
  for (const t of Mpb.spots(m, 0, 'jail', null)) assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row));
  for (const t of Mpb.spots(m, 1, 'school', null)) assert.ok(Mpb.interior(1, t.col, t.row) && Mpb.spaced(m, t.col, t.row));
  const key = addKind(x.D, 0, 'jail'), rec = recOf(x, 0, key);
  for (const sd of [0, 1]) assert.ok(Game.occupied(x.m(1), sd, rec.col, rec.row), 'its tile is taken for both teams');
});

check('jail: who can be jailed, one cell each, two in all, take-back, hidden until the fight, sits that fight out', tough(() => {
  const x = match(102), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'jail');
  rich(D);
  const b1 = addSq(D, 0, 1, 'Brute', 9, 3), b1b = addSq(D, 0, 1, 'Rogue', 11, 3), b2 = addSq(D, 1, 1, 'War Mammoth', 13, 3);
  const fac = addSq(D, 0, 1, 'Ent', 15, 4, { round: D.lanes[0].m.round }); // placed this round: the jailer can't see it
  const g0 = x.m(0).gold[0];
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail').ok, 'a squad must be picked');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, fac.id).ok, 'not a squad placed this round (hidden)');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, 999).ok, 'not a squad that isn\'t there');
  assert.ok(!x.act(2, 'mpbBuy', key, 'jail', 0, b1.id).ok, 'the other team can\'t use it');
  assert.ok(x.act(0, 'mpbBuy', key, 'jail', 1, b2.id).ok, 'A1 jails B2\'s squad (the other lane)');
  assert.strictEqual(x.m(0).gold[0], g0 - 100, 'A1 paid 100');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, b1.id).ok, 'one cell per player');
  assert.ok(!x.act(1, 'mpbBuy', key, 'jail', 1, b2.id).ok, 'not the same squad twice');
  assert.ok(x.act(1, 'mpbBuy', key, 'jail', 0, b1.id).ok, 'A2 jails B1\'s Brute (the other lane, from A2\'s side)');
  assert.ok(!x.act(1, 'mpbBuy', key, 'jail', 0, b1b.id).ok, 'two cells in all');
  sameTeam(D, 0);
  assert.deepStrictEqual(recOf(x, 0, key, 1).data.cells.map(c => [c.by, c.lane, c.id, c.ui]), [[0, 1, b2.id, UI('War Mammoth')], [1, 0, b1.id, UI('Brute')]]);
  // take-back: A2's own, gold back; again
  const g1 = x.m(1).gold[0];
  assert.ok(x.act(1, 'mpbUndo', key, 'jail').ok, 'A2 takes it back');
  assert.strictEqual(x.m(1).gold[0], g1 + 100); assert.ok(!recOf(x, 0, key).data.cells.some(c => c.by === 1), 'A2\'s cell is free');
  assert.ok(x.act(1, 'mpbBuy', key, 'jail', 0, b1.id).ok);
  // the opponents don't see this round's jailing; the teammate does
  for (const seat of [2, 3]) assert.ok(!('cells' in Mpb.recOf(Duo.viewFor(D, seat).m, 0, key).data), 'B' + (seat - 1) + ' doesn\'t see it yet (no cells key at all, as before a first jailing)');
  assert.strictEqual(Mpb.recOf(Duo.viewFor(D, 1).m, 0, key).data.cells.length, 2, 'A2 sees both');
  // the squad can still be moved by its player this round (they don't know yet), but it sits this fight out
  const bt = battleNow(D);
  assert.strictEqual(bodiesOf(bt, 1, 0, b1.id).length, 0, 'B1\'s Brute isn\'t in the fight');
  assert.strictEqual(bodiesOf(bt, 1, 1, b2.id).length, 0, 'B2\'s Mammoth isn\'t either');
  assert.ok(bodiesOf(bt, 1, 0, b1b.id).length > 0, 'the Rogue fights');
  // without the jail they would (the same fight, no cells)
  for (const R of D.lanes) Mpb.recOf(R.m, 0, key).data.cells_ = Mpb.recOf(R.m, 0, key).data.cells, Mpb.recOf(R.m, 0, key).data.cells = [];
  assert.ok(bodiesOf(battleNow(D), 1, 0, b1.id).length > 0, 'without the jail it fights');
  for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, key); r.data.cells = r.data.cells_; delete r.data.cells_; }
  // after the fight: locked up in its own lane, on the jail's tile; the opponents see it now
  const rec = recOf(x, 0, key);
  playTo(x, 3);
  const q1 = x.m(0).armies[1].find(q => q.id === b1.id), q2 = x.m(1).armies[1].find(q => q.id === b2.id);
  for (const q of [q1, q2]) { assert.ok(q.jailed && q.jailed.key === key && q.jailed.side === 0 && q.jailed.round === 2, 'locked up'); assert.ok(q.col === rec.col && q.row === rec.row, 'on the jail\'s tile'); assert.ok(Game.mpbHeld(q)); }
  assert.deepStrictEqual([q1.jailed.col, q1.jailed.row], [9, 3], 'where it stood is kept');
  assert.ok(!Game.occupied(x.m(0), 1, 9, 3), 'its old tile is free');
  assert.strictEqual(Mpb.recOf(Duo.viewFor(D, 2).m, 0, key).data.cells.length, 2, 'B1 sees it now');
  assert.ok(!x.act(2, 'moveSquad', b1.id, 9, 4).ok, 'B1 can\'t move it');
  assert.ok(!Game.canMove(x.m(0), 1, q1));
  const bt3 = battleNow(D);
  assert.strictEqual(bodiesOf(bt3, 1, 0, b1.id).length + bodiesOf(bt3, 1, 1, b2.id).length, 0, 'still out of the fight a round later');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, b1b.id).ok, 'A1\'s cell is taken while its squad is in');
  // B2 sells theirs: the cell frees up after the fight (no refund to A1), and A1 may jail again
  const gA = x.m(0).gold[0];
  assert.ok(x.act(3, 'sell', b2.id).ok, 'a jailed squad can be sold');
  playTo(x, 4);
  assert.deepStrictEqual(recOf(x, 0, key).data.cells.map(c => c.by), [1], 'A1\'s cell is free again');
  assert.ok(x.m(0).gold[0] >= gA, '(no gold taken)');
  assert.ok(x.act(0, 'mpbBuy', key, 'jail', 0, b1b.id).ok, 'A1 jails again');
  // a squad sold the round it was jailed: the jailer gets the gold back after the fight
  assert.ok(x.act(2, 'sell', b1b.id).ok);
  const gA4 = x.m(0).gold[0];
  playTo(x, 5);
  assert.ok(!recOf(x, 0, key).data.cells.some(c => c.by === 0), 'nothing locked up');
  const s4 = D.summary[0];
  assert.ok(x.m(0).gold[0] >= gA4 + 100 - 0, 'the 100 back (plus the round\'s income)');
  sameTeam(D, 0);
  assert.ok(s4.round === 4);
}));

check('jail: a carrier leaves its rider behind; buildings and riders can\'t be jailed', tough(() => {
  const x = match(103), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'jail');
  rich(D);
  const horse = addSq(D, 1, 1, 'Just a horse', 12, 2);
  Duo.setTeams(D.lanes.map(R => R.m));
  // B1's goblins ride in B2's horse (a ride across the team)
  const gob = addSq(D, 0, 1, 'Goblin Swarm', 4, 4);
  gob.col = 12; gob.row = 2; gob.in = horse.id + OFF; Duo.setTeams(D.lanes.map(R => R.m));
  assert.ok(Game.mateRide(gob), 'B1\'s goblins ride in B2\'s horse');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, gob.id).ok, 'a rider can\'t be jailed (nobody sees it)');
  assert.ok(x.act(0, 'mpbBuy', key, 'jail', 1, horse.id).ok, 'the horse can');
  const bt = battleNow(D), gb = bodiesOf(bt, 1, 0, gob.id);
  assert.strictEqual(bodiesOf(bt, 1, 1, horse.id).length, 0, 'the horse sits it out');
  assert.ok(gb.length > 0 && gb.every(b => !b.boarded && b.alive), 'its rider fights on foot');
  playTo(x, 3);
  const g = x.m(0).armies[1].find(q => q.id === gob.id), h = x.m(1).armies[1].find(q => q.id === horse.id);
  assert.ok(h.jailed, 'the horse is locked up');
  assert.ok(g.in == null && g.col === 12 && g.row === 2, 'the rider stepped out on the tile');
  Duo.setTeams(D.lanes.map(R => R.m));
  assert.ok(!Game.boardable(x.m(0), 1, h.col, h.row, UI('Goblin Swarm')), 'nobody boards a jailed horse');
  // a building squad (the Cog Builder's Factory has its own record; an Altar-like building unit): not jailable
  const bi = units.findIndex(u => u.building);
  if (bi >= 0) { const b = addSq(D, 0, 1, units[bi].name, 18, 4); assert.strictEqual(Mpb.jailWhy(x.m(1), 0, recOf(x, 0, key, 1), 0, b.id), 'squad', 'a building can\'t be jailed'); }
}));

check('jail: Skywatch (the lit tiles; stealthed enemies in its light are seen, a real Duo fight)', () => {
  const x = match(104), { D } = x;
  const key = addKind(D, 0, 'jail'), rec = recOf(x, 0, key);
  const lit = Mpb.litTiles(x.m(0), 0, rec);
  assert.strictEqual(lit.length, litCount(rec), '7 x 7 tiles round it (on the board), less its own');
  assert.ok(lit.every(t => Math.max(Math.abs(t.col - rec.col), Math.abs(t.row - rec.row)) <= 3));
  addSq(D, 0, 0, 'Brute', 4, 14);
  const rog = addSq(D, 0, 1, 'Rogue', 10, 2);
  const lanes = D.lanes.map(R => R.m);
  Duo.settle(lanes);
  const opts = Mpb.battleOpts(lanes[0], { mpb: {} });
  const w = Game.tileToWorld(rec.col, rec.row);
  const jk = Mpb.recs(lanes[0], 0).findIndex(r => r.key === key);
  assert.deepStrictEqual(opts.mpb.discover, [{ x: w.x, y: w.y, r: 3.5 * Game.TILE, side: 0, squad: Mpb.squadOf(jk) }], 'opts.mpb.discover (while the jail\'s own body stands)');
  // the Rogue walks into the light: seen; out of it: hidden again (it hasn't attacked)
  const run = (withJail) => {
    if (!withJail) for (const R of D.lanes) Mpb.recOf(R.m, 0, key).data.down = R.m.round; // (as the round after it fell)
    const bt = Duo.battle(lanes), rb = bodiesOf(bt, 1, 0, rog.id), d = { x: w.x, y: w.y, r: 3.5 * Game.TILE };
    assert.ok(rb.length > 0 && rb.every(b => b.hidden), 'stealthed at the start');
    for (const b of rb) { b.x = w.x + 6; b.y = w.y + 3; b.delay = 99; } // in its light (standing still)
    bt.step();
    const seen = rb.map(b => !b.hidden);
    for (const b of rb) { b.x = w.x + 6; b.y = w.y + 30; } // far out of it
    for (let k = 0; k < 40; k++) bt.step();
    for (const R of D.lanes) Mpb.recOf(R.m, 0, key).data.down = 0;
    return { seen, later: rb.map(b => !b.alive || b.hidden), inside: rb.every(b => !inSquare(b, d)) };
  };
  const a = run(true), b = run(false);
  assert.deepStrictEqual(a.seen, [true, true], 'with Skywatch: seen in its light');
  assert.deepStrictEqual(b.seen, [false, false], 'without: still hidden there');
  assert.ok(a.inside && a.later.every(Boolean), 'out of the light it hides again');
  // the jail falls in the fight: its light goes out with it (the Engine looks for its body every tick)
  {
    const bt = Duo.battle(lanes), rb = bodiesOf(bt, 1, 0, rog.id), jb = bt.bodies.filter(z => z.side === 0 && z.squad === Mpb.squadOf(jk));
    assert.ok(jb.length === 1 && rb.every(z => z.hidden));
    jb[0].alive = false; jb[0].hp = 0;
    for (const z of rb) { z.x = w.x + 6; z.y = w.y + 3; z.delay = 99; }
    bt.step(); bt.step();
    assert.deepStrictEqual(rb.map(z => z.hidden), [true, true], 'a fallen jail sees nothing');
  }
});

check('jail: guards hold their posts until an enemy is in their awareness (4 Keep guards)', tough(() => {
  const x = match(105), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'jail'), rec = recOf(x, 0, key);
  rich(D);
  assert.ok(x.act(1, 'mpbBuy', key, 'guards').ok, 'A2 buys the guards');
  assert.ok(!x.act(0, 'mpbBuy', key, 'guards').ok, 'once a match');
  const bt = battleNow(D), gs = bt.bodies.filter(b => b.side === 0 && b.squad === Mpb.extraOf(Mpb.recs(x.m(0), 0).findIndex(r => r.key === key), 0));
  assert.strictEqual(gs.length, 4, '4 guards');
  assert.ok(gs.every(b => b.guard && b.holdSee && b.holdT > 1e6 && b.u.name === 'Jail Guard' && !b.u.structure), 'Keep guards that hold');
  const w = Game.tileToWorld(rec.col, rec.row);
  assert.ok(gs.every(b => Math.hypot(b.x - w.x, b.y - w.y) <= Game.TILE * 0.8 + 1e-9), 'round the jail');
  assert.ok(Duo.teamBody(gs[0].squad), 'a team body (lane 0 builds it)');
  // Engine: a guard with no enemy in its awareness stays put (past the Keep's 5 s); one walks up: it goes
  const g0 = { ...gs[0] };
  const mk = (far) => {
    const gd = Engine.buildSquad({ ...gs[0].u, bodies: 1 }, 0, 0, -30, 1, 6, 0)[0];
    gd.holdT = 1e9; gd.holdSee = true; gd.guard = true;
    const foe = Engine.buildSquad(Engine.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp: 4000, hit: 1, aps: 0.5, range: 1, speed: far ? 0 : 3, splash: 0 }), 1, 0, far ? 60 : 30, 2, 6, 0);
    const b2 = Engine.createBattle([gd], foe, { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -80, y1: 80 } }, {});
    let moved = -1;
    for (let k = 0; k < 400 && b2.step(); k++) if (moved < 0 && Math.hypot(gd.x, gd.y + 30) > 0.5) moved = k;
    return moved;
  };
  assert.strictEqual(mk(true), -1, 'no enemy in its awareness: it holds (20 s)');
  assert.ok(mk(false) > 0, 'an enemy walks into its awareness: it leaves its post');
  assert.ok(g0.guard);
  // the next round they are there again; the jail down: none
  playTo(x, 3);
  assert.strictEqual(battleNow(D).bodies.filter(b => b.guard && b.holdSee && b.side === 0).length, 4, 'every fight');
}));

check('jail destroyed: the squads go free, their types never again, it does nothing next round', tough(() => {
  const x = match(106), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'jail');
  rich(D);
  const b1 = addSq(D, 0, 1, 'Brute', 9, 3), b2 = addSq(D, 1, 1, 'Rogue', 13, 3), b3 = addSq(D, 0, 1, 'Brute', 15, 4);
  assert.ok(x.act(0, 'mpbBuy', key, 'guards').ok);
  assert.ok(x.act(0, 'mpbBuy', key, 'jail', 0, b1.id).ok && x.act(1, 'mpbBuy', key, 'jail', 1, b2.id).ok);
  playTo(x, 3);
  assert.ok(x.m(0).armies[1].find(q => q.id === b1.id).jailed && x.m(1).armies[1].find(q => q.id === b2.id).jailed);
  // the jail falls in this round's fight (its main body: squad Mpb.SQ - k)
  const lanes = D.lanes.map(R => R.m), k = Mpb.recs(lanes[0], 0).findIndex(r => r.key === key), round = lanes[0].round;
  const sums = lanes.map(m => ({ round: m.round }));
  Mpb.afterFight(lanes, { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } } }, sums, [200, 200]);
  Duo.copyAll(lanes[0], lanes[1]);
  const rec = recOf(x, 0, key), q1 = lanes[0].armies[1].find(q => q.id === b1.id), q2 = lanes[1].armies[1].find(q => q.id === b2.id);
  assert.strictEqual(rec.fell, round);
  assert.ok(!q1.jailed && !q2.jailed, 'free');
  assert.deepStrictEqual([q1.col, q1.row, q2.col, q2.row], [9, 3, 13, 3], 'back on their own tiles (they were free)');
  assert.deepStrictEqual(rec.data.cells, []); assert.deepStrictEqual(rec.data.banned, [UI('Brute'), UI('Rogue')].sort((a, b) => a - b));
  assert.strictEqual(rec.data.down, round + 1);
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'jail' && n.freed === 2 && n.text), 'the news');
  playTo(x, round + 1);
  // the next round: no jailing, no Skywatch, no guards
  const m = x.m(0);
  assert.strictEqual(Mpb.jailWhy(m, 0, recOf(x, 0, key)), 'down');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, b3.id).ok, 'no jailing');
  assert.deepStrictEqual(Mpb.litTiles(m, 0, recOf(x, 0, key)), [], 'no light');
  const lanes2 = D.lanes.map(R => R.m); Duo.settle(lanes2);
  assert.ok(!(Mpb.battleOpts(lanes2[0], { mpb: {} }).mpb.discover || []).length, 'no Skywatch');
  const bt = Duo.battle(lanes2);
  assert.strictEqual(bt.bodies.filter(b => b.guard && b.holdSee).length, 0, 'no guards');
  assert.ok(bodiesOf(bt, 1, 0, b1.id).length > 0, 'the freed Brute fights again');
  playTo(x, round + 2);
  assert.ok(!Mpb.jailWhy(x.m(0), 0, recOf(x, 0, key)), 'working again');
  assert.strictEqual(Mpb.jailWhy(x.m(0), 0, recOf(x, 0, key), 0, b3.id), 'banned', 'another Brute: its type can\'t be jailed again');
  assert.ok(!x.act(0, 'mpbBuy', key, 'jail', 0, b3.id).ok);
  assert.ok(Mpb.litTiles(x.m(0), 0, recOf(x, 0, key)).length === litCount(recOf(x, 0, key)) && Duo.battle(D.lanes.map(R => R.m)).bodies.filter(b => b.guard && b.holdSee).length === 4, 'Skywatch and the guards back');
  sameTeam(D, 0);
}));

check('jail: a mirrored fight with a Jail (guards, Skywatch) on both sides comes out as an exact mirror', () => {
  const x = match(107), m0 = x.m(0);
  Game.useGrid(m0);
  const mm = W(Ref.snapshot(m0));
  mm.mpb = [[], []];
  const t = Mpb.spots(mm, 0, 'jail', null).find(s => Mpb.spotOk(mm, 1, 'jail', null, s.col, Game.ROWS - 1 - s.row)) || { col: 11, row: 15 };
  const ra = Mpb.addRec(mm, 0, 'jail', t.col, t.row), rb = Mpb.addRec(mm, 1, 'jail', t.col, Game.ROWS - 1 - t.row);
  for (const r of [ra, rb]) r.skills.guards = { round: 1, n: 1, by: [1, 0], log: [] };
  const A = Mpb.bodies(mm, 0), B = Mpb.bodies(mm, 1, 6000);
  // a stealthed Rogue squad and a Brute each, mirrored (x the same, y reflected), walking at the other's jail
  const rogue = Game.unitFor(mm, 0, UI('Rogue')), brute = Game.unitFor(mm, 0, UI('Brute'));
  const wa = Game.tileToWorld(t.col, t.row);
  A.push(...Engine.buildSquad(rogue, 0, wa.x + 8, -10, 1, 6, 100), ...Engine.buildSquad(brute, 0, wa.x - 8, -12, 2, 6, 110));
  B.push(...Engine.buildSquad(rogue, 1, wa.x + 8, 10, 1, 6, 100), ...Engine.buildSquad(brute, 1, wa.x - 8, 12, 2, 6, 110));
  const opts = Mpb.battleOpts(mm, { mpb: {} });
  assert.strictEqual(opts.mpb.discover.length, 2);
  assert.ok(Math.abs(opts.mpb.discover[0].y + opts.mpb.discover[1].y) < 1e-9 && opts.mpb.discover[0].x === opts.mpb.discover[1].x, 'the lights mirrored');
  const bt = Engine.createBattle(A, B, { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } }, opts);
  while (bt.step()) {}
  const r = bt.result();
  assert.ok(r.winner === -1 && Math.abs(r.frac[0] - r.frac[1]) < 1e-9, `an exact mirror (winner ${r.winner}, ${r.frac.map(f => f.toFixed(4))})`);
});

// =====================================================================
// School
// =====================================================================
check('school: the kind; enroll (own squads, either player), off the board, can\'t move/sell/take back, unit type locked', tough(() => {
  const K = Mpb.KINDS.school;
  assert.deepStrictEqual([Mpb.SCHOOL.hp, K.armor, K.kind, K.place.where, K.place.spacing], [700, 2, 'support', 'interior', true]);
  assert.deepStrictEqual(K.skills.map(s => [s.id, s.cost, s.per]), [['double', 200, 'match'], ['fast', 300, 'match']]);
  const x = match(111), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'school'), rec = recOf(x, 0, key);
  rich(D);
  const a1 = addSq(D, 0, 0, 'Brute', 5, 13), a1b = addSq(D, 0, 0, 'Rogue', 9, 13), a2 = addSq(D, 1, 0, 'Brute', 14, 13), at1 = { col: a1.col, row: a1.row };
  assert.ok(!x.act(0, 'mpbAct', key, 'enroll', 999).ok, 'not a squad A1 doesn\'t have');
  assert.ok(!x.act(2, 'mpbAct', key, 'enroll', 0).ok, 'not the other team');
  assert.ok(x.act(1, 'mpbAct', key, 'enroll', a2.id).ok, 'A2 puts their Brute in');
  sameTeam(D, 0);
  assert.ok(!x.act(0, 'mpbAct', key, 'enroll', a1.id).ok, 'it holds one squad');
  const q = x.m(1).armies[0].find(s => s.id === a2.id);
  assert.ok(q.school && q.school.key === key && q.col === rec.col && q.row === rec.row, 'on the school\'s tile');
  assert.deepStrictEqual([q.school.col, q.school.row], [14, 13]);
  Duo.setTeams(D.lanes.map(R => R.m));
  for (const L of [0, 1]) assert.ok(!Game.occupied(x.m(L), 0, 14, 13), 'its old tile is free (both lanes)');
  assert.ok(!x.act(1, 'moveSquad', a2.id, 14, 14).ok, 'it can\'t move');
  assert.ok(!x.act(1, 'sell', a2.id).ok, 'nor be sold');
  assert.ok(!Game.canMove(x.m(1), 0, q));
  // no new Brute for A2 while it is inside; A1 still can
  for (const R of D.lanes) for (const k of [UI('Brute')]) { R.m.unlocks = R.m.unlocks || [{}, {}]; R.m.unlocks[0][k] = 1; }
  assert.ok(!x.act(1, 'place', UI('Brute'), 15, 14).ok, 'A2 can\'t place a Brute');
  assert.ok(Game.schoolLock(x.m(1), 0, UI('Brute')) && !Game.schoolLock(x.m(0), 0, UI('Brute')));
  assert.ok(x.act(0, 'place', UI('Brute'), 7, 14).ok, 'A1 can');
  // a squad placed this round can go in, and then can't be taken back
  assert.ok(x.act(1, 'mpbAct', key, 'leave').ok, 'A2 takes it out (free)');
  assert.ok(!q.school && q.col === 14 && q.row === 13, 'back on its tile');
  const nb = x.m(0).armies[0].find(s => s.round === x.m(0).round && s.unit === UI('Brute'));
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', nb.id).ok, 'A1 puts in a squad of this round');
  assert.ok(!x.act(0, 'unplaceSquad', nb.id).ok, 'it can\'t be taken back while inside');
  assert.ok(x.act(0, 'mpbAct', key, 'leave').ok && x.act(0, 'unplaceSquad', nb.id).ok, 'out, then taken back');
  // riders, carriers with a rider, squads moved this round: no
  const hs = addSq(D, 0, 0, 'Just a horse', 11, 14), rd = addSq(D, 0, 0, 'Goblin Swarm', 4, 16);
  rd.col = 11; rd.row = 13; rd.in = hs.id; Duo.setTeams(D.lanes.map(R => R.m));
  assert.ok(!x.act(0, 'mpbAct', key, 'enroll', hs.id).ok, 'not a carrier with a rider');
  assert.ok(!x.act(0, 'mpbAct', key, 'enroll', rd.id).ok, 'not a rider');
  assert.ok(x.act(0, 'moveSquad', a1b.id, 9, 14).ok);
  assert.ok(!x.act(0, 'mpbAct', key, 'enroll', a1b.id).ok, 'not a squad moved this round');
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', a1.id).ok);
  // the opponents don't see it go in this round: they see it on its tile, the school empty
  const v = Duo.viewFor(D, 2).m, seen = v.armies[0].find(s => s.id === a1.id);
  assert.ok(seen && !seen.school && seen.col === at1.col && seen.row === at1.row, 'B1 sees it on its old tile');
  assert.ok(!('pupil' in Mpb.recOf(v, 0, key).data), 'and the school empty (no pupil key, as before a first enrolment)');
  assert.ok(Mpb.recOf(Duo.viewFor(D, 3).m, 0, key).data.pupil === undefined);
  assert.ok(Mpb.recOf(Duo.viewFor(D, 1).m, 0, key).data.pupil.id === a1.id, 'A2 sees it');
  // it doesn't fight (a real Duo fight)
  const bt = battleNow(D);
  assert.strictEqual(bodiesOf(bt, 0, 0, a1.id).length, 0, 'not in the fight');
  assert.ok(bodiesOf(bt, 0, 1, a2.id).length > 0, 'the other Brute is');
  playTo(x, 3);
  const v3 = Duo.viewFor(D, 2).m;
  assert.ok(v3.armies[0].find(s => s.id === a1.id).school, 'after the fight the opponents see it in the school');
  assert.strictEqual(bodiesOf(battleNow(D), 0, 0, a1.id).length, 0, 'still out of the fight');
}));

check('school: Study (+a level\'s XP a round, Double study twice), Learn (free, 2 rounds; Quick learning 1), Take out', tough(() => {
  const x = match(112), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'school');
  rich(D);
  const a1 = addSq(D, 0, 0, 'Rogue', 5, 13);
  const ui = a1.unit, u = units[ui];
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', a1.id).ok);
  const sq = () => x.m(0).armies[0].find(s => s.id === a1.id);
  const step0 = Game.xpNeeded(u, 0);
  assert.strictEqual(Mpb.levelXp(x.m(0), sq()), step0, 'a level\'s worth: the step to level 2');
  // Learn: a skill of its unit, free, while it can't leave; Stop learning this round
  const ks = Mpb.learnable(x.m(0), 0, sq());
  assert.ok(ks.length >= 1, 'something to learn');
  const k = ks[0], g = x.m(0).gold[0];
  assert.ok(!x.act(1, 'mpbAct', key, 'learn', k).ok, 'only its own player');
  assert.ok(x.act(0, 'mpbAct', key, 'learn', k).ok, 'learn');
  assert.strictEqual(x.m(0).gold[0], g, 'free');
  assert.ok(!x.act(0, 'mpbAct', key, 'leave').ok, 'can\'t leave while learning');
  assert.ok(!x.act(0, 'mpbAct', key, 'learn', ks[1] != null ? ks[1] : k).ok, 'one at a time');
  assert.ok(x.act(0, 'mpbAct', key, 'unlearn').ok && x.act(0, 'mpbAct', key, 'learn', k).ok, 'stop and start again this round');
  assert.ok(Mpb.recOf(Duo.viewFor(D, 2).m, 0, key).data.pupil == null, '(the opponents see none of it)');
  const xp0 = sq().xp;
  playTo(x, 3);
  assert.ok(!x.act(0, 'mpbAct', key, 'unlearn').ok, 'not stopped in a later round');
  assert.ok(sq().xp >= xp0 + step0, 'Study: +a level (and nothing from the fight)');
  assert.strictEqual(sq().xp, xp0 + step0, 'exactly a level\'s worth');
  assert.ok(!Game.hasSkill(x.m(0), 0, ui, k), 'not learnt after 1 round');
  playTo(x, 4);
  assert.ok(Game.hasSkill(x.m(0), 0, ui, k), 'learnt after 2 rounds');
  assert.ok(x.m(0).tech[0][ui][k] === 3 && Game.skillVisible(x.m(0), 0, ui, k), 'as if bought last round (seen, no take-back)');
  assert.ok(!x.act(0, 'undoSkill', ui, k).ok, 'it can\'t be undone for gold');
  assert.strictEqual(recOf(x, 0, key).data.pupil.learn, null);
  // Double study, Quick learning
  assert.ok(x.act(1, 'mpbBuy', key, 'double').ok && x.act(0, 'mpbBuy', key, 'fast').ok, 'both bought');
  const ks2 = Mpb.learnable(x.m(0), 0, sq());
  if (ks2.length) assert.ok(x.act(0, 'mpbAct', key, 'learn', ks2[0]).ok);
  const xp1 = sq().xp, step = Mpb.levelXp(x.m(0), sq());
  playTo(x, 5);
  assert.strictEqual(sq().xp, xp1 + 2 * step, 'Double study: twice the XP');
  if (ks2.length) assert.ok(Game.hasSkill(x.m(0), 0, ui, ks2[0]), 'Quick learning: learnt after 1 round');
  // Take out: a tile tapped (not a taken one), the nearest free one
  Duo.setTeams(D.lanes.map(R => R.m));
  const rec = recOf(x, 0, key);
  assert.ok(!x.act(0, 'mpbAct', key, 'leave', rec.col, rec.row).ok, 'not onto the school');
  assert.ok(!x.act(0, 'mpbAct', key, 'leave', 10, 3).ok, 'not into the enemy zone');
  assert.ok(x.act(0, 'mpbAct', key, 'leave', 8, 15).ok, 'onto a tile tapped');
  assert.ok(sq().col === 8 && sq().row === 15 && !sq().school);
  // the opponents still see it in the school this round
  const v = Duo.viewFor(D, 2).m;
  assert.ok(v.armies[0].find(s => s.id === a1.id).school && Mpb.recOf(v, 0, key).data.pupil.id === a1.id, 'its leaving is hidden until the fight');
  assert.ok(bodiesOf(battleNow(D), 0, 0, a1.id).length > 0, 'it fights again');
  sameTeam(D, 0);
}));

check('school destroyed: its destroyer gets half a level (a real fight), the squad inside comes out as it went in', tough(() => {
  const x = match(113), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const key = addKind(D, 0, 'school'), rec = recOf(x, 0, key);
  rich(D);
  const a2 = addSq(D, 1, 0, 'Rogue', 14, 13, { xp: 10, level: 0 });
  const foe = addSq(D, 1, 1, 'Slimeshots', 12, 4);
  assert.ok(x.act(1, 'mpbAct', key, 'enroll', a2.id).ok);
  playTo(x, 3);
  assert.ok(x.act(1, 'mpbAct', key, 'learn', Mpb.learnable(x.m(1), 0, x.m(1).armies[0].find(s => s.id === a2.id))[0]).ok, 'learning something');
  const gained = x.m(1).armies[0].find(s => s.id === a2.id).xp;
  assert.ok(gained > 10, 'it gained XP inside');
  // a real fight: B2's Slimeshots cut the school down (it is weakened, and they stand next to it)
  const lanes = D.lanes.map(R => R.m); Duo.settle(lanes);
  const bt = Duo.battle(lanes), k = Mpb.recs(lanes[0], 0).findIndex(r => r.key === key), sb = bt.bodies.find(b => b.side === 0 && b.squad === Mpb.squadOf(k));
  assert.ok(sb && sb.watchKill, 'its body is watched');
  sb.hp = 5;
  const w = Game.tileToWorld(rec.col, rec.row);
  for (const b of bodiesOf(bt, 1, 1, foe.id)) { b.x = w.x + 2; b.y = w.y + 8; b.delay = 0; }
  for (const b of bt.bodies) if (b.side === 1 && b.squad !== foe.id + OFF) { b.alive = false; b.hp = 0; } // nothing else of theirs (the guards...)
  while (bt.step() && sb.alive) {}
  const res = bt.result();
  assert.ok(!sb.alive, 'it fell');
  const kb = res.killedBy.find(r => r.side === 0 && r.squad === Mpb.squadOf(k));
  assert.deepStrictEqual(kb.by, { side: 1, squad: foe.id + OFF }, 'the Engine says who did it');
  const fq = lanes[1].armies[1].find(s => s.id === foe.id), fxp = fq.xp, half = Math.floor(Mpb.levelXp(lanes[1], fq) * 0.5);
  const sums = lanes.map(m => ({ round: m.round }));
  Mpb.afterFight(lanes, res, sums, [200, 200]);
  Duo.copyAll(lanes[0], lanes[1]);
  assert.strictEqual(fq.xp, fxp + half, 'the destroyer: +half a level\'s XP');
  const q = lanes[1].armies[0].find(s => s.id === a2.id);
  assert.ok(!q.school && q.xp === 10 && q.level === 0, 'the squad inside: the XP and level it went in with');
  assert.deepStrictEqual([q.col, q.row], [14, 13], 'on its old tile');
  assert.strictEqual(recOf(x, 0, key).data.pupil, null, 'the school is empty, the skill lost');
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'school' && n.xp && n.xp.xp === half && n.out), 'the news');
  sameTeam(D, 0);
  // engine off by default: a 1v1 battle has no killedBy
  assert.ok(!('killedBy' in Engine.createBattle([], [], Game.SETTINGS).result()));
}));

check('school: a mirrored fight with a School on both sides comes out as an exact mirror', () => {
  const x = match(114), m0 = x.m(0);
  Game.useGrid(m0);
  const mm = W(Ref.snapshot(m0));
  mm.mpb = [[], []];
  const t = Mpb.spots(mm, 0, 'school', null).find(s => Mpb.spotOk(mm, 1, 'school', null, s.col, Game.ROWS - 1 - s.row));
  Mpb.addRec(mm, 0, 'school', t.col, t.row); Mpb.addRec(mm, 1, 'school', t.col, Game.ROWS - 1 - t.row);
  const A = Mpb.bodies(mm, 0), B = Mpb.bodies(mm, 1, 6000), wa = Game.tileToWorld(t.col, t.row);
  const sl = Game.unitFor(mm, 0, UI('Slimeshots'));
  A.push(...Engine.buildSquad(sl, 0, wa.x + 4, -4, 1, 6, 100)); B.push(...Engine.buildSquad(sl, 1, wa.x + 4, 4, 1, 6, 100));
  const opts = Mpb.battleOpts(mm, { mpb: {} });
  assert.ok(opts.mpb.watchKills);
  const bt = Engine.createBattle(A, B, { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } }, opts);
  while (bt.step()) {}
  const r = bt.result();
  assert.ok(r.winner === -1 && Math.abs(r.frac[0] - r.frac[1]) < 1e-9, `an exact mirror (winner ${r.winner}, ${r.frac.map(f => f.toFixed(4))})`);
  const kb = r.killedBy.map(z => [z.side, z.by && z.by.side]);
  assert.deepStrictEqual(kb.map(z => z[0]).sort(), [0, 1]);
  assert.ok(kb[0][1] === kb[1][1] || (kb[0][1] === 1 - kb[0][0] && kb[1][1] === 1 - kb[1][0]), 'both fell the same way');
});

// =====================================================================
// Both
// =====================================================================
check('the page\'s copy hashes as the server\'s after every Jail and School action', tough(() => {
  const x = match(121), { D } = x;
  next(x); // (round 2: squads from round 1 are seen)
  const jk = addKind(D, 0, 'jail'), sk = addKind(D, 0, 'school'), jb = addKind(D, 1, 'jail');
  rich(D);
  const b1 = addSq(D, 0, 1, 'Brute', 9, 3), b2 = addSq(D, 1, 1, 'Rogue', 13, 3), a1 = addSq(D, 0, 0, 'Rogue', 5, 13), a2 = addSq(D, 1, 0, 'Brute', 14, 14);
  pageTry(x, 0, 'mpbBuy', jk, 'jail', 1, b2.id);
  pageTry(x, 1, 'mpbBuy', jk, 'jail', 0, b1.id);
  pageTry(x, 1, 'mpbUndo', jk, 'jail');
  pageTry(x, 1, 'mpbBuy', jk, 'jail', 0, b1.id);
  pageTry(x, 0, 'mpbBuy', jk, 'jail', 0, b1.id); // refused on both
  pageTry(x, 1, 'mpbBuy', jk, 'guards');
  pageTry(x, 2, 'mpbBuy', jb, 'jail', 0, a1.id);
  pageTry(x, 3, 'mpbBuy', jb, 'jail', 0, a1.id); // the same squad: refused on both (B2 sees B1's cell)
  pageTry(x, 0, 'mpbAct', sk, 'enroll', a1.id);
  pageTry(x, 1, 'mpbAct', sk, 'enroll', a2.id); // full
  const k = Mpb.learnable(x.m(0), 0, x.m(0).armies[0].find(s => s.id === a1.id))[0];
  pageTry(x, 0, 'mpbAct', sk, 'learn', k);
  pageTry(x, 0, 'mpbAct', sk, 'leave'); // learning: refused
  pageTry(x, 0, 'mpbAct', sk, 'unlearn');
  pageTry(x, 0, 'mpbAct', sk, 'leave', 6, 14); // put in this round: only taken back onto its own tile (refused on both)
  assert.ok(pageTry(x, 0, 'mpbAct', sk, 'leave').ok, 'taken back');
  pageTry(x, 1, 'mpbAct', sk, 'enroll', a2.id);
  pageTry(x, 0, 'mpbBuy', sk, 'double');
  for (let s = 0; s < 4; s++) { const sd = Duo.SEATS[s].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, s).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[s].lane].m, sd), 'seat ' + s + ' in step'); }
  playTo(x, 3);
  // the jailed player's moves, refused on the page as on the server; selling it is fine
  pageTry(x, 2, 'moveSquad', b1.id, 9, 4);
  pageTry(x, 2, 'sell', b1.id);
  assert.ok(x.m(0).armies[0].find(q => q.id === a1.id).jailed, 'A1\'s Rogue left the school before the fight: B1 jailed it');
  assert.ok(pageTry(x, 1, 'mpbAct', sk, 'leave').ok);
  pageTry(x, 1, 'sell', a2.id);
  for (let s = 0; s < 4; s++) { const sd = Duo.SEATS[s].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, s).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[s].lane].m, sd), 'seat ' + s + ' in step'); }
  // Undo all keeps the teammate's
  const a3 = addSq(D, 0, 0, 'Shiv', 8, 15), a3col = a3.col;
  assert.ok(pageTry(x, 0, 'mpbAct', sk, 'enroll', a3.id).ok);
  // A2's Undo all puts A2's Brute back in the school (its take-out undone): A1's squad, which went in after, comes out
  // again (the record and the squads always agree: Mpb.reconcile)
  assert.ok(x.act(1, 'undoAll').ok);
  assert.deepStrictEqual([recOf(x, 0, sk).data.pupil.lane, recOf(x, 0, sk).data.pupil.id], [1, a2.id], 'A2\'s Brute is back in');
  assert.ok(x.m(1).armies[0].find(q => q.id === a2.id).school, 'in its lane too');
  assert.ok(!x.m(0).armies[0].find(q => q.id === a3.id).school && x.m(0).armies[0].find(q => q.id === a3.id).col === a3col, 'A1\'s Shiv is out, on its tile');
  sameTeam(D, 0);
  for (let s = 0; s < 4; s++) { const sd = Duo.SEATS[s].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, s).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[s].lane].m, sd), 'seat ' + s + ' in step'); }
  // A1's own Undo all: their enrollment goes, A2's stays
  assert.ok(x.act(1, 'mpbAct', sk, 'leave').ok && pageTry(x, 0, 'mpbAct', sk, 'enroll', a3.id).ok, 'A2 out, A1\'s Shiv in');
  assert.ok(x.act(0, 'undoAll').ok);
  assert.strictEqual(recOf(x, 0, sk).data.pupil, null, 'A1\'s Undo all takes it out (and A2\'s take-out stays)');
  assert.ok(!x.m(0).armies[0].find(s => s.id === a3.id).school && !x.m(1).armies[0].find(s => s.id === a2.id).school);
  sameTeam(D, 0);
}));

// =====================================================================
// Review fixes (7 Nov)
// =====================================================================
check('school: put in and taken out the same round is a take-back onto its own tile (no free move, nothing to see)', tough(() => {
  const x = match(131), { D } = x;
  next(x); // (round 2)
  const key = addKind(D, 0, 'school');
  rich(D);
  const br = addSq(D, 0, 0, 'Brute', 5, 13), rg = addSq(D, 0, 0, 'Rogue', 9, 13), at = { col: br.col, row: br.row };
  const sq = () => x.m(0).armies[0].find(s => s.id === br.id);
  assert.ok(x.act(0, 'moveSquad', rg.id, 9, 14).ok, 'the round\'s paid move, on the Rogue');
  const g = x.m(0).gold[0];
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'enroll', br.id).ok);
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'leave', 15, 16).ok, 'not onto another tile');
  assert.ok(!Mpb.schoolWhy(x.m(0), 0, recOf(x, 0, key), 'leave', [at.col, at.row]), 'onto its own tile: yes');
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'leave').ok, 'taken back');
  assert.deepStrictEqual([sq().col, sq().row, !!sq().school, x.m(0).gold[0]], [at.col, at.row, false, g], 'on its own tile, free');
  assert.ok(!Game.canMove(x.m(0), 0, sq()), 'still no second move this round');
  assert.deepStrictEqual(recOf(x, 0, key).data.was || [], [], 'nothing for the opponents to replay');
  const v = Duo.viewFor(D, 2).m.armies[0].find(s => s.id === br.id);
  assert.deepStrictEqual([v.col, v.row, !!v.school], [at.col, at.row, false], 'the opponents see it where it stood');
  // its tile taken meanwhile (a new squad of theirs): it stays in this round
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'enroll', br.id).ok);
  for (const R of D.lanes) for (const k of [UI('Rogue')]) { R.m.unlocks = R.m.unlocks || [{}, {}]; R.m.unlocks[0][k] = 1; }
  assert.ok(x.act(0, 'place', UI('Rogue'), at.col, at.row).ok, 'a new Rogue on its tile');
  assert.ok(!pageTry(x, 0, 'mpbAct', key, 'leave').ok, 'no take-back onto a taken tile');
  // from the next round: out onto any free tile of the zone, as before
  playTo(x, 3);
  assert.ok(pageTry(x, 0, 'mpbAct', key, 'leave', 15, 14).ok && sq().col === 15 && sq().row === 14, 'a later round: onto a tile tapped');
  const v3 = Duo.viewFor(D, 2).m.armies[0].find(s => s.id === br.id);
  assert.ok(v3.school && v3.col === recOf(x, 0, key).col, 'hidden: the opponents still see it inside');
  sameTeam(D, 0);
}));

check('school: a learnt skill keeps the either-or rule (the other one can\'t be bought meanwhile; checked again when learnt)', tough(() => {
  const x = match(132), { D } = x;
  next(x);
  const key = addKind(D, 0, 'school');
  rich(D);
  const ui = units.findIndex((u, i) => Engine.SLOTS.some(k => Game.skillOr(x.m(0), i, k).length) && !u.building && !Game.isCarrier(x.m(0), i));
  assert.ok(ui >= 0, 'a unit with an either-or pair');
  const k = Engine.SLOTS.find(j => Game.skillOr(x.m(0), ui, j).length && Game.skillDef(x.m(0), ui, j) && !Game.isAwaken(x.m(0), ui, j) && !Game.isEvolve(x.m(0), ui, j));
  const other = Game.skillOr(x.m(0), ui, k)[0];
  const a1 = addSq(D, 0, 0, units[ui].name, 5, 13); addSq(D, 0, 0, units[ui].name, 9, 13);
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', a1.id).ok && x.act(0, 'mpbAct', key, 'learn', k).ok, 'learning skill ' + k);
  assert.ok(!Game.canBuySkill(x.m(0), 0, ui, other), 'its either-or partner can\'t be bought while it is learnt');
  assert.ok(!pageTry(x, 0, 'buySkill', ui, other).ok, '(refused on the page and the server)');
  assert.ok(Game.canBuySkill(x.m(1), 0, ui, other) || !x.m(1).armies[0].some(s => s.unit === ui), '(the teammate\'s skills are their own)');
  next(x);
  assert.ok(!pageTry(x, 0, 'buySkill', ui, other).ok, 'nor the next round');
  // checked again when it is learnt: the partner given some other way meanwhile, the learn is dropped
  for (const R of [D.lanes[0]]) { const t = R.m.tech[0][ui] || (R.m.tech[0][ui] = Engine.SLOTS.map(() => 0)); t[other] = 2; }
  next(x);
  assert.ok(!Game.hasSkill(x.m(0), 0, ui, k) && Game.hasSkill(x.m(0), 0, ui, other), 'never both of an either-or pair');
  assert.strictEqual(recOf(x, 0, key).data.pupil.learn, null, 'the learn is over');
}));

check('jail on a squad its owner puts in their School this round: allowed alike on the page and the server, gold back', tough(() => {
  const x = match(133), { D } = x;
  next(x);
  const jk = addKind(D, 0, 'jail'), sk = addKind(D, 1, 'school');
  rich(D);
  const b1 = addSq(D, 0, 1, 'Brute', 9, 3), b2 = addSq(D, 1, 1, 'Rogue', 13, 3);
  assert.ok(x.act(2, 'mpbAct', sk, 'enroll', b1.id).ok, 'B1 puts its Brute in (hidden)');
  assert.ok(pageTry(x, 0, 'mpbBuy', jk, 'jail', 0, b1.id).ok, 'A1 may jail it (it looks like any squad): the page as the server');
  { // after the fight (its buildings' part, on copies): it sat in the School, so not jailed, and A1 gets the 100 back
    const lanes = D.lanes.map(R => W(Ref.snapshot(R.m))), round = lanes[0].round, g = lanes[0].gold[0];
    Mpb.afterFight(lanes, { squads: {} }, [{ round }, { round }], [100, 100]);
    const q = lanes[0].armies[1].find(s => s.id === b1.id);
    assert.ok(!q.jailed && q.school, 'it sat in the School: not jailed');
    assert.strictEqual(lanes[0].gold[0] - g, 100, 'the 100 back');
    assert.deepStrictEqual(Mpb.recOf(lanes[0], 0, jk).data.cells, []);
  }
  playTo(x, 3);
  assert.ok(!x.m(0).armies[1].find(s => s.id === b1.id).jailed && recOf(x, 0, jk).data.cells.length === 0, '(the same in the real round)');
  // it comes out this round (in since an earlier round): the jailer still sees it inside, so refused on both
  assert.ok(x.act(2, 'mpbAct', sk, 'leave').ok);
  assert.ok(!pageTry(x, 0, 'mpbBuy', jk, 'jail', 0, b1.id).ok, 'a squad that left this round: refused on the page and the server');
  assert.ok(pageTry(x, 1, 'mpbBuy', jk, 'jail', 1, b2.id).ok);
}));

check('jailed and put in its School the same round, the School falls: the same outcome whichever side owns which', () => {
  const out = [0, 1].map(schoolSide => {
    const jailSide = 1 - schoolSide, x = match(134), { D } = x;
    next(x);
    const jk = addKind(D, jailSide, 'jail'), sk = addKind(D, schoolSide, 'school');
    rich(D);
    const sq = addSq(D, 0, schoolSide, 'Brute', 9, Game.zoneRows(schoolSide)[2]);
    assert.ok(x.act(Duo.seatOf(0, jailSide), 'mpbBuy', jk, 'jail', 0, sq.id).ok && x.act(Duo.seatOf(0, schoolSide), 'mpbAct', sk, 'enroll', sq.id).ok);
    const lanes = D.lanes.map(R => R.m), round = lanes[0].round, g0 = lanes[0].gold[jailSide];
    const k = Mpb.recs(lanes[0], schoolSide).findIndex(r => r.key === sk);
    Mpb.afterFight(lanes, { squads: { [schoolSide + ':' + Mpb.squadOf(k)]: { side: schoolSide, squad: Mpb.squadOf(k), total: 1, alive: 0 } }, killedBy: [] }, [{ round }, { round }], [100, 100]);
    const q = lanes[0].armies[schoolSide].find(s => s.id === sq.id);
    return [!!q.jailed, !!q.school, lanes[0].gold[jailSide] - g0, Mpb.recOf(lanes[0], jailSide, jk).data.cells.length];
  });
  assert.deepStrictEqual(out[0], out[1], 'mirror: ' + JSON.stringify(out));
  assert.deepStrictEqual(out[0], [false, false, 100, 0], 'not jailed, out of the School, the jailer\'s 100 back');
});

check('jail falls in the fight it jails in: that squad goes free with no ban (no refund: it sat the fight out); a sold one: gold back', () => {
  const x = match(135), { D } = x;
  next(x);
  const jk = addKind(D, 0, 'jail');
  rich(D);
  const br = addSq(D, 0, 1, 'Brute', 9, 3), rg = addSq(D, 1, 1, 'Rogue', 13, 3);
  assert.ok(x.act(0, 'mpbBuy', jk, 'jail', 0, br.id).ok && x.act(1, 'mpbBuy', jk, 'jail', 1, rg.id).ok);
  assert.ok(x.act(3, 'sell', rg.id).ok, 'B2 sells the Rogue (it doesn\'t know)');
  const lanes = D.lanes.map(R => R.m), round = lanes[0].round, g = lanes.map(m => m.gold[0]);
  const k = Mpb.recs(lanes[0], 0).findIndex(r => r.key === jk), sums = [{ round }, { round }];
  Mpb.afterFight(lanes, { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } } }, sums, [100, 100]);
  const rec = Mpb.recOf(lanes[0], 0, jk), q = lanes[0].armies[1].find(s => s.id === br.id);
  assert.ok(!q.jailed && q.col === 9 && q.row === 3, 'the Brute is free on its tile');
  assert.deepStrictEqual(rec.data.banned, [], 'no unit type banned');
  assert.deepStrictEqual([lanes[0].gold[0] - g[0], lanes[1].gold[0] - g[1]], [0, 100], 'A1 keeps nothing back (its Brute sat out), A2 gets the 100 back (sold)');
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'jail' && n.spared === 1 && n.freed === 0 && /not taken/.test(n.text)), 'the news says so');
});

check('a full bot 2v2, rounds 1 to 10, with a Jail and a School on both teams: no exception, in step, playback', () => {
  let jailed = 0, schooled = 0, learnt = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 4000 + seed, [true, true, true, true]);
    for (const sd of [0, 1]) for (const kind of ['jail', 'school']) addKind(D, sd, kind);
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + D.lanes[0].m.round);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      for (const L of [0, 1]) for (const sd of [0, 1]) for (const q of D.lanes[L].m.armies[sd]) { if (q.jailed) jailed++; if (q.school) schooled++; }
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
      for (const sd of [0, 1]) for (const r of Mpb.recs(D.lanes[0].m, sd)) if (r.kind === 'school' && r.data.pupil && r.data.pupil.learn) learnt++;
    }
    const m = D.lanes[0].m;
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, jail cells ${[0, 1].map(sd => Mpb.recs(m, sd).filter(r => r.kind === 'jail').map(r => (r.data.cells || []).length)).join(' / ')}, schools ${[0, 1].map(sd => Mpb.recs(m, sd).filter(r => r.kind === 'school').map(r => r.data.pupil ? units[r.data.pupil.ui].name : '-')).join(' / ')}`);
  }
  assert.ok(jailed > 0 && schooled > 0 && learnt > 0, `bots use them (jailed ${jailed}, in school ${schooled}, learning ${learnt} squad-rounds)`);
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall B4 (Jail, School) checks passed');
