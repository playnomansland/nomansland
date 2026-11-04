#!/usr/bin/env node
'use strict';
// Plain-text tables from a merged Balance Lab report (tools/lab-merge.js): side bias, leaders, towers with 95%
// intervals, chosen units, skills and maps. Lab-only.
//   node tools/lab-tables.js merged.json [--units "Sniper,Water Mage,Spiders,Sun Priest"]
const fs = require('fs');
const Lab = require('./balance-lab.js');
const { wilson, zFromHalf } = require('./lab-merge.js');

const argv = process.argv.slice(2);
const file = argv[0];
const pick = argv.includes('--units') ? argv[argv.indexOf('--units') + 1].split(',') : ['Sniper', 'Water Mage', 'Spiders', 'Sun Priest'];
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const s = r.summary, st = s.stats;
const pad = (x, n) => String(x).padEnd(n), lp = (x, n) => String(x).padStart(n);
const ci = (c) => c ? c[0].toFixed(0) + '-' + c[1].toFixed(0) : '-';

console.log(`Matches ${s.matches}, completed ${s.completed}, unfinished ${s.unfinished}, avg rounds ${s.averageRounds}, accepted ${s.referee.accepted}, refused ${s.referee.refused}, desyncs ${s.referee.desyncs}`);
console.log(`Side 0 ${st.side.wins[0]} - side 1 ${st.side.wins[1]}: side 0 ${st.side.side0Pct}% (95% ${ci(st.side.ci95)}), z = ${st.side.zFrom50}`);
for (const [title, rows] of [['Leaders', st.leaders], ['Towers', st.towers]]) {
  console.log('\n' + title);
  console.log(pad('name', 22) + lp('games', 6) + lp('win%', 7) + lp('95% CI', 10) + lp('z', 7));
  for (const x of rows) console.log(pad(x.name, 22) + lp(x.decided, 6) + lp(x.winRate, 7) + lp(ci(x.ci95), 10) + lp(x.zFrom50, 7));
}

// units: buy rate (share of side-matches that bought it at least once), squads, win% when fielded, dmg/squad-round, survival
const sideMatches = s.matches * 2;
const bought = {}; // matches a side bought the unit in
for (const m of r.matches) for (const sd of [0, 1]) {
  const set = new Set();
  for (const rd of m.roundLog) for (const n of rd.bought[sd].units) set.add(n);
  for (const n of set) bought[n] = (bought[n] || 0) + 1;
}
console.log('\nUnits (all; * = new or changed)');
console.log(pad('unit', 18) + lp('buy%', 6) + lp('squads', 8) + lp('fielded', 8) + lp('win%', 6) + lp('95% CI', 9) + lp('dmg/sq-rd', 10) + lp('surv', 6));
for (const u of s.unitStats.slice().sort((a, b) => b.bought - a.bought)) {
  const c = wilson(Math.round((u.winRateWhenFielded || 0) * u.matches / 100), u.matches);
  console.log(pad((pick.includes(u.name) ? '*' : ' ') + u.name, 18) + lp(((bought[u.name] || 0) / sideMatches * 100).toFixed(1), 6) + lp(u.bought, 8) + lp(u.matches, 8)
    + lp(u.winRateWhenFielded == null ? '-' : u.winRateWhenFielded, 6) + lp(ci(c), 9) + lp(u.avgDamagePerSquadRound == null ? '-' : u.avgDamagePerSquadRound, 10) + lp(u.avgSurvival == null ? '-' : u.avgSurvival.toFixed(2), 6));
}
console.log('\nSkills of the picked units (side-matches that bought it, win%)');
for (const x of s.skills.filter(k => pick.some(p => k.name.startsWith(p + ':')))) console.log(pad(x.name, 44) + lp(x.games, 6) + lp(x.winRate, 7));

// maps
const maps = {};
for (const m of r.matches) { const t = maps[m.map] || (maps[m.map] = { n: 0, w0: 0, rounds: 0, dec: 0 }); t.n++; t.rounds += m.rounds; if (m.completed && m.winner >= 0) { t.dec++; if (m.winner === 0) t.w0++; } }
if (Object.keys(maps).length > 1) {
  console.log('\nMaps');
  console.log(pad('map', 18) + lp('games', 6) + lp('rounds', 8) + lp('side0%', 8) + lp('95% CI', 9) + lp('z', 7));
  for (const [k, t] of Object.entries(maps).sort()) console.log(pad(k, 18) + lp(t.n, 6) + lp((t.rounds / t.n).toFixed(2), 8) + lp((t.w0 / t.dec * 100).toFixed(1), 8) + lp(ci(wilson(t.w0, t.dec)), 9) + lp(zFromHalf(t.w0, t.dec), 7));
}
