// Headless checks of "hidden until the fight" for the 2v2 buildings (Vilhelm, 6 Nov 2026: "They should be hidden until
// the fight just like everything else in the game" and "if things are placed on the same tile, they find another spot
// close to it"; docs/MPB-2V2.md "Hidden until the fight", PATCH-NOTES 6 November).
//  - every placement and board change of this round (a building by the vote, the clock running out or a bot, the Coal
//    mine's entrance and exit, both Scorch turrets, a grown Tree kojja and its take-back, Magic lake tiles put down,
//    moved and taken back by Undo all, Dig a new exit and its take-back): both opponent seats' views (and so the
//    server's sync) stay exactly as they were; the teammate sees it at once; the fight and the next round show it
//  - the deploy checks judge the board as the acting team sees it: the page (its view) and the server (Mpb.asSeen)
//    give the same answer on every tile, and a refusal never shows a hidden building (the dug exit's old ring too)
//  - at the fight's start, everything known (Duo.settleBoard): every clash pair, both orders (squad and building, lake
//    and squad, lake and lake, the lake shutting a tile off, a turret or a grown kojja on a hidden squad, a Cog
//    Builder's Factory, a wall under water): the newer of two things on one tile moves to the nearest tile its rules
//    allow; ties; no room: the other moves. Since Vilhelm's answers (6 Nov; more in tools/tests/mpb-answers.js) nothing
//    else moves: an Assassin next to a hidden building, a squad round a hidden dug exit and a building in its room all
//    stay, and an exit never moves (exit and exit, exit and water, exit by an artifact: both stay, the exit blocked)
//  - the same result from a saved and loaded match; Undo all replays a vote onto a hidden tile as it was
//  - review: a hidden Grow never holds the shared clock (no vote does); the server's coins come from D.secret (in no
//    view); the page's clock label never reads a vote; a Nest's squad and a School's pupil go with their building;
//    Bastion walls judged as seen (page = server on every edge); both teams' walls facing the 2v2 middle row stay (2026-11-07)
// Run: node tools/tests/mpb-hidden.js
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
const only = process.env.ONLY || '';
const check = (name, fn) => { if (only && !name.includes(only)) return; try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };
const ui = (name) => { const i = units.findIndex(u => u.name === name); if (i < 0) throw new Error('no unit ' + name); return i; };
const lanesOf = (D) => D.lanes.map(R => R.m);
const teams = (D) => Duo.setTeams(lanesOf(D));
const cheb = (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const T = 1e12;

function match(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, T, seed, bots);
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
// a match at round 2 (flank tiles not open yet; round 3 opens them) with no squads, rich, the Assassin unlocked for all
function board(seed, round = 2, keepArtifacts = false) {
  const x = match(seed), { D } = x;
  playTo(x, round);
  const art = keepArtifacts ? copy(x.m(0).artifacts) : null;
  clearArmies(D); rich(D);
  if (art) for (const R of D.lanes) R.m.artifacts = copy(art);
  for (const seat of [0, 1, 2, 3]) { const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side; if (!Game.isUnlocked(x.m(L), sd, ui('Assassin'))) assert.ok(x.act(seat, 'unlock', ui('Assassin')).ok); }
  fresh(D);
  return x;
}
// what an opponent's phone holds: its whole view (its own lane, m.team), the phase; the server's push sends a sync
// only when this changes (server/src/duo.js push: the clocks aside)
const oppKey = (D, seat) => JSON.stringify({ v: Duo.viewFor(D, seat), phase: D.phase, hp: D.hp, ready: D.ready });
const keys = (D, side) => Duo.SEATS.map((s, k) => k).filter(k => Duo.SEATS[k].side === side).map(k => oppKey(D, k));
// and the clock as the server sends it (server/src/duo.js clockNews: a status goes to a phone only when this changes)
const clk = (D, side) => [0, 1, 2, 3].filter(k => Duo.SEATS[k].side === side).map(k => JSON.stringify([D.phase, Duo.remainingFor(D, k, T), Duo.heldFor(D, k), Duo.clocks(D, k, T)]));
function vote(x, sd, kind, t) {
  const { D } = x;
  for (const R of D.lanes) Mpb.queue(R.m, sd, kind);
  fresh(D); Duo.tick(D, T);
  const s0 = Duo.seatOf(0, sd), s1 = Duo.seatOf(1, sd);
  t = t || Mpb.autoSpot(x.m(0), sd, kind, null);
  assert.ok(x.act(s0, 'mpbVote', t.col, t.row).ok && x.act(s1, 'mpbVote', t.col, t.row).ok, kind + ' voted onto ' + JSON.stringify(t));
  const rec = Mpb.recs(x.m(0), sd).find(r => r.kind === kind && r.col === t.col && r.row === t.row);
  assert.ok(rec, kind + ' placed');
  return rec.key;
}
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
  const { D } = x;
  let f = null;
  for (let k = 0; k < 4; k++) f = Duo.setReady(D, k, true, T) || f;
  assert.ok(f, 'fought');
  const P = f.pres.map(W);
  Duo.setTeams(P);
  return { f, P };
}
const recIn = (m, sd, key) => Mpb.recOf(m, sd, key);
const sqIn = (P, L, sd, id) => P[L].armies[sd].find(q => q.id === id);
const COAL = Mpb.kindOf('coalMine');
// a plain unit the seat has (not a building, not 'anywhere')
const plain = (x, seat) => { const L = Duo.SEATS[seat].lane, sd = Duo.SEATS[seat].side, m = x.m(L); return units.map((u, i) => i).find(i => !units[i].building && !units[i].anywhere && !units[i].mpbUnit && Game.isUnlocked(m, sd, i) && (Game.footprint ? Game.footprint(m, i) : 1) === 1); };

// ======================================= hidden =======================================
check('every kind placed by the vote: both opponent seats see nothing until the fight, the teammate sees it at once', () => {
  for (const kind of ['oak', 'fieldHospital', 'jail', 'school', 'shadowDen', 'factory', 'treeKojja', 'coalMine', 'scorch']) {
    const x = board(31), { D } = x;
    if (kind === 'scorch') { for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'scorch' }); } else for (const R of D.lanes) Mpb.queue(R.m, 0, kind);
    fresh(D); Duo.tick(D, T);
    const before = keys(D, 1), c0 = clk(D, 1);
    const same = (what) => assert.deepStrictEqual(keys(D, 1), before, kind + ': ' + what + ': the opponents\' views are as they were');
    const held = () => Mpb.voteQueue(x.m(0), 0).some(e => !e.skill);
    const n0 = Mpb.recs(x.m(0), 0).length;
    if (kind === 'scorch') {
      const sp = Mpb.spots(x.m(0), 0, 'scorch', null);
      assert.ok(x.act(1, 'mpbVote', sp[0].col, sp[0].row).ok); same('A2\'s turret');
      const sp2 = Mpb.spots(x.m(0), 0, 'scorch', null);
      assert.ok(x.act(0, 'mpbVote', sp2[0].col, sp2[0].row).ok); same('A1\'s turret');
    } else {
      const t = Mpb.autoSpot(x.m(0), 0, kind, null);
      assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok); same('A1\'s vote');
      assert.ok(x.act(1, 'mpbVote', t.col, t.row).ok); same('placed');
      if (kind === 'coalMine') {
        const e = Mpb.autoSpot(x.m(0), 0, 'coalMine', 'exit');
        assert.ok(x.act(1, 'mpbVote', e.col, e.row).ok && x.act(0, 'mpbVote', e.col, e.row).ok); same('the exit placed');
      }
    }
    // the shared deploy clock never waited for the vote ("Votes don't hold the clock, independent systems", Vilhelm,
    // 6 Nov): the opponents' clocks are as they were all along (updated 6 Nov: the clock used to wait for a vote)
    assert.ok(!held(), kind + ': nothing left to place');
    assert.ok(D.deadline > 0, kind + ': the deploy clock runs');
    assert.deepStrictEqual(clk(D, 1), c0, kind + ': the opponents\' clocks never changed');
    const made = Mpb.recs(x.m(0), 0).slice(n0);
    assert.ok(made.length >= 1, kind + ': placed');
    for (const r of made) {
      for (const s of [2, 3]) assert.ok(!recIn(Duo.viewFor(D, s).m, 0, r.key), kind + ': seat ' + s + ' has no ' + r.key);
      const mate = recIn(Duo.viewFor(D, 1).m, 0, r.key);
      assert.ok(mate && mate.col === r.col && mate.row === r.row, kind + ': the teammate sees ' + r.key + ' at once');
      for (const s of [2, 3]) assert.ok(!Game.mpbAt(W(Duo.viewFor(D, s).m), r.col, r.row), kind + ': its tile is free for seat ' + s);
    }
    for (const s of [2, 3]) assert.ok(Duo.viewFor(D, s).m.mpbVote[0].length >= 1, kind + ': the vote itself still shows (the card was open to all)');
    const { f } = fight(x);
    for (const r of made) {
      const pre = Mpb.recOf(f.pres[0], 0, r.key);
      assert.ok(pre, kind + ': the fight shows ' + r.key);
      if (D.phase === 'result') assert.ok(recIn(Duo.viewFor(D, 2).m, 0, r.key), kind + ': the result shows it to the opponents');
    }
    if (D.phase === 'result') { for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T); for (const r of made) assert.ok(recIn(Duo.viewFor(D, 3).m, 0, r.key), kind + ': and the next round'); }
  }
});

check('board changes: the clock running out, a bot\'s vote, Grow and its take-back, lake tiles put, moved and Undo all, Dig a new exit and its take-back', () => {
  { // the vote's 15 s ran out: the server places it (as the team sees the board)
    const x = board(32), { D } = x;
    for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
    fresh(D); Duo.tick(D, T);
    const before = keys(D, 1);
    Duo.tick(D, T + Mpb.VOTE_MS + 1);
    assert.ok(Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak'), 'placed by the clock');
    assert.deepStrictEqual(keys(D, 1), before, 'the clock\'s placement: hidden');
  }
  { // a bot teammate votes at once
    const x = match(33, [true, true, false, false]), { D } = x;
    playTo(x, 2); clearArmies(D); rich(D); fresh(D);
    const before = keys(D, 1);
    for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
    Duo.tick(D, T);
    assert.ok(Mpb.recs(x.m(0), 0).some(r => r.kind === 'oak' && r.placed === x.m(0).round), 'the bots placed it');
    const after = keys(D, 1).map(s => JSON.parse(s));
    const strip = (o) => { o.v.m.mpbVote[0] = []; o.v.m.mpbSeen[0] = []; return JSON.stringify(o); };
    assert.deepStrictEqual(after.map(strip), before.map(s => strip(JSON.parse(s))), 'the bots\' placement: hidden (only the open vote shows)');
  }
  { // Grow, placed and taken back
    const x = board(34), { D } = x;
    const k = put(D, 0, 'treeKojja'); fresh(D); Duo.tick(D, T);
    const before = keys(D, 1), c0 = clk(D, 1);
    assert.ok(x.act(1, 'mpbBuy', k, 'grow').ok);
    const t = Mpb.spots(x.m(1), 0, 'treeKojja', null)[1];
    assert.ok(x.act(1, 'mpbVote', t.col, t.row).ok);
    assert.deepStrictEqual(keys(D, 1), before, 'grown: hidden');
    assert.ok(Mpb.recs(Duo.viewFor(D, 0).m, 0).some(r => r.kind === 'treeKojja' && r.col === t.col && r.row === t.row), 'A1 sees A2\'s new kojja');
    assert.ok(x.act(1, 'mpbUndo', k, 'grow').ok);
    assert.deepStrictEqual(keys(D, 1), before, 'taken back: hidden');
    assert.deepStrictEqual(clk(D, 1), c0, 'Grow: nothing on the opponents\' clocks either');
  }
  { // lake tiles
    const x = board(35), { D } = x;
    for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' });
    fresh(D);
    Duo.tick(D, T);
    const lk = Mpb.recs(x.m(0), 0).filter(r => r.kind === 'magicLake'), before = keys(D, 1), c1 = clk(D, 1);
    assert.ok(x.act(0, 'mpbAct', lk[0].key, 'place', 9, 10).ok); assert.deepStrictEqual(keys(D, 1), before, 'a tile put down: hidden');
    assert.ok(x.act(0, 'mpbAct', lk[0].key, 'place', 8, 10).ok); assert.deepStrictEqual(keys(D, 1), before, 'moved: hidden');
    assert.ok(x.act(1, 'mpbAct', lk[2].key, 'place', 14, 14).ok); assert.deepStrictEqual(keys(D, 1), before, 'A2\'s: hidden');
    assert.ok(Game.terrainBlocks(W(Duo.viewFor(D, 1).m), 8, 10) && Game.terrainBlocks(W(Duo.viewFor(D, 0).m), 14, 14), 'the teammates see the water');
    for (const s of [2, 3]) assert.ok(!Game.terrainBlocks(W(Duo.viewFor(D, s).m), 8, 10), 'seat ' + s + ': dry');
    assert.ok(x.act(0, 'undoAll').ok); assert.deepStrictEqual(keys(D, 1), before, 'Undo all: hidden');
    assert.deepStrictEqual(clk(D, 1), c1, 'lake tiles: nothing on the opponents\' clocks');
    const { P } = fight(x);
    assert.ok(Game.terrainBlocks(P[0], 14, 14), 'the fight has A2\'s water');
  }
  { // Dig a new exit, and its take-back: the opponents keep the old exit and its ring
    const x = board(36), { D } = x;
    const key = put(D, 0, 'coalMine', { col: 11, row: 16 });
    for (const R of D.lanes) Mpb.recOf(R.m, 0, key).parts.exit = { col: 11, row: 10 };
    fresh(D); Duo.tick(D, T);
    const before = keys(D, 1), c2 = clk(D, 1);
    assert.ok(x.act(0, 'mpbBuy', key, 'shaft').ok && x.act(0, 'mpbAct', key, 'exit', 1, 4).ok, 'dug to a flank tile of the enemy\'s half');
    assert.deepStrictEqual(keys(D, 1), before, 'dug: hidden');
    assert.deepStrictEqual(clk(D, 1), c2, 'dug: nothing on the opponents\' clocks');
    const pv = W(Duo.viewFor(D, 2).m);
    assert.deepStrictEqual(Mpb.recOf(pv, 0, key).parts.exit, { col: 11, row: 10 }, 'B1 still sees the old exit');
    assert.ok(Game.occupied(pv, 1, 12, 9) && !Game.occupied(pv, 1, 2, 4), 'and its old ring, not the new one');
    assert.ok(try1(x, 2, 'place', ui('Assassin'), 2, 4).ok, 'B1 may put a squad by the new exit (it can\'t see it): page and server agree');
    assert.ok(!try1(x, 2, 'place', ui('Assassin'), 12, 9).ok, 'nor by the old one: refused on the page and the server alike');
    assert.ok(x.act(0, 'mpbUndo', key, 'shaft').ok);
    assert.deepStrictEqual(Mpb.recOf(x.m(0), 0, key).parts.exit, { col: 11, row: 10 }, 'taken back');
    for (const s of [2, 3]) { const v = JSON.parse(oppKey(D, s)).v.m; assert.deepStrictEqual(Mpb.recOf(v, 0, key).data, {}, 'seat ' + s + ': no dig keys left (as when the round began)'); }
  }
});

check('the deploy checks as the acting team sees the board: the page and the server agree on every tile', () => {
  const x = board(37), { D } = x;
  const cm = put(D, 0, 'coalMine', { col: 12, row: 16 });
  for (const R of D.lanes) { Mpb.recOf(R.m, 0, cm).parts.exit = { col: 6, row: 8 }; Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' }); Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); }
  const bm = put(D, 1, 'coalMine', { col: 11, row: 2 });
  for (const R of D.lanes) Mpb.recOf(R.m, 1, bm).parts.exit = { col: 17, row: 10 };
  fresh(D);
  // team A this round: an Oak, a dug exit, two lake tiles in no man's land
  vote(x, 0, 'oak');
  assert.ok(x.act(0, 'mpbBuy', cm, 'shaft').ok && x.act(0, 'mpbAct', cm, 'exit', 13, 8).ok);
  const la = Mpb.recs(x.m(0), 0).filter(r => r.kind === 'magicLake');
  assert.ok(x.act(0, 'mpbAct', la[0].key, 'place', 15, 7).ok && x.act(1, 'mpbAct', la[2].key, 'place', 9, 11).ok);
  teams(D);
  const lb = Mpb.recs(x.m(0), 1).filter(r => r.kind === 'magicLake');
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
    ask('exitMoveOk', (m, c, r) => { const rec = Mpb.recOf(m, 1, bm); rec.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; try { return COAL.exitMoveOk(m, 1, rec, c, r); } finally { delete rec.skills.shaft; } });
    ask('lakeOk', (m, c, r) => Mpb.kindOf('magicLake').lakeOk(m, 1, Mpb.recOf(m, 1, lb[L * 2].key), c, r));
    ask('bwallSpotOk', (m, c, r) => Game.bwallSpotOk(m, 1, c, r, 's'));
  }
  // and the server's act says so too
  assert.ok(try1(x, 2, 'place', ui('Assassin'), 12, 8).ok, 'B1\'s Assassin next to the hidden dug exit: allowed alike');
  const oak = Mpb.recs(x.m(0), 0).find(r => r.kind === 'oak');
  assert.ok(try1(x, 3, 'place', ui('Assassin'), oak.col, oak.row).ok, 'B2\'s Assassin on the hidden Oak: allowed alike');
  assert.ok(try1(x, 2, 'mpbAct', lb[0].key, 'place', 15, 7).ok, 'B1\'s lake tile on A\'s hidden water: allowed alike');
  assert.ok(!try1(x, 2, 'place', ui('Assassin'), 7, 8).ok, 'by the old exit (still there for them): refused alike');
});

// ======================================= the fight's start =======================================
// A's Oak and B's Assassin on one tile of A's zone, both orders: the Assassin moves (updated 6 Nov, Vilhelm's answer 5,
// "You always have 'prio' in your own zone": the newer used to move, so an Oak voted onto it moved next to it)
check('squad and building on one tile of the building\'s own zone, both orders: the other team\'s squad moves to the nearest tile its rules allow', () => {
  for (const order of ['building first', 'squad first']) {
    const x = board(41), { D } = x;
    const t = { col: 12, row: 15 };
    let key, ass;
    if (order === 'building first') { key = vote(x, 0, 'oak', t); ass = place(x, 2, 'Assassin', t.col, t.row); }
    else { ass = place(x, 2, 'Assassin', t.col, t.row); key = vote(x, 0, 'oak', t); }
    const { P } = fight(x);
    const oak = recIn(P[0], 0, key), a = sqIn(P, 0, 1, ass.id);
    assert.deepStrictEqual([oak.col, oak.row], [t.col, t.row], order + ': the Oak stays');
    assert.ok(!Game.nearBldg(P[0], 1, a.col, a.row), order + ': the Assassin moved off and away from it (its own rule)');
    // the nearest such tile
    const ok = [];
    for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) if ((c !== a.col || r !== a.row) && Game.canPlaceAt(P[0], 1, c, r, ass.unit, true) && !Game.occupied(P[0], 1, c, r) && !Game.occupied(P[0], 0, c, r)) ok.push({ col: c, row: r });
    const best = Mpb.nearestOf(ok.concat([{ col: a.col, row: a.row }]), t.col, t.row);
    assert.ok(cheb(a, t) <= cheb(best, t), order + ': as near as it may be (' + JSON.stringify([a.col, a.row]) + ')');
    assert.deepStrictEqual(D.settled.map(e => e.id), ['s0:1:' + ass.id], order + ': only the Assassin moved');
  }
});

// (updated 6 Nov: an exit never moves and moves nothing any more, "the mine exit tiles can be blocked": it used to be
// the newer exit that moved)
check('exit and exit, and exit in the other exit\'s ring, both orders: both stay, blocked (nothing moves)', () => {
  for (const gap of [0, 1]) for (const first of [0, 1]) {
    const x = board(42), { D } = x;
    const ka = put(D, 0, 'coalMine', { col: 12, row: 16 }), kb = put(D, 1, 'coalMine', { col: 11, row: 2 });
    for (const R of D.lanes) { Mpb.queue(R.m, 0, 'coalMine', 'exit', ka); Mpb.queue(R.m, 1, 'coalMine', 'exit', kb); }
    fresh(D); Duo.tick(D, T);
    const tA = { col: 12, row: 8 }, tB = { col: 12 + gap, row: 8 };
    const go = (sd) => { const t = sd === 0 ? tA : tB, s = Duo.seatOf(0, sd), s2 = Duo.seatOf(1, sd); assert.ok(x.act(s, 'mpbVote', t.col, t.row).ok && x.act(s2, 'mpbVote', t.col, t.row).ok, 'exit of team ' + sd); };
    go(first); go(1 - first);
    const { P } = fight(x);
    const ea = recIn(P[0], 0, ka).parts.exit, eb = recIn(P[0], 1, kb).parts.exit;
    assert.deepStrictEqual([ea, eb], [tA, tB], 'gap ' + gap + ', team ' + first + ' first: both exits stay where they were voted');
    assert.deepStrictEqual(D.settled, [], 'gap ' + gap + ': nothing moved');
    // gap 0: both exits on one tile: blocked, nobody comes up; gap 1: B's exit takes the tile A's squad round (13,16) would come up on
    if (gap === 0) for (const sd of [0, 1]) { const rec = recIn(P[0], sd, sd === 0 ? ka : kb); assert.strictEqual(COAL.mineOut(P[0], rec, rec.col + 1, rec.row), null, 'gap 0: team ' + sd + '\'s exit is blocked'); }
    else assert.strictEqual(COAL.mineOut(P[0], recIn(P[0], 0, ka), 13, 16), null, 'gap 1: A\'s landing tile (13,8) is B\'s exit: no way out there');
  }
});

check('lake tile and exit (both stay: the exit is blocked), lake tile and squad, lake and lake, both orders: the newer moves', () => {
  const LK = Mpb.kindOf('magicLake');
  for (const what of ['exit', 'squad', 'lake']) for (const lakeFirst of [true, false]) {
    const x = board(43), { D } = x;
    for (const R of D.lanes) { Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' }); if (what === 'lake') Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); }
    let kb = null;
    if (what === 'exit') { kb = put(D, 1, 'coalMine', { col: 11, row: 2 }); for (const R of D.lanes) Mpb.queue(R.m, 1, 'coalMine', 'exit', kb); }
    fresh(D); Duo.tick(D, T);
    const t = { col: 10, row: 10 }, la = Mpb.recs(x.m(0), 0).find(r => r.kind === 'magicLake' && r.data.lane === 0);
    const lake = () => assert.ok(x.act(0, 'mpbAct', la.key, 'place', t.col, t.row).ok, 'A1\'s water');
    let other = null;
    const theirs = () => {
      if (what === 'exit') assert.ok(x.act(2, 'mpbVote', t.col, t.row).ok && x.act(3, 'mpbVote', t.col, t.row).ok, 'B\'s exit');
      else if (what === 'squad') other = place(x, 2, 'Assassin', t.col, t.row);
      else { other = Mpb.recs(x.m(0), 1).find(r => r.kind === 'magicLake' && r.data.lane === 0); assert.ok(x.act(2, 'mpbAct', other.key, 'place', t.col, t.row).ok, 'B1\'s water'); }
    };
    if (lakeFirst) { lake(); theirs(); } else { theirs(); lake(); }
    const { P } = fight(x);
    const w = recIn(P[0], 0, la.key), at = what === 'exit' ? recIn(P[0], 1, kb).parts.exit : what === 'squad' ? sqIn(P, 0, 1, other.id) : recIn(P[0], 1, other.key);
    if (what === 'exit') { // (updated 6 Nov: the exit used to move off the water, or the water off the exit)
      assert.deepStrictEqual([[w.col, w.row], [at.col, at.row]], [[t.col, t.row], [t.col, t.row]], 'exit' + (lakeFirst ? ', water first' : ', water last') + ': both stay');
      const rec = recIn(P[0], 1, kb);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dc || dr) assert.strictEqual(COAL.mineOut(P[0], rec, rec.col + dc, rec.row + dr), null, 'the exit under water: nobody comes up');
      continue;
    }
    const [stay, move] = lakeFirst ? [w, at] : [at, w];
    assert.deepStrictEqual([stay.col, stay.row], [t.col, t.row], what + (lakeFirst ? ', water first' : ', water last') + ': the older stays');
    assert.ok(!(move.col === t.col && move.row === t.row) && cheb(move, t) <= 2, what + ': the newer moved close by: ' + JSON.stringify([move.col, move.row]));
    if (what === 'squad' && lakeFirst) assert.ok(!Game.terrainBlocks(P[0], move.col, move.row), 'the squad is off the water');
    if (move === w || what === 'lake') { const wr = move === w ? w : at; assert.ok(Game.terrainBlocks(P[0], wr.col, wr.row), 'water where the moved tile went'); }
    void LK;
  }
});

// (updated 6 Nov: the newer of the two used to move; now the dug exit stays where it was dug, just blocked)
check('a flank tile: A\'s exit dug onto the edge of B\'s zone and B\'s water put there, both orders: both stay, the exit blocked', () => {
  for (const digFirst of [true, false]) {
    const x = board(59, 3), { D } = x;
    const ka = put(D, 0, 'coalMine', { col: 12, row: 16 });
    for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, ka); r.parts.exit = { col: 12, row: 10 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); }
    fresh(D);
    const t = { col: 1, row: 4 }, lb = Mpb.recs(x.m(0), 1).find(r => r.kind === 'magicLake' && r.data.lane === 0);
    const dig = () => assert.ok(x.act(0, 'mpbAct', ka, 'exit', t.col, t.row).ok, 'A1 digs onto (1,4)');
    const water = () => assert.ok(x.act(2, 'mpbAct', lb.key, 'place', t.col, t.row).ok, 'B1\'s water on (1,4), the edge of its own zone');
    if (digFirst) { dig(); water(); } else { water(); dig(); }
    const { P } = fight(x);
    const ex = recIn(P[0], 0, ka).parts.exit, w = recIn(P[0], 1, lb.key);
    assert.deepStrictEqual([[ex.col, ex.row], [w.col, w.row]], [[t.col, t.row], [t.col, t.row]], (digFirst ? 'dug first' : 'water first') + ': both stay');
    assert.deepStrictEqual(D.settled, [], 'nothing moved');
    assert.strictEqual(COAL.mineOut(P[0], recIn(P[0], 0, ka), 13, 15), null, 'the exit is blocked: nobody comes up');
  }
});

check('the water of both teams shuts a tile off: the newest tile that does so moves', () => {
  for (const aLast of [true, false]) {
    const x = board(44), { D } = x;
    for (const R of D.lanes) { Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' }); Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' }); }
    fresh(D);
    const la = Mpb.recs(x.m(0), 0).find(r => r.kind === 'magicLake' && r.data.lane === 0), lb = Mpb.recs(x.m(0), 1).filter(r => r.kind === 'magicLake' && r.data.lane === 0);
    const a = () => assert.ok(x.act(0, 'mpbAct', la.key, 'place', 1, 10).ok);
    const b = () => { assert.ok(x.act(2, 'mpbAct', lb[0].key, 'place', 0, 9).ok); assert.ok(x.act(2, 'mpbAct', lb[1].key, 'place', 0, 11).ok); };
    if (aLast) { b(); a(); } else { a(); b(); }
    const { P } = fight(x);
    const tiles = [recIn(P[0], 0, la.key), recIn(P[0], 1, lb[0].key), recIn(P[0], 1, lb[1].key)];
    const moved = tiles.filter((r, i) => !(r.col === [1, 0, 0][i] && r.row === [10, 9, 11][i]));
    assert.strictEqual(moved.length, 1, 'one tile moved');
    assert.strictEqual(moved[0].key, aLast ? la.key : lb[1].key, 'the newest of those that shut (0,10) off');
    assert.ok(!(Game.terrainBlocks(P[0], 0, 9) && Game.terrainBlocks(P[0], 0, 11) && Game.terrainBlocks(P[0], 1, 10)), '(0,10) can be walked to');
    assert.ok(Mpb.kindOf('magicLake').lakeFree(P[0], -5, -5) !== undefined);
  }
});

// (updated 6 Nov: the Assassin used to move away, its own rule checked again with everything known)
check('an Assassin next to a building placed this round, either order: both stay ("It stays in that spot")', () => {
  for (const kind of ['scorch', 'oak']) for (const assFirst of [true, false]) {
    const x = board(45), { D } = x;
    const t = { col: 12, row: 15 }, next = { col: 13, row: 15 };
    let key, ass;
    const build = () => {
      if (kind === 'scorch') { for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'scorch' }); fresh(D); assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok); key = Mpb.recs(x.m(0), 0).find(r => r.kind === 'scorch' && r.col >= 0 && r.col === t.col).key; }
      else key = vote(x, 0, 'oak', t);
    };
    if (assFirst) { ass = place(x, 2, 'Assassin', next.col, next.row); build(); } else { build(); ass = place(x, 2, 'Assassin', next.col, next.row); }
    const { P } = fight(x);
    const b = recIn(P[0], 0, key), a = sqIn(P, 0, 1, ass.id);
    assert.deepStrictEqual([b.col, b.row], [t.col, t.row], kind + (assFirst ? ', Assassin first' : ', Assassin last') + ': the building stays');
    assert.deepStrictEqual([a.col, a.row], [next.col, next.row], kind + ': the Assassin stays next to it');
    assert.deepStrictEqual(D.settled, [], kind + ': nothing moved');
  }
});

// (updated 6 Nov, answer 5 "prio in your own zone": the newer used to move, the building too)
check('a Scorch turret or a grown Tree kojja on a squad placed this round, both orders: on its own zone the building stays, the squad moves', () => {
  for (const kind of ['scorch', 'grow']) for (const sqFirst of [true, false]) {
    const x = board(46), { D } = x;
    let tk = null;
    if (kind === 'grow') { tk = put(D, 0, 'treeKojja', { col: 12, row: 16 }); fresh(D); }
    const t = { col: 12, row: 14 };
    let key, sq;
    const build = () => {
      const n = Mpb.recs(x.m(0), 0).length;
      if (kind === 'scorch') { for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'scorch' }); assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok, 'turret'); }
      else { assert.ok(x.act(0, 'mpbBuy', tk, 'grow').ok); assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok, 'grown'); }
      key = Mpb.recs(x.m(0), 0).slice(n).find(r => r.col === t.col && r.row === t.row).key;
    };
    if (sqFirst) { sq = place(x, 3, 'Assassin', t.col, t.row); build(); } else { build(); sq = place(x, 3, 'Assassin', t.col, t.row); }
    const { P } = fight(x);
    const b = recIn(P[0], 0, key), a = sqIn(P, 1, 1, sq.id);
    assert.deepStrictEqual([b.col, b.row], [t.col, t.row], kind + (sqFirst ? ', squad first' : ', squad last') + ': the building stays');
    assert.ok(!(a.col === t.col && a.row === t.row) && !Game.nearBldg(P[1], 1, a.col, a.row), kind + ': the squad moved');
  }
});

// (updated 6 Nov: a squad put round the hidden dug exit after the dig, and the Oak within 2 tiles of it, used to move)
check('a squad round an exit dug this round (a flank tile of its half) and a building within 2 tiles of it, either order: all stay', () => {
  for (const sqFirst of [true, false]) {
    const x = board(47), { D } = x;
    const kb = put(D, 1, 'coalMine', { col: 11, row: 2 });
    for (const R of D.lanes) { const r = Mpb.recOf(R.m, 1, kb); r.parts.exit = { col: 12, row: 8 }; r.skills.shaft = { round: 0, n: 1, by: [1, 0], log: [] }; }
    for (const R of D.lanes) Mpb.queue(R.m, 0, 'oak');
    fresh(D); Duo.tick(D, T);
    const dig = () => assert.ok(x.act(2, 'mpbAct', kb, 'exit', 1, 15).ok, 'B1 digs the exit to (1,14), a flank tile of team A\'s half');
    let sq;
    const mine = () => {
      sq = place(x, 0, 'plain', 2, 14);
      assert.ok(x.act(0, 'mpbVote', 3, 16).ok && x.act(1, 'mpbVote', 3, 16).ok, 'A\'s Oak at (3,15), 2 tiles from (1,14)');
    };
    if (sqFirst) { mine(); dig(); } else { dig(); mine(); }
    const { P } = fight(x);
    const ex = recIn(P[0], 1, kb).parts.exit, q = sqIn(P, 0, 0, sq.id), oak = Mpb.recs(P[0], 0).find(r => r.kind === 'oak');
    assert.deepStrictEqual(ex, { col: 1, row: 15 }, (sqFirst ? 'squad first' : 'dug first') + ': the exit stays');
    assert.deepStrictEqual([q.col, q.row], [2, 14], 'the squad stays in the ring');
    assert.deepStrictEqual([oak.col, oak.row], [3, 16], 'the Oak stays, 2 tiles from the exit');
    assert.deepStrictEqual(D.settled, [], 'nothing moved');
  }
});

// (updated 6 Nov: an Assassin next to it used to move away too)
check('a Cog Builder\'s Factory placed this round never moves: an Assassin on it does, one next to it stays', () => {
  for (const on of [true, false]) {
    const x = board(48), { D } = x;
    const t = { col: 12, row: 15 };
    D.lanes[0].m.buildings = D.lanes[0].m.buildings || [[], []];
    D.lanes[0].m.buildings[0] = [{ id: 'factory', col: t.col, row: t.row, round: x.m(0).round, built: true }];
    teams(D); Duo.stampAll(D);
    const ass = place(x, 2, 'Assassin', on ? t.col : t.col + 1, t.row);
    const { P } = fight(x);
    const a = sqIn(P, 0, 1, ass.id);
    if (on) assert.ok(cheb(a, t) >= 2, 'on it: the Assassin moved off, not next to it (its rules as a move): ' + JSON.stringify([a.col, a.row]));
    else assert.deepStrictEqual([a.col, a.row], [t.col + 1, t.row], 'next to it: the Assassin stays');
  }
});

// (updated 6 Nov, answer 6 "no walls on the lake": a hidden wall and hidden water on one tile are a clash like any
// other, the newer moves here in no man's land; the wall used to move whichever was put there first)
check('a Bastion wall under water put down this round in no man\'s land, either order: the newer moves (a wall to the nearest edge it may stand on)', () => {
  for (const wallFirst of [true, false]) {
    const x = board(49), { D } = x;
    for (const R of D.lanes) Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' });
    fresh(D);
    const t = { col: 10, row: 10 }, lb = Mpb.recs(x.m(0), 1).find(r => r.kind === 'magicLake' && r.data.lane === 0);
    const wall = () => { for (const R of D.lanes) { R.m.bwalls = R.m.bwalls || [[], []]; R.m.bwalls[0].push({ col: t.col, row: t.row, edge: 'n', round: R.m.round }); } Duo.stampAll(D); };
    const water = () => assert.ok(x.act(2, 'mpbAct', lb.key, 'place', t.col, t.row).ok);
    if (wallFirst) { wall(); water(); } else { water(); wall(); }
    const { P } = fight(x);
    const w = P[0].bwalls[0].find(v => v.round === P[0].round), r = recIn(P[0], 1, lb.key);
    if (wallFirst) {
      assert.deepStrictEqual([w.col, w.row], [t.col, t.row], 'wall first: the wall stays');
      assert.ok(!(r.col === t.col && r.row === t.row) && cheb(r, t) === 1, 'wall first: the water moved next door: ' + JSON.stringify([r.col, r.row]));
    } else {
      assert.ok(w && !(w.col === t.col && w.row === t.row) && cheb(w, t) === 1 && w.edge === 'n' && !Game.terrainBlocks(P[0], w.col, w.row), 'water first: the wall moved next door, the same way round: ' + JSON.stringify(w));
      assert.deepStrictEqual([r.col, r.row], [t.col, t.row], 'water first: the water stays');
    }
  }
});

// (updated 6 Nov: the newer exit used to move, never next to an artifact; now neither moves, and both are blocked)
check('two exits voted onto one tile two from an artifact: both stay, blocked', () => {
  const x = board(50, 2, true), { D } = x;
  const A = x.m(0).artifacts;
  assert.ok(A && A.round === x.m(0).round, 'round 2 has its artifacts');
  const ka = put(D, 0, 'coalMine', { col: 12, row: 16 }), kb = put(D, 1, 'coalMine', { col: 11, row: 2 });
  for (const R of D.lanes) { Mpb.queue(R.m, 0, 'coalMine', 'exit', ka); Mpb.queue(R.m, 1, 'coalMine', 'exit', kb); }
  fresh(D); Duo.tick(D, T);
  // a tile two from an artifact: its nearest tiles (other than the older exit's ring) are next to the artifact
  const art = A.list[0];
  let t = null;
  for (const d of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) { const c = { col: art.col + d[0], row: art.row + d[1] }; if (Mpb.spotOk(x.m(0), 0, 'coalMine', 'exit', c.col, c.row) && Mpb.spotOk(x.m(0), 1, 'coalMine', 'exit', c.col, c.row)) { t = c; break; } }
  assert.ok(t, 'a tile two from an artifact');
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok && x.act(2, 'mpbVote', t.col, t.row).ok && x.act(3, 'mpbVote', t.col, t.row).ok);
  const { P } = fight(x);
  const ea = recIn(P[0], 0, ka).parts.exit, eb = recIn(P[0], 1, kb).parts.exit;
  assert.deepStrictEqual([ea, eb], [t, t], 'both exits stay');
  assert.ok(A.list.every(a => cheb(a, eb) >= 2), 'not next to an artifact (they were never put there)');
  for (const [sd, k] of [[0, ka], [1, kb]]) { const rec = recIn(P[0], sd, k); assert.strictEqual(COAL.mineOut(P[0], rec, rec.col, rec.row - 1), null, 'team ' + sd + ': blocked'); }
});

// (updated 6 Nov, answer 5: on a zone tile prio decides before any stamp; the tie step "the one out of its zone" used
// to decide this first case)
check('ties (the same stamp: bots, or both as the round began): on a zone tile prio, then the squad, then a seeded coin; the same every time', () => {
  const run = () => {
    const x = board(51), { D } = x;
    const t = { col: 12, row: 15 };
    const key = put(D, 0, 'oak', t);
    for (const R of D.lanes) Mpb.recOf(R.m, 0, key).placed = R.m.round; // (placed this round: hidden from B)
    const m = x.m(0), q = { id: m.nextId[1]++, unit: ui('Assassin'), col: t.col, row: t.row, round: m.round, xp: 0, level: 0, cost: 100 };
    m.armies[1].push(q);
    fresh(D); // (both stamped 0: as if bots put them down as the round began)
    assert.strictEqual(Duo.bstampOf(D, 0, key + '|'), 0); assert.strictEqual(Duo.stampOf(D, 2, q.id), 0);
    const { P } = fight(x);
    return { oak: recIn(P[0], 0, key), a: sqIn(P, 0, 1, q.id), log: D.settled };
  };
  const r1 = run(), r2 = run();
  assert.deepStrictEqual([r1.oak.col, r1.oak.row], [12, 15], 'the Oak stays (its own zone: prio)');
  assert.ok(!(r1.a.col === 12 && r1.a.row === 15), 'the Assassin (the other team\'s) moves');
  assert.deepStrictEqual(r1.log, r2.log, 'the same both times');
  // two Assassins (one of each team) on one tile of no man's land, both stamped 0: the coin, the same each time
  const coin = (seed) => {
    const x = board(seed), { D } = x, m = x.m(0);
    for (const sd of [0, 1]) m.armies[sd].push({ id: m.nextId[sd]++, unit: ui('Assassin'), col: 12, row: 8, round: m.round, xp: 0, level: 0, cost: 100 });
    fresh(D);
    const { P } = fight(x);
    return [0, 1].map(sd => P[0].armies[sd].slice(-1)[0]).map(q => q.col + ',' + q.row).join(' ');
  };
  const seen = new Set();
  for (const s of [52, 53, 54, 55, 56, 57]) { const a = coin(s), b = coin(s); assert.strictEqual(a, b, 'seed ' + s + ': the same'); seen.add(a.split(' ').indexOf('12,8')); }
  assert.ok(seen.size === 2, 'the coin goes both ways over the seeds');
});

// (updated 6 Nov, answer 5: a grown kojja on its own zone stays anyway, so the case is now two Assassins in no man's
// land; tools/tests/mpb-prio.js has the prio case: no tile for the other team's thing, the owner's moves instead)
check('no room anywhere for the newer: the older moves instead', () => {
  const x = board(58), { D } = x, m = x.m(0), t = { col: 12, row: 8 }, u = { col: 16, row: 16 };
  // the board full of Brutes (earlier rounds) but t and u; u, next to A's tower, is no tile for an Assassin by its
  // rules, but it is a tile of A's own zone (relocate's last resort: any free tile of its own zone), not of B's
  teams(D);
  for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) if (!(c === t.col && r === t.row) && !(c === u.col && r === u.row) && !Game.terrainBlocks(m, c, r) && !Game.occupied(m, 0, c, r) && !Game.occupied(m, 1, c, r)) m.armies[r < Game.ROWS / 2 ? 1 : 0].push({ id: m.nextId[r < Game.ROWS / 2 ? 1 : 0]++, unit: ui('Brute'), col: c, row: r, round: 1, xp: 0, level: 0, cost: 100 });
  fresh(D);
  const add = (sd) => { const q = { id: m.nextId[sd]++, unit: ui('Assassin'), col: t.col, row: t.row, round: m.round, xp: 0, level: 0, cost: 100 }; m.armies[sd].push(q); Duo.stampAll(D); return q; };
  const a = add(0), b = add(1); // (B's is the newer)
  Duo.settleBoard(D); // (the fight's start without the fight)
  assert.deepStrictEqual([b.col, b.row], [t.col, t.row], 'B\'s Assassin (newer, no room anywhere) stays');
  assert.deepStrictEqual([a.col, a.row], [u.col, u.row], 'A\'s (older) moved instead: ' + JSON.stringify([a.col, a.row]));
});

check('no room for either: both stay on the tile (the settle stops)', () => {
  const x = board(60), { D } = x, m = x.m(0), t = { col: 12, row: 8 };
  for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) if (!(c === t.col && r === t.row) && !Game.terrainBlocks(m, c, r) && !Game.occupied(m, 0, c, r) && !Game.occupied(m, 1, c, r)) m.armies[r < Game.ROWS / 2 ? 1 : 0].push({ id: m.nextId[r < Game.ROWS / 2 ? 1 : 0]++, unit: ui('Brute'), col: c, row: r, round: 1, xp: 0, level: 0, cost: 100 });
  fresh(D);
  const ass = [0, 1].map(sd => { const q = { id: m.nextId[sd]++, unit: ui('Assassin'), col: t.col, row: t.row, round: m.round, xp: 0, level: 0, cost: 100 }; m.armies[sd].push(q); return q; });
  Duo.stampAll(D);
  Duo.settleBoard(D); // (the fight's start without the fight: four hundred squads)
  assert.ok(ass.every(q => q.col === t.col && q.row === t.row), 'both stay');
  assert.ok(D.settled.length >= 1 && D.settled.every(e => e.to === null), 'tried, no tile: ' + JSON.stringify(D.settled));
});

// ======================================= replays =======================================
check('the same result after a save and load, and from two replays of the same match', () => {
  const build = () => {
    const x = board(61), { D } = x;
    const t = { col: 12, row: 15 };
    place(x, 2, 'Assassin', t.col, t.row);
    vote(x, 0, 'oak', t);
    for (const R of D.lanes) Mpb.giveCard(R.m, 1, { type: 'mpb', id: 'magicLake' });
    const lb = Mpb.recs(x.m(0), 1).find(r => r.kind === 'magicLake' && r.data.lane === 1);
    assert.ok(x.act(3, 'mpbAct', lb.key, 'place', 11, 10).ok);
    return x;
  };
  const a = build(), b = build();
  const c = { ...b, D: Duo.load(copy(Duo.save(b.D)), units, matrix) };
  const fa = fight(a), fc = fight(c);
  assert.deepStrictEqual(a.D.settled, c.D.settled, 'the same moves');
  assert.deepStrictEqual(fa.f.posts.map(s => s.mpb), fc.f.posts.map(s => s.mpb), 'the same buildings after');
  assert.deepStrictEqual(fa.f.posts.map(s => s.armies), fc.f.posts.map(s => s.armies), 'the same squads after');
  assert.ok(a.D.settled.length >= 1, 'something moved');
  // (updated 6 Nov, answer 5: the Oak, on its own zone, stays; the Assassin moves. The Oak used to move)
  if (a.D.phase === 'result') {
    for (let k = 0; k < 4; k++) Duo.next(a.D, k, a.D.summary[0].round, T);
    const oak = Mpb.recs(a.m(0), 0).find(r => r.kind === 'oak'), q = a.m(0).armies[1].find(z => z.unit === ui('Assassin'));
    assert.deepStrictEqual([oak.col, oak.row], [12, 15], 'the next round: the Oak where it was voted');
    assert.ok(q && !(q.col === 12 && q.row === 15), 'the next round: the moved tile is the Assassin\'s real one');
    assert.deepStrictEqual([Duo.viewFor(a.D, 0).m.armies[1].find(z => z.id === q.id).col, Duo.viewFor(a.D, 0).m.armies[1].find(z => z.id === q.id).row], [q.col, q.row], 'for the opponents too');
  }
});

check('Undo all replays a teammate\'s placement onto a tile with a hidden thing of the other team as it was', () => {
  const x = board(62), { D } = x;
  for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' });
  const kb = put(D, 1, 'coalMine', { col: 11, row: 2 });
  for (const R of D.lanes) Mpb.queue(R.m, 1, 'coalMine', 'exit', kb);
  fresh(D); Duo.tick(D, T);
  assert.ok(x.act(2, 'mpbVote', 10, 10).ok && x.act(3, 'mpbVote', 10, 10).ok, 'B\'s exit at (10,9)');
  const la = Mpb.recs(x.m(0), 0).find(r => r.kind === 'magicLake' && r.data.lane === 1);
  assert.ok(try1(x, 1, 'mpbAct', la.key, 'place', 10, 10).ok, 'A2\'s water on it (hidden from A): page and server agree');
  place(x, 0, 'plain', 12, 15);
  assert.ok(x.act(0, 'undoAll').ok, 'A1 presses Undo all');
  assert.deepStrictEqual([Mpb.recOf(x.m(0), 0, la.key).col, Mpb.recOf(x.m(0), 0, la.key).row], [10, 10], 'A2\'s water is still there after the replay');
  const { P } = fight(x);
  assert.deepStrictEqual(recIn(P[0], 1, kb).parts.exit, { col: 10, row: 10 }, 'B\'s exit stays');
  assert.deepStrictEqual([recIn(P[0], 0, la.key).col, recIn(P[0], 0, la.key).row], [10, 10], 'A2\'s water stays on it (updated 6 Nov: it used to move off; now the exit is just blocked)');
});

// ======================================= review (side channels, what stands in a building, walls) =======================================
check('a hidden Grow never holds back a public vote: the opponents\' clock is held no longer than without it', () => {
  const run = (grow) => {
    const x = board(34), { D } = x;
    const k = put(D, 0, 'treeKojja'); fresh(D); Duo.tick(D, T);
    let seq = 100; const act = (seat, fn, now, ...a) => Duo.act(D, seat, { seq: ++seq, fn, a }, now);
    if (grow) assert.ok(act(1, 'mpbBuy', T, k, 'grow').ok, 'A2 buys Grow (hidden)');
    for (const R of D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'oak' }); // a card queued in the open after it
    Duo.tick(D, T);
    assert.strictEqual(Mpb.voteHead(x.m(0), 0).kind, 'oak', 'the public card heads the queue');
    const t = Mpb.autoSpot(x.m(0), 0, 'oak', null);
    assert.ok(act(0, 'mpbVote', T + 1000, t.col, t.row).ok, 'A1 votes on the card at once');
    const out = [];
    for (const dt of [1000, Mpb.VOTE_MS - 1, Mpb.VOTE_MS + 1, 2 * Mpb.VOTE_MS + 2]) { Duo.tick(D, T + dt); out.push([Duo.remainingFor(D, 2, T + dt) > 0, Duo.heldFor(D, 2), oppKey(D, 2)]); }
    return out;
  };
  assert.deepStrictEqual(run(true), run(false), 'B1\'s clock and view, second by second, the same with and without the hidden Grow');
  // and the real draft (round 9): Grow bought while the draft is open, the drafted card still goes ahead of it
  const q = Mpb.voteQueue({ mpbVote: [[{ kind: 'treeKojja', part: null, key: null, votes: [null, null], lane: 1, skill: true }], []] }, 0);
  const m = { mpbVote: [q, []], mpbSeen: [[], []] };
  Mpb.queue(m, 0, 'shadowDen');
  assert.deepStrictEqual(m.mpbVote[0].map(e => e.kind + (e.skill ? '*' : '')), ['shadowDen', 'treeKojja*'], 'Mpb.queue: an open entry before a skill\'s');
});

check('the server\'s own coins (vote, draft, settle, artifacts, Field dressing) come from D.secret, which no view holds', () => {
  const secret = 3141592653, seed = 5;
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, T, seed, [false, false, false, false], secret);
  assert.strictEqual(D.secret, secret);
  for (let k = 0; k < 4; k++) { const v = JSON.stringify(Duo.viewFor(D, k)); assert.ok(!v.includes(String(secret)), 'seat ' + k + '\'s view has no D.secret'); }
  assert.strictEqual(Duo.load(copy(Duo.save(D)), units, matrix).secret, secret, 'kept through save and load');
  // the artifacts of round 2: from the secret (the same seed, other secrets: other tiles; no secret: the seed, as before)
  const arts = (sec) => {
    const x = { D: Duo.create({}, units) };
    Duo.start(x.D, units, matrix, T, seed, [false, false, false, false], sec);
    const seq = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) Duo.act(x.D, k, { seq: ++seq[k] + 10, fn: 'choosePack', a: [0] }, T);
    playTo({ D: x.D }, 2);
    return JSON.stringify(x.D.lanes[0].m.artifacts && x.D.lanes[0].m.artifacts.list);
  };
  const none = arts(undefined), same = arts(seed), others = [1, 2, 3].map(arts);
  assert.strictEqual(none, same, 'no secret: the seed\'s streams, as before');
  assert.ok(others.some(a => a !== none), 'another secret: other artifacts (not worked out from m.seed)');
});

// (updated 6 Nov: the label used to read 'placing' while the team's own queue held the clock; no vote holds it now)
check('the page\'s clock label never reads a vote or the draft (they never hold the deploy clock)', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '../../src/site-template.html'), 'utf8');
  assert.ok(!/Mpb\.voteHead\(m, 0\) \|\| Mpb\.voteHead\(m, 1\)/.test(html), 'no label from both teams\' queues');
  assert.ok(!html.includes("? 'placing' :"), 'no \'placing\' label');
});

// (updated 6 Nov, answer 5 "prio in your own zone": the kojja, on its own zone, stays with its Nest squad and the
// Assassin moves; the kojja used to move, its squad with it. A building that moves still takes its squads with it:
// tools/tests/mpb-prio.js, no tile for the other team's thing)
check('a Nest\'s squad stays with its Tree kojja voted onto a hidden Assassin; the Assassin moves', () => {
  const x = board(71), { D } = x, m = x.m(0);
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'treeKojja');
  fresh(D); Duo.tick(D, T);
  const t = { col: 12, row: 15 };
  const ass = place(x, 2, 'Assassin', t.col, t.row);
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok, 'the kojja voted onto the hidden Assassin');
  const key = Mpb.recs(m, 0).find(r => r.kind === 'treeKojja').key;
  assert.ok(x.act(0, 'mpbBuy', key, 'nest').ok, 'Nest');
  const gi = ui('Mechite Guards');
  if (!Game.isUnlocked(m, 0, gi)) assert.ok(x.act(0, 'unlock', gi).ok);
  assert.ok(x.act(0, 'place', gi, t.col, t.row).ok, 'a ranged squad in the Nest');
  const sq = m.armies[0].slice(-1)[0];
  const { P } = fight(x);
  const k = recIn(P[0], 0, key), q = sqIn(P, 0, 0, sq.id), a = sqIn(P, 0, 1, ass.id);
  assert.deepStrictEqual([k.col, k.row], [t.col, t.row], 'the kojja stays');
  assert.deepStrictEqual([q.col, q.row], [k.col, k.row], 'its Nest squad with it');
  assert.ok(!(a.col === t.col && a.row === t.row) && !Game.nearBldg(P[0], 1, a.col, a.row), 'the Assassin moved off and away: ' + JSON.stringify([a.col, a.row]));
  assert.deepStrictEqual(D.settled.map(e => e.id), ['s0:1:' + ass.id], 'only the Assassin moved');
});

// (updated 6 Nov, answer 5: the School, on its own zone, stays; it used to move, its pupil with it)
check('a School voted onto a hidden Assassin stays with its pupil, and the pupil is on it the next round', () => {
  const x = board(72), { D } = x, m = x.m(0);
  const own = place(x, 0, 'plain', 10, 16);
  for (const R of D.lanes) Mpb.queue(R.m, 0, 'school');
  fresh(D); Duo.tick(D, T);
  const t = { col: 13, row: 15 };
  const ass = place(x, 2, 'Assassin', t.col, t.row);
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok && x.act(1, 'mpbVote', t.col, t.row).ok, 'the School voted onto the hidden Assassin');
  const key = Mpb.recs(m, 0).find(r => r.kind === 'school').key;
  assert.ok(x.act(0, 'mpbAct', key, 'enroll', own.id).ok, 'enrolled');
  const { P } = fight(x);
  const s = recIn(P[0], 0, key), q = sqIn(P, 0, 0, own.id);
  assert.deepStrictEqual([s.col, s.row], [t.col, t.row], 'the School stays');
  assert.deepStrictEqual([q.col, q.row], [s.col, s.row], 'its pupil with it');
  assert.ok(!(sqIn(P, 0, 1, ass.id).col === t.col && sqIn(P, 0, 1, ass.id).row === t.row), 'the Assassin moved');
  if (D.phase === 'result') {
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    const m2 = x.m(0), s2 = Mpb.recOf(m2, 0, key), q2 = m2.armies[0].find(z => z.id === own.id);
    assert.ok(q2.school && q2.col === s2.col && q2.row === s2.row, 'the next round: still in it, on its tile');
    teams(D);
    assert.ok(!Game.occupied(m2, 0, 10, 16), 'no phantom of the pupil on the tile it came from');
  }
});

check('Bastion walls: the page and the server agree on every edge (the other team\'s wall of this round doesn\'t count); both teams\' walls facing the middle row stay', () => {
  for (const aFirst of [true, false]) {
    const x = board(76, 4), { D } = x; // (round 4: no draft open, whose tower card would take the walls with the old tower)
    for (const R of D.lanes) { R.m.towers[0].type = 'bastion'; R.m.towers[1].type = 'bastion'; R.m.towerSkill = [1, 1]; R.m.towerSkill2 = [1, 1]; }
    fresh(D);
    const A = () => assert.ok(try1(x, 0, 'placeBwall', 12, 10, 'n').ok, 'A1\'s wall on (12,10) north');
    const B = () => assert.ok(try1(x, 2, 'placeBwall', 12, 8, 's').ok, 'B1\'s wall on (12,8) south, A\'s hidden (the middle row between them)');
    if (aFirst) { A(); B(); } else { B(); A(); }
    // every edge, both opponent seats: allowed on the page as on the server
    for (const seat of [2, 3]) {
      const sd = Duo.SEATS[seat].side, L = Duo.SEATS[seat].lane, pv = W(Duo.viewFor(D, seat).m);
      teams(D);
      for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) for (const e of ['n', 'e', 's', 'w'])
        assert.strictEqual(Mpb.asSeen(sd, () => Game.bwallSpotOk(x.m(L), sd, c, r, e)), Game.bwallSpotOk(pv, sd, c, r, e), 'seat ' + seat + ' ' + [c, r, e]);
    }
    const round = x.m(0).round;
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, T);
    const ws = [0, 1].map(sd => x.m(0).bwalls[sd].find(w => w.round === round));
    assert.ok(ws[0] && ws[1], 'both walls stand after the fight: ' + JSON.stringify(x.m(0).bwalls));
    // (before 2026-11-07 these two shared the edge between rows 8 and 9 and the newer moved; on the 19-row board the
    // middle row, where no wall stands, is between them: two teams' walls never share an edge, both stay)
    assert.deepStrictEqual([[ws[0].col, ws[0].row], [ws[1].col, ws[1].row]], [[12, 10], [12, 8]], 'both walls stay');
    assert.ok(!D.settled.some(e => e.id.startsWith('w')), 'no wall clash');
  }
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall hidden-until-the-fight checks passed');
