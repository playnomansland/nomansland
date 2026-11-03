// Phase A: for each body count x range, find the power (health and hit both x p) at which the probe averages 0
// against the whole roster, and how spread out its matchups are there.
const L = require('./lib.js'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out/phaseA.json'); fs.mkdirSync(path.dirname(OUT), { recursive: true });
const HPG = 300, DPSG = 39; // per 100 gold at p = 1 (about the roster's medians)
async function solve(shape, set = 'all') {
  const mk = (p) => ({ ...shape, hp: +(HPG / shape.bodies * p).toFixed(2), hit: +(DPSG / shape.bodies / shape.aps * p).toFixed(3) });
  let lo = null, hi = null, p = 1, best = null;
  for (let it = 0; it < 8; it++) {
    const r = await L.evalUnit(mk(p), { set });
    if (!best || Math.abs(r.avg) < Math.abs(best.r.avg)) best = { p, r };
    if (Math.abs(r.avg) < 0.015) break;
    if (r.avg < 0) lo = { p, a: r.avg }; else hi = { p, a: r.avg };
    if (lo && hi) { // secant in log p
      const t = (0 - lo.a) / (hi.a - lo.a); p = Math.exp(Math.log(lo.p) + t * (Math.log(hi.p) - Math.log(lo.p)));
    } else p = r.avg < 0 ? p * (1 + Math.min(1.5, -r.avg * 3)) : p / (1 + Math.min(1.5, r.avg * 3));
  }
  return { shape, p: best.p, unit: mk(best.p), avg: best.r.avg, sd: best.r.sd, win: best.r.win, scores: best.r.scores };
}
(async () => {
  const set = process.argv[2] || 'all';
  const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const bodies of [1, 3, 8]) for (const range of [2, 8, 14, 20, 26]) {
    const k = `${set}:b${bodies}:r${range}`; if (res[k]) continue;
    const t = Date.now();
    const shape = { bodies, range, speed: 3, aps: 1, splash: 0, projSpeed: 0 };
    res[k] = await solve(shape, set);
    console.log(k, 'p', res[k].p.toFixed(3), 'avg', res[k].avg.toFixed(3), 'sd', res[k].sd.toFixed(3), ((Date.now() - t) / 1000).toFixed(0) + 's');
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); L.save();
  }
  L.stop();
})();
