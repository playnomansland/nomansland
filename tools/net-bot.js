// A scripted player for tests of the refereed match (src/referee.js, server/src/room.js). It plays like a phone does:
// on its own copy of what it may see (the view), through the Game functions, and every call that works becomes an
// action { fn, a } to send. Used by tools/tests/referee.js (no server) and server/test/match.test.js (over WebSockets).
const Game = require('../src/game.js');

// a small seeded random
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// a random tile where side may put a squad of unit ui
function spotFor(m, side, ui, r) {
  const ok = [];
  for (let row = 0; row < 40; row++) for (let col = 0; col < 40; col++) if (Game.canPlaceAt(m, side, col, row, ui) && Game.spotFree(m, side, col, row, ui)) ok.push({ col, row });
  return ok.length ? ok[Math.floor(r() * ok.length)] : null;
}

// Plays one deploy for `side` on `local` (the view with units). Returns the actions it took, in order.
// opts: { r (random), spins (Otto: how many to try), undoAll (try Undo all once, then play on) }
function deploy(local, side, opts) {
  const r = opts.r, acts = [];
  const call = (fn, ...a) => { let ok; try { ok = Game[fn](local, side, ...a); } catch (e) { ok = false; } if (ok) acts.push({ fn, a }); return ok; };
  const m = local;
  if (Game.needsPack(m, side)) call('choosePack', Math.floor(r() * m.packages[side].length));
  if (Game.needsTowerPick(m, side)) { const ch = Game.towerChoices(m, side); call('setTowerType', ch[Math.floor(r() * ch.length)].id); }
  for (let k = 0; k < (opts.spins || 0); k++) if (Game.canSpin(m, side)) call('spin');
  // level up what is ready, now and then a skill, a loan, a sale or a move
  for (const sq of m.armies[side].slice()) if (Game.isReady(m, sq) && r() < 0.7) call('levelUp', sq.id);
  if (r() < 0.3) {
    const mine = [...new Set(m.armies[side].map(q => q.unit))];
    const ui = mine[Math.floor(r() * mine.length)];
    if (ui != null) call('buySkill', ui, r() < 0.5 ? 0 : 1);
  }
  if (r() < 0.2 && Game.canTakeLoan(m, side)) call('takeLoan');
  const old = m.armies[side].filter(q => q.round < m.round);
  if (old.length > 2 && r() < 0.2) call('sell', old[Math.floor(r() * old.length)].id);
  if (old.length && r() < 0.25) {
    const sq = old[Math.floor(r() * old.length)];
    const spot = spotFor(m, side, sq.unit, r);
    if (spot) call('moveSquad', sq.id, spot.col, spot.row);
  }
  // new squads up to the deployments left
  for (let tries = 0; tries < 12 && Game.deploysLeft(m, side) > 0; tries++) {
    const can = m.units.map((u, i) => i).filter(i => !Game.isOff(m, i, side) && (Game.freeLeft(m, side).includes(i) || (Game.isUnlocked(m, side, i) && m.gold[side] >= Game.shopCost(m, side, i))));
    if (!can.length) {
      const locked = m.units.map((u, i) => i).filter(i => !Game.isOff(m, i, side) && !Game.isUnlocked(m, side, i) && m.gold[side] >= Game.unlockCost(m, i, side) + Game.shopCost(m, side, i));
      if (locked.length) { call('unlock', locked[Math.floor(r() * locked.length)]); continue; }
      break;
    }
    const ui = can[Math.floor(r() * can.length)];
    const spot = spotFor(m, side, ui, r);
    if (spot) call('place', ui, spot.col, spot.row);
  }
  if (r() < 0.3) call('buyDeploy');
  return acts;
}

module.exports = { rng, deploy };
