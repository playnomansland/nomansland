// The leader draft on the page, vs the AI (2026-11-05): round 1 has no leader; after the first fight the pick panel
// shows the shared pool; the winner of round 1 picks first; the AI never takes the same leader; the deploy clock waits.
// (2026-11-07) The round 1 start card and the round 1 result card say what winning round 1 is worth.
// Run from the repo root with the game served on port 8766 (python3 -m http.server 8766):
//   node tools/tests/leader-draft-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();
const URL = 'http://127.0.0.1:8766/?test';

(async () => {
  const b = await chromium.launch({ ...(process.env.PB_CHROME ? { executablePath: process.env.PB_CHROME } : {}) });
  let firsts = { me: 0, ai: 0 };
  try {
    for (let run = 0; run < 6 && (firsts.me === 0 || firsts.ai === 0); run++) { // until both orders have come up (who wins round 1 varies)
      const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
      await ctx.addInitScript(() => { try { localStorage.setItem('phone-bellum-board', '2d'); } catch (e) {} });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); bad++; });
      await p.goto(URL);
      await p.waitForSelector('#go');
      await p.click('#go');
      await p.waitForFunction(() => window.__pb().phase === 'deploy', null, { timeout: 20000 });
      if (run === 0) ok(/Win this round: you pick your leader first in round 2/.test(await p.locator('#pick').innerText()), 'the round 1 start card says what winning it is worth');
      if (await p.locator('[data-pack="0"]').count()) { await p.dblclick('[data-pack="0"]'); await sleep(300); }
      const r1 = await p.evaluate(() => ({ chars: window.__pb().m.chars, pack: window.__pb().m.packages[0].map(x => x.char) }));
      ok(!r1.chars[0] && !r1.chars[1] && r1.pack.every(c => !c), 'round 1: no leaders, packages without one');
      if (run % 2) await p.evaluate(() => { window.__pb().m.armies[1] = []; }); // win round 1: the AI's round 1 army goes
      await p.click('#fight');
      await p.waitForFunction(() => window.__pb().phase === 'battle' || window.__pb().phase === 'result', null, { timeout: 20000 });
      await p.evaluate(() => { const s = window.__pb(); if (s.bt) while (s.bt.step()) {} });
      // on to round 2
      let r1card = '';
      for (let k = 0; k < 60; k++) {
        const st = await p.evaluate(() => ({ phase: window.__pb().phase, round: window.__pb().m.round }));
        if (st.phase === 'deploy' && st.round === 2) break;
        if (st.phase === 'result' && !r1card) r1card = await p.locator('#overlay').innerText();
        const nx = p.locator('#next, #res-next, [data-act="next"]');
        if (await nx.count()) { try { await nx.first().click({ timeout: 500 }); } catch (e) {} }
        await sleep(500);
      }
      const s2 = await p.evaluate(() => { const { m } = window.__pb(); return { round: m.round, first: Game.draftFirst(m), winner: m.history[0].winner, chars: m.chars.slice(), pool: m.draft.pool.slice() }; });
      ok(s2.round === 2, 'round 2');
      if (s2.round !== 2) { await ctx.close(); continue; }
      ok(s2.winner < 0 || s2.first === s2.winner, `the winner of round 1 picks first (winner ${s2.winner}, first ${s2.first})`);
      const want = s2.winner === 0 ? /you pick your leader first in round 2/ : s2.winner === 1 ? /they pick their leader first in round 2/ : /coin flip decides who picks a leader first/;
      ok(want.test(r1card), `the round 1 result card says who picks first (winner ${s2.winner}): ${(r1card.match(/[^.]*(leader|coin flip)[^.]*/) || [''])[0].trim()}`);
      await p.waitForSelector('[data-leader]', { timeout: 5000 });
      ok(await p.locator('[data-leader]').count() === s2.pool.length, `the pick panel shows the ${s2.pool.length} leaders`);
      if (s2.first === 1) {
        firsts.ai++;
        ok(!!s2.chars[1], 'the AI picked first');
        ok(await p.locator(`[data-leader="${s2.chars[1]}"][disabled]`).count() === 1, 'its leader is taken on my panel');
      } else {
        firsts.me++;
        ok(!s2.chars[1], 'the AI waits for my pick');
      }
      const clockHeld = await p.evaluate(() => window.__pb().m && document.getElementById('clock').textContent);
      const mine = s2.pool.find(id => id !== s2.chars[1]);
      await p.click(`[data-leader="${mine}"]`); await p.click('#pick-go');
      await sleep(300);
      const s3 = await p.evaluate(() => ({ chars: window.__pb().m.chars.slice(), panel: !document.getElementById('pick').hidden }));
      ok(s3.chars[0] === mine, 'my pick');
      ok(!!s3.chars[1] && s3.chars[1] !== s3.chars[0], `the AI has a different leader (${s3.chars[1]})`);
      ok(!s3.panel, 'the panel is gone');
      await ctx.close();
    }
    ok(firsts.me > 0, `I picked first at least once (${firsts.me})`);
    console.log(`      the AI picked first ${firsts.ai} times`);
  } finally { await b.close(); }
  console.log(bad ? `${bad} failed` : 'leader draft ui ok');
  process.exit(bad ? 1 : 0);
})();
