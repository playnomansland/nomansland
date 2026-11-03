// Phase B: single-stat levers around the baseline (out/baseline.json), plus a gold calibration curve, for one opponent set.
// node tools/stat-levers/phaseB.js [all|early]
const L = require('./lib.js'), fs = require('fs'), path = require('path');
const set = process.argv[2] || 'all';
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/baseline.json'), 'utf8'))[set];
const OUT = path.join(__dirname, `out/phaseB-${set}.json`);
const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const mul = (k, f) => ({ [k]: +(base[k] * f).toFixed(4) });
const V = [];
for (const m of [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]) V.push(['gold', m, {}, m]);
for (const f of [0.7, 0.85, 1.15, 1.3, 1.5]) V.push(['hp', f, mul('hp', f)]);
for (const f of [0.7, 0.85, 1.15, 1.3, 1.5]) V.push(['hit', f, mul('hit', f)]);
for (const f of [0.7, 0.85, 1.15, 1.3, 1.5]) V.push(['aps', f, mul('aps', f)]);
for (const d of [-8, -4, -2, 2, 4, 8, 12]) V.push(['range', d, { range: Math.max(1, base.range + d) }]);
for (const f of [0.5, 0.75, 1.5, 2, 3]) V.push(['speed', f, mul('speed', f)]);
for (const a of [2, 4, 6, 10, 15]) V.push(['armor', a, { defense: 'armor', defVal: a }]);
for (const w of [20, 40, 80]) V.push(['ward', w, { defense: 'ward', defVal: w }]);
for (const s of [1, 2, 3, 4, 5]) V.push(['splash', s, { splash: s }]);
for (const p of [15, 30, 60]) V.push(['projSpeed', p, { projSpeed: p }]);
for (const w of [0.5, 1, 2]) V.push(['windUp', w, { windUp: w }]);
for (const f of [1 / 3, 0.5, 2, 4]) { const b = Math.max(1, Math.round(base.bodies * f)); if (b !== base.bodies) V.push(['bodies', b, { bodies: b, hp: +(base.hp * base.bodies / b).toFixed(3), hit: +(base.hit * base.bodies / b).toFixed(4) }]); }
(async () => {
  for (const [lever, v, d, m] of V) {
    const k = `${lever}:${v}`; if (res[k]) continue;
    const r = await L.evalUnit({ ...base, ...d }, { set, m: m || 1 });
    res[k] = { lever, v, d, avg: r.avg, sd: r.sd, win: r.win, scores: r.scores };
    console.log(set, k, r.avg.toFixed(3), r.sd.toFixed(3));
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); L.save();
  }
  L.stop();
})();
