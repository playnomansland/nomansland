// 2v2: ride in your teammate's horse, in the browser (docs/HANDOFF-DUO-HORSE.md).
//  - the teammate (A2) places a horse; the host (A1) picks a unit in the shop and taps the horse: the squad rides in it
//    (the server agrees: no refusal, it is still inside after the next sync)
//  - the badge on the horse on both teammates' boards, in the rider's player's colour; the opponent never sees it
//  - the sheets: the host taps the horse: "Carries your ..." with Step out; the teammate's own horse sheet says it
//    carries the host's squad (by the host's name)
//  - the teammate moves the horse: the rider goes with it on the host's board
//  - the fight played back on the phones: the rider sits inside the teammate's horse
// Needs: python3 -m http.server 8772 (repo root),
//        cd server && npx wrangler dev --port 8773 --var DUO_ANYONE:1 --var ALLOWED_ORIGINS:http://127.0.0.1:8772
// (PB_SHOTS=dir saves screenshots)
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8772/?server=http://127.0.0.1:8773&test';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DEV = { id: 'p0123456789abcdef', session: 'a'.repeat(64), tag: 'Vilhelm', dev: true, title: '' };
const OFF = 1000000;
(async () => {
  const b = await pw.chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const mk = async (n, acct) => {
    const c = await ctx2d(b, { viewport: { width: 1440, height: 900 } });
    if (acct) await c.addInitScript((a) => { try { localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); } catch (e) {} }, acct);
    await c.route('**/account/**', (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; });
    return p;
  };
  const waitPhase = (p, ph, ms = 30000) => p.waitForFunction((x) => document.getElementById('phase').textContent === x, ph, { timeout: ms });
  const tapTile = async (p, col, row) => {
    const bb = await p.locator('#board').boundingBox(), me = await p.evaluate(() => window.__pb().me), C = await p.evaluate(() => Game.COLS), R = await p.evaluate(() => Game.ROWS);
    const c = me === 1 ? C - 1 - col : col, r = me === 1 ? R - 1 - row : row;
    await p.mouse.click(bb.x + (c + 0.5) * bb.width / C, bb.y + (r + 0.5) * bb.height / R);
  };
  const sheetText = (p) => p.evaluate(() => document.getElementById('sheet-back').hidden ? '' : document.getElementById('sheet').textContent);
  const closeSheet = (p) => p.evaluate(() => { const c = document.getElementById('close'); if (c) c.click(); });
  const dockDown = (p) => p.evaluate(() => { const d = document.getElementById('dock-toggle'); if (document.documentElement.classList.contains('dock') && d && !document.documentElement.classList.contains('dock-down')) d.click(); });
  // the colour of the rider badge's ring (bottom left of a tile) on a phone's 2D board
  const badgeCol = (p, col, row) => p.evaluate(([col, row]) => {
    const cv = document.getElementById('board'), g = cv.getContext('2d'), me = window.__pb().me, t = cv.width / Game.COLS;
    const c = me === 1 ? Game.COLS - 1 - col : col, r = me === 1 ? Game.ROWS - 1 - row : row;
    const br = Math.max(6, t * 0.2), bx = c * t + br + 2, by = (r + 1) * t - br - 2;
    const hex = (d) => '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    return [0, 90, 180, 270].map(a => { const q = a * Math.PI / 180; return hex(g.getImageData(Math.round(bx + Math.cos(q) * br), Math.round(by + Math.sin(q) * br), 1, 1).data); });
  }, [col, row]);
  const near = (a, b) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255)) < 90; };

  const host = await mk('host', DEV);
  await host.goto(BASE);
  await host.waitForSelector('#duo-new', { state: 'attached', timeout: 20000 });
  await host.evaluate(() => document.getElementById('duo-new').click());
  await host.waitForFunction(() => /duo=[A-Z0-9]{6}/.test((document.getElementById('link') || {}).textContent || ''), null, { timeout: 20000 });
  const link = (await host.locator('#link').textContent()).trim();
  const mate = await mk('mate'), foe = await mk('foe');
  await mate.goto(link + '&test');
  await host.waitForFunction(() => /2 of 4 here/.test((document.getElementById('lobby-status') || {}).textContent || ''), null, { timeout: 20000 });
  await foe.goto(link + '&test');
  await host.waitForFunction(() => /3 of 4 here/.test((document.getElementById('lobby-status') || {}).textContent || ''), null, { timeout: 20000 });
  await host.click('#duo-start'); // A1 host, A2 mate, B1 foe, B2 the AI
  for (const p of [host, mate, foe]) await waitPhase(p, 'Deploy');
  for (const p of [host, mate, foe]) await p.dblclick('[data-pack="0"]');
  await sleep(800);

  // the teammate unlocks and places a horse (through the page's own Game calls, which go to the server as taps do)
  const horse = await mate.evaluate(() => {
    const { m, me } = window.__pb(), hu = m.units.findIndex(u => u.name === 'Just a horse');
    m.gold[me] += 0; // (the package round leaves enough gold for an unlock and a horse)
    if (!Game.isUnlocked(m, me, hu) && !Game.unlock(m, me, hu)) return { why: 'unlock' };
    for (const row of Game.zoneRows(me).slice().reverse()) for (let col = 3; col < Game.COLS - 3; col++) if (Game.canPlaceAt(m, me, col, row, hu) && Game.spotFree(m, me, col, row, hu)) {
      const sq = Game.place(m, me, hu, col, row); window.__pbRedraw(); return sq ? { id: sq.id, col, row } : { why: 'place' };
    }
    return { why: 'no tile' };
  });
  ok(horse && horse.id != null, 'the teammate places a horse ' + JSON.stringify(horse));
  ok(await host.waitForFunction((id) => { const t = window.__pb().team; return !!(t && t.armies[0].some(q => q.id === id)); }, horse.id + OFF, { timeout: 8000 }).then(() => true, () => false), 'the host gets it (m.team)');

  // the host picks a unit in the shop and taps the horse
  const pick = await host.evaluate(() => {
    const { m, me } = window.__pb();
    for (let ui = 0; ui < m.units.length; ui++) {
      const u = m.units[ui];
      if (u.carrier || u.building || Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui)) continue;
      return { ui, name: u.name };
    }
    return null;
  });
  ok(!!pick, 'the host has a unit to send in: ' + (pick && pick.name));
  await dockDown(host);
  const card = await host.evaluate((ui) => { const c = document.querySelector(`.ucard[data-i="${ui}"], .uc2[data-i="${ui}"]`); if (!c) return false; c.click(); return true; }, pick.ui);
  ok(card, 'its shop card');
  await sleep(200);
  ok(await host.evaluate(([col, row, ui]) => { const { m, me } = window.__pb(); return !!Game.boardable(m, me, col, row, ui); }, [horse.col, horse.row, pick.ui]), 'the host sees room in the teammate\'s horse');
  await tapTile(host, horse.col, horse.row);
  await sleep(1500); // the server's answer (a refusal would put it back)
  const rider = await host.evaluate((hid) => { const { m, me } = window.__pb(); const q = m.armies[me].find(x => x.in === hid); return q ? { id: q.id, unit: q.unit, col: q.col, row: q.row } : null; }, horse.id + OFF);
  ok(!!rider && rider.unit === pick.ui, 'the host\'s squad rides in the teammate\'s horse, after the server\'s answer');
  ok(await mate.waitForFunction((hid) => { const t = window.__pb().team; return !!(t && t.armies[0].some(q => q.in === hid)); }, horse.id, { timeout: 8000 }).then(() => true, () => false), 'the teammate gets the rider, in their own horse');
  ok(await foe.evaluate(() => { const { m } = window.__pb(); return ![...m.armies[0], ...((m.team && m.team.armies[0]) || [])].some(q => q.in != null); }), 'the opponent never sees it');

  // the badge, in the host's colour, on both boards
  // (ring colours are the viewer's: the host is "you" on its own board, "teammate" on the teammate's; seat 0 in both lists)
  const rings = await host.evaluate(() => window.__pb().rings), mrings = await mate.evaluate(() => window.__pb().rings);
  await host.evaluate(() => window.__pbRedraw()); await mate.evaluate(() => window.__pbRedraw()); await sleep(300);
  const hb = await badgeCol(host, horse.col, horse.row), mb = await badgeCol(mate, horse.col, horse.row);
  ok(hb.some(c => near(c, rings[0])), 'the badge on the host\'s board, in the host\'s colour: ' + hb.join(' '));
  ok(mb.some(c => near(c, mrings[0])), 'the badge on the teammate\'s board, in the host\'s colour: ' + mb.join(' '));
  if (process.env.PB_SHOTS) { await host.screenshot({ path: process.env.PB_SHOTS + '/duo-horse-host.png' }); await mate.screenshot({ path: process.env.PB_SHOTS + '/duo-horse-mate.png' }); }

  // the sheets
  await tapTile(host, horse.col, horse.row);
  await host.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  let txt = await sheetText(host);
  ok(/Carries your/.test(txt) && /teammate/.test(txt), 'the host taps the horse: the teammate\'s sheet, "Carries your ..."');
  ok(await host.evaluate(() => !!document.getElementById('ride-out')), 'with Step out');
  await closeSheet(host);
  await dockDown(mate);
  await tapTile(mate, horse.col, horse.row);
  await mate.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  txt = await sheetText(mate);
  const hostName = await mate.evaluate(() => { const n = document.querySelector('.hud [data-ring="mate"]'); return n ? n.textContent.trim() : ''; });
  ok(new RegExp('Carries ' + hostName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '’s').test(txt), `the teammate's own horse sheet: "Carries ${hostName}’s ..."`);
  await closeSheet(mate);

  // the teammate moves the horse (placed this round: free): the rider goes with it on the host's board
  const to = await mate.evaluate((id) => {
    const { m, me } = window.__pb(), h = m.armies[me].find(q => q.id === id);
    for (const row of Game.zoneRows(me)) for (let col = 3; col < Game.COLS - 3; col++) if ((col !== h.col || row !== h.row) && Game.canPlaceAt(m, me, col, row, h.unit, true) && Game.spotFree(m, me, col, row, h.unit)) {
      const r = Game.moveSquad(m, me, id, col, row); window.__pbRedraw(); return r ? { col, row } : null;
    }
    return null;
  }, horse.id);
  ok(!!to, 'the teammate moves the horse');
  ok(await host.waitForFunction(([id, col, row]) => { const { m, me } = window.__pb(); const q = m.armies[me].find(x => x.id === id); return !!(q && q.col === col && q.row === row && q.in != null); }, [rider.id, to.col, to.row], { timeout: 8000 }).then(() => true, () => false), 'the rider went along on the host\'s board');

  // the fight: on the host's phone the rider sits inside the teammate's horse
  for (const p of [host, mate, foe]) await p.click('#ready');
  for (const p of [host, mate, foe]) await waitPhase(p, 'Battle', 30000);
  const inside = await host.evaluate(([rid, hid]) => { const { bt } = window.__pb(); const h = bt.bodies.find(x => x.squad === hid && x.side === 0), r = bt.bodies.filter(x => x.squad === rid && x.side === 0); return { h: !!h, n: r.length, ok: !!h && r.length > 0 && r.every(x => x.carrier === h && (x.boarded || x.alive)) }; }, [rider.id, horse.id + OFF]);
  ok(inside.ok, 'in the fight the rider sits in the teammate\'s horse ' + JSON.stringify(inside));
  for (const p of [host, mate, foe]) await p.evaluate(() => { const x = window.__pb(); while (x.bt.step()) {} });
  for (const p of [host, mate, foe]) await waitPhase(p, 'Result', 30000).catch(() => waitPhase(p, 'Match over', 5000));
  await b.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
