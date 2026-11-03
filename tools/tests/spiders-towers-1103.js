// Headless check of the 2026-11-03 batch: Snow storm 10 m, the sniper tower's Mark Bounty for all units, Eagle eye
// for all units (Snipers and the tower double), and the Spiders' new skills (Poisonous fangs, Spiderlings or
// Cavestalkers, Web-shots). Run from the repo root: node tools/tests/spiders-towers-1103.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => { const s = roster.skills.find(x => x.id === id); assert.ok(s, id); return s; };
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Snow storm: 10 m
assert.strictEqual(withSkills('Frost Wizard', ['snowStorm']).storm.radius, 10);

// Spiders: Poisonous fangs (as Poison shot), then Spiderlings or Cavestalkers, then Web-shots (Master, needs 2 or 3)
{
  const sp = unit('Spiders');
  assert.deepStrictEqual(sp.skills, ['poisonousFangs', 'spiderlings', 'cavestalkers', 'webShots']);
  assert.deepStrictEqual(sp.skillOr, [[1, 2]]); assert.deepStrictEqual(sp.skillNeedsAny, [null, null, null, [1, 2]]);
  assert.deepStrictEqual([100, 200, 200, 300], sp.skills.map(id => skill(id).cost));
  assert.deepStrictEqual(skill('poisonousFangs').params, skill('poison').params);
  assert.ok(withSkills('Spiders', ['cavestalkers']).stealth && skill('webShots').master);
}

// webs: one per body a fight, within 10 m, no damage; each stack 10% slower and 5% less damage, capped at 90%,
// for 3 s from the newest stack; the shooter's poison lands with it
{
  const web = withSkills('Spiders', ['poisonousFangs', 'webShots']);
  const s = body({ ...web, bodies: 1, hit: 0, speed: 0, range: 1 }, 0, 0, 0, 1), far = body(dummy(1000), 1, 0, 11, 50), v = body(dummy(1000), 1, 0, 9, 51);
  const bt = E.createBattle([s], [far, v], G);
  bt.step(); bt.step();
  assert.ok(v.web && !far.web && near(v.web.slow, 10) && near(v.web.dmg, 5) && v.hp === 1000, 'one web, the one within 10 m, no damage');
  assert.ok(v.poison && v.poison.length === 1, 'its poison landed');
  steps(bt, 2);
  assert.strictEqual(s.webs, 1, 'just one a fight');
  assert.ok(v.slowT > 0 && v.slowMove >= 10, 'slowed');
  steps(bt, 1.5); assert.ok(!v.web, 'gone 3 s after');
  // many spiders: stacks add up to 90%, and a webbed attacker hits softer
  const many = Array.from({ length: 20 }, (_, i) => body({ ...web, bodies: 1, hit: 0, speed: 0, range: 1, poisonPct: 0 }, 0, (i % 5) * 0.5 - 1, -(i / 5 | 0) * 0.5, 2 + i));
  const atk = body(E.withTraits({ name: 'A', cost: 1, bodies: 1, hp: 1e6, hit: 100, aps: 1, range: 40, speed: 0, splash: 0 }), 1, 0, 6, 60);
  const target = body(dummy(1e6), 0, 0, 30, 61);
  const bt2 = E.createBattle([...many, target], [atk], { ...G, sight: 100, minSight: 100 });
  bt2.step(); bt2.step();
  assert.ok(near(atk.web.slow, 90) && near(atk.web.dmg, 90), `capped at 90% (${atk.web.slow}, ${atk.web.dmg})`);
}

// Eagle eye: +1.5 m and +5% attack speed for every unit; Snipers and the tower double. Mark Bounty: every unit
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, null, 4, 'standard');
  const sn = units.findIndex(u => u.name === 'Sniper'), br = units.findIndex(u => u.name === 'Brute'), ar = units.findIndex(u => u.name === 'Skeleton Archers');
  m.gold = [5000, 5000]; for (const i of [sn, br, ar]) { m.unlocks[0][i] = 1; m.unlocks[1][i] = 1; }
  Game.ensureTower(m, 0); Game.ensureTower(m, 1);
  m.round = Math.max(m.round, Game.TOWER_PICK_ROUND || 2); m.towers[0].type = 'sniper';
  const a = Game.place(m, 0, ar, 2, 13), s = Game.place(m, 0, sn, 4, 13), foe = Game.place(m, 1, br, 3, 2);
  const before = Game.bodiesFor(m, 0);
  const pick = (bs, id) => bs.find(b => b.squad === id);
  m.towerSkill = [m.round, 0];
  const after = Game.bodiesFor(m, 0);
  assert.ok(near(pick(after, a.id).u.range - pick(before, a.id).u.range, 1.5) && near(pick(after, a.id).u.aps / pick(before, a.id).u.aps, 1.05), 'archers +1.5 m, +5%');
  assert.ok(near(pick(after, s.id).u.range - pick(before, s.id).u.range, 3) && near(pick(after, s.id).u.aps / pick(before, s.id).u.aps, 1.1), 'Snipers double');
  assert.ok(near(Game.squadRange(m, 0, a) - Game.squadRange(m, 0, a, false), 0));
  // the mark, on every unit
  m.round++;
  assert.ok(Game.placeMark(m, 0, foe.id));
  const bs = Game.bodiesFor(m, 0);
  assert.ok(pick(bs, a.id).sniperMark > 0 && pick(bs, s.id).sniperMark > 0, 'all units hunt the mark');
  assert.ok(/All your units/.test(Game.TOWER_TYPES.find(t => t.id === 'sniper').mark.text));
}
console.log('spiders-towers-1103: Snow storm 10 m, Spiders skills and webs (one each, 10 m, stacks capped at 90%, 3 s, poison), Eagle eye for all, Mark Bounty for all ok');
