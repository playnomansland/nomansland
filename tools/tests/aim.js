// Headless check of direction arrows (Game.AIM): a melee squad's arrow overrides sight and awareness until its bodies
// reach the end of it. Run from the repo root: node tools/tests/aim.js
// - Only melee squads (base range up to AIM.melee) that walk get one; never a rider or a building.
// - An arrow is at most AIM.maxTiles tiles long (a longer one is cut down along its line) and stays on the board.
// - In a fight the bodies walk the arrow past an enemy they would otherwise have turned to, each keeping its place in
//   the formation, then fight as usual; an enemy in reach ahead still stops them (one beside or behind doesn't, see
//   fixes-1107-combat.js); a walk that gets no closer for AIM.stall s gives up.
// - The opponent doesn't see it while deploying (Referee.hide, Game.seenBy); setAim / clearAim are referee actions.
const assert = require('assert');
const E = require('../../src/engine.js');
const Game = require('../../src/game.js');
const Referee = require('../../src/referee.js');
const roster = require('../../src/default-roster.json');
const skill = (id) => roster.skills.find(x => x.id === id);
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: E.SLOTS.map(k => (u.skills || [])[k] ? skill(u.skills[k]) : null) }));
const ix = (n) => { const i = units.findIndex(u => u.name === n); assert.ok(i >= 0, n); return i; };
const clone = (m) => ({ ...JSON.parse(JSON.stringify({ ...m, units: null, matrix: null })), units: m.units, matrix: m.matrix });
const fresh = () => { const m = Game.createMatch(units, null, 5, 'standard'); m.armies = [[], []]; m.round = 4; return m; };
let nid = 100;
const put = (m, side, name, col, row, extra) => { const sq = { id: nid++, unit: ix(name), col, row, round: 1, xp: 0, level: 0, cost: 0, ...extra }; m.armies[side].push(sq); return sq; };
const len = (a) => Math.sqrt(a.dc * a.dc + a.dr * a.dr);

// who may get one
{
  const m = fresh();
  const brute = put(m, 0, 'Brute', 5, 12), sniper = put(m, 0, 'Sniper', 6, 12), golem = put(m, 0, 'Ether Golem', 2, 13), horse = put(m, 0, 'Just a horse', 8, 12);
  const rider = put(m, 0, 'Goblin Swarm', 8, 12, { in: horse.id });
  assert.ok(Game.canAim(m, 0, brute), 'Brute (melee)');
  assert.ok(Game.canAim(m, 0, golem), `Ether Golem (range ${Game.AIM.melee})`);
  assert.ok(!Game.canAim(m, 0, sniper), 'not a Sniper');
  assert.ok(!Game.canAim(m, 0, rider), 'not a rider (its carrier walks it)');
  assert.ok(Game.canAim(m, 0, horse), 'the carrier');
  assert.ok(!Game.canAim(m, 1, brute), 'not the other side\'s squad');
  assert.ok(!Game.setAim(m, 0, sniper.id, 0, -3) && !sniper.aim, 'setAim refuses a ranged squad');
}
// how long, and where
{
  const m = fresh(), b = put(m, 0, 'Brute', 5, 12);
  assert.ok(Game.setAim(m, 0, b.id, 2, -3), 'set');
  assert.deepStrictEqual(b.aim, { dc: 2, dr: -3 });
  assert.deepStrictEqual(Game.aimEnd(m, b), { col: 7, row: 9 });
  assert.ok(!Game.setAim(m, 0, b.id, 2, -3), 'the same arrow again changes nothing');
  assert.ok(!Game.setAim(m, 0, b.id, 0, 0) && b.aim.dc === 2, 'no length: no arrow');
  Game.setAim(m, 0, b.id, 0, -12);
  assert.deepStrictEqual(b.aim, { dc: 0, dr: -Game.AIM.maxTiles }, 'cut down to the most');
  Game.setAim(m, 0, b.id, 9, -9);
  assert.ok(len(b.aim) <= Game.AIM.maxTiles + 1e-9 && b.aim.dc > 0 && b.aim.dr < 0 && Math.abs(b.aim.dc + b.aim.dr) <= 1, `along its line: ${JSON.stringify(b.aim)}`);
  Game.setAim(m, 0, b.id, -4, 0);
  const e = Game.aimEnd(m, b); assert.ok(e.col === 1 && e.row === 12);
  const edge = put(m, 0, 'Brute', 1, 14);
  Game.setAim(m, 0, edge.id, -4, 3);
  assert.deepStrictEqual(edge.aim, { dc: -1, dr: 1 }, 'stays on the board');
  assert.ok(Game.clearAim(m, 0, b.id) && !b.aim && !Game.clearAim(m, 0, b.id), 'clear');
}

// the fight: a Brute that would go for the enemy ahead walks its arrow sideways first
const fightWith = (aim) => {
  const m = fresh();
  const b = put(m, 0, 'Brute', 3, 10);
  put(m, 1, 'Ether Golem', 3, 6); // straight ahead, well within sight
  if (aim) assert.ok(Game.setAim(m, 0, b.id, aim[0], aim[1]));
  const bt = Game.startBattle(clone(m));
  const mine = bt.bodies.filter(x => x.side === 0 && x.squad === b.id);
  const start = mine.map(x => ({ x: x.x, y: x.y }));
  return { bt, mine, start, b };
};
{
  const plain = fightWith(null);
  for (let k = 0; k < 20; k++) plain.bt.step();
  assert.ok(plain.mine.some(x => x.intent), 'without an arrow it goes for the Golem at once');
  const { bt, mine, start } = fightWith([5, 0]);
  const dx = 5 * Game.TILE;
  assert.ok(mine.every(x => x.guide && x.guide.length === 1 && x.guideT > 0), 'every body has the arrow');
  mine.forEach((x, k) => { assert.ok(Math.abs(x.guide[0].x - (start[k].x + dx)) < 1e-9 || x.guide[0].x >= Game.COLS * Game.TILE / 2 - 1 - 1e-9, 'keeps its place in the formation'); assert.ok(Math.abs(x.guide[0].y - start[k].y) < 1e-9); });
  let walked = 0;
  for (let k = 0; k < 400 && mine.some(x => x.alive && x.guide); k++) {
    bt.step();
    for (const x of mine) if (x.alive && x.guide) assert.ok(!x.intent && !x.engaged, 'no awareness while it walks the arrow');
    walked = k;
  }
  assert.ok(mine.every(x => !x.alive || !x.guide), `reached the end (${walked} ticks)`);
  mine.forEach((x, k) => { if (x.alive) assert.ok(x.x - start[k].x > dx - 3, `walked sideways: ${(x.x - start[k].x).toFixed(1)} m`); });
  for (let k = 0; k < 60; k++) bt.step();
  assert.ok(mine.some(x => x.alive && x.intent), 'then it fights as usual');
}
// an enemy in reach still stops it
{
  const m = fresh();
  const b = put(m, 0, 'Brute', 3, 10);
  put(m, 1, 'Brute', 3, 9); // right in front
  Game.setAim(m, 0, b.id, 0, -5);
  const bt = Game.startBattle(clone(m));
  let hit = false;
  for (let k = 0; k < 200; k++) { bt.step(); if (bt.bodies.some(x => x.side === 1 && x.alive && x.hp < x.u.hp)) hit = true; }
  assert.ok(hit, 'it fights what is in its reach on the way');
}
// a walk that can't finish (pushed against the board's edge) gives up and fights
{
  const m = fresh();
  const b = put(m, 0, 'Brute', 0, 12);
  put(m, 1, 'Sniper', 6, 3);
  b.aim = { dc: -3, dr: 0 }; // off the board (as if it was moved there after the arrow was drawn): the bodies stop at the edge
  const bt = Game.startBattle(clone(m));
  const mine = bt.bodies.filter(x => x.side === 0 && x.squad === b.id);
  for (let k = 0; k < Math.round((Game.AIM.stall + 3) / Game.SETTINGS.dt); k++) bt.step();
  assert.ok(mine.every(x => !x.guide), 'gave up on the arrow');
}

// the engine: b.guideT s without getting closer -> the arrow is dropped where the body is (2026-11-07: a fixed time before)
{
  const G = { dt: 0.05, timeCap: 60, spacing: 3.5, minDmgPct: 15, sight: 15, minSight: 18, drift: 15, flameReach: 1.2 };
  const w = E.buildSquad(E.withTraits({ name: 'W', cost: 1, bodies: 1, hp: 5000, hit: 1, aps: 1, range: 2, speed: 2, splash: 0 }), 0, 0, 0, 1, 6)[0];
  const d = E.buildSquad(E.withTraits({ name: 'D', cost: 1, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 1, speed: 0, splash: 0, idle: true }), 1, 0, 80, 2, 6)[0];
  w.guide = [{ x: 60, y: 0 }]; w.guideT = 1;
  const bt = E.createBattle([w], [d], G);
  for (let k = 0; k < 30; k++) bt.step();
  assert.ok(w.guide && w.x > 2.5, 'still getting closer: it keeps the arrow');
  for (let k = 0; k < 30; k++) { w.slowT = 1; w.slowMove = 100; bt.step(); } // held still
  assert.ok(!w.guide && w.guideT == null && w.x > 2.5 && w.x < 3.5, `gave up after 1 s without getting closer, at x ${w.x.toFixed(2)}`);
}

// hidden from the opponent while deploying, out in the open in the fight
{
  const m = fresh();
  const b = put(m, 0, 'Brute', 3, 10), old = put(m, 0, 'Brute', 6, 10);
  Game.setAim(m, 0, b.id, 1, -4); Game.setAim(m, 0, old.id, -1, -4);
  const foe = Referee.view(m, 1, true);
  assert.ok(foe.armies[0].every(q => !q.aim), 'the opponent\'s view has no arrows');
  assert.ok(Referee.view(m, 0, true).armies[0].every(q => q.aim), 'your own view keeps them');
  assert.ok(Referee.view(m, 1, false).armies[0].every(q => q.aim), 'the fight shows them');
  assert.ok(Game.seenBy(m, 1).armies[0].every(q => !q.aim), 'nor does what the opponent\'s preview reads');
  assert.ok(Referee.ACTIONS.setAim && Referee.ACTIONS.clearAim, 'referee actions');
  assert.deepStrictEqual(Referee.cleanArgs('setAim', [b.id, 1, -4]), [b.id, 1, -4]);
  assert.strictEqual(Referee.cleanArgs('setAim', [b.id, 'x', -4]), null);
}
// the intent preview of an aimed squad plays the arrow too (it is the same engine)
{
  const m = fresh();
  const b = put(m, 0, 'Brute', 3, 10);
  put(m, 1, 'Ether Golem', 3, 6);
  const before = Game.intentPreview(m, 0, { id: b.id });
  Game.setAim(m, 0, b.id, 5, 0);
  const after = Game.intentPreview(m, 0, { id: b.id });
  assert.ok(before && after && JSON.stringify(before.picks) !== JSON.stringify(after.picks) || (after.ahead && after.ahead.dx > 0.5), 'the preview changes with the arrow');
}
console.log('direction arrows: ok');
