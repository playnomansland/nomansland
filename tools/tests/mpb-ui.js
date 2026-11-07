// 2v2 buildings in the browser (group F, docs/MPB-2V2.md): the Vault, the artifact draft and the placement vote.
//  - the Vault on the board; its sheet: put gold in (both lanes get it), the teammate's golem click shows as
//    "your teammate clicked it"; the opponent's sheet is read only and shows the vault as the round began
//  - round 2: the artifacts on the board; round 3: the draft in the deploy panel (cards to pick, or what each team got)
//  - a placement vote: glowing tiles, each player's vote in their colour, the same tile places it for both
// Needs: python3 -m http.server 8760 (repo root),
//        cd server && npx wrangler dev --port 8761 --var DUO_ANYONE:1 --var ALLOWED_ORIGINS:http://127.0.0.1:8760
// (PB_SHOTS=dir saves screenshots)
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('playwright'); }
const ctx2d = require('./board2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:8760/?server=http://127.0.0.1:8761&test';
const CHROME = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => require('fs').existsSync(f));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const DEV = { id: 'p0123456789abcdef', session: 'a'.repeat(64), tag: 'Vilhelm', dev: true, title: '' };
const shot = async (p, name) => { if (process.env.PB_SHOTS) await p.screenshot({ path: process.env.PB_SHOTS + '/mpb-' + name + '.png' }); };
(async () => {
  const b = await pw.chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const mk = async (n, acct) => {
    const c = await ctx2d(b, { viewport: { width: 1280, height: 860 } });
    if (acct) await c.addInitScript((a) => { try { localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); } catch (e) {} }, acct);
    await c.route('**/account/**', (r) => r.abort());
    const p = await c.newPage();
    p.on('pageerror', e => { console.log(`[${n}] PAGE ERROR`, e.message); fails++; });
    return p;
  };
  const waitPhase = (p, ph, ms = 30000) => p.waitForFunction((x) => document.getElementById('phase').textContent === x, ph, { timeout: ms });
  const tapTile = async (p, col, row) => {
    const bb = await p.locator('#board').boundingBox(), me = await p.evaluate(() => window.__pb().me), C = await p.evaluate(() => Game.COLS), R = await p.evaluate(() => Game.ROWS);
    const c = me === 1 ? C - 1 - col : col, r = me === 1 ? R - 1 - row : row;
    await p.mouse.click(bb.x + (c + 0.5) * bb.width / C, bb.y + (r + 0.5) * bb.height / R);
  };
  const sheetText = (p) => p.evaluate(() => document.getElementById('sheet-back').hidden ? '' : document.getElementById('sheet').textContent);
  const closeSheet = (p) => p.evaluate(() => { const c = document.getElementById('close'); if (c) c.click(); });
  const fold = (p) => p.evaluate(() => { const d = document.getElementById('dock-toggle'); if (document.documentElement.classList.contains('dock') && d && !document.documentElement.classList.contains('dock-down')) d.click(); });

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
  const all = [host, mate, foe];
  for (const p of all) await waitPhase(p, 'Deploy');
  for (const p of all) await p.dblclick('[data-pack="0"]');
  await sleep(800);
  ok(await host.evaluate(() => { const { m } = window.__pb(); return Mpb.recs(m, 0)[0].kind === 'vault' && Mpb.recs(m, 1)[0].kind === 'vault'; }), 'both Vaults on the board');
  for (const p of all) await fold(p);
  await shot(host, 'deploy-r1');

  // the Vault sheet: put 50 in
  await tapTile(host, 6, 16);
  await host.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  let t = await sheetText(host);
  ok(/Your team’s Vault/.test(t) && /Compound interest/.test(t) && /Coin golem/.test(t), 'the host opens the Vault sheet');
  ok(await host.evaluate(() => !!document.getElementById('mpb-put') && !document.getElementById('mpb-put').disabled), 'Put in is there');
  await shot(host, 'vault-sheet');
  await host.click('#mpb-put');
  await sleep(600);
  ok(await mate.waitForFunction(() => window.__pb().m.vault[0].gold === 50, null, { timeout: 8000 }).then(() => true, () => false), 'the teammate sees 50 gold in the Vault');
  ok(await foe.evaluate(() => window.__pb().m.vault[0].gold === 0), 'the opponent still sees the Vault as the round began');
  await closeSheet(host);
  // the teammate clicks Coin golem: the host's sheet says so
  await tapTile(mate, 6, 16);
  await mate.waitForFunction(() => !!document.querySelector('[data-mpb-buy="golem"]'), null, { timeout: 5000 }).catch(() => {});
  await mate.click('[data-mpb-buy="golem"]');
  await sleep(800);
  await closeSheet(mate);
  await tapTile(host, 6, 16);
  await host.waitForFunction(() => /your teammate clicked it/i.test(document.getElementById('sheet').textContent), null, { timeout: 8000 }).catch(() => {});
  t = await sheetText(host);
  ok(/your teammate clicked it/i.test(t), 'the host sees the teammate\'s golem click');
  await shot(host, 'vault-golem');
  await closeSheet(host);
  // the opponent's view of it: read only
  await tapTile(foe, 6, 16);
  await foe.waitForFunction(() => !document.getElementById('sheet-back').hidden, null, { timeout: 5000 }).catch(() => {});
  t = await sheetText(foe);
  ok(/Their team’s Vault/.test(t) && !(await foe.evaluate(() => !!document.querySelector('[data-mpb-buy]:not([disabled])'))), 'the opponent\'s sheet is read only');
  ok(/0 gold inside/.test(t), 'and shows no gold moved this round');
  await shot(foe, 'vault-foe');
  await closeSheet(foe);

  // to round 3: fights played at once
  const fightRound = async () => {
    for (const p of all) await p.click('#ready');
    for (const p of all) await waitPhase(p, 'Battle', 30000);
    for (const p of all) await p.evaluate(() => { const x = window.__pb(); while (x.bt.step()) {} });
    for (const p of all) await waitPhase(p, 'Result', 30000);
    await sleep(500);
    for (const p of all) await p.evaluate(() => { const n = document.getElementById('next'); if (n) n.click(); });
    for (const p of all) await waitPhase(p, 'Deploy', 30000);
    await sleep(800);
    for (const p of all) await fold(p);
  };
  await fightRound();
  ok(await host.evaluate(() => { const { m } = window.__pb(); return m.round === 2 && m.artifacts && m.artifacts.round === 2 && m.artifacts.list.length === 2; }), 'round 2: two artifacts');
  await shot(host, 'artifacts-r2');
  await fightRound();
  const d = await host.evaluate(() => { const { m } = window.__pb(); return m.draft && { how: m.draft.how, first: m.draft.first, owner: m.draft.owner, cards: m.draft.cards.map(c => c.id), open: Mpb.draftOpen(m) }; });
  ok(!!d, 'round 3: the draft: ' + JSON.stringify(d));
  ok(await host.evaluate(() => /Artifact draft/.test(document.getElementById('panel').textContent)), 'the deploy panel shows the draft');
  await shot(host, 'draft-r3');
  if (d && d.open) {
    const pick = d.first === 0 ? host : foe;
    await pick.click('[data-mpb-draft="0"]');
    await host.waitForFunction(() => !Mpb.draftOpen(window.__pb().m), null, { timeout: 8000 }).catch(() => {});
    ok(await host.evaluate(() => !Mpb.draftOpen(window.__pb().m)), 'the picking team picked card 0');
    await sleep(500);
    await shot(host, 'draft-picked');
  }
  // a placement vote for team A (when its card was a building)
  const head = await host.evaluate(() => { const h = Mpb.voteHead(window.__pb().m, 0); return h && { kind: h.kind, part: h.part }; });
  if (head) {
    await sleep(600);
    const glow = await host.evaluate(() => document.querySelectorAll('#marks .mpb-ok').length);
    ok(glow > 5, `the vote: ${glow} glowing tiles for the ${head.kind}`);
    const tile = await host.evaluate(() => { const { m } = window.__pb(), h = Mpb.voteHead(m, 0); return Mpb.spots(m, 0, h.kind, h.part)[2]; });
    await tapTile(host, tile.col, tile.row);
    await mate.waitForFunction((tl) => { const h = Mpb.voteHead(window.__pb().m, 0); return !h || (h.votes[0] && h.votes[0].col === tl.col); }, tile, { timeout: 8000 }).catch(() => {});
    ok(await mate.evaluate(() => document.querySelectorAll('#marks .mpb-vote').length >= 1), 'the teammate sees the host\'s vote');
    ok(await mate.evaluate(() => /Your teammate voted/.test(document.getElementById('panel').textContent)), 'and the panel says so');
    await shot(mate, 'vote');
    await tapTile(mate, tile.col, tile.row);
    ok(await host.waitForFunction((tl) => Mpb.recs(window.__pb().m, 0).some(r => r.col === tl.col && r.row === tl.row), tile, { timeout: 8000 }).then(() => true, () => false), 'the same tile: placed for both');
    await sleep(500);
    await shot(host, 'placed');
    await tapTile(host, tile.col, tile.row);
    await sleep(400);
    ok(/Your team’s/.test(await sheetText(host)), 'its sheet opens');
    await shot(host, 'mpb-sheet');
    await closeSheet(host);
  } else ok(true, 'no building for team A this round (its card: ' + JSON.stringify(d) + ')');
  // "No walls on the lake" (review 2026-11-06): while Put down water is on, a refused tap (a tile with the team's wall)
  // does nothing else: it no longer drops through to the wall and takes back the teammate's wall. Set up on the
  // teammate's page only (A1's wall this round on (13,10) n, a lake tile of A2's to put down), drawn with __pbRedraw.
  const lk = await mate.evaluate(() => {
    const { m, me } = window.__pb();
    if (!m.bwalls) m.bwalls = [[], []];
    m.bwalls[me].push({ col: 13, row: 11, edge: 'n', round: m.round });
    const r = Mpb.addRec(m, me, 'magicLake', -1, -1); r.data.lane = Mpb.laneOf(m);
    window.__pbRedraw();
    return { me, key: r.key, ok: Mpb.kindOf('magicLake').lakeOk(m, me, r, 13, 11) };
  });
  ok(lk.me === 0 && !lk.ok, 'the teammate may not put water on the team\'s wall tile');
  ok(await mate.evaluate(() => !!document.getElementById('ml-put')), 'the teammate\'s panel: Put down water');
  await mate.evaluate(() => document.getElementById('ml-put').click());
  await sleep(300);
  ok(await mate.evaluate(() => document.querySelectorAll('#marks .mpb-lake').length > 5), 'the lake\'s tiles glow');
  { // a tap near the north edge of (13,11): the wall's own edge
    const bb = await mate.locator('#board').boundingBox(), C = await mate.evaluate(() => Game.COLS), R = await mate.evaluate(() => Game.ROWS);
    await mate.mouse.click(bb.x + 13.5 * bb.width / C, bb.y + 11.08 * bb.height / R);
  }
  await sleep(300);
  ok(await mate.evaluate(() => { const { m, me } = window.__pb(); return !!Game.bwallOn(m, me, 13, 11, 'n'); }), 'the refused tap left the wall standing');
  const after = await mate.evaluate((k) => { const { m, me } = window.__pb(); return { col: Mpb.recOf(m, me, k).col, glow: document.querySelectorAll('#marks .mpb-lake').length, wallMode: /Tap a tile edge to build a wall/.test(document.body.innerText) }; }, lk.key);
  ok(after.col < 0 && after.glow > 5 && !after.wallMode, 'no water went down, the lake pick is still on, wall mode is not: ' + JSON.stringify(after));
  // every kind's sheet opens, for its own team and for the other (review 2026-11-06: the Shadow Den's threw for its
  // own team). Records added on this page only, at the end of the test.
  const sheetBad = await host.evaluate(() => {
    const { m } = window.__pb(), out = [];
    for (const id of Object.keys(Mpb.KINDS)) for (const sd of [0, 1]) {
      const t = Mpb.autoSpot(m, sd, id, null) || { col: 2 + Object.keys(Mpb.KINDS).indexOf(id), row: sd ? 2 : 15 };
      const rec = Mpb.addRec(m, sd, id, t.col, t.row);
      try {
        window.__pbSheet(sd, rec.key);
        const txt = document.getElementById('sheet').textContent;
        if (!txt.includes(Mpb.KINDS[id].name.replace(/^The /, '')) || !txt.includes(sd === window.__pb().me ? 'Your team' : 'Their team')) out.push(id + ' side ' + sd + ': not its sheet');
      } catch (e) { out.push(id + ' side ' + sd + ': ' + e.message); }
    }
    const c = document.getElementById('close'); if (c) c.click();
    return out;
  });
  ok(!sheetBad.length, 'every kind\'s sheet opens for both teams' + (sheetBad.length ? ': ' + sheetBad.join('; ') : ''));
  await b.close();
  if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.log('FAIL', e); process.exit(1); });
