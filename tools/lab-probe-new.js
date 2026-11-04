#!/usr/bin/env node
'use strict';

// Lab-only probe: the units and skills changed on 3-4 November 2026 (Sniper's Hunter, Water Mage's water elemental,
// the Spiders rework, Sun Priest) against every roster unit, at the counter table's settings (tools/counter-table.js:
// distance 42, innate skills on, fast paths), with the real engine. Nothing in src/ changes.
//
// Each variant fights each roster unit (one unit type a side) at two gold amounts. A bought skill is paid out of the
// variant's gold ("paid": its gold minus the skill's price), and also shown free (gold untouched) to separate what the
// skill does from what it costs.
// Hunter is an Awaken skill on one squad: one awakened Sniper squad among the Snipers, its mark on one enemy squad
// (the engine's b.prey on that squad's bodies, as Game.startBattle sets it). Score: the engine's battle score for the
// variant (its health left minus the opponent's, -1..+1), as in src/demo-units.json.
//
//   node tools/lab-probe-new.js --out tools/lab-runs/2026-11-04/probe-new.json [--workers 3]

const fs = require('fs'), os = require('os'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'src/engine.js'));
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
const BUDGETS = [15, 30]; // lab units: 1500 and 3000 gold a side

function load() {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/default-roster.json'), 'utf8'));
  const units = r.units.map(({ skillsOn, ...u }) => ({ ...u, cost: u.cost / 100 }));
  const inn = units.map(u => E.innateUnit(u, r.skills, units));
  const skill = (id) => r.skills.find(s => s.id === id);
  return { r, units, inn, skill };
}

// variants: { name, unit, list(gold) -> army list, prey: mark the opponent's first squad }
function variants({ units, inn, skill }) {
  const at = (n) => units.findIndex(u => u.name === n);
  const withSkill = (n, id) => E.applySkills(inn[at(n)], [skill(id)], units);
  const out = [];
  const plain = (n) => out.push({ name: n, base: n, skill: null, price: 0, army: (g) => [{ unit: inn[at(n)], gold: g }] });
  const typeSkill = (n, id) => {
    const s = skill(id), u = withSkill(n, id), price = s.cost / 100;
    out.push({ name: n + ' + ' + s.name + ' (paid)', base: n, skill: s.name, price, army: (g) => [{ unit: u, gold: g - price }] });
    out.push({ name: n + ' + ' + s.name + ' (free)', base: n, skill: s.name, price: 0, army: (g) => [{ unit: u, gold: g }] });
  };
  plain('Sniper');
  { // Hunter: one awakened squad (its own 100 gold), the rest plain Snipers; the awakening costs the skill's price
    const s = skill('hunter'), hu = withSkill('Sniper', 'hunter'), sn = inn[at('Sniper')], price = s.cost / 100, c = units[at('Sniper')].cost;
    out.push({ name: 'Sniper + Hunter, 1 squad awake (paid)', base: 'Sniper', skill: 'Hunter', price, prey: true, army: (g) => [{ unit: hu, gold: c }, { unit: sn, gold: g - c - price }] });
    out.push({ name: 'Sniper + Hunter, 1 squad awake (free)', base: 'Sniper', skill: 'Hunter', price: 0, prey: true, army: (g) => [{ unit: hu, gold: c }, { unit: sn, gold: g - c }] });
  }
  plain('Water Mage'); typeSkill('Water Mage', 'waterElemental');
  plain('Spiders'); for (const id of ['poisonousFangs', 'spiderlings', 'cavestalkers', 'webShots']) typeSkill('Spiders', id);
  plain('Sun Priest'); typeSkill('Sun Priest', 'split'); typeSkill('Sun Priest', 'shrink');
  return out;
}

if (!isMainThread) {
  const L = load(), V = variants(L);
  parentPort.on('message', ({ id, v, o, budget }) => {
    const g = { ...G, budget };
    const vv = V[v], opp = L.inn[o];
    const A = E.makeArmy(vv.army(budget), 0, g), B = E.makeArmy([{ unit: opp, gold: budget }], 1, g);
    if (vv.prey) { const n = E.withTraits(opp).bodies; for (const b of B.slice(0, n)) b.prey = true; }
    const bt = E.createBattle(A, B, g, { targetingMode: 'indexed' });
    while (bt.step()) {}
    const res = bt.result();
    parentPort.postMessage({ id, score: res.score, winner: res.winner, time: res.time });
  });
  return;
}

async function main() {
  const argv = process.argv.slice(2);
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
  const nw = argv.includes('--workers') ? Number(argv[argv.indexOf('--workers') + 1]) : Math.max(1, os.cpus().length - 1);
  const L = load(), V = variants(L);
  const opps = L.units.map((u, i) => u.building ? -1 : i).filter(i => i >= 0);
  const jobs = [];
  V.forEach((_, v) => opps.forEach(o => BUDGETS.forEach(budget => jobs.push({ id: jobs.length, v, o, budget }))));
  const res = new Array(jobs.length);
  const t0 = Date.now();
  await new Promise((ok) => {
    let next = 0, done = 0;
    const ws = Array.from({ length: nw }, () => new Worker(__filename));
    const feed = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (const w of ws) {
      w.on('message', (m) => { res[m.id] = m; done++; if (done % 100 === 0) console.log(done + '/' + jobs.length + ' battles, ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s'); if (done === jobs.length) { ws.forEach(x => x.terminate()); ok(); } else feed(w); });
      w.on('error', (e) => { console.error(e); process.exit(1); });
      feed(w);
    }
  });
  const table = V.map((vv, v) => {
    const row = { variant: vv.name, base: vv.base, skill: vv.skill, skillPrice: vv.price * 100, byBudget: {} };
    for (const budget of BUDGETS) {
      const js = jobs.filter(j => j.v === v && j.budget === budget);
      const s = js.map(j => res[j.id].score);
      const avg = s.reduce((a, b) => a + b, 0) / s.length;
      const wins = js.filter(j => res[j.id].winner === 0).length;
      const per = Object.fromEntries(js.map(j => [L.units[j.o].name, +res[j.id].score.toFixed(3)]));
      const sorted = Object.entries(per).sort((a, b) => a[1] - b[1]);
      row.byBudget[budget * 100] = { avg: +avg.toFixed(3), wins, of: js.length, worst: sorted.slice(0, 4), best: sorted.slice(-4).reverse(), scores: per };
    }
    return row;
  });
  for (const row of table) console.log(row.variant.padEnd(44) + BUDGETS.map(b => { const x = row.byBudget[b * 100]; return (b * 100 + ': ' + (x.avg >= 0 ? '+' : '') + x.avg.toFixed(2) + ' wins ' + x.wins + '/' + x.of).padEnd(26); }).join(''));
  const report = { generatedAt: new Date().toISOString(), tool: 'tools/lab-probe-new.js', settings: { ...G, budgets: BUDGETS.map(b => b * 100), opponents: opps.length, targetingMode: 'indexed' }, seconds: Math.round((Date.now() - t0) / 1000), table };
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); console.log('Written to ' + out); }
}
main().catch(e => { console.error(e); process.exit(1); });
