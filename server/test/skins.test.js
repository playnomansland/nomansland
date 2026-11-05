// Unit skins (2026-11-03): looks for one unit, owned by an account (accounts.js SKINS / SKIN_GRANTS, src/shapes.js).
// Checks:
//  - the gamertag in SKIN_GRANTS gets its skin at /account/me (worn), and someone who takes the name later doesn't
//  - a developer has every skin, off until worn; anyone else can't wear a skin they don't own, or an unknown one
//  - POST /account/skin switches a skin on and off
//  - in a friend's match the Room's players list carries each side's worn skins, so the other phone draws them
// Run: cd server && node test/skins.test.js (also in npm test)
const assert = require('assert');
const { open, waitFor } = require('./harness.js');
const { idToken, startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
const newCode = () => 'S' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

(async () => {
  const srv = await startAccounts(8790, { DEV_EMAILS: 'dev@example.com', ACCOUNT_TAG_FRESH_MS: 0 });
  const call = async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  async function phone(code, hello) {
    const ws = await open(`${srv.ws}/room/${code}`);
    ws.json({ t: 'hello', ...hello });
    return { ws, first: await waitFor(() => ws.inbox.find((x) => ['welcome', 'denied', 'full', 'nomatch', 'taken'].includes(x.t)), 8000) };
  }
  try {
    const other = await call('guest', { tag: 'Somebody' });
    assert.deepStrictEqual(other.player.skins, [], 'a new guest has no skins');

    // the named account gets the Champion Brute at its next /me
    const A = await call('guest', { tag: 'Gubbolas Cage' });
    const meA = await call('me', {}, A.session);
    assert.deepStrictEqual(meA.player.skins, [{ id: 'brute-champion', worn: true }], 'Gubbolas Cage gets the Champion Brute, worn');
    // a later account with the same name gets nothing (the grant is done)
    const B = await call('guest', { tag: 'gubbolas cage' });
    assert.deepStrictEqual((await call('me', {}, B.session)).player.skins, [], 'the name later on gives nothing');
    assert.strictEqual((await call('skin', { skin: 'brute-champion', worn: true }, B.session)).status, 400, "can't wear a skin you don't own");
    assert.strictEqual((await call('skin', { skin: 'nope', worn: true }, A.session)).status, 400, 'or an unknown one');
    // the skin follows the account, not the name
    const renamed = await call('tag', { tag: 'Gubbo' }, A.session);
    assert.deepStrictEqual(renamed.player.skins, [{ id: 'brute-champion', worn: true }], 'kept after a rename');

    // a developer has every skin, off until worn
    const dev = await call('google', { credential: idToken({ email: 'dev@example.com', email_verified: true }) });
    assert.deepStrictEqual(dev.player.skins, [{ id: 'brute-champion', worn: false }, { id: 'golem-aquamarine', worn: false }, { id: 'brute-omniper', worn: false }], 'a developer has every skin (all three), off');
    const devOn = await call('skin', { skin: 'brute-champion', worn: true }, dev.session);
    assert.deepStrictEqual(devOn.player.skins, [{ id: 'brute-champion', worn: true }, { id: 'golem-aquamarine', worn: false }, { id: 'brute-omniper', worn: false }], 'and can wear it');
    // one Brute skin at a time: wearing Omni-Per takes Champion off, and back
    const gol = await call('skin', { skin: 'golem-aquamarine', worn: true }, dev.session);
    assert.deepStrictEqual(gol.player.skins.map((k) => k.worn), [true, true, false], 'another unit\'s skin stays on');
    const omni = await call('skin', { skin: 'brute-omniper', worn: true }, dev.session);
    assert.deepStrictEqual(omni.player.skins, [{ id: 'brute-champion', worn: false }, { id: 'golem-aquamarine', worn: true }, { id: 'brute-omniper', worn: true }], 'wearing Omni-Per takes Champion off');
    const champ = await call('skin', { skin: 'brute-champion', worn: true }, dev.session);
    assert.deepStrictEqual(champ.player.skins.map((k) => k.worn), [true, true, false], 'wearing Champion takes Omni-Per off');
    // nobody else has the Omni-Per Brute
    assert.ok(!(await call('me', {}, A.session)).player.skins.some((k) => k.id === 'brute-omniper'), 'a normal account doesn\'t own the Omni-Per Brute');
    assert.strictEqual((await call('skin', { skin: 'brute-omniper', worn: true }, A.session)).status, 400, 'and can\'t wear it');

    // switching off and on
    assert.deepStrictEqual((await call('skin', { skin: 'brute-champion', worn: false }, A.session)).player.skins, [{ id: 'brute-champion', worn: false }], 'off');
    assert.deepStrictEqual((await call('skin', { skin: 'brute-champion', worn: true }, A.session)).player.skins, [{ id: 'brute-champion', worn: true }], 'on again');

    // a friend's match: each side's worn skins in players
    const code = newCode();
    const p0 = await phone(code, { create: true, session: A.session });
    const p1 = await phone(code, { session: other.session });
    assert.strictEqual(p1.first.t, 'welcome');
    assert.deepStrictEqual(p1.first.players.map((x) => x && x.skins), [['brute-champion'], []], 'the joiner sees the creator\'s skin');
    const back = await waitFor(() => [...p0.ws.inbox].reverse().find((x) => x.players && x.players[1]), 8000);
    assert.deepStrictEqual(back.players[0].skins, ['brute-champion'], 'the creator sees it too');
    // a skin switched off isn't sent
    await call('skin', { skin: 'brute-champion', worn: false }, A.session);
    const code2 = newCode();
    await phone(code2, { create: true, session: A.session });
    const q1 = await phone(code2, { session: other.session });
    assert.deepStrictEqual(q1.first.players[0].skins, [], 'not worn: not shown');
    for (const w of [p0.ws, p1.ws]) w.close();
    console.log('skins: all checks passed');
  } finally { srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
