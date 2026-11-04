// The online lobby in the browser (2026-11-04, docs/LOBBY.md): PLAY → Online · Rooms.
// Checks: the Rooms screen opens and its socket closes when a match starts; Create room (public, the default) puts a
// card in another phone's list with the host's name, Join takes the second phone into the waiting room, the card
// fills (2/2) and once the match starts a third phone gets Watch and spectates; Sort (Name, Date/time, Category, Mode)
// is remembered (pb-lobby-sort) and flips on a second tap; the host's own account on a second phone can't join its own
// room ("You're already in that room"); the host's Spectators switch in the waiting room; Quick play
// makes a room when none is open, and a second phone's Quick play joins it; a private room is never listed.
// Needs: python3 -m http.server 8766 (repo root). Starts its own game server with accounts on 8781.
// Run: node tools/tests/lobby-ui.js
const { chromium } = require('playwright');
const ctx2d = require('./board2d');
const { idToken, startAccounts } = require('../../server/test/accounts-env.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let bad = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8781, {});
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: 'http://127.0.0.1:8766' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return r.json();
  };
  const b = await chromium.launch();
  const URL = `http://127.0.0.1:8766/?test&server=${srv.base}`;
  // a phone with an account (Google or guest) already on it; `have`: another phone of the same player
  async function phone(name, google, have) {
    const g = have || (google ? await call('google', { credential: idToken({ email: name + '@example.com', email_verified: true }) }) : await call('guest', { tag: name }));
    if (!have && google) await call('tag', { tag: name }, g.session);
    const ctx = await ctx2d(b, { viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((a) => { if (!localStorage.getItem('phonebellum.account.v1')) localStorage.setItem('phonebellum.account.v1', JSON.stringify(a)); localStorage.setItem('pb-stay', '1'); },
      { id: g.player.id, tag: name, google: !!google, dev: false, titles: [], title: '', tagNext: 0, skins: [], session: g.session, ts: Date.now() });
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); bad++; });
    await p.goto(URL);
    await p.waitForSelector('#online', { timeout: 30000 });
    p.acct = g;
    return p;
  }
  const T = (p) => p.evaluate(() => window.__talk());
  const card = (p, code) => p.locator(`.room-card[data-code="${code}"]`);
  try {
    const host = await phone('Vilhelm', true), guest = await phone('Otto', true), fan = await phone('Fan Guest', false);
    for (const p of [host, guest, fan]) await p.click('#online');
    await guest.waitForSelector('#lob-list', { timeout: 10000 });
    await guest.waitForFunction(() => window.__talk().lob.open, null, { timeout: 10000 });
    ok(/No open rooms|Loading/.test(await guest.textContent('#lob-list')), 'Rooms: empty to start');

    // Create room: public by default
    await host.click('#lob-create');
    ok(await host.getAttribute('[data-cp="true"]', 'aria-pressed') === 'true' && await host.getAttribute('[data-cs="true"]', 'aria-pressed') === 'true', 'Create room: public, spectators on');
    await host.click('#create-go');
    await host.waitForSelector('#start', { timeout: 15000 });
    await host.waitForFunction(() => window.__talk().code && window.__talk().talk.pub, null, { timeout: 15000 });
    const code = (await T(host)).code;
    ok(!(await T(host)).lob.open, 'the lobby socket closes when the room opens');
    await card(guest, code).waitFor({ timeout: 10000 });
    const txt = await card(guest, code).textContent();
    ok(/Vilhelm/.test(txt) && /Vilhelm’s room/.test(txt) && /Standard/.test(txt) && /1\/2 players/.test(txt), 'the card: host, room name, Standard, 1/2 players');
    ok(await card(guest, code).locator('[data-join]').count() === 1 && await card(guest, code).locator('[data-watch]').count() === 0, 'a waiting room: Join, no Watch');

    // nobody is in the same room twice: the host's own account, on another phone, is turned away (denied 'here')
    const host2 = await phone('Vilhelm', true, host.acct);
    await host2.click('#online');
    await card(host2, code).waitFor({ timeout: 10000 });
    await card(host2, code).locator('[data-join]').click();
    await host2.waitForFunction(() => /already in that room/i.test(document.getElementById('overlay').textContent), null, { timeout: 15000 }).catch(() => {});
    ok(/already in that room/i.test(await host2.textContent('#overlay')), `your own room on a second phone: turned away (${(await host2.textContent('#overlay')).replace(/\s+/g, ' ').trim().slice(0, 70)})`);
    ok((await T(host)).code === code && await host.locator('#start[disabled]').count() === 1, 'the room itself is untouched: still waiting for an opponent');
    await host2.close();

    // Sort: remembered, and flips on a second tap
    await guest.click('#lob-sort');
    await guest.click('[data-sort="name"]');
    ok((await T(guest)).lob.sort.k === 'name' && !(await T(guest)).lob.sort.flip, 'Sort by name');
    await guest.click('[data-sort="name"]');
    ok((await T(guest)).lob.sort.flip === true, 'a second tap flips it');
    ok(JSON.parse(await guest.evaluate(() => localStorage.getItem('pb-lobby-sort'))).k === 'name', 'kept in pb-lobby-sort');
    await guest.click('[data-sort="time"]');
    await guest.click('#close');

    // Join from the list
    await card(guest, code).locator('[data-join]').click();
    await host.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
    ok(true, 'Join: the host sees the friend arrive');
    await card(fan, code).waitFor({ timeout: 10000 });
    await fan.waitForFunction((c) => /2\/2 players/.test(document.querySelector(`.room-card[data-code="${c}"]`).textContent), code, { timeout: 10000 });
    ok(await card(fan, code).locator('[data-join]').count() === 0, 'full: no Join');
    // the host's Spectators switch in the waiting room
    await host.click('[data-spec="0"]');
    await fan.waitForFunction((c) => /No watchers/.test(document.querySelector(`.room-card[data-code="${c}"]`).textContent), code, { timeout: 10000 });
    ok(true, 'Spectators off: the card says No watchers');
    await host.click('[data-spec="1"]');
    await fan.waitForFunction((c) => !/No watchers/.test(document.querySelector(`.room-card[data-code="${c}"]`).textContent), code, { timeout: 10000 });
    // start: Watch
    await host.click('#start');
    await host.waitForFunction(() => document.getElementById('phase').textContent === 'Deploy', null, { timeout: 15000 });
    await card(fan, code).locator('[data-watch]').waitFor({ timeout: 10000 });
    ok(/Round 1/.test(await card(fan, code).textContent()), 'playing: Round 1 and Watch');
    await card(fan, code).locator('[data-watch]').click();
    await fan.waitForFunction(() => window.__pb().phase === 'deploy' && window.__talk().mode === 'spec', null, { timeout: 15000 });
    ok(/Vilhelm/.test(await fan.textContent('#you-name')) && /Otto/.test(await fan.textContent('#foe-name')), 'watching from the lobby: both names');
    await host.waitForFunction(() => true);
    // the spectator leaves: back to the Rooms list
    await fan.click('#spec-leave');
    await fan.waitForFunction(() => !document.getElementById('home').hidden && document.getElementById('lob-list') && window.__talk().lob.open, null, { timeout: 10000 });
    ok(true, 'leaving: back to Rooms');

    // a private room is never listed
    const priv = await phone('Private Host', false);
    await priv.click('#online'); await priv.click('#lob-create'); await priv.click('[data-cp="false"]'); await priv.click('#create-go');
    await priv.waitForFunction(() => window.__talk().code && window.__talk().mode === 'net', null, { timeout: 15000 });
    const pcode = (await T(priv)).code;
    await sleep(2500);
    ok(!(await T(fan)).lob.list.some(l => l.code === pcode), 'a private room isn\'t in Rooms');
    await priv.close();

    // Quick play: none open, so it makes one; a second phone's Quick play joins it
    const q1 = await phone('Quick One', false);
    await q1.click('#online'); await q1.waitForFunction(() => window.__talk().lob.open, null, { timeout: 10000 });
    await q1.click('#lob-quick');
    await q1.waitForSelector('#start', { timeout: 15000 });
    const qcode = (await T(q1)).code;
    await fan.waitForFunction((c) => window.__talk().lob.list.some(l => l.code === c), qcode, { timeout: 10000 })
      .catch(async (e) => { console.log('fan lobby', JSON.stringify(await T(fan)).slice(0, 600), 'q1', qcode, JSON.stringify((await T(q1)).talk)); throw e; });
    await fan.click('#lob-quick');
    await q1.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 15000 });
    ok((await T(fan)).code === qcode, 'Quick play joins the open room');
  } finally {
    await b.close(); srv.stop();
  }
  console.log(bad ? `${bad} lobby UI check(s) failed` : 'lobby UI ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
