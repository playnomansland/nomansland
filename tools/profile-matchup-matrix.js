#!/usr/bin/env node
'use strict';

// Dedicated real-engine matchup-matrix profiler. Does not run AI-vs-AI matches.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Lab = require('./balance-lab.js');

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex');
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function main() {
  const args = process.argv.slice(2);
  let out = 'balance-lab-profile.json', mode = 'reference';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i];
    else if (args[i] === '--mode') mode = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node tools/profile-matchup-matrix.js [--mode reference|indexed] [--out balance-lab-profile.json]');
      return;
    } else throw new Error('Unknown argument: ' + args[i]);
  }

  const startedAt = new Date().toISOString();
  const prepared = Lab.prepareRoster({ rebuildMatrix: true, targetingMode: mode });
  const profile = prepared.profiling;
  const durations = profile.matchups.map(m => m.elapsedMs);
  const steps = profile.matchups.map(m => m.steps);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    commit: process.env.GITHUB_SHA || null,
    targetingMode: mode,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    fingerprints: {
      engine: hash('src/engine.js'),
      game: hash('src/game.js'),
      roster: hash('src/default-roster.json')
    },
    summary: {
      units: profile.unitCount,
      uniqueMatchups: profile.uniqueMatchups,
      wallTimeMs: profile.matrixElapsedMs,
      summedMatchupTimeMs: profile.summedMatchupMs,
      averageMatchupMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p95MatchupMs: percentile(durations, 0.95),
      averageSteps: steps.length ? Math.round(steps.reduce((a, b) => a + b, 0) / steps.length) : 0,
      p95Steps: percentile(steps, 0.95)
    },
    slowestMatchups: profile.matchups.slice().sort((a, b) => b.elapsedMs - a.elapsedMs).slice(0, 20),
    matchups: profile.matchups
  };

  const target = path.resolve(out);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log('Profiling report written to ' + target);
  console.log(JSON.stringify(report.summary, null, 2));
}

try { main(); }
catch (error) { console.error(error.stack || error); process.exitCode = 1; }
