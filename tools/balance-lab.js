#!/usr/bin/env node
'use strict';

// NML Balance Lab — deterministic headless match runner.
// Uses the same Engine and Game modules as the live game. No duplicate combat logic.

const fs = require('fs');
const path = require('path');
const Engine = require('../src/engine.js');
const Game = require('../src/game.js');
const roster = require('../src/default-roster.json');
const prepareUnits = require('../server/src/prepare-units.cjs');

const DEFAULTS = Object.freeze({ matches: 10, seed: 700000, maxRounds: 30, map: 'standard' });

function parseArgs(argv) {
  const out = { ...DEFAULTS, out: null, mirror: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matches') out.matches = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--max-rounds') out.maxRounds = Number(argv[++i]);
    else if (a === '--map') out.map = String(argv[++i]);
    else if (a === '--mirror') out.mirror = true;
    else if (a === '--no-mirror') out.mirror = false;
    else if (a === '--out') out.out = String(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!Number.isInteger(out.matches) || out.matches < 1 || out.matches > 100000) throw new Error('--matches must be an integer from 1 to 100000');
  if (!Number.isInteger(out.seed) || out.seed < 0 || out.seed > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(out.maxRounds) || out.maxRounds < 1 || out.maxRounds > 200) throw new Error('--max-rounds must be an integer from 1 to 200');
  return out;
}

// The units and counter table every real match uses: src/demo-units.json (built by tools/counter-table.js),
// prepared by the very code the server uses (server/src/prepare-units.cjs, checked against the page's useSet).
// No battles run. rebuildMatrix: true instead builds a table from the roster with the engine (for profiling only;
// its settings differ from the shipped table's). targetingMode: 'indexed' runs those battles on the fast paths.
function prepareRoster(options = {}) {
  if (!options.rebuildMatrix) {
    const { units, matrix } = prepareUnits(Engine, require('../src/demo-units.json'));
    return { units, matrix, source: 'src/demo-units.json' };
  }
  const skill = id => roster.skills.find(s => s.id === id) || null;
  const units = roster.units.map(u => ({
    ...u,
    cost: u.cost / 100,
    skillDefs: Engine.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null)
  }));
  // The matchup matrix is calculated by the real engine and is used by the real AI draft/deployment logic.
  const settings = {
    ...Game.SETTINGS,
    ...roster.settings,
    bounds: { x0: -36, x1: 36, y0: -48, y1: 48 }
  };
  const totalMatchups = units.length * (units.length - 1) / 2;
  console.log('Building live-engine matchup matrix for ' + units.length + ' units (' + totalMatchups + ' unique battles).');
  const matchupTimings = [];
  const matrixStartedAt = Date.now();
  let lastHeartbeatAt = matrixStartedAt;
  const matrix = Engine.matrix(units, settings, progress => {
    if (progress.type === 'matchup-heartbeat') {
      const now = Date.now();
      if (now - lastHeartbeatAt >= 5000) {
        console.log('Matchup still running: ' + progress.unitAName + ' vs ' + progress.unitBName
          + ' — ' + progress.steps + ' steps, ' + (progress.elapsedMs / 1000).toFixed(1) + 's elapsed.');
        lastHeartbeatAt = now;
      }
      return;
    }
    if (progress.type === 'matchup-complete') {
      matchupTimings.push({
        matchup: progress.unitAName + ' vs ' + progress.unitBName,
        steps: progress.steps,
        elapsedMs: progress.elapsedMs
      });
      if (progress.completed === progress.total || progress.completed % 10 === 0) {
        console.log('Matchup matrix: ' + progress.completed + '/' + progress.total + ' ('
          + Math.round(progress.completed / progress.total * 100) + '%), last matchup '
          + progress.elapsedMs + 'ms / ' + progress.steps + ' steps.');
      }
      lastHeartbeatAt = Date.now();
    }
  }, { progressEvery: 100, targetingMode: options.targetingMode || 'reference' });
  const matrixElapsedMs = Date.now() - matrixStartedAt;
  const totalElapsedMs = matchupTimings.reduce((sum, item) => sum + item.elapsedMs, 0);
  const slowest = matchupTimings.slice().sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 10);
  console.log('Matchup matrix ready in ' + (matrixElapsedMs / 1000).toFixed(1) + 's wall time (' + (totalElapsedMs / 1000).toFixed(1) + 's summed matchup time).');
  console.log('Slowest matchups:');
  for (const item of slowest) {
    console.log('  ' + item.matchup + ': ' + item.elapsedMs + 'ms / ' + item.steps + ' steps');
  }
  // the AI reads plain scores (as in demo-units.json), not battle results
  const scores = matrix.map((row, i) => row.map((r, j) => i === j || !r ? 0 : r.score));
  return { units, matrix: scores, settings, source: 'engine matrix from src/default-roster.json', profiling: {
    unitCount: units.length,
    uniqueMatchups: totalMatchups,
    matrixElapsedMs,
    summedMatchupMs: totalElapsedMs,
    matchups: matchupTimings
  } };
}

function stepBattle(battle, maxSteps = 5000) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error('maxSteps must be a positive integer');
  }
  let steps = 0;
  let running = true;
  while (running && steps < maxSteps) {
    running = battle.step();
    steps++;
  }
  if (running) {
    throw new Error('Battle exceeded the ' + maxSteps + '-step safety limit; refusing to resolve a truncated battle');
  }
  return { result: battle.result(), steps };
}

function simulateMatch(prepared, seed, options = {}) {
  const { units, matrix } = prepared;
  const m = Game.createMatch(units, matrix, seed >>> 0, options.map || DEFAULTS.map, null, null,
    options.mirror ? { mirror: true } : undefined);
  const maxRounds = options.maxRounds || DEFAULTS.maxRounds;
  const roundLog = [];
  let battleCount = 0;

  while (!m.over && m.round <= maxRounds) {
    Game.aiDeploy(m, 0);
    Game.aiDeploy(m, 1);
    const battle = Game.startBattle(m);
    const stepped = stepBattle(battle, options.maxBattleSteps || 5000);
    const steps = stepped.steps;
    const battleResult = stepped.result;
    const roundResult = Game.resolve(m, battleResult);
    battleCount++;
    roundLog.push({
      round: roundResult.round,
      winner: roundResult.winner,
      damage: roundResult.dmg,
      battleTime: Number((roundResult.time || 0).toFixed(2)),
      steps,
      squads: roundResult.squads.map(side => side.map(s => ({
        unit: s.unit,
        level: s.level,
        survival: Number((s.left || 0).toFixed(4)),
        damageDealt: s.dealt || 0
      })))
    });
  }

  return {
    seed: seed >>> 0,
    winner: m.over ? m.winner : -1,
    completed: !!m.over,
    rounds: battleCount,
    hp: m.hp.slice(),
    gold: m.gold.slice(),
    armySizes: m.armies.map(a => a.length),
    roundLog
  };
}

function summarize(results, units) {
  const wins = [0, 0], damageTaken = [0, 0], hpRemaining = [0, 0];
  let completed = 0, unfinished = 0, totalRounds = 0;
  const unitStats = units.map((u, index) => ({
    index, name: u.name, squadRounds: 0, damageDealt: 0,
    survivalTotal: 0, appearances: 0
  }));

  for (const match of results) {
    if (match.completed && (match.winner === 0 || match.winner === 1)) {
      wins[match.winner]++;
      completed++;
    } else unfinished++;
    totalRounds += match.rounds;
    for (let side = 0; side < 2; side++) {
      hpRemaining[side] += match.hp[side];
      for (const round of match.roundLog) {
        damageTaken[side] += round.damage[side] || 0;
        for (const squad of round.squads[side]) {
          const stat = unitStats[squad.unit];
          if (!stat) continue;
          stat.squadRounds++;
          stat.appearances++;
          stat.damageDealt += squad.damageDealt;
          stat.survivalTotal += squad.survival;
        }
      }
    }
  }

  for (const s of unitStats) {
    s.avgSurvival = s.appearances ? Number((s.survivalTotal / s.appearances).toFixed(4)) : null;
    delete s.survivalTotal;
    if (!s.appearances) delete s.avgSurvival;
  }
  return {
    matches: results.length,
    completed,
    unfinished,
    wins,
    winRate: wins.map(n => completed ? Number((n / completed * 100).toFixed(1)) : 0),
    averageRounds: results.length ? Number((totalRounds / results.length).toFixed(2)) : 0,
    averageHpRemaining: results.length ? hpRemaining.map(n => Number((n / results.length).toFixed(1))) : [0, 0],
    damageTaken,
    unitStats
  };
}

function runBatch(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const prepared = prepareRoster();
  const results = [];
  for (let i = 0; i < config.matches; i++) {
    results.push(simulateMatch(prepared, (config.seed + i) >>> 0, config));
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { engine: 'src/engine.js', game: 'src/game.js', units: prepared.source },
    config: { matches: config.matches, seed: config.seed >>> 0, maxRounds: config.maxRounds, map: config.map, mirror: !!config.mirror, ai: 'current Game.aiDeploy' },
    summary: summarize(results, prepared.units),
    matches: results
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/balance-lab.js [--matches 10] [--seed 700000] [--max-rounds 30] [--map standard] [--mirror] [--out report.json]');
    return;
  }
  const report = runBatch(options);
  console.log('NML Balance Lab');
  console.log(JSON.stringify(report.summary, null, 2));
  if (options.out) {
    const target = path.resolve(options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    console.log('Full report written to ' + target);
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}

module.exports = { DEFAULTS, parseArgs, prepareRoster, stepBattle, simulateMatch, summarize, runBatch };
