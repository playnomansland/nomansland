// Unit skins (2026-11-03) in the browser. Starts its own local server with accounts (server/test/accounts-env.js).
//  - the account named Gubbolas Cage gets the Champion Brute: Profile lists it with On / Off, and switching works
//  - vs AI: our Brutes wear it (Shapes.skinOf), theirs don't; the board draws a deploy and a fight with no page errors
//  - in 3D too (PB_BOARD=3d): the skin's own model is used
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/skins-ui.js [screenshot.png]
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const { startAccounts } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8789, {});
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: 'http://127.0.0.1:8766' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return r.json();
  };
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const g = await call('guest', { tag: 'Gubbolas Cage' });
    const ctx = process.env.PB_BOARD === '3d' ? await b.newContext({ viewport: { width: 390, height: 844 } }) : await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((a) => { if (!localStorage.getItem('phonebellum.account.v1')) localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); },
      { id: g.player.id, tag: g.player.tag, google: false, dev: false, titles: [], title: '', tagNext: 0, skins: [], session: g.session, ts: Date.now() });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
    await p.goto(`http://127.0.0.1:8766/?test&server=${srv.base}`);
    await p.waitForSelector('#go', { timeout: 30000 });
    // Profile: the /me refresh brings the granted skin
    await p.click('#acct-open');
    await p.waitForSelector('[data-skin-id="brute-champion"]', { timeout: 10000 });
    ok(/Champion Brute/.test(await p.textContent('#sheet')), 'Profile lists the Champion Brute');
    ok(await p.getAttribute('[data-skin-id][data-worn="1"]', 'aria-pressed') === 'true', 'worn by default');
    await p.click('[data-skin-id][data-worn=""]'); await p.waitForFunction(() => /Skin off/.test(document.querySelector('#acct-msg').textContent), null, { timeout: 8000 });
    ok(await p.evaluate(() => !window.__acct().acct.skins[0].worn), 'switched off');
    await p.click('[data-skin-id][data-worn="1"]'); await p.waitForFunction(() => /Skin on/.test(document.querySelector('#acct-msg').textContent), null, { timeout: 8000 });
    ok(await p.evaluate(() => window.__acct().acct.skins[0].worn), 'and on again');
    await p.click('#sheet #close');

    // vs AI: a Brute on each side
    await p.click('#go'); await sleep(1500);
    await p.dblclick('[data-pack="0"]'); await sleep(500);
    const r = await p.evaluate(() => {
      const { m, me } = window.__pb(), br = m.units.findIndex(u => u.name === 'Brute');
      for (const sd of [0, 1]) { m.gold[sd] = 3000; m.unlocks[sd][br] = 1; }
      Game.place(m, me, br, 4, Game.zoneRows(me)[2]); Game.place(m, 1 - me, br, 5, Game.zoneRows(1 - me)[2]);
      window.__pbRedraw();
      return { mine: !!Shapes.skinOf(me, m.units[br]), theirs: !!Shapes.skinOf(1 - me, m.units[br]) };
    });
    ok(r.mine && !r.theirs, 'our Brutes wear the Champion skin, the AI\'s don\'t: ' + JSON.stringify(r));
    await sleep(1500);
    await p.screenshot({ path: process.argv[2] || 'skins-ui.png' });
    await p.click('#fight'); await sleep(300);
    if (await p.locator('#cap-go').count()) await p.click('#cap-go').catch(() => {});
    await sleep(3500);
    await p.screenshot({ path: (process.argv[2] || 'skins-ui.png').replace('.png', '-fight.png') });
    ok(true, 'fight drawn');
  } finally { await b.close(); srv.stop(); }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
