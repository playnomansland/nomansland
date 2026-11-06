#!/usr/bin/env node
// Worst case on the 3D board (docs/RENDER-BUDGET.md, step 2).
// Runs a Balance Lab batch (AI vs AI, refereed, ranked settings) and watches every fight step by step: how many bodies
// stand on the board at once (both sides), and how many unit triangles that is with each body's own model
// (Models3D.kindOf, as render3d.js picks it; no skins, the AI wears none). Structures (towers, buildings, walls,
// treasury), projectiles in flight and shots fired are counted apart. Prints the worst fights and writes the match as it
// stood before the fight with the most bodies, so the stress page (lab3d.html?stress) can play that very fight.
// Usage: node tools/tri-budget/worst.js [--matches 40] [--seed 700000] [--mirror] [--out tools/tri-budget/worst.json]
const fs = require('fs'), path = require('path');
const Game = require('../../src/game.js');
const Lab = require('../balance-lab.js');
const { load, ROOT } = require('./models.js');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const MATCHES = Number(opt('--matches', 40)), SEED = Number(opt('--seed', 700000)), MIRROR = args.includes('--mirror');
const OUT = path.resolve(opt('--out', path.join(__dirname, 'worst.json')));

(async () => {
  const { models, tris } = await load();
  const triOf = {}; const t = (u) => { const k = models.kindOf(u); return triOf[k] != null ? triOf[k] : (triOf[k] = tris(k)); };
  const fights = [];
  let cur = null, worstPre = null, worstBodies = -1;
  const start = Game.startBattle;
  Game.startBattle = function (m, ...rest) {
    const pre = JSON.stringify(m);
    const bt = start.call(this, m, ...rest);
    const f = cur = { match: null, round: m.round, map: m.map && m.map.id, squads: [m.armies[0].length, m.armies[1].length],
      maxBodies: 0, trisAtMax: 0, maxTris: 0, maxStructures: 0, structureTris: 0, maxProjectiles: 0, maxShots: 0, at: 0, kinds: null };
    fights.push(f);
    const recent = []; // shots fired in the last 0.3 s (a shot line shows 0.18 s, a heal 0.35 s)
    const step = bt.step;
    bt.step = function () {
      const r = step.call(this);
      let n = 0, tr = 0, ns = 0, st = 0; const kinds = {};
      for (const b of bt.bodies) {
        if (!b.alive) continue;
        if (b.u.structure || b.u.building) { ns++; st += t(b.u); continue; }
        n++; const k = models.kindOf(b.u), x = t(b.u); tr += x; kinds[k] = (kinds[k] || 0) + 1;
      }
      const now = bt.time(); recent.push([now, bt.lastShots().length]); while (recent.length && recent[0][0] < now - 0.3) recent.shift();
      const shots = recent.reduce((a, [, c]) => a + c, 0);
      if (n > f.maxBodies) { f.maxBodies = n; f.trisAtMax = tr; f.at = Number(now.toFixed(2)); f.kinds = kinds; }
      f.maxTris = Math.max(f.maxTris, tr);
      if (ns > f.maxStructures) { f.maxStructures = ns; f.structureTris = st; }
      f.maxProjectiles = Math.max(f.maxProjectiles, bt.projectiles().length);
      f.maxShots = Math.max(f.maxShots, shots);
      return r;
    };
    // keep the match before the biggest fight so far (decided once the fight is over: see below)
    f._pre = pre;
    return bt;
  };

  const prepared = Lab.prepareRoster();
  for (let i = 0; i < MATCHES; i++) {
    const seed = (SEED + i) >>> 0, from = fights.length;
    const res = Lab.simulateMatch(prepared, seed, { mirror: MIRROR });
    for (const f of fights.slice(from)) {
      f.match = seed;
      if (f.maxBodies > worstBodies) { worstBodies = f.maxBodies; worstPre = { seed, round: f.round, maxBodies: f.maxBodies, at: f.at, m: JSON.parse(f._pre) }; }
      delete f._pre;
    }
    process.stdout.write(`\rmatch ${i + 1}/${MATCHES} (${res.rounds} rounds)   `);
  }
  console.log();
  const top = (key) => [...fights].sort((a, b) => b[key] - a[key])[0];
  const byRound = {};
  for (const f of fights) { const r = byRound[f.round] || (byRound[f.round] = { fights: 0, squads: 0, bodies: 0, maxBodies: 0, maxTris: 0 }); r.fights++; r.squads += f.squads[0] + f.squads[1]; r.bodies += f.maxBodies; r.maxBodies = Math.max(r.maxBodies, f.maxBodies); r.maxTris = Math.max(r.maxTris, f.maxTris); }
  console.log('round  fights  avg squads (both)  avg peak bodies  max peak bodies  max unit tris');
  for (const [r, x] of Object.entries(byRound)) console.log(`${String(r).padStart(5)}  ${String(x.fights).padStart(6)}  ${(x.squads / x.fights).toFixed(1).padStart(17)}  ${(x.bodies / x.fights).toFixed(1).padStart(15)}  ${String(x.maxBodies).padStart(15)}  ${String(x.maxTris).padStart(13)}`);
  const wb = top('maxBodies'), wt = top('maxTris');
  const show = (f) => `match ${f.match} round ${f.round} (${f.map}): ${f.maxBodies} bodies at ${f.at}s, ${f.trisAtMax} unit tris then; peak unit tris ${f.maxTris}; ${f.maxStructures} structures (${f.structureTris} tris); up to ${f.maxProjectiles} projectiles, ${f.maxShots} shots in 0.3 s; squads ${f.squads.join('+')}`;
  console.log('\nmost bodies:  ' + show(wb));
  console.log('most tris:    ' + show(wt));
  console.log('most projectiles in flight: ' + top('maxProjectiles').maxProjectiles + ', most shots in 0.3 s: ' + top('maxShots').maxShots);
  console.log('bodies by model in the biggest fight: ' + JSON.stringify(wb.kinds));
  fs.writeFileSync(OUT, JSON.stringify({ config: { matches: MATCHES, seed: SEED, mirror: MIRROR }, byRound, worstBodies: wb, worstTris: wt,
    fights: fights.map(({ kinds, ...f }) => f) }, null, 1));
  fs.writeFileSync(path.join(path.dirname(OUT), 'worst-fight.json'), JSON.stringify(worstPre));
  console.log('wrote ' + path.relative(ROOT, OUT) + ' and worst-fight.json');
})().catch(e => { console.error(e); process.exit(1); });
