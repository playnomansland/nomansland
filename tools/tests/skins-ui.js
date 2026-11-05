// Unit skins (2026-11-03) in the browser. Starts its own local server with accounts (server/test/accounts-env.js).
//  - the account named Gubbolas Cage gets the Champion Brute: Profile lists it with On / Off, and switching works
//  - vs AI: our Brutes wear it (Shapes.skinOf), theirs don't; the board draws a deploy and a fight with no page errors
//  - in 3D too (PB_BOARD=3d): the skin's own model is used
//  - a developer (every skin, off) wears the Omni-Per Brute: its model is the Brute's (and drawn, in 3D); wearing the
//    Champion Brute takes Omni-Per off (one Brute skin at a time)
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/skins-ui.js [screenshot.png]
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const { startAccounts, idToken } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8789, { DEV_EMAILS: 'dev@example.com' });
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
    await p.waitForSelector('[data-skin-id="brute-champion"]', { timeout: 30000 });
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
    await ctx.close();

    // a developer wears the Omni-Per Brute; the Champion takes it off again
    const d = await call('google', { credential: idToken({ email: 'dev@example.com', email_verified: true }) });
    const dctx = process.env.PB_BOARD === '3d' ? await b.newContext({ viewport: { width: 390, height: 844 } }) : await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await dctx.addInitScript((a) => { if (!localStorage.getItem('phonebellum.account.v1')) localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); },
      { id: d.player.id, tag: d.player.tag, google: true, dev: true, titles: [], title: '', tagNext: 0, skins: d.player.skins, session: d.session, ts: Date.now() });
    const q = await dctx.newPage();
    q.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
    await q.goto(`http://127.0.0.1:8766/?test&server=${srv.base}`);
    await q.waitForSelector('#go', { timeout: 30000 });
    await q.click('#acct-open');
    await q.waitForSelector('[data-skin-id="brute-omniper"]', { timeout: 10000 });
    ok(/Omni-Per Brute/.test(await q.textContent('#sheet')) && await q.getAttribute('[data-skin-id="brute-omniper"][data-worn=""]', 'aria-pressed') === 'true', 'Profile lists the Omni-Per Brute, off');
    ok(/brute-omniper\.png/.test(await q.getAttribute('.skin-row:has([data-skin-id="brute-omniper"]) img', 'src')), 'with its picture');
    const worn = () => q.evaluate(() => Object.fromEntries(window.__acct().acct.skins.map(k => [k.id, k.worn])));
    await q.click('[data-skin-id="brute-omniper"][data-worn="1"]'); await q.waitForFunction(() => /Skin on/.test(document.querySelector('#acct-msg').textContent), null, { timeout: 8000 });
    ok((await worn())['brute-omniper'], 'Omni-Per worn');
    await q.click('[data-skin-id="brute-champion"][data-worn="1"]'); await q.waitForFunction(() => window.__acct().acct.skins.find(k => k.id === 'brute-champion').worn, null, { timeout: 8000 });
    let w = await worn(); ok(w['brute-champion'] && !w['brute-omniper'], 'wearing Champion takes Omni-Per off: ' + JSON.stringify(w));
    ok(await q.getAttribute('[data-skin-id="brute-omniper"][data-worn=""]', 'aria-pressed') === 'true', 'and Profile shows it off');
    await q.click('[data-skin-id="brute-omniper"][data-worn="1"]'); await q.waitForFunction(() => window.__acct().acct.skins.find(k => k.id === 'brute-omniper').worn, null, { timeout: 8000 });
    w = await worn(); ok(w['brute-omniper'] && !w['brute-champion'], 'and Omni-Per takes Champion off: ' + JSON.stringify(w));
    await q.click('#sheet #close');
    await q.click('#go'); await sleep(1500);
    await q.dblclick('[data-pack="0"]'); await sleep(500);
    const r2 = await q.evaluate(() => {
      const { m, me } = window.__pb(), br = m.units.findIndex(u => u.name === 'Brute');
      m.gold[me] = 3000; m.unlocks[me][br] = 1;
      Game.place(m, me, br, 4, Game.zoneRows(me)[2]);
      window.__pbRedraw();
      const sk = Shapes.skinOf(me, m.units[br]); return sk && sk.model;
    });
    ok(r2 === 'brute:omniper', 'our Brutes wear the Omni-Per model: ' + r2);
    if (process.env.PB_BOARD === '3d') {
      const kinds = await q.waitForFunction(() => { const b3 = window.__pb().board3d; const k = b3 && b3.kinds(); return k && k.includes('brute:omniper') && k; }, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
      ok(kinds && kinds.includes('brute:omniper') && !kinds.includes('brute:champion'), 'the 3D board draws the Omni-Per model: ' + JSON.stringify(kinds));
    }
    await sleep(1000);
    await q.screenshot({ path: (process.argv[2] || 'skins-ui.png').replace('.png', '-omniper.png') });
  } finally { await b.close(); srv.stop(); }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
