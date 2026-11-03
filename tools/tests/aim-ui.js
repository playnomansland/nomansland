// Direction arrows on the page (vs AI, on the 2D and the 3D board, a PC window): a melee squad's sheet has Set
// direction (a ranged one's doesn't); then a tap on a tile sets the end (cut down to Game.AIM.maxTiles), a drag out of
// the squad does too; the arrow shows on the board; the sheet says what it does; Clear direction takes it away; the
// fight's bodies walk it. Screenshots go to the current folder.
// Run from the repo root with the game served on port 8766: node tools/tests/aim-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const ctx2d = require('./board2d');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const exe = process.env.PB_CHROME; // (the default browser otherwise)
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const errors = [];
  for (const board of ['2d', '3d']) {
    const p = await (await ctx2d(b, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })).newPage();
    p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`); await sleep(board === '3d' ? 1500 : 500);
    await p.click('#go'); await sleep(1500);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    const ids = await p.evaluate(() => {
      const { m, me } = window.__pb(), foe = 1 - me, ix = (n) => m.units.findIndex(u => u.name === n);
      m.round = 2; m.gold[me] = 5000; m.gold[foe] = 5000; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys;
      m.armies = [[], []]; m.chars = [null, null];
      for (const n of ['Brute', 'Sniper', 'Ether Golem']) { m.unlocks[me][ix(n)] = 1; m.unlocks[foe][ix(n)] = 1; }
      const row = Game.zoneRows(me)[1], frow = Game.zoneRows(foe)[1], fwd = me === 0 ? -1 : 1;
      const br = Game.place(m, me, ix('Brute'), 3, row), sn = Game.place(m, me, ix('Sniper'), 8, row);
      const eg = Game.place(m, foe, ix('Ether Golem'), 3, frow); eg.round = 1;
      return { br: br.id, sn: sn.id, row, fwd, me, cols: Game.COLS, rows: Game.ROWS };
    });
    // model tile -> screen point on either board
    const at = (c, r) => board === '2d'
      ? p.locator('#board').boundingBox().then(bb => { const f = ids.me === 1, sc = f ? ids.cols - 1 - c : c, sr = f ? ids.rows - 1 - r : r; return [bb.x + (sc + .5) * bb.width / ids.cols, bb.y + (sr + .5) * bb.height / ids.rows]; })
      : p.evaluate(([c, r]) => window.__pb().board3d.screenAt(c, r, 0), [c, r]);
    const tap = async (c, r) => { const [x, y] = await at(c, r); await p.mouse.click(x, y); await sleep(350); };
    const sq = (id) => p.evaluate((id) => { const { m, me } = window.__pb(); const s = m.armies[me].find(q => q.id === id); return s ? { aim: s.aim || null } : null; }, id);
    const close = async () => { await p.click('#sheet #close').catch(() => {}); await sleep(250); };
    // a ranged squad: no button
    await tap(8, ids.row);
    assert.ok(await p.locator('#sheet [data-act="aim"]').count() === 0, 'no Set direction for a Sniper');
    await close();
    // the Brute: Set direction, then a tap far ahead: cut down to the most
    await tap(3, ids.row);
    if (!await p.locator('#sheet [data-act="aim"]').count()) { await p.screenshot({ path: `aim-${board}-fail.png` }); console.log((await p.locator('#sheet').innerText().catch(() => '(no sheet)')).slice(0, 400)); }
    assert.ok(await p.locator('#sheet [data-act="aim"]').count() === 1, 'Set direction for a Brute');
    await p.click('#sheet [data-act="aim"]'); await sleep(300);
    const hint = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    assert.ok(/Direction: tap where it walks first/.test(hint), 'the task line says what to do');
    await tap(3, ids.row + ids.fwd * 9);
    let s = await sq(ids.br);
    assert.deepStrictEqual(s.aim, { dc: 0, dr: ids.fwd * 5 }, `cut down to 5 tiles: ${JSON.stringify(s.aim)}`);
    await p.screenshot({ path: `aim-${board}-tap.png` });
    // the sheet says it, and offers Change / Clear
    await tap(3, ids.row);
    let sheet = (await p.locator('#sheet').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Direction: walks its arrow first/.test(sheet) && /Change direction/.test(sheet) && /Clear direction/.test(sheet), sheet.slice(0, 300));
    // Change direction by dragging out of the squad: 3 tiles sideways
    await p.click('#sheet [data-act="aim"]'); await sleep(300);
    const [x0, y0] = await at(3, ids.row), [x1, y1] = await at(6, ids.row + ids.fwd * 2);
    await p.mouse.move(x0, y0); await p.mouse.down(); await sleep(80);
    for (let k = 1; k <= 8; k++) { await p.mouse.move(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await sleep(30); }
    await p.mouse.up(); await sleep(400);
    s = await sq(ids.br);
    assert.deepStrictEqual(s.aim, { dc: 3, dr: ids.fwd * 2 }, `dragged: ${JSON.stringify(s.aim)}`);
    const moved = await p.evaluate((id) => { const { m, me } = window.__pb(); const q = m.armies[me].find(z => z.id === id); return [q.col, q.row]; }, ids.br);
    assert.deepStrictEqual(moved, [3, ids.row], 'dragging the arrow does not move the squad');
    await p.screenshot({ path: `aim-${board}-drag.png` });
    // the fight: its bodies walk the arrow before they look for the Golem
    const walk = await p.evaluate((id) => {
      const { m, me } = window.__pb(), mm = { ...JSON.parse(JSON.stringify({ ...m, units: null, matrix: null })), units: m.units, matrix: m.matrix };
      const bt = Game.startBattle(mm), mine = bt.bodies.filter(x => x.side === me && x.squad === id);
      const x0 = mine.map(x => x.x); let early = false;
      for (let k = 0; k < 300 && mine.some(x => x.guide); k++) { bt.step(); if (mine.some(x => x.guide && x.intent)) early = true; }
      return { guided: mine.every(x => !x.guide), early, dx: mine.map((x, k) => x.x - x0[k]) };
    }, ids.br);
    assert.ok(walk.guided && !walk.early, JSON.stringify(walk));
    // Clear direction
    await tap(3, ids.row);
    await p.click('#sheet [data-act="unaim"]'); await sleep(300);
    s = await sq(ids.br);
    assert.strictEqual(s.aim, null, 'cleared');
    console.log(board, 'ok', JSON.stringify(walk.dx.map(d => +d.toFixed(1))));
    await p.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, []);
  console.log('aim-ui ok');
})().catch(e => { console.error(e); process.exit(1); });
