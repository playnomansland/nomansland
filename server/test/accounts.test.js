// Server step 5 check: accounts. Starts the server locally with a fresh local D1 database (added to a copy of
// wrangler.toml while the real block is still commented out), a test Google client id, and a local key server that
// plays Google's: this test signs its own ID tokens with an RSA key it made, since tests can't reach Google. Checks:
//  - the switch: without the database the routes answer 503 (checked by reading the config, not by a second server)
//  - origin check and the preflight
//  - guests: id, gamertag, session; /me; renaming; bad tags and tokens refused
//  - Google: a guest who signs in keeps their id ('guest'); a new phone finds the same player ('existing');
//    a fresh Google account makes a new player ('new'); bad audience, issuer, expiry, signature, key id refused
//  - sessions: rotation with a short grace for the old token, sign out (one / all), at most 10 per player
//  - deleting an account: sessions and login gone, the same Google account then makes a new player
//  - the per-IP limit on guest creation
// Run: cd server && npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sleep } = require('./harness.js');
const { CLIENT, KID, other, b64, idToken, startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  // the switch: while wrangler.toml's D1 block is commented out, the live server answers 'accounts off'
  const conf = fs.readFileSync(path.join(__dirname, '../wrangler.toml'), 'utf8');
  assert.ok(/^#?\s*\[\[d1_databases\]\]/m.test(conf), 'wrangler.toml mentions the accounts database');
  assert.ok(/if \(!db\) return json\(\{ error: 'accounts off' \}, 503/.test(fs.readFileSync(path.join(__dirname, '../src/accounts.js'), 'utf8')));
  const srv = await startAccounts(8795, { ACCOUNT_ROTATE_MS: 1500 });

  const call = async (route, body, token, origin = ORIGIN) => {
    const headers = { 'content-type': 'application/json' };
    if (origin) headers.Origin = origin;
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: body === undefined ? '' : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, ...j, headers: r.headers };
  };
  const ok = async (route, body, token) => { const r = await call(route, body, token); assert.strictEqual(r.status, 200, `${route}: ${r.status} ${JSON.stringify(r)}`); return r; };

  try {
    // ----- origin and preflight -----
    assert.strictEqual((await call('guest', {}, null, null)).status, 403, 'no origin');
    assert.strictEqual((await call('guest', {}, null, 'https://evil.example')).status, 403, 'other origin');
    const pre = await fetch(`${srv.base}/account/me`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    assert.strictEqual(pre.status, 204);
    assert.strictEqual(pre.headers.get('access-control-allow-origin'), ORIGIN);
    assert.ok(/authorization/.test(pre.headers.get('access-control-allow-headers')));
    assert.strictEqual((await call('nope', {})).status, 404);
    assert.strictEqual((await fetch(`${srv.base}/account/me`, { headers: { Origin: ORIGIN } })).status, 405, 'GET refused');

    // ----- guests -----
    const g = await ok('guest', {});
    assert.ok(/^p[0-9a-f]{16}$/.test(g.player.id), 'player id');
    assert.ok(/^Guest \d{4}$/.test(g.player.tag), 'guest gamertag');
    assert.strictEqual(g.player.google, false);
    assert.ok(/^[0-9a-f]{64}$/.test(g.session), 'session token');
    assert.strictEqual(g.headers.get('access-control-allow-origin'), ORIGIN);
    const named = await ok('guest', { tag: '  Snet   Ända ' });
    assert.strictEqual(named.player.tag, 'Snet Ända', 'tag cleaned, Swedish letters kept');
    for (const bad of ['a', 'x'.repeat(17), '<b>', 'hi\u0000', 42]) assert.strictEqual((await call('guest', { tag: bad })).status, 400, `bad tag ${JSON.stringify(bad)}`);
    assert.strictEqual((await call('guest', [1])).status, 400, 'body must be an object');
    assert.strictEqual((await call('guest', 'x'.repeat(9000))).status, 413, 'body too big');

    assert.strictEqual((await ok('me', {}, g.session)).player.id, g.player.id);
    assert.strictEqual((await call('me', {})).status, 401, 'no token');
    assert.strictEqual((await call('me', {}, 'f'.repeat(64))).status, 401, 'unknown token');
    assert.strictEqual((await call('me', {}, 'not-hex')).status, 401, 'malformed token');
    assert.strictEqual((await ok('tag', { tag: 'Vilhelm' }, g.session)).player.tag, 'Vilhelm');
    assert.strictEqual((await call('tag', { tag: '' }, g.session)).status, 400);
    assert.strictEqual((await call('tag', { tag: 'Vilhelm' })).status, 401, 'rename needs a session');

    // ----- Google -----
    const sub = '1111' + crypto.randomInt(1e9);
    const s1 = await ok('google', { credential: idToken({ sub }) }, g.session);
    assert.strictEqual(s1.linked, 'guest', 'the guest is kept');
    assert.strictEqual(s1.player.id, g.player.id);
    assert.strictEqual(s1.player.tag, 'Vilhelm');
    assert.strictEqual(s1.player.google, true);
    assert.strictEqual((await call('me', {}, g.session)).status, 401, 'the guest session ends at sign-in');
    const s2 = await ok('google', { credential: idToken({ sub }) });
    assert.strictEqual(s2.linked, 'existing', 'a new phone finds the player');
    assert.strictEqual(s2.player.id, g.player.id);
    const s3 = await ok('google', { credential: idToken({ sub }) }, named.session);
    assert.strictEqual(s3.player.id, g.player.id, 'a guest signing into a known Google account becomes that player');
    const fresh = await ok('google', { credential: idToken() });
    assert.strictEqual(fresh.linked, 'new');
    assert.notStrictEqual(fresh.player.id, g.player.id);
    // a signed-in player signing into another Google account gets that account's player, not a second login
    const other1 = await ok('google', { credential: idToken() }, s2.session);
    assert.strictEqual(other1.linked, 'new');
    assert.strictEqual((await call('me', {}, s2.session)).status, 401, 'the session that switched accounts ends');

    const bad = {
      audience: idToken({ aud: 'someone-else' }), issuer: idToken({ iss: 'https://evil.example' }),
      expired: idToken({ exp: Math.floor(Date.now() / 1000) - 600 }), future: idToken({ iat: Math.floor(Date.now() / 1000) + 3600 }),
      signature: idToken({}, { key: other.privateKey }), kid: idToken({}, { kid: 'nope' }), subject: idToken({ sub: 'a b' }),
      tampered: (() => { const t = idToken({ sub }).split('.'); t[1] = b64({ iss: 'accounts.google.com', aud: CLIENT, sub: '999', exp: 9e9 }); return t.join('.'); })(),
      garbage: 'abc.def.ghi', none: b64({ alg: 'none', kid: KID }) + '.' + b64({ sub: '1', aud: CLIENT, iss: 'accounts.google.com', exp: 9e9 }) + '.',
    };
    for (const [why, cred] of Object.entries(bad)) assert.strictEqual((await call('google', { credential: cred })).status, 401, `refused: ${why}`);
    assert.strictEqual((await call('google', {})).status, 401, 'no credential');

    // ----- sessions -----
    await sleep(1700);   // older than the test rotation (1.5 s)
    const rot = await ok('me', {}, s3.session);
    assert.ok(rot.session && rot.session !== s3.session, 'rotated');
    assert.strictEqual((await ok('me', {}, s3.session)).player.id, g.player.id, 'old token works for a short grace');
    const after = await ok('me', {}, rot.session);
    assert.ok(!after.session, 'a fresh token is not rotated again');
    await ok('signout', {}, rot.session);
    assert.strictEqual((await call('me', {}, rot.session)).status, 401, 'signed out');
    assert.strictEqual((await ok('me', {}, s1.session)).player.id, g.player.id, 'other phones stay signed in');
    const many = [];
    for (let i = 0; i < 11; i++) many.push((await ok('google', { credential: idToken({ sub }) })).session);
    assert.strictEqual((await call('me', {}, many[0])).status, 401, 'at most 10 sessions: the oldest goes');
    assert.strictEqual((await ok('me', {}, many[10])).player.id, g.player.id);
    await ok('signout', { all: true }, many[10]);
    for (const t of [s1.session, many[5]]) assert.strictEqual((await call('me', {}, t)).status, 401, 'signed out everywhere');

    // ----- delete -----
    const d = await ok('google', { credential: idToken({ sub }) });
    await ok('delete', {}, d.session);
    assert.strictEqual((await call('me', {}, d.session)).status, 401);
    const again = await ok('google', { credential: idToken({ sub }) });
    assert.strictEqual(again.linked, 'new', 'a deleted account is not found again');
    assert.notStrictEqual(again.player.id, g.player.id);

    // ----- per-IP limit on guests: 20 requests an hour, refused ones included (7 counted above) -----
    let sent = 7, status = 200;
    while (status !== 429 && sent < 40) { status = (await call('guest', {})).status; sent++; }
    assert.strictEqual(status, 429, 'guest creation is limited');
    assert.strictEqual(sent, 21, 'the 21st in an hour is refused');

    assert.ok(!/[0-9a-f]{64}/.test(srv.log()), 'no session token in the server log');
    console.log('accounts test: all checks passed');
  } catch (e) {
    console.error(e); console.error(srv.log().slice(-3000)); process.exitCode = 1;
  } finally {
    srv.stop();
    setTimeout(() => process.exit(), 500);
  }
})();
