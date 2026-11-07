// 2v2 in the browser (src/duo.js, server/src/duo.js; one shared board since 2026-11-03): a developer opens a 2v2 lobby
// from the Developer section, two friends join with the link, the host swaps two seats, the fourth seat goes to the AI,
// everyone picks a package and places a squad, all press Ready, and the fight plays on the same 24 x 19 board on every
// phone with the same result.
// Also: a phone without a developer account doesn't get the button, a reload keeps the seat, teammates see each
// other's squads at once (m.team) and can't place on each other's tiles, no leaders, and pings (? ! ⚔) and quick lines
// reach the team and only the team. A status the page handles late doesn't wind its deploy clock back.
// Needs: python3 -m http.server 8766 (repo root), cd server && npx wrangler dev --port 8798 --var DUO_ANYONE:1
// (PB_SHOTS=dir saves screenshots)
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8766/?server=http://127.0.0.1:8798&test';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DEV = { id: 'p0123456789abcdef', session: 'a'.repeat(64), tag: 'Vilhelm', dev: true, title: '' };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const mk = async (n, acct, vp) => {
    const c = await ctx2d(b, { viewport: vp || { width: 390, height: 844 } });
    if (acct) await c.addInitScript((a) => { try { localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); } catch (e) {} }, acct);
    await c.route('**/account/**', (r) => r.abort()); // no account server here: the page keeps the account it has
    const p = await c.newPage();
    p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; });
    return p;
  };
  const waitPhase = (p, ph, ms = process.env.PB_BOARD === "3d" ? 60000 : 20000) => p.waitForFunction((x) => document.getElementById('phase').textContent === x, ph, { timeout: ms });
  const peek = (p) => p.evaluate(() => { const x = window.__pb(); return { me: x.me, phase: x.phase, cols: Game.COLS, mapId: x.m && x.m.map.id, round: x.m && x.m.round, hp: x.m && x.m.hp.slice(), armies: x.m && x.m.armies.map(a => a.length), net: document.getElementById('net-text').textContent }; });
  const placeOne = (p) => p.evaluate(() => {
    const { m, me } = window.__pb();
    for (let ui = 0; ui < m.units.length; ui++) {
      if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui)) continue;
      for (let row = 0; row < Game.ROWS; row++) for (let col = 0; col < Game.COLS; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { const sq = Game.place(m, me, ui, col, row); window.__pbRedraw(); return sq ? { id: sq.id, ui, col, row } : null; }
    }
    return null;
  });

  // a phone without a developer account: no 2v2 button
  const plain = await mk('plain');
  await plain.goto(BASE);
  await sleep(800);
  ok(!(await plain.locator('#duo-new').count()), 'no 2v2 lobby button without a developer account');

  const host = await mk('host', DEV);
  await host.goto(BASE);
  await host.waitForSelector('#duo-new', { state: 'attached', timeout: 15000 });
  await host.evaluate(() => document.getElementById('duo-new').click());
  await host.waitForFunction(() => /duo=[A-Z0-9]{6}/.test((document.getElementById('link') || {}).textContent || ''), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  const link = (await host.locator('#link').textContent()).trim();
  ok(true, '2v2 link: ' + link.replace(/^.*\?/, '?'));
  await host.waitForFunction(() => /1 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  const f1 = await mk('friend1', null, { width: 1440, height: 900 }), f2 = await mk('friend2'); // friend 1 (the host's teammate) on a PC
  await f1.goto(link + '&test');
  await host.waitForFunction(() => /2 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  // (friend 2's page: the last clock message it got, and its socket, for the late-status check below)
  await f2.context().addInitScript(() => {
    const W = window.WebSocket;
    window.WebSocket = function (...a) {
      const w = new W(...a); window.__ws = w;
      w.addEventListener('message', (e) => { try { const d = JSON.parse(e.data); if ((d.t === 'status' || d.t === 'sync') && d.phase === 'deploy' && d.remaining > 0) window.__clockMsg = { d, at: Date.now() }; } catch (er) {} });
      return w;
    };
    window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  });
  await f2.goto(link + '&test');
  await host.waitForFunction(() => /3 of 4 here/.test(document.getElementById('lobby-status').textContent), null, { timeout: process.env.PB_BOARD === "3d" ? 60000 : 15000 });
  ok(true, 'two friends joined (seats A2, B1)');
  // the host moves friend 2 from B1 (seat 2) to B2 (seat 3): B1 is left to the AI
  await host.click('[data-seat="2"]'); await host.click('[data-seat="3"]');
  await host.waitForFunction(() => /Empty/.test(document.querySelector('[data-seat="2"]').textContent) && !/Empty/.test(document.querySelector('[data-seat="3"]').textContent), null, { timeout: 10000 });
  ok(true, 'host swapped B1 and B2');
  ok(await f1.locator('[data-seat="0"]').isDisabled(), 'a friend can\'t swap seats');
  await host.click('#duo-start');
  for (const p of [host, f1, f2]) await waitPhase(p, 'Deploy');
  let h = await peek(host), a = await peek(f1), c = await peek(f2);
  ok(h.me === 0 && a.me === 0 && c.me === 1, `sides: A1 ${h.me}, A2 ${a.me}, B2 ${c.me}`);
  ok(h.mapId === 'duo' && h.cols === 24 && a.cols === 24 && c.cols === 24, 'everyone on the one 2v2 board (24 columns)');
  ok(/A1 · teammate/.test(h.net) && /A2 · teammate/.test(a.net), 'status line: ' + h.net);
  ok(await host.evaluate(() => window.__pb().m.packages[window.__pb().me].every(p => !p.char)), 'no leaders in the packages');
  ok(h.hp[0] === 200, 'team health 200');
  // packages and one squad each
  for (const p of [host, f1, f2]) await p.dblclick('[data-pack="0"]');
  await sleep(800);
  for (const p of [host, f1, f2]) ok(!!(await placeOne(p)), 'placed a squad');
  await sleep(800);
  // a reload keeps the seat (friend 1)
  await f1.reload();
  await waitPhase(f1, 'Deploy');
  a = await peek(f1);
  ok(a.me === 0 && /A2/.test(a.net), 'friend 1 back in seat A2 after a reload');
  const D3 = process.env.PB_BOARD === '3d';
  // teammates on one board: the host's squads show for friend 1 (m.team), live
  const teamN = (p) => p.evaluate(() => { const x = window.__pb().team; return x ? x.armies[0].length : -1; });
  const before = await teamN(f1);
  ok(before >= 1, 'friend 1 has the host\'s squads on the board: ' + before);
  const placed = await placeOne(host);
  ok(!!placed, 'the host places another squad');
  await f1.waitForFunction((n) => { const x = window.__pb().team; return x && x.armies[0].length > n; }, before, { timeout: 8000 });
  ok(true, 'it shows for the teammate right away');
  ok(await f1.evaluate((t) => { const { m, me } = window.__pb(); return !Game.spotFree(m, me, t.col, t.row) && !Game.place(m, me, t.ui, t.col, t.row); }, placed), 'the teammate can\'t place on that tile');
  ok(await f2.evaluate((t) => { const x = window.__pb().team; return !x.armies[0].some(q => q.col === t.col && q.row === t.row); }, placed), 'the other team doesn\'t see this round\'s squad');
  if (process.env.PB_SHOTS) { await sleep(1500); await f1.screenshot({ path: process.env.PB_SHOTS + '/duo-deploy-pc.png' }); await host.screenshot({ path: process.env.PB_SHOTS + '/duo-deploy-phone.png' }); }
  // a ! ping from the host shows for friend 1 on the same tile of the board
  await host.click('[data-ping="!"]');
  const hb = await host.locator(D3 ? '#wrap > .board3d' : '#board').boundingBox();
  await host.mouse.click(hb.x + hb.width * 0.5, hb.y + hb.height * 0.45);
  await f1.waitForFunction(() => /pinged !/.test(document.getElementById('net-text').textContent) && document.querySelectorAll('#marks .ping').length >= 1, null, { timeout: 8000 });
  ok(true, 'the teammate sees the ping');
  ok(await host.waitForFunction(() => document.querySelectorAll('#marks .ping.mine').length === 1, null, { timeout: 8000 }).then(() => true, () => false), 'the host sees its own ping');
  await sleep(600);
  ok(!/pinged/.test(await f2.locator('#net-text').textContent()) && !(await f2.evaluate(() => document.querySelectorAll('#marks .ping').length)), 'the other team gets nothing');
  // a quick line
  await f1.click('#duo-say'); await f1.evaluate(() => document.querySelector('[data-emote="help"]').click());
  await host.waitForFunction(() => /Help me!/.test(document.getElementById('net-text').textContent), null, { timeout: 8000 });
  ok(true, 'Say: Help me! reaches the teammate');
  // a status the page handles late (a busy 3D phone: its 'remaining' is then older than it looks) doesn't push the
  // 2v2 deploy clock later: the earliest end the page learnt stands (srvClock)
  {
    const secs = () => f2.evaluate(() => { const t = document.getElementById('timer').textContent.split(':'); return (+t[0]) * 60 + (+t[1]); });
    const before = await secs();
    await f2.evaluate(() => { const x = window.__clockMsg, left = x.d.remaining - (Date.now() - x.at); window.__ws.onmessage({ data: JSON.stringify({ ...x.d, t: 'status', remaining: left + 6000 }) }); });
    await sleep(300);
    const after = await secs();
    ok(before > 0 && after <= before, `a late status doesn't wind the clock back: ${before} s, then ${after} s`);
  }
  // Ready
  for (const p of [host, f1, f2]) await p.click('#ready');
  for (const p of [host, f1, f2]) await waitPhase(p, 'Battle', 30000);
  await sleep(1500);
  h = await peek(host); c = await peek(f2); a = await peek(f1);
  ok(h.cols === 24 && h.mapId === 'duo' && c.cols === 24 && a.cols === 24, 'the fight on the same board on every phone');
  ok(await host.evaluate(() => { const x = window.__pb(); return x.bt.bodies.filter(b => b.squad === -2).length === 2; }), 'one tower per team in the fight');
  if (process.env.PB_SHOTS) { await host.screenshot({ path: process.env.PB_SHOTS + '/duo-host.png' }); await f1.screenshot({ path: process.env.PB_SHOTS + '/duo-a2-pc.png' }); }
  if (process.env.PB_BOARD !== '3d') {
    const ar = async (p) => { const r = await p.locator('#board').boundingBox(); return r.width / r.height; };
    ok(Math.abs(await ar(host) - 24 / 19) < 0.05 && Math.abs(await ar(f1) - 24 / 19) < 0.05, 'the board keeps its shape (24 x 19) on phone and PC');
  }
  // speed the rest up: play the fight to its end
  for (const p of [host, f1, f2]) await p.evaluate(() => { const x = window.__pb(); while (x.bt.step()) {} });
  for (const p of [host, f1, f2]) await waitPhase(p, 'Result', 30000).catch(() => waitPhase(p, 'Match over', 5000));
  h = await peek(host); a = await peek(f1); c = await peek(f2);
  ok(h.cols === 24 && h.mapId === 'duo', 'still the same board after the fight');
  ok(JSON.stringify(h.hp) === JSON.stringify(c.hp) && JSON.stringify(h.hp) === JSON.stringify(a.hp), 'same team health everywhere: ' + h.hp.join(' / '));
  if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-result.png' });
  // next round
  for (const p of [host, f1, f2]) await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^(Next round|Continue|Next)/.test(x.textContent.trim())); if (b) b.click(); });
  for (const p of [host, f1, f2]) await waitPhase(p, 'Deploy', 30000);
  h = await peek(host);
  ok(h.round === 2, 'round 2 begins');
  await b.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
