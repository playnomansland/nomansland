// Headless check: DEVTESTLATEGAME (2026-11-03): more health, at most Game.LATE.cap squads of one tier 3+ unit type
const assert = require('assert');
const Game = require('../../src/game.js');
const Ref = require('../../src/referee.js');
const roster = require('../../src/default-roster.json');
const demo = require('../../src/demo-units.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const L = Game.LATE;
const idx = (name) => units.findIndex(u => u.name === name);

// a normal match is unchanged
const n = Game.createMatch(units, demo.matrix, 5, 'testgrid');
assert.deepStrictEqual(n.hp, [Game.START_HP, Game.START_HP]);
assert.ok(!n.late && !Game.capped(n, idx('Flame Wizard')));

// the late game: more health, cap on tier 3 and 4 only
const m = Game.createMatch(units, demo.matrix, 5, 'testgrid', null, null, { late: true });
assert.strictEqual(m.late, true);
assert.deepStrictEqual(m.hp, [Game.START_HP + L.hp, Game.START_HP + L.hp]);
assert.strictEqual(Game.startHp(m), Game.START_HP + L.hp);
for (const sd of [0, 1]) Game.choosePack(m, sd, 0);
for (const name of ['Flame Wizard', 'Frost Wizard', 'Meteor Caller', 'Necromancer']) assert.ok(Game.capped(m, idx(name)), name);
for (const name of ['Goblin Swarm', 'Brute']) assert.ok(!Game.capped(m, idx(name)), name);

// place as many as the board takes: tier 3/4 stop at the cap, lower tiers don't
function fill(name, want) {
  const ui = idx(name); let got = 0;
  m.gold[0] = 1e6; m.extraDeploys[0] = 100; m.unlocks[0][ui] = 1;
  for (const row of [15, 14, 13, 12, 11, 10]) for (let col = 0; col < Game.COLS && got < want; col++) {
    if (m.armies[0].length && Game.deploysLeft(m, 0) <= 0) m.extraDeploys[0] += 10;
    if (Game.place(m, 0, ui, col, row)) got++;
  }
  return got;
}
assert.strictEqual(fill('Flame Wizard', 9), L.cap);
assert.ok(Game.capFull(m, 0, idx('Flame Wizard')));
assert.strictEqual(fill('Frost Wizard', 9), L.cap, 'a second tier 3 type has its own cap');
assert.strictEqual(fill('Meteor Caller', 9), L.cap, 'tier 4 too');
assert.ok(fill('Goblin Swarm', 7) === 7, 'tier 1 has no cap');
// taking one back frees a slot
const fw = m.armies[0].filter(s => s.unit === idx('Flame Wizard'));
assert.ok(Game.unplaceSquad(m, 0, fw[0].id));
assert.ok(!Game.capFull(m, 0, idx('Flame Wizard')));
assert.strictEqual(fill('Flame Wizard', 3), 1);
console.log('cap ok');

// the referee: the setting goes through cleanSettings; a phone can't place a sixth
const R = Ref.create({ late: true, map: 'testgrid' }, units);
assert.strictEqual(R.settings.late, true);
assert.strictEqual(Ref.create({}, units).settings.late, false);
Ref.start(R, units, demo.matrix, 0, 77);
assert.ok(R.m.late && R.m.hp[0] === Game.START_HP + L.hp);

// whole matches, AI on both sides: no side ever holds more than the cap of one tier 3+ type
let rounds = 0;
for (let seed = 1; seed <= 12; seed++) {
  const g = Game.createMatch(units, demo.matrix, seed, 'testgrid', null, null, { late: true });
  for (const sd of [0, 1]) Game.choosePack(g, sd, 0);
  for (let k = 0; k < 40 && !g.over; k++) {
    Game.settleTowerPicks(g);
    for (const sd of [0, 1]) Game.aiDeploy(g, sd);
    for (const sd of [0, 1]) {
      const c = {}; for (const s of g.armies[sd]) c[s.unit] = (c[s.unit] || 0) + 1;
      for (const [ui, k2] of Object.entries(c)) if (Game.capped(g, +ui)) assert.ok(k2 <= L.cap, `${units[ui].name} x${k2}`);
    }
    for (const sd of [0, 1]) Game.aiLevel(g, sd);
    Ref.fight(g);
    rounds++;
  }
}
console.log('AI matches ok,', rounds, 'rounds');
console.log('late-game: all checks passed');
