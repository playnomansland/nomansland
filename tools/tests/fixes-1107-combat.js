// Headless check of the 2026-11-07 combat fixes. Run from the repo root: node tools/tests/fixes-1107-combat.js
// - Meteor Caller: its meteor flies over bodies within its minimum range (no more hitting a spider next to it)
// - Truespear (seek): spears at its locked target fly past a skeleton screen and follow a target walking sideways;
//   with Dual Spear the main spear keeps its lock and the second takes another enemy
// - direction arrows: only an enemy ahead stops the walk; slows don't use up the arrow; no progress for AIM.stall s drops it
// - Bullhead: 85 charge damage, 5 m knockback; Rollers run 9 m past their target
// - Healing touch: 25 m reach, never a building
// - Raise dead: skeletons level with the Necromancer and get the side's Skeleton Archer skills (the character once)
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 120, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => { const s = roster.skills.find(x => x.id === id); assert.ok(s, id); return s; };
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s, each) => { for (let k = 0; k < Math.round(s / G.dt); k++) { bt.step(); if (each) each(); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// B1 Meteor Caller: bodies inside its 16 m minimum range, right in the meteor's path, aren't hit; the far target is
{
  const mc = body(withSkills('Meteor Caller', []), 0, 0, 0);
  assert.strictEqual(mc.u.minRange, 16);
  const close = [[0, 2.5], [1.2, 3], [-1.2, 3], [0, 6], [0, 10]].map(([x, y], k) => body(dummy(1000), 1, x, y, 20 + k));
  const far = body(dummy(100000), 1, 0, 30, 30);
  const bt = E.createBattle([mc], [...close, far], G);
  steps(bt, 25);
  assert.ok(close.every(c => c.hp === 1000), `nothing inside the minimum range is hit (${close.map(c => c.hp).join(', ')})`);
  assert.ok(far.hp < 100000 - 3 * 105, `the target 30 m away is (${100000 - far.hp})`);
}
// ... a body standing beyond the minimum range in the path still takes the meteor, as before
{
  const mc = body(withSkills('Meteor Caller', []), 0, 0, 0);
  const mid = body(dummy(100000), 1, 0, 24, 21), far = body(dummy(100000), 1, 0.4, 40, 22);
  mc.lock = far;
  const bt = E.createBattle([mc], [mid, far], G);
  steps(bt, 10);
  assert.ok(mid.hp < 100000, 'beyond its minimum range a body in the way still takes it');
}

// B2 Truespear: a Necromancer behind its skeletons, walking sideways; every spear thrown at it lands on it
const truespear = (seek, skills, secs) => {
  const tu = { ...withSkills('Truespear', skills), pctHit: 0, seek };
  const tr = body(tu, 0, 0, 0);
  const ne = body({ ...withSkills('Necromancer', ['raiseDead']), hp: 1e6, hit: 0 }, 1, 0, 21);
  ne.guide = [{ x: 40, y: 21 }]; // walks sideways across the line of fire
  const bt = E.createBattle([tr], [ne], G);
  let thrown = 0, mainOff = 0, secondOnNecro = 0;
  const seen = new Set();
  steps(bt, secs, () => {
    for (const p of bt.projectiles()) if (p.owner === tr && !seen.has(p)) { seen.add(p); if (p.homing === ne) thrown++; }
    if (tr.aims) { if (tr.lock === ne && tr.aims[0] && tr.aims[0] !== ne) mainOff++; if (tr.aims[1] === ne && bt.time() > 3) secondOnNecro++; }
  });
  return { tr, ne, dealt: 1e6 - ne.hp, thrown, mainOff, secondOnNecro, kids: (ne.kids || []).length };
};
{
  assert.strictEqual(unit('Truespear').seek, 1, 'the Truespear has seek');
  const on = truespear(1, [], 7), off = truespear(0, [], 7); // by 8 s it has walked out of reach
  assert.ok(on.tr.lock === on.ne && on.thrown >= 5, `it keeps throwing at its lock (${on.thrown})`);
  assert.ok(near(on.dealt, on.thrown * on.tr.u.hit, on.tr.u.hit + 1e-6), `each spear at it lands (${on.dealt} for ${on.thrown} spears)`); // the last one may still fly
  assert.ok(off.dealt < on.dealt, `without seek some miss or hit skeletons (${off.dealt} < ${on.dealt})`);
  const dual = truespear(1, ['dualSpear'], 7);
  assert.ok(dual.tr.u.turrets === 2 && dual.mainOff === 0, `with Dual Spear the main spear stays on its lock (${dual.mainOff} ticks off)`);
  assert.ok(dual.secondOnNecro === 0, 'the second spear takes another enemy');
  assert.ok(dual.dealt >= on.dealt - dual.tr.u.hit, `it hurts the Necromancer as much (${dual.dealt} vs ${on.dealt})`);
}

// B3 direction arrows (engine): b.guide with b.guideT the seconds it may go without getting closer
const walker = (extra) => body(E.withTraits({ name: 'W', cost: 1, bodies: 1, hp: 1e6, hit: 1, aps: 1, range: 2, speed: 4, splash: 0, ...extra }), 0, 0, 0, 1);
const walk = (w, foes, secs, g = G, each) => {
  w.guide = [{ x: 30, y: 0 }]; w.guideT = 3;
  const bt = E.createBattle([w], foes, g);
  let at = null;
  steps(bt, secs, () => { if (each) each(); if (at == null && !w.guide) at = { x: w.x, y: w.y, t: bt.time() }; });
  return at;
};
{
  // an enemy beside it and one behind it, both in reach, don't stop it (it hits them in passing)
  const w = walker(), side = body(dummy(1e6), 1, 0, 1.8, 20), back = body(dummy(1e6), 1, -1.2, 0, 21);
  const at = walk(w, [side, back], 12);
  assert.ok(at && at.x > 28, `walked past them to the end (${at && at.x.toFixed(1)})`);
  assert.ok(side.hp < 1e6 || back.hp < 1e6, 'and hit what was in its reach on the way');
  // an enemy on its way ahead stops it, and the time it fights doesn't count
  const w2 = walker(), ahead = body(dummy(1e6), 1, 3.5, 0, 22);
  const at2 = walk(w2, [ahead], 8);
  assert.ok(!at2 && w2.guide && w2.x < 3.5 && ahead.hp < 1e6, `stands and fights the one in its way (x ${w2.x.toFixed(1)})`);
  // slowed by 70% all the way (30 m at 1.2 m/s) it still gets there
  const w3 = walker(), far = body(dummy(1e6), 1, 0, 80, 23);
  const at3 = walk(w3, [far], 40, G, () => { w3.slowT = 1; w3.slowMove = 70; });
  assert.ok(at3 && at3.x > 28 && at3.t > 20, `slowed, it still walks the whole arrow (${at3 && at3.x.toFixed(1)} m at ${at3 && at3.t.toFixed(1)} s)`);
  // knocked back now and then, it still gets there
  const w4 = walker(), far4 = body(dummy(1e6), 1, 0, 80, 24);
  let n = 0;
  const at4 = walk(w4, [far4], 30, G, () => { if (++n % 30 === 0 && w4.guide) w4.x -= 4; });
  assert.ok(at4 && at4.x > 28, 'knocked back, it still walks the whole arrow');
  // slowed by 70% and knocked back 4 m once: walking back counts as getting closer, so it doesn't give up
  const w6 = walker(), far6 = body(dummy(1e6), 1, 0, 80, 26);
  let knocked = false;
  const at6 = walk(w6, [far6], 40, G, () => { w6.slowT = 1; w6.slowMove = 70; if (!knocked && w6.x >= 3.5) { knocked = true; w6.x -= 4; } });
  assert.ok(knocked && at6 && at6.x > 28, `slowed and knocked back, it still walks the whole arrow (arrow ended at x ${at6 && at6.x.toFixed(1)})`);
  // held still from 2 s on (no progress at all) it gives up 3 s later and fights as usual
  const w5 = walker(), far5 = body(dummy(1e6), 1, 0, 80, 25);
  const at5 = walk(w5, [far5], 8, G, () => { if (n++ >= 0 && w5.x >= 8) { w5.slowT = 1; w5.slowMove = 100; } });
  assert.ok(at5 && near(at5.x, 8, 0.3) && near(at5.t, 2 + 3, 0.2), `gave up ~3 s after it got stuck (x ${at5 && at5.x.toFixed(2)} at ${at5 && at5.t.toFixed(2)} s)`);
  // stuck but jostled 0.6 m back and forth every tick (a crowd): that isn't progress, it still gives up
  const w7 = walker(), far7 = body(dummy(1e6), 1, 0, 80, 27);
  let j = 0, stuck = false;
  const at7 = walk(w7, [far7], 8, G, () => { if (stuck || w7.x >= 8) { stuck = true; w7.slowT = 1; w7.slowMove = 100; w7.x = 8 + (j++ % 2 ? 0.3 : -0.3); } });
  assert.ok(at7 && near(at7.t, 2 + 3, 0.3), `jostled on the spot, it gave up ~3 s after it got stuck (at ${at7 && at7.t.toFixed(2)} s)`);
}

// B4 Bullhead: 85 damage and 5 m of knockback; B5 Rollers: 9 m past the target
{
  const bh = skill('bullhead').params;
  assert.ok(bh.hit === 85 && bh.push === 5 && bh.every === 5 && bh.run === 6, JSON.stringify(bh));
  assert.ok(/first attack/.test(E.describeSkill(skill('bullhead'))) && /85/.test(E.describeSkill(skill('bullhead'))) && /back 5 m/.test(E.describeSkill(skill('bullhead'))), E.describeSkill(skill('bullhead')));
  const br = body(withSkills('Brute', ['bullhead']), 0, 0, -1.8);
  const vs = [0, 3].map((y, k) => body(dummy(1000, { idle: false }), 1, 0, y, 50 + k));
  const bt = E.createBattle([br], vs, G);
  let charged = false;
  for (let k = 0; k < 40; k++) { bt.step(); if (br.charging) charged = true; }
  assert.ok(charged, 'it charges');
  assert.ok(near(vs[1].hp, 1000 - 85, 1e-6), `the one behind takes 85 (${1000 - vs[1].hp})`);
  assert.ok(near(vs[1].y - 3, 5, 0.6), `and is knocked about 5 m (${(vs[1].y - 3).toFixed(2)})`);
  assert.strictEqual(E.ROLL_PAST, 9);
}

// B6 Healing touch: a wounded ally within 25 m is healed; one 40 m away and a building never are
{
  assert.ok(/within 25 m/.test(E.describeSkill(skill('healer'))), E.describeSkill(skill('healer')));
  const ne = body({ ...withSkills('Necromancer', ['healer']), speed: 0 }, 0, 0, 0);
  assert.strictEqual(ne.u.healRange, 25);
  const close = body(dummy(1000, { idle: false }), 0, 20, 0, 1), far = body(dummy(1000, { idle: false }), 0, -40, 0, 2);
  const tower = body(dummy(1000, { structure: true }), 0, 0, -5, 3);
  for (const a of [close, far, tower]) a.hp = 300;
  const foe = body(dummy(1e7), 1, 0, 15, 20);
  const bt = E.createBattle([ne, close, far, tower], [foe], G);
  steps(bt, 3);
  assert.ok(close.hp > 300 && far.hp === 300 && tower.hp === 300, `only the near unit (${close.hp}, ${far.hp}, tower ${tower.hp})`);
  // nobody wounded in reach: no heal at all
  const lone = body({ ...withSkills('Necromancer', ['healer']), speed: 0 }, 0, 0, 0), away = body(dummy(1000, { idle: false }), 0, 30, 0, 4);
  away.hp = 300;
  const bt2 = E.createBattle([lone, away], [body(dummy(1e7), 1, 0, 15, 21)], G);
  steps(bt2, 3);
  assert.ok(away.hp === 300, 'out of reach: not healed');
}

// B7 Raise dead: through Game (the side's tech), the skeletons get its Skeleton Archer skills and the Necromancer's level
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const ix = (n) => units.findIndex(u => u.name === n);
  const NE = ix('Necromancer'), SK = ix('Skeleton Archers');
  const fresh = () => { const m = Game.createMatch(units, null, 5, 'standard'); m.armies = [[], []]; m.round = 4; return m; };
  const archer = unit('Skeleton Archers');
  { // no archer skills: plain archers, as before
    const u = Game.unitFor(fresh(), 0, NE);
    assert.ok(u.spawn.unit.range === archer.range && !(u.spawn.unit.shield > 0) && u.spawn.unit.level === 0);
  }
  const m = fresh();
  m.tech[0][SK] = [1, 0, 1]; // Longbones and Dread rangers for side 0 (bought for a squad of Skeleton Archers)
  const ref = E.applySkills(archer, [skill('longbones'), skill('dreadRangers')], roster.units);
  const u0 = Game.unitFor(m, 0, NE), u1 = Game.unitFor(m, 1, NE);
  assert.ok(u0.spawn.unit.range === ref.range && u0.spawn.unit.shield === 1 && near(u0.spawn.unit.hit, ref.hit, 1e-9), `side 0's skeletons have its archer skills (range ${u0.spawn.unit.range})`);
  assert.ok(u1.spawn.unit.range === archer.range && !(u1.spawn.unit.shield > 0), 'the other side\'s are untouched');
  assert.ok(!u0.spawn.unit.skillDefs && !u0.spawn.unit.spawn, 'a plain unit, no skills list of its own');
  // the character applies once (Noah: -10%)
  const mn = fresh(); mn.tech[0][SK] = [1, 0, 1]; mn.chars = ['noah', null];
  const un = Game.unitFor(mn, 0, NE);
  assert.ok(near(un.spawn.unit.hp, ref.hp * 0.9, 1e-9) && near(un.spawn.unit.hit, ref.hit * 0.9, 1e-9), `Noah's cut once (${un.spawn.unit.hp} vs ${ref.hp * 0.9})`);
  // in the fight: a level 2 Necromancer raises level 2 skeletons (3x health and hit)
  m.armies[0].push({ id: 1, unit: NE, col: 5, row: 12, round: 1, xp: 0, level: 2, cost: 0 });
  m.armies[1].push({ id: 2, unit: ix('Brute'), col: 5, row: 1, round: 1, xp: 0, level: 0, cost: 0 });
  const bt = Game.startBattle(m);
  const kids = () => bt.bodies.filter(b => b.side === 0 && b.squad === -1 && b.u.name === 'Skeleton Archers');
  for (let k = 0; k < 60 && !kids().length; k++) bt.step();
  const kid = kids()[0];
  assert.ok(kid, 'it raises skeletons');
  assert.ok(kid.level === 2 && near(kid.u.hp, ref.hp * 3, 1e-6) && near(kid.u.hit, ref.hit * 3, 1e-6) && kid.u.range === ref.range && kid.shield === 1,
    `level 2 skeletons with the skills (hp ${kid.u.hp}, hit ${kid.u.hit}, range ${kid.u.range}, level ${kid.level})`);
  // a building's spawns (level 0) are unchanged by the levelling: leveled(u, 0) keeps the stats
  const l0 = E.leveled(archer, 0); assert.ok(l0.hp === archer.hp && l0.hit === archer.hit);
}

console.log('fixes-1107 combat: Meteor Caller min range, Truespear seek + Dual Spear lock, direction arrows, Bullhead, Rollers, Healing touch, Raise dead ok');
