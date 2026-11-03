// Stat-lever lab: runs a "probe" unit (plain stats, no skills) against the roster's counter-table units with the real
// engine, at the counter table's settings, and caches every result. Used by tools/stat-levers/run.js.
// Score per battle = the engine's score (probe's health left minus the opponent's, -1..1), as in src/demo-units.json.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '../..');
const E = require(path.join(ROOT, 'src/engine.js'));
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };

function roster() {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/default-roster.json'), 'utf8'));
  const units = r.units.map(({ skillsOn, ...u }) => ({ ...u, cost: u.cost / 100 }));
  return units.map(u => E.innateUnit(u, r.skills, units));
}
// opponent sets: 'all' = whole roster at 3000 gold (the counter table); 'early' = tier 1-2 units at 1000 gold
const SETS = {
  all: { budget: 30, pick: (u) => true },
  early: { budget: 10, pick: (u) => u.cost <= 2 },
  late: { budget: 30, pick: (u) => u.cost >= 3 },
  mixed: { budget: 30, mixed: true }, // 24 mixed armies of 3 roster units, 1000 gold each, shortest range in front
};
// the mixed armies: seeded, so every run fights the same ones
function mixedArmies(opp) {
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (let k = 0; k < 24; k++) {
    const pick = []; while (pick.length < 3) { const i = Math.floor(rnd() * opp.length); if (!pick.includes(i)) pick.push(i); }
    pick.sort((a, b) => opp[a].range - opp[b].range);
    out.push({ name: 'Mix ' + (k + 1) + ': ' + pick.map(i => opp[i].name).join(' + '), list: pick.map(i => i) });
  }
  return out;
}
if (!isMainThread) {
  const opp = roster(), mix = mixedArmies(opp);
  parentPort.on('message', ({ id, probe, gold, set, idx, budget }) => {
    const g = { ...G, budget };
    const o = SETS[set].mixed ? mix[idx].list.map(i => ({ unit: opp[i], gold: budget / 3 })) : opp[idx];
    const res = E.battle([{ unit: probe, gold }], o, g, { targetingMode: 'indexed' });
    parentPort.postMessage({ id, score: res.score, win: res.winner === 0 ? 1 : res.winner === 1 ? 0 : 0.5, time: res.time, frac: res.frac });
  });
  return;
}

const PROBE_BASE = { name: 'Probe', cost: 1, bodies: 3, hp: 100, hit: 13, aps: 1, range: 14, speed: 3, splash: 0, defense: 'none', defVal: 0, projSpeed: 0, shape: 'circle' };
const CACHE_FILE = process.env.SL_CACHE || path.join(__dirname, 'cache.json');
let cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
const ENG = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'src/engine.js'))).digest('hex').slice(0, 8);
const key = (probe, gold, set, name) => crypto.createHash('sha1').update(JSON.stringify([ENG, probe, gold, set, name])).digest('hex').slice(0, 16);
let dirty = 0;
function save() { if (dirty) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; } }

const OPP = roster();
const N = Math.max(1, os.cpus().length);
const workers = [], queue = [], waiting = new Map(); let nextId = 0;
function pump() {
  for (const w of workers) if (!w.busy && queue.length) { const job = queue.shift(); w.busy = true; w.job = job; w.postMessage(job.msg); }
}
function start() {
  if (workers.length) return;
  for (let i = 0; i < N; i++) {
    const w = new Worker(__filename); w.busy = false;
    w.on('message', (m) => { const job = w.job; w.busy = false; w.job = null; job.done(m); pump(); });
    w.on('error', (e) => { console.error(e); process.exit(1); });
    workers.push(w);
  }
}
function stop() { save(); for (const w of workers) w.terminate(); workers.length = 0; }
const MIX = mixedArmies(OPP);
const oppName = (set, idx) => SETS[set].mixed ? MIX[idx].name : OPP[idx].name;
function run1(probe, gold, set, idx) {
  const k = key(probe, gold, set, oppName(set, idx));
  if (cache[k]) return Promise.resolve(cache[k]);
  start();
  return new Promise((ok) => {
    queue.push({ msg: { id: nextId++, probe, gold, set, idx, budget: SETS[set].budget }, done: (m) => { const v = { s: +m.score.toFixed(4), w: m.win, t: +m.time.toFixed(1) }; cache[k] = v; dirty++; if (dirty > 50) save(); ok(v); } });
    pump();
  });
}
// a unit (probe) against every opponent in a set; gold multiplier m (1 = the set's budget)
async function evalUnit(probe, { set = 'all', m = 1 } = {}) {
  const p = { ...PROBE_BASE, ...probe };
  const gold = SETS[set].budget * m;
  const idx = SETS[set].mixed ? MIX.map((_, i) => i) : OPP.map((u, i) => SETS[set].pick(u) ? i : -1).filter(i => i >= 0);
  const res = await Promise.all(idx.map(i => run1(p, gold, set, i)));
  const s = res.map(r => r.s);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - avg) * (b - avg), 0) / s.length);
  const win = res.reduce((a, r) => a + r.w, 0) / res.length;
  return { avg, sd, win, scores: Object.fromEntries(idx.map((i, k) => [oppName(set, i), s[k]])), times: res.map(r => r.t) };
}
module.exports = { evalUnit, stop, save, OPP, MIX, SETS, PROBE_BASE, E, G };
