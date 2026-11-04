// PlayerHub (2026-11-04; server/src/hub.js, docs/FRIENDS.md): the live part of friends.
// Checks:
//  - hello: the player's own session only, signed-in (Google) accounts only
//  - two phones of one player: online while either is open, offline (with last seen) when both are closed
//  - status goes to friends only, without the room code; the dot data in /account/friends (online / offline / last seen)
//  - requests and accepts arrive live
//  - invites: online friends only, one open per friend, to a room you're in, cancel, leaving the room, decline, expiry
//  - private messages: friends only, filter and limits, the sender's other phone, 100 kept per pair, unread counts, mute
// Run: cd server && node test/hub.test.js (also in npm test). Port 8783.
const assert = require('assert');
const { open, waitFor, sleep, closed } = require('./harness.js');
const { idToken, startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 8 * 60 * 1000).unref();
const uniq = () => Math.random().toString(36).slice(2, 7);
const code = () => 'H' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');

(async () => {
  const srv = await startAccounts(8783, { ACCOUNT_TAG_FRESH_MS: 3600000, HUB_INVITE_MS: 2500, HUB_DM_BURST: '5,3000', HUB_DM_HOUR: 60 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '10.1.0.' + (1 + Math.floor(Math.random() * 250)) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const player = async (tag) => {
    const g = await call('google', { credential: idToken() });
    assert.strictEqual(g.status, 200, 'google sign-in');
    await call('tag', { tag }, g.session);
    return { id: g.player.id, tag, s: g.session };
  };
  const befriend = async (x, y) => { await call('friend/add', { id: y.id }, x.s); assert.strictEqual((await call('friend/accept', { id: x.id }, y.s)).status, 200); };
  // a phone's hub socket, signed in
  const hub = async (p, session = p.s) => {
    const ws = await open(`${srv.ws}/hub?p=${p.id}`, ORIGIN);
    ws.json({ t: 'hello', session });
    await waitFor(() => ws.inbox.find((x) => x.t === 'welcome' || x.t === 'denied'), 8000);
    return ws;
  };
  const none = async (ws, type, ms = 600) => { await sleep(ms); return !ws.inbox.slice(ws.seen).some((x) => x.t === type); };
  const friendRow = async (p, id) => (await call('friends', {}, p.s)).friends.find((x) => x.id === id);
  try {
    const A = await player('Ann' + uniq()), B = await player('Bob' + uniq()), C = await player('Cid' + uniq()), D = await player('Dee' + uniq());
    await befriend(A, B); await befriend(A, D);

    // hello: own session only, Google accounts only
    let w = await hub(A, B.s);
    assert.strictEqual(w.last('denied').why, 'session', "someone else's session"); await closed(w);
    const guest = await call('guest', { tag: 'Gus' + uniq() });
    w = await hub({ id: guest.player.id, s: guest.session });
    assert.strictEqual(w.last('denied').why, 'google', 'a guest gets no hub'); await closed(w);
    const bad = await fetch(`${srv.base}/hub?p=nope`, { headers: { Origin: ORIGIN } });
    assert.strictEqual(bad.status, 400, 'a bad player id');

    // presence: B and C watch, A comes online on two phones
    const b1 = await hub(B), c1 = await hub(C);
    assert.ok(b1.last('welcome'), 'B is in');
    const a1 = await hub(A);
    let st = await b1.next('status');
    assert.strictEqual(st.id, A.id); assert.strictEqual(st.online, true); assert.deepStrictEqual(st.status, { where: 'menu' }, 'A is on the menu');
    assert.ok(await none(c1, 'status'), 'C (not a friend) hears nothing');
    let row = await friendRow(B, A.id);
    assert.strictEqual(row.online, true, 'the friends list: green dot'); assert.deepStrictEqual(row.status, { where: 'menu' });
    const a2 = await hub(A);
    a1.json({ t: 'status', where: 'room', code: 'ROOM1' });
    st = await b1.next('status');
    assert.deepStrictEqual(st.status, { where: 'room' }, 'in a room, without the code');
    assert.ok(!JSON.stringify(st).includes('ROOM1'), 'the room code never goes to friends');
    a2.json({ t: 'status', where: 'match', code: 'ROOM2', round: 4 });
    st = await b1.next('status');
    assert.deepStrictEqual(st.status, { where: 'match', round: 4 }, 'in a match, round 4 (the busiest phone counts)');
    assert.deepStrictEqual((await friendRow(B, A.id)).status, { where: 'match', round: 4 });
    a2.close(); await sleep(400);
    st = await b1.next('status');
    assert.deepStrictEqual(st.status, { where: 'room' }, 'one phone closed: still online, back to the room');
    a1.close();
    st = await b1.next('status');
    assert.strictEqual(st.online, false, 'both phones closed: offline'); assert.ok(st.seen > Date.now() - 10e3, 'last seen just now');
    row = await friendRow(B, A.id);
    assert.strictEqual(row.online, false, 'grey dot'); assert.ok(row.seen >= st.seen - 5, 'last seen in the list');
    assert.ok(await none(c1, 'status', 100), 'C still hears nothing');

    // live requests and accepts
    await call('friend/add', { id: B.id }, C.s);
    const req = await b1.next('request');
    assert.strictEqual(req.from.id, C.id); assert.strictEqual(req.from.tag, C.tag);
    await call('friend/accept', { id: C.id }, B.s);
    assert.strictEqual((await c1.next('accepted')).by.id, B.id, 'accepted arrives live');
    await call('friend/remove', { id: C.id }, B.s);
    assert.strictEqual((await c1.next('removed')).by, B.id, 'removed: a list update');

    // invites
    const A1 = await hub(A);
    const R = code();
    A1.json({ t: 'invite', to: B.id, code: R });
    assert.strictEqual((await A1.next('inviteFail')).why, 'room', 'only to a room you are in');
    A1.json({ t: 'status', where: 'room', code: R });
    await b1.next('status');
    A1.json({ t: 'invite', to: C.id, code: R });
    assert.strictEqual((await A1.next('inviteFail')).why, 'not friends');
    A1.json({ t: 'invite', to: D.id, code: R });
    assert.strictEqual((await A1.next('inviteFail')).why, 'offline', 'offline friends cannot be invited');
    A1.json({ t: 'invite', to: B.id, code: R, mode: 'standard' });
    let inv = await b1.next('invite');
    assert.strictEqual(inv.from.id, A.id); assert.strictEqual(inv.from.tag, A.tag); assert.strictEqual(inv.code, R); assert.strictEqual(inv.mode, 'standard');
    assert.ok(inv.expires > Date.now(), 'an expiry');
    assert.strictEqual((await A1.next('invited')).to, B.id, 'the inviter hears it went');
    const b2 = await hub(B);
    assert.deepStrictEqual(b2.last('welcome').invites.map((x) => x.code), [R], "a phone that opens later sees the open invite");
    // one open invite per friend
    const R2 = code();
    A1.json({ t: 'status', where: 'room', code: R2 }); // leaving the room cancels it
    assert.strictEqual((await b1.next('inviteGone')).code, R, 'the inviter left the room: invite gone');
    A1.json({ t: 'invite', to: B.id, code: R2 });
    inv = await b1.next('invite');
    assert.strictEqual(inv.code, R2);
    // cancel
    A1.json({ t: 'inviteCancel', code: R2 });
    assert.strictEqual((await b1.next('inviteGone')).code, R2, 'cancelled');
    // decline
    A1.json({ t: 'invite', to: B.id, code: R2 });
    await b1.next('invite');
    b1.json({ t: 'decline', code: R2 });
    const dec = await A1.next('declined');
    assert.strictEqual(dec.by.id, B.id); assert.strictEqual(dec.code, R2);
    assert.ok(await waitFor(() => b2.inbox.filter((x) => x.t === 'inviteGone' && x.code === R2).length >= 2), "declined: gone on B's other phone too (after the cancel)");
    // expiry (2.5 s in this test; 5 minutes for real)
    A1.json({ t: 'invite', to: B.id, code: R2 });
    await b1.next('invite');
    const aX = await hub(A), R3 = code();
    aX.json({ t: 'status', where: 'room', code: R3 }); await sleep(400);
    A1.json({ t: 'invite', to: B.id, code: R3 });
    assert.strictEqual((await A1.next('inviteFail')).why, 'open', 'one open invite per friend');
    aX.close();
    assert.strictEqual((await b1.next('inviteGone', 8000)).code, R2, 'expired');
    // joining uses it: B goes to the room
    A1.json({ t: 'invite', to: B.id, code: R2 });
    await b1.next('invite');
    b1.json({ t: 'status', where: 'room', code: R2 });
    await sleep(500);
    const b3 = await hub(B);
    assert.deepStrictEqual(b3.last('welcome').invites, [], 'joined: the invite is used');
    b3.close();
    // 10 a minute
    let fails = 0;
    for (let i = 0; i < 11; i++) A1.json({ t: 'invite', to: B.id, code: R2 }); // the same room again is allowed (just not a second one)
    await sleep(1500);
    fails = A1.inbox.filter((x) => x.t === 'inviteFail' && x.why === 'slow down').length;
    assert.ok(fails >= 1, 'more than 10 invites a minute are refused');
    b1.json({ t: 'status', where: 'menu' });

    // private messages
    A1.json({ t: 'dm', to: C.id, text: 'hi' });
    assert.strictEqual((await A1.next('dmFail')).why, 'not friends', 'friends only');
    const A2 = await hub(A);
    A1.json({ t: 'dm', to: B.id, text: '  hello\u0007 there,   you shit  ' });
    let dm = await b1.next('dm');
    assert.strictEqual(dm.from.id, A.id); assert.strictEqual(dm.text, 'hello there, you ***', 'cleaned and filtered');
    assert.strictEqual((await A2.next('dm')).to, B.id, "the sender's other phone gets its copy");
    A1.json({ t: 'dm', to: B.id, text: 'x'.repeat(400) });
    assert.strictEqual((await b1.next('dm')).text.length, 300, 'at most 300 characters');
    // unread
    let me = await call('me', {}, B.s);
    assert.strictEqual(me.friends.unread, 2, 'badge: 2 unread');
    assert.strictEqual((await friendRow(B, A.id)).unread, 2, 'and on the row');
    assert.strictEqual((await friendRow(A, B.id)).unread, 0, 'your own messages are not unread');
    await call('dm/read', { id: A.id }, B.s);
    assert.strictEqual((await call('me', {}, B.s)).friends.unread, 0, 'opened: read');
    // burst limit (5 per 3 s in this test; 5 per 10 s for real); a fresh phone, as A1 has used much of its socket's message rate
    await sleep(3100);
    A1.close(); const A1b = await hub(A);
    for (let i = 0; i < 6; i++) A1b.json({ t: 'dm', to: B.id, text: 'm' + i });
    assert.strictEqual((await A1b.next('dmFail')).why, 'slow down', 'the 6th in the burst');
    // mute: kept, not delivered, not unread
    await call('dm/read', { id: A.id }, B.s);
    await call('friend/mute', { id: A.id, on: true }, B.s);
    await sleep(3100); b1.seen = b1.inbox.length;
    A1b.json({ t: 'dm', to: B.id, text: 'muted?' });
    await A1b.next('dm');
    assert.ok(await none(b1, 'dm'), 'muted: not delivered live');
    assert.strictEqual((await call('me', {}, B.s)).friends.unread, 0, 'and not unread');
    assert.strictEqual((await call('dm/list', { id: A.id }, B.s)).lines.slice(-1)[0].text, 'muted?', 'but kept');
    await call('friend/mute', { id: A.id, on: false }, B.s);

    // 100 kept per pair, pages of 30; and 60 an hour per sender
    const E = await player('Eve' + uniq()), F = await player('Fay' + uniq());
    await befriend(E, F);
    const e1 = await hub(E), f1 = await hub(F);
    // one message at a time, each sent once the last one is confirmed; a burst refusal waits and sends again (slow CI machines bunch messages up)
    const deliver = async (ws, to, text) => {
      for (let tries = 0; tries < 20; tries++) {
        const from = ws.inbox.length;
        ws.json({ t: 'dm', to, text });
        const r = await waitFor(() => ws.inbox.slice(from).find((x) => (x.t === 'dm' && x.to === to && x.text === text) || (x.t === 'dmFail' && x.to === to)), 15000);
        if (r.t === 'dm') return;
        assert.strictEqual(r.why, 'slow down', 'only the burst limit refuses here');
        await sleep(1500);
      }
      throw new Error('message never went through');
    };
    const many = async (ws, to, n, tag) => { for (let i = 0; i < n; i++) await deliver(ws, to, tag + i); };
    await Promise.all([many(e1, F.id, 55, 'e'), many(f1, E.id, 55, 'f')]);
    await waitFor(() => e1.inbox.filter((x) => x.t === 'dm').length >= 110, 15000);
    let page = await call('dm/list', { id: F.id }, E.s), all = [...page.lines];
    while (page.more) { page = await call('dm/list', { id: F.id, before: page.lines[0].k }, E.s); all = [...page.lines, ...all]; }
    assert.strictEqual(all.length, 100, 'the last 100 are kept');
    assert.ok(all.every((x, i) => !i || x.k > all[i - 1].k), 'oldest first');
    assert.deepStrictEqual([all[0].text.length > 0, (await call('dm/list', { id: F.id }, E.s)).lines.length], [true, 30], 'pages of 30');
    await many(e1, F.id, 5, 'h'); // 60 sent this hour
    await sleep(3100); // past the burst window, so a refusal now is the hourly limit
    const before = e1.inbox.length;
    e1.json({ t: 'dm', to: F.id, text: 'one too many' });
    assert.strictEqual((await waitFor(() => e1.inbox.slice(before).find((x) => x.t === 'dmFail' || (x.t === 'dm' && x.to === F.id)), 8000)).t, 'dmFail', 'the 61st is refused');
    await sleep(300);
    assert.strictEqual(e1.inbox.filter((x) => x.t === 'dm' && x.to === F.id).length, 60, '60 an hour');

    // removing a friend deletes the pair's messages
    await call('friend/remove', { id: F.id }, E.s);
    await befriend(E, F);
    assert.deepStrictEqual((await call('dm/list', { id: F.id }, E.s)).lines, [], 'removed: messages gone');

    for (const s of [A1b, A2, b1, b2, c1, e1, f1]) s.close();
    console.log('hub: all checks passed');
  } finally { srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
