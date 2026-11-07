// Headless checks of Vilhelm's last two answers of 6 Nov 2026 on the 2v2 buildings (PATCH-NOTES 6 November,
// docs/MPB-2V2.md answers 5 and 6):
//  5. "You always have 'prio' in your own zone, which means that putting the mine entrance gives u prio over the
//     opponents placement: His model moves and yours stays." At the fight's start, of two teams' things on one tile
//     of a team's own zone (its rows, but not the edge tiles kept as the other team's flank tiles: Game.reserved),
//     that team's thing always stays and the other team's moves to the nearest tile its own rules allow, whatever
//     their stamps (no tile for it anywhere: both stay); in no man's land, on those flank tiles, and between two
//     things of one team, the newer still moves. The Coal mine's exit still never
//     moves and moves nothing (it is blocked), and squads in a building go with it.
//  6. "Lets just go with no, no walls on the lake." A Bastion wall never stands on water: no wall on water you can
//     see, no water on a wall you can see (yours, your teammate's, theirs from earlier rounds), page and server alike;
//     a hidden wall and hidden water that meet are a clash (prio on a zone tile, else the newer moves).
// Run: node tools/tests/mpb-prio.js
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
let fails = 0, passed = 0;
const only = process.env.ONLY || '';
const check = (name, fn) => { if (only && !name.includes(only)) return; try { fn(); passed++; console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };
const ui = (name) => { const i = units.findIndex(u => u.name === name); if (i < 0) throw new Error('no unit ' + name); return i; };
const lanesOf = (D) => D.lanes.map(R => R.m);
const teams = (D) => Duo.setTeams(lanesOf(D));
const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const at = (q) => [q.col, q.row];
const T = 1e12;
const COAL = Mpb.kindOf('coalMine'), LK = Mpb.kindOf('magicLake');
const seatOf = (L, sd) => Duo.seatOf(L, sd);

// ----- helpers (as tools/tests/mpb-hidden.js and mpb-answers.js) -----
function match(seed, bots = [false, false, false, false], secret) {
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, T, seed, bots, secret);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, act, m: (L) => D.lanes[L].m };
}
function playTo(x, round) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  }
}
// a building of kind at t in both lanes, as if it stood when the round began
function put(D, sd, kind, t) {
  teams(D);
  t = t || Mpb.autoSpot(D.lanes[0].m, sd, kind, null);
  assert.ok(t, 'room for ' + kind);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  return Mpb.recs(D.lanes[0].m, sd).slice(-1)[0].key;
}
const rich = (D) => { for (const R of D.lanes) { R.m.gold = [9000, 9000]; R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; } };
const clearArmies = (D) => { for (const R of D.lanes) { R.m.armies = [[], []]; R.m.artifacts = null; } teams(D); };
// as if the round began now (the team's part, the log, every stamp)
const fresh = (D) => { teams(D); for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd)); D.tlog = [[], []]; Duo.stampAll(D, true); };
// a match at `round` with no squads, rich, the Assassin unlocked for all (round 3 opens the flank tiles)
function board(seed, round = 2) {
  const x = match(seed), { D } = x;
  playTo(x, round);
  clearArmies(D); rich(D);
  for (const seat of [0, 1, 2, 3]) { const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side; if (!Game.isUnlocked(x.m(L), sd, ui('Assassin'))) assert.ok(x.act(seat, 'unlock', ui('Assassin')).ok); }
  fresh(D);
  return x;
}
// team sd votes kind onto t (both players)
function vote(x, sd, kind, t, part, key) {
  const { D } = x;
  for (const R of D.lanes) Mpb.queue(R.m, sd, kind, part, key);
  Duo.tick(D, T);
  const s0 = seatOf(0, sd), s1 = seatOf(1, sd);
  assert.ok(x.act(s0, 'mpbVote', t.col, t.row).ok && x.act(s1, 'mpbVote', t.col, t.row).ok, kind + (part ? ' ' + part : '') + ' voted onto ' + JSON.stringify(t));
  if (part) return key;
  const rec = Mpb.recs(x.m(0), sd).find(r => r.kind === kind && r.col === t.col && r.row === t.row);
  assert.ok(rec, kind + ' placed');
  return rec.key;
}
// a plain unit the seat has (not a building, not 'anywhere', one tile)
const plain = (x, seat) => { const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side, m = x.m(L); return units.map((u, i) => i).find(i => !units[i].building && !units[i].anywhere && !units[i].mpbUnit && !units[i].noFlank && Game.isUnlocked(m, sd, i) && Game.footprint(m, i) === 1); };
// a squad placed by a seat (the server's act: as its team sees the board)
function place(x, seat, name, col, row) {
  const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side;
  const r = x.act(seat, 'place', name === 'plain' ? plain(x, seat) : ui(name), col, row);
  assert.ok(r.ok, name + ' placed by seat ' + seat + ' on ' + col + ',' + row + ' (' + r.why + ')');
  return x.m(L).armies[sd].slice(-1)[0];
}
// the page's copy (the seat's view) runs the action too: allowed the same; hashes as the server's
function try1(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ': allowed on the page as on the server (' + r.why + ')');
  if (r.ok) assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  return r;
}
// the fight: returns the lanes as they fought (after the settle), with m.team
function fight(x) {
  let f = null;
  for (let k = 0; k < 4; k++) f = Duo.setReady(x.D, k, true, T) || f;
  assert.ok(f, 'fought');
  const P = f.pres.map(W);
  Duo.setTeams(P);
  return { f, P };
}
const recIn = (m, sd, key) => Mpb.recOf(m, sd, key);
const sqIn = (P, L, sd, id) => P[L].armies[sd].find(q => q.id === id);
// the moved squad q (side sd, lane L) stands on a tile its own rules allow, everything known (its placement rules as a
// move, nothing else on it in either lane: Duo's relocate), and no further from t than the nearest such tile
function landedNear(P, L, sd, q, t, why) {
  const m = P[L], ok = [];
  assert.ok(!(q.col === t.col && q.row === t.row), why + ': it moved off ' + JSON.stringify(at(t)));
  for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) {
    if ((c === t.col && r === t.row) || (c === q.col && r === q.row)) continue;
    if (Game.canPlaceAt(m, sd, c, r, q.unit, true) && !Game.occupied(m, sd, c, r) && !Game.occupied(m, 1 - sd, c, r) && !Game.terrainBlocks(m, c, r)) ok.push({ col: c, row: r });
  }
  // its own tile: allowed for it, everything known (as a move)
  const arr = m.armies[sd], i = arr.indexOf(q);
  arr.splice(i, 1);
  try { assert.ok(Game.canPlaceAt(m, sd, q.col, q.row, q.unit, true) && !Game.occupied(m, sd, q.col, q.row) && !Game.occupied(m, 1 - sd, q.col, q.row), why + ': its new tile ' + JSON.stringify(at(q)) + ' is one its rules allow'); } finally { arr.splice(i, 0, q); }
  const best = Mpb.nearestOf(ok, t.col, t.row);
  assert.ok(!best || cheb(q, t) <= cheb(best, t), why + ': as near as it may be (' + JSON.stringify(at(q)) + ' vs ' + JSON.stringify(best) + ')');
  if (Game.anywhere(m, q.unit)) assert.ok(!Game.nearBldg(m, sd, q.col, q.row), why + ': an Assassin, not on or next to a building (everything known)');
}
// the squad keeps its stamp (only its tile changes)
function keptStamp(D, n0, L, sd, q, why) {
  const s = D.stamp[seatOf(L, sd)][q.id];
  assert.deepStrictEqual(s, { c: q.col, r: q.row, n: n0 }, why + ': it keeps its stamp');
}
// a fight of both lanes as they stand, not played yet (tools/tests/mpb-b3.js battleOf)
function battleOf(D) { const lanes = lanesOf(D); Duo.settle(lanes); for (const m of lanes) delete m.team; const bt = Duo.battle(lanes, { record: false }); Duo.setTeams(lanes); return bt; }
const bodiesOf = (bt, sd, id) => bt.bodies.filter(b => b.side === sd && b.squad === id);
const travels = (bt, sd, id) => { const b = bodiesOf(bt, sd, id); assert.ok(b.length, 'squad ' + id + ' has bodies'); return b.every(z => z.mineT > 0); };
const stays = (bt, sd, id) => { const b = bodiesOf(bt, sd, id); assert.ok(b.length, 'squad ' + id + ' has bodies'); return b.every(z => !z.mineTo && !(z.mineT > 0)); };
const lakeOf = (m, sd, lane, k = 0) => Mpb.recs(m, sd).filter(r => r.kind === 'magicLake' && r.data.lane === lane)[k];
const lanesFor = [[0, 0], [0, 1], [1, 0], [1, 1]]; // (team A's lane, team B's lane)

// ===================================== 5: squads =====================================
check('5: squad and squad on a tile of a team\'s own zone: that team\'s stays, the other team\'s moves; both orders, every pair of lanes, both zones', () => {
  for (const host of [0, 1]) for (const [la, lb] of lanesFor) for (const hostFirst of [true, false]) {
    const x = board(301 + host), { D } = x;
    const guest = 1 - host, t = host === 0 ? { col: 12, row: 15 } : { col: 11, row: 3 };
    const hs = seatOf(host === 0 ? la : lb, host), gs = seatOf(host === 0 ? lb : la, guest);
    let h, g;
    if (hostFirst) { h = place(x, hs, 'plain', t.col, t.row); g = place(x, gs, 'Assassin', t.col, t.row); }
    else { g = place(x, gs, 'Assassin', t.col, t.row); h = place(x, hs, 'plain', t.col, t.row); }
    const gL = Duo.SEATS[gs].lane, hL = Duo.SEATS[hs].lane, n0 = Duo.stampOf(D, gs, g.id);
    const why = 'zone of team ' + host + ', lanes ' + [la, lb] + ', ' + (hostFirst ? 'owner first' : 'owner last');
    const { P } = fight(x);
    const H = sqIn(P, hL, host, h.id), G = sqIn(P, gL, guest, g.id);
    assert.deepStrictEqual(at(H), at(t), why + ': the owner\'s squad stays');
    landedNear(P, gL, guest, G, t, why + ': the other team\'s Assassin');
    keptStamp(D, n0, gL, guest, G, why);
    assert.deepStrictEqual(D.settled.map(e => e.id), ['s' + gL + ':' + guest + ':' + g.id], why + ': only it moved');
  }
});

check('5: an enemy flank squad on a flank tile of your zone and your Assassin there: nobody\'s zone (the tile is kept for their flank squads), the newer moves (both orders, both zones)', () => {
  // (review 6 Nov: src/game.js FLANK calls these tiles "the enemy's and never yours", Game.reserved: no prio there)
  for (const host of [0, 1]) for (const hostFirst of [true, false]) {
    const x = board(311 + host, 3), { D } = x; // (round 3: flank tiles open)
    const guest = 1 - host, t = host === 0 ? { col: 0, row: 15 } : { col: 23, row: 3 };
    Game.useGrid(x.m(0));
    assert.ok(Game.isFlank(guest, t.col, t.row) && Game.inZone(host, t.row) && Game.reserved(host, t.col, t.row), 'a flank tile of team ' + guest + ' in team ' + host + '\'s zone');
    assert.strictEqual(Duo.prioOf({ sd: host, tiles: [[t.col, t.row]] }, { sd: guest, tiles: [[t.col, t.row]] }), -1, 'no prio on a flank tile');
    const hs = seatOf(0, host), gs = seatOf(1, guest);
    let h, g;
    if (hostFirst) { h = place(x, hs, 'Assassin', t.col, t.row); g = place(x, gs, 'plain', t.col, t.row); }
    else { g = place(x, gs, 'plain', t.col, t.row); h = place(x, hs, 'Assassin', t.col, t.row); }
    const why = 'team ' + host + '\'s edge, ' + (hostFirst ? 'Assassin first' : 'Assassin last');
    const { P } = fight(x);
    const H = sqIn(P, 0, host, h.id), G = sqIn(P, 1, guest, g.id);
    if (hostFirst) {
      assert.deepStrictEqual(at(H), at(t), why + ': the older Assassin stays');
      landedNear(P, 1, guest, G, t, why + ': the newer flank squad');
      assert.ok(Game.isFlank(guest, G.col, G.row) || Game.inZone(guest, G.row), why + ': on a tile a flank squad may stand on: ' + JSON.stringify(at(G)));
    } else {
      assert.deepStrictEqual(at(G), at(t), why + ': the older flank squad stays');
      landedNear(P, 0, host, H, t, why + ': the newer Assassin');
    }
    assert.strictEqual(D.settled.length, 1, why + ': only one moved');
  }
});

check('5: no man\'s land: the newer of two squads moves, whichever team (both orders)', () => {
  for (const aFirst of [true, false]) {
    const x = board(321), { D } = x;
    const t = { col: 12, row: 8 };
    let a, b;
    if (aFirst) { a = place(x, 0, 'Assassin', t.col, t.row); b = place(x, 3, 'Assassin', t.col, t.row); }
    else { b = place(x, 3, 'Assassin', t.col, t.row); a = place(x, 0, 'Assassin', t.col, t.row); }
    const { P } = fight(x);
    const A = sqIn(P, 0, 0, a.id), B = sqIn(P, 1, 1, b.id), [older, newer] = aFirst ? [A, B] : [B, A];
    assert.deepStrictEqual(at(older), at(t), (aFirst ? 'A' : 'B') + ' first: the older stays');
    landedNear(P, aFirst ? 1 : 0, aFirst ? 1 : 0, newer, t, 'the newer');
    assert.strictEqual(D.settled.length, 1);
  }
});

check('5: teammates on one tile of their own zone (both lanes): the newer moves, both orders', () => {
  for (const firstLane of [0, 1]) {
    const x = board(331), { D } = x, t = { col: 12, row: 15 };
    const add = (L) => { const m = x.m(L), q = { id: m.nextId[0]++, unit: plain(x, seatOf(L, 0)), col: t.col, row: t.row, round: m.round, xp: 0, level: 0, cost: 100 }; m.armies[0].push(q); teams(D); Duo.stampAll(D); return q; };
    const q1 = add(firstLane), q2 = add(1 - firstLane);
    assert.ok(Duo.stampOf(D, seatOf(1 - firstLane, 0), q2.id) > Duo.stampOf(D, seatOf(firstLane, 0), q1.id), 'the second is newer');
    const { P } = fight(x);
    assert.deepStrictEqual(at(sqIn(P, firstLane, 0, q1.id)), at(t), 'lane ' + firstLane + ' first: the older stays (no prio between teammates)');
    landedNear(P, 1 - firstLane, 0, sqIn(P, 1 - firstLane, 0, q2.id), t, 'the newer teammate\'s');
  }
});

// ===================================== 5: buildings, water, the mine =====================================
check('5: a building voted onto a hidden enemy Assassin in its own zone stays (both orders, both lanes); the Assassin moves off and away from it', () => {
  for (const kind of ['oak', 'school', 'shadowDen', 'jail']) for (const lb of [0, 1]) for (const assFirst of [true, false]) {
    const x = board(341), { D } = x, t = { col: 13, row: 15 };
    const gs = seatOf(lb, 1);
    let key, ass;
    if (assFirst) { ass = place(x, gs, 'Assassin', t.col, t.row); key = vote(x, 0, kind, t); }
    else { key = vote(x, 0, kind, t); ass = place(x, gs, 'Assassin', t.col, t.row); }
    const n0 = Duo.stampOf(D, gs, ass.id), why = kind + ', lane ' + lb + ', ' + (assFirst ? 'Assassin first' : 'Assassin last');
    const { P } = fight(x);
    assert.deepStrictEqual(at(recIn(P[0], 0, key)), at(t), why + ': the building stays where it was voted');
    const a = sqIn(P, lb, 1, ass.id);
    landedNear(P, lb, 1, a, t, why);
    assert.ok(cheb(a, t) >= 2, why + ': not next to the building');
    keptStamp(D, n0, lb, 1, a, why);
    assert.deepStrictEqual(D.settled.map(e => e.why), ['same'], why + ': one move');
  }
});

check('5: a Coal mine entrance voted onto a hidden Assassin: it stays, the Assassin moves, and the squads round it still go down the mine', () => {
  for (const assFirst of [true, false]) for (const lb of [0, 1]) {
    const x = board(351), { D } = x, t = { col: 12, row: 15 }, e = { col: 12, row: 10 };
    const gs = seatOf(lb, 1);
    let key, ass;
    const entrance = () => { key = vote(x, 0, 'coalMine', t); vote(x, 0, 'coalMine', e, 'exit', key); };
    if (assFirst) { ass = place(x, gs, 'Assassin', t.col, t.row); entrance(); } else { entrance(); ass = place(x, gs, 'Assassin', t.col, t.row); }
    const q1 = place(x, 0, 'plain', t.col + 1, t.row), q2 = place(x, 1, 'plain', t.col - 1, t.row + 1); // (A1's and A2's, round it)
    const why = (assFirst ? 'Assassin first' : 'entrance first') + ', lane ' + lb;
    Duo.settleBoard(D); // (the fight's start: everything known)
    const P = lanesOf(D);
    teams(D);
    const rec = recIn(P[0], 0, key);
    assert.deepStrictEqual([at(rec), rec.parts.exit], [at(t), e], why + ': the entrance (and exit) stay');
    const a = sqIn(P, lb, 1, ass.id);
    landedNear(P, lb, 1, a, t, why);
    const bt = battleOf(D);
    assert.ok(travels(bt, 0, q1.id), why + ': A1\'s squad round the entrance goes down the mine');
    assert.ok(travels(bt, 0, q2.id + 1000000), why + ': A2\'s too (lane 1: its id moved by Duo\'s OFF in the fight)');
  }
});

check('5: Magic lake water put on a hidden enemy Assassin: on your zone the water stays and the Assassin moves (both orders, both lanes)', () => {
  for (const lb of [0, 1]) for (const lakeFirst of [true, false]) {
    const x = board(361), { D } = x, t = { col: 10, row: 14 };
    for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' });
    fresh(D);
    const la = lakeOf(x.m(0), 0, 0), gs = seatOf(lb, 1);
    const lake = () => assert.ok(x.act(0, 'mpbAct', la.key, 'place', t.col, t.row).ok, 'A1\'s water on its zone');
    let ass;
    if (lakeFirst) { lake(); ass = place(x, gs, 'Assassin', t.col, t.row); } else { ass = place(x, gs, 'Assassin', t.col, t.row); lake(); }
    const why = 'lane ' + lb + ', ' + (lakeFirst ? 'water first' : 'water last');
    const { P } = fight(x);
    assert.deepStrictEqual(at(recIn(P[0], 0, la.key)), at(t), why + ': the water stays');
    const a = sqIn(P, lb, 1, ass.id);
    landedNear(P, lb, 1, a, t, why);
    assert.ok(!Game.terrainBlocks(P[0], a.col, a.row), why + ': off the water');
  }
});

check('5: a grown Tree kojja or a Scorch turret on a hidden enemy Assassin: the building stays, the Assassin moves (both orders, both lanes)', () => {
  for (const kind of ['scorch', 'grow']) for (const lb of [0, 1]) for (const sqFirst of [true, false]) {
    const x = board(371), { D } = x;
    let tk = null;
    if (kind === 'grow') { tk = put(D, 0, 'treeKojja', { col: 12, row: 16 }); fresh(D); }
    const t = { col: 12, row: 14 }, gs = seatOf(lb, 1);
    let key, sq;
    const build = () => {
      const n = Mpb.recs(x.m(0), 0).length;
      if (kind === 'scorch') { for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'scorch' }); assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok, 'turret'); }
      else { assert.ok(x.act(0, 'mpbBuy', tk, 'grow').ok); assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok, 'grown'); }
      key = Mpb.recs(x.m(0), 0).slice(n).find(r => r.col === t.col && r.row === t.row).key;
    };
    if (sqFirst) { sq = place(x, gs, 'Assassin', t.col, t.row); build(); } else { build(); sq = place(x, gs, 'Assassin', t.col, t.row); }
    const why = kind + ', lane ' + lb + ', ' + (sqFirst ? 'squad first' : 'squad last');
    const { P } = fight(x);
    assert.deepStrictEqual(at(recIn(P[0], 0, key)), at(t), why + ': the building stays');
    landedNear(P, lb, 1, sqIn(P, lb, 1, sq.id), t, why);
  }
});

check('5: a Tree kojja with its Nest squad voted onto a hidden Assassin: the kojja and its squad stay, the Assassin moves', () => {
  const x = board(381), { D } = x, m = x.m(0), t = { col: 12, row: 15 };
  const ass = place(x, 2, 'Assassin', t.col, t.row);
  const key = vote(x, 0, 'treeKojja', t);
  assert.ok(x.act(0, 'mpbBuy', key, 'nest').ok, 'Nest');
  const gi = ui('Mechite Guards');
  if (!Game.isUnlocked(m, 0, gi)) assert.ok(x.act(0, 'unlock', gi).ok);
  assert.ok(x.act(0, 'place', gi, t.col, t.row).ok, 'a ranged squad in the Nest');
  const sq = m.armies[0].slice(-1)[0];
  const { P } = fight(x);
  assert.deepStrictEqual([at(recIn(P[0], 0, key)), at(sqIn(P, 0, 0, sq.id))], [at(t), at(t)], 'the kojja and its Nest squad stay');
  landedNear(P, 0, 1, sqIn(P, 0, 1, ass.id), t, 'the Assassin');
});

// ===================================== 4 with 5: the exit =====================================
check('5 and 4: an exit dug onto a flank tile of their zone where their hidden Assassin stands: nothing moves, the mine is blocked (both orders)', () => {
  for (const digFirst of [true, false]) for (const lb of [0, 1]) {
    const x = board(391, 3), { D } = x;
    const ka = put(D, 0, 'coalMine', { col: 12, row: 16 });
    for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, ka); r.parts.exit = { col: 12, row: 10 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; }
    fresh(D);
    const t = { col: 1, row: 3 };
    Game.useGrid(x.m(0));
    assert.ok(Game.isFlank(0, t.col, t.row) && Game.inZone(1, t.row), '(1,3): A\'s flank tile in B\'s zone');
    let ass;
    const dig = () => assert.ok(x.act(0, 'mpbAct', ka, 'exit', t.col, t.row).ok, 'A1 digs onto (1,3)');
    const theirs = () => { ass = place(x, seatOf(lb, 1), 'Assassin', t.col, t.row); };
    if (digFirst) { dig(); theirs(); } else { theirs(); dig(); }
    const sq = place(x, 0, 'plain', 13, 16), sq2 = place(x, 1, 'plain', 11, 15); // (A1's and A2's, round the entrance)
    Duo.settleBoard(D); // (the fight's start)
    const P = lanesOf(D);
    const why = (digFirst ? 'dug first' : 'Assassin first') + ', lane ' + lb;
    assert.deepStrictEqual([recIn(P[0], 0, ka).parts.exit, at(sqIn(P, lb, 1, ass.id))], [t, at(t)], why + ': the exit and the Assassin both stay');
    assert.deepStrictEqual(D.settled, [], why + ': nothing moved');
    const bt = battleOf(D);
    assert.ok(stays(bt, 0, sq.id) && stays(bt, 0, sq2.id + 1000000), why + ': the exit\'s own tile is taken: nobody goes down the mine');
    void COAL;
  }
});

// ===================================== 5: no room, determinism =====================================
// every free tile of the board but `keep` taken by Brutes from an earlier round (side by half)
function fill(x, keep) {
  const m = x.m(0);
  teams(x.D);
  for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) {
    if (keep.some(k => k.col === c && k.row === r) || Game.terrainBlocks(m, c, r) || Game.occupied(m, 0, c, r) || Game.occupied(m, 1, c, r)) continue;
    const sd = r < Game.ROWS / 2 ? 1 : 0;
    m.armies[sd].push({ id: m.nextId[sd]++, unit: ui('Brute'), col: c, row: r, round: 1, xp: 0, level: 0, cost: 100 });
  }
  teams(x.D);
  Duo.stampAll(x.D);
}
check('5: no tile anywhere for the other team\'s thing: both stay, the owner\'s never moves for it (a Tree kojja with its Nest squad, a School with its pupil)', () => {
  for (const kind of ['treeKojja', 'school']) {
    const x = board(401), { D } = x, m = x.m(0), t = { col: 12, row: 15 }, u = { col: 12, row: 14 };
    const pupil = kind === 'school' ? place(x, 0, 'plain', 10, 16) : null;
    const ass = place(x, 2, 'Assassin', t.col, t.row);
    const key = vote(x, 0, kind, t);
    let sq = pupil;
    if (kind === 'treeKojja') {
      assert.ok(x.act(0, 'mpbBuy', key, 'nest').ok, 'Nest');
      const gi = ui('Mechite Guards');
      if (!Game.isUnlocked(m, 0, gi)) assert.ok(x.act(0, 'unlock', gi).ok);
      assert.ok(x.act(0, 'place', gi, t.col, t.row).ok, 'a ranged squad in the Nest');
      sq = m.armies[0].slice(-1)[0];
    } else assert.ok(x.act(0, 'mpbAct', key, 'enroll', pupil.id).ok, 'enrolled');
    fill(x, [t, u]); // (u, next to it: the Assassin may not stand there, the building may)
    Duo.settleBoard(D);
    const rec = recIn(m, 0, key), q = m.armies[0].find(z => z.id === sq.id), a = m.armies[1].find(z => z.id === ass.id);
    assert.deepStrictEqual(at(a), at(t), kind + ': the Assassin, with no tile anywhere, stays');
    assert.deepStrictEqual(at(rec), at(t), kind + ': the building stays ("yours stays"), though the tile next to it is free');
    assert.deepStrictEqual(at(q), at(t), kind + ': its squad with it');
    assert.deepStrictEqual(D.settled, [{ id: 's0:1:' + ass.id, why: 'same', to: null }], kind + ': (the Assassin tried, found nothing; nothing else moved)');
  }
});

check('5: the same moves from two replays and after a save and load', () => {
  const build = () => {
    const x = board(411), { D } = x, t = { col: 12, row: 15 };
    place(x, 2, 'Assassin', t.col, t.row);
    vote(x, 0, 'oak', t);
    place(x, 3, 'plain', 11, 3);
    place(x, 0, 'Assassin', 11, 3); // (B's squad there is hidden from A: in B's zone, A's Assassin moves)
    for (const R of D.lanes) Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' });
    assert.ok(x.act(3, 'mpbAct', lakeOf(x.m(1), 1, 1).key, 'place', 11, 10).ok);
    return x;
  };
  const a = build(), b = build();
  const c = { ...b, D: Duo.load(copy(Duo.save(b.D)), units, matrix) };
  const fa = fight(a), fc = fight(c);
  assert.ok(a.D.settled.length >= 2, 'two moved: ' + JSON.stringify(a.D.settled));
  assert.deepStrictEqual(a.D.settled, c.D.settled, 'the same moves');
  assert.deepStrictEqual(fa.f.posts.map(s => s.armies), fc.f.posts.map(s => s.armies), 'the same squads after');
  assert.deepStrictEqual(fa.f.posts.map(s => s.mpb), fc.f.posts.map(s => s.mpb), 'the same buildings after');
  const oak = Mpb.recs(fa.P[0], 0).find(r => r.kind === 'oak');
  assert.deepStrictEqual(at(oak), [12, 15], 'the Oak stays');
  if (a.D.phase === 'result') {
    for (let k = 0; k < 4; k++) Duo.next(a.D, k, a.D.summary[0].round, T);
    const q = a.m(0).armies[1].find(z => z.unit === ui('Assassin') && z.round < a.m(0).round);
    assert.ok(q && !(q.col === 12 && q.row === 15), 'the next round: the Assassin stands on its new tile');
    const seen = Duo.viewFor(a.D, 0).m.armies[1].find(z => z.id === q.id);
    assert.deepStrictEqual(at(seen), at(q), 'and the other team sees it there');
  }
});

// ===================================== 6: walls and water =====================================
function bastions(seed) {
  const x = board(seed, 4), { D } = x; // (round 4: no draft open, whose tower card would take the walls with the old tower)
  for (const R of D.lanes) { R.m.towers[0].type = 'bastion'; R.m.towers[1].type = 'bastion'; R.m.towerSkill = [1, 1]; R.m.towerSkill2 = [1, 1]; Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' }); Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); }
  fresh(D);
  return x;
}
// every tile, both seats of team sd: whether lake tile k of each may go there, on the page as on the server
function lakeAgree(x, sd, why) {
  const { D } = x;
  for (const L of [0, 1]) {
    const seat = seatOf(L, sd), pv = W(Duo.viewFor(D, seat).m);
    teams(D);
    for (const rec of Mpb.recs(x.m(L), sd).filter(r => r.kind === 'magicLake' && r.data.lane === L)) {
      const prec = Mpb.recOf(pv, sd, rec.key);
      for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++)
        assert.strictEqual(Mpb.asSeen(sd, () => LK.lakeOk(x.m(L), sd, rec, c, r)), LK.lakeOk(pv, sd, prec, c, r), why + ': seat ' + seat + ' water ' + rec.key + ' on ' + [c, r]);
    }
  }
}
function wallAgree(x, sd, why) {
  const { D } = x;
  for (const L of [0, 1]) {
    const seat = seatOf(L, sd), pv = W(Duo.viewFor(D, seat).m);
    teams(D);
    for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) for (const e of ['n', 'e', 's', 'w'])
      assert.strictEqual(Mpb.asSeen(sd, () => Game.bwallSpotOk(x.m(L), sd, c, r, e)), Game.bwallSpotOk(pv, sd, c, r, e), why + ': seat ' + seat + ' wall ' + [c, r, e]);
  }
}
check('6: no water on a wall you can see, no wall on water you can see (yours, your teammate\'s, theirs from earlier rounds); page and server agree', () => {
  const x = bastions(421), { D } = x;
  // A1's wall on (10,10): A1's water and A2's water may not go there; B (who can't see it this round) may
  assert.ok(try1(x, 0, 'placeBwall', 10, 10, 'n').ok, 'A1\'s wall on (10,10)');
  for (const L of [0, 1]) assert.ok(!try1(x, seatOf(L, 0), 'mpbAct', lakeOf(x.m(L), 0, L).key, 'place', 10, 10).ok, 'seat ' + seatOf(L, 0) + ': no water on the team\'s wall');
  // A2's water on (12,11): A1's and A2's walls may not go there, on any of its edges
  assert.ok(try1(x, 1, 'mpbAct', lakeOf(x.m(1), 0, 1).key, 'place', 12, 11).ok, 'A2\'s water on (12,11)');
  for (const L of [0, 1]) for (const e of ['n', 'e', 's', 'w']) assert.ok(!try1(x, seatOf(L, 0), 'placeBwall', 12, 11, e).ok, 'seat ' + seatOf(L, 0) + ': no wall on the teammate\'s water (' + e + ')');
  // a wall on the shore (the tile next to the water, its edge toward it) is fine: only the wall's own tile counts
  assert.ok(try1(x, 1, 'placeBwall', 12, 12, 'n').ok, 'A2\'s wall on (12,12), along the water\'s edge');
  lakeAgree(x, 0, 'team A'); lakeAgree(x, 1, 'team B'); wallAgree(x, 0, 'team A'); wallAgree(x, 1, 'team B');
  // A1's water on (13,7), on B's half of no man's land
  assert.ok(try1(x, 0, 'mpbAct', lakeOf(x.m(0), 0, 0).key, 'place', 13, 7).ok, 'A1\'s water on (13,7)');
  // B can't see A's wall of this round: its water may go there (a hidden clash: the fight's start settles it)
  assert.ok(try1(x, 2, 'mpbAct', lakeOf(x.m(0), 1, 0).key, 'place', 10, 10).ok, 'B1\'s water on A\'s hidden wall');
  lakeAgree(x, 1, 'team B, A\'s hidden'); wallAgree(x, 1, 'team B, A\'s hidden');
  fight(x);
  for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  // the next round: A's walls and water are seen. B's water may not go on A's walls, B's walls not on A's water
  for (const R of D.lanes) Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); // (B gets new tiles to put down)
  fresh(D);
  const m = x.m(0), wallsA = m.bwalls[0].filter(w => (w.col === 10 && w.row === 10) || (w.col === 12 && w.row === 12));
  assert.strictEqual(wallsA.length, 2, 'A\'s two walls stand where they were put up');
  assert.deepStrictEqual(at(lakeOf(m, 0, 0)), [13, 7], 'A1\'s water stands');
  assert.ok(!m.bwalls[0].concat(m.bwalls[1]).some(w => Game.terrainBlocks(m, w.col, w.row)), 'no wall on water after the fight');
  for (const L of [0, 1]) {
    const seat = seatOf(L, 1), lb = Mpb.recs(x.m(L), 1).find(r => r.kind === 'magicLake' && r.data.lane === L && r.col < 0);
    assert.ok(lb, 'seat ' + seat + ' has water to put down');
    for (const w of wallsA) assert.ok(!try1(x, seat, 'mpbAct', lb.key, 'place', w.col, w.row).ok, 'seat ' + seat + ': no water on A\'s wall on ' + at(w) + ' (seen now)');
    for (const e of ['n', 'e', 's', 'w']) assert.ok(!try1(x, seat, 'placeBwall', 13, 7, e).ok, 'seat ' + seat + ': no wall on A\'s water (' + e + ')');
  }
  lakeAgree(x, 1, 'team B, next round'); wallAgree(x, 1, 'team B, next round');
});

check('6: a hidden wall and hidden water on one tile in no man\'s land: the newer moves (a wall to the nearest edge, water to the nearest tile); both orders', () => {
  for (const what of ['A wall, B water', 'B wall, A water']) for (const wallFirst of [true, false]) {
    const x = bastions(431), { D } = x;
    const wsd = what[0] === 'A' ? 0 : 1, lsd = 1 - wsd, t = wsd === 0 ? { col: 10, row: 10 } : { col: 13, row: 8 }, edge = wsd === 0 ? 'n' : 's';
    const lk = lakeOf(x.m(1), lsd, 1);
    const wall = () => assert.ok(x.act(seatOf(0, wsd), 'placeBwall', t.col, t.row, edge).ok, 'the wall');
    const water = () => assert.ok(x.act(seatOf(1, lsd), 'mpbAct', lk.key, 'place', t.col, t.row).ok, 'the water');
    if (wallFirst) { wall(); water(); } else { water(); wall(); }
    const why = what + ', ' + (wallFirst ? 'wall first' : 'water first');
    const { P } = fight(x);
    const w = P[0].bwalls[wsd].find(v => v.round === P[0].round), r = recIn(P[0], lsd, lk.key);
    assert.ok(!Game.terrainBlocks(P[0], w.col, w.row), why + ': no wall on water: ' + JSON.stringify(w));
    if (wallFirst) {
      assert.deepStrictEqual(at(w), at(t), why + ': the wall (older) stays');
      assert.ok(!(r.col === t.col && r.row === t.row) && cheb(r, t) === 1, why + ': the water moved next door: ' + JSON.stringify(at(r)));
    } else {
      assert.deepStrictEqual(at(r), at(t), why + ': the water (older) stays');
      assert.ok(cheb(w, t) === 1 && w.edge === edge, why + ': the wall moved next door, the same way round: ' + JSON.stringify(w));
    }
    assert.deepStrictEqual(D.settled.map(e => e.why), ['water'], why + ': one move');
  }
});

check('6: a wall on its team\'s zone and the other team\'s water on that tile (a state no legal move makes: the rule itself): the wall stays, either stamp order', () => {
  for (const wallFirst of [true, false]) {
    const x = bastions(441), { D } = x, t = { col: 10, row: 14 };
    const lk = lakeOf(x.m(0), 1, 0);
    const wall = () => { for (const R of D.lanes) R.m.bwalls[0].push({ col: t.col, row: t.row, edge: 'n', round: R.m.round }); Duo.stampAll(D); };
    const water = () => { for (const R of D.lanes) { const r = Mpb.recOf(R.m, 1, lk.key); r.col = t.col; r.row = t.row; r.round = R.m.round; r.down = R.m.round; } Duo.stampAll(D); };
    if (wallFirst) { wall(); water(); } else { water(); wall(); }
    Duo.settleBoard(D);
    const w = x.m(0).bwalls[0].slice(-1)[0], r = recIn(x.m(0), 1, lk.key);
    assert.deepStrictEqual(at(w), at(t), (wallFirst ? 'wall first' : 'wall last') + ': A\'s wall on A\'s zone stays');
    assert.ok(!(r.col === t.col && r.row === t.row) && (Game.inNoMans(r.row) || Game.inZone(1, r.row)), 'B\'s water moved to a tile B may put it on: ' + JSON.stringify(at(r)));
  }
});

if (fails) { console.log(`\n${fails} failed, ${passed} passed`); process.exit(1); }
console.log(`\nall ${passed} prio and lake-wall checks passed`);
