// Headless check of the 2026-11-03 tower changes: Bastion's March order (a free move every round, used before the paid
// one, by just moving the squad) and the Mage tower's Muster (+1 deployment every round, as the Keep has).
// Run from the repo root: node tools/tests/towers-1103.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Ref = require('../../src/referee.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (name) => units.findIndex(u => u.name === name);
const mk = (type, seed = 77) => {
  const m = Game.createMatch(units, demo.matrix, seed, 'standard');
  m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = type; m.towers[1].type = 'sniper'; m.gold = [2000, 2000];
  return m;
};
const sq = (m, side, name, col, row, round) => { const s = { id: m.nextId[side]++, unit: ui(name), col, row, level: 0, xp: 0, round, cost: units[ui(name)].cost }; m.armies[side].push(s); return s; };
const base = Game.CONFIG.deploysPerRound;

// Mage tower: Muster
let m = mk('mage');
assert.ok(Game.towerType(m, 0).muster && Game.musterOn(m, 0));
assert.strictEqual(Game.deploysAllowed(m, 0), base + 1, 'Mage tower: +1 deployment');
assert.ok(!Game.deployBuyable(m, 0), 'nothing to buy');
assert.strictEqual(Game.deploysAllowed(m, 1), base, 'the Sniper tower has none');

// Bastion: one free move every round, then the paid one
m = mk('bastion');
assert.strictEqual(Game.freeMoves(m, 0), 1);
assert.strictEqual(Game.freeMoves(m, 1), 0);
const a = sq(m, 0, 'Goblin Swarm', 3, 12, 1), b = sq(m, 0, 'Fire Mage', 4, 12, 1), c = sq(m, 0, 'Sniper', 5, 12, 2);
const g = m.gold[0];
assert.ok(Game.moveSquad(m, 0, a.id, 3, 13), 'free move');
assert.strictEqual(m.gold[0], g, 'it cost nothing'); assert.strictEqual(a.luckMove, m.round); assert.strictEqual(Game.movedId(m, 0), null);
assert.ok(Game.moveSquad(m, 0, a.id, 3, 14), 'the same squad goes on moving for free');
assert.strictEqual(m.gold[0], g);
assert.ok(Game.moveSquad(m, 0, b.id, 4, 13), 'the paid move');
assert.strictEqual(m.gold[0], g - Game.CONFIG.moveCost);
assert.ok(!Game.canMove(m, 0, c), 'no third move');
// moving the free one back gives the free move back
assert.ok(Game.moveSquad(m, 0, a.id, 3, 12) && !a.luckMove && Game.freeMovesLeft(m, 0) === 1);
// next round it is there again
assert.ok(Game.moveSquad(m, 0, a.id, 2, 12));
m.round++; m.moved = [null, null]; for (const q of m.armies[0]) { delete q.from; delete q.movedRound; delete q.luckMove; }
assert.strictEqual(Game.freeMovesLeft(m, 0), 1, 'every round');
// the opponent still sees it where it was until the fight
assert.ok(Game.moveSquad(m, 0, c.id, 6, 13));
const v = Ref.view(m, 1, true);
const seen = v.armies[0].find(q => q.id === c.id);
assert.deepStrictEqual([seen.col, seen.row], [5, 12], 'hidden move');
console.log('towers-1103: Mage tower Muster, Bastion March order ok');
