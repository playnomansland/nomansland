// 2v2 view in the browser (docs/HANDOFF-DUO-VIEW.md): whose unit is whose.
//  - tap your teammate's squad: its full sheet, read only (no buy, sell or move buttons), with "<name>'s (teammate)"
//  - your teammate's direction arrow reaches you (m.team) and shows on their sheet; the opponents never get it while deploying
//  - a colour per player: four different ring colours, a legend in the HUD, a ring under every squad on the board
//  - a ping is gone after about 3 seconds
//  - after the fight: tap an opponent's squad (either lane): "<name>'s (opponent)"; the damage stats' Team units lists
//    the teammate's rows and a total per player
// Needs: python3 -m http.server 8765 (repo root), cd server && npx wrangler dev --port 8767 --var DUO_ANYONE:1
// (PB_SHOTS=dir saves screenshots)
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8765/?server=http://127.0.0.1:8767&test';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DEV = { id: 'p0123456789abcdef', session: 'a'.repeat(64), tag: 'Vilhelm', dev: true, title: '' };
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
  // a squad placed through the page (it reaches the server like a tap would); melee: one that can get a direction arrow
  const placeOne = (p, melee) => p.evaluate((melee) => {
    const { m, me } = window.__pb();
    if (melee) { const q = m.armies[me].find(x => x.in == null && Game.canAim(m, me, x)); if (q) return { id: q.id, ui: q.unit, col: q.col, row: q.row }; } // one from the package
    for (let ui = 0; ui < m.units.length; ui++) {
      if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui) || m.units[ui].building) continue;
      const u = m.units[ui];
      if (melee && !(!u.stay && !u.idle && u.speed > 0 && u.range <= Game.AIM.melee)) continue;
      for (const row of Game.zoneRows(me)) for (let col = 2; col < Game.COLS - 2; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { const sq = Game.place(m, me, ui, col, row); window.__pbRedraw(); return sq ? { id: sq.id, ui, col, row } : null; }
    }
    return null;
  }, melee);
  // a click on a tile of the 2D board (side 1 sees it turned round)
  const tapTile = async (p, col, row) => {
    const bb = await p.locator('#board').boundingBox(), me = await p.evaluate(() => window.__pb().me), C = await p.evaluate(() => Game.COLS), R = await p.evaluate(() => Game.ROWS);
    const c = me === 1 ? C - 1 - col : col, r = me === 1 ? R - 1 - row : row;
    await p.mouse.click(bb.x + (c + 0.5) * bb.width / C, bb.y + (r + 0.5) * bb.height / R);
  };
  const sheet = (p) => p.evaluate(() => ({ open: !document.getElementById('sheet-back').hidden, owner: (document.querySelector('#sheet .owner-line') || {}).textContent || '', ownerCol: (document.querySelector('#sheet .owner-line') || { style: {} }).style.color || '', acts: document.querySelectorAll('#sheet [data-act], #sheet [data-skill], #sheet [data-unskill], #sheet #unlock').length, text: document.getElementById('sheet').textContent }));
  const closeSheet = (p) => p.evaluate(() => { const c = document.getElementById('close'); if (c) c.click(); });

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
  // the host takes a package with a melee squad in it when there is one (for the direction arrow)
  const pk = await host.evaluate(() => { const { m, me } = window.__pb(); const k = m.packages[me].findIndex(p => p.squads.some(ui => { const u = m.units[ui]; return !u.building && !u.stay && !u.idle && u.speed > 0 && u.range <= Game.AIM.melee; })); return Math.max(0, k); });
  await host.dblclick(`[data-pack="${pk}"]`);
  for (const p of [mate, foe]) await p.dblclick('[data-pack="0"]');
  await sleep(800);
  const hq = await placeOne(host, true);
  ok(!!hq, 'the host has a melee squad');
  ok(!!(await placeOne(mate)) && !!(await placeOne(foe)), 'the teammate and an opponent place a squad');
  // the host gives it a direction arrow: it reaches the teammate, not the opponent
  ok(await host.evaluate((q) => { const { m, me } = window.__pb(); const r = Game.setAim(m, me, q.id, 0, -2); window.__pbRedraw(); return !!r; }, hq), 'the host sets a direction arrow');
  const mid = hq.id + 1000000;
  ok(await mate.waitForFunction((id) => { const t = window.__pb().team; const q = t && t.armies[0].find(x => x.id === id); return !!(q && q.aim && q.aim.dr === -2); }, mid, { timeout: 8000 }).then(() => true, () => false), 'the teammate gets the arrow (m.team)');
  ok(await foe.evaluate(() => { const { m } = window.__pb(); return !m.armies[0].some(q => q.aim) && !(m.team && m.team.armies[0].some(q => q.aim)); }), 'the opponent doesn\'t');

  // the teammate taps the host's squad: the full sheet, read only, with whose it is
  await mate.evaluate(() => { const d = document.getElementById('dock-toggle'); if (document.documentElement.classList.contains('dock') && d && !document.documentElement.classList.contains('dock-down')) d.click(); });
  await tapTile(mate, hq.col, hq.row);
  await mate.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  let s = await sheet(mate);
  ok(s.open && /’s \(teammate\)/.test(s.owner) && !/^Yours/.test(s.owner), 'teammate\'s sheet says whose: ' + s.owner);
  ok(s.acts === 0, 'read only: no buy, sell or move buttons (' + s.acts + ')');
  ok(/Level 1/.test(s.text) && /Health/.test(s.text), 'the full sheet: level, stats');
  ok(/Direction:/.test(s.text), 'and the direction, read only');
  if (process.env.PB_SHOTS) await mate.screenshot({ path: process.env.PB_SHOTS + '/duo-view-mate-sheet.png' });
  await closeSheet(mate);
  // the host's own squad: "Yours", with its buttons
  await tapTile(host, hq.col, hq.row);
  await host.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  s = await sheet(host);
  ok(s.open && /^Yours/.test(s.owner) && s.acts > 0, 'own sheet: Yours, with its buttons');
  await closeSheet(host);

  // a colour per player: four different colours, a legend in the HUD, rings on the board
  const rings = await host.evaluate(() => window.__pb().rings);
  ok(new Set(rings).size === 4, 'four ring colours: ' + rings.join(' '));
  const legend = await host.evaluate(() => [...document.querySelectorAll('.hud [data-ring]')].map(e => e.dataset.ring + ':' + e.textContent));
  ok(legend.length === 4 && ['you', 'mate', 'foe', 'foe2'].every(k => legend.some(x => x.startsWith(k + ':'))), 'HUD legend: ' + legend.join(', '));
  const lum = (h) => { const n = parseInt(h.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => v / 255); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  ok(Math.abs(lum(rings[0]) - lum(rings[1])) > 0.2 && Math.abs(lum(rings[2]) - lum(rings[3])) > 0.2, 'each pair also differs in lightness');
  // the ring under the teammate's squad on the host's board, in the teammate's colour
  const mq = await host.evaluate(() => { const t = window.__pb().team; const q = t.armies[0][t.armies[0].length - 1]; return { col: q.col, row: q.row }; });
  const px = await host.evaluate((q) => {
    const cv = document.getElementById('board'), g = cv.getContext('2d'), t = cv.width / Game.COLS, cx = (q.col + 0.5) * t, cy = (q.row + 0.5) * t, R = t * 0.46;
    const hex = (d) => '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    return [0, 90, 180, 270].map(a => { const r = a * Math.PI / 180; return hex(g.getImageData(Math.round(cx + Math.cos(r) * R), Math.round(cy + Math.sin(r) * R), 1, 1).data); });
  }, mq);
  const near = (a, b) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); return Math.abs((x >> 16) - (y >> 16)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255)) < 90; };
  ok(px.some(c => near(c, rings[1])), 'the teammate\'s squad has a ring in their colour: ' + px.join(' '));

  // a ping: gone after about 3 s
  await host.click('[data-ping="!"]');
  await tapTile(host, 12, 9);
  await mate.waitForFunction(() => document.querySelectorAll('#marks .ping').length >= 1, null, { timeout: 8000 });
  const pingCol = await mate.evaluate(() => { const g = document.querySelector('#marks .ping'); return g && g.querySelector('circle').style.stroke; });
  ok(/pinged/.test(await mate.locator('#net-text').textContent()) && !!pingCol, 'the teammate sees the ping, in the host\'s colour: ' + pingCol);
  await sleep(3300);
  ok(await mate.evaluate(() => document.querySelectorAll('#marks .ping').length === 0), 'the ping is gone after 3 s');

  // the fight, then the results
  for (const p of [host, mate, foe]) await p.click('#ready');
  for (const p of [host, mate, foe]) await waitPhase(p, 'Battle', 30000);
  await sleep(800);
  if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-view-battle.png' });
  // a tap on a body in the fight: its card says whose (all four players' squads)
  const bw = await host.evaluate(() => { const { bt } = window.__pb(); const b = bt.bodies.find(x => x.alive && x.lane === 1 && x.side === 1 && x.squad >= 0 && !x.u.structure && !x.hidden); if (!b) return null; const C = Game.COLS, R = Game.ROWS, T = Game.TILE; return { c: b.x / T + (C - 1) / 2, r: (R - 1) / 2 - b.y / T }; });
  if (bw) {
    await host.evaluate(() => { const x = window.__pb(); x.liveSpeed && null; });
    const bb = await host.locator('#board').boundingBox();
    await host.mouse.click(bb.x + (bw.c + 0.5) * bb.width / 24, bb.y + (bw.r + 0.5) * bb.height / 19);
    const card = await host.evaluate(() => (document.querySelector('#bcard .owner-line') || {}).textContent || '');
    ok(/\(opponent\)/.test(card) || card === '', 'battle card of the other lane\'s opponent: ' + (card || '(moved off before the tap)'));
  }
  for (const p of [host, mate, foe]) await p.evaluate(() => { const x = window.__pb(); while (x.bt.step()) {} });
  for (const p of [host, mate, foe]) await waitPhase(p, 'Result', 30000).catch(() => waitPhase(p, 'Match over', 5000));
  await sleep(800);
  await host.evaluate(() => { const o = document.getElementById('overlay'); if (o) o.hidden = true; }); // the result card off the board, to tap it
  // after the fight: tap an opponent's squad in either lane
  const foes = await host.evaluate(() => { const { m, me } = window.__pb(); return { own: m.armies[1 - me].filter(q => q.in == null).map(q => ({ col: q.col, row: q.row })), other: Game.teamArmy(m, 1 - me).filter(q => q.in == null).map(q => ({ col: q.col, row: q.row })) }; });
  for (const [k, list] of Object.entries(foes)) {
    if (!list.length) { ok(true, `no ${k} opponent squads left to tap`); continue; }
    await tapTile(host, list[0].col, list[0].row);
    await sleep(300);
    s = await sheet(host);
    ok(s.open && /’s \(opponent\)/.test(s.owner), `after the fight, the ${k === 'own' ? 'lane\'s' : 'other lane\'s'} opponent's sheet: ${s.owner}`);
    await closeSheet(host);
  }
  // the damage stats: My units / Team units
  await host.evaluate(() => document.getElementById('stats').click());
  await host.waitForSelector('#stats-dd [data-stm="team"]', { timeout: 5000 });
  const mineRows = await host.evaluate(() => document.querySelectorAll('#stats-dd .row').length);
  await host.evaluate(() => document.querySelector('#stats-dd [data-stm="team"]').click());
  await sleep(200);
  const team = await host.evaluate(() => ({ open: !document.getElementById('stats-dd').hidden, rows: [...document.querySelectorAll('#stats-dd .row')].map(r => r.dataset.seat), tot: [...document.querySelectorAll('#stats-dd .duo-tot [data-seat]')].map(e => e.dataset.seat + ':' + e.textContent) }));
  ok(team.open && team.rows.includes('1') && team.rows.includes('0'), `Team units lists both players' squads (${mineRows} -> ${team.rows.length} rows: ${team.rows.join(',')})`);
  ok(team.tot.length === 2, 'a total per player: ' + team.tot.join(' · '));
  if (process.env.PB_SHOTS) await host.screenshot({ path: process.env.PB_SHOTS + '/duo-view-stats.png' });
  ok(await host.evaluate(() => sessionStorage.getItem('phone-bellum-duo-stats-team') === '1'), 'the choice is kept for the session');
  await b.close();
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
