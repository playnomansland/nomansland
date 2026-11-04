// Report a bug in the browser (2026-11-04). Starts its own local server with accounts on (server/test/accounts-env.js)
// and a stand-in for the Discord webhook. Checks:
//  - Settings (menu) has Report a bug; the sheet shows the version; an empty report isn't sent
//  - in an AI match (cog -> Settings -> Report a bug) the match id and round are filled in; Post sends one webhook call
//    with the version, match id and round in it; the sheet then links to the new post
//  - with the server's reports off, the page copies the whole report and offers Open Discord instead
// Screenshots: /tmp/bug-*.png. Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/bug-ui.js
const { chromium } = require('playwright-core');
const http = require('http');
const { startAccounts } = require('../../server/test/accounts-env.js');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const got = [];
  const hook = http.createServer((req, res) => {
    let body = ''; req.on('data', d => (body += d));
    req.on('end', () => { got.push(JSON.parse(body)); res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close'); res.end(JSON.stringify({ id: '1', channel_id: '777' })); });
  });
  await new Promise(r => hook.listen(0, '127.0.0.1', r));
  const srv = await startAccounts(8784, { BUG_WEBHOOK: `http://127.0.0.1:${hook.address().port}/api/webhooks/1/x`, DISCORD_GUILD_ID: '4242' });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage();
    p.on('pageerror', e => ok(false, 'page error: ' + e.message));
    await p.goto(`http://127.0.0.1:8766/?test&server=${srv.base}`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#music-open', { state: 'attached' });
    await p.evaluate(() => document.getElementById('music-open').click());
    await p.click('#bug-open');
    const ver = await p.evaluate(() => window.__bug().version);
    ok(/^\d{1,2} \w{3} \d{4} · [0-9a-f]{7}$/.test(ver), 'version stamped: ' + ver);
    ok((await p.textContent('#sheet')).includes(ver), 'sheet shows the version');
    await p.click('#bug-send');
    ok((await p.textContent('#bug-msg')).includes('few words'), 'empty report not sent');
    await p.screenshot({ path: '/tmp/bug-menu.png' });
    await p.click('#close');

    // an AI match
    await p.evaluate(() => document.getElementById('go').click());
    await p.waitForFunction(() => window.__pb && window.__pb().m && window.__pb().phase === 'deploy', null, { timeout: 30000 });
    await p.evaluate(() => document.getElementById('cog').click());
    await p.click('#bug-open');
    const info = await p.evaluate(() => window.__bug());
    ok(/^ai-[0-9a-z]+$/.test(info.match), 'match id: ' + info.match);
    ok(info.info.round === '1' && info.info.mode === 'ai' && /2D|3D/.test(info.info.board), 'round, mode, board: ' + JSON.stringify(info.info).slice(0, 120));
    await p.fill('#bug-text', 'Goblins stand still\nThey never walked in round 1.');
    await p.screenshot({ path: '/tmp/bug-match.png' });
    await p.click('#bug-send');
    await p.waitForFunction(() => !document.getElementById('bug-after').hidden, null, { timeout: 15000 });
    ok(got.length === 1 && got[0].thread_name === 'Goblins stand still', 'one post, titled by the first line');
    ok(got[0] && got[0].content.includes(ver) && got[0].content.includes(info.match) && got[0].content.includes('Round: `1`'), 'post has version, match and round');
    ok((await p.getAttribute('#bug-link', 'href')) === 'https://discord.com/channels/4242/777', 'links to the post');
    await p.screenshot({ path: '/tmp/bug-sent.png' });

    // server reports off (here: no server at all): copied, Open Discord
    const p2 = await ctx.newPage();
    await p2.goto('http://127.0.0.1:8766/?test&server=http://127.0.0.1:9', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#music-open', { state: 'attached' });
    await p2.evaluate(() => { document.getElementById('music-open').click(); document.getElementById('bug-open').click(); });
    await p2.fill('#bug-text', 'Menu froze');
    await p2.click('#bug-send');
    await p2.waitForFunction(() => !document.getElementById('bug-after').hidden, null, { timeout: 15000 });
    const clip = await p2.evaluate(() => navigator.clipboard.readText());
    ok(clip.startsWith('Menu froze') && clip.includes('Version: ' + ver) && clip.includes('Match: none'), 'report copied: ' + JSON.stringify(clip.slice(0, 80)));
    ok((await p2.getAttribute('#bug-link', 'href')).startsWith('https://discord.gg/'), 'offers Open Discord');
    await p2.screenshot({ path: '/tmp/bug-fallback.png' });
  } finally { await b.close(); srv.stop(); hook.close(); }
  console.log(fails ? `${fails} failed` : 'bug report UI: all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
