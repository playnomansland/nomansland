// Chat on a PC (2026-11-05, docs/HANDOFF-POLISH.md §2). Two PC-sized browsers (mouse, 1440x900) signed in with Google
// play a friend's match on the game server: the host on the 3D board, the friend on the 2D board.
// Checks:
//  - the talk button is one button in the top left corner of the screen in the waiting room, deploy, battle and the
//    result, with no copy in the deploy tray, and it covers neither side's name nor health bar
//  - the talk wheel opens under it, and typing "qe" (and holding Q) in its chat line doesn't turn the 3D camera, while
//    Q outside a text field still does (and a held Q stops when focus moves into the chat line)
//  - Escape typed in the chat line doesn't close anything else (the page's key handlers ignore text fields)
// Needs: python3 -m http.server 8766 (repo root). Starts its own game server with accounts on 8763.
// Run: node tools/tests/chat-pc-ui.js [screenshot-dir]
const { chromium } = require('playwright-core');
const { idToken, startAccounts } = require('../../server/test/accounts-env.js');
const fs = require('fs');
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => fs.existsSync(f));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();
const SHOTS = process.argv[2] || '';

(async () => {
  const srv = await startAccounts(8763, {});
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: 'http://127.0.0.1:8766' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return r.json();
  };
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const URL = `http://127.0.0.1:8766/?test&server=${srv.base}`;
  async function pc(name, board) {
    const g = await call('google', { credential: idToken({ email: name.toLowerCase() + '@example.com', email_verified: true }) });
    if (!g.player) throw new Error('google sign-in: ' + JSON.stringify(g));
    await call('tag', { tag: name }, g.session);
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([a, bd]) => {
      if (!localStorage.getItem('phonebellum.account.v1')) localStorage.setItem('phonebellum.account.v1', JSON.stringify(a));
      localStorage.setItem('pb-stay', '1'); localStorage.setItem('phone-bellum-board', bd);
    }, [{ id: g.player.id, tag: name, google: true, dev: false, titles: [], title: '', tagNext: 0, skins: [], session: g.session, ts: Date.now() }, board]);
    const p = await ctx.newPage();
    p.on('pageerror', e => { if (!/gis is not defined/.test(e.message)) { console.log(`[${name}] PAGE ERROR`, e.message); bad++; } }); // gis: Google's sign-in script, unreachable here
    await p.goto(URL);
    await p.waitForSelector('#go', { timeout: 30000 });
    return p;
  }
  const shot = (p, n) => SHOTS ? p.screenshot({ path: `${SHOTS}/chat-pc-${n}.png` }) : null;
  const waitPhase = (p, re, ms = 20000) => p.waitForFunction((x) => new RegExp(x).test(document.getElementById('phase').textContent), re, { timeout: ms });
  // the talk button's box, and whether it overlaps a name or health bar
  const corner = (p) => p.evaluate(() => {
    const f = document.getElementById('talk-fab'), r = f.getBoundingClientRect();
    const hit = ['you-name', 'foe-name', 'hpbar-you', 'hpbar-foe', 'hp-you', 'hp-foe'].map(id => document.getElementById(id)).filter(Boolean)
      .map(el => (el.id.startsWith('hpbar') ? el.parentElement : el)).filter(el => {
        const q = el.getBoundingClientRect();
        return q.width && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
      }).map(el => el.id || el.className);
    return { pc: document.documentElement.classList.contains('pc'), shown: !f.hidden && r.width > 0, x: r.left, y: r.top, w: r.width, tray: !!document.getElementById('talk-btn'), hit };
  });
  const inCorner = (c) => c.pc && c.shown && c.x <= 20 && c.y <= 20 && !c.tray && !c.hit.length;
  try {
    const host = await pc('Vilhelm', '3d'), guest = await pc('Otto', '2d');
    await host.click('#friend');
    await host.waitForFunction(() => /play=/.test(document.getElementById('link').textContent), null, { timeout: 15000 });
    const link = (await host.locator('#link').textContent()).trim();
    await guest.goto(link + '&test&server=' + srv.base);
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
    let c = await corner(host);
    ok(inCorner(c), 'waiting room: the talk button in the top left corner ' + JSON.stringify(c));

    await host.click('#start');
    await waitPhase(host, 'Deploy'); await waitPhase(guest, 'Deploy');
    await host.dblclick('[data-pack="0"]'); await guest.dblclick('[data-pack="1"]');
    await sleep(1500);
    for (const [p, n] of [[host, 'host (3D)'], [guest, 'friend (2D)']]) {
      c = await corner(p);
      ok(inCorner(c), `deploy, ${n}: top left, no tray copy, clear of the names and health ` + JSON.stringify(c));
    }
    await shot(host, 'deploy-3d'); await shot(guest, 'deploy-2d');

    // 3D: tilt the camera so Q / E turn it, then type in the chat line
    await host.waitForFunction(() => window.__pb().board3d, null, { timeout: 30000 });
    const yaw = () => host.evaluate(() => window.__pb().board3d.camera.yaw());
    await host.evaluate(() => window.__pb().board3d.camera.setLevel(1));
    await sleep(800);
    await host.click('#talk-fab');
    await host.waitForSelector('#tw-in', { timeout: 5000 });
    const wb = await host.locator('#talk-wheel').boundingBox();
    ok(wb && wb.x < 40 && wb.y < 120, 'the wheel opens under the button ' + JSON.stringify(wb));
    await shot(host, 'wheel');
    const y0 = await yaw();
    await host.click('#tw-in');
    await host.keyboard.type('qeqe', { delay: 60 });
    await host.keyboard.down('q'); await sleep(700); await host.keyboard.up('q');
    await host.keyboard.press('Escape');
    const y1 = await yaw();
    ok(Math.abs(y1 - y0) < 1e-6, `typing "qe" and holding Q in the chat line doesn't turn the camera (${y0.toFixed(3)} -> ${y1.toFixed(3)})`);
    ok(/^qeqeq/.test(await host.inputValue('#tw-in')), 'the letters went into the chat line: ' + await host.inputValue('#tw-in'));
    ok(await host.isVisible('#talk-wheel'), 'Escape in the chat line didn\'t close the wheel');
    // a held Q stops when focus moves into the chat line
    await host.evaluate(() => document.activeElement.blur());
    await host.keyboard.down('q'); await sleep(500);
    const y2 = await yaw();
    ok(Math.abs(y2 - y1) > 0.05, `Q outside a text field still turns it (${y1.toFixed(3)} -> ${y2.toFixed(3)})`);
    await host.focus('#tw-in'); await sleep(50);
    const y3 = await yaw(); await sleep(500);
    const y4 = await yaw();
    await host.keyboard.up('q');
    ok(Math.abs(y4 - y3) < 1e-6, `a held Q stops turning when the chat line takes focus (${y3.toFixed(3)} -> ${y4.toFixed(3)})`);
    await host.fill('#tw-in', '');
    await host.click('#tw-close');

    // the battle and the result
    const placeOne = (p) => p.evaluate(() => {
      const { m, me } = window.__pb();
      for (let ui = 0; ui < m.units.length; ui++) {
        if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui) || m.gold[me] < Game.shopCost(m, me, ui)) continue;
        for (let row = 0; row < 20; row++) for (let col = 0; col < 12; col++) if (Game.canPlaceAt(m, me, col, row, ui) && Game.spotFree(m, me, col, row, ui)) { const sq = Game.place(m, me, ui, col, row); window.__pbRedraw(); return !!sq; }
      }
      return false;
    });
    await placeOne(host); await placeOne(guest); await sleep(800);
    for (const p of [host, guest]) { await p.click('#ready'); if (await p.locator('#cap-go').isVisible().catch(() => false)) await p.click('#cap-go'); }
    await waitPhase(host, 'Battle', 30000); await waitPhase(guest, 'Battle', 30000);
    await sleep(800);
    for (const [p, n] of [[host, 'host (3D)'], [guest, 'friend (2D)']]) {
      c = await corner(p);
      ok(inCorner(c), `battle, ${n}: top left, clear of the names and health ` + JSON.stringify(c));
    }
    await shot(host, 'battle-3d'); await shot(guest, 'battle-2d');
    for (const p of [host, guest]) { await p.click('#skip').catch(() => {}); await p.click('#skip').catch(() => {}); }
    await waitPhase(guest, 'Result|Match over', 30000);
    c = await corner(guest);
    ok(inCorner(c), 'result: top left ' + JSON.stringify(c));
    await shot(guest, 'result-2d');
  } finally {
    await b.close(); srv.stop();
  }
  console.log(bad ? `${bad} PC chat check(s) failed` : 'PC chat ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
