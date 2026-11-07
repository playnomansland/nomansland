// GG, Replay a round in a server match, and My matches with replays (2026-11-04), on two phones (two accounts).
// Starts its own local server with accounts (server/test/accounts-env.js). Checks:
//  - a whole friend's match on the server, played by tapping; the match-over card has Say GG and Replay a round
//  - Say GG: the other phone shows "<name> said GG", the button turns into "GG sent"; the count reaches the account
//  - Replay a round in a server match comes back to the same match-over card
//  - (2026-11-07) while replaying a round, the opponent's GG and Rematch show at once (a banner and a line beside Back
//    to results); Replay a round is gone once you've asked for a rematch; a GG reaches a player on Look at board
//  - Profile → Match history → My matches: the match with the opponent's username; a round's Replay plays the fight
//    and comes back to the history
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/gg-history-ui.js
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const { chromium } = pw;
const assert = require('assert');
const { startAccounts } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 8 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8778, { ACCOUNT_TAG_FRESH_MS: 0 });
  const ORIGIN = 'http://127.0.0.1:8766';
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const A = await call('guest', { tag: 'Alpha' }), B = await call('guest', { tag: 'Bravo' });
  if (!A.player || !B.player) throw new Error('guest accounts: ' + JSON.stringify([A, B]));
  const exe = process.env.PB_CHROME;
  const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
  const errors = [];
  const mk = async (name, who) => {
    const ctx = await b.newContext({ viewport: { width: 400, height: 860 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(([acc]) => { try { localStorage.setItem('phonebellum.account.v1', JSON.stringify(acc)); localStorage.setItem('pb-stay', '1'); } catch (e) {} },
      [{ id: who.player.id, tag: who.player.tag, google: false, dev: false, titles: [], title: '', tagNext: 0, skins: [], discord: false, puzzles: [], session: who.session, ts: Date.now() }]);
    const p = await ctx.newPage();
    p.on('pageerror', e => { errors.push(`[${name}] ${e.message}`); console.log(`[${name}] PAGE ERROR`, e.message); });
    return p;
  };
  const BASE = `http://127.0.0.1:8766/?test&server=${srv.base}`;
  const host = await mk('host', A), guest = await mk('guest', B);
  const peek = (p) => p.evaluate(() => { const { m, me, phase } = window.__pb(); return { phase, me, round: m && m.round, over: m && m.over }; });
  try {
    await host.goto(BASE); await sleep(600);
    await host.click('#friend');
    await host.waitForFunction(() => /play=/.test(document.getElementById('link').textContent), null, { timeout: 15000 });
    const link = (await host.locator('#link').textContent()).trim();
    await guest.goto(link + '&test&server=' + srv.base);
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
    await host.click('#start');
    // play it out by tapping: package, the tower in round 3, Fight (ready), Next round
    for (let k = 0; k < 60; k++) {
      const [h, g] = [await peek(host), await peek(guest)];
      if (h.over && g.over && h.phase === 'end' && g.phase === 'end') break;
      for (const p of [host, guest]) {
        const s = await peek(p);
        if (s.phase !== 'deploy') continue;
        if (await p.locator('[data-pack]:visible').count() && await p.evaluate(() => { const { m, me } = window.__pb(); return Game.needsPack(m, me); })) { await p.locator('[data-pack]:visible').first().dblclick(); await sleep(300); }
        if (await p.evaluate(() => { const { m, me } = window.__pb(); return Game.needsTowerPick(m, me); })) { await p.locator('[data-opt]:visible').first().click(); await sleep(200); await p.getByRole('button', { name: 'Choose', exact: true }).click(); await sleep(300); }
        const f = p.locator('#ready:not([disabled])');
        if (await f.count() && !(await p.evaluate(() => window.__pb().ready[window.__pb().me]))) { await f.click(); await sleep(150); const cap = p.locator('#cap-go, #cap-fight'); if (await cap.count()) await cap.first().click(); }
      }
      await sleep(400);
      for (const p of [host, guest]) if (await p.locator('#next').count()) await p.click('#next').catch(() => {});
      await sleep(300);
    }
    const [h, g] = [await peek(host), await peek(guest)];
    if (!h.over) { await host.screenshot({ path: 'gg-stuck-host.png' }); await guest.screenshot({ path: 'gg-stuck-guest.png' }); console.log(await host.evaluate(() => { const { m, me } = window.__pb(); return JSON.stringify({ pack: Game.needsPack(m, me), army: m.armies[me].length, fight: document.getElementById('fight') && document.getElementById('fight').outerHTML }); })); }
    assert.ok(h.over && g.over && h.phase === 'end' && g.phase === 'end', `both at the end: ${JSON.stringify([h, g])}`);
    for (const p of [host, guest]) {
      assert.strictEqual(await p.locator('#overlay #gg').count(), 1, 'Say GG on the match-over card');
      assert.strictEqual(await p.locator('#overlay #replay').count(), 1, 'Replay a round on the match-over card');
    }
    await host.screenshot({ path: 'gg-before.png' });
    // the guest replays round 1 of the server match
    await guest.click('#overlay #replay'); await sleep(300);
    await guest.click('#sheet .rgrid [data-r="1"]'); await sleep(500);
    assert.strictEqual((await peek(guest)).phase, 'deploy', 'replaying round 1');
    // GG from the host: the replaying guest is told at once (2026-11-07)
    await host.click('#overlay #gg');
    await guest.waitForFunction(() => /Alpha said GG/.test(document.getElementById('banner').innerText) && /Alpha said GG/.test(document.getElementById('panel').innerText), null, { timeout: 8000 });
    await host.waitForFunction(() => /GG sent/.test(document.getElementById('overlay').innerText), null, { timeout: 8000 }); // once the server has it
    assert.ok(await host.locator('#overlay #gg[disabled]').count(), 'GG sent');
    await guest.screenshot({ path: 'gg-got.png' });
    const meB = await (async () => { for (let i = 0; i < 20; i++) { const x = await call('me', {}, B.session); if (x.player.gg === 1) return x; await sleep(300); } return null; })();
    assert.ok(meB, 'counted on Bravo\'s account');
    // the host asks for a rematch: the replaying guest sees it beside Back to results; the host has no Replay a round now
    await host.click('#overlay #again');
    await guest.waitForFunction(() => /Alpha wants a rematch/.test(document.getElementById('panel').innerText), null, { timeout: 8000 });
    assert.strictEqual((await peek(guest)).phase, 'deploy', 'still replaying (no auto-exit)');
    await host.waitForFunction(() => /Waiting for opponent/.test(document.getElementById('overlay').innerText), null, { timeout: 8000 });
    assert.strictEqual(await host.locator('#overlay #replay').count(), 0, 'no Replay a round once you asked for the rematch');
    assert.strictEqual(await host.locator('#overlay #look').count(), 1, 'Look at board in its place');
    await guest.screenshot({ path: 'gg-replay-notice.png' });
    await guest.click('#sbx-back'); await sleep(400);
    const g2 = await peek(guest);
    assert.ok(g2.phase === 'end' && g2.over, 'back at the end of the server match');
    const card = (await guest.locator('#overlay').innerText());
    assert.ok(/Alpha said GG/.test(card), 'with the GG still there');
    assert.ok(/Your opponent wants a rematch/.test(card), 'and the rematch asked');
    // a GG reaches the host on Look at board: a banner and the line in the panel
    await host.click('#overlay #look'); await sleep(300);
    await guest.click('#overlay #gg');
    await host.waitForFunction(() => /Bravo said GG/.test(document.getElementById('banner').innerText) && /Bravo said GG/.test(document.getElementById('panel').innerText), null, { timeout: 8000 });
    assert.ok(await host.locator('#overlay').evaluate(e => e.hidden), 'still looking at the board');
    await host.click('#end-back'); await sleep(200);
    // My matches
    await guest.click('#overlay #menu'); await sleep(600);
    await guest.click('#acct-open'); await sleep(400);
    await guest.click('#hist-open'); await sleep(200);
    await guest.waitForSelector('#hist .hm', { timeout: 10000 }).catch(async (e) => { console.log('history sheet:', (await guest.locator('#sheet').innerText()).replace(/\s+/g, ' ').slice(0, 300)); console.log('server says', JSON.stringify(await call('history', {}, B.session)).slice(0, 300)); await guest.screenshot({ path: 'history-fail.png' }); throw e; });
    const hm = (await guest.locator('#hist .hm').first().innerText()).replace(/\s+/g, ' ');
    assert.ok(/vs Alpha/.test(hm) && /(Victory|Defeat|Draw)/.test(hm) && /rounds?/.test(hm), hm.slice(0, 300));
    await guest.locator('#hist .hm details summary').first().click(); await sleep(200);
    await guest.screenshot({ path: 'history-mine.png' });
    await guest.locator('#hist [data-replay]').first().click();
    for (let t = 0; t < 60 && !/Replay · round 1/i.test(await guest.locator('#overlay').innerText()); t++) await sleep(250);
    assert.ok(/Replay · round 1/i.test(await guest.locator('#overlay').innerText()), 'the replay played');
    await guest.screenshot({ path: 'history-replay.png' });
    await guest.click('#rp-back'); await sleep(500);
    await guest.waitForSelector('#hist .hm', { timeout: 10000 });
    assert.deepStrictEqual(errors, [], 'no page errors');
    console.log('gg-history-ui: GG shown and counted, Replay a round in a server match, My matches and its replays: ok');
  } finally { await b.close(); srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
