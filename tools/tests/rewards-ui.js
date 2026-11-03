// Rewards in the browser (2026-11-03): invite a friend (Aquamarine Ether Golem) and Discord (BABABABA title).
// Starts its own local server with accounts on (server/test/accounts-env.js) plus a stand-in for Discord's API, and a
// test copy of the page with a test Google client id (Google's script faked as in account-ui.js). Checks:
//  - the main menu shows the rewards card with both pictures; tapping it opens the Rewards sheet
//  - a guest is told to sign in with Google; after Google the sheet shows an invite link (?invite=CODE)
//  - a friend's phone opening that link keeps the code, drops it from the URL, says so on the welcome screen, and the
//    guest it makes shows up in the inviter's list
//  - Check sends the player to Discord's consent page with our client id, scopes and a state; coming back with a code
//    gives the BABABABA title, and the card then says it's yours; a wrong state is ignored
// Screenshots: /tmp/rewards-*.png. Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/rewards-ui.js
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), http = require('http');
const { startAccounts, idToken, CLIENT } = require('../../server/test/accounts-env.js');
const TEST_PAGE = path.join(__dirname, '../../rewards-test.html');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
fs.writeFileSync(TEST_PAGE, html.replace(/const GOOGLE_CLIENT_ID = '[^']*';/, `const GOOGLE_CLIENT_ID = '${CLIENT}';`));
process.on('exit', () => { try { fs.unlinkSync(TEST_PAGE); } catch (e) {} });
const FAKE_GSI = `window.google = { accounts: { id: {
  initialize(o) { window.__gsi = o; },
  renderButton(el) { el.innerHTML = '<button class="btn" id="fake-g">Sign in with Google</button>'; el.firstChild.onclick = () => window.__gsi.callback({ credential: window.__nextCred }); },
  disableAutoSelect() {} } } };`;
const GUILD = '4242';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

function fakeDiscord() {
  const tokens = {};
  const s = http.createServer((req, res) => {
    let body = ''; req.on('data', d => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close');
      if (req.url === '/oauth2/token') { const c = new URLSearchParams(body).get('code'); const t = 't' + Math.random(); tokens[t] = c; return res.end(JSON.stringify({ access_token: t })); }
      const c = tokens[(req.headers.authorization || '').slice(7)];
      if (!c) { res.statusCode = 401; return res.end('{}'); }
      if (req.url === '/users/@me') return res.end(JSON.stringify({ id: c.split('-')[1] }));
      res.end(JSON.stringify(c.startsWith('in-') ? [{ id: GUILD }] : []));
    });
  });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r(s)));
}

(async () => {
  const dc = await fakeDiscord();
  const srv = await startAccounts(8796, { DISCORD_CLIENT_ID: 'cid123', DISCORD_CLIENT_SECRET: 'shh', DISCORD_GUILD_ID: GUILD, DISCORD_INVITE: 'https://discord.gg/nml', DISCORD_API: `http://127.0.0.1:${dc.address().port}` });
  const BASE = `http://127.0.0.1:8766/rewards-test.html`;
  const PAGE = `${BASE}?test&server=${srv.base}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const phone = async (name, url = PAGE) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }));
    await ctx.route('https://discord.com/**', r => r.fulfill({ contentType: 'text/html', body: '<p>discord</p>' }));
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); fails++; });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    return p;
  };
  const sheet = (p) => p.locator('#sheet').innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const idle = (p) => p.waitForFunction(() => window.__acct && !window.__acct().ui.busy && !window.__rewards().rw.busy, null, { timeout: 10000 });
  const acct = (p) => p.evaluate(() => window.__acct().acct);

  try {
    // ----- the inviter -----
    const I = await phone('inviter');
    ok(await I.locator('#home .rewards img[src="img/skins/golem-aquamarine.png"]').count() === 1, 'the menu card has the Aquamarine Golem picture');
    ok(await I.locator('#home .rewards .ptitle').innerText() === 'BABABABA', 'and the BABABABA title');
    await I.click('#rw-invite'); await idle(I);
    ok(/Make an account/.test(await sheet(I)), 'no account: asked to make one');
    await I.click('#close');
    await I.click('#acct-open'); await I.click('#acct-guest'); await idle(I);
    await I.evaluate((c) => { window.__nextCred = c; }, idToken({ sub: '777' })); await I.click('#fake-g'); await idle(I);
    ok((await acct(I)).google, 'signed in with Google');
    await I.click('#close');
    await I.click('#rw-invite'); await idle(I);
    const link = await I.inputValue('#rw-link');
    ok(/\?invite=[A-HJKMNP-Z2-9]{6}$/.test(link), 'the sheet shows an invite link: ' + link);
    const code = link.split('=').pop();
    await I.screenshot({ path: '/tmp/rewards-sheet.png' });
    await I.click('#close');

    // ----- the friend -----
    const F = await phone('friend', `${PAGE}&invite=${code}&welcome`);
    ok(!/invite=/.test(F.url()), 'the code is dropped from the URL: ' + F.url());
    ok((await F.evaluate(() => window.__rewards().invitePending)) === code, 'and kept on the phone');
    ok(await F.locator('.home-invited').count() === 1, 'the welcome screen says a friend invited you');
    await F.screenshot({ path: '/tmp/rewards-welcome.png' });
    await F.waitForFunction(() => window.__acct, null, { timeout: 10000 });
    await F.click('#w-guest');
    await F.waitForFunction(() => window.__acct().acct, null, { timeout: 10000 }).catch(async () => console.log('friend:', await F.evaluate(() => document.querySelector('#home-in').innerText.slice(0, 300))));
    ok((await F.evaluate(() => window.__rewards().invitePending)) === '', 'sent with the new guest, then dropped');
    await F.goto(PAGE, { waitUntil: 'domcontentloaded' }); // the test layout from here on (no Stay logged in question)
    await I.click('#rw-invite'); await idle(I);
    ok(/Needs Google sign-in/.test(await sheet(I)) && /Needs an online match/.test(await sheet(I)), 'the friend shows in the inviter\'s list: ' + (await sheet(I)).slice(-120));
    await I.click('#close');

    // ----- Discord -----
    await I.click('#rw-discord'); await idle(I);
    ok(await I.locator('#rw-dc-join').getAttribute('href') === 'https://discord.gg/nml', 'Join the Discord links to the invite');
    const [req] = await Promise.all([I.waitForRequest(r => r.url().startsWith('https://discord.com/'), { timeout: 8000 }), I.click('#rw-dc-check')]);
    const u = new URL(req.url());
    const state = u.searchParams.get('state');
    ok(u.pathname === '/oauth2/authorize' && u.searchParams.get('client_id') === 'cid123' && u.searchParams.get('scope') === 'identify guilds' && u.searchParams.get('redirect_uri') === BASE && /^[0-9a-f]{32}$/.test(state), 'Check goes to Discord\'s consent page: ' + req.url().slice(0, 140));
    await I.waitForURL(/discord\.com/);
    // a wrong state is ignored
    await I.goto(`${PAGE}&code=in-90001&state=nope`, { waitUntil: 'domcontentloaded' });
    await I.waitForFunction(() => window.__acct().acct, null, { timeout: 10000 });
    ok(!(await acct(I)).titles.includes('bababa'), 'a wrong state gives nothing');
    // Discord sends the player back (Discord's own redirect has no ?test or ?server, so the test puts them back on)
    await I.evaluate((s) => sessionStorage.setItem('pb-discord-state', s), state);
    await I.goto(`${PAGE}&code=in-90001&state=${state}`, { waitUntil: 'domcontentloaded' });
    await I.waitForFunction(() => (window.__acct().acct.titles || []).includes('bababa'), null, { timeout: 10000 }).catch(() => {});
    ok((await acct(I)).titles.includes('bababa'), 'back from Discord: BABABABA');
    ok(!/code=|state=/.test(I.url()), 'the code is dropped from the URL');
    await I.waitForFunction(() => /yours/.test(document.querySelector('#rw-discord').innerText), null, { timeout: 5000 }).catch(() => {});
    ok(/BABABABA title: yours/.test(await I.locator('#rw-discord').innerText()), 'the card says it\'s yours');
    // not in the server
    await F.click('#rw-discord'); await idle(F);
    const [r2] = await Promise.all([F.waitForRequest(r => r.url().startsWith('https://discord.com/')), F.click('#rw-dc-check')]);
    const st2 = new URL(r2.url()).searchParams.get('state');
    await F.waitForURL(/discord\.com/);
    await F.goto(`${PAGE}&code=out-50001&state=${st2}`, { waitUntil: 'domcontentloaded' }); // same tab: the state Check saved is still in sessionStorage
    await F.waitForSelector('#rw-msg', { timeout: 8000 });
    await F.waitForFunction(() => /aren’t in/.test(document.querySelector('#rw-msg').textContent), null, { timeout: 8000 }).catch(() => {});
    ok(/aren’t in the No Mans Land server/.test(await F.locator('#rw-msg').innerText()), 'not in the server: told to join first');

    // the real menu (no test layout) for a look
    await I.evaluate(() => { localStorage.setItem('pb-stay', '1'); localStorage.setItem('pb-titles-seen', JSON.stringify({ [window.__acct().acct.id]: window.__acct().acct.titles })); });
    await I.goto(`${BASE}?welcome&server=${srv.base}`, { waitUntil: 'domcontentloaded' });
    await I.waitForTimeout(1500);
    await I.screenshot({ path: '/tmp/rewards-menu.png' });
  } finally {
    await b.close(); srv.stop(); dc.close();
  }
  console.log(fails ? `${fails} FAILED` : 'rewards-ui: all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
