// 2v2 (src/duo.js): the sniper tower's paratroopers come from lane 0's tower only, once per team, and land at the
// enemy team's tower (lane 0's: the one that stands in the fight). Run from the repo root: node tools/tests/para-duo.js
const assert = require('assert');
const Game = require('../../src/game.js'), Ref = require('../../src/referee.js'), Duo = require('../../src/duo.js');
const Lab = require('../balance-lab.js');
const prepared = Lab.prepareRoster();
const lane = (s) => Ref.newMatch(prepared.units, prepared.matrix, Ref.cleanSettings({ map: 'testgrid' }, prepared.units), s);
const lanes = [lane(41), lane(1041)];
for (const m of lanes) { m.round = Game.TOWER_PICK_ROUND; m.gold = [5000, 5000]; for (const sd of [0, 1]) { Game.choosePack(m, sd, 0); m.towers[sd].type = 'sniper'; } }
for (const m of lanes) for (const sd of [0, 1]) assert.ok(Game.buyTowerSkill2(m, sd), 'bought');
for (const m of lanes) for (const sd of [0, 1]) Game.aiDeploy(m, sd);
const bt = Duo.battle(lanes, { record: false });
const enemyTower = (sd) => bt.bodies.find(b => b.side === 1 - sd && b.u.structure && b.squad === -2);
let landed = null;
for (let k = 0; k < 400 && bt.step(); k++) {
  const ps = bt.bodies.filter(b => b.u.name === 'Paratrooper');
  if (ps.length) { landed = ps; break; }
}
assert.ok(landed, 'paratroopers landed');
for (const sd of [0, 1]) {
  const mine = landed.filter(b => b.side === sd), t = enemyTower(sd);
  assert.strictEqual(mine.length, 3, 'team ' + sd + ': 3 paratroopers (lane 0\'s skill only, once)');
  for (const b of mine) assert.ok(Math.hypot(b.x - t.x, b.y - t.y) < 8, 'team ' + sd + ': at the enemy team\'s tower');
}
console.log('para-duo: ok');
