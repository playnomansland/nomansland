#!/usr/bin/env node
'use strict';
// The leader draft (2026-11-05): no leader with the packages; before round 2 the winner of round 1 picks first from a
// shared pool, the other player from the rest; never the same leader; open picks; 30 s a pick online.
//   node tools/tests/leader-draft.js
const assert = require('assert');
const C = require('../exploit/checks/_common.js');
const { L } = C;
const Game = L.Game, Ref = L.Ref;
const prepared = L.roster();

// round 1 with the AI on both sides, then the fight: returns the context at the start of round 2
function toRound2(seed) {
  const ctx = C.newMatch(prepared, seed);
  C.aiTurn(ctx, 0); C.aiTurn(ctx, 1);
  const s = C.fight(ctx);
  return { ctx, s };
}

// packages carry no leader; the pool is the same for both
{
  const ctx = C.newMatch(prepared, 980000), m = ctx.R.m;
  assert.ok(Game.drafting(m));
  assert.ok(m.packages.every(ps => ps.every(p => !p.char)), 'no leader in a package');
  assert.strictEqual(m.draft.pool.length, Game.DRAFT.pool);
  assert.ok(!Game.needsLeaderPick(m, 0) && !Game.needsLeaderPick(m, 1), 'round 1: no pick yet');
  assert.ok(!Ref.act(ctx.R, 0, { seq: ++ctx.log.seq[0], fn: 'pickLeader', a: [m.draft.pool[0]] }, ctx.T.now).ok, 'round 1: refused');
  console.log('round 1: packages without leaders, no pick yet');
}

// round 2: the winner first, never the same, the clock waits
let seen = { win: 0, draw: 0 };
for (let seed = 980100; seed < 980140; seed++) {
  const { ctx, s } = toRound2(seed);
  const R = ctx.R, m = R.m;
  if (R.phase !== 'deploy' || m.round !== 2) continue;
  // the AI's turn ran already in the test's fight helper? No: picks start now
  const first = Game.draftFirst(m), second = 1 - first;
  if (s.winner === 0 || s.winner === 1) { assert.strictEqual(first, s.winner, 'the winner of round 1 picks first'); seen.win++; } else seen.draw++;
  assert.ok(Game.needsLeaderPick(m, 0) && Game.needsLeaderPick(m, 1));
  assert.ok(Game.leaderTurn(m, first) && !Game.leaderTurn(m, second), 'only the first picker\'s turn');
  assert.strictEqual(R.deadline, 0, 'the deploy clock waits for the draft');
  assert.ok(R.draftDue > ctx.T.now, 'the pick has its own clock');
  const pick = m.draft.pool[1];
  assert.ok(!C.act(ctx, second, 'pickLeader', pick).ok, 'the second picker waits');
  assert.ok(!C.act(ctx, first, 'pickLeader', 'nobody').ok, 'not in the pool: refused');
  assert.ok(C.act(ctx, first, 'pickLeader', pick).ok, 'first pick');
  assert.ok(!C.act(ctx, first, 'pickLeader', m.draft.pool[2]).ok, 'one pick each');
  assert.strictEqual(Ref.viewOf(R, second).chars[first], pick, 'the pick is open: the other player sees it');
  assert.ok(!C.act(ctx, second, 'pickLeader', pick).ok, 'the same leader: refused');
  assert.ok(C.act(ctx, second, 'pickLeader', m.draft.pool[0]).ok, 'second pick from the rest');
  assert.notStrictEqual(m.chars[0], m.chars[1]);
  assert.ok(R.deadline > ctx.T.now, 'both picked: the deploy clock runs');
  if (seen.win >= 3 && seen.draw >= 1) break;
}
assert.ok(seen.win >= 3, 'some round 1 winners');
console.log(`round 2: winner picks first, never the same leader, open picks, the clock waits (${seen.win} wins, ${seen.draw} draws)`);

// a player who doesn't pick: the first leader left after 30 s, then the other player's turn
{
  const { ctx } = toRound2(980200);
  const R = ctx.R, m = R.m, first = Game.draftFirst(m);
  const t0 = ctx.T.now;
  assert.strictEqual(Ref.tick(R, t0 + Ref.DRAFT_PICK_MS - 10), null);
  assert.ok(!m.chars[first], 'not yet');
  assert.ok(Ref.due(R, t0) > t0 && Ref.due(R, t0) <= t0 + Ref.DRAFT_PICK_MS, 'the room wakes up for it');
  Ref.tick(R, t0 + Ref.DRAFT_PICK_MS + 1);
  assert.strictEqual(m.chars[first], m.draft.pool[0], 'too slow: the first leader in the pool');
  assert.ok(Game.leaderTurn(m, 1 - first), 'now the other player');
  Ref.tick(R, t0 + 2 * Ref.DRAFT_PICK_MS + 50);
  assert.strictEqual(m.chars[1 - first], m.draft.pool[1], 'too slow too: the next one left');
  assert.ok(R.deadline > 0, 'the clock runs');
  console.log('too slow: picked for you after 30 s');
}

// nobody picks and they go straight to Ready: settled at the fight, still different
{
  const { ctx } = toRound2(980300);
  ctx.T.now += 10;
  const f = C.fight(ctx);
  assert.ok(f);
  const m = ctx.R.m;
  assert.ok(m.chars[0] && m.chars[1] && m.chars[0] !== m.chars[1], 'settled at the fight');
  console.log('settled at the fight');
}

// the AI drafts in whole matches; no Factions, tutorial or 2v2 draft
{
  for (let seed = 980400; seed < 980404; seed++) {
    const ctx = C.newMatch(prepared, seed);
    for (let g = 0; g < 30 && ctx.R.phase === 'deploy'; g++) { C.aiTurn(ctx, 0); C.aiTurn(ctx, 1); C.fight(ctx); }
    const m = ctx.R.m;
    assert.ok(m.chars[0] && m.chars[1] && m.chars[0] !== m.chars[1], 'whole AI match: two different leaders');
    assert.strictEqual(ctx.log.refused.length, 0, 'the referee took every AI move');
  }
  const { units, matrix } = prepared;
  assert.ok(!Game.drafting(Game.createMatch(units, matrix, 1, 'standard', null, [], { draft: false })), 'draft: false');
  assert.ok(!Game.drafting(Game.createMatch(units, matrix, 1, null, null, [], { noChars: true })), 'no leaders (2v2)');
  console.log('AI matches draft; off where there are no leaders');
}
console.log('leader draft: all ok');
