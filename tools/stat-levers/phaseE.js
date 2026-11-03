// Phase E: each roster unit's "fair power": the factor p on its health and hit (skills as the counter table has them)
// at which it averages 0 against the roster at 3000 gold. Since health x hit scale like gold does (phase C), 1/p is
// roughly how its price compares with a fair one: p 0.8 -> 25% too strong for its price.
const L = require('./lib.js'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out/phaseE.json');
const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const scale = (u, p) => ({ ...u, hp: +(u.hp * p).toFixed(3), hit: +(u.hit * p).toFixed(4) });
async function solve(u) {
  let lo = null, hi = null, p = 1, best = null; const tries = [];
  for (let it = 0; it < 7; it++) {
    const r = await L.evalUnit(scale(u, p), { set: 'all' });
    tries.push([+p.toFixed(4), +r.avg.toFixed(4)]);
    if (!best || Math.abs(r.avg) < Math.abs(best.avg)) best = { p, avg: r.avg, sd: r.sd };
    if (Math.abs(r.avg) < 0.02) break;
    if (r.avg < 0) lo = { p, a: r.avg }; else hi = { p, a: r.avg };
    if (lo && hi) { const t = -lo.a / (hi.a - lo.a); p = Math.exp(Math.log(lo.p) + t * (Math.log(hi.p) - Math.log(lo.p))); }
    else p = r.avg < 0 ? p * (1 + Math.min(1.2, -r.avg * 1.6)) : p / (1 + Math.min(1.2, r.avg * 1.6));
  }
  return { ...best, tries };
}
(async () => {
  for (const u of L.OPP) {
    if (res[u.name]) continue;
    const t = Date.now();
    res[u.name] = await solve(u);
    console.log(u.name.padEnd(18), 'p', res[u.name].p.toFixed(3), 'avg', res[u.name].avg.toFixed(3), ((Date.now() - t) / 1000).toFixed(0) + 's');
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); L.save();
  }
  L.stop();
})();
