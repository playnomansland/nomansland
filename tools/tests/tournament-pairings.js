// The organizer changes who plays who: in Matches → Change pairings, tap a player, then the one to trade places with.
// The players' screens follow; a game already going on a moved match stops ("Match moved") and its result never counts.
// Needs: python3 -m http.server 8766 (repo root), node tools/peer-server.js (port 9000) and the game server (cd server && npx wrangler dev --port 8798).
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000&server=http://127.0.0.1:8798&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const T = (p) => p.evaluate(() => window.__tour());
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n) => { const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); p.nm = n; return p; };
  const text = (p, sel) => p.locator(sel).first().innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const org = await mk('Organizer');
  await org.goto(BASE); await org.click('#tour-new'); await org.waitForSelector('#tour-link');
  const link = await text(org, '#tour-link');
  const ps = [];
  for (const n of ['Otto', 'Mira', 'Kalle', 'Sara']) { const p = await mk(n); ps.push(p); await p.goto(link + '&test'); await p.waitForSelector('#tour-name', { timeout: 15000 }); await p.fill('#tour-name', n); await p.click('#tour-name-ok'); }
  await org.waitForFunction(() => document.querySelectorAll('.tour-list li').length === 5, null, { timeout: 15000 });
  await org.click('[data-orgplays="0"]'); await sleep(300); // the organizer just organizes: 4 players, 2 matches
  await org.click('#tour-start'); await sleep(800);
  let t = await T(org);
  const nm = (id) => t.players.find(p => p.id === id).name;
  const before = t.rounds[0].matches.map(mt => `${nm(mt.a)} v ${nm(mt.b)}`);
  ok(before.length === 2, 'round 1: ' + before.join(', '));
  // swap the first match's a with the second match's b
  const [m1, m2] = t.rounds[0].matches;
  await org.click('#tour-edit');
  await org.click(`[data-slot="${m1.id}:a"]`);
  ok(await org.locator(`[data-slot="${m1.id}:a"][aria-pressed="true"]`).count() === 1, 'first tap selects a player');
  await org.click(`[data-slot="${m2.id}:b"]`); await sleep(300);
  t = await T(org);
  const after = t.rounds[0].matches.map(mt => `${nm(mt.a)} v ${nm(mt.b)}`);
  ok(after[0].split(' v ')[0] === before[1].split(' v ')[1] && after[1].split(' v ')[1] === before[0].split(' v ')[0], 'swapped: ' + after.join(', '));
  await org.click('#tour-edit'); // Done
  // every phone shows its new opponent
  for (const p of ps) {
    const mt = t.rounds[0].matches.find(x => nm(x.a) === p.nm || nm(x.b) === p.nm), foe = nm(mt.a) === p.nm ? nm(mt.b) : nm(mt.a);
    await p.waitForFunction((f) => new RegExp('vs ' + f, 'i').test(document.querySelector('#tour-root h2').textContent), foe, { timeout: 8000 });
  }
  ok(true, 'players see their new opponents');
  // a game starts on match 1, then the organizer moves a player out of it
  const g = t.rounds[0].matches[0], hostP = ps.find(p => p.nm === nm(g[g.host])), guestP = ps.find(p => p.nm === nm(g[g.host === 'a' ? 'b' : 'a']));
  await hostP.click('#tour-play'); await sleep(400); await guestP.click('#tour-play');
  for (const p of [hostP, guestP]) await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 20000 });
  ok(true, `${hostP.nm} and ${guestP.nm} are playing`);
  await org.click('#tour-edit');
  await org.click(`[data-slot="${g.id}:b"]`); await org.click(`[data-slot="${t.rounds[0].matches[1].id}:a"]`); await sleep(300);
  await org.click('#tour-edit');
  for (const p of [hostP, guestP]) await p.waitForFunction(() => /Match moved/i.test(document.getElementById('overlay').textContent), null, { timeout: 8000 });
  ok(true, 'the game in progress stops on both phones: ' + await text(hostP, '#overlay h2'));
  await hostP.click('#tour-moved-ok'); await guestP.click('#tour-moved-ok');
  ok(/^vs /i.test(await text(hostP, '#tour-root h2')) && /^vs /i.test(await text(guestP, '#tour-root h2')), `back to their new matches: ${await text(hostP, '#tour-root h2')} / ${await text(guestP, '#tour-root h2')}`);
  // a stale result for the old game is ignored
  t = await T(org);
  ok(t.rounds[0].matches.every(mt => !mt.result), 'no result from the moved game');
  // a match with a result is locked
  await org.click(`[data-res="${t.rounds[0].matches[0].id}:a"]`); await sleep(300);
  await org.click('#tour-edit');
  ok(await org.locator(`[data-slot="${t.rounds[0].matches[0].id}:a"]`).count() === 0 && await org.locator(`[data-slot="${t.rounds[0].matches[1].id}:a"]`).count() === 1, 'a decided match is locked; the other is still editable');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
