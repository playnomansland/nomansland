// Chat and emotes in the browser (2026-11-04, docs/LOBBY.md §6). Three phones: the host (signed in with Google), a
// guest-account friend and a Google-signed-in spectator, in a public room made from the lobby.
// Checks: the talk button shows in the waiting room; the host's line reaches the friend (the short line under the
// HUD and the Chat sheet); the friend sees "Sign in to chat" but sends an emote, which pops up on the host's screen;
// muting the friend's emotes from their nameplate (kept per match code) hides the next one; the spectator's line
// during the match stays with the spectators, and the players get it when the match ends (chatMerge); Settings has
// Chat and Emotes on/off. SHOTS=dir saves screenshots (the lobby, the wheel, an emote).
// Needs: python3 -m http.server 8766 (repo root). Starts its own game server with accounts on 8782.
// Run: node tools/tests/chat-ui.js
const { chromium } = require('playwright');
const ctx2d = require('./board2d');
const { idToken, startAccounts } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();
const SHOTS = process.env.SHOTS || '';

(async () => {
  const srv = await startAccounts(8782, {});
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: 'http://127.0.0.1:8766' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return r.json();
  };
  const b = await chromium.launch();
  const URL = `http://127.0.0.1:8766/?test&server=${srv.base}`;
  async function phone(name, google) {
    const g = google ? await call('google', { credential: idToken({ email: name.replace(/\W/g, '') + '@example.com', email_verified: true }) }) : await call('guest', { tag: name });
    if (google) await call('tag', { tag: name }, g.session);
    const ctx = await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((a) => { if (!localStorage.getItem('phonebellum.account.v1')) localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); },
      { id: g.player.id, tag: name, google: !!google, dev: false, titles: [], title: '', tagNext: 0, skins: [], session: g.session, ts: Date.now() });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); bad++; });
    await p.goto(URL);
    await p.waitForSelector('#online', { timeout: 30000 });
    return p;
  }
  const T = (p) => p.evaluate(() => window.__talk());
  const shot = (p, n) => SHOTS ? p.screenshot({ path: `${SHOTS}/${n}.png` }) : null;
  try {
    const host = await phone('Vilhelm', true), guest = await phone('Otto', false), fan = await phone('Watcher', true);
    const hostFrames = [];
    host.on('websocket', (ws) => ws.on('framereceived', (f) => { try { const d = JSON.parse(f.payload); if (d.t === 'chatMerge' || d.t === 'forfeit') hostFrames.push(d); } catch (e) {} }));
    for (const p of [host, guest, fan]) await p.click('#online');
    await host.click('#lob-create'); await host.click('#create-go');
    await host.waitForFunction(() => window.__talk().code && window.__talk().talk.pub, null, { timeout: 15000 });
    const code = (await T(host)).code;
    await guest.locator(`.room-card[data-code="${code}"] [data-join]`).waitFor({ timeout: 10000 });
    await shot(guest, 'lobby');
    await guest.locator(`.room-card[data-code="${code}"] [data-join]`).click();
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
    ok(await host.isVisible('#talk-fab') && await guest.isVisible('#talk-fab'), 'the talk button in the waiting room');
    ok((await T(host)).talk.can === true && (await T(guest)).talk.can === false, 'Google: may chat; a guest account: not');

    // the host says hello
    await host.click('#talk-fab');
    await host.waitForSelector('#tw-in', { timeout: 5000 });
    await shot(host, 'wheel');
    await host.fill('#tw-in', 'good luck, have fun');
    await host.press('#tw-in', 'Enter');
    await guest.waitForFunction(() => /good luck, have fun/.test(document.getElementById('chat-tick').textContent), null, { timeout: 8000 });
    ok(true, 'the line shows under the HUD on the other phone');
    // the guest: no text box, emotes
    await guest.click('#talk-fab');
    ok(await guest.isVisible('.tw-sign') && !(await guest.$('#tw-in')), 'a guest sees "Sign in to chat"');
    await guest.click('[data-emote="golem"]');
    await host.waitForSelector('#emote-layer img.golem', { timeout: 8000 });
    ok(true, 'the guest\'s emote pops up on the host\'s screen');
    await shot(host, 'emote');
    // the Chat sheet has the line
    await guest.click('#talk-fab'); await guest.click('#tw-chat');
    ok(/good luck, have fun/.test(await guest.textContent('#chat-lines')), 'the Chat sheet lists it');
    await guest.click('#close');

    // the match: the spectator joins, the host mutes the guest's emotes from their nameplate
    await host.click('#start');
    await host.waitForFunction(() => window.__pb().phase === 'deploy', null, { timeout: 15000 });
    await fan.locator(`.room-card[data-code="${code}"] [data-watch]`).waitFor({ timeout: 10000 });
    await fan.locator(`.room-card[data-code="${code}"] [data-watch]`).click();
    await fan.waitForFunction(() => window.__pb().phase === 'deploy' && window.__talk().talk.can, null, { timeout: 15000 });
    await host.click('#foe-name');
    await host.waitForSelector('#np-menu:not([hidden])', { timeout: 5000 });
    await host.click('#np-menu [data-np="e"]');
    ok((await T(host)).mute.e === true && await host.evaluate((c) => JSON.parse(localStorage.getItem('pb-mute-' + c)).e, code), 'Mute emotes: kept for this match code');
    await sleep(3100); // one emote per 3 s
    await host.evaluate(() => document.querySelectorAll('#emote-layer img').forEach(x => x.remove()));
    await guest.evaluate(() => window.__talk().send({ t: 'emote', id: 'shock' }));
    await fan.waitForSelector('#emote-layer img.shock', { timeout: 8000 });
    ok(await host.$('#emote-layer img.shock') === null, 'muted: the host doesn\'t see it (the spectator does)');

    // the spectator's line stays with the spectators while the match runs
    await fan.click('#talk-fab');
    ok(!(await fan.$('[data-emote]')), 'spectators have no emotes');
    await fan.fill('#tw-in', 'nice opening');
    await fan.press('#tw-in', 'Enter');
    await fan.waitForFunction(() => window.__talk().talk.lines.some(l => l.text === 'nice opening'), null, { timeout: 8000 });
    await sleep(800);
    ok(!(await T(host)).talk.lines.some(l => l.text === 'nice opening') && !(await T(guest)).talk.lines.some(l => l.text === 'nice opening'), 'players don\'t see the spectators\' chat during the match');
    // the match ends: the chats merge
    await guest.evaluate(() => window.__talk().send({ t: 'forfeit' }));
    for (let i = 0; i < 40 && !hostFrames.some(d => d.t === 'forfeit'); i++) await sleep(250);
    const mi = hostFrames.findIndex(d => d.t === 'chatMerge'), fi = hostFrames.findIndex(d => d.t === 'forfeit');
    ok(mi >= 0 && hostFrames[mi].lines.some(l => l.text === 'nice opening') && mi < fi, 'the match is over: the players get the spectators\' lines (before the forfeit)');

    // Settings: Chat and Emotes on/off
    await host.click('#menu').catch(() => {});
    await host.waitForSelector('#lob-list', { timeout: 10000 });
    ok(!(await host.$('#home[hidden]')), 'Main menu after the match: back to Rooms');
    await host.click('#lob-back'); await host.click('#music-open');
    const hasToggles = await host.$('[data-chat="0"]') && await host.$('[data-emo="0"]');
    ok(!!hasToggles, 'Settings: Chat and Emotes switches');
    if (hasToggles) {
      await host.click('[data-emo="0"]');
      ok(await host.evaluate(() => JSON.parse(localStorage.getItem('phonebellum.sound.v1') || '{}').emotesOn === false), 'Emotes off is saved');
    }
  } finally {
    await b.close(); srv.stop();
  }
  console.log(bad ? `${bad} chat UI check(s) failed` : 'chat UI ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
