// Music anywhere outside battle (2026-11-05, docs/HANDOFF-POLISH.md §1), vs AI on the 2D board:
//  - the main menu has its player and no round music button; in a match the note beside the Settings cog opens the
//    playlist sheet with the full player (play / pause, back, next, shuffle, repeat) and every song, Map music first
//  - deploy starts on the map's music; a song picked in deploy ("my music") plays instead, and keeps playing into the
//    battle (where the note is hidden) and the result; Map music goes back to the map's combo
//  - Pause and Play in a match; Music Off in Settings silences it, and Play turns music back on
//  - a new match starts on the map's music again
// Starts its own static server on 8762. Run: node tools/tests/music-ui.js [screenshot-dir]
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ctx2d = require('./board2d');
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => fs.existsSync(f));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();
const SHOTS = process.argv[2] || '';
const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

(async () => {
  const srv = http.createServer((q, s) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.statusCode = 404; return s.end(); }
    s.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream'); s.end(fs.readFileSync(f));
  }).listen(8762);
  const b = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.removeItem('phonebellum.sound.v1'); } catch (e) {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log('PAGE ERROR', e.message); bad++; });
    const M = () => p.evaluate(() => window.__music());
    const shot = (n) => SHOTS ? p.screenshot({ path: `${SHOTS}/music-${n}.png` }) : null;
    const vis = (sel) => p.locator(sel).isVisible();
    await p.goto('http://127.0.0.1:8762/?test');
    await p.waitForSelector('#go', { timeout: 30000 });
    await p.mouse.click(5, 400); await sleep(600); // the first tap starts the sound
    let s = await M();
    ok(s.playing.join() === 'menu', 'the menu plays the menu playlist: ' + s.playing);
    ok(!(await vis('#music-fab')), 'the main menu: no round music button (it has its player)');

    // a match: deploy on the map's music
    await p.click('#go'); await sleep(1500);
    s = await M();
    ok(s.combo && s.playing.join() === s.combo && !s.mine.on, `deploy: the map's music (${s.combo})`);
    ok(await vis('#music-btn') && !(await vis('#music-fab')), 'the note beside the cog in deploy');
    await p.click('#music-btn');
    await p.waitForSelector('#sheet .mplayer', { timeout: 5000 });
    ok(await p.getAttribute('[data-song=""]', 'aria-pressed') === 'true' && /Map music/.test(await p.textContent('[data-song=""]')), 'the sheet: Map music first, marked');
    for (const id of ['mp-play', 'mp-back', 'mp-next', 'mp-shuffle', 'mp-repeat']) ok(await vis('#sheet #' + id), 'the player has ' + id);
    const all = await p.$$eval('#sheet [data-song]', (x) => x.map(e => e.dataset.song));
    ok(all.length >= 15 && all.includes('bulgaria') && all.includes('jonah') && all.includes('knarkkungn'), `every song in the list (${all.length - 1}), the map songs too`);
    ok(/Map music/.test(await p.textContent('#mp-label')), 'the player says Map music');
    await shot('sheet-map');
    // my music
    await p.click('[data-song="jonah"]'); await sleep(400);
    s = await M();
    ok(s.mine.on && s.playing.join() === 'mine' && s.song === 'jonah', 'picking Jonah: it plays instead of the map\'s music ' + JSON.stringify(s));
    ok(await p.getAttribute('[data-song="jonah"]', 'aria-pressed') === 'true' && await p.getAttribute('[data-song=""]', 'aria-pressed') === 'false', 'Jonah is marked in the list');
    await shot('sheet-mine');
    // Pause and Play
    await p.click('#mp-play'); await sleep(200);
    s = await M(); ok(!s.playing.length && s.mine.paused, 'Pause: nothing plays');
    await p.click('#mp-play'); await sleep(200);
    s = await M(); ok(s.playing.join() === 'mine' && s.song === 'jonah', 'Play: Jonah again');
    // Next and Back stay in my music
    await p.click('#mp-next'); await sleep(200);
    s = await M(); ok(s.playing.join() === 'mine' && s.song !== 'jonah', 'Next: the next song of the list, still my music (' + s.song + ')');
    await p.click('#mp-back'); await sleep(200);
    s = await M(); ok(s.song === 'jonah', 'Back: Jonah');
    await p.click('#sheet #close');

    // into the battle: my music goes on
    await p.dblclick('[data-pack="0"]'); await sleep(500);
    await p.evaluate(() => { const { m, me } = window.__pb(); for (let ui = 0; ui < m.units.length; ui++) { if (Game.isOff(m, ui, me) || !Game.isUnlocked(m, me, ui)) continue; for (let r = 0; r < 20; r++) for (let c = 0; c < 12; c++) if (Game.canPlaceAt(m, me, c, r, ui) && Game.spotFree(m, me, c, r, ui) && Game.place(m, me, ui, c, r)) { window.__pbRedraw(); return; } } });
    await p.click('#fight'); await sleep(300);
    if (await vis('#cap-go')) await p.click('#cap-go');
    await p.waitForFunction(() => window.__pb().phase === 'battle', null, { timeout: 15000 });
    await sleep(600);
    s = await M();
    ok(s.mine.on && s.playing.join() === 'mine' && s.song === 'jonah', 'battle: Jonah keeps playing (not the map\'s battle music) ' + JSON.stringify(s));
    ok(!(await vis('#music-btn')) && !(await vis('#music-fab')), 'no music button in battle');
    await shot('battle');
    await p.click('#skip'); await p.click('#skip').catch(() => {});
    await p.waitForFunction(() => window.__pb().phase === 'result', null, { timeout: 15000 });
    await sleep(300);
    s = await M();
    ok(s.playing.join() === 'mine', 'the result: still my music');
    ok(await vis('#music-btn'), 'the note is back after the battle');
    // Map music: back to the map's combo
    await p.click('#music-btn'); await p.waitForSelector('#sheet [data-song=""]');
    await p.click('[data-song=""]'); await sleep(300);
    s = await M();
    ok(!s.mine.on && s.combo && s.playing.join() === s.combo, `Map music: the map's ${s.combo} again`);
    await p.click('#sheet #close');
    await p.click('#next').catch(() => {}); await sleep(1200);
    s = await M();
    ok(s.combo && /deploy/.test(s.combo) && s.playing.join() === s.combo, 'round 2 deploy: the map\'s deploy music ' + s.combo);

    // Music Off silences everything; the player's Play turns it on again
    await p.click('[data-song]').catch(() => {}); // (no sheet open: nothing)
    await p.click('#music-btn'); await p.click('[data-song="sisi"]'); await sleep(200);
    await p.click('#sheet #close'); await p.click('#cog'); await p.click('[data-mute="1"]'); await sleep(200);
    s = await M(); ok(!s.playing.length, 'Music Off: nothing plays');
    await p.click('#sheet #close'); await p.click('#music-btn'); await p.click('#mp-play'); await sleep(300);
    s = await M(); ok(s.playing.join() === 'mine' && s.song === 'sisi' && await p.evaluate(() => !JSON.parse(localStorage.getItem('phonebellum.sound.v1')).muted), 'Play turns music on: my music (sisi)');
    await p.click('#sheet #close');

    // a new match starts on the map's music
    await p.click('#cog'); await p.click('#to-menu'); await sleep(300);
    if (await vis('#forfeit-yes')) await p.click('#forfeit-yes');
    await p.waitForSelector('#go', { timeout: 10000 }); await sleep(500);
    s = await M(); ok(s.playing.join() === 'menu' && !s.mine.on, 'back on the menu: the menu playlist');
    await p.click('#go'); await sleep(1500);
    s = await M();
    ok(!s.mine.on && s.combo && s.playing.join() === s.combo, `a new match: the map's music again (${s.combo})`);
  } finally { await b.close(); srv.close(); }
  console.log(bad ? `${bad} music check(s) failed` : 'music ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
