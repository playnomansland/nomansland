// Replay a round (2026-11-04), vs AI on the 2D board: the match-over card has Replay a round (not Look at board); its
// sheet has a button per round played; a round starts again from its start (your gold and army as they were once the
// round's picks were done, the opponent's army as it fought, all of it in sight), Fight plays it, the result card says
// how it went and how it went in the match; Try again starts over; Back to results puts the real match back unchanged.
// Run from the repo root with the game served on port 8766: node tools/tests/replay-round-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const exe = process.env.PB_CHROME;
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(600);
  await p.click('#go'); await sleep(1200);
  await p.dblclick('[data-pack="0"]'); await sleep(400);
  const pb = (f, a) => p.evaluate(f, a);
  const state = () => pb(() => { const { m, me, phase } = window.__pb(); return { phase, round: m && m.round, over: m && m.over, gold: m && m.gold[me], hp: m && m.hp.slice() }; });
  // play rounds (fights are instant with reduced motion) until the match is over
  const golds = {};
  for (let k = 0; k < 14; k++) {
    let s = await state();
    if (s.over) break;
    if (s.phase === 'deploy') {
      golds[s.round] = s.gold;
      if (s.round >= 3) await pb(() => { const { m } = window.__pb(); m.hp = [1, 1]; }); // end it soon
      if (await pb(() => { const { m, me } = window.__pb(); return Game.needsTowerPick(m, me); })) { // round 3: the tower
        await p.locator('[data-opt]:visible').first().click(); await sleep(250);
        await p.getByRole('button', { name: 'Choose', exact: true }).click(); await sleep(400);
      }
      if (await p.locator('#fight[disabled]').count()) { console.log('fight disabled', JSON.stringify(await pb(() => { const { m, me } = window.__pb(); return { round: m.round, army: m.armies[me].length, pack: Game.needsPack(m, me), tower: Game.needsTowerPick(m, me) }; }))); await p.screenshot({ path: 'replay-stuck.png' }); }
      await p.click('#fight'); await sleep(500);
      const cap = p.locator('#cap-go, #cap-fight'); if (await cap.count()) { await cap.first().click(); await sleep(400); }
    }
    s = await state();
    if (s.over) break;
    if (await p.locator('#next').count()) { await p.click('#next'); await sleep(500); }
  }
  let s = await state();
  assert.ok(s.over, `the match ended (${JSON.stringify(s)})`);
  const played = await pb(() => window.__pb().m.history.length);
  const realRound = s.round, realHp = s.hp;
  assert.strictEqual(await p.locator('#overlay #look').count(), 0, 'no Look at board');
  assert.strictEqual(await p.locator('#overlay #replay').count(), 1, 'Replay a round');
  await p.click('#overlay #replay'); await sleep(300);
  const btns = await p.locator('#sheet .rgrid [data-r]').count();
  assert.strictEqual(btns, played, `a button per round (${btns} of ${played})`);
  await p.screenshot({ path: 'replay-pick.png' });

  // round 1 again
  const real1 = await pb(() => { const { m, me } = window.__pb(); return m.history[0]; });
  await p.click('#sheet .rgrid [data-r="1"]'); await sleep(500);
  let r1 = await pb(() => { const { m, me, phase } = window.__pb(); return { phase, round: m.round, gold: m.gold[me], over: m.over, foe: m.armies[1 - me].length, hidden: m.armies[1 - me].filter(q => q.round >= m.round).length, chip: document.getElementById('series-chip').textContent, back: !!document.getElementById('sbx-back') }; });
  assert.deepStrictEqual([r1.phase, r1.round, r1.over], ['deploy', 1, false], JSON.stringify(r1));
  assert.strictEqual(r1.gold, golds[1], 'the gold you had once the round\'s picks were done');
  assert.ok(r1.foe > 0 && r1.hidden === 0, 'their army as it fought, in sight');
  assert.ok(/Replay · round 1/.test(r1.chip) && r1.back, 'the chip and Back to results');
  await p.screenshot({ path: 'replay-deploy.png' });
  // deploy something different and fight
  await pb(() => { const { m, me } = window.__pb(); const ui = m.units.findIndex((u, i) => Game.isUnlocked(m, me, i) && m.gold[me] >= Game.shopCost(m, me, i)); if (ui >= 0) for (let row = 0; row < Game.ROWS; row++) for (let col = 0; col < Game.COLS; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { Game.place(m, me, ui, col, row); return; } });
  await p.click('#fight'); await sleep(600);
  const cap = p.locator('#cap-go, #cap-fight'); if (await cap.count()) { await cap.first().click(); await sleep(400); }
  const card = (await p.locator('#overlay').innerText()).replace(/\s+/g, ' ');
  assert.ok(/Replay · round 1/i.test(card) && /In the match/.test(card) && /doesn’t change/.test(card), card.slice(0, 300));
  await p.screenshot({ path: 'replay-result.png' });
  // Try again: back to the start of round 1
  await p.click('#sbx-again'); await sleep(400);
  r1 = await pb(() => { const { m, me, phase } = window.__pb(); return { phase, round: m.round, gold: m.gold[me] }; });
  assert.deepStrictEqual([r1.phase, r1.round, r1.gold], ['deploy', 1, golds[1]], 'Try again starts it over');
  // Back to results: the real match, unchanged
  await p.click('#sbx-back'); await sleep(400);
  s = await state();
  assert.deepStrictEqual([s.phase, s.over, s.round, s.hp], ['end', true, realRound, realHp], 'the real match is back as it was');
  assert.strictEqual(await pb(() => window.__pb().m.history.length), played, 'its history untouched');
  assert.deepStrictEqual(await pb(() => window.__pb().m.history[0]), real1, 'round 1 as it really went');
  assert.strictEqual(await p.locator('#overlay #replay').count(), 1, 'the match-over card again');
  assert.ok(!(await p.locator('#series-chip').isVisible()), 'the replay chip is gone');
  // the settings' Main menu while replaying also comes back here
  await p.click('#overlay #replay'); await sleep(300);
  await p.click(`#sheet .rgrid [data-r="${played}"]`); await sleep(400);
  assert.strictEqual(await pb(() => window.__pb().m.round), played, 'the last round');
  await pb(() => askForfeit && 0).catch(() => {});
  assert.deepStrictEqual(errors, [], 'no page errors');
  console.log(`replay-round-ui: ${played} rounds; pick, replay, try again and back to results ok`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
