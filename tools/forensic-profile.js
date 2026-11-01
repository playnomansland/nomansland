#!/usr/bin/env node
'use strict';

// Isolated real-engine matchup runner for V8 CPU profiling.
// This deliberately avoids Engine.matrix(): each process profiles one selected battle only.
const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Engine = require('../src/engine.js');
const Game = require('../src/game.js');
const roster = require('../src/default-roster.json');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const nameA = arg('a');
const nameB = arg('b');
if (!nameA || !nameB) throw new Error('Usage: node tools/forensic-profile.js --a "Unit A" --b "Unit B"');

const skill = id => roster.skills.find(s => s.id === id) || null;
const units = roster.units.map(u => ({
  ...u,
  cost: u.cost / 100,
  skillDefs: Engine.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null)
}));
const byName = new Map(units.map(u => [u.name, u]));
const a = byName.get(nameA), b = byName.get(nameB);
if (!a || !b) throw new Error('Unknown matchup unit: ' + (!a ? nameA : nameB));

const settings = {
  ...Game.SETTINGS,
  ...roster.settings,
  bounds: { x0: -36, x1: 36, y0: -48, y1: 48 }
};
const sideA = Engine.makeArmy([{ unit: a, gold: settings.budget }], 0, settings);
const sideB = Engine.makeArmy([{ unit: b, gold: settings.budget }], 1, settings);
const battle = Engine.createBattle(sideA, sideB, settings);
let steps = 0;
const started = performance.now();
while (battle.step()) steps++;
steps++; // Count the final step call that reports completion, matching Engine.battle().
const elapsedMs = performance.now() - started;
const result = battle.result();

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = {
  matchup: nameA + ' vs ' + nameB,
  commit: process.env.GITHUB_SHA || null,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  settings: { dt: settings.dt, timeCap: settings.timeCap, budget: settings.budget },
  fingerprints: {
    engine: hash('src/engine.js'),
    game: hash('src/game.js'),
    roster: hash('src/default-roster.json')
  },
  workload: {
    startingBodies: sideA.length + sideB.length,
    sideABodies: sideA.length,
    sideBBodies: sideB.length
  },
  execution: {
    steps,
    simulationSeconds: result.time,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    msPerStep: Number((elapsedMs / steps).toFixed(3)),
    winner: result.winner,
    timeout: result.timeout,
    survivors: result.survivors,
    finalBodies: result.counts
  }
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
