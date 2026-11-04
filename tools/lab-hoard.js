#!/usr/bin/env node
'use strict';

// Balance Lab, lab-only experiment: a "hoarder" AI against the normal AI, with the gold carry cap on or off.
// Nothing in src/ changes. Both are the game's own AI (Game.aiDeploy / Game.aiLevel) played through the server
// referee exactly as tools/balance-lab.js does; the hoarder only changes what the AI is shown:
//   - rounds 1..H (--hoard-rounds): its view shows only the gold above --keep (default: all of it kept, so it spends
//     nothing but free package squads), at deploy time and at fight time (no level-ups either);
//   - from round H+1: first a pass where its view leaves out every tier 1-2 unit (so it buys tier 3-4 only), then a
//     normal pass for what is left.
// The moves the AI makes on that view go to the referee one by one, as a phone sends them, so every move is a legal
// player move (refused and desyncs are counted as in the lab).
// --cap off: after each fight the lab gives back the gold the carry cap took (summary.capLost), before the next
// round starts: the same as CARRY_CAP = Infinity for these matches (loan payback and treasury steals are computed
// before the give-back; neither is on the Standard map's ranked path unless a bank loan is taken that round).
//
//   node tools/lab-hoard.js --matches 300 --seed 810000 --cap on --out hoard-on.json
// Options: --hoarder pure|none (none: normal v normal, a control), --hoard-rounds 3, --keep all|<gold>,
//          --map testgrid|random|<id>, --no-mirror, --max-rounds 30.
// The hoarder plays side 0 on even seeds and side 1 on odd seeds (side bias cancels out).

const fs = require('fs');
const path = require('path');
const Game = require('../src/game.js');
const Ref = require('../src/referee.js');
const Lab = require('./balance-lab.js');

function parseArgs(argv) {
  const o = { matches: 10, seed: 810000, cap: true, hoarder: 'pure', hoardRounds: 3, keep: Infinity, map: 'testgrid', mirror: true, maxRounds: 30, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--matches') o.matches = Number(argv[++i]);
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--cap') o.cap = argv[++i] !== 'off';
    else if (a === '--hoarder') o.hoarder = argv[++i];
    else if (a === '--hoard-rounds') o.hoardRounds = Number(argv[++i]);
    else if (a === '--keep') { const v = argv[++i]; o.keep = v === 'all' ? Infinity : Number(v); }
    else if (a === '--map') { o.map = argv[++i]; if (o.map === 'random') o.map = ''; }
    else if (a === '--no-mirror') o.mirror = false;
    else if (a === '--max-rounds') o.maxRounds = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else throw new Error('Unknown argument: ' + a);
  }
  return o;
}

const copy = (o) => JSON.parse(JSON.stringify(o));

// One side's moves on a view the policy may change. tweak(view) returns { held } (gold hidden from the AI).
function playSide(R, side, prepared, T, step, log, tweak) {
  const view = Ref.withUnits(copy(Ref.viewOf(R, side)), prepared.units, prepared.matrix);
  const t = tweak ? tweak(view) : { held: 0 };
  const acts = [];
  if (step === 'deploy') Game.aiDeploy(view, side, acts); else Game.aiLevel(view, side, acts);
  for (const x of acts) {
    const res = Ref.act(R, side, { seq: ++log.seq[side], fn: x.fn, a: x.a }, T);
    if (res.ok) { log.accepted++; continue; }
    log.refused.push({ round: R.m.round, side, step, fn: x.fn, a: x.a, why: res.why });
    break;
  }
  view.gold[side] += t.held; // the gold the AI was not shown, back before comparing
  if (t.off) view.off = t.off;
  if (Ref.sideHash(view, side) !== Ref.sideHash(R.m, side)) log.desyncs.push({ round: R.m.round, side, step });
  return acts;
}

function hoarderTweaks(o, units, round) {
  const hide = (view, side) => { const g = view.gold[side], keep = Math.min(g, o.keep); view.gold[side] = g - keep; return { held: keep }; };
  const low = units.map((u, i) => Game.tierOf(units, i) <= 2 ? i : -1).filter(i => i >= 0);
  const highOnly = (view) => { const was = view.off; view.off = (Array.isArray(was) ? was : []).concat(low); return { held: 0, off: was }; };
  if (round <= o.hoardRounds) return { deploy: [hide], level: hide };
  return { deploy: [highOnly, null], level: null };
}

function simulateMatch(prepared, seed, o) {
  const { units, matrix } = prepared;
  const settings = { ...Lab.RANKED, map: o.map, mirror: o.mirror };
  const R = Ref.create(settings, units);
  let T = 1e12;
  Ref.start(R, units, matrix, T, seed >>> 0);
  const log = { seq: [0, 0], accepted: 0, refused: [], desyncs: [] };
  const roundLog = [];
  const picks = { leaders: [null, null], towers: [null, null] };
  const hs = o.hoarder === 'none' ? -1 : seed % 2; // the hoarder's side
  const capLostTotal = [0, 0];

  while (R.phase === 'deploy' && !R.m.over && R.m.round <= o.maxRounds) {
    const round = R.m.round, goldStart = R.base.gold.slice();
    const tw = hoarderTweaks(o, units, round);
    const bought = [0, 1].map(side => {
      if (side !== hs) return playSide(R, side, prepared, T, 'deploy', log, null);
      let all = [];
      for (const f of tw.deploy) all = all.concat(playSide(R, side, prepared, T, 'deploy', log, f ? (v) => f(v, side) : null));
      return all;
    });
    const levels = [0, 1].map(side => playSide(R, side, prepared, T, 'level', log, side === hs && tw.level ? (v) => tw.level(v, side) : null));
    const goldAtFight = R.m.gold.slice();
    const spentOn = [0, 1].map(side => {
      const d = { units: [], skills: [], levelUps: 0, unlocks: [], other: {} };
      for (const { fn, a } of bought[side].concat(levels[side])) {
        if (fn === 'place') d.units.push(units[a[0]].name);
        else if (fn === 'buySkill') d.skills.push(units[a[0]].name + ': ' + ((units[a[0]].skillDefs || [])[a[1]] || {}).name);
        else if (fn === 'levelUp') d.levelUps++;
        else if (fn === 'unlock') d.unlocks.push(units[a[0]].name);
        else d.other[fn] = (d.other[fn] || 0) + 1;
      }
      return d;
    });
    T += 1000;
    Ref.setReady(R, 0, true, T);
    const f = Ref.setReady(R, 1, true, T);
    if (!f) throw new Error('round ' + round + ': the referee did not run the fight');
    const s = f.summary;
    const capLost = (s.capLost || [0, 0]).slice();
    if (!o.cap && !R.m.over) for (const sd of [0, 1]) R.m.gold[sd] += capLost[sd];
    for (const sd of [0, 1]) capLostTotal[sd] += capLost[sd];
    for (const side of [0, 1]) {
      if (R.m.chars && R.m.chars[side]) picks.leaders[side] = R.m.chars[side];
      if (R.m.towers && R.m.towers[side] && R.m.towers[side].type) picks.towers[side] = R.m.towers[side].type;
    }
    roundLog.push({
      round, winner: s.winner, damage: s.dmg, battleTime: Number((s.time || 0).toFixed(2)),
      gold: { start: goldStart, atFight: goldAtFight, after: R.m.gold.slice() },
      capLost: o.cap ? capLost : [0, 0], capWouldLose: capLost,
      armyCost: [0, 1].map(sd => R.m.armies[sd].reduce((a, q) => a + Game.unitCostOf(units[q.unit]) * (1 + 0.5 * (q.level || 0)), 0)),
      bought: spentOn,
      squads: s.squads.map(side => side.map(q => ({ unit: q.unit, level: q.level, survival: Number((q.left || 0).toFixed(4)), damageDealt: q.dealt || 0 })))
    });
    if (R.phase === 'end') break;
    Ref.next(R, 0, s.round, T); Ref.next(R, 1, s.round, T);
  }
  const m = R.m;
  return {
    seed: seed >>> 0, map: m.map ? m.map.id : null, winner: m.over ? m.winner : -1, completed: !!m.over,
    rounds: roundLog.length, hp: m.hp.slice(), gold: m.gold.slice(), armySizes: m.armies.map(a => a.length),
    leaders: picks.leaders, towers: picks.towers, hoarderSide: hs, cap: o.cap,
    capLost: o.cap ? capLostTotal : [0, 0],
    referee: { accepted: log.accepted, refused: log.refused, desyncs: log.desyncs },
    roundLog
  };
}

// The hoarder's results: match win rate, capLost, and per round its round-win rate, gold and army value against the bot's.
function hoardSummary(matches) {
  const out = { matches: matches.length, decided: 0, hoarderWins: 0, capLost: { hoarder: 0, normal: 0, matchesWithLossHoarder: 0 }, byRound: [] };
  const R = {};
  for (const mt of matches) {
    const h = mt.hoarderSide; if (h < 0) continue;
    const n = 1 - h;
    if (mt.completed && (mt.winner === 0 || mt.winner === 1)) { out.decided++; if (mt.winner === h) out.hoarderWins++; }
    const cl = mt.roundLog.reduce((a, r) => [a[0] + r.capWouldLose[h], a[1] + r.capWouldLose[n]], [0, 0]);
    out.capLost.hoarder += mt.cap ? cl[0] : 0; out.capLost.normal += mt.cap ? cl[1] : 0;
    if (mt.cap && cl[0] > 0) out.capLost.matchesWithLossHoarder++;
    for (const r of mt.roundLog) {
      const t = R[r.round] || (R[r.round] = { round: r.round, n: 0, hoarderRoundWins: 0, normalRoundWins: 0, goldStartH: 0, goldStartN: 0, spentH: 0, spentN: 0, armyH: 0, armyN: 0, dmgToH: 0, dmgToN: 0, capLostH: 0, aliveMatches: 0 });
      t.n++;
      const rw = r.damage[0] < r.damage[1] ? 0 : r.damage[1] < r.damage[0] ? 1 : -1; // a round goes to whoever took less damage
      if (rw === h) t.hoarderRoundWins++; else if (rw === n) t.normalRoundWins++;
      t.goldStartH += r.gold.start[h]; t.goldStartN += r.gold.start[n];
      t.spentH += r.gold.start[h] - r.gold.atFight[h]; t.spentN += r.gold.start[n] - r.gold.atFight[n];
      t.armyH += r.armyCost[h]; t.armyN += r.armyCost[n];
      t.dmgToH += r.damage[h] || 0; t.dmgToN += r.damage[n] || 0;
      t.capLostH += r.capWouldLose[h];
    }
  }
  out.hoarderWinRate = out.decided ? Number((out.hoarderWins / out.decided * 100).toFixed(1)) : null;
  const f = (x, k) => Number((x / k).toFixed(1));
  out.byRound = Object.values(R).sort((a, b) => a.round - b.round).map(t => ({
    round: t.round, matchesStillGoing: t.n,
    hoarderRoundWinPct: f(100 * t.hoarderRoundWins, t.n), normalRoundWinPct: f(100 * t.normalRoundWins, t.n),
    goldStart: [f(t.goldStartH, t.n), f(t.goldStartN, t.n)], spent: [f(t.spentH, t.n), f(t.spentN, t.n)],
    armyValue: [f(t.armyH, t.n), f(t.armyN, t.n)], dmgTaken: [f(t.dmgToH, t.n), f(t.dmgToN, t.n)],
    capWouldLoseHoarder: f(t.capLostH, t.n),
  }));
  return out;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const prepared = Lab.prepareRoster();
  const matches = [];
  for (let i = 0; i < o.matches; i++) matches.push(simulateMatch(prepared, (o.seed + i) >>> 0, o));
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    source: { engine: 'src/engine.js', game: 'src/game.js', units: prepared.source, tool: 'tools/lab-hoard.js' },
    config: { ...o, keep: o.keep === Infinity ? 'all' : o.keep, map: o.map || 'random' },
    summary: Lab.summarize(matches, prepared.units),
    hoard: hoardSummary(matches),
    matches
  };
  const s = report.summary;
  console.log('lab-hoard: ' + s.matches + ' matches, cap ' + (o.cap ? 'on' : 'off') + ', refused ' + s.referee.refused + ', desyncs ' + s.referee.desyncs + ', hoarder ' + report.hoard.hoarderWins + '/' + report.hoard.decided);
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, JSON.stringify(report, null, 2) + '\n'); }
}

if (require.main === module) { try { main(); } catch (e) { console.error(e.stack || e); process.exitCode = 1; } }
module.exports = { simulateMatch, hoardSummary, parseArgs };
