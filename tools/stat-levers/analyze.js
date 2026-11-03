// Turns the phase A/B/C results into out/summary.json (the numbers the stat-levers deck and docs use).
// Gold-equivalent: the gold multiplier at which the plain baseline scores what the variant scores (from its gold curve).
const fs = require('fs'), path = require('path');
const O = (f) => { const p = path.join(__dirname, 'out', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const OPP = require('./lib.js').OPP; // roster units with innate skills, as the counter table fights them
const A = O('phaseA.json'), base = O('baseline.json');
const out = { baseline: base, phaseA: {}, sets: {} };
for (const [k, v] of Object.entries(A || {})) out.phaseA[k] = { p: v.p, avg: v.avg, sd: v.sd, unit: v.unit };

function goldCurve(B) {
  const pts = Object.values(B).filter(x => x.lever === 'gold').map(x => [x.v, x.avg]).sort((a, b) => a[0] - b[0]);
  return pts;
}
// gold multiplier for a score, by linear interpolation in log(m), clamped
function goldEq(pts, a) {
  if (a <= pts[0][1]) return { m: pts[0][0], clamp: -1 };
  for (let i = 1; i < pts.length; i++) {
    const [m0, a0] = pts[i - 1], [m1, a1] = pts[i];
    if (a <= a1) { const t = a1 === a0 ? 0 : (a - a0) / (a1 - a0); return { m: Math.exp(Math.log(m0) + t * (Math.log(m1) - Math.log(m0))), clamp: 0 }; }
  }
  return { m: pts[pts.length - 1][0], clamp: 1 };
}
const oppInfo = Object.fromEntries(OPP.map(u => [u.name, {
  cost: u.cost, bodies: u.bodies, hit: u.hit, hitPerShot: u.hit * Math.max(1, u.pellets || 1), range: u.range, splash: u.splash || 0,
  armor: u.defense === 'armor' ? u.defVal : 0, aps: u.aps, speed: u.speed,
  bodiesPerGold: u.bodies / u.cost, // bodies per 100 gold
}]));
out.opponents = oppInfo;
for (const set of ['all', 'early']) {
  const B = O(`phaseB-${set}.json`); if (!B) continue;
  const C = O(`phaseC-${set}.json`) || {};
  const pts = goldCurve(B);
  const g0 = B['gold:1'];
  const rows = Object.values(B).filter(x => x.lever !== 'gold').map(x => {
    const ge = goldEq(pts, x.avg);
    // per-opponent change vs the baseline
    const delta = Object.fromEntries(Object.keys(x.scores).map(n => [n, +(x.scores[n] - g0.scores[n]).toFixed(4)]));
    return { lever: x.lever, v: x.v, avg: +x.avg.toFixed(4), sd: +x.sd.toFixed(4), win: x.win, gold: +ge.m.toFixed(4), clamp: ge.clamp, delta };
  });
  const cRows = Object.entries(C).map(([k, x]) => ({ k, d: x.d, m: x.m, avg: +x.avg.toFixed(4), sd: +x.sd.toFixed(4), win: x.win, gold: +goldEq(pts, x.avg).m.toFixed(4), scores: x.scores }));
  out.sets[set] = { goldCurve: pts, base: { avg: g0.avg, sd: g0.sd, win: g0.win, scores: g0.scores }, levers: rows, coupled: cRows };
}
// phase D: mixed armies, as gold equivalents on their own gold curve; plus the roster splash check
const D = O('phaseD.json');
if (D) {
  const pts = Object.entries(D).filter(([k]) => k.startsWith('mixed:gold:')).map(([k, v]) => [+k.split(':')[2], v.avg]).sort((a, b) => a[0] - b[0]);
  out.mixed = { goldCurve: pts, levers: Object.entries(D).filter(([k]) => k.startsWith('mixed:') && !k.startsWith('mixed:gold')).map(([k, v]) => ({ k: k.slice(6), avg: +v.avg.toFixed(4), gold: +goldEq(pts, v.avg).m.toFixed(4) })) };
  out.rosterSplash = Object.entries(D).filter(([k]) => k.startsWith('roster:')).map(([k, v]) => ({ k: k.slice(7), avg: +v.avg.toFixed(4) }));
}
// phase E: each roster unit's worth / price = 1 / p
const Ep = O('phaseE.json');
if (Ep) out.rosterWorth = Object.entries(Ep).map(([n, v]) => ({ name: n, p: +v.p.toFixed(4), worth: +(1 / v.p).toFixed(3), avg: +v.avg.toFixed(4) })).sort((a, b) => b.worth - a.worth);
fs.writeFileSync(path.join(__dirname, 'out/summary.json'), JSON.stringify(out, null, 1));
require('./lib.js').stop();
console.log('wrote out/summary.json');
