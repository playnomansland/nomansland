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
  // a phone (390 x 844, touch, the 2D board): the task line sits over the far end of the board, so a far tap lands on
  // it; it must reach the tile under it (only its X cancels). A drag out of the squad with a finger sets the arrow
  // without moving the squad, scrolling the page or folding the tray.
  {
    const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
    p.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
    const cdp = await p.context().newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1 })) });
    const tapXY = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(400); };
    await p.goto('http://127.0.0.1:8766/?test'); await sleep(500);
    await p.click('[data-tm="0"]').catch(() => {}); // no deploy clock
    await p.click('#go'); await sleep(1500);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    const ids = await p.evaluate(() => {
      const { m, me } = window.__pb(), foe = 1 - me, ix = (n) => m.units.findIndex(u => u.name === n);
      m.round = 2; m.gold[me] = 5000; m.gold[foe] = 5000; m.armies = [[], []]; m.chars = [null, null];
      m.unlocks[me][ix('Brute')] = 1;
      const row = Game.zoneRows(me)[1], fwd = me === 0 ? -1 : 1, br = Game.place(m, me, ix('Brute'), 3, row);
      window.__pbRedraw();
      return { br: br.id, row, fwd, me, cols: Game.COLS, rows: Game.ROWS };
    });
    const at = (c, r) => p.locator('#board').boundingBox().then(bb => { const f = ids.me === 1, sc = f ? ids.cols - 1 - c : c, sr = f ? ids.rows - 1 - r : r; return [bb.x + (sc + .5) * bb.width / ids.cols, bb.y + (sr + .5) * bb.height / ids.rows]; });
    const tap = async (c, r) => { const [x, y] = await at(c, r); await tapXY(x, y); };
    const tapEl = async (sel) => { const bb = await p.locator(sel).boundingBox(); await tapXY(bb.x + bb.width / 2, bb.y + bb.height / 2); };
    const st = () => p.evaluate((id) => { const { m, me } = window.__pb(), s = m.armies[me].find(q => q.id === id), t = document.getElementById('task');
      return { pos: [s.col, s.row], aim: s.aim || null, scrollY, panel: document.getElementById('panel').className, task: !t.hidden }; }, ids.br);
    const aimOn = async () => { await tap(3, ids.row); await tapEl('#sheet [data-act="aim"]'); await sleep(300); assert.ok((await st()).task, 'the task line shows'); };
    // the X cancels
    await aimOn();
    const tb = await p.locator('#task-x').boundingBox();
    await tapXY(tb.x + tb.width / 2, tb.y + tb.height / 2);
    assert.ok(!(await st()).task && (await st()).aim === null, 'the X cancels');
    // a far tap on the task line: it reaches the tile under it, the arrow cut down to its most
    await aimOn();
    const tr = await p.locator('#task').boundingBox(), fx = tr.x + 30, fy = tr.y + tr.height / 2; // on the task line's text, over the far tiles
    await tapXY(fx, fy);
    const fa = (await st()).aim;
    assert.ok(fa && fa.dc * fa.dc + fa.dr * fa.dr <= 25 && Math.sign(fa.dr) === ids.fwd && !(await st()).task, `a tap on the task line sets the arrow (cut down): ${JSON.stringify(fa)}`);
    // a finger drag out of the squad
    await aimOn();
    const s0 = await st(), [x0, y0] = await at(3, ids.row), [x1, y1] = await at(6, ids.row + ids.fwd * 2);
    await touch('touchStart', [[x0, y0]]); await sleep(60);
    for (let k = 1; k <= 10; k++) { await touch('touchMove', [[x0 + (x1 - x0) * k / 10, y0 + (y1 - y0) * k / 10]]); await sleep(30); }
    await touch('touchEnd', []); await sleep(500);
    const s1 = await st();
    assert.deepStrictEqual(s1.aim, { dc: 3, dr: ids.fwd * 2 }, `finger drag: ${JSON.stringify(s1.aim)}`);
    assert.deepStrictEqual(s1.pos, s0.pos, 'the squad stays');
    assert.strictEqual(s1.scrollY, s0.scrollY, 'no scroll');
    assert.strictEqual(s1.panel, s0.panel, 'the tray stays as it was');
    console.log('phone ok');
    await p.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, []);
  console.log('aim-ui ok');
})().catch(e => { console.error(e); process.exit(1); });
