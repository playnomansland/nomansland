// Headless check: Otto - The Gambler's slot machine (2026-10-29)
const assert = require('assert');
const Game = require('../../src/game.js');
const roster = require('../../src/default-roster.json');
const demo = require('../../src/demo-units.json');
const units = roster.units.map(u => ({ ...u, cost: u.cost / 100, skillDefs: (u.skills || []).map(id => (roster.skills || []).find(s => s.id === id) || null) }));
const S = Game.SLOT;

// the odds: over many spins each outcome lands near its percentage
const m0 = Game.createMatch(units, demo.matrix, 1);
const count = {};
const N = 40000;
for (let k = 0; k < N; k++) { const w = Game.slotOutcome(m0, 0, 1 + (k % 50), Math.floor(k / 50) + 0).win || 'none'; count[w] = (count[w] || 0) + 1; }
for (const [sym, p] of S.odds) assert.ok(Math.abs(count[sym] / N * 100 - p) < (p > 5 ? 0.8 : 0.4), `${sym} ${(count[sym] / N * 100).toFixed(2)}% vs ${p}%`);
console.log('odds', Object.fromEntries(Object.entries(count).map(([k, v]) => [k, (v / N * 100).toFixed(1) + '%'])));
// reels: three of a kind exactly when it wins
for (let k = 0; k < 2000; k++) { const r = Game.slotReels(m0, 1, 2 + (k % 9), k % 3 + Math.floor(k / 9)), o = Game.slotOutcome(m0, 1, 2 + (k % 9), k % 3 + Math.floor(k / 9));
  assert.strictEqual(r[0] === r[1] && r[1] === r[2], !!o.win); if (o.win) assert.strictEqual(r[0], o.win); }

// a match with Otto on side 0: find spins that hit each symbol
function ottoMatch(seed) { const m = Game.createMatch(units, demo.matrix, seed); Game.choosePack(m, 0, 0); m.chars[0] = 'otto'; Game.choosePack(m, 1, 0); return m; }
const seen = new Set();
for (let seed = 1; seed < 6000 && seen.size < 7; seed++) {
  const m = ottoMatch(seed);
  m.round = 2; m.gold = [1000, 1000];
  const hp = m.hp[0], gold = m.gold[0], deploys = Game.deploysAllowed(m, 0), left = Game.deploysLeft(m, 0), army = m.armies[0].length;
  assert.ok(Game.canSpin(m, 0));
  const rec = Game.spin(m, 0);
  const w = rec.win || 'none', key = w === 'shoe' ? 'shoe-' + rec.shoe : w;
  if (seen.has(key)) continue;
  seen.add(key);
  if (w === 'skull') { assert.strictEqual(m.hp[0], hp - S.skullHp); assert.strictEqual(m.gold[0], gold - S.cost); }
  if (w === 'coin') assert.strictEqual(m.gold[0], gold - S.cost + S.coinGold);
  if (w === 'chest') assert.strictEqual(m.gold[0], gold - S.cost + S.chestGold);
  if (w === 'none') assert.strictEqual(m.gold[0], gold - S.cost);
  if (w === 'shoe' && rec.shoe === 'deploy') { // a horseshoe deployment: +1 every round from now on
    assert.strictEqual(Game.deploysAllowed(m, 0), deploys + 1);
    assert.strictEqual(Game.freeMovesLeft(m, 0), 0, 'no free move');
    m.round++; m.extraDeploys = [0, 0];
    assert.strictEqual(Game.deploysAllowed(m, 0), Game.CONFIG.deploysPerRound + 1, 'still there next round');
    m.round--;
  }
  if (w === 'shoe' && rec.shoe === 'move') {
    assert.strictEqual(Game.deploysAllowed(m, 0), deploys, 'no deployment');
    // a free move of an older squad, on top of the paid one
    const old = m.armies[0].filter(q => q.round < m.round && !q.in);
    const free = (q) => { for (let c = 0; c < Game.COLS; c++) for (let r = 10; r < 16; r++) if (Game.moveSquad(m, 0, q.id, c, r)) return true; return false; };
    const g0 = m.gold[0];
    assert.ok(old.length >= 2, 'two older squads');
    assert.ok(free(old[0]), 'horseshoe move'); assert.strictEqual(m.gold[0], g0, 'it is free'); assert.strictEqual(old[0].luckMove, m.round);
    assert.ok(free(old[1]), 'the paid move'); assert.strictEqual(m.gold[0], g0 - Game.CONFIG.moveCost);
    assert.ok(Game.moveSquad(m, 0, old[0].id, old[0].from.col, old[0].from.row), 'back where it was');
    assert.ok(!old[0].luckMove && !old[0].from && Game.slotMovesLeft(m, 0) === 1);
    // every round from now on
    m.round++; m.moved = [null, null];
    for (const q of m.armies[0]) { delete q.from; delete q.movedRound; delete q.luckMove; }
    assert.strictEqual(Game.freeMovesLeft(m, 0), 1, 'a free move next round too');
    m.round--;
  }
  if (w === 'goblin') {
    assert.strictEqual(m.armies[0].length, army + 1);
    const g = m.armies[0][m.armies[0].length - 1];
    assert.ok(g.gift && g.level === 1 && Game.isTier1(m, g.unit) && Game.isUnlocked(m, 0, g.unit));
    assert.strictEqual(Game.deploysLeft(m, 0), left, 'no deployment used');
    assert.ok(!Game.unplaceSquad(m, 0, g.id), 'a slot goblin cannot be taken back');
    assert.strictEqual(m.gold[0], gold - S.cost);
  }
}
assert.deepStrictEqual([...seen].sort(), ['chest', 'coin', 'goblin', 'none', 'shoe-deploy', 'shoe-move', 'skull'], 'every outcome seen');

// horseshoes: one of each perk at most; the third (with both) pays SLOT.shoeGold
{
  const m = ottoMatch(9); m.round = 2;
  if (!m.slots) m.slots = [{}, {}];
  m.slots[0][1] = [{ win: 'shoe', shoe: 'deploy' }];
  assert.ok(Game.shoePerk(m, 0, 'deploy') && !Game.shoePerk(m, 0, 'move'));
  // the next horseshoe can only be a move
  let k = 0; for (; k < 500; k++) if (Game.slotOutcome(m, 0, 2, k).win === 'shoe') break;
  // play spins up to k on round 2 (each record as the machine makes it)
  m.gold = [100000, 0];
  m.slots[0][2] = [];
  for (let i = 0; i < k; i++) m.slots[0][2].push({ win: null });
  const rec = (() => { const list = m.slots[0][2]; const save = Game.SLOT.perRound; Game.SLOT.perRound = 1e9; const r = Game.spin(m, 0); Game.SLOT.perRound = save; return r; })();
  assert.strictEqual(rec.win, 'shoe'); assert.strictEqual(rec.shoe, 'move', 'the perk not yet owned');
  assert.ok(Game.shoePerk(m, 0, 'move') && Game.freeMoves(m, 0) === 1);
  let k2 = k + 1; for (; k2 < 2000; k2++) if (Game.slotOutcome(m, 0, 2, k2).win === 'shoe') break;
  while (m.slots[0][2].length < k2) m.slots[0][2].push({ win: null });
  const g = m.gold[0];
  const save = Game.SLOT.perRound; Game.SLOT.perRound = 1e9; const rec2 = Game.spin(m, 0); Game.SLOT.perRound = save;
  assert.strictEqual(rec2.shoe, 'gold', 'both owned: gold');
  assert.strictEqual(m.gold[0], g - S.cost + S.shoeGold);
  assert.strictEqual(Game.deploysAllowed(m, 0), Game.CONFIG.deploysPerRound + 1, 'still one extra deployment');
  // the host replays the guest's spins to the same perks
  const h = ottoMatch(9); h.round = 2; h.chars[1] = 'otto'; h.slots = [{}, { 1: [{ win: 'shoe', shoe: 'deploy' }] }];
  const save2 = Game.SLOT.perRound; Game.SLOT.perRound = 1e9;
  const gm = ottoMatch(9); gm.chars[1] = 'otto'; gm.round = 2; gm.gold = [0, 100000]; gm.slots = [{}, { 1: [{ win: 'shoe', shoe: 'deploy' }] }];
  for (let i = 0; i < 40; i++) Game.spin(gm, 1);
  Game.takeSpins(h, 1, 40);
  Game.SLOT.perRound = save2;
  assert.deepStrictEqual(h.slots[1][2].map(x => x.shoe || null), gm.slots[1][2].map(x => x.shoe || null), 'host and guest agree on the perks');
  console.log('horseshoe perks ok');
}

// limits: 3 a round, 50 gold, never below 1 health, only Otto
const m = ottoMatch(5); m.gold = [10000, 1000];
for (let k = 0; k < S.perRound; k++) assert.ok(Game.spin(m, 0));
assert.ok(!Game.canSpin(m, 0), '3 a round');
assert.ok(!Game.canSpin(m, 1), 'only Otto');
m.round = 2; m.gold[0] = 49; assert.ok(!Game.canSpin(m, 0), 'needs 50 gold');
let skullSpin = null; for (let r = 2; r < 400 && !skullSpin; r++) for (let k = 0; k < 3; k++) if (Game.slotOutcome(m, 0, r, k).win === 'skull' && k === 0) { skullSpin = r; break; }
m.round = skullSpin; m.hp[0] = 3; m.gold[0] = 100; Game.spin(m, 0); assert.strictEqual(m.hp[0], 1, 'skull stops at 1 health');

// the host replays the guest's spins for their health cost
const h = ottoMatch(9); h.chars[1] = 'otto'; h.round = skullSpin; h.hp[1] = 50;
Game.takeSpins(h, 1, 1); assert.strictEqual(h.hp[1], 50 - (Game.slotOutcome(h, 1, h.round, 0).win === 'skull' ? S.skullHp : 0));
Game.takeSpins(h, 1, 1); assert.strictEqual(Game.slotSpins(h, 1).length, 1, 'taken once');

// the bot spins sometimes and keeps a squad's worth of gold
let botSpins = 0;
for (let seed = 1; seed < 60; seed++) { const b = Game.createMatch(units, demo.matrix, seed); Game.choosePack(b, 1, 0); b.chars[1] = 'otto'; b.round = 3; b.gold[1] = 600; Game.aiDeploy(b, 1); botSpins += Game.slotSpins(b, 1).length; }
assert.ok(botSpins > 20 && botSpins < 100, `bot spins ${botSpins} in 59 rounds`);
console.log('otto ok');
