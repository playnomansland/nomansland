#!/usr/bin/env node
'use strict';

// Merge Balance Lab shard reports (tools/balance-lab.js --out, or tools/lab-hoard.js --out) into one report.
// The summary is recomputed from every match with balance-lab's own summarize(), so it is exactly what one long run
// would have printed. Adds 95% intervals for side, leader and tower win rates (summary.stats).
//
//   node tools/lab-merge.js --out merged.json [--summary-only] shard0.json shard1.json ...
//
// --summary-only: write the summary (and config) without the per-match list (small enough to commit).

const fs = require('fs');
const path = require('path');
const Lab = require('./balance-lab.js');

// Wilson 95% interval for k wins of n, in percent
function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Number((100 * (c - h)).toFixed(1)), Number((100 * (c + h)).toFixed(1))];
}
// how many standard errors k of n is from 50%
const zFromHalf = (k, n) => n ? Number(((k / n - 0.5) / Math.sqrt(0.25 / n)).toFixed(2)) : null;

// side bias, and leaders/towers with games, decided games, wins and a 95% interval (from the matches themselves)
function stats(summary, matches) {
  const Game = require('../src/game.js');
  const n = summary.wins[0] + summary.wins[1];
  const tl = {}, tt = {};
  const add = (map, k, won, decided) => { const t = map[k] || (map[k] = { name: k, games: 0, decided: 0, wins: 0 }); t.games++; if (decided) { t.decided++; if (won) t.wins++; } };
  for (const m of matches) {
    const decided = m.completed && (m.winner === 0 || m.winner === 1);
    for (const sd of [0, 1]) {
      const won = decided && m.winner === sd;
      if (m.leaders[sd]) { const c = Game.charInfo(m.leaders[sd]); add(tl, c ? c.name : m.leaders[sd], won, decided); }
      if (m.towers[sd]) { const t = Game.TOWER_TYPES.find(x => x.id === m.towers[sd]); add(tt, t ? t.name : m.towers[sd], won, decided); }
    }
  }
  const rows = (map) => Object.values(map).map(t => ({ ...t, winRate: t.decided ? Number((t.wins / t.decided * 100).toFixed(1)) : null, ci95: wilson(t.wins, t.decided), zFrom50: zFromHalf(t.wins, t.decided) }))
    .sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
  return {
    side: { decided: n, wins: summary.wins, side0Pct: n ? Number((summary.wins[0] / n * 100).toFixed(1)) : null, ci95: wilson(summary.wins[0], n), zFrom50: zFromHalf(summary.wins[0], n) },
    leaders: rows(tl),
    towers: rows(tt),
  };
}

function merge(files, units) {
  const reports = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const matches = [];
  const seen = new Set();
  for (const r of reports) for (const m of r.matches) {
    const key = m.seed + ':' + (m.hoarderSide != null ? m.hoarderSide : '');
    if (seen.has(key)) throw new Error('seed ' + m.seed + ' is in more than one shard');
    seen.add(key);
    matches.push(m);
  }
  matches.sort((a, b) => a.seed - b.seed);
  const summary = Lab.summarize(matches, units);
  summary.stats = stats(summary, matches);
  const c0 = reports[0].config || {};
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: reports[0].source,
    config: { ...c0, matches: matches.length, seed: matches.length ? matches[0].seed : null, shards: files.map(f => path.basename(f)) },
    summary,
    matches
  };
}

function main() {
  const argv = process.argv.slice(2);
  let out = null, summaryOnly = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--summary-only') summaryOnly = true;
    else files.push(argv[i]);
  }
  if (!files.length) { console.log('Usage: node tools/lab-merge.js --out merged.json [--summary-only] shard0.json shard1.json ...'); return; }
  const { units } = Lab.prepareRoster();
  const merged = merge(files, units);
  if (summaryOnly) delete merged.matches;
  const s = merged.summary;
  console.log('Merged ' + s.matches + ' matches from ' + files.length + ' shards: completed ' + s.completed + ', refused ' + s.referee.refused + ', desyncs ' + s.referee.desyncs
    + ', side 0 ' + s.stats.side.side0Pct + '% (z ' + s.stats.side.zFrom50 + ')');
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n'); console.log('Written to ' + out); }
}

if (require.main === module) main();
module.exports = { merge, wilson, zFromHalf, stats };
