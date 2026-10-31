// A live match: a squad sold while deploying stays on the opponent's screen until the fight, both ways round
// (2026-10-31). Each player takes the first start offer in round 1 (its free squads); in round 2 each sells one of
// them, and the other still sees it.
// Needs the peer server (node tools/peer-server.js, port 9000) and the game on port 8766.
// PB_CHROME: another Chromium to run (default: the one the other checks use).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d'); // these checks are for the 2D board
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.PB_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  let fails = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p; };
  const tap = ctx2d.tap;
  const host = await mk('host'), guest = await mk('guest');
  const BASE = 'http://127.0.0.1:8766/?test&peerhost=127.0.0.1&peerport=9000';
  await host.goto(BASE); await host.click('#friend');
  await host.waitForFunction(() => /Waiting/.test(document.getElementById('lobby-status').textContent));
  await guest.goto((await host.locator('#link').textContent()) + '&test');
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy');
  await sleep(500);
  for (const pg of [host, guest]) {
    await pg.click('[data-pack="0"]:visible'); await sleep(100); await pg.click('#pick-go'); await sleep(300); // round 1's start: the first offer
  }
  const mine = (pg) => pg.evaluate(() => { const { m, me } = window.__pb(); return m.armies[me].map(q => q.id).sort((a, b) => a - b); });
  const seen = (pg) => pg.evaluate(() => { const { m, me } = window.__pb(); return Game.foeSeen(m, 1 - me).map(q => q.id).sort((a, b) => a - b); });
  const hostIds = await mine(host), guestIds = await mine(guest);
  check(hostIds.length > 0 && guestIds.length > 0, `each has squads (host ${hostIds}, guest ${guestIds})`);
  await sleep(500);
  await guest.click('#ready'); await host.click('#ready');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await host.click('#skip').then(() => host.click('#skip')).catch(() => {}); await guest.click('#skip').then(() => guest.click('#skip')).catch(() => {}); await sleep(600);
  await host.click('#next'); await guest.click('#next');
  for (const pg of [host, guest]) await pg.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy' && window.__pb().m.round === 2, null, { timeout: 10000 });
  await sleep(800);
  check(JSON.stringify(await seen(guest)) === JSON.stringify(hostIds), 'round 2: the guest sees the host\'s squads');
  const sellIt = async (pg, id) => { // tap the squad (screen grid: the guest's board is turned round), Sell, Sell again
    const [c, r] = await pg.evaluate((id) => { const { m, me } = window.__pb(), q = m.armies[me].find(q => q.id === id); return me === 1 ? [Game.COLS - 1 - q.col, Game.ROWS - 1 - q.row] : [q.col, q.row]; }, id);
    await tap(pg, c, r); await sleep(200);
    await pg.click('[data-act="sell"]'); await pg.click('[data-act="sell"]'); await sleep(300);
    if (await pg.locator('#sheet-back').isVisible()) { await pg.click('#sheet #close'); await sleep(200); }
  };
  await sellIt(host, hostIds[0]); await sleep(800);
  check(!(await mine(host)).includes(hostIds[0]), 'the host sold one');
  check(JSON.stringify(await seen(guest)) === JSON.stringify(hostIds), 'the guest still sees the host\'s sold squad');
  await sellIt(guest, guestIds[0]); await sleep(800);
  check(!(await mine(guest)).includes(guestIds[0]), 'the guest sold one');
  check(JSON.stringify(await seen(host)) === JSON.stringify(guestIds), 'the host still sees the guest\'s sold squad');
  check(JSON.stringify(await seen(guest)) === JSON.stringify(hostIds), 'and the guest still sees the host\'s, after its own sale');
  if (process.env.PB_SHOT) { await host.screenshot({ path: process.env.PB_SHOT + '-host.png' }); await guest.screenshot({ path: process.env.PB_SHOT + '-guest.png' }); }
  for (const pg of [guest, host]) { await pg.click('#ready'); await sleep(300); if (await pg.locator('#cap-go').isVisible()) await pg.click('#cap-go'); } // past the unspent-gold note
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 5000 });
  await sleep(500);
  const inFight = (pg) => pg.evaluate(() => { const { m, me } = window.__pb(); return m.armies[1 - me].map(q => q.id); });
  check(!(await inFight(guest)).includes(hostIds[0]) && !(await inFight(host)).includes(guestIds[0]), 'in the fight the sold squads are gone on both phones');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'sell-hidden-mp ok');
  process.exit(fails ? 1 : 0);
})();
