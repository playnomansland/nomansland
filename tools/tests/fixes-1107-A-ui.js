// The 2026-11-07 group A fixes in the page, on the 2D and the 3D board (a vs-AI match with a 2v2 board state put in by
// hand, so no duo server is needed):
//  - A2: the out-of-action look (Mpb.resting: the team Factory, a shut Coal mine; a Cog Builder's Factory destroyed
//    and being rebuilt): drawn without errors, 3D look 'ruin'
//  - A1: the other lane's Factory (m.team.buildings) drawn on both boards; its read-only sheet
//  - A6: Read more on both Factory sheets, still open after the sheet is drawn again
// Needs the game served on port 8766 (PB_PORT redirects it). PB_SHOTS=dir saves screenshots.
const { chromium } = require('playwright-core');
const dock = require('./dock');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  let fails = 0, errs = 0;
  const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
  for (const board of ['2d', '3d']) {
    console.log(`--- ${board} board`);
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); fails++; errs++; });
    await p.goto(`http://127.0.0.1:8766/?test&board=${board}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await p.waitForSelector('#go', { timeout: 60000 });
    await p.click('#go');
    await p.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 30000 });
    await p.dblclick('[data-pack="0"]').catch(() => {}); await p.waitForTimeout(600);
    if (board === '3d') await p.waitForFunction(() => window.__pb && window.__pb().board3d, null, { timeout: 15000 });
    // a 2v2 board state by hand: the team Factory and a Coal mine out of action, your own Factory and your teammate's
    // both destroyed and being rebuilt
    const keys = await p.evaluate(() => {
      const { m, me } = window.__pb(), z = Game.zoneRows(me);
      Mpb.init(m, 0); m.duoLane = 0;
      const fa = Mpb.addRec(m, me, 'factory', 4, z[2]), cm = Mpb.addRec(m, me, 'coalMine', 8, z[2]); cm.parts.exit = { col: 8, row: Game.ROWS / 2 };
      fa.fell = cm.fell = 1;
      Mpb.resting = (mm, sd, rec) => !!rec && rec.kind !== 'vault'; // (as the round after they fell)
      m.buildings = [[], []]; m.buildings[me] = [{ id: 'factory', col: 12, row: z[3], round: 1, progress: 0.5, built: false, xp: 0, level: 0, fell: 1 },
        { id: 'altar', col: 20, row: z[3], round: 1, progress: 0.5, built: false, xp: 0, level: 0, fell: 1 }]; // (an Altar of Build being rebuilt: a plain scaffold, as on the 2D board)
      m.team = { half: 0, armies: [[], []], buildings: [[], []], tech: [null, null], sold: [[], []], horse: [{}, {}] };
      m.team.buildings[me] = [{ id: 'factory', col: 16, row: z[3], round: 1, built: false, progress: 0.5, level: 0, fell: 1 }];
      window.__pbRedraw();
      return { fa: fa.key, me };
    });
    await p.waitForTimeout(1200);
    check(errs === 0, 'drawn with no page errors');
    if (board === '3d') {
      const d = await p.evaluate(() => window.__pb().board3d.drawn().filter(x => x.building || /factory|coal/i.test(x.name || '')).map(x => [x.name, x.look]));
      check(d.filter(([, l]) => l === 'ruin').length >= 4, `3D: the four out of action drawn with the 'ruin' look (${JSON.stringify(d)})`);
      const alt = await p.evaluate(() => window.__pb().board3d.drawn().filter(x => x.building === 'altar').map(x => x.look));
      check(alt.length === 1 && alt[0] === 'glass', `3D: an Altar of Build being rebuilt is a plain scaffold, not 'ruin' (as 2D) (${JSON.stringify(alt)})`);
    }
    if (process.env.PB_SHOTS) { await dock.down(p); await p.screenshot({ path: `${process.env.PB_SHOTS}/fixes-A-${board}.png` }); }
    // A6: the team Factory's sheet, Read more open across a redraw (as after a buy)
    await p.evaluate((k) => { const { m } = window.__pb(); m.round = 2; window.__pbSheet(k.me, k.fa); m.round = 1; }, keys); await p.waitForTimeout(200); // (round 2: the round after it fell)
    const t1 = await p.locator('#sheet').innerText();
    check(/About its units/.test(t1) && /Read more|this round/.test(t1), 'the team Factory sheet has Read more');
    await p.click('#sheet [data-fac-learn="mpb"] summary'); await p.waitForTimeout(150);
    const ul = await p.locator('#sheet [data-fac-learn="mpb"] ul').innerText();
    check(/this round’s fight only/.test(ul) && /2 s/.test(ul) && /4 s/.test(ul) && /no damage to the losers’ Team HP/.test(ul) && /no leader/.test(ul), 'its bullets: one fight, 2 s / 4 s, no Team HP damage, no leader');
    check(/being rebuilt this round/.test(t1), 'and the rebuilt-this-round line');
    await p.evaluate((k) => window.__pbSheet(k.me, k.fa), keys); await p.waitForTimeout(150);
    check(await p.locator('#sheet [data-fac-learn="mpb"]').evaluate(d => d.open), 'still open after the sheet is drawn again');
    await p.click('#sheet #close');
    // A1: the teammate's Factory: read only, being rebuilt; Read more for a Cog Builder's Factory
    await p.evaluate((k) => window.__pbTeamBSheet(k.me, window.__pb().m.team.buildings[k.me][0]), keys); await p.waitForTimeout(150);
    const h = await p.locator('#sheet-h').innerText(), t2 = await p.locator('#sheet').innerText();
    check(/Your teammate’s Factory · destroyed in round 1’s fight, being rebuilt \(50% built\)/.test(h), `the teammate's Factory sheet (${h})`);
    check(!(await p.locator('#sheet [data-bskill]').count()) && /About its units/.test(t2), 'read only, with Read more');
    await p.click('#sheet [data-fac-learn="cog"] summary'); await p.waitForTimeout(100);
    const ul2 = await p.locator('#sheet [data-fac-learn="cog"] ul').innerText();
    check(/2 s/.test(ul2) && /half built/.test(ul2) && /level with the Factory/.test(ul2), 'the Cog Builder Factory’s own Read more (walk-out, rebuild, levels)');
    await p.click('#sheet #close');
  }
  await b.close();
  if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
  console.log('\nall fixes-1107 group A page checks passed');
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
