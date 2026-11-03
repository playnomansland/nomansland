// Phase D: (1) the main levers again against 24 mixed armies (3 roster units each) to check they hold outside
// one-unit fights; (2) roster units with their small splash taken away (is splash <= 2 m doing anything?).
const L = require('./lib.js'), fs = require('fs'), path = require('path');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/baseline.json'), 'utf8')).all;
const OUT = path.join(__dirname, 'out/phaseD.json');
const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const V = [];
for (const m of [0.7, 0.85, 1, 1.15, 1.3, 1.6]) V.push([`mixed:gold:${m}`, {}, 'mixed', m]);
const mods = { 'hp:1.3': { hp: base.hp * 1.3 }, 'hit:1.3': { hit: base.hit * 1.3 }, 'aps:1.3': { aps: 1.3 }, 'range:4': { range: base.range + 4 }, 'range:-4': { range: base.range - 4 },
  'speed:2': { speed: base.speed * 2 }, 'armor:6': { defense: 'armor', defVal: 6 }, 'ward:40': { defense: 'ward', defVal: 40 }, 'splash:3': { splash: 3 }, 'splash:2': { splash: 2 },
  'bodies:1': { bodies: 1, hp: base.hp * 3, hit: base.hit * 3 }, 'bodies:12': { bodies: 12, hp: base.hp / 4, hit: base.hit / 4 }, 'projSpeed:30': { projSpeed: 30 }, 'windUp:1': { windUp: 1 } };
for (const [k, d] of Object.entries(mods)) V.push([`mixed:${k}`, d, 'mixed', 1]);
for (const [name, to] of [['Earth Wizard', 0], ['Steel Wizard', 0], ['Ent', 0], ['Ember Imps', 2], ['Fire Mage', 2], ['Fire Mage', 0]]) {
  const u = L.OPP.find(x => x.name === name);
  V.push([`roster:${name}:splash${u.splash}`, { ...u }, 'all', 1]);
  V.push([`roster:${name}:splash${to}`, { ...u, splash: to }, 'all', 1]);
}
(async () => {
  for (const [k, d, set, m] of V) {
    if (res[k]) continue;
    const u = { ...(k.startsWith('mixed') ? base : {}), ...d };
    const r = await L.evalUnit(u, { set, m });
    res[k] = { d, set, m, avg: r.avg, sd: r.sd, win: r.win, scores: r.scores };
    console.log(k, r.avg.toFixed(3), r.sd.toFixed(3));
    fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); L.save();
  }
  L.stop();
})();
