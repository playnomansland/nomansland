// Friends (2026-11-04; docs/FRIENDS.md): the account routes in accounts.js (FRIENDS).
// Checks:
//  - add by username (any case) or id, accept, decline, cancel, remove; both asking = friends at once
//  - guests are refused, a lookup gives only { id, tag, title }, several players with one username come back as a choice
//  - limits: outgoing requests waiting, new requests a day, username lookups, 100 friends
//  - a username change keeps friends; /account/me carries the badge counts; account delete cleans everything up
// Run: cd server && node test/friends.test.js (also in npm test). Port 8782.
const assert = require('assert');
const { idToken, startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();
const uniq = () => Math.random().toString(36).slice(2, 7);

(async () => {
  const srv = await startAccounts(8782, { ACCOUNT_TAG_FRESH_MS: 3600000 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '10.0.0.' + (1 + Math.floor(Math.random() * 250)) };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  // a signed-in (Google) player with a username
  const player = async (tag) => {
    const g = await call('google', { credential: idToken() });
    assert.strictEqual(g.status, 200, 'google sign-in');
    const t = await call('tag', { tag }, g.session);
    assert.strictEqual(t.status, 200, 'username ' + tag);
    return { id: g.player.id, tag, s: g.session };
  };
  const list = (p) => call('friends', {}, p.s);
  try {
    const A = await player('Ann' + uniq()), B = await player('Bob' + uniq()), C = await player('Cid' + uniq());

    // guests can't
    const guest = await call('guest', { tag: 'Gus' + uniq() });
    assert.strictEqual((await call('friends', {}, guest.session)).status, 403, 'a guest has no friends list');
    assert.strictEqual((await call('friend/add', { id: A.id }, guest.session)).status, 403, 'a guest cannot add');
    assert.strictEqual((await call('friend/add', { id: guest.player.id }, A.s)).status, 404, 'nor be added');
    assert.strictEqual((await call('friends', {})).status, 401, 'signed out');

    // add by username, any case
    let r = await call('friend/add', { tag: B.tag.toUpperCase() }, A.s);
    assert.strictEqual(r.status, 200); assert.ok(r.sent, 'request sent');
    assert.deepStrictEqual(Object.keys(r.player).sort(), ['id', 'tag', 'title'], 'a lookup gives only id, tag and title');
    assert.strictEqual(r.player.id, B.id);
    assert.strictEqual((await call('friend/add', { tag: 'Nobody' + uniq() }, A.s)).status, 404, 'unknown username');
    assert.strictEqual((await call('friend/add', { id: A.id }, A.s)).status, 400, 'not yourself');
    let lb = await list(B), la = await list(A);
    assert.deepStrictEqual(lb.incoming.map((x) => x.id), [A.id], 'B sees the request');
    assert.deepStrictEqual(la.outgoing.map((x) => x.id), [B.id], 'A sees it waiting');
    assert.strictEqual((await call('me', {}, B.s)).friends.requests, 1, 'badge: one request');

    // decline: silent, gone for both
    assert.strictEqual((await call('friend/decline', { id: A.id }, B.s)).status, 200);
    assert.strictEqual((await list(A)).outgoing.length, 0, 'declined: gone for A');
    assert.strictEqual((await list(B)).incoming.length, 0, 'and for B');

    // cancel
    await call('friend/add', { id: B.id }, A.s);
    assert.strictEqual((await call('friend/cancel', { id: B.id }, A.s)).status, 200);
    assert.strictEqual((await list(B)).incoming.length, 0, 'cancelled');

    // accept
    await call('friend/add', { id: B.id }, A.s);
    assert.strictEqual((await call('friend/accept', { id: B.id }, A.s)).status, 404, 'the sender cannot accept their own request');
    assert.strictEqual((await call('friend/accept', { id: A.id }, B.s)).status, 200);
    la = await list(A); lb = await list(B);
    assert.deepStrictEqual(la.friends.map((x) => x.id), [B.id], 'A has B');
    assert.deepStrictEqual(lb.friends.map((x) => x.id), [A.id], 'B has A');
    assert.strictEqual(la.friends[0].online, false, 'offline: no hub open');
    assert.ok(la.friends[0].seen > 0, 'last seen is there');
    assert.strictEqual(la.incoming.length + la.outgoing.length + lb.incoming.length + lb.outgoing.length, 0, 'requests gone');
    assert.strictEqual((await call('friend/add', { id: B.id }, A.s)).friends, true, 'adding a friend again: already friends');

    // both asking = friends at once
    await call('friend/add', { id: C.id }, A.s);
    r = await call('friend/add', { id: A.id }, C.s);
    assert.strictEqual(r.friends, true, 'both asked: friends');
    assert.deepStrictEqual((await list(A)).friends.map((x) => x.id).sort(), [B.id, C.id].sort());

    // a username change keeps friends
    const newTag = 'Bea' + uniq();
    assert.strictEqual((await call('tag', { tag: newTag }, B.s)).status, 200);
    assert.ok((await list(A)).friends.some((x) => x.id === B.id && x.tag === newTag), 'renamed: still a friend, new username');

    // remove: both sides, silent
    assert.strictEqual((await call('friend/remove', { id: C.id }, A.s)).status, 200);
    assert.deepStrictEqual((await list(C)).friends, [], 'removed for C');
    assert.deepStrictEqual((await list(A)).friends.map((x) => x.id), [B.id], 'and for A');

    // dm routes need friends
    assert.strictEqual((await call('dm/list', { id: C.id }, A.s)).status, 403, 'no thread with a non-friend');
    assert.deepStrictEqual((await call('dm/list', { id: B.id }, A.s)).lines, [], 'an empty thread');
    assert.strictEqual((await call('friend/mute', { id: B.id, on: true }, A.s)).muted, true, 'mute');
    assert.strictEqual((await list(A)).friends[0].muted, true, 'kept on the server');
    await call('friend/mute', { id: B.id, on: false }, A.s);

    // several players with one username: a choice, by id
    const same = 'Twin' + uniq();
    const T1 = await player(same), T2 = await player(same);
    r = await call('friend/add', { tag: same }, C.s);
    assert.ok(Array.isArray(r.several) && r.several.length === 2, 'two players with that username');
    assert.deepStrictEqual(r.several.map((x) => x.id).sort(), [T1.id, T2.id].sort());
    assert.ok(r.several.every((x) => Object.keys(x).sort().join() === 'id,tag,title'), 'only id, tag, title');

    // limits: 20 outgoing requests waiting
    const D = await player('Dan' + uniq());
    const many = [];
    for (let i = 0; i < 21; i++) many.push(await player('Q' + i + uniq()));
    for (let i = 0; i < 20; i++) assert.strictEqual((await call('friend/add', { id: many[i].id }, D.s)).status, 200, 'request ' + i);
    r = await call('friend/add', { id: many[20].id }, D.s);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.error, 'too many requests', '21st waiting request refused');
    // 20 new requests a day: cancelling doesn't give more
    for (let i = 0; i < 3; i++) await call('friend/cancel', { id: many[i].id }, D.s);
    r = await call('friend/add', { id: many[20].id }, D.s);
    assert.strictEqual(r.status, 429, '21st request today refused even after cancelling');

    // username lookups: 30 per 10 minutes
    const E = await player('Eve' + uniq());
    let last;
    for (let i = 0; i < 31; i++) last = await call('friend/add', { tag: 'Nope' + i + uniq() }, E.s);
    assert.strictEqual(last.status, 429, 'the 31st lookup is refused');
    assert.strictEqual((await call('friend/add', { id: A.id }, E.s)).status, 200, 'adding by id is not a lookup');

    // 100 friends: the list is full (built up through accepts)
    const F = await player('Fay' + uniq());
    const crowd = [];
    for (let i = 0; i < 100; i++) crowd.push(await player('F' + i + uniq()));
    for (const x of crowd) { await call('friend/add', { id: F.id }, x.s); assert.strictEqual((await call('friend/accept', { id: x.id }, F.s)).status, 200); }
    assert.strictEqual((await list(F)).friends.length, 100, 'a hundred friends');
    const G = await player('Gil' + uniq());
    await call('friend/add', { id: F.id }, G.s);
    r = await call('friend/accept', { id: G.id }, F.s);
    assert.strictEqual(r.status, 409, 'the 101st is refused'); assert.strictEqual(r.error, 'too many friends');
    r = await call('friend/add', { id: F.id }, A.s);
    assert.strictEqual(r.status, 200, 'a request to a full list can still wait');

    // account delete cleans up: friendships, requests, messages
    const H = await player('Hal' + uniq());
    await call('friend/add', { id: A.id }, H.s); await call('friend/accept', { id: H.id }, A.s);
    await call('friend/add', { id: B.id }, H.s);
    assert.ok((await list(A)).friends.some((x) => x.id === H.id));
    assert.strictEqual((await call('delete', {}, H.s)).status, 200);
    assert.ok(!(await list(A)).friends.some((x) => x.id === H.id), 'a deleted account leaves the friends list');
    assert.ok(!(await list(B)).incoming.some((x) => x.id === H.id), 'and its requests go');

    console.log('friends: all checks passed');
  } finally { srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
