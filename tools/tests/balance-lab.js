'use strict';

const assert = require('assert');
const Lab = require('../balance-lab.js');

{
  const options = Lab.parseArgs(['--matches', '5', '--seed', '42', '--max-rounds', '12', '--map', 'standard']);
  assert.deepStrictEqual(
    { matches: options.matches, seed: options.seed, maxRounds: options.maxRounds, map: options.map },
    { matches: 5, seed: 42, maxRounds: 12, map: 'standard' }
  );
  assert.throws(() => Lab.parseArgs(['--matches', '0']), /--matches/);
  assert.throws(() => Lab.parseArgs(['--seed', '-1']), /--seed/);
  assert.strictEqual(Lab.parseArgs(['--mirror']).mirror, true);
  assert.strictEqual(Lab.parseArgs(['--mirror', '--no-mirror']).mirror, false);
  console.log('ok  CLI argument parsing and validation');
}

{
  const report = Lab.summarize([
    {
      completed: true, winner: 0, rounds: 2, hp: [80, 0],
      roundLog: [{ damage: [5, 20], squads: [[{ unit: 0, survival: 0.5, damageDealt: 100 }], []] }]
    },
    { completed: false, winner: -1, rounds: 3, hp: [20, 50], roundLog: [] }
  ], [{ name: 'Test Unit' }]);
  assert.strictEqual(report.completed, 1);
  assert.strictEqual(report.unfinished, 1);
  assert.deepStrictEqual(report.wins, [1, 0]);
  assert.deepStrictEqual(report.winRate, [100, 0]);
  assert.strictEqual(report.unitStats[0].damageDealt, 100);
  assert.strictEqual(report.unitStats[0].avgSurvival, 0.5);
  console.log('ok  summary aggregation and unfinished-match handling');
}

{
  const prepared = Lab.prepareRoster();
  assert.ok(prepared.units.length > 0, 'loads the live roster');
  assert.strictEqual(prepared.matrix.length, prepared.units.length, 'builds the engine matchup matrix');
  assert.strictEqual(prepared.matrix[0].length, prepared.units.length);
  console.log('ok  live roster preparation and engine matchup matrix');
}

console.log('Balance Lab tests passed.');
