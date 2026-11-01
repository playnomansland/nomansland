#!/usr/bin/env node
'use strict';

// NML Balance Lab — deterministic headless match runner.
// Uses the same Engine and Game modules as the live game. No duplicate combat logic.

const fs = require('fs');
const path = require('path');
const Engine = require('../src/engine.js');
const Game = require('../src/game.js');
const roster = require('../src/default-roster.json');

const DEFAULTS = Object.freeze({ matches: 10, seed: 700000, maxRounds: 30, map: 'standard' });

function parseArgs(argv) {
  const out = { ...DEFAULTS, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matches') out.matches = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--max-rounds') out.maxRounds = Number(argv[++i]);
    else if (a === '--map') out.map = String(argv[++i]);
    else if (a === '--out') out.out = String(argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!Number.isInteger(out.matches) || out.matches < 1 || out.matches > 100000) throw new Error('--matches must be an integer from 1 to 100000');
  if (!Number.isInteger(out.seed) || out.seed < 0 || out.seed > 0xffffffff) throw new Error('--seed must be an unsigned 32-bit integer');
  if (!Number.isInteger(out.maxRounds) || out.maxRounds < 1 || out.maxRounds > 200) throw new Error('--max-rounds must be an integer from 1 to 200');
  return out;
}

function prepareRoster() {
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
  const matrix = Engine.matrix(units, settings);
  return { units, matrix, settings };
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
    let steps = 0;
    while (battle.step() && steps < 5000) steps++;
    const battleResult = battle.result();
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
    source: { engine: 'src/engine.js', game: 'src/game.js', roster: 'src/default-roster.json' },
    config: { matches: config.matches, seed: config.seed >>> 0, maxRounds: config.maxRounds, map: config.map, ai: 'current Game.aiDeploy' },
    summary: summarize(results, prepared.units),
    matches: results
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/balance-lab.js [--matches 10] [--seed 700000] [--max-rounds 30] [--map standard] [--out report.json]');
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

module.exports = { DEFAULTS, parseArgs, prepareRoster, simulateMatch, summarize, runBatch };
