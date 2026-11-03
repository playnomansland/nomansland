// 2v2 in the browser (src/duo.js, server/src/duo.js): a developer opens a 2v2 lobby from the Developer section, two
// friends join with the link, the host swaps two seats, the fourth seat goes to the AI, everyone picks a package and
// places a squad on their own board, all press Ready, and the fight plays on the wide board (two Standard boards side
// by side with a 2-tile strip between, 30 x 18 tiles) on every phone with the same result; afterwards each phone is back on its own board.
// Also: a phone without a developer account doesn't get the button, a reload keeps the seat, a PC shows the teammate's
// board beside its own (live, own still playable), a phone swaps to it with Teammate's board, and pings (? ! ⚔) and quick lines reach the team and only the team.
// Needs: python3 -m http.server 8766 (repo root), cd server && npx wrangler dev --port 8798 --var DUO_ANYONE:1
// (PB_SHOTS=dir saves screenshots of the fight)
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?server=http://127.0.0.1:8798&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DEV = { id: 'p0123456789abcdef', session: 'a'.repeat(64), tag: 'Vilhelm', dev: true, title: '' };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const mk = async (n, acct, vp) => {
    const c = await ctx2d(b, { viewport: vp || { width: 390, height: 844 } });
    if (acct) await c.addInitScript((a) => { try { localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); } catch (e) {} }, acct);
    await c.route('**/account/**', (r) => r.abort()); // no account server here: the page keeps the account it has
    const p = await c.newPage();
    p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; });
    return p;
  };
  const waitPhase = (p, ph, ms = process.env.PB_BOARD === "3d" ? 60000 : 20000) => p.waitForFunction((x) => document.getElementById('phase').textContent === x, ph, { timeout: ms });
  const peek = (p) => p.evaluate(() => { const x = window.__pb(); return { me: x.me, phase: x.phase, cols: Game.COLS, mapId: x.m && x.m.map.id, round: x.m && x.m.round, hp: x.m && x.m.hp.slice(), armies: x.m && x.m.armies.map(a => a.length), net: document.getElementById('net-text').textContent }; });
  const placeOne = (p) => p.evaluate(() => {
    const { m, me } = window.__pb();
    for (let ui = 0; ui < m.units.length; ui++) {
      if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui)) continue;
      for (let row = 0; row < Game.ROWS; row++) for (let col = 0; col < Game.COLS; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { const sq = Game.place(m, me, ui, col, row); window.__pbRedraw(); return sq ? { id: sq.id, ui, col, row } : null; }
    }
    return null;
  });

  // a phone without a developer account: no 2v2 button
  const plain = await mk('plain');
  await plain.goto(BASE);
  await sleep(800);
  ok(!(await plain.locator('#duo-new').count()), 'no 2v2 lobby button without a developer account');

  const host = await mk('host', DEV);
  await host.goto(BASE);
  await host.waitForSelector('#duo-new', { state: 'attached', timeout: 15000 });
  await host.evaluate(() => document.getElementById('duo-new').click());
  await host.waitForFunction(() => /duo=[A-Z0-9]{6}/.test((document.getElementById('link') || {}).textContent || ''), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  const link = (await host.locator('#link').textContent()).trim();
  ok(true, '2v2 link: ' + link.replace(/^.*\?/, '?'));
  await host.waitForFunction(() => /1 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  const f1 = await mk('friend1', null, { width: 1440, height: 900 }), f2 = await mk('friend2'); // friend 1 (the host's teammate) on a PC
  await f1.goto(link + '&test');
  await host.waitForFunction(() => /2 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  await f2.goto(link + '&test');
  await host.waitForFunction(() => /3 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  ok(true, 'two friends joined (seats A2, B1)');
  // the host moves friend 2 from B1 (seat 2) to B2 (seat 3): B1 is left to the AI
  await host.click('[data-seat="2"]'); await host.click('[data-seat="3"]');
  await host.waitForFunction(() => /Empty/.test(document.querySelector('[data-seat="2"]').textContent) && !/Empty/.test(document.querySelector('[data-seat="3"]').textContent), null, { timeout: 10000 });
  ok(true, 'host swapped B1 and B2');
  ok(await f1.locator('[data-seat="0"]').isDisabled(), 'a friend can\'t swap seats');
  await host.click('#duo-start');
  for (const p of [host, f1, f2]) await waitPhase(p, 'Deploy');
  let h = await peek(host), a = await peek(f1), c = await peek(f2);
  ok(h.me === 0 && a.me === 0 && c.me === 1, `sides: A1 ${h.me}, A2 ${a.me}, B2 ${c.me}`);
  ok(h.mapId === 'testgrid' && h.cols === 14, 'each phone on its own Standard board');
  ok(/A1 · left board · teammate/.test(h.net) && /A2 · right board/.test(a.net), 'status line: ' + h.net);
  ok(h.hp[0] === 200, 'team health 200');
  // packages and one squad each
  for (const p of [host, f1, f2]) await p.dblclick('[data-pack="0"]');
  await sleep(800);
  for (const p of [host, f1, f2]) ok(!!(await placeOne(p)), 'placed a squad');
  await sleep(800);
  // a reload keeps the seat (friend 1)
  await f1.reload();
  await waitPhase(f1, 'Deploy');
  a = await peek(f1);
  ok(a.me === 0 && /A2/.test(a.net), 'friend 1 back in seat A2 after a reload');
  const D3 = process.env.PB_BOARD === '3d';
  // a PC (friend 1, A2): both boards from the start, its own playable, its teammate's (the host's) live beside it
  await sleep(800);
  ok(await f1.evaluate(() => { const e = document.getElementById('mate'); return !!e && !e.hidden && e.getBoundingClientRect().width > 200; }), 'PC: the teammate\'s board shows beside its own');
  ok(!(await f1.locator('#duo-peek').count()), 'PC: no toggle, both boards always');
  ok(await f1.evaluate(() => { const a = (document.querySelector('#wrap > .board3d:not(.mate-board)') || document.getElementById('board')).getBoundingClientRect(), b = document.getElementById('mate').getBoundingClientRect(); return b.right <= a.left + 1 || b.left >= a.right - 1; }), 'PC: the two boards don\'t overlap');
  if (!D3) {
    const n0 = (await peek(f1)).armies[0];
    await f1.evaluate(() => document.querySelector('.uc2:not([aria-disabled="true"])').click());
    const ob = await f1.locator('#board').boundingBox();
    for (const fy of [0.92, 0.86, 0.8]) for (const fx of [0.3, 0.5, 0.7]) { if ((await peek(f1)).armies[0] > n0) break; await f1.mouse.click(ob.x + ob.width * fx, ob.y + ob.height * fy); await sleep(200); }
    ok((await peek(f1)).armies[0] > n0, 'PC: a squad placed by tapping its own board, beside the teammate\'s');
  }
  // live: the host places a squad, friend 1 sees it on the teammate's board at once
  const before = await f1.evaluate(() => { const x = window.__pb().mate; return x ? x.armies[0].length : -1; });
  ok(before >= 1, 'the teammate\'s board has the host\'s squad: ' + before);
  ok(!!(await placeOne(host)), 'the host places another squad');
  await f1.waitForFunction((n) => { const x = window.__pb().mate; return x && x.armies[0].length > n; }, before, { timeout: 8000 });
  ok(true, 'PC: it shows on the teammate\'s board right away');
  if (process.env.PB_SHOTS) { await sleep(1500); await f1.screenshot({ path: process.env.PB_SHOTS + '/duo-deploy-pc.png' }); }
  // a phone (the host): Teammate's board in place of its own; a ? ping there lands on friend 1's own board
  await host.click('#duo-peek');
  await sleep(600);
  ok(await host.evaluate(() => { const e = document.getElementById('mate'); return !!e && !e.hidden && e.getBoundingClientRect().width > 300; }), 'phone: Teammate\'s board fills the board');
  if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-peek-phone.png' });
  await host.click('[data-ping="?"]');
  const mb = await host.locator('#mate').boundingBox();
  await host.mouse.click(mb.x + mb.width * 0.5, mb.y + mb.height * 0.45);
  await f1.waitForFunction(() => /pinged \? on your board/.test(document.getElementById('net-text').textContent), null, { timeout: 8000 });
  ok(true, 'the teammate hears of the ? ping on their board');
  await host.click('#duo-peek'); // back to its own board
  await sleep(400);
  // a ! ping on the host's own board: friend 1 sees both, one on each board
  await host.click('[data-ping="!"]');
  const hb = await host.locator(D3 ? '#wrap > .board3d:not(.mate-board)' : '#board').boundingBox();
  await host.mouse.click(hb.x + hb.width * 0.5, hb.y + hb.height * 0.45);
  // (pings last 8 s: on a slow run the ? one may be gone by now) the ! one stands on the teammate's board
  await f1.waitForFunction(() => [...document.querySelectorAll('#marks .ping')].some(g => {
    if (g.textContent !== '!') return false;
    const w = document.getElementById('wrap').getBoundingClientRect(), b = document.getElementById('mate').getBoundingClientRect(), x = +g.getAttribute('transform').match(/translate\(([-\d.]+)/)[1] + w.left;
    return x >= b.left && x <= b.right;
  }), null, { timeout: 8000 });
  ok(true, 'PC: the host\'s ping shows on the teammate\'s board');
  if (process.env.PB_SHOTS) await f1.screenshot({ path: process.env.PB_SHOTS + '/duo-pings-pc.png' });
  ok(await host.evaluate(() => document.querySelectorAll('#marks .ping.mine').length === 1), 'the host sees its own ping on its board');
  await sleep(600);
  ok(!/pinged/.test(await f2.locator('#net-text').textContent()) && !(await f2.evaluate(() => document.querySelectorAll('#marks .ping').length)), 'the other team gets nothing');
  // a quick line
  await f1.click('#duo-say'); await f1.click('[data-emote="help"]');
  await host.waitForFunction(() => /Help me!/.test(document.getElementById('net-text').textContent), null, { timeout: 8000 });
  ok(true, 'Say: Help me! reaches the teammate');
  // Ready
  for (const p of [host, f1, f2]) await p.click('#ready');
  for (const p of [host, f1, f2]) await waitPhase(p, 'Battle', 30000);
  await sleep(1500);
  h = await peek(host); c = await peek(f2);
  ok(h.cols === 30 && h.mapId === 'duo', 'the fight on the wide board: ' + h.cols + ' columns');
  ok(c.cols === 30, 'on every phone');
  if (process.env.PB_SHOTS) { await host.screenshot({ path: process.env.PB_SHOTS + '/duo-host.png' }); await f1.screenshot({ path: process.env.PB_SHOTS + '/duo-a2-pc.png' }); }
  if (process.env.PB_BOARD !== '3d') {
    const ar = async (p) => { const r = await p.locator('#board').boundingBox(); return r.width / r.height; };
    ok(Math.abs(await ar(host) - 14 / 18) < 0.05, 'phone: the fight shows its own board (14 x 18)');
    ok(Math.abs(await ar(f1) - 30 / 18) < 0.05, 'PC: the whole field (30 x 18)');
    // drag sideways to the other board, double tap for the whole field
    const r = await host.locator('#board').boundingBox();
    await host.mouse.move(r.x + r.width * 0.2, r.y + r.height / 2); await host.mouse.down(); await host.mouse.move(r.x + r.width * 0.9, r.y + r.height / 2, { steps: 5 }); await host.mouse.up();
    if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-host-dragged.png' });
    await sleep(400);
    await host.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2);
    if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-host-whole.png' });
  }
  // speed the rest up: play the fight to its end
  for (const p of [host, f1, f2]) await p.evaluate(() => { const x = window.__pb(); while (x.bt.step()) {} });
  for (const p of [host, f1, f2]) await waitPhase(p, 'Result', 30000).catch(() => waitPhase(p, 'Match over', 5000));
  h = await peek(host); a = await peek(f1); c = await peek(f2);
  ok(h.cols === 14 && h.mapId === 'testgrid', 'back on the own board after the fight');
  ok(JSON.stringify(h.hp) === JSON.stringify(c.hp) && JSON.stringify(h.hp) === JSON.stringify(a.hp), 'same team health everywhere: ' + h.hp.join(' / '));
  if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-result.png' });
  // next round
  for (const p of [host, f1, f2]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Next round|Continue|Next)/.test(x.textContent.trim())); if (b) b.click(); });
  for (const p of [host, f1, f2]) await waitPhase(p, 'Deploy', 30000);
  h = await peek(host);
  ok(h.round === 2, 'round 2 begins');
  await b.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
