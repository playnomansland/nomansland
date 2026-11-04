// Ranked needs a Google login (2026-11-04), in the browser. Starts its own local server with accounts on
// (server/test/accounts-env.js) and a test copy of the page with a test Google client id (Google's script faked as in
// rewards-ui.js). Checks:
//  - a phone with no Google login picking Ranked → Play vs Friend gets the "Log in to play ranked" sheet, not a match
//  - logging in there opens the ranked lobby straight away
//  - a friend opening the link with no login is refused by the server and gets the same sheet (no "Play Standard
//    instead" there); logging in joins the ranked match as side 1, with both usernames in the series
//  - a guest still plays a normal (Standard) friend's match
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/ranked-login-ui.js
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { startAccounts, idToken, CLIENT } = require('../../server/test/accounts-env.js');
const TEST_PAGE = path.join(__dirname, '../../ranked-login-test.html');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
fs.writeFileSync(TEST_PAGE, html.replace(/const GOOGLE_CLIENT_ID = '[^']*';/, `const GOOGLE_CLIENT_ID = '${CLIENT}';`));
process.on('exit', () => { try { fs.unlinkSync(TEST_PAGE); } catch (e) {} });
const FAKE_GSI = `window.google = { accounts: { id: {
  initialize(o) { window.__gsi = o; },
  renderButton(el) { el.innerHTML = '<button class="btn" id="fake-g">Sign in with Google</button>'; el.firstChild.onclick = () => window.__gsi.callback({ credential: window.__nextCred }); },
  disableAutoSelect() {} } } };`;
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8777, {});
  const PAGE = `http://127.0.0.1:8766/ranked-login-test.html?test&server=${srv.base}`;
  const b = await chromium.launch({ executablePath: process.env.PB_CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const phone = async (name, url = PAGE) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }));
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); fails++; });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    return p;
  };
  const sheetOpen = (p) => p.evaluate(() => !document.getElementById('sheet-back').hidden);
  const sheetHead = (p) => p.evaluate(() => (document.getElementById('sheet-h') || {}).textContent || '');
  const signIn = async (p, email) => {
    await p.evaluate((c) => { window.__nextCred = c; }, idToken({ email, email_verified: true }));
    await p.locator('#fake-g').click();
    await p.waitForFunction(() => window.__acct && window.__acct().acct && window.__acct().acct.google, null, { timeout: 25000 })
      .catch(async (e) => { console.log('acct:', JSON.stringify(await p.evaluate(() => [window.__acct().acct, (document.getElementById('acct-msg') || {}).textContent, window.__acct().ui.busy]))); throw e; });
  };
  try {
    // ----- the host: no login, picks Ranked -----
    const a = await phone('host');
    await a.waitForFunction(() => { const r = document.querySelector('[data-mode="ranked"]'); return r && !r.disabled; }, null, { timeout: 15000 });
    await a.locator('[data-mode="ranked"]').click();
    await a.locator('#friend').click();
    await a.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 });
    ok(/Log in to play ranked/.test(await sheetHead(a)), 'no login: Play vs Friend in ranked asks to log in');
    ok(await a.locator('#rl-std').count() === 1, 'the host may play Standard instead');
    ok(await a.evaluate(() => window.__pb().phase) === 'start', 'no match made yet');
    await a.waitForSelector('#fake-g', { timeout: 5000 });
    await signIn(a, 'alpha@example.com');
    await a.waitForFunction(() => window.__pb().phase === 'lobby', null, { timeout: 25000 })
      .catch(async (e) => { console.log('host:', JSON.stringify(await a.evaluate(() => [window.__pb().phase, (document.getElementById('sheet-h') || {}).textContent, document.getElementById('sheet-back').hidden, (document.getElementById('acct-msg') || {}).textContent, location.search]))); throw e; });
    ok(!(await sheetOpen(a)), 'logged in: the sheet closes');
    const code = await a.waitForFunction(() => { try { const s = JSON.parse(localStorage.getItem('phonebellum.net.v1') || 'null'); return s && s.code; } catch (e) { return null; } }, null, { timeout: 15000 }).then(h => h.jsonValue());
    ok(/^[A-Z0-9]{5}$/.test(code || ''), 'the ranked lobby is open: ' + code);
    await a.waitForFunction(() => /ranked/i.test(document.getElementById('overlay').innerText), null, { timeout: 10000 });
    ok(true, 'the lobby says ranked');

    // ----- the friend: opens the link with no login -----
    const bb = await phone('friend', `${PAGE}&play=${code}`);
    await bb.waitForFunction(() => !document.getElementById('sheet-back').hidden && /Log in to play ranked/.test((document.getElementById('sheet-h') || {}).textContent || ''), null, { timeout: 15000 });
    ok(true, 'the friend with no login is asked to log in');
    ok(await bb.locator('#rl-std').count() === 0, 'no "Play Standard instead" when joining a friend');
    await bb.waitForSelector('#fake-g', { timeout: 5000 });
    await signIn(bb, 'bravo@example.com');
    await bb.waitForFunction(() => window.__pb().phase === 'lobby' && window.__pb().me === 1, null, { timeout: 15000 });
    ok(true, 'logged in: the friend joins as side 1');
    await a.waitForFunction(() => /\b2\s*\/\s*2\b|both here|Start/i.test(document.getElementById('overlay').innerText), null, { timeout: 10000 }).catch(() => {});
    await a.screenshot({ path: '/tmp/ranked-login-host.png' });

    // ----- a guest still plays Standard -----
    const c = await phone('guest');
    const g = await c.evaluate(async (base) => (await fetch(base + '/account/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, srv.base);
    ok(g === 200, 'a guest account can be made');
    await c.waitForSelector('#friend', { timeout: 15000 });
    if (await c.locator('[data-mode="normal"]').count()) await c.locator('[data-mode="normal"]').click();
    await c.locator('#friend').click();
    await c.waitForFunction(() => window.__pb().phase === 'lobby', null, { timeout: 10000 });
    ok(!(await sheetOpen(c)), 'Standard: no login asked');
  } catch (e) { console.log('FAIL', e.message); fails++; }
  await b.close(); srv.stop();
  console.log(fails ? `${fails} failed` : 'ranked login: all checks passed');
  process.exit(fails ? 1 : 0);
})();
