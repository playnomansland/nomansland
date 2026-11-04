// Friends in the browser (2026-11-04; docs/FRIENDS.md): two phones signed in as two test accounts (Google accounts
// made through the stand-in key server, server/test/accounts-env.js), each with its hub socket open. Checks:
//  - a guest sees "Sign in to add friends"
//  - add by username, the request arrives live (badge), accept, the green dot appears
//  - invite: the inviter's room is made, the friend's banner Join puts both in the same room
//  - private messages both ways (live in the open thread)
//  - remove: gone on both phones, no dot left; no page errors
// Needs: python3 -m http.server 8766 (repo root). Run: node tools/tests/friends-ui.js (own accounts server on 8782)
const { chromium } = require('playwright');
const { startAccounts, idToken } = require('../../server/test/accounts-env.js');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();
const uniq = () => Math.random().toString(36).slice(2, 6);

(async () => {
  const srv = await startAccounts(8782, { ACCOUNT_TAG_FRESH_MS: 3600000 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: 'http://127.0.0.1:8766' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const account = async (tag) => {
    const g = await call('google', { credential: idToken() });
    const t = await call('tag', { tag }, g.session);
    const p = t.player;
    return { id: p.id, tag: p.tag, google: true, dev: false, titles: [], title: '', tagNext: 0, skins: [], discord: false, puzzles: [], session: g.session, ts: Date.now() };
  };
  const PAGE = `http://127.0.0.1:8766/index.html?test&server=${srv.base}`;
  const b = await chromium.launch();
  const phone = async (name, a) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    if (a) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('fr-test')) { localStorage.setItem('phonebellum.account.v1', s); localStorage.setItem('pb-stay', '1'); sessionStorage.setItem('fr-test', '1'); } }, JSON.stringify(a));
    const p = await ctx.newPage();
    p.on('pageerror', e => { console.log(`[${name}] PAGE ERROR`, e.message); fails++; });
    await p.goto(PAGE);
    if (await p.locator('#pop-close').count()) await p.click('#pop-close');
    return p;
  };
  const sheet = (p) => p.locator('#sheet').innerText().then(t => t.replace(/\s+/g, ' ').trim());
  const until = (p, fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  try {
    // a guest
    const g = await phone('guest', null);
    await g.click('#fr-open');
    ok(/Sign in to add friends/.test(await sheet(g)), 'a guest sees "Sign in to add friends"');
    await g.context().close();

    const A = await account('Ann' + uniq()), B = await account('Bob' + uniq());
    const pa = await phone('a', A), pb = await phone('b', B);
    ok(await until(pa, () => window.__fr().fr.ws && window.__fr().fr.ws.ok), 'A: hub socket open');
    ok(await until(pb, () => window.__fr().fr.ws && window.__fr().fr.ws.ok), 'B: hub socket open');

    // add by username (another case), the request arrives live
    await pa.click('#fr-open');
    await pa.fill('#fr-tag', B.tag.toLowerCase());
    await pa.click('#fr-add');
    ok(await until(pa, () => /Request sent/.test(document.getElementById('fr-msg').textContent)), 'A: request sent');
    ok(await until(pb, () => { const x = document.querySelector('#fr-open .fr-badge'); return x && !x.hidden && x.textContent === '1'; }), 'B: the badge shows 1 (live)');
    await pb.click('#fr-open');
    await pb.click('[data-tab="requests"]');
    ok(/Asking to be your friend/.test(await sheet(pb)) && (await sheet(pb)).includes(A.tag), 'B: the request is listed');
    await pb.click(`[data-act="accept"][data-id="${A.id}"]`);
    ok(await until(pa, (id) => !!document.querySelector(`[data-act="invite"][data-id="${id}"]`), B.id), 'A: B is in the friends list (live)');
    ok(await until(pa, () => !!document.querySelector('.fr-row .fr-dot.on')), 'A: green dot by B');
    ok(/Online/.test(await sheet(pa)), 'A: "Online"');
    if (process.env.SHOTS) await pa.screenshot({ path: process.env.SHOTS + '/friends-sheet.png' });

    // invite into a room
    await pa.click(`[data-act="invite"][data-id="${B.id}"]`);
    if (await pa.locator(`[data-act="inv-std"]`).count()) await pa.click(`[data-act="inv-std"]`);
    ok(await until(pa, () => document.querySelector('#overlay .code') && /Waiting/.test(document.getElementById('overlay').innerText)), 'A: in a new room');
    const code = (await pa.locator('#overlay .code').innerText()).trim();
    ok(await until(pb, () => !!document.getElementById('fr-banner')), 'B: the invite banner');
    ok(/invites you to a Standard match/.test(await pb.locator('#fr-banner').innerText()), 'B: banner text: ' + (await pb.locator('#fr-banner').innerText()).replace(/\s+/g, ' '));
    if (process.env.SHOTS) { await pb.waitForTimeout(600); await pb.screenshot({ path: process.env.SHOTS + '/invite-banner.png' }); }
    await pb.click('#fr-join');
    ok(await until(pb, (c) => document.querySelector('#overlay .code') && document.querySelector('#overlay .code').textContent.trim() === c, code), 'B: in the same room ' + code);
    ok(await until(pa, () => /Your friend is here/.test(document.getElementById('overlay').innerText)), 'A: "Your friend is here!"');

    // messages both ways
    await pb.click('#fr-room');
    await pb.click(`[data-act="message"][data-id="${A.id}"]`);
    await pb.waitForSelector('#fr-text');
    await pb.fill('#fr-text', 'hi from Bob');
    await pb.click('#fr-go');
    ok(await until(pb, () => /hi from Bob/.test(document.getElementById('fr-thread').innerText)), 'B: own message in the thread');
    ok(await until(pa, () => { const x = document.querySelector('.fr-badge'); return [...document.querySelectorAll('.fr-badge')].some(b => !b.hidden) || !!document.querySelector('.fr-toast'); }), 'A: badge or note for the message');
    await pa.click('#fr-room');
    await pa.click(`[data-act="message"][data-id="${B.id}"]`);
    ok(await until(pa, () => /hi from Bob/.test(document.getElementById('fr-thread').innerText)), 'A: sees the message');
    await pa.fill('#fr-text', 'hello Bob');
    await pa.click('#fr-go');
    ok(await until(pb, () => /hello Bob/.test(document.getElementById('fr-thread').innerText)), 'B: the reply arrives live in the open thread');
    if (process.env.SHOTS) await pb.screenshot({ path: process.env.SHOTS + '/thread.png' });

    // remove
    await pa.click('#fr-back');
    await pa.click(`[data-act="more"][data-id="${B.id}"]`);
    await pa.click(`[data-act="remove"][data-id="${B.id}"]`);
    await pa.click(`[data-act="remove"][data-id="${B.id}"]`);
    ok(await until(pa, () => /No friends yet/.test(document.getElementById('fr-sheet').innerText)), 'A: removed');
    await pb.click('#fr-back');
    ok(await until(pb, () => /No friends yet/.test(document.getElementById('fr-sheet').innerText) && !document.querySelector('.fr-dot')), 'B: gone too, no dot left');
  } finally { await b.close(); srv.stop(); }
  console.log(fails ? `${fails} FAILED` : 'friends-ui: all checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
