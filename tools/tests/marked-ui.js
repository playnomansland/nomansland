// "You are marked" (2026-11-05): a squad marked by the opponent (Mark Bounty, a Hunter's mark) says so in its sheet,
// with a short line and more on press-and-hold; the squad you marked says "Marked by you". A mark placed this round
// stays hidden from its target until the fight. Needs python3 -m http.server 8760 at the repo root.
const { chromium } = require('playwright-core');
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const p = await (await ctx2d(b, { viewport: { width: 390, height: 844 } })).newPage();
  p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
  await p.goto('http://127.0.0.1:8760/?test'); await sleep(800);
  await p.waitForSelector('#go', { timeout: 30000 });
  await p.click('#go'); await sleep(1500);
  await p.dblclick('[data-pack="0"]'); await sleep(500);
  // round 3: both towers are Sniper towers; a Brute of ours and a Goblin Swarm of theirs from an earlier round
  const ids = await p.evaluate(() => {
    const { m, me } = window.__pb(), fo = 1 - me, br = m.units.findIndex(u => u.name === 'Brute'), gs = m.units.findIndex(u => u.name === 'Goblin Swarm');
    m.round = Game.TOWER_PICK_ROUND; m.towers[me].type = 'sniper'; m.towers[fo].type = 'sniper';
    m.gold = [3000, 3000]; m.unlocks[me][br] = 1; m.unlocks[fo][gs] = 1;
    m.armies[me] = []; m.armies[fo] = [];
    const a = Game.place(m, me, br, 3, Game.zoneRows(me)[2]), f = Game.place(m, fo, gs, 4, Game.zoneRows(fo)[2]);
    a.round = f.round = m.round - 1;
    // the opponent marks our Brute this round: hidden from us for now
    const placed = Game.placeMark(m, fo, a.id);
    return { a: a.id, f: f.id, ac: a.col, ar: a.row, fc: f.col, fr: f.row, cols: Game.COLS, rows: Game.ROWS, me, placed };
  });
  ok(ids.placed, 'the opponent placed Mark Bounty on our Brute');
  const tap = async (col, row) => {
    const bb = await p.locator('#board').boundingBox(), f = ids.me === 1;
    const c = f ? ids.cols - 1 - col : col, r = f ? ids.rows - 1 - row : row;
    await p.mouse.click(bb.x + (c + .5) * bb.width / ids.cols, bb.y + (r + .5) * bb.height / ids.rows);
  };
  const close = async () => { await p.click('#sheet #close').catch(() => {}); await sleep(200); };
  await p.evaluate(() => window.__pb().render && window.__pb().render());
  await tap(ids.ac, ids.ar); await sleep(400);
  ok(await p.locator('#sheet').isVisible(), 'our Brute\'s sheet opened');
  ok(await p.locator('#sheet .up.marked').count() === 0, 'a mark placed this round: no box yet (not leaked)');
  await close();
  // the mark is from an earlier round now: the box shows, short text, the rest on hold
  await p.evaluate(() => { const { m, me } = window.__pb(); m.mark[1 - me].round = m.round - 1; });
  await tap(ids.ac, ids.ar); await sleep(400);
  const box = p.locator('#sheet .up.marked[data-mark="bounty"]');
  ok(await box.count() === 1, 'the box shows once the mark is known');
  ok(/You are marked/.test(await box.textContent()), 'titled "You are marked"');
  ok(!(await box.getAttribute('class')).includes('mine'), 'foe-coloured');
  ok(await box.locator('.up-s').isVisible() && /\+15% damage/.test(await box.locator('.up-s').textContent()), 'short text: +15% damage');
  ok(!(await box.locator('.up-more').isVisible()), 'more text hidden until held');
  await box.scrollIntoViewIfNeeded(); await sleep(200);
  const bb = await box.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + 12); await p.mouse.down(); await sleep(700); await p.mouse.up(); await sleep(200);
  ok(/open/.test(await box.getAttribute('class')), 'held: the box opens (' + await box.getAttribute('class') + ')');
  ok(await box.locator('.up-more').isVisible() && /\+100 gold/.test(await box.locator('.up-more').textContent()), 'held: the more text shows');
  await p.screenshot({ path: (process.argv[2] || 'marked-ui.png') });
  await close();
  // our own mark on their Goblin Swarm: "Marked by you", in gold, at once (it's ours)
  await p.evaluate((f) => { const { m, me } = window.__pb(); m.mark[me] = { squad: f, round: m.round }; }, ids.f);
  await tap(ids.fc, ids.fr); await sleep(400);
  const mine = p.locator('#sheet .up.marked.mine[data-mark="bounty"]');
  ok(await mine.count() === 1 && /Marked by you/.test(await mine.textContent()), 'their squad: "Marked by you"');
  ok(/Your units deal/.test(await mine.locator('.up-s').textContent()), 'worded from our side');
  ok(await p.locator('#sheet .up.marked:not(.mine)').count() === 0, 'no "You are marked" on their squad');
  await close();
  // a Hunter's mark on our Brute as well: two boxes. Their Sniper, awakened as a Hunter in an earlier round
  const hunt = await p.evaluate((a) => {
    const { m, me } = window.__pb(), fo = 1 - me, sn = m.units.findIndex(u => u.name === 'Sniper');
    m.unlocks[fo][sn] = 1;
    const h = Game.place(m, fo, sn, 6, Game.zoneRows(fo)[3]);
    h.round = m.round - 1;
    const k = m.units[sn].skills ? m.units[sn].skills.length : 0;
    for (let s = 0; s < 4; s++) Game.buySkill(m, fo, sn, s);
    const aw = Game.awaken(m, fo, h.id);
    const hunter = Game.isHunter(m, h);
    if (hunter) { h.awaken = m.round - 1; h.prey = { squad: a, round: m.round - 1 }; }
    return { aw, hunter, k };
  }, ids.a);
  ok(hunt.hunter, 'their Sniper is a Hunter (' + JSON.stringify(hunt) + ')');
  await tap(ids.ac, ids.ar); await sleep(400);
  ok(await p.locator('#sheet .up.marked').count() === 2, 'both marks: two boxes');
  const prey = p.locator('#sheet .up.marked[data-mark="prey"]');
  ok(await prey.count() === 1 && /Hunter Snipers go for this squad first/.test(await prey.textContent()), 'the Hunter box: ' + (await prey.count() ? (await prey.locator('.up-s').textContent()) : ''));
  await p.screenshot({ path: (process.argv[2] || 'marked-ui.png').replace('.png', '-two.png') });
  await close();
  // a Hunter's mark moved this round stays where it was for us: put it this round, it vanishes from our sheet
  await p.evaluate(() => { const { m, me } = window.__pb(); for (const h of m.armies[1 - me]) if (h.prey) { h.prey.round = m.round; delete h.prey.was; } });
  await tap(ids.ac, ids.ar); await sleep(400);
  ok(await p.locator('#sheet .up.marked[data-mark="prey"]').count() === 0, 'a Hunter\'s mark placed this round: hidden');
  await close();
  await b.close(); process.exit(bad ? 1 : 0);
})();
