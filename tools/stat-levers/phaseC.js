// Phase C: coupled stats around the baseline (out/baseline.json). node tools/stat-levers/phaseC.js [all|early]
const L = require('./lib.js'), fs = require('fs'), path = require('path');
const set = process.argv[2] || 'all';
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/baseline.json'), 'utf8'))[set];
const OUT = path.join(__dirname, `out/phaseC-${set}.json`);
const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const V = [];
const F = [0.6, 0.8, 1, 1.25, 1.6];
for (const a of F) for (const b of F) V.push([`hpXhit:${a}:${b}`, { hp: base.hp * a, hit: base.hit * b }]);
for (const rg of [2, 8, 14, 20, 26]) for (const sp of [1.5, 3, 5, 8]) V.push([`rangeXspeed:${rg}:${sp}`, { range: rg, speed: sp }]);
for (const aps of [0.25, 0.5, 1, 2, 4]) V.push([`apsVsHit:${aps}`, { aps: base.aps * aps, hit: base.hit / aps }]);
for (const b of [1, 2, 3, 6, 12, 24]) V.push([`split:${b}`, { bodies: b, hp: base.hp * base.bodies / b, hit: base.hit * base.bodies / b }]);
V.push(['level:1', { level: 1 }, 1 / 1.5]); V.push(['level:2', { level: 2 }, 1 / 2]);
for (const rg of [2, 8, 14, 20, 26, 32]) for (const f of [0.5, 0.75, 1.5, 2]) V.push([`rangeXhp:${rg}:${f}`, { range: rg, hp: base.hp * f }]);
for (const a of [0, 5, 10]) for (const f of [0.6, 1, 1.6]) V.push([`armorXhit:${a}:${f}`, { defense: a ? 'armor' : 'none', defVal: a, hit: base.hit * f, hp: base.hp / f }]);
for (const s of [0, 2, 4]) for (const b of [1, 3, 8]) V.push([`splashXbodies:${s}:${b}`, { splash: s, bodies: b, hp: base.hp * base.bodies / b, hit: base.hit * base.bodies / b }]);
(async () => {
  for (const [k, d, m] of V) {
    if (res[k]) continue;
    const u = { ...base, ...d }; for (const x of ['hp', 'hit', 'aps']) u[x] = +(+u[x]).toFixed(4);
    const r = await L.evalUnit(u, { set, m: m || 1 });
    res[k] = { d, m: m || 1, avg: r.avg, sd: r.sd, win: r.win, scores: r.scores };
    console.log(set, k, r.avg.toFixed(3), r.sd.toFixed(3));
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); L.save();
  }
  L.stop();
})();
