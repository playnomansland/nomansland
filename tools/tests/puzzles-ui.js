// The tutorial puzzles in the browser (2D board, phone size): the Tutorial puzzles tile replaces the Tutorial (off since
// 2026-11-03) and a first visit's big button opens the list, a puzzle starts with
// the enemy army in sight and the puzzle's gold and shop; the coach's X folds it away (not back to the menu); a wrong answer loses and offers a hint and Try again; the
// answer (two Fire Mages in "The horde") wins, is saved as solved and offers the next puzzle. The list groups the
// puzzles by level, and a Medium one (The long way round) is solved by goblins down the far side.
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

  check(await p.locator('#tutorial').count() === 0 && /Tutorial puzzles/.test(await p.textContent('#puzzles-open')), 'one Tutorial puzzles tile, no Tutorial tile');
  check(await p.locator('#tutorial-new').count() === 1, 'a first visit leads with the tutorial puzzles');
  await p.click('#tutorial-new');
  check(await p.locator('[data-puz]').count() === 6, 'six puzzles listed');
  check((await p.locator('.puz-level').allTextContents()).map(t => t.replace(/\d.*/, '').trim()).join() === 'Easy,Medium', 'grouped as Easy and Medium');
  await p.click('[data-puz="0"]');
  await p.waitForTimeout(400);
  let s = await st();
  check(/Easy 1 of 3/.test(await coach()), 'coach names the puzzle');
  check(s.gold === 200 && s.foe === 3 && s.mine === 0, 'gold 200, their 3 squads');
  check(await p.evaluate(() => { const { m } = window.__pb(); return m.armies[1].every(q => q.round < m.round); }), 'their squads are in sight (an earlier round)');
  check(s.cards.length === 4, 'the puzzle\'s shop of four');
  // the X only folds the coach line away; the Puzzle button brings it back
  await p.click('#coach-x'); await p.waitForTimeout(200);
  check(await coach() === '' && await p.evaluate(() => window.__pb().m != null && document.documentElement.classList.contains('home') === false), 'the X hides the coach line and stays in the puzzle');
  await p.click('#puz-show'); await p.waitForTimeout(200);
  check(/Easy 1 of 3/.test(await coach()), 'the Puzzle button shows it again');
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
  check(/Easy 2 of 3/.test(await coach()) && (await st()).gold === 300, 'on to puzzle 2');
  // a Medium puzzle (2026-11-05): The long way round, answered with three Goblin Swarms down the far side
  await p.evaluate(() => { localStorage.setItem('phonebellum.puzzles.v1', JSON.stringify([0, 1, 2])); });
  await p.click('#coach-x').catch(() => {}); // fold the coach line away so the menu button can't be covered
  await p.goto('http://127.0.0.1:8766/?test&board=2d');
  await p.click('#puzzles-open');
  check(/3 of 3 solved/.test(await p.locator('.puz-level').first().textContent()), 'Easy shows 3 of 3 solved');
  for (let k = 0; k < 6; k++) {
    await p.click('[data-puz="' + k + '"]'); await p.waitForTimeout(300);
    const [n, want] = await p.evaluate((k) => [window.__pb().m.armies[1].length, k], k);
    check(n === [3, 2, 3, 2, 3, 4][want], `puzzle ${k + 1}: the whole enemy army is placed (${n})`);
    await p.goto('http://127.0.0.1:8766/?test&board=2d'); await p.click('#puzzles-open');
  }
  await p.click('[data-puz="4"]');
  await p.waitForTimeout(400);
  s = await st();
  check(/Medium 2 of 3 · The long way round/.test(await coach()) && s.gold === 300 && s.foe === 3 && s.cards.length === 4, 'Medium 2 of 3 with its gold, army and shop');
  await card('Goblin Swarm'); await tile(10, 11); await tile(9, 11); await tile(10, 12);
  await fightTo('Solved');
  check(await p.locator('#coach-btns button', { hasText: 'Next puzzle' }).count() === 1, 'goblins down the far side solve it; on to the next');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'puzzles-ui: all ok');
  process.exit(fails ? 1 : 0);
})();
