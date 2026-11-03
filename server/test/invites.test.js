// Invite a friend and the Discord title (2026-11-03): accounts.js INVITE, countOnline, DISCORD; room.js ended().
// Checks:
//  - only a Google account gets an invite code (guests get 403 'google needed'); the code stays the same
//  - a new account made with { invite } is tied to the inviter once; your own code, a bad code and a second code do nothing
//  - an online match counts for a player only with 3+ fights and when that player didn't leave it
//  - the reward (the Aquamarine Ether Golem skin, worn) comes once the friend has finished an online match AND
//    signed in with Google, whichever happens last; given once however many friends come
//  - Discord: not in the server -> 403 'not in server'; a member gets the BABABABA title; one Discord user, one player
//  - Puzzles: /account/puzzle replays the fight; only a real win counts; all three solved -> the Initiate title
// Run: cd server && node test/invites.test.js (also in npm test)
const assert = require('assert');
const http = require('http');
const { open, waitFor } = require('./harness.js');
const { idToken, startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
const GUILD = '987654321012345678';
const newCode = () => 'V' + Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 6 * 60 * 1000).unref();

// a stand-in for Discord's API: the one-time code says who the user is and whether they joined the server
function fakeDiscord() {
  const tokens = {};
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close');
      const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (req.method === 'POST' && req.url === '/oauth2/token') {
        const p = new URLSearchParams(body), code = p.get('code') || '';
        if (p.get('client_secret') !== 'shh' || !/^(in|out)-\d+$/.test(code)) { res.statusCode = 400; return res.end('{"error":"invalid_grant"}'); }
        const t = 'tok' + Math.random().toString(36).slice(2); tokens[t] = code;
        return res.end(JSON.stringify({ access_token: t, token_type: 'Bearer' }));
      }
      const code = tokens[tok];
      if (!code) { res.statusCode = 401; return res.end('{}'); }
      if (req.url === '/users/@me') return res.end(JSON.stringify({ id: code.split('-')[1], username: 'u' }));
      if (req.url === '/users/@me/guilds') return res.end(JSON.stringify(code.startsWith('in-') ? [{ id: '1' }, { id: GUILD }] : [{ id: '1' }]));
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

(async () => {
  const dc = await fakeDiscord();
  const srv = await startAccounts(8792, { ACCOUNT_TAG_FRESH_MS: 0, DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'shh', DISCORD_GUILD_ID: GUILD,
    DISCORD_INVITE: 'https://discord.gg/test', DISCORD_API: `http://127.0.0.1:${dc.address().port}` });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  async function phone(code, hello) {
    const ws = await open(`${srv.ws}/room/${code}`);
    ws.json({ t: 'hello', ...hello });
    await waitFor(() => ws.inbox.find((x) => x.t === 'welcome'), 8000);
    return ws;
  }
  const nFights = (w) => w.inbox.filter((x) => x.t === 'fight').length;
  // n rounds where nobody deploys, then `leaver` (0 or 1) leaves the match
  async function play(a, b, n, leaver) {
    for (let i = 0; i < n; i++) {
      const before = nFights(a);
      await waitFor(() => { const s = [...a.inbox].reverse().find((x) => x.t === 'sync' || x.t === 'fight'); if (s && s.t === 'sync' && s.phase === 'deploy') return true; a.json({ t: 'sync' }); return false; }, 30000);
      a.json({ t: 'ready', v: true }); b.json({ t: 'ready', v: true });
      const f = await waitFor(() => nFights(a) > before && a.inbox.filter((x) => x.t === 'fight').pop(), 30000);
      assert.ok(!f.post.over, 'nobody wins with empty boards this fast');
      a.json({ t: 'next', round: f.summary.round }); b.json({ t: 'next', round: f.summary.round });
    }
    await waitFor(() => [...a.inbox].reverse().find((x) => x.t === 'sync' && x.phase === 'deploy'), 30000).catch(() => {});
    (leaver === 0 ? a : b).json({ t: 'forfeit' });
    await waitFor(() => a.inbox.find((x) => x.t === 'forfeit'), 8000);
  }
  async function match(sessA, sessB, n, leaver) {
    const code = newCode();
    const a = await phone(code, { create: true, session: sessA });
    const b = await phone(code, sessB ? { session: sessB } : {});
    await waitFor(() => [...a.inbox].reverse().find((x) => x.t === 'lobby' && x.here[1]), 8000);
    a.json({ t: 'start', settings: { map: 'cavern' } });
    await play(a, b, n, leaver);
    a.close(); b.close();
  }
  try {
    // ----- invite codes -----
    const guest = await call('guest', { tag: 'Guesty' });
    assert.deepStrictEqual([(await call('invite', {}, guest.session)).status, (await call('invite', {}, guest.session)).error], [403, 'google needed'], 'guests can\'t invite');
    const I = await call('google', { credential: idToken({ sub: '5551' }) });
    const inv = await call('invite', {}, I.session);
    assert.strictEqual(inv.status, 200);
    assert.match(inv.code, /^[A-Z2-9]{6}$/, 'a 6-letter code');
    assert.deepStrictEqual([inv.friends, inv.rewarded, inv.skin], [[], false, 'golem-aquamarine']);
    assert.strictEqual((await call('invite', {}, I.session)).code, inv.code, 'the same code every time');
    const J = await call('google', { credential: idToken({ sub: '5552' }) }); // a second inviter
    const invJ = await call('invite', {}, J.session);

    // ----- claiming -----
    const F = await call('guest', { tag: 'Friendo', invite: inv.code.toLowerCase() });
    assert.strictEqual(F.status, 200);
    let list = (await call('invite', {}, I.session)).friends;
    assert.deepStrictEqual(list, [{ tag: 'Friendo', google: false, played: false, done: false }], 'the friend shows up for the inviter');
    await call('me', { invite: invJ.code }, F.session); // a second code later on doesn't move them
    assert.strictEqual((await call('invite', {}, J.session)).friends.length, 0, 'tied to the first inviter only');
    await call('me', { invite: inv.code }, I.session);
    assert.strictEqual((await call('invite', {}, I.session)).friends.length, 1, 'your own code does nothing');
    assert.strictEqual((await call('guest', { invite: 'ZZZZZ!' })).status, 200, 'a bad code is ignored, the account is still made');

    // ----- online matches -----
    await match(I.session, F.session, 2, 0); // 2 fights: too short
    assert.strictEqual((await call('invite', {}, I.session)).friends[0].played, false, 'a match of 2 fights doesn\'t count');
    await match(I.session, F.session, 3, 1); // the friend left
    assert.strictEqual((await call('invite', {}, I.session)).friends[0].played, false, 'leaving the match doesn\'t count');
    await match(I.session, F.session, 3, 0); // the inviter left: the friend finished it
    list = await waitFor(async () => { const x = (await call('invite', {}, I.session)).friends; return x[0].played && x; }, 8000);
    assert.deepStrictEqual(list[0], { tag: 'Friendo', google: false, played: true, done: false }, 'played, but not a confirmed account yet');
    assert.ok(!(await call('me', {}, I.session)).player.skins.some((k) => k.id === 'golem-aquamarine'), 'no reward yet');

    // the friend signs in with Google: now it's complete
    const FG = await call('google', { credential: idToken({ sub: '5553' }) }, F.session);
    assert.strictEqual(FG.linked, 'guest');
    const after = await call('invite', {}, I.session);
    assert.deepStrictEqual([after.friends[0].google, after.friends[0].done, after.rewarded], [true, true, true], 'done, and the reward given');
    assert.deepStrictEqual((await call('me', {}, I.session)).player.skins, [{ id: 'golem-aquamarine', worn: true }], 'the inviter has the Aquamarine Golem, worn');
    assert.deepStrictEqual((await call('me', {}, FG.session)).player.skins, [], 'the friend doesn\'t');

    // the other order: Google first, then the match. And a second friend gives nothing more.
    const G = await call('google', { credential: idToken({ sub: '5554' }), invite: invJ.code });
    assert.strictEqual((await call('invite', {}, J.session)).friends[0].google, true);
    await match(G.session, J.session, 3, 1); // J left: G finished it
    await waitFor(async () => (await call('invite', {}, J.session)).rewarded, 8000);
    const H = await call('google', { credential: idToken({ sub: '5555' }), invite: invJ.code });
    await match(H.session, J.session, 3, 1);
    const twice = await waitFor(async () => { const x = await call('invite', {}, J.session); return x.friends.every((f) => f.done) && x; }, 8000);
    assert.deepStrictEqual(twice.friends.map((f) => f.done), [true, true]);
    assert.deepStrictEqual((await call('me', {}, J.session)).player.skins, [{ id: 'golem-aquamarine', worn: true }], 'the skin once');
    // an account that has already played online can't be counted as invited later
    assert.ok((await call('me', { invite: inv.code }, H.session)).player);
    assert.strictEqual((await call('invite', {}, I.session)).friends.length, 1, 'not a new player any more');

    // ----- Discord -----
    const me1 = await call('me', {}, guest.session);
    assert.deepStrictEqual(me1.discord, { clientId: 'cid', invite: 'https://discord.gg/test', check: true }, '/me tells the page how to reach Discord');
    const redirect = ORIGIN + '/';
    const out = await call('discord', { code: 'out-111', redirect }, guest.session);
    assert.deepStrictEqual([out.status, out.error, out.invite], [403, 'not in server', 'https://discord.gg/test'], 'not in the server: no title');
    assert.strictEqual((await call('discord', { code: 'in-111', redirect: 'https://evil.example/' }, guest.session)).status, 400, 'only our own pages as redirect');
    assert.strictEqual((await call('discord', { code: 'nope-1', redirect }, guest.session)).status, 401, 'a bad code');
    const ok = await call('discord', { code: 'in-111', redirect }, guest.session);
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.player.titles.includes('bababa') && ok.player.discord, 'BABABABA');
    const pick = await call('title', { title: 'bababa' }, guest.session);
    assert.strictEqual(pick.player.title, 'bababa', 'and it can be shown');
    assert.deepStrictEqual([(await call('discord', { code: 'in-111', redirect }, I.session)).status], [409], 'one Discord user, one player');
    assert.strictEqual((await call('title', { title: 'bababa' }, I.session)).status, 400, 'not earned: can\'t pick it');
    assert.strictEqual((await call('discord', { code: 'in-111', redirect }, guest.session)).status, 200, 'checking again is fine');

    // ----- Puzzles: the Initiate title (the server replays the fight) -----
    const puz = (k, army, s = I.session) => call('puzzle', { k, army }, s);
    assert.strictEqual((await puz(9, [])).status, 400, 'no such puzzle');
    let r = await puz(0, [['Sniper', 5, 12], ['Sniper', 6, 12]]);
    assert.deepStrictEqual([r.status, r.won, r.solved], [200, false, []], 'Snipers lose The horde: not solved');
    r = await puz(0, [['Fire Mage', 5, 2]]);
    assert.strictEqual(r.won, false, 'a tile outside the zone is refused');
    r = await puz(0, [['Ent', 5, 12]]);
    assert.strictEqual(r.won, false, 'a unit the puzzle does not sell');
    r = await puz(0, [['Fire Mage', 5, 12], ['Fire Mage', 6, 12]]);
    assert.deepStrictEqual([r.won, r.solved, r.player.puzzles], [true, [0], [0]], 'Fire Mages win The horde');
    assert.ok(!r.player.titles.includes('initiate'), 'one puzzle is not the title');
    r = await puz(0, [['Sniper', 5, 12]]);
    assert.deepStrictEqual([r.won, r.solved], [true, [0]], 'a solved puzzle stays solved');
    r = await puz(1, [['Goblin Swarm', 5, 10], ['Goblin Swarm', 6, 10], ['Goblin Swarm', 4, 10]]);
    assert.deepStrictEqual([r.won, r.solved], [true, [0, 1]], 'Goblins beat Two giants');
    r = await puz(2, [['Sniper', 3, 15], ['Sniper', 5, 15], ['Sniper', 7, 15]]);
    assert.deepStrictEqual([r.won, r.solved], [true, [0, 1, 2]], 'Snipers beat Out of reach');
    assert.ok(r.player.titles.includes('initiate'), 'all three: Initiate');
    assert.strictEqual((await call('title', { title: 'initiate' }, I.session)).player.title, 'initiate', 'and it can be shown');
    assert.strictEqual((await call('title', { title: 'initiate' }, guest.session)).status, 400, 'not earned: can\'t pick it');
    console.log('invites, discord and puzzles: all checks passed');
  } finally { srv.stop(); dc.close(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
