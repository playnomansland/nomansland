// Headless checks of Vilhelm's answers of 6 Nov 2026 on the 2v2 buildings (PATCH-NOTES 6 November, docs/MPB-2V2.md):
//  1. "It stays in that spot": an Assassin next to a building it couldn't see stays; a building within 2 tiles of the
//     other team's hidden building or exit stays (only things on the same tile still meet: the newer moves)
//  2. "Votes don't hold the clock, independent systems": a placement vote or the draft never changes either team's
//     deploy clock (second by second, with and without a vote or a pick); one still open when the deploy clock ends is
//     settled as the fight starts, as its own 15 s running out would
//  3. a building voted onto a hidden Assassin "should act normally" (since answer 5, "You always have 'prio' in your
//     own zone": the building, on its own zone, stays; the Assassin moves to the nearest tile its own rules allow;
//     tools/tests/mpb-prio.js has the rest of answers 5 and 6)
//  4. the Coal mine's exit and its ring never make anything move; a squad whose tile at the exit (or the exit's own
//     tile) is taken by a squad (or any other unit standing there: the other lane's Factory, Jail guards), building,
//     water or wall of either team doesn't go down the mine
//  7. Insider information "Should show everything": the watched team's buildings, water, dug exit, walls and vote
//     tiles live, and the watchers' deploy checks agree on the page and the server
//  8. the four artifacts of a match are all different, never the Vault (nor the Outpost); the draft's cards are its
//     round's artifacts; what the teams have doesn't matter
// 10. "Den removes the wait": Rogues, Assassins and Shadowhands of a team with a Shadow Den come up the mine at once
// Run: node tools/tests/mpb-answers.js
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
const T = 1e12;
const COAL = Mpb.kindOf('coalMine');

// ----- helpers (as tools/tests/mpb-hidden.js) -----
function match(seed, bots = [false, false, false, false], secret) {
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, T, seed, bots, secret);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  const actAt = (now, seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, now);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, act, actAt, m: (L) => D.lanes[L].m };
}
function playTo(x, round, hook) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
    if (hook) hook(D);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
  }
}
function put(D, sd, kind, t) {
  teams(D);
  t = t || Mpb.autoSpot(D.lanes[0].m, sd, kind, null);
  assert.ok(t, 'room for ' + kind);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  return Mpb.recs(D.lanes[0].m, sd).slice(-1)[0].key;
}
const rich = (D) => { for (const R of D.lanes) { R.m.gold = [9000, 9000]; R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; } };
const clearArmies = (D) => { for (const R of D.lanes) { R.m.armies = [[], []]; R.m.artifacts = null; } teams(D); };
const fresh = (D) => { teams(D); for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() }; D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd)); D.tlog = [[], []]; Duo.stampAll(D, true); };
function board(seed, round = 2) {
  const x = match(seed), { D } = x;
  playTo(x, round);
  clearArmies(D); rich(D);
  for (const seat of [0, 1, 2, 3]) { const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side; if (!Game.isUnlocked(x.m(L), sd, ui('Assassin'))) assert.ok(x.act(seat, 'unlock', ui('Assassin')).ok); }
  fresh(D);
  return x;
}
function vote(x, sd, kind, t) {
  const { D } = x;
  for (const R of D.lanes) Mpb.queue(R.m, sd, kind);
  fresh(D); Duo.tick(D, T);
  const s0 = Duo.seatOf(0, sd), s1 = Duo.seatOf(1, sd);
  t = t || Mpb.autoSpot(x.m(0), sd, kind, null);
  assert.ok(x.act(s0, 'mpbVote', t.col, t.row).ok && x.act(s1, 'mpbVote', t.col, t.row).ok, kind + ' voted onto ' + JSON.stringify(t));
  return Mpb.recs(x.m(0), sd).find(r => r.kind === kind && r.col === t.col && r.row === t.row).key;
}
function place(x, seat, name, col, row) {
  const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side;
  const r = x.act(seat, 'place', ui(name), col, row);
  assert.ok(r.ok, name + ' placed by seat ' + seat + ' on ' + col + ',' + row + ' (' + r.why + ')');
  return x.m(L).armies[sd].slice(-1)[0];
}
function try1(x, seat, fn, ...a) {
  const { D } = x, sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
  const local = Game[fn](pm, sd, ...a);
  const r = x.act(seat, fn, ...a);
  assert.strictEqual(!!local, !!r.ok, fn + ' ' + JSON.stringify(a) + ': allowed on the page as on the server (' + r.why + ')');
  if (r.ok) assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy hashes as the server');
  return r;
}
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
// a fight of both lanes as they stand, not played yet (tools/tests/mpb-b3.js battleOf)
function battleOf(D) { const lanes = lanesOf(D); Duo.settle(lanes); for (const m of lanes) delete m.team; const bt = Duo.battle(lanes, { record: false }); Duo.setTeams(lanes); return bt; }
const bodiesOf = (bt, sd, id) => bt.bodies.filter(b => b.side === sd && b.squad === id);
const travels = (bt, sd, id) => { const b = bodiesOf(bt, sd, id); assert.ok(b.length, 'squad ' + id + ' has bodies'); return b.every(z => z.mineT > 0); };
const stays = (bt, sd, id) => { const b = bodiesOf(bt, sd, id); assert.ok(b.length, 'squad ' + id + ' has bodies'); return b.every(z => !z.mineTo && !(z.mineT > 0)); };
// a squad of unit name for side sd in lane 0 on (col, row), as if placed in an earlier round
function squad(m, sd, name, col, row) {
  const q = { id: 600 + m.armies[sd].length + sd * 60, unit: ui(name), col, row, level: 0, xp: 0, round: 1 };
  m.armies[sd].push(q);
  return q;
}
function addMine(D, sd, col, row, xc, xr) {
  for (const R of D.lanes) { const r = Mpb.addRec(R.m, sd, 'coalMine', col, row); r.parts.exit = { col: xc, row: xr }; }
  return Mpb.recs(D.lanes[0].m, sd).slice(-1)[0].key;
}

// ===================================== 1 and 3: the same tile only =====================================
check('1: an Assassin next to a building it couldn\'t see stays, either order; nothing moves', () => {
  for (const assFirst of [true, false]) {
    const x = board(201), { D } = x;
    const t = { col: 12, row: 15 }, next = { col: 11, row: 14 };
    let key, ass;
    if (assFirst) { ass = place(x, 3, 'Assassin', next.col, next.row); key = vote(x, 0, 'fieldHospital', t); }
    else { key = vote(x, 0, 'fieldHospital', t); ass = place(x, 3, 'Assassin', next.col, next.row); }
    const { P } = fight(x);
    const b = recIn(P[0], 0, key), a = sqIn(P, 1, 1, ass.id);
    assert.deepStrictEqual([b.col, b.row, a.col, a.row], [t.col, t.row, next.col, next.row], (assFirst ? 'Assassin first' : 'building first') + ': both stay');
    assert.deepStrictEqual(D.settled, [], 'nothing moved');
  }
});

check('1: a building within 2 tiles of the other team\'s hidden dug exit stays, either order', () => {
  for (const digFirst of [true, false]) {
    const x = board(202), { D } = x;
    const kb = put(D, 1, 'coalMine', { col: 11, row: 2 });
    for (const R of D.lanes) { const r = Mpb.recOf(R.m, 1, kb); r.parts.exit = { col: 12, row: 8 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; }
    fresh(D);
    const dig = () => assert.ok(x.act(3, 'mpbAct', kb, 'exit', 22, 15).ok, 'B2 digs to (22,14), a flank tile of A\'s half');
    let key;
    const build = () => { key = vote(x, 0, 'jail', { col: 20, row: 16 }); };
    if (digFirst) { dig(); build(); } else { build(); dig(); }
    const { P } = fight(x);
    const j = recIn(P[0], 0, key), ex = recIn(P[0], 1, kb).parts.exit;
    assert.deepStrictEqual([j.col, j.row], [20, 16], 'the Jail stays, 2 tiles from the exit');
    assert.deepStrictEqual(ex, { col: 22, row: 15 }, 'the exit stays');
    assert.ok(cheb(j, ex) < Mpb.SPACING, '(within its 2 tiles of room)');
    assert.deepStrictEqual(D.settled, [], 'nothing moved');
  }
});

// (updated 6 Nov, answer 5 "You always have 'prio' in your own zone": the building used to take the nearest tile it
// was allowed on, and the Assassin stayed)
check('3 with 5: a building voted onto a hidden Assassin in its own zone stays; the Assassin moves to the nearest tile its rules allow', () => {
  for (const kind of ['oak', 'school', 'shadowDen']) {
    const x = board(203), { D } = x;
    const t = { col: 13, row: 15 };
    const ass = place(x, 2, 'Assassin', t.col, t.row);
    const key = vote(x, 0, kind, t);
    const { P } = fight(x);
    const b = recIn(P[0], 0, key), a = sqIn(P, 0, 1, ass.id);
    assert.deepStrictEqual([b.col, b.row], [t.col, t.row], kind + ': the building stays');
    assert.ok(!(a.col === t.col && a.row === t.row) && !Game.nearBldg(P[0], 1, a.col, a.row), kind + ': the Assassin moved off, not next to a building: ' + JSON.stringify([a.col, a.row]));
    // the nearest tile its own rules allow, everything known
    const ok = [];
    for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) if (!(c === t.col && r === t.row) && Game.canPlaceAt(P[0], 1, c, r, ass.unit, true) && !Game.occupied(P[0], 1, c, r) && !Game.occupied(P[0], 0, c, r)) ok.push({ col: c, row: r });
    const near = Mpb.nearestOf(ok.concat([{ col: a.col, row: a.row }]), t.col, t.row);
    assert.strictEqual(cheb(a, t), cheb(near, t), kind + ': as near as any (' + JSON.stringify([a.col, a.row]) + ' vs ' + JSON.stringify(near) + ')');
    assert.deepStrictEqual(D.settled.map(e => e.id), ['s0:1:' + ass.id], kind + ': only the Assassin moved');
  }
});

// ===================================== 2: the clocks =====================================
// every seat's deploy clock (ms left, held) at time t
const deployClocks = (D, t) => [0, 1, 2, 3].map(k => [Duo.remainingFor(D, k, t), Duo.heldFor(D, k)]);
check('2: a placement vote never changes either team\'s deploy clock: second by second the same with and without it', () => {
  const run = (withVote) => {
    const x = board(211), { D } = x;
    if (withVote) for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
    fresh(D); Duo.tick(D, T);
    const out = [], bview = [];
    for (let s = 0; s <= 25; s++) {
      const t = T + s * 1000;
      if (withVote && s === 2) { const sp = Mpb.spots(x.m(0), 0, 'oak', null); assert.ok(x.actAt(t, 0, 'mpbVote', sp[0].col, sp[0].row).ok && x.actAt(t, 1, 'mpbVote', sp[1].col, sp[1].row).ok, 'two tiles'); }
      Duo.tick(D, t);
      out.push(JSON.stringify([deployClocks(D, t), [2, 3].map(k => Duo.clocks(D, k, t))]));
      bview.push(JSON.stringify([2, 3].map(k => Duo.viewFor(D, k))));
    }
    if (withVote) {
      assert.ok(Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak'), 'the vote ran out on its own 15 s: placed');
      assert.strictEqual(new Set(bview).size, 1, 'team B\'s views never changed (the vote is public, its tiles and the placement aren\'t)');
    }
    assert.ok(D.deadline > 0, 'the deploy clock runs');
    return out;
  };
  assert.deepStrictEqual(run(true), run(false), 'every seat\'s deploy clock and team B\'s clocks, each second');
});

// a match at round 3 with round 2's artifacts won as given (humans: the picking team picks)
function draftWith(seed, won, secret) {
  const x = match(seed, [false, false, false, false], secret);
  playTo(x, 2);
  playTo(x, 3, (D) => { for (const R of D.lanes) R.m.artifacts.list.forEach((a, i) => { a.won = won[i]; }); });
  return x;
}
check('2: the draft never changes the deploy clock: a pick at once, or none at all, the same clocks second by second', () => {
  const run = (pick) => {
    const x = draftWith(212, [0, 0]), { D } = x;
    assert.ok(Mpb.draftOpen(x.m(0)) && x.m(0).draft.first === 0, 'team A picks');
    assert.ok(D.deadline > 0, 'the deploy clock runs while the draft is open');
    const out = [];
    for (let s = 0; s <= 12; s++) {
      const t = T + s * 1000;
      if (pick && s === 1) assert.ok(x.actAt(t, 0, 'draftPick', 1).ok, 'A1 picks');
      Duo.tick(D, t);
      out.push(JSON.stringify(deployClocks(D, t)));
    }
    return out;
  };
  assert.deepStrictEqual(run(true), run(false), 'every seat\'s deploy clock');
});

check('2: a vote still open when the deploy clock ends is settled as the fight starts (one of the two tiles; nobody voted: the first allowed tile)', () => {
  const picks = new Set();
  for (const how of ['two', 'none']) for (let s = 0; s < (how === 'two' ? 8 : 1); s++) {
    const x = board(220 + s), { D } = x;
    const end = D.deadline;
    assert.ok(end > T, 'the deploy clock runs');
    const t0 = end - 5000; // the vote opens with 5 s left (its own 15 s won't run out first)
    for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
    fresh(D); Duo.tick(D, t0);
    assert.ok(Duo.clocks(D, 0, t0).vote === Mpb.VOTE_MS, 'its own 15 s');
    assert.strictEqual(D.deadline, end, 'the deploy clock didn\'t move');
    teams(D);
    const sp = Mpb.spots(x.m(0), 0, 'oak', null), auto = Mpb.autoSpot(x.m(0), 0, 'oak', null);
    if (how === 'two') assert.ok(x.actAt(t0 + 1000, 0, 'mpbVote', sp[2].col, sp[2].row).ok && x.actAt(t0 + 1000, 1, 'mpbVote', sp[3].col, sp[3].row).ok);
    assert.ok(!Duo.tick(D, end), 'not yet (the grace)');
    const f = Duo.tick(D, end + Ref.GRACE_MS);
    assert.ok(f, 'the deploy clock ended: the fight');
    const oak = Mpb.recs(f.pres[0], 0).find(r => r.kind === 'oak');
    assert.ok(oak, how + ': the Oak was placed as the fight started');
    if (how === 'two') { const i = [sp[2], sp[3]].findIndex(q => q.col === oak.col && q.row === oak.row); assert.ok(i >= 0, 'one of the two tiles'); picks.add(i); }
    else assert.deepStrictEqual([oak.col, oak.row], [auto.col, auto.row], 'nobody voted: the first allowed tile');
  }
  assert.strictEqual(picks.size, 2, 'the seeded pick goes both ways over the seeds');
});

check('2: the draft still open when the deploy clock ends: the seeded pick as the fight starts, and its card goes to the team', () => {
  const firsts = new Set();
  for (let s = 0; s < 6; s++) {
    const x = draftWith(230 + s, [1, 1]), { D } = x;
    assert.ok(Mpb.draftOpen(x.m(0)), 'open');
    const end = D.deadline;
    D.mclock.draft = end + 10000; // (as if the draft had opened 5 s before the deploy clock's end: its own 15 s still run)
    assert.ok(!Duo.tick(D, end) && Mpb.draftOpen(x.m(0)), 'still open at the deploy clock\'s end');
    const f = Duo.tick(D, end + Ref.GRACE_MS);
    assert.ok(f, 'the fight');
    const d = f.pres[0].draft;
    assert.ok(d.owner[0] != null && d.owner[0] !== d.owner[1], 'dealt: ' + JSON.stringify(d.owner));
    firsts.add(d.pick);
    d.cards.forEach((c, i) => { const team = d.owner[i]; assert.ok(c.type === 'tower' ? f.pres[0].towers[team].type === c.id : Mpb.recs(f.pres[0], team).some(r => r.kind === c.id), 'team ' + team + ' has ' + c.id); });
  }
  assert.strictEqual(firsts.size, 2, 'the seeded pick goes both ways');
});

// ===================================== 4: the Coal mine's exit =====================================
check('4: the exit and its ring never move anything: a squad round a hidden dug exit, a dug exit onto a hidden squad: all stay', () => {
  for (const order of ['squad first', 'dig first']) {
    const x = board(241), { D } = x;
    const ka = put(D, 0, 'coalMine', { col: 12, row: 16 });
    for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, ka); r.parts.exit = { col: 12, row: 10 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; }
    fresh(D);
    let ring;
    const theirs = () => { ring = place(x, 2, 'Assassin', 6, 8); };
    const dig = () => assert.ok(x.act(0, 'mpbAct', ka, 'exit', 7, 8).ok, 'A1 digs the exit to (7,8)');
    if (order === 'squad first') { theirs(); dig(); } else { dig(); theirs(); }
    const { P } = fight(x);
    assert.deepStrictEqual(recIn(P[0], 0, ka).parts.exit, { col: 7, row: 8 }, order + ': the exit stays where it was dug');
    assert.deepStrictEqual([sqIn(P, 0, 1, ring.id).col, sqIn(P, 0, 1, ring.id).row], [6, 8], order + ': B1\'s squad on its ring stays');
    assert.deepStrictEqual(D.settled, [], order + ': nothing moved');
  }
  // the exit dug onto a tile where a squad of theirs stands (hidden from team A): the exit stays, blocked
  const x = board(242), { D } = x;
  const ka = put(D, 0, 'coalMine', { col: 12, row: 16 });
  for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, ka); r.parts.exit = { col: 12, row: 10 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; }
  fresh(D);
  const b = place(x, 2, 'Assassin', 7, 8);
  assert.ok(x.act(0, 'mpbAct', ka, 'exit', 7, 8).ok, 'A1 digs onto B1\'s hidden Assassin');
  const { P } = fight(x);
  assert.deepStrictEqual(recIn(P[0], 0, ka).parts.exit, { col: 7, row: 8 }, 'the exit stays on it');
  assert.deepStrictEqual([sqIn(P, 0, 1, b.id).col, sqIn(P, 0, 1, b.id).row], [7, 8], 'the Assassin stays on it');
  assert.deepStrictEqual(D.settled, [], 'nothing moved');
});

check('4: a squad whose tile at the exit, or the exit\'s own tile, is taken (squad, building, water, wall; either team) doesn\'t go down', () => {
  const setup = (seed, round = 1) => {
    const x = match(seed, [true, true, true, true]), { D } = x;
    playTo(x, round);
    for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; }
    teams(D);
    const key = addMine(D, 0, 11, 16, 11, 10);
    const m = x.m(0);
    return { x, D, m, key, go: squad(m, 0, 'Brute', 10, 15), other: squad(m, 0, 'Brute', 12, 17) }; // go comes up on (10,9), other on (12,11)
  };
  { const { D, go, other } = setup(251); const bt = battleOf(D); assert.ok(travels(bt, 0, go.id) && travels(bt, 0, other.id), 'a free exit: both go down'); }
  { const { D, m, go, other } = setup(252); squad(m, 0, 'Brute', 10, 9); const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && travels(bt, 0, other.id), 'a squad of its own team on its tile at the exit: it stays, the other goes'); }
  { const { D, go, other } = setup(253); squad(D.lanes[1].m, 1, 'Brute', 10, 9); const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && travels(bt, 0, other.id), 'an enemy squad (the other lane) on it: it stays'); }
  { const { D, m, go, other } = setup(254); squad(m, 1, 'Brute', 11, 10); const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && stays(bt, 0, other.id), 'a squad on the exit\'s own tile: the mine is blocked, nobody goes'); }
  { const { D, go, other } = setup(255); for (const R of D.lanes) { const r = Mpb.addRec(R.m, 1, 'magicLake', 11, 10); r.data.lane = 0; } const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && stays(bt, 0, other.id), 'water on the exit\'s tile: blocked'); }
  { const { D, go, other } = setup(256); for (const R of D.lanes) { const r = Mpb.addRec(R.m, 1, 'magicLake', 10, 9); r.data.lane = 0; } const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && travels(bt, 0, other.id), 'water on its tile at the exit: it stays'); }
  { const { D, go, other } = setup(257); for (const R of D.lanes) Mpb.addRec(R.m, 1, 'scorch', 11, 10); const bt = battleOf(D); assert.ok(stays(bt, 0, go.id) && stays(bt, 0, other.id), 'a building on the exit\'s tile: blocked'); }
  { const { D, x, go, other } = setup(258, 4); // (round 4: a tower type, not the Outpost)
    for (const R of D.lanes) { R.m.towers[1].type = 'bastion'; R.m.towerSkill = [0, 1]; R.m.towerSkill2 = [0, 1]; R.m.bwalls = [[], [{ col: 12, row: 11, edge: 'n', round: R.m.round }]]; }
    assert.ok(Game.bwallsFighting(x.m(0), 1).length === 1, 'the wall fights');
    const bt = battleOf(D); assert.ok(travels(bt, 0, go.id) && stays(bt, 0, other.id), 'a wall of either team on its tile at the exit: it stays'); }
});

check('4: any other unit standing on the tile at the exit blocks it too (the other lane\'s Factory, Jail guards)', () => {
  // a Cog Builder's Factory of team B on the landing tile, in either lane (the other lane's: its body, Engine mineOn)
  for (const facLane of [0, 1]) {
    const x = match(561 + facLane, [true, true, true, true]), { D } = x;
    playTo(x, 4);
    for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; m.buildings = [[], []]; }
    teams(D);
    addMine(D, 0, 11, 16, 11, 7);
    x.m(facLane).buildings[1].push({ id: 'factory', col: 10, row: 6, round: 1, progress: 999, built: true, xp: 0, level: 0 });
    teams(D);
    const m = x.m(0), q = squad(m, 0, 'Brute', 10, 15), q2 = squad(m, 0, 'Brute', 12, 17); // q comes up on (10,6), q2 on (12,8)
    const bt = battleOf(D);
    assert.ok(stays(bt, 0, q.id) && travels(bt, 0, q2.id), 'a Factory in lane ' + facLane + ' on its tile at the exit: it stays, the other goes');
  }
  { // a Factory on the exit's own tile, in the other lane: the mine is blocked
    const x = match(563, [true, true, true, true]), { D } = x;
    playTo(x, 4);
    for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; m.buildings = [[], []]; }
    teams(D);
    addMine(D, 0, 11, 16, 11, 7);
    x.m(1).buildings[1].push({ id: 'factory', col: 11, row: 7, round: 1, progress: 999, built: true, xp: 0, level: 0 });
    teams(D);
    const q = squad(x.m(0), 0, 'Brute', 10, 15);
    assert.ok(stays(battleOf(D), 0, q.id), 'the other lane\'s Factory on the exit\'s own tile: nobody goes');
  }
  { // Jail guards at their post on the landing tile (B's Jail on (3,3), its west post in tile (2,3); A's exit on (1,3))
    const x = match(551, [true, true, true, true]), { D } = x;
    playTo(x, 4);
    for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; }
    teams(D);
    addMine(D, 0, 11, 16, 1, 3);
    for (const R of D.lanes) { const j = Mpb.addRec(R.m, 1, 'jail', 3, 3); j.skills.guards = { round: 1, n: 1, by: [1, 0], log: [] }; }
    teams(D);
    const m = x.m(0), q = squad(m, 0, 'Brute', 12, 16), q2 = squad(m, 0, 'Brute', 11, 15); // q comes up on (2,3), q2 on (1,2)
    const bt = battleOf(D);
    assert.ok(bt.bodies.some(b => b.side === 1 && b.guard), 'the guards fight');
    assert.ok(stays(bt, 0, q.id) && travels(bt, 0, q2.id), 'a Jail guard on its tile at the exit: it stays, the other goes');
  }
});

// ===================================== 7: Insider information =====================================
check('7: Insider information shows the watched team\'s board live (buildings, water, dug exit, walls, vote tiles); the watchers\' checks agree page vs server', () => {
  const x = board(261, 4), { D } = x; // (round 4: no draft)
  const den = put(D, 1, 'shadowDen', { col: 11, row: 2 });
  const cm = put(D, 0, 'coalMine', { col: 12, row: 16 });
  for (const R of D.lanes) {
    const r = Mpb.recOf(R.m, 0, cm); r.parts.exit = { col: 6, row: 8 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] };
    Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' });
    R.m.towers[0].type = 'bastion'; R.m.towerSkill = [1, (R.m.towerSkill || [0, 0])[1]]; R.m.towerSkill2 = [1, (R.m.towerSkill2 || [0, 0])[1]];
    Mpb.recOf(R.m, 1, den).data.watch = { round: R.m.round, by: 1, free: false }; // team B watches team A this round
  }
  fresh(D);
  assert.ok(Mpb.watching(x.m(0), 1) && !Mpb.watching(x.m(0), 0), 'B watches A');
  // team A this round: an Oak, a dug exit, two lake tiles, a wall, an open vote on a Jail (both players' tiles)
  const oak = vote(x, 0, 'oak');
  assert.ok(x.act(0, 'mpbAct', cm, 'exit', 15, 8).ok, 'dug');
  const la = Mpb.recs(x.m(0), 0).filter(r => r.kind === 'magicLake');
  assert.ok(x.act(0, 'mpbAct', la[0].key, 'place', 9, 11).ok && x.act(1, 'mpbAct', la[2].key, 'place', 16, 12).ok, 'water');
  assert.ok(x.act(0, 'placeBwall', 12, 10, 'n').ok, 'a wall');
  assert.ok(x.act(0, 'mpbBuy', oak, 'heal').ok, 'a skill (stays hidden: a buy)');
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'jail');
  D.tbase[0] = Duo.teamState(x.m(0), 0); Duo.tick(D, T); teams(D);
  const js = Mpb.spots(x.m(0), 0, 'jail', null);
  assert.ok(x.act(0, 'mpbVote', js[0].col, js[0].row).ok && x.act(1, 'mpbVote', js[1].col, js[1].row).ok, 'two tiles for the Jail');
  const real = x.m(0), oakRec = recIn(real, 0, oak);
  for (const seat of [2, 3]) {
    const v = W(Duo.viewFor(D, seat).m);
    const o = recIn(v, 0, oak);
    assert.ok(o && o.col === oakRec.col && o.row === oakRec.row, 'seat ' + seat + ': the Oak');
    assert.ok(!(o.skills.heal && o.skills.heal.n), 'seat ' + seat + ': not its Heal (a buy)');
    assert.deepStrictEqual(recIn(v, 0, cm).parts.exit, { col: 15, row: 8 }, 'seat ' + seat + ': the dug exit');
    assert.ok(Game.terrainBlocks(v, 9, 11) && Game.terrainBlocks(v, 16, 12), 'seat ' + seat + ': the water');
    assert.ok((v.bwalls[0] || []).some(w => w.col === 12 && w.row === 10 && w.round === v.round) && Game.bwallShown(v, 1, true, 0, v.bwalls[0].find(w => w.col === 12 && w.row === 10)), 'seat ' + seat + ': the wall, drawn');
    const h = Mpb.voteHead(v, 0);
    assert.ok(h && h.kind === 'jail' && h.votes[0] && h.votes[1] && h.votes[0].col === js[0].col && h.votes[1].col === js[1].col, 'seat ' + seat + ': their vote tiles');
    assert.strictEqual(v.gold[0], D.lanes[Duo.SEATS[seat].lane].base.gold[0], 'seat ' + seat + ': not their gold');
  }
  // without the watch: none of it
  { const save = copy(D.lanes.map(R => Mpb.recOf(R.m, 1, den).data.watch));
    for (const R of D.lanes) delete Mpb.recOf(R.m, 1, den).data.watch;
    const v = W(Duo.viewFor(D, 2).m);
    assert.ok(!recIn(v, 0, oak) && !Game.terrainBlocks(v, 9, 11) && !(v.bwalls[0] || []).some(w => w.round === v.round) && !Mpb.voteHead(v, 0).votes[0], 'not watched: hidden as before');
    D.lanes.forEach((R, L) => { Mpb.recOf(R.m, 1, den).data.watch = save[L]; }); }
  // the watchers' deploy checks: the page (its view) and the server (as team B sees the board) agree on every tile
  teams(D);
  for (const seat of [2, 3]) {
    const L = Duo.SEATS[seat].lane, pv = W(Duo.viewFor(D, seat).m), sv = x.m(L);
    pv.duoLane = L;
    const ask = (name, fn) => {
      for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) {
        const a = fn(pv, c, r), b = Mpb.asSeen(1, () => fn(sv, c, r));
        assert.strictEqual(!!a, !!b, 'seat ' + seat + ' ' + name + ' at ' + c + ',' + r + ': page ' + a + ', server ' + b);
      }
    };
    ask('canPlaceAt (Assassin)', (m, c, r) => Game.canPlaceAt(m, 1, c, r, ui('Assassin')) && Game.spotFree(m, 1, c, r, ui('Assassin')));
    ask('occupied', (m, c, r) => Game.occupied(m, 1, c, r));
    ask('terrainBlocks', (m, c, r) => Game.terrainBlocks(m, c, r));
    ask('bldgSeen', (m, c, r) => Game.bldgSeen(m, 1, c, r));
    ask('spotOk oak', (m, c, r) => Mpb.spotOk(m, 1, 'oak', null, c, r));
    ask('spotOk exit', (m, c, r) => Mpb.spotOk(m, 1, 'coalMine', 'exit', c, r));
    for (const e of ['n', 's']) ask('bwallSpotOk ' + e, (m, c, r) => Game.bwallSpotOk(m, 1, c, r, e));
  }
  // and what they now know is judged so: refused on the page and the server alike
  assert.ok(!try1(x, 2, 'place', ui('Assassin'), oakRec.col, oakRec.row).ok, 'B1\'s Assassin on the Oak (seen live): refused alike');
  assert.ok(!try1(x, 2, 'place', ui('Assassin'), 15, 7).ok, 'next to the dug exit (its ring): refused alike');
  assert.ok(try1(x, 2, 'place', ui('Assassin'), 6, 7).ok, 'the old exit\'s ring is free (it was dug away): allowed alike');
});

// ===================================== 8: artifacts =====================================
check('8: the four artifacts of a match are all different, never the Vault nor the Outpost; what the teams have doesn\'t matter (many secrets)', () => {
  const x = board(271), m0 = copy(x.m(0));
  const pool0 = Mpb.cardPool(W(m0));
  assert.ok(!pool0.some(c => c.id === 'vault' || c.id === 'outpost'), 'no Vault, no Outpost');
  assert.strictEqual(pool0.length, Game.TOWER_TYPES.length + Object.keys(Mpb.KINDS).length - 1, 'every tower type and every building but the Vault');
  { const m = W(m0); Mpb.addRec(m, 0, 'oak', 12, 15); m.towers[1].type = Game.TOWER_TYPES[0].id;
    assert.ok(Mpb.cardPool(m).some(c => c.id === 'oak') && Mpb.cardPool(m).some(c => c.id === Game.TOWER_TYPES[0].id), 'a kind or tower a team has is still in the pool'); }
  const seen = new Set();
  for (let s = 0; s < 400; s++) {
    const m = W(m0); m.round = 2; m.draft = null;
    const a2 = Mpb.rollArtifacts(m, Mpb.rng(1000 + s * 7));
    m.round = 3; m.artifacts = { ...a2, list: a2.list.map(a => ({ ...a, won: s % 3 === 0 ? -1 : s % 2 })) };
    m.draft = Mpb.dealDraft(m, s & 1); m.artifacts = null;
    assert.deepStrictEqual(m.draft.cards, a2.list.map(a => a.card), 'round 3\'s cards are round 2\'s artifacts');
    m.round = 8;
    const a8 = Mpb.rollArtifacts(m, Mpb.rng(5000 + s * 13));
    const all = a2.list.concat(a8.list).map(a => a.card.type + ':' + a.card.id);
    assert.strictEqual(new Set(all).size, 4, 'seed ' + s + ': four different cards: ' + all.join(' '));
    assert.ok(!all.some(k => k === 'mpb:vault' || k.endsWith(':outpost')), 'never the Vault');
    all.forEach(k => seen.add(k));
  }
  assert.strictEqual(seen.size, pool0.length, 'over the seeds every card shows up');
});

check('8: real matches (bots, other secrets): rounds 2 and 8 all different, each draft deals its round\'s artifacts', () => {
  let done = 0;
  for (const sec of [11, 22, 33, 44, 55, 66]) {
    const x = match(7, [true, true, true, true], sec), { D } = x;
    const arts = {}, drafts = {};
    while (x.m(0).round < 10 && D.phase !== 'end') {
      const m = x.m(0);
      if (m.artifacts && m.artifacts.round === m.round) arts[m.round] = copy(m.artifacts.list.map(a => a.card));
      if (m.draft && m.draft.round === m.round) drafts[m.round] = copy(m.draft.cards);
      for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
      if (D.phase === 'end') break;
      for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    if (!arts[2] || !arts[8] || !drafts[3] || !drafts[9]) continue;
    assert.deepStrictEqual(drafts[3], arts[2], 'secret ' + sec + ': round 3 deals round 2\'s');
    assert.deepStrictEqual(drafts[9], arts[8], 'secret ' + sec + ': round 9 deals round 8\'s');
    const all = arts[2].concat(arts[8]).map(c => c.type + ':' + c.id);
    assert.strictEqual(new Set(all).size, 4, 'secret ' + sec + ': all different: ' + all.join(' '));
    done++;
  }
  assert.ok(done >= 3, 'matches that reached round 9: ' + done);
});

check('8: a bot-played match plays the same every time (the bots\' package and tower picks come from D.secret)', () => {
  const play = () => {
    const x = match(7, [true, true, true, true], 1), { D } = x, hp = [];
    while (x.m(0).round < 6 && D.phase !== 'end') {
      for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
      hp.push(x.m(0).round + ':' + D.hp.join('/') + ':' + D.lanes.map(R => R.m.towers.map(t => t && t.type).join(',')).join(';'));
      if (D.phase === 'end') break;
      for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    return hp.join(' ');
  };
  const a = play(), b = play();
  assert.strictEqual(b, a, 'two plays of one match');
});

// ===================================== 10: the Shadow Den and the mine =====================================
check('10: with a Shadow Den, Rogues, Assassins and Shadowhands come up the mine without the wait; others (and without a Den) wait', () => {
  for (const den of [true, false]) {
    const x = match(281, [true, true, true, true]), { D } = x;
    for (const m of lanesOf(D)) { m.armies = [[], []]; m.packages = null; }
    teams(D);
    addMine(D, 0, 11, 16, 11, 10);
    if (den) put(D, 0, 'shadowDen', { col: 6, row: 16 });
    const m = x.m(0);
    const q = { r: squad(m, 0, 'Rogue', 10, 15), a: squad(m, 0, 'Assassin', 12, 15), b: squad(m, 0, 'Brute', 10, 17) };
    if (den) q.h = squad(m, 0, 'Shadowhands', 12, 17);
    const bt = battleOf(D);
    for (const [k, s] of Object.entries(q)) {
      const bs = bodiesOf(bt, 0, s.id);
      assert.ok(bs.length && bs.every(z => z.mineT === COAL.COAL.travel), (den ? 'Den: ' : 'no Den: ') + k + ' goes down');
      const wait = den && k !== 'b' ? 0 : COAL.COAL.rise;
      assert.ok(bs.every(z => Math.abs(z.delay - (COAL.COAL.travel + wait)) < 1e-9), (den ? 'Den: ' : 'no Den: ') + k + ': stands ' + wait + ' s after coming up (delay ' + bs[0].delay + ')');
    }
  }
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log(`\nall ${passed} answer checks passed`);
