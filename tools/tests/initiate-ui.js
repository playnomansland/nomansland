// The Initiate title in the browser (2026-11-03): solved puzzles reach the server, which replays each fight, and the
// light blue Initiate title comes with the third. Starts its own local server with accounts on (server/test/
// accounts-env.js). Checks:
//  - the menu's rewards card has a puzzles row counting solved puzzles; it opens the Puzzles sheet
//  - a puzzle solved signed out waits on the phone (phonebellum.puzzle-wins.v1) and is sent with the next account answer
//  - the server counts it (acct.puzzles), and the Puzzles sheet shows it solved
//  - a wrong answer sent by hand is refused; the second and third real wins give the Initiate title, the card says so
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/initiate-ui.js
const { chromium } = require('playwright-core');
const { startAccounts } = require('../../server/test/accounts-env.js');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 6 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8787, {});
  const PAGE = `http://127.0.0.1:8766/?test&board=2d&server=${srv.base}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 744 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
  await p.goto(PAGE, { waitUntil: 'domcontentloaded' });
  const idle = () => p.waitForFunction(() => window.__acct && !window.__acct().ui.busy, null, { timeout: 10000 });
  const acct = () => p.evaluate(() => window.__acct().acct);
  const wins = () => p.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.puzzle-wins.v1') || '{}'));
  const pt = (c, r) => p.locator('#board').boundingBox().then(bb => [bb.x + (c + .5) * bb.width / 12, bb.y + (r + .5) * bb.height / 16]);
  const card = async (name) => { const i = await p.evaluate((n) => [...document.querySelectorAll('#shop .ucard')].find(x => x.textContent.includes(n)).dataset.i, name); await p.tap(`#shop .ucard[data-i="${i}"]`); };
  const tile = async (c, r) => { const [x, y] = await pt(c, r); await p.touchscreen.tap(x, y); await p.waitForTimeout(150); };
  const fightTo = async (re) => { await p.tap('#fight'); await p.waitForFunction((src) => { const el = document.getElementById('coach'); return !el.hidden && new RegExp(src).test(document.getElementById('coach-text').textContent); }, re, { timeout: 120000 }); };
  const solve = async (k, name, tiles) => {
    await p.click('#puzzles-open'); await p.click(`[data-puz="${k}"]`); await p.waitForTimeout(400);
    await card(name); for (const [c, r] of tiles) await tile(c, r);
    await fightTo('Solved');
    await p.locator('#coach-btns button', { hasText: 'Main menu' }).click(); await p.waitForTimeout(400);
  };

  try {
    ok(/0\/3 solved/.test(await p.locator('#rw-puzzles small').textContent()), 'the card counts solved puzzles');
    await p.click('#rw-puzzles');
    ok(/puzzles/i.test(await p.locator('#sheet h3').textContent()) && await p.locator('#sheet .ptitle').textContent() === 'Initiate', 'it opens the Puzzles sheet, which names the title');
    await p.click('#close');
    // signed out: the win waits on the phone
    await solve(0, 'Fire Mage', [[5, 12], [6, 12]]);
    let w = await wins();
    ok(Array.isArray(w[0]) && w[0].length === 2 && w[0][0][0] === 'Fire Mage', 'the winning army waits on the phone: ' + JSON.stringify(w[0]));
    ok(/1\/3 solved/.test(await p.locator('#rw-puzzles small').textContent()), 'the card counts it');
    // an account: the waiting win goes to the server
    await p.click('#acct-open'); await p.click('#acct-guest'); await idle();
    await p.waitForFunction(() => (window.__acct().acct.puzzles || []).includes(0), null, { timeout: 15000 }).catch(() => {});
    let a = await acct();
    ok(a && a.puzzles && a.puzzles.includes(0), 'the server counted it: ' + JSON.stringify(a && a.puzzles));
    ok(!(0 in (await wins())), 'and it no longer waits on the phone');
    await p.click('#close');
    // a made-up win is refused by the server (it replays the fight)
    const fake = await p.evaluate(async () => { const r = await fetch(window.__acct().acct ? location.search.match(/server=([^&]+)/)[1] + '/account/puzzle' : '', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + window.__acct().acct.session }, body: JSON.stringify({ k: 1, army: [['Sniper', 5, 12]] }) }); return r.json(); });
    ok(fake.won === false && !fake.solved.includes(1), 'a Sniper does not beat Two giants: refused');
    // the other two, signed in: sent straight away
    await solve(1, 'Goblin Swarm', [[5, 10], [6, 10], [4, 10]]);
    await p.waitForFunction(() => (window.__acct().acct.puzzles || []).includes(1), null, { timeout: 15000 }).catch(() => {});
    ok((await acct()).puzzles.includes(1), 'puzzle 2 sent and counted');
    ok(!(await acct()).titles.includes('initiate'), 'no title yet');
    await solve(2, 'Sniper', [[3, 15], [5, 15], [7, 15]]);
    await p.waitForFunction(() => (window.__acct().acct.titles || []).includes('initiate'), null, { timeout: 15000 }).catch(() => {});
    a = await acct();
    ok(a.titles.includes('initiate'), 'all three: the Initiate title');
    ok(/Initiate title: yours!/.test(await p.locator('#rw-puzzles').textContent()), 'the card says so');
    await p.screenshot({ path: '/tmp/initiate-menu.png' });
    await p.click('#puzzles-open');
    const rows = await p.locator('[data-puz]').allTextContents(); // the 3 Easy puzzles first, then the Medium ones (not needed for the title)
    ok(rows.slice(0, 3).every(t => /Solved/.test(t)) && !rows.slice(3).some(t => /Solved/.test(t)), 'all three Easy show as solved, the Medium ones not');
    await p.screenshot({ path: '/tmp/initiate-sheet.png' });
  } finally { await b.close(); srv.stop(); }
  console.log(fails ? `${fails} FAILED` : 'initiate-ui: all ok');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
