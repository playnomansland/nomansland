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
  let calls = 0;
  const completed = Lab.stepBattle({
    step() { calls++; return calls < 3; },
    result() { return { winner: 0 }; }
  }, 3);
  assert.strictEqual(completed.steps, 3, 'counts every engine step, including the final one');
  assert.deepStrictEqual(completed.result, { winner: 0 });
  assert.strictEqual(calls, 3);

  let cappedCalls = 0;
  assert.throws(() => Lab.stepBattle({
    step() { cappedCalls++; return true; },
    result() { throw new Error('must not read a truncated result'); }
  }, 3), /exceeded the 3-step safety limit/);
  assert.strictEqual(cappedCalls, 3);
  assert.throws(() => Lab.stepBattle({ step() { return false; } }, 0), /positive integer/);
  console.log('ok  battle step counting and truncation safety');
}

{
  // Exercise roster preparation without running the engine's expensive all-vs-all
  // matchup simulations. The real matrix is exercised once by the CI smoke test.
  const Engine = require('../../src/engine.js');
  const originalMatrix = Engine.matrix;
  let matrixCalled = false;
  let instrumentationOptions;
  Engine.matrix = (units, settings, onProgress, options) => {
    matrixCalled = true;
    instrumentationOptions = options;
    onProgress({ type: 'matchup-complete', completed: 1, total: 1, unitAName: 'A', unitBName: 'B', steps: 12, elapsedMs: 4 });
    return units.map((_, i) => units.map((__, j) => i === j ? null : { score: 0 }));
  };
  try {
    const prepared = Lab.prepareRoster();
    assert.ok(prepared.units.length > 0, 'loads the live roster');
    assert.strictEqual(matrixCalled, true, 'builds the engine matchup matrix');
    assert.deepStrictEqual(instrumentationOptions, { progressEvery: 100 }, 'enables opt-in matchup instrumentation');
    assert.strictEqual(prepared.matrix.length, prepared.units.length);
    assert.strictEqual(prepared.matrix[0].length, prepared.units.length);
  } finally {
    Engine.matrix = originalMatrix;
  }
  console.log('ok  live roster preparation and matchup matrix wiring');
}

console.log('Balance Lab tests passed.');
