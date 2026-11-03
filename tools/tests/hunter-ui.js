// Hunter (2026-11-03): an awakened Sniper's sheet places a mark on an enemy squad (tap it), the crosshair shows,
// Undo mark takes it back. Needs python3 -m http.server 8766 at the repo root.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
  await p.goto('http://127.0.0.1:8766/?test'); await sleep(800);
  await p.waitForSelector('#go', { timeout: 30000 });
  await p.click('#go'); await sleep(1500);
  await p.dblclick('[data-pack="0"]'); await sleep(500);
  // a Sniper squad of ours and a Brute of theirs from an earlier round; Deadeye bought, the Sniper awakened
  const ids = await p.evaluate(() => {
    const { m, me } = window.__pb(), sn = m.units.findIndex(u => u.name === 'Sniper'), br = m.units.findIndex(u => u.name === 'Brute');
    m.gold[me] = 3000; m.unlocks[me][sn] = 1; m.unlocks[1 - me][br] = 1; m.gold[1 - me] = 3000;
    m.armies[me] = []; m.armies[1 - me] = [];
    const zone = (sd) => Game.zoneRows(sd);
    const h = Game.place(m, me, sn, 3, zone(me)[2]);
    const f = Game.place(m, 1 - me, br, 4, zone(1 - me)[2]);
    for (const q of [h, f]) q.round = m.round - 1 >= 1 ? m.round - 1 : 0;
    Game.buySkill(m, me, sn, 1);
    const okA = Game.awaken(m, me, h.id);
    return { h: h.id, f: f.id, okA, hc: h.col, hr: h.row, fc: f.col, fr: f.row, cols: Game.COLS, rows: Game.ROWS, me };
  });
  ok(ids.okA, 'awakened');
  const tap = async (col, row) => {
    const bb = await p.locator('#board').boundingBox(), f = ids.me === 1;
    const c = f ? ids.cols - 1 - col : col, r = f ? ids.rows - 1 - row : row;
    await p.mouse.click(bb.x + (c + .5) * bb.width / ids.cols, bb.y + (r + .5) * bb.height / ids.rows);
  };
  await tap(ids.hc, ids.hr); await sleep(400);
  ok(await p.locator('[data-act="hunt"]').count() === 1, 'Place mark on the sheet');
  await p.click('[data-act="hunt"]'); await sleep(300);
  ok(/Hunter: tap an enemy squad/.test(await p.textContent('body')), 'hint shows');
  await tap(ids.fc, ids.fr); await sleep(400);
  const prey = await p.evaluate((id) => { const { m, me } = window.__pb(); return m.armies[me].find(q => q.id === id).prey; }, ids.h);
  ok(prey && prey.squad === ids.f, 'marked: ' + JSON.stringify(prey));
  ok(await p.locator('#marks .markx.hunt').count() === 1, 'crosshair drawn');
  await p.screenshot({ path: process.argv[2] || 'hunter-ui.png' });
  await tap(ids.hc, ids.hr); await sleep(400);
  ok(/Marks their Brute/.test(await p.textContent('#sheet')), 'sheet says what it marks');
  await p.click('[data-act="unhunt"]'); await sleep(300);
  ok(await p.evaluate((id) => { const { m, me } = window.__pb(); return !m.armies[me].find(q => q.id === id).prey; }, ids.h), 'Undo mark');
  // the water elemental in a fight: a Water Mage with the Master skill fights with no page errors
  const wm = await p.evaluate(() => {
    const { m, me } = window.__pb(), w = m.units.findIndex(u => u.name === 'Water Mage');
    m.unlocks[me][w] = 1; m.gold[me] = 3000;
    const sq = Game.place(m, me, w, 6, Game.zoneRows(me)[3]);
    return !!sq && Game.buySkill(m, me, w, 1) && Game.buySkill(m, me, w, 3);
  });
  ok(wm, 'Water Mage with Summon water elemental');
  await p.click('#sheet #close').catch(() => {});
  await p.click('#fight'); await sleep(300);
  if (await p.locator('#cap-go').count()) await p.click('#cap-go').catch(() => {});
  await sleep(6000);
  await p.screenshot({ path: (process.argv[2] || 'hunter-ui.png').replace('.png', '-fight.png') });
  ok(true, 'fight played');
  await b.close(); process.exit(bad ? 1 : 0);
})();
