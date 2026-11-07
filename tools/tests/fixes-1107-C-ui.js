// The 2026-11-07 deploy fixes (group C) on the page, vs AI, on the 2D and the 3D board (a PC window):
// - C1: an arrow's head dragged to a new end (no sheet), dropped on its own squad clears it; a squad of yours on the
//   head's tile wins (it is moved); on a flank tile the head goes at most Game.AIM.flank tiles.
// - C3: Bastion's free move: a drop within Game.MARCH.tiles is free, further is the paid move.
// - C4: the mouse over an enemy squad from an earlier round shows its ring; on the 3D board's tilted view also over
//   its model's body (above its tile).
// Run from the repo root with the game served on port 8766: node tools/tests/fixes-1107-C-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
(async () => {
  const exe = process.env.PB_CHROME;
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  for (const board of ['2d', '3d']) {
    const p = await (await ctx2d(b, { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })).newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; });
    await p.goto(`http://127.0.0.1:8766/?test${board === '3d' ? '&board=3d' : ''}`);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    await sleep(500);
    await p.click('[data-tm="0"]').catch(() => {}); // no deploy clock
    await p.click('#go'); await sleep(1500);
    await p.dblclick('[data-pack="0"]'); await sleep(300);
    const ids = await p.evaluate(() => {
      const { m, me } = window.__pb(), foe = 1 - me, ix = (n) => m.units.findIndex(u => u.name === n);
      m.round = 4; m.gold[me] = 5000; m.gold[foe] = 5000; m.extraDeploys[me] = Game.CONFIG.maxExtraDeploys; m.armies = [[], []]; m.chars = ['felix', 'felix']; // (leaders picked: no draft over the board)
      Game.ensureTower(m, me); Game.ensureTower(m, foe); m.towers[me].type = 'bastion'; m.towers[foe].type = 'sniper';
      for (const n of ['Brute', 'Sniper', 'Fire Mage']) { m.unlocks[me][ix(n)] = 1; m.unlocks[foe][ix(n)] = 1; }
      const row = Game.zoneRows(me)[1], fwd = me === 0 ? -1 : 1, put = (side, n, c, r, rd) => { const q = Game.place(m, side, ix(n), c, r); q.round = rd; return q; };
      const br = put(me, 'Brute', 3, row, 1), sn = put(me, 'Sniper', 6, row, 4), old = put(me, 'Fire Mage', 8, row, 1);
      const fl = { col: 0, row: Game.flankRows(me).slice(-1)[0] }, fb = { id: m.nextId[me]++, unit: ix('Brute'), col: fl.col, row: fl.row, round: 1, level: 0, xp: 0, cost: 0 }; m.armies[me].push(fb); // on a flank
      const frow = Game.zoneRows(foe)[2], en = { id: m.nextId[foe]++, unit: ix('Sniper'), col: 5, row: frow, round: 1, level: 0, xp: 0, cost: 0 }; m.armies[foe].push(en);
      Game.setAim(m, me, br.id, 0, 4 * fwd); Game.setAim(m, me, fb.id, 0, 3 * fwd);
      window.__pbRedraw();
      if (!Game.isFlank(me, fl.col, fl.row)) throw new Error('not a flank tile');
      return { br: br.id, sn: sn.id, old: old.id, fb: fb.id, fl, row, fwd, me, en: { col: en.col, row: en.row, r: Game.squadReach(m, foe, en, true) }, cols: Game.COLS, rows: Game.ROWS };
    });
    await sleep(400);
    const at = (c, r, h = 0) => board === '2d'
      ? p.locator('#board').boundingBox().then(bb => { const f = ids.me === 1, sc = f ? ids.cols - 1 - c : c, sr = f ? ids.rows - 1 - r : r; return [bb.x + (sc + .5) * bb.width / ids.cols, bb.y + (sr + .5) * bb.height / ids.rows]; })
      : p.evaluate(([c, r, h]) => window.__pb().board3d.screenAt(c, r, h), [c, r, h]);
    const drag = async (c0, r0, c1, r1) => {
      const [x0, y0] = await at(c0, r0), [x1, y1] = await at(c1, r1);
      await p.mouse.move(x0, y0); await p.mouse.down(); await sleep(80);
      for (let k = 1; k <= 8; k++) { await p.mouse.move(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await sleep(30); }
      await p.mouse.up(); await sleep(400);
    };
    const sq = (id) => p.evaluate((id) => { const { m, me } = window.__pb(), s = m.armies[me].find(q => q.id === id); return s ? { col: s.col, row: s.row, aim: s.aim || null, end: Game.aimEnd(m, s), gold: m.gold[me], moved: Game.movedId(m, me), luck: s.luckMove || 0 } : null; }, id);
    const sheetOpen = () => p.evaluate(() => !document.getElementById('sheet-back').hidden);
    // C1: the head of the Brute's arrow (4 tiles ahead) dragged 2 tiles sideways and 1 back
    let s = await sq(ids.br);
    await drag(3, ids.row + 4 * ids.fwd, 5, ids.row + 3 * ids.fwd);
    let s2 = await sq(ids.br);
    check(JSON.stringify(s2.aim) === JSON.stringify({ dc: 2, dr: 3 * ids.fwd }) && s2.col === 3 && s2.row === ids.row, `${board}: head dragged: ${JSON.stringify(s.aim)} -> ${JSON.stringify(s2.aim)}, the squad stays`);
    check(!(await sheetOpen()), `${board}: no sheet opened`);
    // dropped on its squad: cleared
    await drag(5, ids.row + 3 * ids.fwd, 3, ids.row);
    check((await sq(ids.br)).aim === null, `${board}: head dropped on its squad: no arrow`);
    // a squad of yours on the head's tile wins: the Sniper moves, the arrow stays
    await p.evaluate(([id, dc]) => { const { m, me } = window.__pb(); Game.setAim(m, me, id, dc, 0); window.__pbRedraw(); }, [ids.br, 3]);
    await sleep(300);
    await drag(6, ids.row, 6, ids.row + ids.fwd);
    const sn = await sq(ids.sn), b2 = await sq(ids.br);
    check(sn.row === ids.row + ids.fwd && JSON.stringify(b2.aim) === JSON.stringify({ dc: 3, dr: 0 }), `${board}: a squad on the head's tile is moved, not the arrow (${JSON.stringify(b2.aim)})`);
    // C2: the flank squad's head (cut to 1 tile) dragged far: still 1 tile
    const f0 = await sq(ids.fb);
    await drag(f0.end.col, f0.end.row, f0.col + 4, f0.row);
    const f1 = await sq(ids.fb);
    check(Math.max(Math.abs(f1.end.col - f1.col), Math.abs(f1.end.row - f1.row)) === 1 && f1.end.col === f1.col + 1, `${board}: on a flank the head goes 1 tile (${JSON.stringify(f0.end)} -> ${JSON.stringify(f1.end)}, stored ${JSON.stringify(f1.aim)})`);
    // C3: Bastion's March order: 2 tiles free, 3 tiles is the paid move
    const o0 = await sq(ids.old);
    await drag(8, ids.row, 10, ids.row - 2 * ids.fwd);
    const o1 = await sq(ids.old);
    check(o1.col === 10 && o1.gold === o0.gold && o1.luck > 0 && o1.moved == null, `${board}: March order, 2 tiles: free`);
    await drag(10, ids.row - 2 * ids.fwd, 5, ids.row);
    const o2 = await sq(ids.old);
    check(o2.col === 5 && o2.row === ids.row && o2.gold === o0.gold - 50 && o2.moved === ids.old && !o2.luck, `${board}: then 3 tiles from its start: the paid move`);
    await drag(5, ids.row, 9, ids.row - ids.fwd);
    const o3 = await sq(ids.old);
    check(o3.gold === o0.gold && o3.moved == null && o3.luck > 0, `${board}: back within reach: free again, refunded`);
    // C4: the mouse over an enemy squad from an earlier round: its ring
    const hoverRing = async (h) => { const [x, y] = await at(ids.en.col, ids.en.row, h); await p.mouse.move(x, y, { steps: 3 }); await sleep(400); return p.evaluate(() => document.querySelectorAll('#marks .range').length); };
    await p.mouse.move(5, 5); await sleep(200);
    check(await hoverRing(0) === 1, `${board}: hover over an enemy squad: its ring (${ids.en.r} m)`);
    if (board === '3d') {
      await p.mouse.move(5, 5);
      await p.evaluate(() => window.__pb().board3d.camera.setLevel(1)); await sleep(2500);
      // a point on the model's body whose ground behind it is another tile
      const h = await p.evaluate(([c, r]) => { const b3 = window.__pb().board3d; for (const h of [1, 1.5, 2, 2.5, 3, 3.5, 4]) { const [x, y] = b3.screenAt(c, r, h), g = b3.tileAt(x, y), k = b3.pickAt(x, y); if (g && (g.col !== c || g.row !== r) && k && k.col === c && k.row === r) return h; } return null; }, [ids.en.col, ids.en.row]);
      if (h == null) console.log('(3d tilted view: no point on the model over another tile; hover check skipped)');
      else check(await hoverRing(h) === 1, `3d (tilted view): hover over the enemy model's body, ${h} m up (the ground behind it is another tile): its ring`);
    }
    await p.screenshot({ path: `fixes-1107-C-${board}.png` });
    await p.close();
  }
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'fixes-1107-C-ui ok');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
