// Headless checks for the 2v2 artifacts in the fight (Engine opts.artifacts, src/engine.js "2v2 artifacts"): points by
// tier per squad, both sides ticking at once, the cap locking an artifact, points frozen after, a fight that ends first
// won on points (a tie: nobody), ranged bodies holding the circle, melee bodies leaving it to fight, normal behaviour
// once locked, exact mirrors, and nothing at all without opts.artifacts.
// Run from the repo root: node tools/tests/artifacts.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const G = { ...Game.SETTINGS, bounds: { x0: -36, x1: 36, y0: -48, y1: 48 } };
const base = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
// a body that stands still, hits nothing and can't be killed in a fight: something to hold a circle with, or to shoot at
const dummy = (bodies = 1) => ({ ...base('Brute'), name: 'Dummy', hit: 0, speed: 0, hp: 1e9, bodies, skills: [] });
const squad = (u, side, x, y, id, tier, list) => { const b = E.buildSquad(u, side, x, y, id, 3, list.length); if (tier) for (const x of b) x.tier = tier; list.push(...b); return b; };
const run = (bt, secs) => { const n = Math.round(secs / G.dt); for (let k = 0; k < n && bt.step(); k++); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
let n = 0;
const ok = (msg) => { n++; console.log('ok  ' + msg); };

// off by default: no opts.artifacts (or an empty list) changes nothing, and a body's tier is never read without one
{
  const fight = (opts, tiers) => {
    const A = [], B = [];
    squad(base('Brute'), 0, 0, -20, 0, tiers ? 2 : 0, A); squad(base('Skeleton Archers'), 0, 6, -24, 1, tiers ? 1 : 0, A);
    squad(base('Fire Mage'), 1, 0, 20, 0, tiers ? 1 : 0, B); squad(base('Goblin Swarm'), 1, -6, 22, 1, tiers ? 1 : 0, B);
    const bt = E.createBattle(A, B, G, opts);
    const frames = [];
    while (bt.step()) frames.push(bt.frame());
    return { res: JSON.stringify(bt.result()), frames: JSON.stringify(frames), arts: bt.artifacts() };
  };
  const a = fight({}), b = fight({ artifacts: [] }), c = fight({}, true);
  assert.strictEqual(a.res, b.res, 'an empty list: the same result'); assert.strictEqual(a.frames, b.frames, 'an empty list: the same frames');
  assert.strictEqual(a.res, c.res, 'tiers on the bodies: the same result'); assert.strictEqual(a.frames, c.frames, 'tiers on the bodies: the same frames');
  assert.deepStrictEqual(a.arts, [], 'artifacts() is empty');
  assert.ok(!('artifacts' in JSON.parse(a.res)), 'result() has no artifacts');
  ok('off by default: no opts.artifacts changes nothing (result and every frame the same)');
}

// points: each squad with a body inside adds its tier a second (not per body), both sides at once, with r and cap defaults
{
  const A = [], B = [];
  squad(dummy(3), 0, -3, 0, 0, 2, A);   // tier 2, three bodies inside: 2 a second, not 6
  squad(dummy(2), 0, 3, -2, 1, 3, A);   // tier 3
  squad(dummy(1), 0, 0, -20, 2, 4, A);  // tier 4, outside the circle: nothing
  squad(dummy(1), 1, 0, 4, 0, 1, B);    // tier 1
  const tw = squad({ ...dummy(1), name: 'Tower', structure: true }, 1, 2, 2, -2, 4, B); // a structure never holds
  const sm = squad(dummy(1), 1, -2, 3, -1, 4, B); sm[0].credit = B[0];                   // a summon of squad 0: tier 1 of its own
  const rd = squad(dummy(1), 1, 1, 1, 5, 4, B); rd[0].boarded = true; rd[0].alive = false; // riding in a carrier: nothing
  const bt = E.createBattle(A, B, G, { artifacts: [{ x: 0, y: 0 }] });
  run(bt, 2);
  const [a] = bt.artifacts();
  assert.strictEqual(a.r, E.ARTIFACT.r, 'r defaults to ' + E.ARTIFACT.r); assert.strictEqual(a.cap, E.ARTIFACT.cap, 'cap defaults to ' + E.ARTIFACT.cap);
  assert.deepStrictEqual(a.rate, [5, 2], 'rate: side 0 2 + 3, side 1 1 + its summon 1 (' + a.rate + ')');
  assert.ok(near(a.pts[0], 10, 1e-6) && near(a.pts[1], 4, 1e-6), 'after 2 s: 10 and 4 (' + a.pts + ')');
  assert.ok(!a.locked && a.won === -1, 'not locked yet');
  assert.ok(tw.length && rd.length, 'bodies made');
  ok(`points by tier per squad, both sides at once: rate ${a.rate}, ${a.pts.map(p => p.toFixed(2))} after 2 s`);
  // the cap: side 0 reaches 100 at 20 s and wins it; the points freeze there
  run(bt, 18.5);
  const [l] = bt.artifacts();
  assert.ok(l.locked && l.won === 0, 'locked, won by side 0');
  assert.ok(near(l.pts[0], 100, 1e-6) && near(l.pts[1], 40, 1e-6), 'locked at 100 to 40 (' + l.pts + ')');
  assert.deepStrictEqual(l.rate, [0, 0], 'no rate once locked');
  run(bt, 10);
  const [f] = bt.artifacts();
  assert.deepStrictEqual(f.pts, l.pts, 'frozen after the lock');
  const res = bt.result();
  assert.ok(res.artifacts && res.artifacts[0].won === 0 && res.artifacts[0].locked, 'result().artifacts: won by side 0');
  ok('cap locks it (side 0 at 100 to 40), points frozen after, result().artifacts the same');
}

// both reach the cap on the same tick: nobody wins it; a fight that ends first goes on points (equal: nobody)
{
  const pair = (t0, t1, cap, secs) => {
    const A = [], B = [];
    squad(dummy(1), 0, 0, -3, 0, t0, A); squad(dummy(1), 1, 0, 3, 0, t1, B);
    const bt = E.createBattle(A, B, { ...G, timeCap: secs }, { artifacts: [{ x: 0, y: 0, r: 9, cap }] });
    while (bt.step());
    return { live: bt.artifacts()[0], res: bt.result().artifacts[0] };
  };
  let p = pair(2, 2, 100, 60);
  assert.ok(p.live.locked && p.live.won === -1 && near(p.live.pts[0], p.live.pts[1], 0), 'a tie at the cap: locked, nobody');
  p = pair(1, 2, 1000, 10);
  assert.ok(!p.live.locked && p.live.won === -1, 'live: not locked, nobody yet');
  assert.ok(!p.res.locked && p.res.won === 1 && near(p.res.pts[1], 20, 1e-6), 'the fight ends first: side 1 on points (' + p.res.pts + ')');
  p = pair(3, 3, 1000, 10);
  assert.ok(!p.res.locked && p.res.won === -1, 'the fight ends first on equal points: nobody');
  ok('a tie at the cap: nobody; timeout: more points wins, equal: nobody (-1)');
}

// ranged: steps into the circle first, then holds inside and shoots only what it reaches from there
{
  const mage = base('Fire Mage');
  const setup = (foeY, arts, tier = 0) => {
    const A = [], B = [];
    squad(mage, 0, 0, -30, 0, tier, A);
    squad(dummy(1), 1, 0, foeY, 0, 1, B);
    return { bt: E.createBattle(A, B, G, arts ? { artifacts: arts } : {}), me: A[0], foe: B[0] };
  };
  const C = { x: 0, y: -15, r: 9, cap: 1e9 };
  // the enemy out of its reach from the circle: it holds the circle all fight, and never shoots
  let { bt, me, foe } = setup(15, [C]);
  let inside = 0, out = 0;
  while (bt.step()) { const d = Math.hypot(me.x - C.x, me.y - C.y); if (d <= C.r) inside++; else if (inside) out++; }
  assert.ok(inside > 0 && out === 0, `it got in and never left (${inside} ticks in, ${out} out after)`);
  assert.strictEqual(foe.hp, foe.u.hp, 'no shots at an enemy it can\'t reach from inside');
  // without the artifact the same mage walks up to that enemy and shoots it
  ({ bt, me, foe } = setup(15, null));
  while (bt.step());
  assert.ok(Math.hypot(me.x - C.x, me.y - C.y) > C.r && foe.hp < foe.u.hp, 'without it: it walks out and shoots');
  // an enemy within its reach from inside: it shoots it from there
  ({ bt, me, foe } = setup(0, [C]));
  out = 0; inside = 0;
  while (bt.step()) { const d = Math.hypot(me.x - C.x, me.y - C.y); if (d <= C.r) inside++; else if (inside) out++; }
  assert.ok(inside > 0 && out === 0 && foe.hp < foe.u.hp, 'it shoots what it reaches, still inside');
  // once the artifact locks: as usual (it walks out after the enemy it couldn't reach)
  ({ bt, me, foe } = setup(15, [{ ...C, cap: 6 }], 2));
  while (bt.step());
  const [a] = bt.artifacts();
  assert.ok(a.locked && a.won === 0, 'locked by the mage');
  assert.ok(Math.hypot(me.x - C.x, me.y - C.y) > C.r && foe.hp < foe.u.hp, 'after the lock it walks out and shoots');
  ok('ranged: steps in, holds inside, shoots only from inside; once locked, as usual');
}

// melee: holds the circle while no enemy is within its awareness, leaves it to fight one that is
{
  const brute = base('Brute');
  const setup = (fx, fy) => {
    const A = [], B = [];
    squad(brute, 0, 0, -30, 0, 2, A);
    squad(dummy(1), 1, fx, fy, 0, 1, B);
    return { bt: E.createBattle(A, B, G, { artifacts: [{ x: 0, y: -15, r: 9, cap: 1e9 }] }), me: A[0], foe: B[0] };
  };
  let { bt, me, foe } = setup(0, 40);
  while (bt.step());
  assert.ok(Math.hypot(me.x, me.y + 15) <= 9 && foe.hp === foe.u.hp, 'nobody near: it holds the circle');
  assert.ok(bt.artifacts()[0].pts[0] > 0 && bt.artifacts()[0].pts[1] === 0, 'and gets the points');
  ({ bt, me, foe } = setup(16, -15));
  while (bt.step());
  assert.ok(Math.hypot(me.x, me.y + 15) > 9 && foe.hp < foe.u.hp, 'an enemy within its awareness: it leaves the circle to attack');
  ok('melee: holds the circle with nobody near, leaves it to attack an enemy within its awareness');
}

// bodies that never walk stay where they are; a wiped-out side: the fight ends, the artifact goes on points
{
  const A = [], B = [];
  const st = squad(dummy(1), 0, 0, -20, 0, 1, A);
  squad(base('Fire Mage'), 1, 0, 30, 0, 1, B);
  const bt = E.createBattle(A, B, G, { artifacts: [{ x: 0, y: -5, r: 9, cap: 1e9 }] });
  run(bt, 10);
  assert.ok(st[0].x === 0 && st[0].y === -20, 'a body with no speed never moves');
  ok('a body that never walks is unaffected');
}

// mirrors: mirrored armies with mirrored artifacts come out an exact mirror, points and all
{
  const mirror = (u, xo, yo, k, arts) => {
    const A = [], B = [];
    for (let q = 0; q < k; q++) { squad(u, 0, xo + q * 6, -yo, q, 2, A); squad(u, 1, xo + q * 6, yo, q, 2, B); }
    const bt = E.createBattle(A, B, { ...G, aware2: true }, { artifacts: arts });
    while (bt.step());
    return bt.result();
  };
  let cnt = 0;
  for (const name of ['Brute', 'Skeleton Archers', 'Fire Mage', 'Goblin Swarm', 'Ent', 'Sniper', 'Spiders', 'Wisps']) for (const [x, y] of [[0, 18], [6, 26]]) for (const k of [1, 2]) {
    for (const arts of [[{ x: 0, y: 0 }], [{ x: -12, y: 10, cap: 30 }, { x: -12, y: -10, cap: 30 }], [{ x: 9, y: 6, r: 6 }, { x: 9, y: -6, r: 6 }]]) {
      const r = mirror(base(name), x, y, k, arts);
      assert.ok(r.winner === -1 && Math.abs(r.frac[0] - r.frac[1]) < 1e-9, `${name} x${k} at ${x},${y}: a mirror (${r.winner}, ${r.frac})`);
      const a = r.artifacts;
      if (a.length === 1) assert.ok(a[0].pts[0] === a[0].pts[1] && a[0].won === -1, `${name}: the middle one even (${a[0].pts})`);
      else assert.ok(a[0].pts[0] === a[1].pts[1] && a[0].pts[1] === a[1].pts[0] && a[0].locked === a[1].locked && (a[0].won === -1 ? a[1].won === -1 : a[1].won === 1 - a[0].won), `${name}: the pair mirrored (${a[0].pts} / ${a[1].pts})`);
      cnt++;
    }
  }
  ok(`${cnt} mirrored fights with artifacts: all exact mirrors, points included`);
}

console.log(`\n${n} artifact checks passed`);
