#!/usr/bin/env node
'use strict';
// The four online-match holes from docs/EXPLOITS-2026-11.md, fixed on 2026-11-05. Each check fails on the old code.
//   node tools/tests/referee-fixes.js
const assert = require('assert');
const C = require('../exploit/checks/_common.js');
const { L } = C;
const Game = L.Game, Ref = L.Ref;
const prepared = L.roster();

// play to the tower-pick round (both sides played by the AI), with `type` picked for side 0; null if not offered
function toPick(seed, type) {
  const ctx = C.newMatch(prepared, seed);
  for (let round = 1; round < Game.TOWER_PICK_ROUND; round++) {
    C.aiTurn(ctx, 0); C.aiTurn(ctx, 1);
    C.fight(ctx);
    if (ctx.R.phase !== 'deploy') return null;
  }
  if (type && !Game.towerChoices(ctx.R.m, 0).some(t => t.id === type)) return null;
  return ctx;
}
const undoAll = (ctx, side) => Ref.act(ctx.R, side, { seq: ++ctx.log.seq[side], fn: 'undoAll' }, ctx.T.now);

// 1. Undo all doesn't make the Mark Bounty mark free
{
  let done = 0;
  for (let s = 0; s < 120 && done < 3; s++) {
    const ctx = toPick(970000 + s, 'sniper');
    if (!ctx || !C.act(ctx, 0, 'setTowerType', 'sniper').ok) continue;
    const m = ctx.R.m, target = m.armies[1].find(q => Game.markTarget(m, 0, q.id));
    if (!target) continue;
    const g0 = m.gold[0];
    assert.ok(C.act(ctx, 0, 'placeMark', target.id).ok, 'the mark is placed');
    assert.strictEqual(m.gold[0], g0 - Game.MARK.cost, 'and paid for');
    assert.ok(undoAll(ctx, 0).ok);
    assert.strictEqual(Game.markOf(m, 0), null, 'Undo all: no mark');
    assert.strictEqual(Game.markCost(m, 0), Game.MARK.cost, 'Undo all: the mark costs its price again');
    const g1 = m.gold[0];
    assert.ok(C.act(ctx, 0, 'placeMark', target.id).ok);
    assert.strictEqual(m.gold[0], g1 - Game.MARK.cost, 'placed again: paid again');
    done++;
  }
  assert.ok(done > 0, 'a sniper tower was offered');
  console.log(`mark after Undo all: paid for every time (${done} matches)`);
}

// 2. A resent action is handled once
{
  const ctx = C.newMatch(prepared, 971000), R = ctx.R, m = R.m;
  assert.ok(Ref.act(R, 0, { seq: 1, fn: 'choosePack', a: [0] }, ctx.T.now).ok);
  const g = m.gold[0], cost = Game.deployCost(m, 0);
  const a = { seq: 2, fn: 'buyDeploy', a: [] };
  const first = Ref.act(R, 0, a, ctx.T.now), again = Ref.act(R, 0, a, ctx.T.now);
  assert.ok(first.ok, 'the first one counts');
  assert.ok(!again.ok && again.why === 'dup', 'the same message again: refused as a resend');
  assert.strictEqual(m.gold[0], g - cost, 'paid once');
  assert.ok(!Ref.act(R, 0, { seq: 1, fn: 'refundDeploy', a: [] }, ctx.T.now).ok, 'an older number: refused');
  assert.ok(Ref.act(R, 0, { seq: 3, fn: 'refundDeploy', a: [] }, ctx.T.now).ok, 'the next number works');
  assert.ok(Ref.act(R, 1, { seq: 2, fn: 'choosePack', a: [0] }, ctx.T.now).ok, 'numbers are per side');
  console.log('resent action: handled once');
}

// 3. A loan is paid back on the terms it was taken on
{
  let done = 0;
  for (let s = 0; s < 120 && done < 2; s++) {
    const ctx = toPick(972000 + s, 'bank');
    if (!ctx) continue;
    const m = ctx.R.m;
    assert.ok(Game.needsTowerPick(m, 0));
    const g0 = m.gold[0];
    assert.ok(C.act(ctx, 0, 'takeLoan').ok, 'a loan before the tower pick');
    assert.strictEqual(m.gold[0] - g0, Game.LOAN.gold, 'on the normal terms');
    assert.ok(C.act(ctx, 0, 'setTowerType', 'bank').ok, 'then the Bank');
    assert.deepStrictEqual(Game.loanTaken(m, 0), { gold: Game.LOAN.gold, payback: Game.LOAN.payback }, 'the loan keeps its terms');
    // payback after the fight: the normal loan's, not the Credit line's
    C.aiTurn(ctx, 1);
    const sum = C.fight(ctx);
    assert.ok(sum && sum.loan, 'a summary with the loan');
    assert.ok(sum.loan[0] <= Game.LOAN.payback, `paid back at most ${Game.LOAN.payback} (was ${sum.loan[0]})`);
    done++;
  }
  assert.ok(done > 0, 'a bank was offered');
  // and Undo of the loan takes back what it gave
  const ctx = C.newMatch(prepared, 973000), m = ctx.R.m;
  C.act(ctx, 0, 'choosePack', 0);
  const g = m.gold[0];
  assert.ok(C.act(ctx, 0, 'takeLoan').ok && C.act(ctx, 0, 'undoLoan').ok);
  assert.strictEqual(m.gold[0], g, 'undo: back to the gold before');
  assert.strictEqual(Game.loanTaken(m, 0), Game.loanTerms(m, 0), 'no loan: the current terms');
  console.log(`loan terms: kept from when it was taken (${done} matches)`);
}

// 4. Negative numbers never reach the rules
{
  const ctx = C.newMatch(prepared, 974000), R = ctx.R, m = R.m;
  C.act(ctx, 0, 'choosePack', 0);
  const s0 = JSON.stringify(Ref.snapshot(m));
  for (const [fn, a] of [['buySkill', [-2, 18]], ['buyBuilding', [-2, 11, 20, 9]], ['place', [-1, 3, 12]], ['sell', [-5]], ['levelBuilding', [-3]], ['moveSquad', [0, -1, 12]]]) {
    const r = Ref.act(R, 0, { seq: ++ctx.log.seq[0], fn, a }, ctx.T.now);
    assert.ok(!r.ok && r.why === 'bad', `${fn} ${JSON.stringify(a)}: refused before the rules (${r.why})`);
  }
  assert.strictEqual(JSON.stringify(Ref.snapshot(m)), s0, 'nothing changed');
  // a direction arrow may point back (negative offsets are allowed there)
  assert.deepStrictEqual(Ref.cleanArgs('setAim', [3, -2, -1]), [3, -2, -1]);
  assert.strictEqual(Ref.cleanArgs('setAim', [-3, 2, 1]), null);
  console.log('negative numbers: refused');
}
console.log('referee fixes: all ok');
