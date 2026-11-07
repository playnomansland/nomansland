// Headless check of the 2026-11-07 deploy fixes (group C) in the rules (src/game.js):
// - C2: a squad on a flank tile of its side reaches at most AIM.flank tiles with its arrow (2v2: AIM.duoFlank), counted
//   as a square; the stored arrow is kept and cut along its line where it is used (aimTo, aimEnd, the fight's bodies).
// - C3: Bastion's March order reaches at most MARCH.tiles tiles (as a square) from the squad's tile at the round's
//   start; further is the horseshoe's or the paid move, or refused; back within reach it is the free move again.
// Run from the repo root: node tools/tests/fixes-1107-C.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Ref = require('../../src/referee.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (name) => { const i = units.findIndex(u => u.name === name); assert.ok(i >= 0, name); return i; };
const clone = (m) => ({ ...JSON.parse(JSON.stringify({ ...m, units: null, matrix: null })), units: m.units, matrix: m.matrix });
const mk = (type = 'sniper') => {
  const m = Game.createMatch(units, demo.matrix, 77, 'standard');
  m.round = Game.TOWER_PICK_ROUND + 1; m.towers[0].type = type; m.towers[1].type = 'sniper'; m.gold = [2000, 2000];
  return m;
};
// a referee holding match m, deploying (Referee.act runs a player's action as the server does)
const refOf = (m) => ({ phase: 'deploy', m, seq: [0, 0], ready: [false, false], deadline: 0, undo: [null, null] });
const sq = (m, side, name, col, row, round = 1) => { const s = { id: m.nextId[side]++, unit: ui(name), col, row, level: 0, xp: 0, round, cost: units[ui(name)].cost }; m.armies[side].push(s); return s; };

// ---- C2: the flank arrow ----
{
  const m = mk();
  const ft = Game.flankTiles(0).find(t => t.col === 0 && t.row === 3); // side 0's flank (the enemy's half), left edge
  assert.ok(ft && Game.isFlank(0, 0, 3));
  const f = sq(m, 0, 'Brute', 0, 3), plain = sq(m, 0, 'Brute', 5, 12);
  assert.strictEqual(Game.aimCap(m, f), Game.AIM.flank, 'a flank squad: capped');
  assert.strictEqual(Game.aimCap(m, plain), 0, 'elsewhere: no cap');
  assert.ok(Game.setAim(m, 0, f.id, 4, -1));
  assert.deepStrictEqual(f.aim, { dc: 4, dr: -1 }, 'the stored arrow is kept as set');
  assert.deepStrictEqual(Game.aimEnd(m, f), { col: 1, row: 3 }, 'drawn: cut to 1 tile along its line (no -0)');
  assert.ok(!Object.is(Game.aimUse(m, f, f.aim).dr, -0));
  assert.deepStrictEqual(Game.aimTo(m, f, 3, 0), { col: 1, row: 2 }, 'a diagonal: 1 tile each way');
  assert.deepStrictEqual(Game.aimTo(m, f, 0, 3), null, 'its own tile: no arrow');
  // the fight walks the cut arrow
  const bodies = Game.bodiesFor(clone(m), 0).filter(b => b.squad === f.id);
  assert.ok(bodies.length && bodies.every(b => b.guide && Math.abs(b.guide[0].x - b.x - Game.TILE) < 1e-6 && Math.abs(b.guide[0].y - b.y) < 1e-6), 'the fight: 1 tile');
  // moved off the flank: the long arrow is back
  f.col = 3; f.row = 3; assert.ok(!Game.isFlank(0, 3, 3));
  assert.deepStrictEqual(Game.aimEnd(m, f), { col: 7, row: 2 });
  const far = Game.bodiesFor(clone(m), 0).filter(b => b.squad === f.id);
  assert.ok(far.every(b => Math.abs(b.guide[0].x - b.x - 4 * Game.TILE) < 1e-6 || b.guide[0].x > b.x), 'off the flank: the whole arrow');
  // a long arrow, then onto the flank: cut there
  plain.aim = { dc: 0, dr: -5 }; plain.col = 11; plain.row = 5; assert.ok(Game.isFlank(0, 11, 5));
  assert.deepStrictEqual(Game.aimEnd(m, plain), { col: 11, row: 4 });
  // the referee stores what was sent and the fight cuts it the same
  const r = mk(); const rf = sq(r, 0, 'Brute', 0, 3);
  assert.ok(Ref.act(refOf(r), 0, { seq: 1, fn: 'setAim', a: [rf.id, 3, -3] }, 0).ok);
  assert.deepStrictEqual(rf.aim, { dc: 3, dr: -3 });
  assert.deepStrictEqual(Game.aimEnd(r, rf), { col: 1, row: 2 });
  const rb = Game.startBattle(clone(r)).bodies.filter(x => x.side === 0 && x.squad === rf.id);
  assert.ok(rb.length && rb.every(x => Math.abs(x.guide[0].x - x.x - Game.TILE) < 1e-6 && Math.abs(x.guide[0].y - x.y - Game.TILE) < 1e-6), 'the fight (startBattle): 1 tile each way');
  // the other side's flank tiles don't count for this side (its own zone's edge)
  const own = sq(m, 0, 'Brute', 0, 13); assert.ok(!Game.isFlank(0, 0, 13));
  assert.strictEqual(Game.aimCap(m, own), 0);
  // 2v2 lanes: 2 tiles
  m.duoTowers = true; f.col = 0; f.row = 3;
  assert.strictEqual(Game.aimCap(m, f), Game.AIM.duoFlank);
  assert.deepStrictEqual(Game.aimEnd(m, f), { col: 2, row: 2 }, '2v2: (4,-1) cut to 2 tiles');
  assert.deepStrictEqual(Game.aimTo(m, f, 4, 7), { col: 2, row: 5 }, '2v2: a diagonal (4,4) cut to (2,2)');
  // side 1's flank
  const m1 = mk(); const g = sq(m1, 1, 'Brute', 11, 12); assert.ok(Game.isFlank(1, 11, 12));
  assert.ok(Game.setAim(m1, 1, g.id, -5, 0)); assert.deepStrictEqual(Game.aimEnd(m1, g), { col: 10, row: 12 });
  console.log('C2 flank arrows ok');
}

// ---- C3: March order reaches 2 tiles ----
const cost = Game.CONFIG.moveCost;
{
  const m = mk('bastion');
  assert.strictEqual(Game.MARCH.tiles, 2);
  assert.ok(/up to 2 tiles/.test(Game.towerType(m, 0).freeMove.text));
  const a = sq(m, 0, 'Goblin Swarm', 3, 12), b = sq(m, 0, 'Fire Mage', 6, 12), g = m.gold[0];
  assert.strictEqual(Game.moveKind(m, 0, a, 5, 10), 'free', 'a diagonal 2 tiles away: free');
  assert.strictEqual(Game.moveKind(m, 0, a, 3, 9), 'paid', '3 tiles: the paid move');
  assert.ok(Game.moveSquad(m, 0, a.id, 5, 10) && m.gold[0] === g && a.luckMove === m.round, 'free (2, 2)');
  // on from there: still measured from where it stood at the round's start
  assert.ok(Game.moveSquad(m, 0, a.id, 5, 12) && m.gold[0] === g && a.luckMove === m.round, 'still within 2 of the start');
  assert.ok(Game.moveSquad(m, 0, a.id, 6, 10) && m.gold[0] === g - cost && Game.movedId(m, 0) === a.id && !a.luckMove, '3 from the start: now the paid move');
  assert.strictEqual(Game.freeMovesLeft(m, 0), 1);
  assert.ok(Game.moveSquad(m, 0, a.id, 4, 11) && m.gold[0] === g && Game.movedId(m, 0) == null && a.luckMove === m.round, 'back within reach: refunded, the free move again');
  assert.strictEqual(Game.freeMovesLeft(m, 0), 0);
  // the other squad: only the paid move is left
  assert.strictEqual(Game.moveKind(m, 0, b, 7, 12), 'paid');
  assert.ok(Game.moveSquad(m, 0, b.id, 7, 12) && m.gold[0] === g - cost && Game.movedId(m, 0) === b.id);
  assert.ok(!Game.moveSquad(m, 0, a.id, 0, 12), 'the free one too far, with the paid move taken: refused');
  assert.deepStrictEqual([a.col, a.row], [4, 11]);
  // back to its tile: everything given back
  assert.ok(Game.moveSquad(m, 0, a.id, 3, 12) && !a.luckMove && !a.from && Game.freeMovesLeft(m, 0) === 1);
  // no gold, no paid move: a far drag is refused, a near one free
  const n = mk('bastion'); const c = sq(n, 0, 'Brute', 5, 13); n.gold[0] = 0;
  assert.strictEqual(Game.moveKind(n, 0, c, 1, 13), null);
  assert.ok(!Game.moveSquad(n, 0, c.id, 1, 13) && c.col === 5, 'refused');
  assert.ok(Game.moveSquad(n, 0, c.id, 4, 11) && c.luckMove === n.round);
  // through the referee: the same
  const q = mk('bastion'), qa = sq(q, 0, 'Brute', 5, 13), R = refOf(q), gq = q.gold[0];
  assert.ok(Ref.act(R, 0, { seq: 1, fn: 'moveSquad', a: [qa.id, 2, 13] }, 0).ok && q.gold[0] === gq - cost, 'referee: 3 tiles is the paid move');
  assert.ok(Ref.act(R, 0, { seq: 2, fn: 'moveSquad', a: [qa.id, 4, 12] }, 0).ok && q.gold[0] === gq && qa.luckMove === q.round, 'referee: back within 2, free');
  // the opponent sees nothing new: no move fields in their view
  const v = Ref.view(m, 1, true);
  assert.ok(v.armies[0].every(q => q.luckMove == null && q.from == null && q.movedRound == null), 'hidden from the opponent');
  console.log('C3 March order ok');
}
// Otto's horseshoe goes anywhere; with Bastion too, a long drag takes the horseshoe and a short one March order
{
  const otto = (type) => { const m = mk(type); m.chars = m.chars || [null, null]; m.chars[0] = 'otto'; m.slots = [{ 2: [{ win: 'shoe', shoe: 'move' }] }, {}]; return m; };
  const m = otto('sniper'); const a = sq(m, 0, 'Brute', 5, 13), g = m.gold[0];
  assert.ok(Game.shoePerk(m, 0, 'move') && Game.freeMoves(m, 0) === 1 && Game.marchMoves(m, 0) === 0);
  assert.ok(Game.moveSquad(m, 0, a.id, 1, 10) && m.gold[0] === g && a.luckMove === m.round, 'horseshoe only: any distance');
  const both = otto('bastion'); const x = sq(both, 0, 'Brute', 2, 13), y = sq(both, 0, 'Brute', 8, 13), z = sq(both, 0, 'Brute', 10, 13), g2 = both.gold[0];
  assert.strictEqual(Game.freeMoves(both, 0), 2);
  assert.ok(Game.moveSquad(both, 0, x.id, 6, 10) && both.gold[0] === g2 && x.luckMove === both.round, '4 tiles: the horseshoe');
  assert.ok(Game.moveSquad(both, 0, y.id, 8, 12) && both.gold[0] === g2 && y.luckMove === both.round, '1 tile: March order');
  assert.strictEqual(Game.freeMovesLeft(both, 0), 0);
  assert.ok(Game.moveSquad(both, 0, y.id, 8, 10) && both.gold[0] === g2 - cost && !y.luckMove, 'a second far one: the paid move');
  assert.strictEqual(Game.moveKind(both, 0, z, 10, 12), 'free', 'March order is free again for a near one');
  assert.strictEqual(Game.moveKind(both, 0, z, 7, 10), null, 'a far one: the horseshoe and the paid move are taken');
  console.log('C3 horseshoe and March order ok');
}
console.log('fixes-1107-C ok');
