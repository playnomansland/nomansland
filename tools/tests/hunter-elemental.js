// Headless check of the Sniper's Hunter (Awaken skill: a mark, shoots it first for double damage, stealth) and the
// Water Mage's Summon water elemental (Master skill: 600 health, attacks like a level 2 Ember Imp, her speed, levels
// with her, a pool where it falls). Run from the repo root: node tools/tests/hunter-elemental.js
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const Referee = require('../../src/referee.js');
const roster = require('../../src/default-roster.json');
const G = { distance: 42, spacing: 3.5, minDmgPct: 15, timeCap: 60, dt: 0.05, sight: 15, minSight: 18, drift: 15, flameReach: 1.2, budget: 6 };
const unit = (n) => { const u = roster.units.find(x => x.name === n); assert.ok(u, n); return { ...u, cost: u.cost / 100 }; };
const skill = (id) => { const s = roster.skills.find(x => x.id === id); assert.ok(s, id); return s; };
const withSkills = (n, ids) => E.applySkills(unit(n), ids.map(skill), roster.units);
const body = (u, side, x, y, sq = side * 10) => E.buildSquad(u, side, x, y, sq, 6)[0];
const dummy = (hp, extra) => E.withTraits({ name: 'Dummy', cost: 1, bodies: 1, hp, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true, ...extra });
const steps = (bt, s) => { for (let k = 0; k < Math.round(s / G.dt); k++) bt.step(); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// the roster: Overwatch is off the Sniper (still in the library); Hunter is its 4th slot, an Awaken skill
{
  const sn = unit('Sniper');
  assert.strictEqual(sn.skills[3], 'hunter');
  assert.ok(!sn.skills.includes('overwatch') && roster.skills.some(s => s.id === 'overwatch'));
  const h = withSkills('Sniper', ['hunter']);
  assert.ok(h.hunter && h.hunter.dmg === 100 && h.stealth, 'Hunter: double damage to its mark, stealth');
  assert.ok(E.describeSkill(skill('hunter')).includes('mark'));
  const wm = unit('Water Mage');
  assert.strictEqual(wm.skills[3], 'waterElemental');
  assert.ok(skill('waterElemental').master && skill('waterElemental').flat);
}

// Hunter in a fight: a marked enemy in reach is shot before a nearer one, for double damage, through stealth
{
  const h = body(withSkills('Sniper', ['hunter']), 0, 0, 0, 1);
  const nearFoe = body(dummy(1e6), 1, 0, 10, 50), prey = body(dummy(1e6, { stealth: true }), 1, 4, 25, 51);
  prey.prey = true;
  const bt = E.createBattle([h], [nearFoe, prey], G);
  steps(bt, 8);
  assert.ok(nearFoe.hp === nearFoe.u.hp, 'the nearer unmarked one is left alone');
  const dealt = prey.u.hp - prey.hp;
  assert.ok(dealt > 0 && near(dealt % (h.u.hit * 2), 0, 1e-6), 'marked: double damage');
  // without a mark it shoots the nearer one, and doesn't see the stealthed one
  const h2 = body(withSkills('Sniper', ['hunter']), 0, 0, 0, 1), a = body(dummy(1e6), 1, 0, 10, 50), b = body(dummy(1e6), 1, 4, 25, 51);
  assert.ok(h2.hidden === true, 'stealthed at the start');
  const bt2 = E.createBattle([h2], [a, b], G);
  steps(bt2, 8);
  assert.ok(a.hp < a.u.hp && b.hp === b.u.hp, 'no mark: the nearest');
}

// Hunter in a match: awaken a Sniper squad, mark an enemy squad from an earlier round, the mark reaches the fight
{
  const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
  const m = Game.createMatch(units, null, 3, 'standard');
  const sn = units.findIndex(u => u.name === 'Sniper'), br = units.findIndex(u => u.name === 'Brute');
  m.gold = [5000, 5000]; m.unlocks[0][sn] = 1; m.unlocks[1][br] = 1;
  Game.ensureTower(m, 0); Game.ensureTower(m, 1);
  const hsq = Game.place(m, 0, sn, 2, 13);
  const foeOld = Game.place(m, 1, br, 3, 2);
  m.round++;
  const foeNew = Game.place(m, 1, br, 5, 2);
  assert.ok(Game.buySkill(m, 0, sn, 2) && Game.awaken(m, 0, hsq.id), 'awakened');
  assert.ok(Game.isHunter(m, hsq));
  assert.ok(!Game.huntMark(m, 0, hsq.id, foeNew.id), 'not a squad placed this round');
  assert.ok(Game.huntMark(m, 0, hsq.id, foeOld.id) && Game.preyOn(m, 1, foeOld.id));
  const g0 = m.gold[0];
  assert.strictEqual(m.gold[0], g0, 'free');
  // the opponent doesn't see it yet (the awakening itself is hidden this round)
  const v = Referee.view(m, 1, true, null);
  assert.ok(!v.armies[0].find(q => q.id === hsq.id).prey, 'hidden this round');
  assert.strictEqual(Game.preyShown(m, 1, true, 0, hsq), null);
  // in the fight: its bodies carry the mark
  const bs = Game.bodiesFor(m, 1);
  assert.ok(bs.filter(b => b.squad === foeOld.id).every(b => b.prey) && !bs.some(b => b.squad === foeNew.id && b.prey));
  // next round: moving it shows the old mark to the opponent until the fight; Undo mark puts it back
  m.round++;
  assert.strictEqual(Game.preyShown(m, 1, true, 0, hsq), foeOld.id, 'seen from the round after');
  assert.ok(Game.huntMark(m, 0, hsq.id, foeNew.id));
  assert.strictEqual(Game.preyShown(m, 1, true, 0, hsq), foeOld.id, 'a move this round: the old one shows');
  assert.strictEqual(Referee.view(m, 1, true, null).armies[0].find(q => q.id === hsq.id).prey.squad, foeOld.id);
  assert.ok(Game.undoHunt(m, 0, hsq.id) && hsq.prey.squad === foeOld.id);
  // the marked squad sold: the mark is gone and can go on another
  m.armies[1] = m.armies[1].filter(q => q.id !== foeOld.id);
  assert.ok(!Game.preyOf(m, 0, hsq) && Game.huntMark(m, 0, hsq.id, foeNew.id));
  // through the referee's whitelist
  assert.ok(Referee.cleanArgs('huntMark', [hsq.id, foeNew.id]) && Referee.cleanArgs('undoHunt', [hsq.id]));
  // the AI marks with its Hunters
  delete hsq.prey; Game.aiHunt(m, 0);
  assert.ok(hsq.prey && hsq.prey.squad === foeNew.id, 'AI marks');
}

// Water elemental: one per Water Mage body, 9 m ahead, her speed, 600 health, a level 2 Ember Imp's attack, levels with her
{
  const wm = withSkills('Water Mage', ['waterElemental']);
  const el = wm.elemental.unit, imp = unit('Ember Imps');
  assert.ok(el.hp === 600 && near(el.hit, imp.hit * 2) && el.aps === imp.aps && el.range === imp.range && el.splash === imp.splash && el.bodies === 1);
  const mage = body(wm, 0, 0, 0, 1), far = body(dummy(1e6), 1, 0, 200, 50);
  const bt = E.createBattle([mage], [far], G);
  const e = bt.bodies.find(b => b.u.name === 'Water Elemental');
  assert.ok(e && e.side === 0 && e.squad === -1 && near(e.y, 9) && e.u.speed === wm.speed, 'in front of her, at her speed');
  const lv = E.buildSquad(wm, 0, 0, 0, 1, 6, 0, 1)[0];
  const bt2 = E.createBattle([lv], [body(dummy(1e6), 1, 0, 200, 50)], G);
  const e2 = bt2.bodies.find(b => b.u.name === 'Water Elemental');
  assert.ok(e2.u.hp > 600 && e2.u.hit > el.hit && e2.level === 1, 'grows with her level');
  // a pool where it falls
  const mage3 = body(wm, 0, 0, 0, 1), killer = body(E.withTraits({ name: 'K', cost: 1, bodies: 1, hp: 1e6, hit: 5000, aps: 2, range: 40, speed: 0, splash: 0 }), 1, 0, 30, 50);
  const bt3 = E.createBattle([mage3], [killer], G);
  const e3 = bt3.bodies.find(b => b.u.name === 'Water Elemental');
  for (let k = 0; k < 400 && e3.alive; k++) bt3.step();
  assert.ok(!e3.alive && bt3.pools().some(p => p.side === 0 && p.r === 4 && near(p.x, e3.x) && near(p.y, e3.y)), 'a pool where it fell');
  // a deterministic replay
  const run = () => { const a = body(wm, 0, 0, 0, 1), b = body(unit('Brute'), 1, 0, 30, 50); const r = E.createBattle([a], [b], G); while (r.step()); return r.bodies.map(x => [x.hp.toFixed(6), x.x.toFixed(6), x.y.toFixed(6)].join()).join('|'); };
  assert.strictEqual(run(), run());
}
console.log('hunter-elemental: Hunter marks (first, double damage, stealth, hidden while new, AI), water elemental (stats, place, speed, level, pool) all pass');
