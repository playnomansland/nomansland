// Bug reports (2026-11-04): accounts.js BUG, POST /account/bug -> a post in the Discord forum #bug-reports via a webhook.
// Checks:
//  - with no webhook set: 503 'bugs off' (the page then copies the report and opens Discord)
//  - a report becomes one webhook call: thread_name = first line, content has the text, version, match and info filled in,
//    no pings allowed, the player's gamertag when logged in; the answer links to the new post
//  - too-short text: 400; Discord failing: 502; more than 5 reports in 10 minutes from one IP: 429
// Run: cd server && node test/bugs.test.js (also in npm test)
const assert = require('assert');
const http = require('http');
const { startAccounts } = require('./accounts-env.js');

const ORIGIN = 'http://localhost:8766';
const GUILD = '987654321012345678';
setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();

// a stand-in for Discord's webhook endpoint: keeps what it got, answers like ?wait=true does
function fakeHook() {
  const got = [];
  let fail = false;
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close');
      if (fail) { res.statusCode = 400; return res.end('{"message":"nope"}'); }
      got.push({ url: req.url, body: JSON.parse(body) });
      res.end(JSON.stringify({ id: '111', channel_id: '5550000000000' + got.length }));
    });
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, got, setFail: (v) => { fail = v; } })));
}

(async () => {
  const hook = await fakeHook();
  const call = (srv) => async (route, body, token) => {
    const headers = { 'content-type': 'application/json', Origin: ORIGIN };
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(`${srv.base}/account/${route}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };

  // 1. switched off
  let srv = await startAccounts(8786, {});
  try {
    const r = await call(srv)('bug', { text: 'The Brute is stuck', version: 'v1', match: 'ABCDE-1' });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.error, 'bugs off');
    const me = await call(srv)('guest', {});
    const m2 = await call(srv)('me', {}, me.session);
    assert.ok(!m2.discord || m2.discord.bugs === false, 'me says bugs are off');
    console.log('ok off');
  } finally { srv.stop(); }

  // 2. switched on
  const url = `http://127.0.0.1:${hook.s.address().port}/api/webhooks/123456/abc_DEF-9`;
  srv = await startAccounts(8785, { BUG_WEBHOOK: url, DISCORD_GUILD_ID: GUILD, BUG_TAG: '424242424242' });
  try {
    const c = call(srv);
    const guest = await c('guest', { tag: 'Bugfinder' });
    assert.strictEqual(guest.status, 200);
    const text = 'Brute walked through the wall @everyone\nRound 4, right lane.\n\nIt happened twice.';
    let r = await c('bug', { text, version: '4 Nov 2026 · 6ea8bd1', match: 'QWERT-k3j`x', info: { mode: 'online', round: '4', phase: 'battle', map: 'Standard', board: '3D', device: 'iPhone\nSafari', extra: 'dropped' } }, guest.session);
    assert.strictEqual(r.status, 200, JSON.stringify(r)); assert.strictEqual(r.ok, true);
    assert.strictEqual(r.url, `https://discord.com/channels/${GUILD}/55500000000001`);
    assert.strictEqual(hook.got.length, 1);
    const p = hook.got[0];
    assert.ok(p.url.endsWith('/api/webhooks/123456/abc_DEF-9?wait=true'), p.url);
    assert.strictEqual(p.body.thread_name, 'Brute walked through the wall @everyone');
    assert.deepStrictEqual(p.body.allowed_mentions, { parse: [] });
    assert.deepStrictEqual(p.body.applied_tags, ['424242424242']);
    const body = p.body.content;
    assert.ok(body.startsWith(text), body);
    for (const want of ['Version: `4 Nov 2026 · 6ea8bd1`', 'Match: `QWERT-k3j x`', 'Round: `4`', 'Board: `3D`', 'Device: `iPhone Safari`', 'Player: `Bugfinder (']) assert.ok(body.includes(want), want + '\n' + body);
    assert.ok(!body.includes('dropped'), 'unknown info keys are left out');
    console.log('ok post');

    // not logged in, long first line: title cut to 90
    r = await c('bug', { text: 'x'.repeat(200) });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(hook.got[1].body.thread_name.length, 90);
    assert.ok(hook.got[1].body.content.includes('Player: `not logged in`'));
    assert.ok(hook.got[1].body.content.includes('Match: `none`'));
    console.log('ok anonymous');

    r = await c('bug', { text: ' a ' });
    assert.strictEqual(r.status, 400);
    hook.setFail(true);
    r = await c('bug', { text: 'Discord is down' });
    assert.strictEqual(r.status, 502);
    hook.setFail(false);
    console.log('ok errors');

    // 5 per 10 minutes per IP: 4 used above
    r = await c('bug', { text: 'fifth' });
    assert.strictEqual(r.status, 200);
    r = await c('bug', { text: 'sixth' });
    assert.strictEqual(r.status, 429);
    console.log('ok rate');
    console.log('bugs: all passed');
  } finally { srv.stop(); hook.s.close(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
