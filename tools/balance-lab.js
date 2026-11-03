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
const Ref = require('../src/referee.js');

// Match settings as the game server's ranked matches use them (server/src/room.js RANKED): the Standard map (testgrid),
// 5 package offers, mirrored offers, no Blixten. --map / --no-mirror change them.
const RANKED = Object.freeze({ map: 'testgrid', packOptions: 5, mirror: true, offChars: ['blixten'], offUnits: [], offTowers: [] });
const DEFAULTS = Object.freeze({ matches: 10, seed: 700000, maxRounds: 30, map: RANKED.map, mirror: RANKED.mirror });

function parseArgs(argv) {
  const out = { ...DEFAULTS, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matches') out.matches = Number(argv[++i]);
    else if (a === '--seed') out.seed = Number(argv[++i]);
    else if (a === '--max-rounds') out.maxRounds = Number(argv[++i]);
    else if (a === '--map') { out.map = String(argv[++i]); if (out.map === 'random') out.map = ''; }
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

const copy = (o) => JSON.parse(JSON.stringify(o));
const unitName = (units, ui) => (units[ui] && units[ui].name) || String(ui);
const skillName = (units, ui, k) => { const d = units[ui] && units[ui].skillDefs && units[ui].skillDefs[k]; return d ? d.name : 'slot ' + k; };

// One side's moves, made by the game's AI on what that side may see (the referee's view: none of the opponent's new
// squads, buys or picks this round), then sent to the referee one by one exactly as a phone sends them. Returns them.
function playSide(R, side, prepared, T, step, log) {
  const view = Ref.withUnits(copy(Ref.viewOf(R, side)), prepared.units, prepared.matrix);
  const acts = [];
  if (step === 'deploy') Game.aiDeploy(view, side, acts); else Game.aiLevel(view, side, acts);
  for (const x of acts) {
    const res = Ref.act(R, side, { seq: ++log.seq[side], fn: x.fn, a: x.a }, T);
    if (res.ok) { log.accepted++; continue; }
    log.refused.push({ round: R.m.round, side, step, fn: x.fn, a: x.a, why: res.why });
    break; // a refused phone gets the server's state back: the rest of its moves are moot
  }
  if (Ref.sideHash(view, side) !== Ref.sideHash(R.m, side)) log.desyncs.push({ round: R.m.round, side, step });
  return acts;
}

// What a side's moves bought, in words the report can count.
function describeActs(units, m, side, acts) {
  const out = { units: [], skills: [], levelUps: 0, unlocks: [], other: {} };
  const unitOfSquad = (id) => { const q = m.armies[side].find(s => s.id === id); return q ? q.unit : null; };
  for (const { fn, a } of acts) {
    if (fn === 'place') out.units.push(unitName(units, a[0]));
    else if (fn === 'buySkill') out.skills.push(unitName(units, a[0]) + ': ' + skillName(units, a[0], a[1]));
    else if (fn === 'levelUp') out.levelUps++;
    else if (fn === 'unlock') out.unlocks.push(unitName(units, a[0]));
    else if (fn === 'awaken') { const ui = unitOfSquad(a[0]); out.skills.push((ui == null ? '?' : unitName(units, ui)) + ': Awaken'); }
    else out.other[fn] = (out.other[fn] || 0) + 1;
  }
  return out;
}

// One whole match, refereed like a server match: the referee (src/referee.js) starts it, takes every move, runs each
// fight with the same settling as the server (default packages, tower picks and walls) and moves on to the next round.
// Both sides are the game's AI: aiDeploy while deploying, aiLevel at fight time (as the page's AI and the server's
// tournament bots do).
function simulateMatch(prepared, seed, options = {}) {
  const { units, matrix } = prepared;
  const settings = { ...RANKED, map: options.map != null ? options.map : RANKED.map, mirror: options.mirror != null ? !!options.mirror : RANKED.mirror };
  const maxRounds = options.maxRounds || DEFAULTS.maxRounds;
  const R = Ref.create(settings, units);
  let T = 1e12; // the referee's clock (ms); nobody waits here
  Ref.start(R, units, matrix, T, seed >>> 0);
  const log = { seq: [0, 0], accepted: 0, refused: [], desyncs: [] };
  const roundLog = [];
  const picks = { leaders: [null, null], towers: [null, null], packs: [null, null] };

  while (R.phase === 'deploy' && !R.m.over && R.m.round <= maxRounds) {
    const round = R.m.round, goldStart = R.base.gold.slice();
    const bought = [0, 1].map(side => playSide(R, side, prepared, T, 'deploy', log));
    const levels = [0, 1].map(side => playSide(R, side, prepared, T, 'level', log));
    const goldAtFight = R.m.gold.slice();
    const spentOn = [0, 1].map(side => describeActs(units, R.m, side, bought[side].concat(levels[side])));
    T += 1000;
    Ref.setReady(R, 0, true, T);
    const f = Ref.setReady(R, 1, true, T);
    if (!f) throw new Error('round ' + round + ': the referee did not run the fight');
    const s = f.summary;
    for (const side of [0, 1]) {
      if (R.m.chars && R.m.chars[side]) picks.leaders[side] = R.m.chars[side];
      if (R.m.towers && R.m.towers[side] && R.m.towers[side].type) picks.towers[side] = R.m.towers[side].type;
    }
    roundLog.push({
      round,
      winner: s.winner,
      damage: s.dmg,
      battleTime: Number((s.time || 0).toFixed(2)),
      gold: { start: goldStart, atFight: goldAtFight, after: R.m.gold.slice() },
      bought: spentOn,
      squads: s.squads.map(side => side.map(q => ({
        unit: q.unit,
        level: q.level,
        survival: Number((q.left || 0).toFixed(4)),
        damageDealt: q.dealt || 0
      })))
    });
    if (R.phase === 'end') break;
    Ref.next(R, 0, s.round, T); Ref.next(R, 1, s.round, T);
  }
  const m = R.m;
  return {
    seed: seed >>> 0,
    map: m.map ? m.map.id : null,
    winner: m.over ? m.winner : -1,
    completed: !!m.over,
    rounds: roundLog.length,
    hp: m.hp.slice(),
    gold: m.gold.slice(),
    armySizes: m.armies.map(a => a.length),
    leaders: picks.leaders,
    towers: picks.towers,
    referee: { accepted: log.accepted, refused: log.refused, desyncs: log.desyncs },
    roundLog
  };
}

const pct = (a, b) => b ? Number((a / b * 100).toFixed(1)) : null;
const avg = (a, b) => b ? Number((a / b).toFixed(1)) : null;
// a tally of picks: games, wins (completed matches only) and the win rate, most played first
function table(map) {
  return Object.entries(map).map(([name, t]) => ({ name, games: t.games, wins: t.wins, winRate: pct(t.wins, t.decided) }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}
function tally(map, key, won, decided) {
  const t = map[key] || (map[key] = { games: 0, wins: 0, decided: 0 });
  t.games++; if (decided) { t.decided++; if (won) t.wins++; }
}

function summarize(results, units) {
  const wins = [0, 0], damageTaken = [0, 0], hpRemaining = [0, 0];
  let completed = 0, unfinished = 0, totalRounds = 0;
  const unitStats = units.map((u, index) => ({
    index, name: u.name, squadRounds: 0, damageDealt: 0,
    survivalTotal: 0, appearances: 0, bought: 0, matches: 0, matchWins: 0, decided: 0
  }));
  const leaders = {}, towers = {}, skills = {}, refusedBy = {};
  const econ = { rounds: 0, start: 0, atFight: 0, earned: 0, earnedN: 0, levelUps: 0, other: {} };
  let accepted = 0, refused = 0, desyncs = 0;

  for (const match of results) {
    const decided = match.completed && (match.winner === 0 || match.winner === 1);
    if (decided) { wins[match.winner]++; completed++; } else unfinished++;
    totalRounds += match.rounds;
    accepted += match.referee.accepted; refused += match.referee.refused.length; desyncs += match.referee.desyncs.length;
    for (const x of match.referee.refused) { const k = x.fn + ' (' + x.why + ')'; refusedBy[k] = (refusedBy[k] || 0) + 1; }
    for (let side = 0; side < 2; side++) {
      const won = decided && match.winner === side;
      hpRemaining[side] += match.hp[side];
      if (match.leaders[side]) { const c = Game.charInfo(match.leaders[side]); tally(leaders, c ? c.name : match.leaders[side], won, decided); }
      if (match.towers[side]) { const t = Game.TOWER_TYPES.find(x => x.id === match.towers[side]); tally(towers, t ? t.name : match.towers[side], won, decided); }
      const fielded = new Set(), skillSet = new Set();
      for (const [k, round] of match.roundLog.entries()) {
        damageTaken[side] += round.damage[side] || 0;
        const b = round.bought[side];
        for (const name of b.units) { const st = unitStats.find(u => u.name === name); if (st) st.bought++; }
        for (const sk of b.skills) skillSet.add(sk);
        econ.levelUps += b.levelUps;
        for (const fn in b.other) econ.other[fn] = (econ.other[fn] || 0) + b.other[fn];
        econ.rounds++; econ.start += round.gold.start[side]; econ.atFight += round.gold.atFight[side];
        const nextStart = k + 1 < match.roundLog.length ? match.roundLog[k + 1].gold.start[side] : null;
        if (nextStart != null) { econ.earned += nextStart - round.gold.atFight[side]; econ.earnedN++; }
        for (const squad of round.squads[side]) {
          const stat = unitStats[squad.unit];
          if (!stat) continue;
          fielded.add(squad.unit);
          stat.squadRounds++;
          stat.appearances++;
          stat.damageDealt += squad.damageDealt;
          stat.survivalTotal += squad.survival;
        }
      }
      for (const ui of fielded) { const st = unitStats[ui]; st.matches++; if (decided) { st.decided++; if (won) st.matchWins++; } }
      for (const sk of skillSet) tally(skills, sk, won, decided);
    }
  }

  for (const s of unitStats) {
    s.avgSurvival = s.appearances ? Number((s.survivalTotal / s.appearances).toFixed(4)) : null;
    s.avgDamagePerSquadRound = avg(s.damageDealt, s.squadRounds);
    s.winRateWhenFielded = pct(s.matchWins, s.decided);
    delete s.survivalTotal; delete s.decided;
    if (!s.appearances) { delete s.avgSurvival; delete s.avgDamagePerSquadRound; }
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
    referee: { accepted, refused, desyncs, refusedBy },
    economy: {
      sideRounds: econ.rounds,
      avgGoldAtRoundStart: avg(econ.start, econ.rounds),
      avgGoldLeftAtFight: avg(econ.atFight, econ.rounds),
      avgGoldSpentPerRound: avg(econ.start - econ.atFight, econ.rounds),
      avgGoldEarnedPerRound: avg(econ.earned, econ.earnedN), // between one fight and the next round
      levelUps: econ.levelUps,
      otherPurchases: econ.other
    },
    leaders: table(leaders),
    towers: table(towers),
    skills: table(skills),
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
    config: { matches: config.matches, seed: config.seed >>> 0, maxRounds: config.maxRounds, map: config.map || 'random', mirror: !!config.mirror, settings: 'server ranked (RANKED)', ai: 'Game.aiDeploy + Game.aiLevel, refereed (src/referee.js)' },
    summary: summarize(results, prepared.units),
    matches: results
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/balance-lab.js [--matches 10] [--seed 700000] [--max-rounds 30] [--map testgrid|random|<id>] [--no-mirror] [--out report.json]');
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

module.exports = { DEFAULTS, RANKED, parseArgs, prepareRoster, stepBattle, simulateMatch, summarize, runBatch };
