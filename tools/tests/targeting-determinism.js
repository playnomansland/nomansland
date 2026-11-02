'use strict';

// Deterministic baseline for future differential target-selection tests.
// Runs the real engine twice from identical inputs and records every validTargets
// query. The trace is opt-in and is deliberately absent from normal battle runs.

const assert = require('assert');
const Engine = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');

const skill = id => roster.skills.find(s => s.id === id) || null;
const units = roster.units.map(u => ({
  ...u,
  cost: u.cost / 100,
  skillDefs: Engine.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null)
}));
const byName = name => {
  const unit = units.find(u => u.name === name);
  assert.ok(unit, 'expected roster unit: ' + name);
  return unit;
};
const settings = {
  ...Game.SETTINGS,
  ...roster.settings,
  bounds: { x0: -36, x1: 36, y0: -48, y1: 48 }
};

function runBattle(unitA, unitB, targetingMode = 'reference') {
  const ids = new WeakMap();
  let nextId = 0;
  const targetTrace = [];
  const result = Engine.battle(unitA, unitB, settings, {
    targetingMode,
    onTargetQuery({ attacker, caller, targets }) {
      const id = body => {
        if (!ids.has(body)) ids.set(body, nextId++);
        return ids.get(body);
      };
      targetTrace.push({
        attacker: id(attacker),
        caller,
        targets: targets.map(id)
      });
    }
  });
  return {
    targetTrace,
    outcome: {
      winner: result.winner,
      timeout: result.timeout,
      time: result.time,
      survivors: result.survivors,
      counts: result.counts,
      stats: result.stats,
      squads: result.squads
    }
  };
}

// A short, real-engine matchup gives us a cheap, deterministic reference fixture.
// Heavy swarm matchups will be added once the indexed implementation exists.
{
  const a = byName('Truespear');
  const b = byName('Assassin');
  const reference = runBattle(a, b, 'reference');
  const referenceRepeat = runBattle(a, b, 'reference');
  const indexed = runBattle(a, b, 'indexed');
  assert.ok(reference.targetTrace.length > 0, 'the fixture must exercise validTargets');
  assert.deepStrictEqual(referenceRepeat.targetTrace, reference.targetTrace, 'reference targeting must be deterministic');
  assert.deepStrictEqual(referenceRepeat.outcome, reference.outcome, 'reference battle outcome must be deterministic');
  assert.deepStrictEqual(indexed.targetTrace, reference.targetTrace, 'indexed targeting must preserve every target query and candidate order');
  assert.deepStrictEqual(indexed.outcome, reference.outcome, 'indexed targeting must preserve the complete battle outcome');
  console.log('ok  indexed targeting matches reference trace and outcome');
}

console.log('Targeting differential baseline tests passed.');
