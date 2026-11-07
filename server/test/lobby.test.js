// The online lobby (2026-11-04, docs/LOBBY.md; server/src/lobby.js). Starts the server locally with accounts, then:
//  - public rooms appear in the list (snapshot on hello, GET /lobby) and changes come as room / gone; private rooms never
//  - a card has what the page sorts and shows: host, mode, players, phase, round, watchers, made time
//  - Join is the usual hello {}; a room leaves the list when the host leaves the waiting room, and when the match is over
//  - Quick play: the oldest open public Standard room (never your own), else create
//  - nobody is in the same room twice: the account that has side 0 is refused side 1 (denied 'here'), its own phone
//    still comes back by its key; a room nobody is in closes by itself (its code answers nomatch after that)
//  - ranked rooms: an account is needed to make one and to join one; they list as mode 'ranked'
//  - 2v2 rooms list only for developer sockets (config lobby_duo = 'dev'); lobby_duo 'all' shows them to everyone;
//    2v2 chat: Team to the teammate only, All and emotes to everyone
//  - spectating: on by default; the host turns it off and watchers are turned away (denied 'no watchers')
//  - heartbeat: a listed room stays while it sends its heartbeat; a listing that stops (a fake one) goes after LOBBY_STALE_MS
//  - limits: 3 lobby sockets per IP, 10 public rooms per 10 minutes per IP
// Run: cd server && node test/lobby.test.js (also in npm test). Port 8780.
const assert = require('assert');
const { open, sleep, waitFor } = require('./harness.js');
const { idToken, startAccounts } = require('./accounts-env.js');
const Duo = require('../../src/duo.js');

const ORIGIN = 'http://localhost:8766';
const newCode = () => 'L' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 6 * 60 * 1000).unref();

(async () => {
  const srv = global.srv = await startAccounts(8780, { DEV_EMAILS: 'dev@example.com', LOBBY_TEST: '1', LOBBY_HEARTBEAT_MS: 1500, LOBBY_STALE_MS: 4000, ROOM_EMPTY_MS: 2500 });
  const step = (x) => process.env.VERBOSE && console.log(x);
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const snapshot = async () => (await (await fetch(`${srv.base}/lobby`, { headers: { Origin: ORIGIN } })).json()).rooms;
  async function lobby(session) {
    const ws = await open(`${srv.ws}/lobby`);
    ws.json({ t: 'hello', ...(session ? { session } : {}) });
    ws.rooms = (await ws.next('rooms', 8000)).list;
    return ws;
  }
  // the list as a lobby socket sees it now (its snapshot plus the changes after it)
  const listOf = (ws) => {
    const m = new Map();
    let snap = -1;
    ws.inbox.forEach((x, i) => { if (x.t === 'rooms') snap = i; });
    for (const l of ws.inbox[snap].list) m.set(l.code, l);
    for (const x of ws.inbox.slice(snap + 1)) { if (x.t === 'room') m.set(x.listing.code, x.listing); if (x.t === 'gone') m.delete(x.code); }
    return m;
  };
  async function phone(code, hello, path = 'room') {
    const ws = await open(`${srv.ws}/${path}/${code}`);
    ws.json({ t: 'hello', ...(path === 'duo' ? { v: Duo.V } : {}), ...hello }); // (a 2v2 hello carries the page's Duo.V, 2026-11-07)
    ws.first = await waitFor(() => ws.inbox.find((x) => ['welcome', 'denied', 'full', 'nomatch', 'taken'].includes(x.t)), 8000);
    return ws;
  }
  const g1 = await call('google', { credential: idToken({ email: 'a@example.com', email_verified: true }) });
  const g2 = await call('google', { credential: idToken({ email: 'b@example.com', email_verified: true }) });
  const dev = await call('google', { credential: idToken({ email: 'dev@example.com', email_verified: true }) });
  assert.strictEqual(dev.player.dev, true);

  // ----- listings appear and vanish -----
  const L = await lobby();
  assert.ok(Array.isArray(L.rooms));
  const priv = newCode(), pub = newCode();
  const p0 = await phone(priv, { create: true, session: g1.session });
  assert.strictEqual(p0.first.t, 'welcome');
  const h0 = await phone(pub, { create: true, public: true, session: g2.session, map: 'testgrid' });
  assert.strictEqual(h0.first.t, 'welcome');
  const rs = await h0.next('roomset');
  assert.strictEqual(rs.pub, true); assert.strictEqual(rs.spectate, true, 'spectating is on by default');
  let card = await waitFor(() => listOf(L).get(pub), 8000);
  assert.ok(!listOf(L).has(priv), 'a private room is never listed');
  assert.strictEqual(card.mode, 'standard'); assert.strictEqual(card.kind, 'match');
  assert.strictEqual(card.host.tag, g2.player.tag); assert.strictEqual(card.players, 1); assert.strictEqual(card.seats, 2);
  assert.strictEqual(card.phase, 'waiting'); assert.strictEqual(card.map, 'Standard'); assert.ok(card.at > 0);
  assert.ok(!('owner' in card), 'nothing of the server\'s own on a card');
  assert.ok((await snapshot()).some((l) => l.code === pub), 'GET /lobby has it too');
  step('listed');

  // Join from the list: the usual hello; the card shows 2 players
  const j1 = await phone(pub, {});
  assert.strictEqual(j1.first.side, 1);
  await waitFor(() => listOf(L).get(pub) && listOf(L).get(pub).players === 2, 8000);
  // the joiner leaves before the start: side 1 is free again for someone else from the list
  j1.close();
  await waitFor(() => listOf(L).get(pub) && listOf(L).get(pub).players === 1, 8000);
  const j2 = await phone(pub, {});
  assert.strictEqual(j2.first.t, 'welcome'); assert.strictEqual(j2.first.side, 1, 'a public waiting room takes a new player');
  // a watcher: counted on the card
  const w1 = await phone(pub, { watch: true });
  assert.strictEqual(w1.first.side, -1);
  await waitFor(() => listOf(L).get(pub) && listOf(L).get(pub).watchers === 1, 10000);
  // start: playing, round 1
  h0.json({ t: 'start', settings: { map: 'testgrid' } });
  await waitFor(() => listOf(L).get(pub) && listOf(L).get(pub).phase === 'playing', 8000);
  assert.strictEqual(listOf(L).get(pub).round, 1);
  // spectating off: the watcher is turned away, new ones too, and the card says so
  h0.json({ t: 'spectate', on: false });
  const den = await w1.next('denied', 8000);
  assert.strictEqual(den.why, 'no watchers');
  const w2 = await phone(pub, { watch: true });
  assert.strictEqual(w2.first.t, 'denied'); assert.strictEqual(w2.first.why, 'no watchers');
  await waitFor(() => listOf(L).get(pub) && listOf(L).get(pub).spectate === false, 8000);
  j2.json({ t: 'spectate', on: true }); // only the host may
  await sleep(500);
  assert.strictEqual(listOf(L).get(pub).spectate, false);
  h0.json({ t: 'spectate', on: true });
  await waitFor(() => listOf(L).get(pub).spectate === true, 8000);
  // the match is over (a forfeit): off the list
  j2.json({ t: 'forfeit' });
  await waitFor(() => !listOf(L).has(pub), 8000);
  step('join, watch, spectate, over');

  // the host leaves a waiting room: off the list
  const pub2 = newCode();
  const h2 = await phone(pub2, { create: true, public: true });
  assert.strictEqual(h2.first.t, 'welcome', 'a guest may make a public room');
  await waitFor(() => listOf(L).has(pub2), 8000);
  assert.strictEqual(listOf(L).get(pub2).host.tag, 'Player', 'no account: a plain name');
  h2.close();
  await waitFor(() => !listOf(L).has(pub2), 8000);

  // ----- heartbeat: a listed room stays past the stale time; a listing without one goes -----
  const pub3 = newCode();
  const h3 = await phone(pub3, { create: true, public: true, session: g1.session });
  await waitFor(() => listOf(L).has(pub3), 8000);
  const fake = newCode();
  assert.ok((await (await fetch(`${srv.base}/lobby?fake=${fake}`, { headers: { Origin: ORIGIN } })).json()).ok);
  await waitFor(() => listOf(L).has(fake), 8000);
  await sleep(7000);
  assert.ok(listOf(L).has(pub3), 'the heartbeat keeps a room listed');
  assert.ok(!listOf(L).has(fake), 'a listing not heard from goes by itself');
  step('heartbeat');

  // one listed room per player: a second public room of the same account takes the first one's place
  const pub4 = newCode();
  const h4 = await phone(pub4, { create: true, public: true, session: g1.session });
  await waitFor(() => listOf(L).has(pub4) && !listOf(L).has(pub3), 8000);
  h3.close();

  // ----- Quick play -----
  const q = await lobby();
  q.json({ t: 'quick' });
  const qa = await q.next('quick');
  assert.strictEqual(qa.code, pub4, 'quick play: the open public Standard room');
  h4.close();
  await waitFor(() => !listOf(L).has(pub4), 8000);
  q.json({ t: 'quick' });
  const qb = await q.next('quick');
  assert.strictEqual(qb.create, true, 'none open: make one');
  q.close();
  step('quick');

  // ----- nobody is in the same room twice, and a room nobody is in closes by itself -----
  const mine = newCode();
  const h5 = await phone(mine, { create: true, public: true, session: g2.session });
  assert.strictEqual(h5.first.t, 'welcome');
  await waitFor(() => listOf(L).has(mine), 8000);
  // the host's own account is refused the other side (another phone, another tab, the list or the code)
  const self1 = await phone(mine, { session: g2.session });
  assert.deepStrictEqual([self1.first.t, self1.first.why], ['denied', 'here'], 'the same account can\'t take both sides');
  self1.close();
  // its own phone comes back by its key as side 0, of course
  const back = await phone(mine, { key: h5.first.key, session: g2.session });
  assert.strictEqual(back.first.side, 0, 'a reconnect with the key gets side 0 back');
  // quick play hands that room to anyone but its own host
  const q2 = await lobby(g2.session), q3 = await lobby(g1.session);
  q2.json({ t: 'quick' });
  assert.strictEqual((await q2.next('quick')).create, true, 'quick play never picks your own room');
  q3.json({ t: 'quick' });
  assert.strictEqual((await q3.next('quick')).code, mine, 'another player gets it');
  q2.close(); q3.close();
  const foe2 = await phone(mine, { session: g1.session });
  assert.strictEqual(foe2.first.side, 1, 'another account takes side 1');
  // everyone leaves: the room goes off the list and closes itself (ROOM_EMPTY_MS = 2.5 s here, a minute for real)
  back.close(); foe2.close();
  await waitFor(() => !listOf(L).has(mine), 8000);
  await sleep(4000);
  const after = await phone(mine, { session: g1.session });
  assert.strictEqual(after.first.t, 'nomatch', 'the room closed by itself: its code is free again');
  after.close();
  step('one room once, empty rooms close');

  // ----- ranked: an account to make and to join -----
  const rk = newCode();
  const rNo = await phone(rk, { create: true, ranked: true, public: true });
  assert.strictEqual(rNo.first.t, 'denied'); assert.strictEqual(rNo.first.why, 'account');
  const rh = await phone(rk, { create: true, ranked: true, public: true, session: g1.session });
  assert.strictEqual(rh.first.t, 'welcome');
  card = await waitFor(() => listOf(L).get(rk), 8000);
  assert.strictEqual(card.mode, 'ranked'); assert.strictEqual(card.map, 'Standard');
  const rj = await phone(rk, {});
  assert.strictEqual(rj.first.t, 'denied'); assert.strictEqual(rj.first.why, 'account', 'joining a ranked room needs an account');
  const rj2 = await phone(rk, { session: g2.session });
  assert.strictEqual(rj2.first.t, 'welcome');
  rh.close(); rj2.close();
  step('ranked');

  // ----- 2v2: developer sockets only (lobby_duo 'dev') -----
  const D = await lobby(dev.session);
  const duo = newCode() + 'D';
  const dNo = await phone(duo, { create: true, public: true, session: g1.session }, 'duo');
  assert.strictEqual(dNo.first.t, 'denied'); assert.strictEqual(dNo.first.why, 'dev', 'only developers make 2v2 rooms');
  const dh = await phone(duo, { create: true, public: true, session: dev.session }, 'duo');
  assert.strictEqual(dh.first.t, 'welcome');
  // 2v2 chat: Team goes to the teammate only, All to everyone; the lobby's emotes go to everyone
  const mate = await phone(duo, { session: g1.session }, 'duo'), foe = await phone(duo, { session: g2.session }, 'duo');
  assert.deepStrictEqual([dh.first.seat, mate.first.seat, foe.first.seat], [0, 1, 2]);
  dh.json({ t: 'chat', text: 'push left', team: true });
  assert.strictEqual((await mate.next('chat')).team, true);
  dh.json({ t: 'chat', text: 'hello all' });
  const all = await foe.next('chat');
  assert.strictEqual(all.text, 'hello all', 'the other team gets All, never Team');
  assert.ok(!foe.inbox.some((x) => x.t === 'chat' && x.text === 'push left'));
  foe.json({ t: 'emote', id: 'bababa' });
  assert.deepStrictEqual([(await dh.next('emote')).from, (await mate.next('emote')).id], [2, 'bababa']);
  mate.close(); foe.close();
  card = await waitFor(() => listOf(D).get(duo), 8000);
  assert.strictEqual(card.mode, '2v2'); assert.strictEqual(card.seats, 4); assert.strictEqual(card.dev, true);
  await sleep(1500);
  assert.ok(!listOf(L).has(duo), 'a player\'s lobby never sees a 2v2 room');
  assert.ok(!(await snapshot()).some((l) => l.code === duo), 'nor GET /lobby');
  // quick play never picks 2v2 (nor ranked)
  D.json({ t: 'quick' });
  assert.strictEqual((await D.next('quick')).create, true);
  // lobby_duo: only a developer may flip it
  assert.strictEqual((await call('lobbyduo', { v: 'all' }, g1.session)).status, 403);
  assert.strictEqual((await call('lobbyduo', { v: 'all' }, dev.session)).v, 'all');
  const duo2 = newCode() + 'E';
  const dAll = await phone(duo2, { create: true, public: true, session: g1.session }, 'duo');
  assert.strictEqual(dAll.first.t, 'welcome', 'lobby_duo all: anyone may make a 2v2 room');
  await sleep(61_000); // the lobby re-reads the switch once a minute
  dAll.json({ t: 'sync' }); // a change brings the card again (now as dev: false)
  const L2 = await lobby();
  await waitFor(() => listOf(L2).get(duo2) && listOf(L2).get(duo2).dev === false, 15000);
  assert.strictEqual((await call('lobbyduo', { v: 'dev' }, dev.session)).v, 'dev');
  dh.close(); dAll.close();
  step('2v2');

  // ----- limits -----
  // 3 lobby sockets per IP (L, D and L2 are open)
  await assert.rejects(open(`${srv.ws}/lobby`), 'a 4th lobby screen from one IP is refused');
  // 10 public rooms per 10 minutes per IP (so far: pub, pub2, pub3, pub4, rk x1 claimed + duo2... count the rest)
  let refused = null;
  for (let i = 0; i < 12 && !refused; i++) {
    const x = await phone(newCode(), { create: true, public: true });
    if (x.first.t === 'denied') refused = x.first; else x.close();
  }
  assert.ok(refused && refused.why === 'slow down', 'too many public rooms from one IP');
  const okPriv = await phone(newCode(), { create: true });
  assert.strictEqual(okPriv.first.t, 'welcome', 'a private room is never limited by the lobby');
  step('limits');

  srv.stop();
  console.log('lobby ok (listings, join, watch, spectate toggle, quick play, ranked, 2v2 for developers, heartbeat, limits)');
  process.exit(0);
})().catch((e) => { console.error(e); if (process.env.VERBOSE && global.srv) console.error(global.srv.log().slice(-4000)); process.exit(1); });
