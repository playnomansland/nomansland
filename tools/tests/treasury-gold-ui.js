// The gold a destroyed treasury hands over, shown over the treasury while the fight plays (2026-11-04).
// A match vs the bot on Standard (which has treasuries): once the fight is on, both treasuries are knocked out and
// the raid this fight worked out is set, so the page has to show
//   "+150 gold" in gold over the opponent's treasury (you take it) and "−100 gold" in red over your own (they take it).
// Checks the effect the page makes (fx kind 'gold': the text, which side's it is, where it is), that it fades by
// itself, that nothing is shown when there is nothing to take, and that the text really appears on both boards: as
// gold pixels over the treasury on the 2D board, and as the text overlay on the 3D board.
// Run from the repo root with the game served on port 8766 (python3 -m http.server 8766):
//   node tools/tests/treasury-gold-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();

const URL = 'http://127.0.0.1:8766/?test';

// a match vs the bot, fighting round 1, on the 2D or the 3D board
async function toBattle(b, board) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.addInitScript((v) => { try { localStorage.setItem('phone-bellum-board', v); } catch (e) {} }, board);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { console.log(`[${board}] PAGE ERROR`, e.message); bad++; });
  await p.goto(URL);
  await p.waitForSelector('#go');
  await p.click('#go');
  await p.waitForFunction(() => window.__pb().phase === 'draft' || window.__pb().phase === 'deploy', null, { timeout: 20000 });
  if (await p.locator('[data-pack="0"]').count()) { await p.dblclick('[data-pack="0"]'); await sleep(400); }
  await p.waitForFunction(() => window.__pb().phase === 'deploy', null, { timeout: 20000 });
  if (board === '3d') await p.waitForFunction(() => !!window.__pb().board3d, null, { timeout: 30000 });
  await p.click('#fight');
  await p.waitForFunction(() => window.__pb().phase === 'battle', null, { timeout: 20000 });
  return p;
}

// knocks both treasuries out, with the raid this fight worked out (what the owner loses, [side 0, side 1])
const raid = (p, lost) => p.evaluate((lost) => {
  const s = window.__pb();
  s.summary.treasury = [{ gold: 0, lost: lost[0], stole: lost[1] }, { gold: 0, lost: lost[1], stole: lost[0] }];
  const out = [];
  for (const body of s.bt.bodies) {
    if (!body.u || body.u.kind !== 'treasury' || !body.alive) continue;
    body.hp = 0; body.alive = false;
    out.push({ side: body.side, x: body.x, y: body.y });
  }
  return { me: s.me, hit: out };
}, lost);
const goldFx = (p) => p.evaluate(() => window.__pb().fx.filter(e => e.kind === 'gold').map(e => ({ text: e.text, mine: e.mine, x: e.x, y: e.y, age: e.age, life: e.life })));

(async () => {
  const b = await chromium.launch({ ...(process.env.PB_CHROME ? { executablePath: process.env.PB_CHROME } : {}) });
  try {
    // ----- the 2D board: the effect, and gold pixels over the opponent's treasury -----
    const p = await toBattle(b, '2d');
    const before = await goldFx(p);
    ok(before.length === 0, 'no gold text before a treasury falls');
    const { me, hit } = await raid(p, [100, 150]);
    ok(hit.length === 2, `both treasuries were standing (${hit.length} hit)`);
    await p.waitForFunction(() => window.__pb().fx.filter(e => e.kind === 'gold').length === 2, null, { timeout: 10000 });
    const fx = await goldFx(p);
    const mine = fx.find(e => e.mine), theirs = fx.find(e => !e.mine);
    ok(!!mine && mine.text === '−100 gold', `your own treasury: a minus in red (${mine && mine.text})`);
    ok(!!theirs && theirs.text === '+150 gold', `the opponent's: a plus in gold (${theirs && theirs.text})`);
    const spot = (sd) => hit.find(h => h.side === sd);
    ok(!!mine && Math.abs(mine.x - spot(me).x) < 0.01 && Math.abs(mine.y - spot(me).y) < 0.01, 'the text sits on the treasury it belongs to');
    ok(!!theirs && Math.abs(theirs.x - spot(1 - me).x) < 0.01, 'and on theirs');

    // the canvas: gold pixels above the opponent's treasury tile, gone once the text has faded
    const goldPx = () => p.evaluate(() => {
      const { m, me } = window.__pb(), cv = document.getElementById('board');
      const ts = Game.treasurySpot(m, 1 - me), f = me === 1;
      const col = f ? Game.COLS - 1 - ts.col : ts.col, row = f ? Game.ROWS - 1 - ts.row : ts.row;
      const t = cv.width / Game.COLS; // device pixels per tile
      const c = cv.getContext('2d');
      const w = Math.round(t * 5), h = Math.round(t * 2.2);
      const x = Math.max(0, Math.round((col + 0.5) * t - w / 2)), y = Math.max(0, Math.round((row - 2) * t));
      const d = c.getImageData(x, y, Math.min(w, cv.width - x), Math.min(h, cv.height - y)).data;
      const want = (Art.css('--gold') || '#D9B95B').trim();
      const hex = want.length === 7 ? [1, 3, 5].map(i => parseInt(want.slice(i, i + 2), 16)) : [217, 185, 91];
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - hex[0]) < 12 && Math.abs(d[i + 1] - hex[1]) < 12 && Math.abs(d[i + 2] - hex[2]) < 12) n++;
      return n;
    });
    const on = await goldPx();
    ok(on > 20, `the 2D board draws it over the treasury (${on} gold pixels)`);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/treasury-gold-2d.png` });
    await p.waitForFunction(() => !window.__pb().fx.some(e => e.kind === 'gold'), null, { timeout: 12000 });
    ok((await p.evaluate(() => window.__pb().phase)) === 'battle', 'it faded while the fight was still on');
    await sleep(200);
    const off = await goldPx();
    ok(off < Math.max(4, on / 8), `and it is gone when the text has faded (${off} left)`);
    await p.context().close();

    // ----- nothing to take (the owner had no gold left): no text -----
    const p0 = await toBattle(b, '2d');
    await raid(p0, [0, 0]);
    await sleep(600);
    ok((await goldFx(p0)).length === 0, 'nothing to take: no text');
    await p0.context().close();

    // ----- the 3D board: the same text in the overlay over the board -----
    const p3 = await toBattle(b, '3d');
    await raid(p3, [100, 150]);
    await p3.waitForFunction(() => window.__pb().fx.filter(e => e.kind === 'gold').length === 2, null, { timeout: 10000 });
    await sleep(300);
    const seen = await p3.evaluate(() => {
      const el = document.querySelector('.board3d');
      const divs = [...el.querySelectorAll('div')].map(d => ({ text: d.textContent, color: d.style.color, left: d.style.left, top: d.style.top }));
      return { divs: divs.filter(d => /gold$/.test(d.text)), gold: Art.css('--gold'), foe: Art.css('--foe') };
    });
    const g3 = seen.divs.find(d => d.text === '+150 gold'), m3 = seen.divs.find(d => d.text === '−100 gold');
    ok(!!g3, `the 3D board shows the plus (${JSON.stringify(seen.divs)})`);
    ok(!!m3, 'and the minus');
    // the browser reports the colour as rgb(...), the CSS variable is a hex
    const rgb = (v) => { const h = String(v).trim(); return h.length === 7 ? `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})` : h; };
    const near = (a, want) => !!a && String(a).trim() === rgb(want);
    ok(g3 && near(g3.color, seen.gold), `the plus is gold (${g3 && g3.color})`);
    ok(m3 && near(m3.color, seen.foe), `the minus is red (${m3 && m3.color})`);
    ok(!!g3 && /px$/.test(g3.left) && /px$/.test(g3.top), 'placed over the board, not in a corner');
    if (process.env.SHOTS) await p3.screenshot({ path: `${process.env.SHOTS}/treasury-gold-3d.png` });
    await p3.context().close();
  } finally {
    await b.close();
  }
  console.log(bad ? `${bad} FAILED` : 'treasury gold text ok');
  process.exit(bad ? 1 : 0);
})();
