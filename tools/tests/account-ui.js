// Accounts (server step 5) in the browser. Starts its own local server with accounts switched on
// (server/test/accounts-env.js: a local database and a stand-in for Google's keys) and a test copy of the page with a
// test Google client id. Google's script is replaced by a small fake whose button hands the page an ID token this test
// signed, so the whole sign-in path runs except Google's own popup. Checks:
//  - Account on the start screen: Play as a guest gives a gamertag kept on the phone; renaming; a reload keeps it
//  - Sign in with Google keeps the guest's id; a second phone signing in to the same Google account gets that player
//  - Sign out on one phone leaves the other signed in; Delete needs a second tap and signs out
//  - the server with accounts off: the sheet says so; no session token ever appears in a URL; no page errors
// Writes account-test.html (index.html with the test client id) for the run.
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/account-ui.js
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { startAccounts, idToken, CLIENT } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const TEST_PAGE = path.join(__dirname, '../../account-test.html');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
if (!/const GOOGLE_CLIENT_ID = '[^']*';/.test(html)) throw new Error('GOOGLE_CLIENT_ID not found in index.html');
fs.writeFileSync(TEST_PAGE, html.replace(/const GOOGLE_CLIENT_ID = '[^']*';/, `const GOOGLE_CLIENT_ID = '${CLIENT}';`));
process.on('exit', () => { try { fs.unlinkSync(TEST_PAGE); } catch (e) {} });
const FAKE_GSI = `window.google = { accounts: { id: {
  initialize(o) { window.__gsi = o; },
  renderButton(el) { el.innerHTML = '<button class="btn" id="fake-g">Sign in with Google</button>'; el.firstChild.onclick = () => window.__gsi.callback({ credential: window.__nextCred }); },
  disableAutoSelect() { window.__gsiOff = (window.__gsiOff || 0) + 1; } } } };`;
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8794, { DEV_EMAILS: 'dev@example.com' });
  const PAGE = `http://127.0.0.1:8766/account-test.html?test&server=${srv.base}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const urls = [];
  const phone = async (name, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }));
    if (opts.off) await ctx.route('**/account/**', r => r.fulfill({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"error":"accounts off"}' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); fails++; });
    p.on('request', r => urls.push(r.url()));
    await p.goto(PAGE);
    return p;
  };
  const text = (p) => p.locator('#sheet').innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const idle = (p) => p.waitForFunction(() => window.__acct && !window.__acct().ui.busy, null, { timeout: 10000 });
  const state = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.account.v1') || 'null'));
  const open = async (p) => { await p.click('#acct-open'); await idle(p); };
  const google = async (p, sub, claims = {}) => { await p.evaluate((c) => { window.__nextCred = c; }, idToken({ sub, ...claims })); await p.click('#fake-g'); await idle(p); };

  try {
    const a = await phone('a');
    await open(a);
    let t = await text(a);
    ok(/No account needed/.test(t) && await a.locator('#acct-guest').count() === 1, 'a new phone has no account and offers a guest: ' + t.slice(0, 120));
    ok(await a.locator('#fake-g').count() === 1, 'the Google button is drawn (Google script loaded when the sheet opened)');
    await a.click('#acct-guest'); await idle(a);
    let s = await state(a);
    ok(s && /^p[0-9a-f]{16}$/.test(s.id) && /^Guest \d{4}$/.test(s.tag) && !s.google, 'guest made and kept on the phone: ' + (s && s.tag));
    ok((await a.inputValue('#acct-tag')) === s.tag, 'the gamertag is shown');
    const guestId = s.id;
    await a.fill('#acct-tag', 'Vilhelm'); await a.click('#acct-tag-ok'); await idle(a);
    ok((await state(a)).tag === 'Vilhelm' && /Username saved/.test(await text(a)), 'renamed');
    await a.fill('#acct-tag', 'x'); await a.click('#acct-tag-ok'); await idle(a);
    ok(/2–16 letters/.test(await text(a)) && (await state(a)).tag === 'Vilhelm', 'a bad gamertag is refused');

    await a.reload(); await open(a);
    ok((await a.inputValue('#acct-tag')) === 'Vilhelm', 'kept after a reload');

    const sub = '7' + Date.now();
    await google(a, sub);
    s = await state(a);
    ok(s.google && s.id === guestId && s.tag === 'Vilhelm', 'Sign in with Google keeps the guest');
    t = await text(a);
    ok(/guest is kept/.test(t) && /Signed in with Google/.test(t) && await a.locator('#acct-out').count() === 1, 'shown as signed in: ' + t.slice(0, 140));

    const b2 = await phone('b');
    await open(b2);
    await google(b2, sub);
    s = await state(b2);
    ok(s && s.id === guestId && s.tag === 'Vilhelm', 'a second phone signing in finds the same player');
    ok(/Welcome back, Vilhelm/.test(await text(b2)), 'welcomed back');
    await b2.click('#acct-out'); await idle(b2);
    ok(!(await state(b2)) && /Signed out on this phone/.test(await text(b2)), 'signed out on the second phone');
    ok(await b2.evaluate(() => window.__gsiOff) === 1, 'Google auto sign-in turned off on sign-out');

    await a.click('#close'); await open(a);
    ok((await state(a)) && (await a.inputValue('#acct-tag')) === 'Vilhelm', 'the first phone is still signed in');
    await a.click('#acct-del');
    ok(/Tap again to delete/.test(await text(a)) && (await state(a)), 'delete asks for a second tap');
    await a.click('#acct-del'); await idle(a);
    ok(!(await state(a)) && /Account deleted/.test(await text(a)), 'deleted and signed out');
    await google(a, sub);
    s = await state(a);
    ok(s && s.id !== guestId && s.tag !== 'Vilhelm', 'after deleting, the same Google account starts a new player');

    const d = await phone('dev');
    await open(d);
    await google(d, '8' + Date.now(), { email: 'dev@example.com', email_verified: true });
    ok((await state(d)).dev === true && await d.evaluate(() => window.__acct().dev) === true, 'a developer account: devMode() is on');
    ok(/Developer mode is on/.test(await text(d)), 'the sheet says so');
    ok(!(await state(a)).dev && !/Developer mode/.test(await text(a)), 'other accounts are not developers');

    const c = await phone('off', { off: true });
    await open(c);
    await c.click('#acct-guest'); await idle(c);
    ok(/aren’t switched on yet/.test(await text(c)) && !(await state(c)), 'accounts off: the sheet says so');
    ok(await c.locator('#acct-google').count() === 0, 'and hides the Google button');

    ok(!urls.some(u => /[0-9a-f]{64}/.test(u)), 'no session token in any URL');
  } catch (e) { console.error(e); fails++; }
  await b.close(); srv.stop();
  console.log(fails ? `${fails} check(s) failed` : 'account-ui: all checks passed');
  setTimeout(() => process.exit(fails ? 1 : 0), 300);
})();
