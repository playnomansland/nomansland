// A friend's match on the game server (server step 3) in the browser: the host taps Play a friend (a server match
// with a ?play= link), the friend opens the link, both pick packages and place squads; the server referees.
// Checks: both phones are 'net' players (side 0 and 1), the friend never sees the host's new squads while deploying,
// a squad placed shows up on the server (the other phone sees it in the fight), the fight plays on both phones with
// the same result, a phone that reloads mid-deploy comes back to its side with its squads, an action the rules don't
// allow is put right by the server, the old PeerJS ?join= links and Factions still use PeerJS, and a forfeit ends it.
// Needs: python3 -m http.server 8766 (repo root), node tools/peer-server.js (port 9000), cd server && npx wrangler dev --port 8798
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?peerhost=127.0.0.1&peerport=9000&server=http://127.0.0.1:8798&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const mk = async (n, ctx) => { const c = ctx || await ctx2d(b, { viewport: { width: 390, height: 844 } }); const p = await c.newPage(); p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; }); p.ctx = c; return p; };
  const phaseOf = (p) => p.locator('#phase').innerText();
  const waitPhase = (p, ph, ms = 15000) => p.waitForFunction((x) => document.getElementById('phase').textContent === x, ph, { timeout: ms });
  const peek = (p) => p.evaluate(() => { const x = window.__pb(); return { me: x.me, phase: x.phase, round: x.m && x.m.round, gold: x.m && x.m.gold.slice(), armies: x.m && x.m.armies.map(a => a.map(q => ({ id: q.id, unit: q.unit, col: q.col, row: q.row, round: q.round }))), chars: x.m && x.m.chars.slice() }; });
  // places one squad of the first unit this side can buy, through the Game function (as a tap on the board does)
  const placeOne = (p) => p.evaluate(() => {
    const { m, me } = window.__pb();
    for (let ui = 0; ui < m.units.length; ui++) {
      if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui)) continue;
      for (let row = 0; row < 20; row++) for (let col = 0; col < 12; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { const sq = Game.place(m, me, ui, col, row); window.__pbRedraw(); return sq ? { id: sq.id, ui, col, row } : null; }
    }
    return null;
  });

  const host = await mk('host'), guest = await mk('guest');
  await host.goto(BASE);
  await host.click('#friend');
  await host.waitForFunction(() => /play=/.test(document.getElementById('link').textContent), null, { timeout: 15000 });
  const link = (await host.locator('#link').textContent()).trim();
  ok(/play=[A-Z0-9]{5}/.test(link), 'a server match link: ' + link.replace(/^.*\?/, '?'));
  await host.waitForFunction(() => /Waiting for your friend/.test(document.getElementById('lobby-status').textContent), null, { timeout: 15000 });
  await guest.goto(link + '&test');
  await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
  ok(true, 'host sees the friend arrive');
  await host.click('#start');
  await waitPhase(host, 'Deploy'); await waitPhase(guest, 'Deploy');
  let h = await peek(host), g = await peek(guest);
  ok(h.me === 0 && g.me === 1, `sides: host ${h.me}, friend ${g.me}`);
  ok(await host.evaluate(() => !!localStorage.getItem('phonebellum.net.v1')) && await guest.evaluate(() => !!localStorage.getItem('phonebellum.net.v1')), 'both phones keep the match to come back to');

  // packages, by tapping the cards
  await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="1"]');
  await sleep(800);
  h = await peek(host); g = await peek(guest);
  ok(h.chars[0] && g.chars[1], `packages picked: host ${h.chars[0]}, friend ${g.chars[1]}`);
  ok(g.chars[0] === null, 'the friend doesn\'t see the host\'s leader in round 1');
  // the host places a squad: the friend doesn't see it
  const placed = await placeOne(host);
  ok(!!placed, 'host placed a squad: ' + JSON.stringify(placed));
  await sleep(800);
  g = await peek(guest);
  ok(!g.armies[0].some(q => q.round === 1 && !q.free), 'the friend sees none of the host\'s new squads');
  await placeOne(guest);
  // an action the server refuses: the phone's copy is put right (a squad on a tile it may not use, made locally)
  const before = await peek(guest);
  await guest.evaluate(() => { const { m, me } = window.__pb(); m.gold[me] += 5000; }); // a cheat on this phone only
  const unl = await guest.evaluate(() => { const { m, me } = window.__pb(); let n = 0; for (let ui = 0; ui < m.units.length; ui++) if (!Game.isOff(m, ui, me) && !Game.isUnlocked(m, me, ui) && Game.unlock(m, me, ui)) n++; return n; });
  ok(unl > 2, `the cheating phone unlocked ${unl} units on its own copy`);
  await sleep(1200);
  g = await peek(guest);
  ok(g.gold[1] <= before.gold[1] && g.gold[1] >= 0, `the server put the friend's gold back (${before.gold[1]} -> ${g.gold[1]})`);
  ok(await guest.evaluate(() => { const { m, me } = window.__pb(); return m.units.filter((u, ui) => !Game.isOff(m, ui, me) && !Game.isUnlocked(m, me, ui)).length > 0; }), 'and the unlocks it couldn\'t pay for are gone again');

  // the friend reloads: same side, same squads
  const mine = (await peek(guest)).armies[1].map(q => q.id).sort().join(',');
  await guest.reload();
  await waitPhase(guest, 'Deploy');
  await sleep(800);
  g = await peek(guest);
  ok(g.me === 1 && g.armies[1].map(q => q.id).sort().join(',') === mine, 'after a reload: side 1 with its squads (' + mine + ')');
  // both ready: the fight on both phones, the same result
  await host.click('#ready'); await guest.click('#ready');
  await waitPhase(host, 'Battle', 20000); await waitPhase(guest, 'Battle', 20000);
  const seen = await guest.evaluate(() => window.__pb().bt.bodies.filter(x => x.side === 0).length);
  ok(seen > 0, 'the host\'s squads fight on the friend\'s phone: ' + seen + ' bodies');
  for (const p of [host, guest]) { await p.click('#skip'); await p.click('#skip'); }
  await host.waitForFunction(() => /Result|Match over/.test(document.getElementById('phase').textContent), null, { timeout: 15000 });
  await guest.waitForFunction(() => /Result|Match over/.test(document.getElementById('phase').textContent), null, { timeout: 15000 });
  const rh = await host.locator('#overlay h2').innerText(), rg = await guest.locator('#overlay h2').innerText();
  ok((/won/i.test(rh) && /lost/i.test(rg)) || (/lost/i.test(rh) && /won/i.test(rg)) || (/Draw|Time/i.test(rh) && /Draw|Time/i.test(rg)), `results agree: host "${rh}", friend "${rg}"`);
  // next round
  await host.click('#next'); await guest.click('#next');
  await waitPhase(host, 'Deploy', 15000); await waitPhase(guest, 'Deploy', 15000);
  ok((await peek(host)).round === 2 && (await peek(guest)).round === 2, 'round 2 on both');
  // the host reloads: the menu offers the match back, and it comes back as side 0
  await host.reload();
  await host.waitForSelector('#net-resume', { timeout: 10000 });
  await host.click('#net-resume');
  await waitPhase(host, 'Deploy', 15000);
  ok((await peek(host)).me === 0 && (await peek(host)).round === 2, 'host back in round 2 as side 0 from the menu');
  // the friend forfeits: the host wins
  await guest.click('#cog'); await guest.click('#to-menu'); await guest.click('#forfeit-yes');
  await waitPhase(host, 'Match over', 8000);
  ok(/forfeited/.test(await host.locator('#overlay').innerText()), 'host: the friend forfeited');
  ok(await guest.isVisible('#go'), 'the friend is on the menu');

  // old links (?join=) and Factions still go phone to phone
  const h2 = await mk('host2');
  await h2.goto(BASE); await h2.click('#friend');
  await h2.waitForSelector('#use-peer');
  await h2.click('#use-peer');
  await h2.waitForFunction(() => /join=/.test(document.getElementById('link').textContent), null, { timeout: 15000 });
  const plink = (await h2.locator('#link').textContent()).trim();
  ok(/join=/.test(plink), 'phone to phone: a ?join= link');
  const g2 = await mk('guest2');
  await g2.goto(plink + '&test');
  await h2.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 20000 });
  await h2.click('#start');
  await waitPhase(g2, 'Deploy', 15000);
  ok((await h2.evaluate(() => window.__pb().me)) === 0 && (await g2.evaluate(() => window.__pb().me)) === 1, 'the PeerJS match still works');
  // a typed code that isn't a server match falls back to PeerJS
  const g3 = await mk('guest3');
  await g3.goto(BASE);
  await g3.fill('#code-in', 'ZZZZ9'); await g3.click('#join');
  await sleep(1500);
  ok(/ZZZZ9/.test(await g3.locator('#overlay').innerText()), 'an unknown code is looked for phone to phone too');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'server match in the browser: all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
