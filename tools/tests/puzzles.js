// Headless check of the tutorial puzzles (src/puzzles.json): each puzzle's answer wins the fight from
// most placements (Medium: where the hint says to put it), and the tempting wrong answers lose. The fights are set up the way startPuzzle does
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
// share of placements (seeded) that win. An entry is a list of unit names, placed anywhere in the zone, or
// { units, cols, rows } (each squad somewhere in those columns and rows), or { ent: true, ... } style formations built
// by make(r) -> [[name, col, row], ...].
function share(P, entry, tries = 30) {
  let seed = 11, w = 0, n = 0, bad = 0;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const e = Array.isArray(entry) ? { units: entry } : entry;
  const cols = e.cols || [0, Game.COLS - 1], rows = e.rows || [10, 15];
  while (n < tries) {
    let mine;
    if (e.make) mine = e.make(ri);
    else {
      const used = new Set(); mine = [];
      for (const nm of e.units) { let t; do t = [ri(cols[0], cols[1]), ri(rows[0], rows[1])]; while (used.has(t.join())); used.add(t.join()); mine.push([nm, ...t]); }
    }
    const won = fight(P, mine);
    if (won == null) { assert.ok(++bad < 500, 'placements keep failing: ' + label(entry)); continue; } // can't go there (or no gold)
    n++; if (won) w++;
  }
  return w / n;
}
const label = (e) => Array.isArray(e) ? e.join(' + ') : e.label || e.units.join(' + ');
// [puzzle name, answers that should win often, wrong answers that should (almost) never win, optional limits]
// Easy: answers win from >= 40% of random placements, wrong answers <= 10%. Medium puzzles (2026-11-05) also teach
// placement, so their answers are checked where the hint says to put them (and >= 60%); wrong answers <= 10% unless
// the row says otherwise.
const ENT_FRONT = { label: 'Ent in front, Fire Mages behind', make: (ri) => { const c = ri(2, 9), r = ri(10, 11); return [['Ent', c, r], ['Fire Mage', c + ri(-1, 1), r + ri(1, 3)], ['Fire Mage', c + ri(-1, 1), r + ri(1, 3)]]; } };
const ENT_BACK = { label: 'Fire Mages in front, Ent behind', make: (ri) => { const c = ri(2, 9), r = ri(10, 11); return [['Fire Mage', c, r], ['Fire Mage', c + 1, r], ['Ent', c + ri(-1, 1), r + ri(2, 4)]]; } };
const GOB = ['Goblin Swarm', 'Goblin Swarm', 'Goblin Swarm'];
const WALL = ['Sniper', 'Sniper', 'Earth Wizard'];
const CHECKS = [
  ['The horde', [['Fire Mage', 'Fire Mage']], [['Sniper', 'Sniper'], ['Goblin Swarm', 'Goblin Swarm'], ['Brute']]],
  ['Two giants', [['Goblin Swarm', 'Goblin Swarm', 'Goblin Swarm']], [['Sniper', 'Sniper', 'Sniper'], ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Skeleton Archers', 'Skeleton Archers', 'Skeleton Archers']]],
  ['Out of reach', [['Sniper', 'Sniper', 'Sniper']], [['Goblin Swarm', 'Goblin Swarm', 'Goblin Swarm'], ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Sniper', 'Goblin Swarm', 'Goblin Swarm']]],
  // three Fire Mages (the Easy lesson) sometimes get lucky against the spiders: allowed up to 20%
  ['Hold the line', [ENT_FRONT], [ENT_BACK, ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Sniper', 'Sniper', 'Sniper'], ['Skeleton Archers', 'Skeleton Archers', 'Skeleton Archers']], { good: 0.6, bad: 0.2 }],
  ['The long way round', [{ label: 'Goblins down the far side', units: GOB, cols: [8, 10] }], [{ label: 'Goblins facing the Brute', units: GOB, cols: [1, 5] }, ['Fire Mage', 'Fire Mage', 'Fire Mage'], ['Skeleton Archers', 'Skeleton Archers', 'Skeleton Archers'], ['Ember Imps', 'Ember Imps', 'Ember Imps']], { good: 0.6 }],
  ['Through the wall', [{ label: 'Snipers + Earth Wizard facing them', units: WALL, cols: [6, 9], rows: [12, 13] }], [{ label: 'Three Snipers facing them', units: ['Sniper', 'Sniper', 'Sniper'], cols: [6, 9], rows: [12, 13] }, ['Fire Mage', 'Fire Mage', 'Earth Wizard'], ['Goblin Swarm', 'Goblin Swarm', 'Earth Wizard']], { good: 0.6 }],
];
assert.strictEqual(PUZZLES.length, CHECKS.length, 'a check for every puzzle');
for (const [name, good, bad, lim = {}] of CHECKS) {
  const P = PUZZLES.find((x) => x.name === name);
  assert.ok(P, name);
  const okGood = lim.good || 0.4, okBad = lim.bad || 0.1;
  for (const g of good) { const s = share(P, g); console.log(`${name}: ${label(g)} wins ${Math.round(s * 100)}%`); assert.ok(s >= okGood, `${name}: the answer should win from most placements`); }
  for (const b of bad) { const s = share(P, b); console.log(`${name}: ${label(b)} wins ${Math.round(s * 100)}%`); assert.ok(s <= okBad, `${name}: ${label(b)} should lose`); }
}
console.log('puzzles: all checks passed');
