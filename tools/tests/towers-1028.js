// Headless check of the 2026-10-28 tower changes: Keep (Muster, Brute guards 400), Sniper tower (Mark Bounty, Drop
// paratroopers 400, since 2026-11-05), Bastion (Fortify, Vault), and Overwatch seeing stealthed units.
// Run from the repo root: node tools/tests/towers-1028.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const demo = require('../../src/demo-units.json');
const roster = require('../../src/default-roster.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const ui = (name) => units.findIndex(u => u.name === name);
const mk = (type, map = 'standard', seed = 77) => {
  const m = Game.createMatch(units, demo.matrix, seed, map);
  m.round = Game.TOWER_PICK_ROUND; m.towers[0].type = type; m.towers[1].type = 'keep'; m.gold = [2000, 2000];
  return m;
};
const sq = (m, side, name, col, row, round) => { const s = { id: m.nextId[side]++, unit: ui(name), col, row, level: 0, xp: 0, round, cost: units[ui(name)].cost }; m.armies[side].push(s); return s; };
const T = Game.TOWER_TYPES;

// Keep: Muster gives the extra deployment every round on its own (nothing to buy); Brute guards cost 400
let m = mk('keep');
assert.strictEqual(T.find(t => t.id === 'keep').skill2.cost, 400);
const base = Game.CONFIG.deploysPerRound;
assert.strictEqual(Game.deploysAllowed(m, 0), base + 1, 'Muster: +1 deployment');
assert.ok(!Game.deployBuyable(m, 0) && !Game.buyDeploy(m, 0), 'nothing to buy with Muster');
m.towers[1].type = 'sniper'; assert.strictEqual(Game.deploysAllowed(m, 1), base); assert.ok(Game.deployBuyable(m, 1));
const g0 = m.gold[1]; assert.ok(Game.buyDeploy(m, 1)); assert.strictEqual(m.gold[1], g0 - Game.CONFIG.extraDeployCost);
// an extra deployment bought before picking the Keep is refunded when it's picked
m = mk('keep'); m.towers[1].type = null; m.extraDeploys[1] = 0; m.gold[1] = 2000;
assert.ok(Game.buyDeploy(m, 1) && m.gold[1] === 2000 - Game.CONFIG.extraDeployCost);
assert.ok(Game.setTowerType(m, 1, 'keep') && m.extraDeploys[1] === 0 && m.gold[1] === 2000 && Game.deploysAllowed(m, 1) === base + 1);

// Sniper tower: Drop paratroopers 400 (it was Deploy airship): 3 paratroopers at 3 s in a triangle in front of the enemy
// tower, each hitting every enemy within 3 m as it lands; nothing before 3 s; Snipers and the tower no longer get +30
assert.strictEqual(T.find(t => t.id === 'sniper').skill2.cost, 400);
assert.strictEqual(T.find(t => t.id === 'sniper').skill2.name, 'Drop paratroopers');
assert.ok(!Game.AIRSHIP, 'the airship is gone');
m = mk('sniper');
const snq = sq(m, 0, 'Sniper', 5, 13, 1), hitNo = Game.bodiesFor(m, 0).find(x => x.squad === snq.id).u.hit, towerNo = Game.bodiesFor(m, 0).find(x => x.squad === -2).u.hit;
Game.buyTowerSkill2(m, 0);
assert.strictEqual(Game.bodiesFor(m, 0).find(x => x.squad === snq.id).u.hit, hitNo, 'Snipers: no +30 hit any more');
assert.strictEqual(Game.bodiesFor(m, 0).find(x => x.squad === -2).u.hit, towerNo, 'the tower: no +30 hit any more');
assert.ok(!Game.bodiesFor(m, 0).some(x => x.squad === -4), 'no airship body');
const wisps = units[ui('Wisps')], sn = units[ui('Sniper')];
for (const side of [0, 1]) {
  const ma = mk('sniper'); ma.towers[1].type = 'sniper'; Game.buyTowerSkill2(ma, side);
  const et = Game.tileToWorld(ma.towers[1 - side].col, ma.towers[1 - side].row);
  const pd = Game.bodiesFor(ma, side).find(x => x.squad === -2).paraDrop;
  assert.ok(pd && pd.t === 3 && pd.spots.length === 3 && pd.r === 3, 'side ' + side + ': a drop of 3 at 3 s');
  assert.ok(pd.unit.hit === wisps.hit && pd.unit.hp === wisps.hp && pd.unit.projSpeed === 0 && pd.unit.bodies === 1, 'side ' + side + ': a Wisp with instant shots');
  for (const s of pd.spots) {
    const d = Math.hypot(s.x - et.x, s.y - et.y);
    assert.ok(d > 2.5 && d < 8, 'side ' + side + ': lands near the enemy tower, clear of it (' + d.toFixed(2) + ' m)');
    assert.ok(side === 0 ? s.y < et.y : s.y > et.y, 'side ' + side + ': in front of the enemy tower, toward the middle');
  }
  // an enemy squad standing on the landing spot, far from everything else
  const tc = ma.towers[1 - side], tgt = sq(ma, 1 - side, 'Brute', tc.col, tc.row + (side === 0 ? -1 : 1), 1);
  sq(ma, side, 'Brute', 5, side === 0 ? 13 : 2, 1);
  const sa = Game.startBattle(ma);
  const tb = () => sa.bodies.filter(x => x.squad === tgt.id && x.side === 1 - side);
  const hp0 = tb().reduce((a, x) => a + x.hp, 0);
  let landedAt = null, hpBefore = null;
  for (let k = 0; k < 3000 && sa.step(); k++) {
    const n = sa.bodies.filter(x => x.side === side && x.u.name === 'Paratrooper').length;
    if (landedAt == null && n) { landedAt = sa.time(); assert.strictEqual(n, 3, 'side ' + side + ': 3 paratroopers at once'); break; }
    if (sa.time() < 2.9) { assert.ok(sa.drops().length === 1 && sa.drops()[0].side === side, 'side ' + side + ': the landing spots show until the drop'); hpBefore = tb().reduce((a, x) => a + x.hp, 0); }
  }
  assert.ok(landedAt != null && landedAt >= 3 - 1e-6 && landedAt < 3.2, 'side ' + side + ': landed at 3 s (' + landedAt + ')');
  assert.ok(!sa.drops().length, 'side ' + side + ': no marker after landing');
  const hp1 = tb().reduce((a, x) => a + x.hp, 0);
  assert.ok(hp1 < hpBefore - 1, 'side ' + side + ': the landing hit the squad under it (' + hpBefore.toFixed(0) + ' -> ' + hp1.toFixed(0) + ', from ' + hp0.toFixed(0) + ')');
  assert.ok(sa.bodies.filter(x => x.side === side && x.u.name === 'Paratrooper').every(x => x.squad === -4), 'side ' + side + ': squad -4 (damage stats: paratroopers)');
}
// the same drop for both sides, mirrored: same x, y reflected
{
  const ma = mk('sniper'); ma.towers[1].type = 'sniper'; Game.buyTowerSkill2(ma, 0); Game.buyTowerSkill2(ma, 1);
  const a = Game.paraDropOf(ma, 0).spots, b = Game.paraDropOf(ma, 1).spots, t0 = Game.tileToWorld(ma.towers[0].col, ma.towers[0].row), t1 = Game.tileToWorld(ma.towers[1].col, ma.towers[1].row);
  if (Math.abs(t0.x - t1.x) < 1e-9 && Math.abs(t0.y + t1.y) < 1e-9) a.forEach((s, i) => assert.ok(Math.abs(s.x - b[i].x) < 1e-9 && Math.abs(s.y + b[i].y) < 1e-9, 'spot ' + i + ' mirrored'));
}
console.log('ok  Sniper tower: Drop paratroopers');

// Mark Bounty: 50 once, only an enemy squad from an earlier round, can't be moved, free again once the squad is sold
m = mk('sniper');
const s1 = sq(m, 0, 'Sniper', 5, 13, 1), fresh = sq(m, 1, 'Brute', 5, 3, m.round), old = sq(m, 1, 'Goblin Swarm', 6, 2, 1), old2 = sq(m, 1, 'Wisps', 7, 2, 1);
assert.ok(!Game.placeMark(m, 0, fresh.id), 'not a squad placed this round');
assert.ok(!Game.canMark(m, 1), 'the keep has no mark');
assert.ok(Game.placeMark(m, 0, old.id)); assert.strictEqual(m.gold[0], 1950);
assert.ok(!Game.placeMark(m, 0, old2.id), 'the mark can\'t be moved');
let bs = Game.bodiesFor(m, 0).filter(x => x.squad === s1.id);
assert.ok(bs.every(x => x.sniperMark === Game.MARK.hit), 'Snipers hunt the mark');
assert.ok(Game.bodiesFor(m, 1).filter(x => x.squad === old.id).every(x => x.marked), 'the marked squad');
assert.ok(!Game.bodiesFor(m, 1).some(x => x.squad === old2.id && x.marked));
assert.ok(Game.markShown(m, 0, true, 0) && !Game.markShown(m, 1, true, 0) && Game.markShown(m, 1, false, 0), 'hidden from them until the fight');
m.armies[1] = m.armies[1].filter(x => x.id !== old.id); // sold
assert.ok(Game.markLost(m, 0) && Game.markCost(m, 0) === 0 && Game.placeMark(m, 0, old2.id) && m.gold[0] === 1950, 'again for free');

// the engine: +15% from Snipers on the mark, Snipers see a stealthed mark, and the bounty for the last body
const plain = (u) => Engine.withTraits({ ...u, skills: undefined, skillDefs: undefined });
const g = { ...Game.SETTINGS };
const shoot = (marked) => {
  const [a] = Engine.buildSquad(plain(sn), 0, 0, -20, 1, 6, 0); a.sniperMark = 15;
  const [v] = Engine.buildSquad(plain({ ...units[ui('Brute')], hp: 1e6, defense: 'none', defVal: 0 }), 1, 0, 0, 2, 6, 1); v.marked = marked;
  const sim = Engine.createBattle([a], [v], g); for (let k = 0; k < 400 && sim.step(); k++) {}
  return 1e6 - v.hp;
};
const hitPlain = shoot(false), hitMarked = shoot(true);
assert.ok(hitPlain > 0 && Math.abs(hitMarked / hitPlain - 1.15) < 0.02, `+15%: ${hitPlain} -> ${hitMarked}`);
const stealthy = (marked, trueSight) => {
  const [a] = Engine.buildSquad(plain({ ...sn, trueSight }), 0, 0, -20, 1, 6, 0); if (marked) a.sniperMark = 15;
  const [v] = Engine.buildSquad(plain({ ...units[ui('Goblin Swarm')], bodies: 1, hp: 5, stealth: true, speed: 0 }), 1, 0, 0, 2, 6, 1); v.marked = marked;
  const sim = Engine.createBattle([a], [v], g); for (let k = 0; k < 600 && sim.step(); k++) {}
  return { dead: !v.alive, res: sim.result() };
};
assert.ok(!stealthy(false, false).dead, 'a Sniper can\'t see a stealthed unit');
const mk1 = stealthy(true, false);
assert.ok(mk1.dead && mk1.res.markKill[0] && !mk1.res.markKill[1], 'it sees the mark and finishes it: bounty');
assert.ok(stealthy(false, true).dead, 'Overwatch sees stealthed units in its range');
assert.ok(Engine.describeSkill({ type: 'overwatch', params: { hp: 200 } }).includes('stealthed'));
// the bounty is paid out by resolve
m = mk('sniper'); sq(m, 1, 'Brute', 5, 3, 1); const sim2 = Game.startBattle(m); while (sim2.step()) {}
const r2 = sim2.result(); r2.markKill = [true, false]; const gb = m.gold.slice();
const sum2 = Game.resolve(m, r2);
assert.deepStrictEqual(sum2.markBounty, [Game.MARK.bounty, 0]);

// Bastion: Fortify, 50 a round, one wall for this fight, gone next round, taken back for a refund
m = mk('bastion');
const t = m.towers[0];
assert.ok(Game.canFortify(m, 0) && !Game.canFortify(m, 1));
assert.ok(Game.fortify(m, 0, t.col, t.row - 1, 'n') && m.gold[0] === 1950);
assert.ok(!Game.canFortify(m, 0), 'once a round');
assert.ok(Game.bodiesFor(m, 0).some(x => x.u.kind === 'wall'), 'the wall stands in this fight');
assert.strictEqual(Game.bwallsLeft(m, 0), 0, 'no Defensive walls without the skill');
assert.ok(Game.unplaceBwall(m, 0, t.col, t.row - 1, 'n') && m.gold[0] === 2000, 'taken back');
Game.fortify(m, 0, t.col, t.row - 1, 'n');
const sim3 = Game.startBattle(m); while (sim3.step()) {} Game.resolve(m, sim3.result());
assert.ok(!m.over && !Game.bwallsOf(m, 0).length && !Game.bodiesFor(m, 0).some(x => x.u.kind === 'wall'), 'gone next round');
// Vault: the treasury's armor, and half the raid
m = mk('bastion', 'testgrid');
const tb = Game.bodiesFor(m, 0).find(x => x.squad === Game.TREASURY_SQ), tk = Game.bodiesFor(m, 1).find(x => x.squad === Game.TREASURY_SQ);
assert.ok(tb.u.defense === 'armor' && tb.u.defVal === Game.VAULT.armor && !(tk.u.defVal > 0));
assert.ok(Game.vaultOn(m, 0) && !Game.vaultOn(m, 1));
assert.strictEqual(Game.treasurySteal(800, true), 100); assert.strictEqual(Game.treasurySteal(800), 200);
console.log('towers 2026-10-28 ok');
