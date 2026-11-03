// The tutorial puzzles in the browser (2D board, phone size): the Puzzles tile opens the list, a puzzle starts with
// the enemy army in sight and the puzzle's gold and shop; a wrong answer loses and offers a hint and Try again; the
// answer (two Fire Mages in "The horde") wins, is saved as solved and offers the next puzzle.
// Needs: python3 -m http.server 8766 in the repo root. Run: node tools/tests/puzzles-ui.js
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const ctx = await b.newContext({ viewport: { width: 390, height: 744 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
  await p.goto('http://127.0.0.1:8766/?test&board=2d');
  const coach = () => p.evaluate(() => document.getElementById('coach').hidden ? '' : document.getElementById('coach-text').textContent);
  const st = () => p.evaluate(() => { const { m, me } = window.__pb(); return { gold: m.gold[me], mine: m.armies[me].length, foe: m.armies[1 - me].length, cards: [...document.querySelectorAll('#shop .ucard')].map(x => x.textContent) }; });
  const pt = (c, r) => p.locator('#board').boundingBox().then(bb => [bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16]);
  const card = async (name) => { const i = await p.evaluate((n) => [...document.querySelectorAll('#shop .ucard')].find(x => x.textContent.includes(n)).dataset.i, name); await p.tap(`#shop .ucard[data-i="${i}"]`); };
  const tile = async (c, r) => { const [x, y] = await pt(c, r); await p.touchscreen.tap(x, y); await p.waitForTimeout(150); };
  const fightTo = async (re) => { await p.tap('#fight'); await p.waitForFunction((src) => { const el = document.getElementById('coach'); return !el.hidden && new RegExp(src).test(document.getElementById('coach-text').textContent); }, re, { timeout: 120000 }); };

  await p.click('#puzzles-open');
  check(await p.locator('[data-puz]').count() === 3, 'three puzzles listed');
  await p.click('[data-puz="0"]');
  await p.waitForTimeout(400);
  let s = await st();
  check(/Puzzle 1 of 3/.test(await coach()), 'coach names the puzzle');
  check(s.gold === 200 && s.foe === 3 && s.mine === 0, 'gold 200, their 3 squads');
  check(await p.evaluate(() => { const { m } = window.__pb(); return m.armies[1].every(q => q.round < m.round); }), 'their squads are in sight (an earlier round)');
  check(s.cards.length === 4, 'the puzzle\'s shop of four');
  // a wrong answer: two Snipers
  await card('Sniper'); await tile(4, 12); await tile(7, 12);
  s = await st();
  check(s.mine === 2 && s.gold === 0, 'two squads placed with one pick');
  await fightTo('Not this time');
  check(await p.locator('#coach-btns button', { hasText: 'Hint' }).count() === 1, 'a hint is offered');
  await p.locator('#coach-btns button', { hasText: 'Hint' }).click();
  check(/Fire Mage/.test(await coach()), 'the hint names the counter');
  await p.locator('#coach-btns button', { hasText: 'Try again' }).click();
  await p.waitForTimeout(300);
  s = await st();
  check(s.mine === 0 && s.gold === 200, 'try again starts over');
  check(/Hint:/.test(await coach()), 'the hint stays on the coach line');
  // the answer: two Fire Mages
  await card('Fire Mage'); await tile(5, 12); await tile(6, 12);
  await fightTo('Solved');
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.puzzles.v1') || '[]').includes(0)), 'saved as solved');
  await p.locator('#coach-btns button', { hasText: 'Next puzzle' }).click();
  await p.waitForTimeout(300);
  check(/Puzzle 2 of 3/.test(await coach()) && (await st()).gold === 300, 'on to puzzle 2');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'puzzles-ui: all ok');
  process.exit(fails ? 1 : 0);
})();
