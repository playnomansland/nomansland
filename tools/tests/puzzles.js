// Headless check of the tutorial puzzles (src/puzzles.json): each puzzle's answer wins the fight from
// most placements in the zone, and the tempting wrong answers lose. The fights are set up the way startPuzzle does
// (Old standard board, the enemy's squads as if from an earlier round) and played by the referee's fight().
// Run from the repo root: node tools/tests/puzzles.js. After changing these units' stats, run it again.
const assert = require('assert');
const Engine = require('../../src/engine.js');
const Game = require('../../src/game.js');
const Ref = require('../../src/referee.js');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));
const PUZZLES = require('../../src/puzzles.json');
const ix = (n) => { const i = units.findIndex((u) => u.name === n); assert.ok(i >= 0, n); return i; };

function fight(P, mine) {
  const m = Game.createMatch(units, matrix, 1, 'standard');
  m.packages = [[], []];
  for (const n of P.shop) m.unlocks[0][ix(n)] = 1;
  for (const [n] of P.foe) m.unlocks[1][ix(n)] = 1;
  m.gold = [P.gold, 9999];
  for (const [n, c, r] of P.foe) { const q = Game.place(m, 1, ix(n), c, r); assert.ok(q, 'enemy ' + n); q.round = 0; }
  for (const [n, c, r] of mine) if (!Game.place(m, 0, ix(n), c, r)) return null; // can't go there (or no gold)
  const f = Ref.fight(m);
  return f.summary.winner === 0 && !f.summary.timeout;
}
// share of random placements (seeded) that win
function share(P, names, tries = 30) {
  let seed = 11, w = 0, n = 0;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (n < tries) {
    const used = new Set(), mine = [];
    for (const nm of names) { let t; do t = [Math.floor(r() * Game.COLS), 10 + Math.floor(r() * 6)]; while (used.has(t.join())); used.add(t.join()); mine.push([nm, ...t]); }
    const won = fight(P, mine);
    if (won == null) continue;
    n++; if (won) w++;
  }
  return w / n;
}
// [puzzle name, answers that should win often, wrong answers that should (almost) never win]
const CHECKS = [
  ['The horde', [['Fire Mage', 'Fire Mage']], [['Sniper', 'Sniper'], ['Goblin Swarm', 'Goblin Swarm'], ['Brute']]],
  ['Two giants', [['Goblin Swarm', 'Goblin Swarm', 'Goblin Swarm']], [['Sniper', 'Sniper', 'Sniper'], ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Skeleton Archers', 'Skeleton Archers', 'Skeleton Archers']]],
  ['Out of reach', [['Sniper', 'Sniper', 'Sniper']], [['Goblin Swarm', 'Goblin Swarm', 'Goblin Swarm'], ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Sniper', 'Goblin Swarm', 'Goblin Swarm']]],
];
assert.strictEqual(PUZZLES.length, CHECKS.length, 'a check for every puzzle');
for (const [name, good, bad] of CHECKS) {
  const P = PUZZLES.find((x) => x.name === name);
  assert.ok(P, name);
  for (const g of good) { const s = share(P, g); console.log(`${name}: ${g.join(' + ')} wins ${Math.round(s * 100)}%`); assert.ok(s >= 0.4, `${name}: the answer should win from most placements`); }
  for (const b of bad) { const s = share(P, b); console.log(`${name}: ${b.join(' + ')} wins ${Math.round(s * 100)}%`); assert.ok(s <= 0.1, `${name}: ${b.join(' + ')} should lose`); }
}
console.log('puzzles: all checks passed');
