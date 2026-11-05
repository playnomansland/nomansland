// Headless check: a squad stepping out of Just a horse moves for free (2026-10-29)
const assert = require('assert');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const demo = require('../../src/demo-units.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (n) => units.findIndex(u => u.name === n);
const m = Game.createMatch(units, demo.matrix, 7);
m.round = 3; m.gold = [1000, 1000];
const horse = { id: m.nextId[0]++, unit: ui('Just a horse'), col: 2, row: 12, level: 0, xp: 0, round: 2, cost: 1 };
const rider = { id: m.nextId[0]++, unit: ui('Brute'), col: 2, row: 12, level: 0, xp: 0, round: 2, cost: 1, in: horse.id };
const other = { id: m.nextId[0]++, unit: ui('Brute'), col: 5, row: 12, level: 0, xp: 0, round: 2, cost: 1 };
m.armies[0].push(horse, rider, other);
assert.ok(Game.freeOut(m, 0, rider));
assert.ok(Game.moveSquad(m, 0, rider.id, 3, 12), 'step out');
assert.strictEqual(m.gold[0], 1000, 'stepping out is free');
assert.ok(rider.in == null && Game.movedId(m, 0) == null);
assert.ok(Game.moveSquad(m, 0, rider.id, 4, 12), 'move on, still free'); assert.strictEqual(m.gold[0], 1000);
assert.ok(Game.moveSquad(m, 0, other.id, 6, 12), 'the paid move is still there'); assert.strictEqual(m.gold[0], 1000 - Game.CONFIG.moveCost);
assert.ok(Game.moveSquad(m, 0, rider.id, 2, 12), 'back into the horse'); assert.strictEqual(rider.in, horse.id); assert.ok(!rider.from);
m.gold[0] = 0; assert.ok(Game.moveSquad(m, 0, rider.id, 3, 12), 'free with no gold');
console.log('horse-out ok');

// 2026-11-05: each carrier lets one squad (from an earlier round) out and one in per round
{
  const m = Game.createMatch(units, demo.matrix, 8);
  m.round = 3; m.gold = [1000, 1000];
  const sq = (unit, col, row, extra = {}) => { const s = { id: m.nextId[0]++, unit: ui(unit), col, row, level: 0, xp: 0, round: 2, cost: 1, ...extra }; m.armies[0].push(s); return s; };
  const h1 = sq('Just a horse', 2, 12), h2 = sq('Just a horse', 6, 12);
  const a = sq('Brute', 2, 12, { in: h1.id }), b = sq('Brute', 6, 12, { in: h2.id });
  assert.ok(Game.moveSquad(m, 0, a.id, 3, 12), 'a out of horse 1');
  assert.ok(Game.moveSquad(m, 0, b.id, 4, 12), 'b out of horse 2');
  assert.ok(Game.moveSquad(m, 0, b.id, 2, 12), 'b into horse 1 (its one in)');
  assert.ok(!Game.moveSquad(m, 0, b.id, 5, 12), 'b out of horse 1 again: horse 1 has let a out already');
  assert.ok(Game.moveSquad(m, 0, a.id, 6, 12), 'a into horse 2 (its one in)');
  assert.deepStrictEqual(Game.horseLeft(m, 0, h1.id), [], 'horse 1: nothing left this round');
  // a squad that goes back where it was gives its places back
  assert.ok(Game.moveSquad(m, 0, a.id, 2, 12) === false, 'horse 1 is full (b rides it)');
  m.round = 4;
  assert.deepStrictEqual(Game.horseLeft(m, 0, h1.id), ['in', 'out'], 'a new round: both again');
  const c = sq('Brute', 8, 12, { round: 4 });
  assert.ok(Game.moveSquad(m, 0, c.id, 9, 12) && Game.moveSquad(m, 0, c.id, 8, 12), 'this round\'s squads move as before');
  assert.ok(Game.moveSquad(m, 0, b.id, 3, 12), 'b out of horse 1 in round 4');
  assert.ok(Game.moveSquad(m, 0, b.id, 2, 12), 'and back where it was');
  assert.deepStrictEqual(Game.horseLeft(m, 0, h1.id), ['in', 'out'], 'back where it was: nothing used');
  console.log('horse in/out cap ok');
}
