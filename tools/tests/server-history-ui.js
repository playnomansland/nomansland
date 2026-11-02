// Match history from the game server (server step 4) in the browser: a friend's match on the server plays one round;
// neither phone posts it to the Google Sheet (the server saves it); a fresh start screen's Match history lists it from
// the server; the Phone-to-phone tab still shows the Sheet; with the server unreachable the sheet falls back to the Sheet.
// Writes hist-srv-test.html (index.html with HISTORY_URL pointed at a fake sheet the test answers itself) for the run.
// Needs: python3 -m http.server 8766 (repo root), node tools/peer-server.js (port 9000), cd server && npx wrangler dev --port 8798
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const fs = require('fs'), path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const FAKE = 'https://sheet.test/exec';
const TEST_PAGE = path.join(__dirname, '../../hist-srv-test.html');
fs.writeFileSync(TEST_PAGE, fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8').replace(/const HISTORY_URL = '[^']*';/, `const HISTORY_URL = '${FAKE}';`));
process.on('exit', () => { try { fs.unlinkSync(TEST_PAGE); } catch (e) {} });
const PAGE = 'http://127.0.0.1:8766/hist-srv-test.html?peerhost=127.0.0.1&peerport=9000&test';
const BASE = PAGE + '&server=http://127.0.0.1:8798';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const posts = { n: 0 }, sheetRows = [{ time: new Date().toISOString(), code: 'P2P1', round: 2, map: 'Forest', hostChar: 'Otto', guestChar: 'Zoe', winner: 'host', dmgHost: 0, dmgGuest: 12, over: false, hostArmy: 'Wisps L1', guestArmy: 'Ember Imps L2' }];
  const mk = async (n) => {
    const ctx = await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await ctx.route(FAKE + '**', r => {
      if (r.request().method() === 'POST') { posts.n++; return r.fulfill({ body: '{"ok":true}' }); }
      return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ rows: sheetRows }) });
    });
    const p = await ctx.newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); return p;
  };
  const sheetText = (p) => p.locator('#sheet').innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const loaded = (p) => p.waitForFunction(() => !/Loading/.test(document.getElementById('hist-msg').textContent), null, { timeout: 10000 });

  // a server match: one round
  const host = await mk('host'), guest = await mk('guest');
  await host.goto(BASE);
  await host.click('#friend');
  await host.waitForFunction(() => /play=/.test(document.getElementById('link').textContent), null, { timeout: 15000 });
  const link = (await host.locator('#link').textContent()).trim();
  const code = link.match(/play=([A-Z0-9]+)/)[1];
  await guest.goto(link + '&test');
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
  await host.click('#start');
  await guest.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 15000 });
  for (const pg of [host, guest]) { await pg.dblclick('[data-pack="0"]'); await sleep(200); }
  await guest.click('#ready'); await host.click('#ready');
  await host.waitForFunction(() => document.getElementById('phase').textContent === 'Battle', null, { timeout: 15000 });
  await sleep(1500);
  ok(posts.n === 0, `no phone posted the server match to the Sheet (${posts.n} posts)`);

  // a fresh start screen: the list comes from the server
  const viewer = await mk('viewer');
  await viewer.goto(BASE);
  await viewer.click('#hist-open');
  await loaded(viewer);
  let t = await sheetText(viewer);
  ok(t.includes(`match ${code}`) && /round 1/.test(t), 'the round is listed from the server: ' + t.slice(0, 220));
  ok(/online matches/.test(t), 'labelled as online matches');
  ok(await viewer.locator('#hist-srv[aria-selected="true"]').count() === 1, 'Online matches tab selected');
  await viewer.click('#hist-p2p');
  await loaded(viewer);
  t = await sheetText(viewer);
  ok(t.includes('match P2P1') && /phone-to-phone/.test(t), 'Phone-to-phone tab shows the Sheet');
  await viewer.click('#close');

  // the server can't be reached: the Sheet instead, with a note
  const off = await mk('off');
  await off.goto(PAGE + '&server=http://127.0.0.1:1');
  await off.click('#hist-open');
  await off.waitForFunction(() => /phone-to-phone/.test(document.getElementById('hist-msg').textContent), null, { timeout: 10000 });
  t = await sheetText(off);
  ok(/Couldn’t reach the game server/.test(t) && t.includes('match P2P1'), 'falls back to the Sheet: ' + t.slice(0, 160));

  await b.close();
  console.log(fails ? `${fails} FAILED` : 'server history ui ok');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log(e); process.exit(1); });
