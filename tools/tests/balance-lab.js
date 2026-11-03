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
  assert.strictEqual(Lab.parseArgs([]).mirror, true, 'ranked: mirrored offers by default');
  assert.strictEqual(Lab.parseArgs(['--map', 'random']).map, '');
  assert.strictEqual(Lab.parseArgs(['--mirror']).mirror, true);
  assert.strictEqual(Lab.parseArgs(['--mirror', '--no-mirror']).mirror, false);
  console.log('ok  CLI argument parsing and validation');
}

{
  const empty = { units: [], skills: [], levelUps: 0, unlocks: [], other: {} };
  const round = (bought0) => ({ damage: [5, 20], gold: { start: [300, 300], atFight: [50, 0], after: [400, 350] },
    bought: [bought0, empty], squads: [[{ unit: 0, survival: 0.5, damageDealt: 100 }], []] });
  const report = Lab.summarize([
    {
      completed: true, winner: 0, rounds: 2, hp: [80, 0], leaders: ['otto', 'zoe'], towers: ['keep', 'mage'],
      referee: { accepted: 7, refused: [], desyncs: [] },
      roundLog: [round({ ...empty, units: ['Test Unit'], skills: ['Test Unit: Sharp'], levelUps: 2 }), round(empty)]
    },
    { completed: false, winner: -1, rounds: 3, hp: [20, 50], leaders: [null, null], towers: [null, null],
      referee: { accepted: 1, refused: [{ fn: 'place', why: 'rules' }], desyncs: [] }, roundLog: [] }
  ], [{ name: 'Test Unit' }]);
  assert.strictEqual(report.completed, 1);
  assert.strictEqual(report.unfinished, 1);
  assert.deepStrictEqual(report.wins, [1, 0]);
  assert.deepStrictEqual(report.winRate, [100, 0]);
  assert.strictEqual(report.unitStats[0].damageDealt, 200);
  assert.strictEqual(report.unitStats[0].avgSurvival, 0.5);
  assert.strictEqual(report.unitStats[0].bought, 1);
  assert.strictEqual(report.unitStats[0].matches, 1);
  assert.strictEqual(report.unitStats[0].winRateWhenFielded, 100);
  assert.deepStrictEqual(report.referee, { accepted: 8, refused: 1, desyncs: 0, refusedBy: { 'place (rules)': 1 } });
  assert.strictEqual(report.economy.levelUps, 2);
  assert.strictEqual(report.economy.avgGoldSpentPerRound, 275);
  assert.strictEqual(report.economy.avgGoldEarnedPerRound, 275); // between rounds 1 and 2 only: (250 + 300) / 2
  assert.deepStrictEqual(report.skills, [{ name: 'Test Unit: Sharp', games: 1, wins: 1, winRate: 100 }]);
  const otto = report.leaders.find(l => l.name.startsWith('Otto')), zoe = report.leaders.find(l => l.name === 'Zoe');
  assert.deepStrictEqual([otto.winRate, zoe.winRate], [100, 0]);
  console.log('ok  summary aggregation (units, skills, leaders, economy, referee) and unfinished matches');
}

{
  // A whole refereed match: every AI move goes through the referee and is accepted, the AI's view stays in step,
  // the AI levels up at fight time, and the same seed gives the same match.
  const prepared = Lab.prepareRoster();
  const a = Lab.simulateMatch(prepared, 4242, { maxRounds: 30 });
  const b = Lab.simulateMatch(prepared, 4242, { maxRounds: 30 });
  assert.deepStrictEqual(a, b, 'deterministic');
  assert.strictEqual(a.map, 'testgrid', 'ranked settings: the Standard map');
  assert.ok(a.referee.accepted > 10);
  assert.deepStrictEqual(a.referee.refused, [], 'no AI move refused');
  assert.deepStrictEqual(a.referee.desyncs, [], 'AI view and referee in step');
  assert.ok(a.roundLog.some(r => r.bought.some(sd => sd.levelUps > 0)), 'the AI levels up');
  assert.ok(a.leaders.every(Boolean) && a.towers.every(Boolean), 'leaders and towers recorded');
  assert.ok(!a.leaders.includes('blixten'), 'no Blixten in ranked');
  console.log('ok  refereed AI match (' + a.rounds + ' rounds, ' + a.referee.accepted + ' moves)');
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
  // Default: the shipped units and counter table, prepared like the server does it, with no battles.
  const Engine = require('../../src/engine.js');
  const demo = require('../../src/demo-units.json');
  const originalMatrix = Engine.matrix;
  let matrixCalled = false;
  let instrumentationOptions;
  Engine.matrix = (units, settings, onProgress, options) => {
    matrixCalled = true;
    instrumentationOptions = options;
    onProgress({ type: 'matchup-complete', completed: 1, total: 1, unitAName: 'A', unitBName: 'B', steps: 12, elapsedMs: 4 });
    return units.map((_, i) => units.map((__, j) => i === j ? null : { score: 0.25 }));
  };
  try {
    const prepared = Lab.prepareRoster();
    assert.strictEqual(matrixCalled, false, 'uses the shipped counter table');
    assert.strictEqual(prepared.units.length, demo.units.length);
    assert.deepStrictEqual(prepared.matrix, demo.matrix);
    assert.ok(prepared.matrix.every(r => r.every(x => typeof x === 'number')), 'plain scores, as the AI reads them');
    const rebuilt = Lab.prepareRoster({ rebuildMatrix: true, targetingMode: 'indexed' });
    assert.strictEqual(matrixCalled, true, 'rebuild builds the engine matchup matrix');
    assert.deepStrictEqual(instrumentationOptions, { progressEvery: 100, targetingMode: 'indexed' });
    assert.strictEqual(rebuilt.matrix.length, rebuilt.units.length);
    assert.strictEqual(rebuilt.matrix[0][1], 0.25, 'rebuilt table holds scores, not battle results');
    assert.strictEqual(rebuilt.matrix[0][0], 0);
  } finally {
    Engine.matrix = originalMatrix;
  }
  console.log('ok  roster preparation (shipped table) and matrix rebuild wiring');
}

console.log('Balance Lab tests passed.');
