'use strict';
// Differential test for the engine's fast paths (opts.targetingMode === 'indexed'): the spatial grids for target
// selection, movement's nearest enemy and ally separation must give bit-for-bit the same battles as the full scans.
// Every tick, every body's position, health and state is hashed in both modes and the two hash lists must match.
//
//   node tools/tests/fast-paths.js                 real AI matches on every map + mechanic fixtures (a few minutes)
//   node tools/tests/fast-paths.js --matrix        every counter-table matchup too (slow: ~30 min)
//   QUICK=1 node tools/tests/fast-paths.js         fewer matches
const assert = require('assert');
const Engine = require('../../src/engine.js');
const Game = require('../../src/game.js');
const Lab = require('../balance-lab.js');
const roster = require('../../src/default-roster.json');

const QUICK = !!process.env.QUICK, MATRIX = process.argv.includes('--matrix');
const buf = new Float64Array(1), words = new Uint32Array(buf.buffer);
function stateHash(bodies) {
  let h = 0x811c9dc5;
  const mix = (v) => { buf[0] = v; h = Math.imul(h ^ words[0], 16777619); h = Math.imul(h ^ words[1], 16777619); };
  mix(bodies.length);
  for (const b of bodies) {
    mix(b.x); mix(b.y); mix(b.hp); mix(b.alive ? 1 : 0); mix(b.side);
    mix(b.hx || 0); mix(b.hy || 0); mix(b.engaged ? 1 : 0); mix(b.cd || 0);
  }
  return h >>> 0;
}

// Game matches: every battle the game makes goes through Engine.createBattle; force the mode and hash each step.
let forced = null, log = null;
const realCreate = Engine.createBattle;
Engine.createBattle = function (A, B, g, opts = {}) {
  const bt = realCreate(A, B, g, { ...opts, targetingMode: forced });
  const hashes = [];
  log.push(hashes);
  const step = bt.step;
  bt.step = function () { const r = step.apply(this, arguments); hashes.push(stateHash(bt.bodies)); return r; };
  return bt;
};
function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || [], y = b[i] || [];
    for (let k = 0; k < Math.max(x.length, y.length); k++) if (x[k] !== y[k]) return 'battle ' + i + ', step ' + k;
  }
  return null;
}
const prepared = Lab.prepareRoster();
const maps = ['standard', 'forest', 'cavern', 'ice', 'testgrid', 'bridge', 'rush'];
const perMap = QUICK ? 1 : 3;
let battles = 0, steps = 0, fastMs = 0, refMs = 0;
for (const map of maps) for (let k = 0; k < perMap; k++) {
  const seed = 910000 + maps.indexOf(map) * 100 + k, runs = {};
  for (const mode of ['reference', 'indexed']) {
    forced = mode; log = [];
    const t = Date.now();
    const res = Lab.simulateMatch(prepared, seed, { map, maxRounds: 30, mirror: k === 2 });
    (mode === 'indexed' ? (fastMs += Date.now() - t) : (refMs += Date.now() - t));
    runs[mode] = { res, log };
  }
  const where = firstDiff(runs.reference.log, runs.indexed.log);
  assert.strictEqual(where, null, map + ' seed ' + seed + ': fast paths differ at ' + where);
  assert.deepStrictEqual(runs.indexed.res, runs.reference.res, map + ' seed ' + seed + ': match results differ');
  battles += runs.reference.log.length; steps += runs.reference.log.reduce((n, l) => n + l.length, 0);
  console.log('ok', map, 'seed', seed, '-', runs.reference.res.rounds, 'rounds');
}
console.log('game matches: ' + battles + ' battles, ' + steps + ' steps identical; reference ' + (refMs / 1000).toFixed(1) + ' s, indexed ' + (fastMs / 1000).toFixed(1) + ' s');
Engine.createBattle = realCreate;

// Counter-table battles (Engine.battle, one unit against another): mechanic fixtures, or every pair with --matrix.
const skill = id => roster.skills.find(s => s.id === id) || null;
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: Engine.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
const settings = { ...Game.SETTINGS, ...roster.settings };
const byName = n => { const u = units.find(x => x.name === n); assert.ok(u, 'roster unit ' + n); return u; };
function engineRun(a, b, mode) {
  const hashes = [];
  const r = Engine.battle(a, b, settings, { targetingMode: mode, onStep: bt => hashes.push(stateHash(bt.bodies)) });
  return { hashes, out: { winner: r.winner, time: r.time, survivors: r.survivors, counts: r.counts, stats: r.stats } };
}
const fixtures = [ // Wind Walk, Death Flurry, carrier, teleporting tower, walls, swarms, knockback/charges
  ['Leaf Wizard', 'Skeleton Archers'], ['Assassin', 'Goblin Swarm'], ['Just a horse', 'Truespear'],
  ['Goblin Swarm', 'Skeleton Archers'], ['Truespear', 'Assassin'], ['Ent', 'Slimeshots']
];
const names = new Set(units.map(u => u.name));
const pairs = MATRIX
  ? units.flatMap((u, i) => units.slice(i + 1).map(v => [u.name, v.name]))
  : fixtures.filter(([a, b]) => names.has(a) && names.has(b));
let n = 0;
for (const [a, b] of pairs) {
  const ref = engineRun(byName(a), byName(b), 'reference'), fast = engineRun(byName(a), byName(b), 'indexed');
  const k = ref.hashes.findIndex((h, i) => h !== fast.hashes[i]);
  assert.ok(k < 0 && ref.hashes.length === fast.hashes.length, a + ' v ' + b + ': fast paths differ at step ' + (k < 0 ? ref.hashes.length : k));
  assert.deepStrictEqual(fast.out, ref.out, a + ' v ' + b + ': results differ');
  n++;
  if (MATRIX && n % 20 === 0) console.log('matrix ' + n + '/' + pairs.length);
}
console.log('engine battles: ' + n + ' identical' + (MATRIX ? ' (full matrix)' : ' (fixtures)'));
console.log('fast-paths: ok');
