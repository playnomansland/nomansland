// Headless check of group B1's 2v2 buildings (src/mpb.js regions treeKojja and scorch, docs/mpb-notes/b1.md): no
// server needed.
//  Tree kojja: placement (the first: interior and spacing; Grow: within 3 tiles of a kojja, own zone, no spacing), its
//    fight unit (the Outpost's hit and attack speed, 20 m, stealth sight in range), Grow (once a round for the team,
//    placed by the buyer alone, take-backs, Undo all), Nest (a ranged squad of either player on it, not a melee one,
//    one at a time; in the fight one body inside with +3 m and stealth sight, the rest ride in it; out after 10 s
//    with no enemy in sight, or when the kojja falls), the downside (destroyed: it stands for the opponents the next
//    round, they may buy Nest on it and put a squad of theirs in it on the other board; then it comes back; squads
//    on it step out), take-backs (Nest not with a squad in it, Grow not once the new kojja has a buy; Undo all keeps
//    the keys of the records), hidden buys and placements, the page's copy hashing as the server's
//  Scorch turrets: the card (each player places their own, alone), the fight unit (one Ember Imp body, Spitfire burn,
//    instant shots, +10 m, 450 / 2, sees stealth at any distance, a structure), Blaze / Rapid fire / Legs (once per
//    turret; Legs: a unit that walks and must be killed to win), the downside (destroyed: sits out the next fight,
//    its skills lost), hidden buys, hashes
//  both: fights measured in real Duo fights, mirror symmetry when both teams have them, a full bot 2v2 to round 10
//    with both kinds forced in (no exception, team state equal, views in step, playback; the bots use the skills)
// Run: node tools/tests/mpb-b1.js
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
  if (D.phase !== 'end') assert.strictEqual(D.lanes[0].m.round, round, 'reached round ' + round);
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
// a building of kind on a tile (or the first allowed one) in both lanes, as if it stood when the round began
function put(D, sd, kind, t, data) {
  const m = D.lanes[0].m;
  t = t || Mpb.autoSpot(m, sd, kind, null);
  for (const R of D.lanes) { const r = Mpb.addRec(R.m, sd, kind, t.col, t.row); if (data) Object.assign(r.data, copy(data)); }
  const rec = Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1];
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(rec));
  return rec.key;
}
// a skill as already bought in an earlier round (both lanes and the round's base)
function owned(D, sd, key, id) {
  for (const st of [...D.lanes.map(R => R.m.mpb[sd]), D.tbase[sd] && D.tbase[sd].mpb]) { if (!st) continue; const r = st.find(q => q.key === key); r.skills[id] = { round: 0, n: 1, by: [1, 0], log: [] }; }
}
const mir = (t) => ({ col: Game.COLS - 1 - t.col, row: Game.ROWS - 1 - t.row });
const ui = (name) => units.findIndex(u => u.name === name);
const ENT = ui('Ent'), ARCH = ui('Skeleton Archers'), BRUTE = ui('Brute'), ROGUE = ui('Rogue'), IMPS = ui('Ember Imps');
const rich = (D) => { for (const R of D.lanes) R.m.gold = [5000, 5000]; };
const open = (x, seat, u) => { if (!Game.isUnlocked(x.m(Duo.SEATS[seat].lane), Duo.SEATS[seat].side, u)) assert.ok(x.act(seat, 'unlock', u).ok, 'unlock ' + units[u].name); };
// (from round 2 on: round 1's package squads would come back in the fight; no artifacts either)
const clearArmies = (D) => { assert.ok(D.lanes[0].m.round > 1, 'clearArmies: round 2 on'); for (const R of D.lanes) { R.m.armies = [[], []]; R.m.artifacts = null; } Duo.setTeams(D.lanes.map(R => R.m)); };
const fightOf = (D) => { const lanes = D.lanes.map(R => R.m); Duo.settle(lanes); for (const m of lanes) delete m.team; const bt = Duo.battle(lanes); return bt; };
const steps = (bt, secs) => { for (let k = 0; k < Math.round(secs / Game.SETTINGS.dt); k++) if (!bt.step()) return false; return true; };
const G0 = { ...Game.SETTINGS, bounds: { x0: -72, x1: 72, y0: -54, y1: 54 } };
// a plain body of unit u (no skills unless given) at (x, y)
const bodyOf = (u, side, x, y, sq, extra) => Engine.buildSquad(Engine.withTraits({ ...u, bodies: 1, ...(extra || {}) }), side, x, y, sq, Game.TILE, 0)[0];
// a body of side 0 far off that counts for the fight (a fight with only structures on a side is over at once)
const dummy = () => bodyOf({ ...units[BRUTE], speed: 0, hit: 0, hp: 1e6 }, 0, 70, -50, 99);
const stealthy = () => { const r = units[ROGUE], d = r.skillDefs.find(s => s && s.type === 'stealth'); const { skills, skillDefs, ...u } = Engine.applySkills(r, [d], units); return { ...u, speed: 0, hit: 0, hp: 2000 }; };

// =====================================================================
// Tree kojja
// =====================================================================
check('kojja: placement (first: interior + spacing; Grow: within 3, own zone, no spacing), its fight unit', () => {
  const x = match(101), m = x.m(0);
  Duo.setTeams(x.D.lanes.map(R => R.m));
  const first = Mpb.spots(m, 0, 'treeKojja', null);
  assert.ok(first.length > 10, 'room for the first kojja');
  for (const t of first) assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row), 'the first: interior and spaced ' + JSON.stringify(t));
  const key = put(x.D, 0, 'treeKojja'), rec = Mpb.recOf(m, 0, key);
  const grow = Mpb.spots(m, 0, 'treeKojja', null);
  assert.ok(grow.length > 5, 'room to grow');
  for (const t of grow) {
    assert.ok(Math.max(Math.abs(t.col - rec.col), Math.abs(t.row - rec.row)) <= 3, 'within 3 tiles');
    assert.ok(Game.inZone(0, t.row) && !Game.reserved(0, t.col, t.row), 'own zone, not a reserved flank tile');
  }
  assert.ok(grow.some(t => !Mpb.spaced(m, t.col, t.row)), 'no 2-tile spacing for a grown one');
  assert.ok(!Mpb.spotOk(m, 1, 'treeKojja', null, rec.col, Game.ROWS - 1 - rec.row) || Mpb.recs(m, 1).length === 1, 'the other team: its own first one');
  // the fight unit
  const u = Mpb.unitOf(m, 0, rec);
  assert.deepStrictEqual([u.hp, u.hit, u.aps, u.range, u.trueSight, u.structure, u.lesser, u.mpb, u.defVal || 0], [500, Game.OUTPOST.unit.hit, Game.OUTPOST.unit.aps, 20, true, true, true, 'treeKojja', 0]);
});

check('kojja: shoots like the Outpost and sees a stealthed unit within its 20 m (not beyond, not without its sight)', () => {
  const ku = Mpb.kojjaUnit(), r = stealthy();
  const run = (kv, dist) => {
    const k = bodyOf(kv, 0, 0, 0, -700), f = bodyOf(r, 1, 0, dist, 1);
    const bt = Engine.createBattle([k, dummy()], [f], G0, {});
    steps(bt, 6);
    return 2000 - f.hp;
  };
  assert.ok(run(ku, 15) > 0, 'a stealthed Rogue 15 m off is shot');
  assert.strictEqual(run(ku, 26), 0, 'not one 26 m off');
  assert.strictEqual(run({ ...ku, trueSight: false }, 15), 0, 'without its sight it can\'t pick it');
  // its damage per second is the Outpost's
  const plain = { ...r, stealth: false };
  const k = bodyOf(ku, 0, 0, 0, -700), f = bodyOf(plain, 1, 0, 15, 1), o = bodyOf({ ...Game.OUTPOST.unit, range: 20 }, 0, 0, 0, -2), f2 = bodyOf(plain, 1, 0, 15, 1);
  const a = Engine.createBattle([k, dummy()], [f], G0, {}), b = Engine.createBattle([o, dummy()], [f2], G0, {});
  steps(a, 10); steps(b, 10);
  assert.ok(Math.abs(f.hp - f2.hp) < 1e-6, 'the same damage as an Outpost with 20 m: ' + (2000 - f.hp));
});

check('kojja: Grow once a round for the team, the buyer places it alone, take-backs, Undo all, hidden from the opponents', () => {
  const x = match(102), { D } = x; rich(D);
  const k1 = put(D, 0, 'treeKojja'), m0 = x.m(0), m1 = x.m(1);
  Duo.setTeams(D.lanes.map(R => R.m));
  assert.ok(x.act(1, 'mpbBuy', k1, 'grow').ok, 'A2 buys Grow');
  assert.strictEqual(m1.gold[0], 5000 - Mpb.KOJJA.growCost, 'A2 paid'); assert.strictEqual(m0.gold[0], 5000, 'A1 didn\'t');
  const head = Mpb.voteHead(m0, 0);
  assert.ok(head && head.kind === 'treeKojja' && head.lane === 1, 'a placement only A2 makes');
  sameTeam(D, 0);
  assert.ok(!x.act(0, 'mpbBuy', k1, 'grow').ok, 'once a round for the team');
  assert.strictEqual(Duo.viewFor(D, 2).m.mpbVote[0].length, 0, 'nor the placement it queued');
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, k1).skills.grow, 'the opponents don\'t see the buy');
  const spots = Mpb.spots(m1, 0, 'treeKojja', null), t = spots[2];
  assert.ok(!x.act(0, 'mpbVote', t.col, t.row).ok, 'A1 can\'t place A2\'s kojja');
  assert.ok(x.act(1, 'mpbVote', t.col, t.row).ok, 'A2 places it');
  const recs = Mpb.recs(m0, 0).filter(r => r.kind === 'treeKojja');
  assert.strictEqual(recs.length, 2, 'two kojjas');
  const k2 = recs[1].key;
  assert.deepStrictEqual([recs[1].col, recs[1].row, recs[1].data.lane], [t.col, t.row, 1], 'placed at once where A2 tapped');
  assert.ok(!Duo.mpbPending(D), 'nothing pending');
  sameTeam(D, 0);
  assert.ok(!x.act(0, 'mpbBuy', k2, 'grow').ok, 'not again this round, on the new one either');
  // A2 takes it back: the new kojja goes (its tile is free again), the gold comes back
  assert.ok(!x.act(0, 'mpbUndo', k1, 'grow').ok, 'A1 can\'t take back A2\'s Grow');
  assert.ok(x.act(1, 'mpbUndo', k1, 'grow').ok);
  assert.strictEqual(m1.gold[0], 5000);
  assert.ok(Mpb.recOf(m0, 0, k2).away && !Game.mpbAt(m0, t.col, t.row), 'the grown kojja is gone, its tile free');
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, k2), 'the opponents don\'t see a kojja grown and taken back');
  sameTeam(D, 0);
  // taken back before it was placed: the placement goes too
  assert.ok(x.act(0, 'mpbBuy', k1, 'grow').ok && Mpb.voteHead(m0, 0).lane === 0);
  assert.ok(x.act(0, 'mpbUndo', k1, 'grow').ok && !Mpb.voteHead(m0, 0), 'the placement is gone');
  // the clock: nobody taps: the first allowed tile after 15 s
  assert.ok(x.act(0, 'mpbBuy', k1, 'grow').ok);
  Duo.tick(D, x.T); assert.ok(!Duo.mpbPending(D) && Mpb.voteHead(m0, 0) && Duo.clocks(D, 0, x.T).vote > 0, 'its own 15 s; the deploy clock doesn\'t wait (hidden from the opponents, review 2026-11-06)');
  Duo.tick(D, x.T + Mpb.VOTE_MS);
  const g3 = Mpb.recs(m1, 0).filter(r => r.kind === 'treeKojja' && !r.away);
  assert.strictEqual(g3.length, 2, 'placed by the clock');
  assert.ok(Math.max(Math.abs(g3[1].col - g3[0].col), Math.abs(g3[1].row - g3[0].row)) <= 3);
  sameTeam(D, 0);
  // Undo all by A1: their Grow (and its kojja) go
  assert.ok(x.act(0, 'undoAll').ok);
  assert.strictEqual(Mpb.recs(x.m(1), 0).filter(r => r.kind === 'treeKojja' && !r.away).length, 1, 'Undo all: back to one kojja');
  assert.strictEqual(x.m(0).gold[0], 5000);
  sameTeam(D, 0);
  // next round Grow is open again
  playTo(x, 2); rich(D);
  assert.ok(Mpb.canBuy(x.m(0), 0, k1, 'grow'), 'a new round: Grow again');
});

check('kojja: Nest holds one ranged squad of either player (not a melee one), moved in or placed', () => {
  const x = match(103), { D } = x; rich(D);
  const k1 = put(D, 0, 'treeKojja'), rec = Mpb.recOf(x.m(0), 0, k1);
  open(x, 0, ARCH); open(x, 1, ARCH); open(x, 0, BRUTE);
  assert.ok(!x.act(0, 'place', ARCH, rec.col, rec.row).ok, 'no Nest: nobody on it');
  assert.ok(x.act(1, 'mpbBuy', k1, 'nest').ok, 'A2 buys Nest');
  assert.ok(!x.act(1, 'mpbBuy', k1, 'nest').ok, 'once per kojja');
  assert.ok(!x.act(0, 'place', BRUTE, rec.col, rec.row).ok, 'a melee squad can\'t go in');
  assert.ok(x.act(0, 'place', ARCH, rec.col, rec.row).ok, 'A1\'s Skeleton Archers go in');
  assert.ok(!x.act(1, 'place', ARCH, rec.col, rec.row).ok, 'one squad at a time (the teammate can\'t add one)');
  assert.ok(Game.garrisonAt(x.m(0), 0, rec.col, rec.row) && Game.inBuilding(x.m(0), 0, x.m(0).armies[0].find(q => q.col === rec.col && q.row === rec.row)), 'Game sees it in a building');
  // the opponents don't see this round's Nest
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, k1).skills.nest, 'Nest hidden from B1');
  assert.ok(!Game.garrisonFree(W(Duo.viewFor(D, 3).m), 1, rec.col, rec.row, ARCH), 'never theirs to use');
  // A1 takes the squad back, A2 moves one of theirs in (from an earlier round: a paid move)
  assert.ok(x.act(0, 'unplaceSquad', x.m(0).armies[0].find(q => q.col === rec.col && q.row === rec.row).id).ok);
  const t = Mpb.spots(x.m(1), 0, 'oak', null).find(s => !Game.occupied(x.m(1), 0, s.col, s.row));
  assert.ok(x.act(1, 'place', ARCH, t.col, t.row).ok);
  const id = x.m(1).armies[0].find(q => q.col === t.col && q.row === t.row).id;
  assert.ok(x.act(1, 'moveSquad', id, rec.col, rec.row).ok, 'A2 moves their archers in');
  sameTeam(D, 0);
});

check('kojja take-backs: not Nest with a squad in it, not Grow once the new kojja has a buy; Undo all keeps those, paid', () => {
  const x = match(104), { D } = x; rich(D);
  const k1 = put(D, 0, 'treeKojja'), rec = Mpb.recOf(x.m(0), 0, k1);
  open(x, 0, ARCH); open(x, 1, ARCH);
  assert.ok(x.act(1, 'mpbBuy', k1, 'nest').ok, 'A2 buys Nest');
  assert.ok(x.act(0, 'place', ARCH, rec.col, rec.row).ok, 'A1\'s archers go in');
  assert.ok(!x.act(1, 'mpbUndo', k1, 'nest').ok, 'A2 can\'t take Nest back with a squad in it');
  assert.ok(!Mpb.canUndo(W(Duo.viewFor(D, 1).m), 0, k1, 'nest'), 'the page agrees (no Undo button)');
  const g1 = x.m(0).gold[0];
  assert.ok(x.act(1, 'undoAll').ok, 'A2\'s Undo all');
  assert.ok(Mpb.skillN(Mpb.recOf(x.m(0), 0, k1), 'nest') === 1 && Game.garrisonAt(x.m(0), 0, rec.col, rec.row), 'the Nest stays (the squad is in it)');
  assert.strictEqual(x.m(1).gold[0], 5000 - Mpb.KOJJA.nestCost, 'and stays paid for by A2');
  assert.strictEqual(x.m(0).gold[0], g1, 'A1\'s gold untouched');
  sameTeam(D, 0);
  assert.ok(x.act(1, 'undoAll').ok, 'again: the same');
  assert.strictEqual(x.m(1).gold[0], 5000 - Mpb.KOJJA.nestCost);
  sameTeam(D, 0);
  // A1 takes their squad out: now the Nest can go
  assert.ok(x.act(0, 'unplaceSquad', x.m(0).armies[0].find(q => q.col === rec.col && q.row === rec.row).id).ok);
  assert.ok(x.act(1, 'undoAll').ok);
  assert.ok(!Mpb.skillN(Mpb.recOf(x.m(0), 0, k1), 'nest') && x.m(1).gold[0] === 5000, 'Undo all takes it back now, gold back');
  assert.ok(x.act(1, 'mpbBuy', k1, 'nest').ok && x.act(1, 'mpbUndo', k1, 'nest').ok && x.m(1).gold[0] === 5000, 'a plain take-back too');
  sameTeam(D, 0);
  // Grow: A1 grows a kojja, A2 buys Nest on it: A1 can't take Grow back (A2's 50 would be stuck on a kojja that is gone)
  assert.ok(x.act(0, 'mpbBuy', k1, 'grow').ok);
  const t = Mpb.spots(x.m(0), 0, 'treeKojja', null)[0];
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok);
  const k2 = Mpb.recs(x.m(0), 0).find(r => r.kind === 'treeKojja' && r.data.lane === 0).key;
  assert.ok(x.act(1, 'mpbBuy', k2, 'nest').ok, 'A2 buys Nest on the new kojja');
  assert.ok(!x.act(0, 'mpbUndo', k1, 'grow').ok, 'Grow can\'t be taken back now');
  assert.ok(x.act(0, 'undoAll').ok);
  assert.ok(!Mpb.recOf(x.m(1), 0, k2).away && Mpb.skillN(Mpb.recOf(x.m(1), 0, k2), 'nest') === 1, 'Undo all: the kojja and A2\'s Nest stay');
  assert.strictEqual(x.m(0).gold[0], 5000 - Mpb.KOJJA.growCost, 'and A1 still pays for it');
  assert.ok(x.act(1, 'mpbUndo', k2, 'nest').ok && x.m(1).gold[0] === 5000, 'A2 takes theirs back');
  assert.ok(x.act(0, 'mpbUndo', k1, 'grow').ok && x.m(0).gold[0] === 5000 && Mpb.recOf(x.m(0), 0, k2).away, 'then Grow goes');
  sameTeam(D, 0);
});

check('kojja: Undo all of a Grow keeps the records\' keys (the teammate\'s buys on later buildings stay on them)', () => {
  const x = match(5), { D } = x;
  playTo(x, 2);
  const k1 = put(D, 0, 'treeKojja');
  playTo(x, 3, () => { for (const R of D.lanes) R.m.artifacts.list.forEach((a, i) => { a.won = 0; a.card = i === 0 ? { type: 'mpb', id: 'scorch' } : { type: 'tower', id: 'keep' }; }); });
  if (D.phase === 'end') return;
  rich(D); Duo.setTeams(D.lanes.map(R => R.m));
  assert.ok(Mpb.draftTurn(x.m(0), 0), 'team A picks');
  assert.ok(x.act(0, 'mpbBuy', k1, 'grow').ok);
  const t = Mpb.spots(x.m(0), 0, 'treeKojja', null)[0];
  assert.ok(x.act(0, 'mpbVote', t.col, t.row).ok, 'A1 grows a kojja');
  assert.ok(x.act(0, 'draftPick', 0).ok, 'A1 picks the Scorch card');
  for (const L of [1, 0]) { const s = Mpb.spots(x.m(L), 0, 'scorch', null)[0]; assert.ok(x.act(L, 'mpbVote', s.col, s.row).ok, 'lane ' + L + ' places its turret'); }
  const keys = (m) => Mpb.recs(m, 0).map(r => r.key + ':' + (r.data.lane == null ? '' : r.data.lane));
  const before = keys(x.m(1));
  const a2 = Mpb.recs(x.m(1), 0).find(r => r.kind === 'scorch' && r.data.lane === 1).key;
  assert.ok(x.act(1, 'mpbBuy', a2, 'blaze').ok, 'A2 buys Blaze on their turret');
  assert.ok(x.act(0, 'undoAll').ok, 'A1\'s Undo all');
  const after = Mpb.recs(x.m(1), 0);
  assert.deepStrictEqual(keys(x.m(1)), before, 'the same records under the same keys');
  assert.ok(after.find(r => r.kind === 'treeKojja' && r.data.lane === 0).away, 'the grown kojja: taken back');
  assert.ok(Mpb.skillN(Mpb.recOf(x.m(1), 0, a2), 'blaze') === 1 && Mpb.canUndo(x.m(1), 0, a2, 'blaze'), 'Blaze is still on A2\'s turret, theirs to take back');
  assert.strictEqual(x.m(0).gold[0], 5000, 'A1 has their 100 back');
  sameTeam(D, 0);
  assert.ok(x.act(1, 'undoAll').ok, 'then A2\'s Undo all');
  assert.deepStrictEqual(keys(x.m(0)), before, 'still the same keys');
  assert.ok(x.m(1).gold[0] === 5000 && x.m(0).gold[0] === 5000 && !Mpb.skillN(Mpb.recOf(x.m(0), 0, a2), 'blaze'));
  sameTeam(D, 0);
});

// a match with a kojja of team 0 (Nest bought earlier) and Skeleton Archers of A1 in it, nothing else on the board
function nested(seed, extra) {
  const x = match(seed), { D } = x; playTo(x, 2); rich(D);
  const k1 = put(D, 0, 'treeKojja'); owned(D, 0, k1, 'nest');
  clearArmies(D); open(x, 0, ARCH);
  const rec = Mpb.recOf(x.m(0), 0, k1);
  assert.ok(x.act(0, 'place', ARCH, rec.col, rec.row).ok, 'archers in the kojja');
  open(x, 3, ENT); // a slow Ent squad of B2's at the far back, so the fight goes on (a side with nothing that counts loses at once)
  assert.ok(x.act(3, 'place', ENT, 2, 0).ok || x.act(3, 'place', ENT, 3, 0).ok, 'a far Ent squad');
  if (extra) extra(x, rec);
  Duo.setTeams(D.lanes.map(R => R.m));
  return { x, k1, rec };
}

check('kojja Nest in a fight: one body inside (+3 m, stealth sight), the rest ride in it; out after 10 s unseen, all bodies', () => {
  const { x, rec } = nested(104);
  const sq = x.m(0).armies[0].find(q => q.col === rec.col && q.row === rec.row);
  const bt = fightOf(x.D);
  const host = bt.bodies.find(b => b.u.mpb === 'treeKojja' && b.side === 0), mine = bt.bodies.filter(b => b.squad === sq.id && b.side === 0);
  assert.strictEqual(mine.length, units[ARCH].bodies, 'the whole squad is in the fight');
  const lead = mine.find(b => b.inside === host), rest = mine.filter(b => b !== lead);
  assert.ok(lead, 'one body inside the kojja');
  assert.ok(rest.every(b => b.boarded && !b.alive && b.carrier === lead), 'the others ride in it (they don\'t shoot)');
  const base = rest[0].u.range; // (the 2v2 board tunes ranges: the squad's own fight range)
  assert.strictEqual(lead.u.range, base + 3, '+3 m'); assert.ok(lead.u.trueSight, 'sees stealth');
  assert.ok(!bt.bodies.some(b => b.u.kind === 'watchtower'), 'no watchtower of its own');
  // nobody in sight: it steps out after WATCH_IDLE s, with all its bodies
  let t = 0; while (lead.inside && t < 20) { steps(bt, 0.05); t += 0.05; }
  assert.ok(!lead.inside && Math.abs(t - Engine.WATCH_IDLE) < 0.3, 'out after ~10 s: ' + t.toFixed(2));
  assert.ok(mine.every(b => b.alive && !b.boarded), 'all its bodies out');
  assert.strictEqual(lead.u.range, base, 'its range is its own again'); assert.ok(!lead.u.trueSight);
});

check('kojja Nest in a fight: shoots from inside at an enemy in reach, steps out when the kojja falls; the squad counts for the round', () => {
  const { x, rec } = nested(105);
  const sq = x.m(0).armies[0].find(q => q.col === rec.col && q.row === rec.row);
  const bt = fightOf(x.D);
  const host = bt.bodies.find(b => b.u.mpb === 'treeKojja' && b.side === 0), mine = bt.bodies.filter(b => b.squad === sq.id && b.side === 0);
  const lead = mine.find(b => b.inside === host);
  steps(bt, 3);
  assert.ok(lead.inside === host, 'still inside');
  // the kojja falls: out at once, all bodies
  host.hp = 0; host.alive = false;
  steps(bt, 0.1);
  assert.ok(!lead.inside && mine.every(b => b.alive && !b.boarded), 'out when the kojja falls');
  // a whole fight: the squad counts (alive in the result)
  const bt2 = fightOf(x.D); while (bt2.step()) {}
  const r = bt2.result().squads['0:' + sq.id];
  assert.ok(r && r.total === units[ARCH].bodies, 'its bodies are in the result');
});

check('kojja Nest: the measured fight effect: the squad in it is safe until the kojja falls (real Duo fight)', () => {
  // the same archers on the kojja tile, with and without Nest, against a Brute squad walking in
  const run = (nest) => {
    const x = match(106), { D } = x; playTo(x, 2); rich(D);
    const k1 = put(D, 0, 'treeKojja'); if (nest) owned(D, 0, k1, 'nest');
    clearArmies(D); open(x, 0, ARCH); open(x, 2, BRUTE);
    const rec = Mpb.recOf(x.m(0), 0, k1);
    const t = nest ? rec : { col: rec.col + 1, row: rec.row };
    assert.ok(x.act(0, 'place', ARCH, t.col, t.row).ok, 'archers');
    assert.ok(x.act(2, 'place', BRUTE, rec.col, 6).ok, 'a Brute squad');
    const id = x.m(0).armies[0][0].id, bt = fightOf(D), mine = bt.bodies.filter(b => b.side === 0 && b.squad === id);
    let clock = 0, hurt = null;
    while (bt.step()) { clock += Game.SETTINGS.dt; if (hurt == null && mine.some(b => b.alive && b.hp < b.u.hp - 1e-6 || (!b.alive && !b.boarded))) hurt = clock; }
    const arch = bt.result().squads['0:' + id];
    return { dealt: arch.dealt, alive: arch.alive, hurt: hurt == null ? clock : hurt };
  };
  const a = run(true), b = run(false);
  console.log(`      archers in a kojja: dealt ${Math.round(a.dealt)}, alive ${a.alive}, first hurt at ${a.hurt.toFixed(1)} s; next to it: dealt ${Math.round(b.dealt)}, alive ${b.alive}, first hurt at ${b.hurt.toFixed(1)} s`);
  assert.ok(a.dealt > 0, 'it shoots from the kojja');
  assert.ok(a.hurt > b.hurt + 1, 'safe inside while the kojja stands: hurt later');
});

check('kojja downside: destroyed -> next round it stands for the opponents (Nest, their squad on our board), then back; squads step out', () => {
  const x = match(107), { D } = x; playTo(x, 2); rich(D);
  const k1 = put(D, 0, 'treeKojja'); owned(D, 0, k1, 'nest');
  clearArmies(D); open(x, 0, ARCH);
  const rec0 = Mpb.recOf(x.m(0), 0, k1), T = { col: rec0.col, row: rec0.row };
  assert.ok(x.act(0, 'place', ARCH, T.col, T.row).ok, 'A1\'s archers in it');
  // round 2's fight: the kojja falls (set as the fight's result would)
  playTo(x, 3, (DD) => { for (const R of DD.lanes) Mpb.recOf(R.m, 0, k1).fell = 2; });
  const m = x.m(0), rec = Mpb.recOf(m, 0, k1), gh = Mpb.recs(m, 1).find(r => r.kind === 'treeKojja');
  assert.ok(rec.away && rec.data.turned === 3, 'the kojja is away for team A this round');
  assert.ok(gh && gh.data.ghost === k1 && gh.col === T.col && gh.row === T.row && !gh.away, 'it stands for team B, on the same tile');
  assert.strictEqual(Mpb.skillN(gh, 'nest'), 1, 'with the Nest team A bought');
  for (const L of [0, 1]) for (const sd of [0, 1]) sameTeam(D, sd);
  const arch = x.m(0).armies[0].find(q => q.unit === ARCH);
  assert.ok(arch && !(arch.col === T.col && arch.row === T.row) && Game.inZone(0, arch.row), 'A1\'s archers stepped out to a tile of their zone: ' + JSON.stringify([arch.col, arch.row]));
  // its body fights for team B
  Duo.setTeams(D.lanes.map(R => R.m));
  let bt = fightOf(D);
  const kb = bt.bodies.filter(b => b.u.mpb === 'treeKojja');
  assert.ok(kb.length === 1 && kb[0].side === 1, 'one kojja body, on team B\'s side');
  // team B puts a ranged squad of theirs in it (on team A's board); team A can't
  rich(D); open(x, 3, ARCH); open(x, 1, ARCH);
  assert.ok(Game.garrisonFree(x.m(1), 1, T.col, T.row, ARCH), 'B2 may put archers in it');
  assert.ok(!x.act(1, 'place', ARCH, T.col, T.row).ok, 'A2 can\'t (it is theirs this round)');
  assert.ok(x.act(3, 'place', ARCH, T.col, T.row).ok, 'B2 places archers in it, on team A\'s board');
  Duo.setTeams(D.lanes.map(R => R.m));
  bt = fightOf(D);
  const bq = x.m(1).armies[1].find(q => q.col === T.col && q.row === T.row);
  const host = bt.bodies.find(b => b.u.mpb === 'treeKojja'), lead = bt.bodies.find(b => b.inside === host);
  assert.ok(lead && lead.side === 1 && Duo.unmap(lead.squad) === bq.id, 'B2\'s archers sit in it in the fight');
  // a ghost destroyed is nothing special; the round after the kojja is team A's again and B2's squad steps out
  playTo(x, 4);
  const m3 = x.m(0), r3 = Mpb.recOf(m3, 0, k1), g3 = Mpb.recs(m3, 1).find(r => r.kind === 'treeKojja');
  assert.ok(!r3.away && g3.away, 'back with team A');
  assert.strictEqual(Mpb.skillN(r3, 'nest'), 1, 'its Nest is still there');
  const bq3 = x.m(1).armies[1].find(q => q.id === bq.id);
  if (bq3) assert.ok(!(bq3.col === T.col && bq3.row === T.row) && Game.inZone(1, bq3.row), 'B2\'s archers stepped out to their own zone: ' + JSON.stringify([bq3.col, bq3.row]));
  Duo.setTeams(D.lanes.map(R => R.m));
  bt = fightOf(D);
  assert.ok(bt.bodies.filter(b => b.u.mpb === 'treeKojja').every(b => b.side === 0), 'it fights for team A again');
  for (const sd of [0, 1]) sameTeam(D, sd);
  // destroyed again later: the same stand-in is used again
  playTo(x, 5, (DD) => { for (const R of DD.lanes) Mpb.recOf(R.m, 0, k1).fell = 4; });
  assert.strictEqual(Mpb.recs(x.m(0), 1).filter(r => r.kind === 'treeKojja').length, 1, 'one stand-in per kojja');
  assert.ok(!Mpb.recs(x.m(0), 1).find(r => r.kind === 'treeKojja').away);
});

check('kojja downside: the opponents buy Nest on a turned kojja (theirs only while it stands for them, hidden from its owners)', () => {
  const x = match(109), { D } = x; playTo(x, 2);
  const k1 = put(D, 0, 'treeKojja');
  playTo(x, 3, (DD) => { for (const R of DD.lanes) Mpb.recOf(R.m, 0, k1).fell = 2; });
  rich(D);
  const gh = Mpb.recs(x.m(0), 1).find(r => r.kind === 'treeKojja');
  assert.ok(gh && Mpb.skillN(gh, 'nest') === 0, 'no Nest came with it');
  assert.ok(!x.act(0, 'mpbBuy', k1, 'nest').ok && !x.act(1, 'mpbBuy', k1, 'grow').ok, 'its owners can\'t buy on their kojja while it stands for the other team');
  assert.ok(!x.act(2, 'mpbBuy', gh.key, 'grow').ok, 'nor Grow from it (it isn\'t theirs)');
  assert.ok(x.act(2, 'mpbBuy', gh.key, 'nest').ok, 'B1 buys Nest on it');
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 0).m, 1, gh.key).skills.nest, 'hidden from team A');
  assert.ok(!Game.garrisonFree(W(Duo.viewFor(D, 0).m), 0, gh.col, gh.row, ARCH), 'team A can\'t use it');
  playTo(x, 4);
  assert.ok(!Mpb.recOf(x.m(0), 0, k1).skills.nest, 'the Nest team B bought stays with the stand-in: the kojja comes back without it');
  playTo(x, 5, (DD) => { for (const R of DD.lanes) Mpb.recOf(R.m, 0, k1).fell = 4; });
  if (D.phase !== 'end') assert.strictEqual(Mpb.skillN(Mpb.recs(x.m(0), 1).find(r => r.kind === 'treeKojja'), 'nest'), 0, 'turned again: it comes as its owners have it');
});

check('kojja: the page\'s copy hashes as the server\'s (Grow, its placement, Nest, a squad in it, the opponents\' Nest on a turned one)', () => {
  const x = match(108), { D } = x; rich(D);
  const k1 = put(D, 0, 'treeKojja');
  open(x, 0, ARCH); open(x, 1, ARCH); open(x, 2, ARCH); open(x, 3, ARCH);
  const try1 = (seat, fn, ...a) => {
    const sd = Duo.SEATS[seat].side, pm = W(Duo.viewFor(D, seat).m);
    const local = Game[fn](pm, sd, ...a), r = x.act(seat, fn, ...a);
    assert.strictEqual(!!local, !!r.ok, fn + ' allowed on the page as on the server');
    if (r.ok) { assert.strictEqual(Ref.sideHash(Duo.viewFor(D, seat).m, sd), r.h); assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s own copy'); }
    return r;
  };
  const rec = Mpb.recOf(x.m(0), 0, k1);
  assert.ok(try1(0, 'mpbBuy', k1, 'nest').ok);
  assert.ok(try1(1, 'place', ARCH, rec.col, rec.row).ok);
  assert.ok(try1(0, 'mpbBuy', k1, 'grow').ok);
  const t = Mpb.spots(x.m(0), 0, 'treeKojja', null)[1];
  assert.ok(!try1(1, 'mpbVote', t.col, t.row).ok, 'the teammate can\'t place it (page and server agree)');
  assert.ok(try1(0, 'mpbVote', t.col, t.row).ok);
  assert.ok(try1(0, 'mpbUndo', k1, 'grow').ok);
  for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
  // a turned one: team B buys Nest on it and puts a squad in it
  playTo(x, 4, (DD) => { for (const R of DD.lanes) Mpb.recOf(R.m, 0, k1).fell = 3; });
  rich(D);
  const gh = Mpb.recs(x.m(0), 1).find(r => r.kind === 'treeKojja');
  assert.ok(gh && !gh.away);
  assert.ok(!try1(2, 'mpbBuy', gh.key, 'nest').ok, 'the Nest came with it (once per kojja): page and server agree');
  assert.ok(try1(3, 'place', ARCH, gh.col, gh.row).ok, 'B2 in it, page and server agree');
  for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
});

// =====================================================================
// Scorch turrets
// =====================================================================
// a match played to round 3 with team 0 dealt the Scorch turrets card
function scorchMatch(seed, bots = [false, false, false, false]) {
  const x = match(seed, bots);
  playTo(x, 2);
  playTo(x, 3, (D) => { for (const R of D.lanes) R.m.artifacts.list.forEach((a, i) => { a.won = i; if (i === 0) a.card = { type: 'mpb', id: 'scorch' }; else if (a.card.type === 'mpb' && a.card.id === 'scorch') a.card = { type: 'tower', id: 'keep' }; }); });
  return x;
}

check('scorch: the card gives each player a turret they place alone, in either order (interior, spacing); bots place theirs at once', () => {
  const x = scorchMatch(201), { D } = x, m = x.m(0);
  if (D.phase === 'end') return;
  const q = Mpb.voteQueue(m, 0);
  assert.deepStrictEqual(q.map(e => [e.kind, e.lane]), [['scorch', 0], ['scorch', 1]], 'two placements, one each');
  Duo.setTeams(D.lanes.map(R => R.m));
  const s0 = Mpb.spots(m, 0, 'scorch', null);
  for (const t of s0) assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row));
  // A2 places theirs first (nobody waits for the other); then A1
  const clk = D.mclock.vote[0] && D.mclock.vote[0].until;
  assert.ok(x.act(1, 'mpbVote', s0[0].col, s0[0].row).ok, 'A2 places theirs without waiting for A1');
  assert.strictEqual(D.mclock.vote[0].until, clk, 'A1\'s 15 s go on');
  assert.ok(Mpb.voteEntry(x.m(0), 0, 0) && !Mpb.voteEntry(x.m(1), 0, 1), 'A1\'s still to place, A2 has none left');
  const s1 = Mpb.spots(x.m(0), 0, 'scorch', null);
  assert.ok(!x.act(1, 'mpbVote', s1[0].col, s1[0].row).ok, 'A2 can\'t place A1\'s');
  assert.ok(x.act(0, 'mpbVote', s1[0].col, s1[0].row).ok, 'A1 places theirs');
  assert.ok(!x.act(0, 'mpbVote', s1[1].col, s1[1].row).ok, 'one each');
  const tur = Mpb.recs(x.m(1), 0).filter(r => r.kind === 'scorch');
  assert.deepStrictEqual(tur.map(r => r.data.lane), [1, 0], 'one each, whose is kept');
  assert.ok(Math.max(Math.abs(tur[0].col - tur[1].col), Math.abs(tur[0].row - tur[1].row)) >= Mpb.SPACING, 'spaced from each other');
  sameTeam(D, 0);
  // bots: placed before anyone waits
  const y = scorchMatch(202, [false, true, true, true]);
  if (y.D.phase === 'end') return;
  const h = Mpb.voteHead(y.m(0), 0);
  assert.ok(h && h.lane === 0 && Mpb.voteQueue(y.m(0), 0).length === 1, 'the bot (A2) placed its own at once; the human\'s is left');
  assert.deepStrictEqual(Mpb.recs(y.m(0), 0).filter(r => r.kind === 'scorch').map(r => r.data.lane), [1]);
  Duo.setTeams(y.D.lanes.map(R => R.m));
  const t0 = Mpb.autoSpot(y.m(0), 0, 'scorch', null);
  assert.ok(y.act(0, 'mpbVote', t0.col, t0.row).ok);
  assert.strictEqual(Mpb.recs(y.m(0), 0).filter(r => r.kind === 'scorch').length, 2, 'then the human\'s');
  const z = match(203); z.D.tbase[0] = Duo.teamState(z.D.lanes[0].m, 0);
  for (const R of z.D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'scorch' });
  Duo.tick(z.D, z.T); Duo.tick(z.D, z.T + Mpb.VOTE_MS);
  Duo.tick(z.D, z.T + 2 * Mpb.VOTE_MS + 10);
  assert.strictEqual(Mpb.recs(z.m(0), 0).filter(r => r.kind === 'scorch').length, 2, 'nobody taps: placed by the clock, one after the other');
});

check('scorch: its fight unit (one Ember Imp body, Spitfire, instant, +10 m, 450 / 2, a structure) and its skills', () => {
  const x = match(204), { D } = x; rich(D);
  const a = put(D, 0, 'scorch', null, { lane: 0 }), b = put(D, 0, 'scorch', null, { lane: 1 });
  const m = x.m(0), imp = units[IMPS], ra = Mpb.recOf(m, 0, a);
  let u = Mpb.unitOf(m, 0, ra);
  assert.deepStrictEqual([u.bodies, u.hp, u.defense, u.defVal, u.burn, u.projSpeed, u.range, u.hit, u.aps, u.splash, u.structure, u.lesser, u.scorchSight, u.trueSight],
    [1, 450, 'armor', 2, 50, 0, imp.range + 10, imp.hit, imp.aps, imp.splash, true, true, true, true], 'the turret');
  // skills: each once per turret, either player
  assert.ok(x.act(1, 'mpbBuy', a, 'blaze').ok, 'A2 buys Blaze on A1\'s turret');
  assert.ok(!x.act(0, 'mpbBuy', a, 'blaze').ok, 'once per turret');
  assert.ok(x.act(0, 'mpbBuy', b, 'blaze').ok, 'the other turret has its own');
  u = Mpb.unitOf(m, 0, Mpb.recOf(m, 0, a));
  assert.ok(u.splash === 5 && Math.abs(u.hit - imp.hit * 1.25) < 1e-9, 'Blaze: splash 5, +25% hit');
  assert.ok(x.act(0, 'mpbBuy', a, 'rapid').ok);
  u = Mpb.unitOf(m, 0, Mpb.recOf(m, 0, a));
  assert.ok(Math.abs(u.aps - imp.aps * 1.25) < 1e-9 && u.range === imp.range + 15, 'Rapid fire: +25% attack speed, +5 m');
  assert.ok(x.act(0, 'mpbBuy', a, 'legs').ok);
  u = Mpb.unitOf(m, 0, Mpb.recOf(m, 0, a));
  assert.ok(!u.structure && u.speed === imp.speed && u.mpbSkin === 'mobile', 'Legs: it walks, a unit');
  // the opponents don't see this round's buys
  assert.ok(!Object.keys(Mpb.recOf(Duo.viewFor(D, 2).m, 0, a).skills).length, 'hidden from B1');
  assert.ok(Mpb.recOf(Duo.viewFor(D, 1).m, 0, a).skills.legs, 'the teammate sees them');
  sameTeam(D, 0);
});

check('scorch: burns, instant shots, sees a stealthed unit at any distance (walking one), not needed to win (Legs: needed)', () => {
  const x = match(205), { D } = x;
  const a = put(D, 0, 'scorch', null, { lane: 0 }), m = x.m(0), rec = Mpb.recOf(m, 0, a), tu = Mpb.unitOf(m, 0, rec);
  const plain = { ...stealthy(), stealth: false };
  // Spitfire: half of each hit burns over the next seconds (Engine BURN): the target burns, and keeps burning after the
  // turret is gone; the shot lands at once (no projectile in flight)
  const burns = (u) => {
    const t = bodyOf(u, 0, 0, 0, -700), f = bodyOf(plain, 1, 0, 15, 1), bt = Engine.createBattle([t, dummy()], [f], G0, {});
    let k = 0; while (f.hp >= 2000 && k++ < 200) bt.step();
    const first = 2000 - f.hp, burning = !!f.burn;
    t.alive = false; t.hp = 0; // the turret is gone: what burns still burns
    const hp = f.hp; steps(bt, 3);
    return { first, burning, after: hp - f.hp, shots: bt.shots ? bt.shots() : null };
  };
  const wb = burns(tu), nb = burns({ ...tu, burn: 0 });
  assert.ok(wb.burning && wb.after > 0, 'it burns, and keeps burning: ' + wb.after);
  assert.ok(!nb.burning && nb.after === 0 && Math.abs(wb.first - nb.first / 2) < 1e-6, 'without Spitfire: no burn (half of the hit burns)');
  // stealth: a static one sees it in range; a walking one finds one far away
  const r = stealthy();
  const hit = (u, dist, secs) => { const t = bodyOf(u, 0, 0, 0, -700), f = bodyOf(r, 1, 0, dist, 1); const bt = Engine.createBattle([t, dummy()], [f], G0, {}); steps(bt, secs); return 2000 - f.hp; };
  assert.ok(hit(tu, 15, 4) > 0, 'a stealthed Rogue in range is shot');
  const walk = Mpb.scorchUnit(m, { ...rec, skills: { legs: { n: 1 } } });
  assert.ok(hit(walk, 45, 20) > 0, 'a walking turret finds a stealthed Rogue 45 m off');
  assert.strictEqual(hit({ ...walk, scorchSight: false, trueSight: false }, 45, 20), 0, 'without its sight it doesn\'t');
  // not needed to win: only the turret left on side 1 -> side 1 has nothing that counts
  const one = (u) => { const f = bodyOf(units[BRUTE], 0, 0, -40, 1), t = bodyOf(u, 1, 0, 40, -700); const bt = Engine.createBattle([f], [t], G0, {}); steps(bt, 1); return bt.result().survivors[1]; };
  assert.strictEqual(one(tu), 0, 'a turret isn\'t a unit');
  assert.strictEqual(one(walk), 1, 'with Legs it is');
});

check('scorch in a real Duo fight: it shoots for its team, the walking one walks; downside: destroyed -> sits out the next fight, skills lost', () => {
  const x = match(206), { D } = x; playTo(x, 2); rich(D);
  const front = Mpb.spots(x.m(0), 0, 'scorch', null).filter(t => t.row === 13).sort((p, q) => Math.abs(p.col - 11.5) - Math.abs(q.col - 11.5))[0];
  const a = put(D, 0, 'scorch', front, { lane: 0 }), b = put(D, 0, 'scorch', null, { lane: 1 });
  clearArmies(D); open(x, 2, BRUTE); open(x, 0, BRUTE);
  const ra = Mpb.recOf(x.m(0), 0, a);
  assert.ok(x.act(2, 'place', BRUTE, ra.col, 6).ok, 'B1\'s Brutes walk in');
  assert.ok(x.act(0, 'place', BRUTE, ra.col, 14).ok, 'A1\'s Brutes behind the turret');
  assert.ok(x.act(1, 'mpbBuy', b, 'legs').ok && x.act(1, 'mpbBuy', b, 'blaze').ok);
  Duo.setTeams(D.lanes.map(R => R.m));
  let bt = fightOf(D);
  const tb = bt.bodies.filter(t => t.u.mpb === 'scorch');
  assert.strictEqual(tb.length, 2, 'two turrets'); assert.ok(tb.every(t => t.side === 0 && t.lane === 0));
  const walker = tb.find(t => !t.u.structure), x0 = { x: walker.x, y: walker.y };
  while (bt.step()) {}
  const res = bt.result();
  const sa = res.squads['0:' + Mpb.squadOf(Mpb.recs(x.m(0), 0).findIndex(r => r.key === a))];
  console.log(`      turret dealt ${Math.round(sa ? sa.dealt : 0)}; the walking one moved ${Math.hypot(walker.x - x0.x, walker.y - x0.y).toFixed(1)} m`);
  assert.ok(sa && sa.dealt > 0, 'the turret dealt damage');
  assert.ok(Math.hypot(walker.x - x0.x, walker.y - x0.y) > 1 || !walker.alive, 'the walking one walked');
  // destroyed (Mpb.afterFight with a result where its body fell): skills lost, sits out the next round, back the round after
  const lanes = D.lanes.map(R => R.m), k = Mpb.recs(lanes[0], 0).findIndex(r => r.key === b);
  for (const R of D.lanes) { const r = Mpb.recOf(R.m, 0, b); r.skills = { legs: { round: 1, n: 1, by: [0, 1], log: [] } }; }
  const sums = lanes.map(mm => ({ round: mm.round }));
  Mpb.afterFight(lanes, { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } } }, sums, [200, 200]);
  Duo.copyAll(lanes[0], lanes[1]);
  const r2 = Mpb.recOf(lanes[0], 0, b);
  assert.ok(!Object.keys(r2.skills).length, 'its skills are lost'); assert.strictEqual(r2.data.out, lanes[0].round + 1, 'it sits out the next round');
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'scorch' && n.text), 'the news');
  for (const mm of lanes) mm.round++; // the next round's fight: no body
  Duo.setTeams(lanes);
  bt = Duo.battle(lanes);
  assert.strictEqual(bt.bodies.filter(t => t.u.mpb === 'scorch').length, 1, 'it sits out');
  for (const mm of lanes) mm.round++;
  bt = Duo.battle(lanes);
  assert.strictEqual(bt.bodies.filter(t => t.u.mpb === 'scorch').length, 2, 'back the round after');
  sameTeam(D, 0);
});

// =====================================================================
// Both
// =====================================================================
check('mirror: both teams with a kojja (archers in it, linked as Duo.battle does) and turrets, point-mirrored: an even fight', () => {
  // (the 2v2 board's own placement isn't mirror-exact: package squads, squad ids; this is the Engine fight itself,
  // with the bodies the kinds' hooks make)
  const link = Mpb.KINDS.treeKojja.hooks.link;
  const build = (side, legs) => {
    const s = side === 0 ? 1 : -1, list = [];
    const k = Engine.buildSquad(Mpb.kojjaUnit(), side, s * -12, s * -30, -701, Game.TILE, 0); k[0].mpbKey = 'tk2';
    const a = Engine.buildSquad(units[ARCH], side, s * -12, s * -30, 3, Game.TILE, 1); for (const b of a) b.nestOf = 'tk2';
    const t = Engine.buildSquad(Mpb.scorchUnit({ units }, { skills: legs ? { legs: { n: 1 } } : {} }), side, s * 6, s * -14, -702, Game.TILE, 20);
    const br = Engine.buildSquad(units[BRUTE], side, s * 3, s * -12, 4, Game.TILE, 30);
    list.push(...k, ...a, ...t, ...br);
    link(null, side, { key: 'tk2' }, list);
    return list;
  };
  // the engine's own level: the same fight with the archers plainly on the tile and no turret
  const plain = (side) => { const s = side === 0 ? 1 : -1; return [...Engine.buildSquad(units[ARCH], side, s * -12, s * -30, 3, Game.TILE, 1), ...Engine.buildSquad(units[BRUTE], side, s * 3, s * -12, 4, Game.TILE, 30)]; };
  const run = (A, B) => { const bt = Engine.createBattle(A, B, G0, {}); while (bt.step()) {} return bt.result(); };
  const base = run(plain(0), plain(1)), gap0 = Math.abs(base.squads['0:3'].dealt - base.squads['1:3'].dealt);
  for (const legs of [false, true]) {
    const A = build(0, legs), B = build(1, legs);
    assert.ok(A.some(b => b.nest) && B.some(b => b.nest), 'a body in each kojja');
    const r = run(A, B), q = (sd, id) => r.squads[sd + ':' + id];
    console.log(`      ${legs ? 'walking turrets' : 'turrets'}: winner ${r.winner}; archers alive ${q(0, 3).alive}/${q(1, 3).alive} dealt ${q(0, 3).dealt}/${q(1, 3).dealt}; kojjas alive ${q(0, -701).alive}/${q(1, -701).alive}; turrets alive ${q(0, -702).alive}/${q(1, -702).alive} dealt ${q(0, -702).dealt.toFixed(1)}/${q(1, -702).dealt.toFixed(1)} (plain archers: ${base.squads['0:3'].dealt}/${base.squads['1:3'].dealt})`);
    // (the Engine's own mirror level: the plain fight above is a few % apart already, from who goes first each tick)
    const alike = (a, b) => Math.abs(a - b) <= Math.max(gap0, 0.08 * Math.max(1, a, b));
    for (const id of [-701, -702, 4]) { assert.strictEqual(q(0, id).alive, q(1, id).alive, 'squad ' + id + ' alive alike'); assert.ok(alike(q(0, id).dealt, q(1, id).dealt), 'squad ' + id + ' dealt alike'); }
    assert.ok(alike(q(0, 3).dealt, q(1, 3).dealt), 'the archers dealt alike');
  }
});

if (!process.env.B1_QUICK) check('a full bot 2v2, rounds 1 to 10, with both kinds forced in: no exception, team state equal, views in step, playback; bots use them', () => {
  const used = { nest: 0, grow: 0, scorch: 0, garrison: 0, turned: 0, out: 0 };
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 2000 + seed, [true, true, true, true]);
    for (const sd of [0, 1]) { put(D, sd, 'treeKojja'); put(D, sd, 'scorch', null, { lane: 0 }); put(D, sd, 'scorch', null, { lane: 1 }); }
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
      const m = D.lanes[0].m;
      for (const sd of [0, 1]) for (const r of Mpb.recs(m, sd)) {
        if (r.kind === 'treeKojja' && r.data.ghost && !r.away) used.turned++;
        if (r.kind === 'scorch' && r.data.out === m.round) used.out++;
        if (r.kind === 'treeKojja' && !r.away && Mpb.skillN(r, 'nest') && D.lanes.some(R => R.m.armies[sd].some(q => q.col === r.col && q.row === r.row))) used.garrison++;
      }
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + D.lanes[0].m.round);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    const m = D.lanes[0].m;
    for (const sd of [0, 1]) for (const r of Mpb.recs(m, sd)) {
      if (r.kind === 'treeKojja') { used.nest += Mpb.skillN(r, 'nest'); if (r.data.lane != null && !r.away) used.grow++; }
      if (r.kind === 'scorch') used.scorch += Object.keys(r.skills).length;
    }
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, buildings ${[0, 1].map(sd => Mpb.recs(m, sd).map(r => r.key + (r.away ? '(away)' : '')).join('+')).join(' | ')}`);
  }
  console.log('      ' + JSON.stringify(used));
  assert.ok(used.nest > 0 && used.grow > 0 && used.garrison > 0, 'the bots used the kojja\'s skills');
  assert.ok(used.scorch > 0, 'the bots bought turret skills (or they were lost again)');
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall B1 checks passed');
