// Server step 4 check: match history. Starts the server locally (wrangler dev, with HISTORY_FAIL_ROOMS=XF so rooms
// whose code starts with XF have a store that throws), then:
//  - a whole friend's match over WebSockets: one row per fight in /history/<match>, matching what the phones got
//    (round, winner, damage, health after, match over and winner), armies and leaders filled in, no gamertags,
//    a replay kept; /history pages newest first
//  - a tournament match: the gamertags and the tournament code are saved, and a forfeit gets its own row
//  - a failing store: the match goes on (fights come, the next round starts) and nothing is saved
//  - the endpoint: origin check, bad limits and ids refused, the per-IP read limit
// Run: cd server && npm test
const assert = require('assert');
const { startServer, open, sleep, waitFor } = require('./harness.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Bot = require('../../tools/net-bot.js');
const { units, matrix } = require('../src/prepare-units.cjs')(Engine, require('../../src/demo-units.json'));

const ORIGIN = 'http://localhost:8766';
const copy = (o) => JSON.parse(JSON.stringify(o));
const local = (view) => Ref.withUnits(copy(view), units, matrix);
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');

setTimeout(() => { console.error('test timed out'); process.exit(1); }, 5 * 60 * 1000).unref();
(async () => {
  const srv = await startServer(8796, ['--var', 'HISTORY_FAIL_ROOMS:XF']);
  const get = (path, origin = ORIGIN) => fetch(srv.base + path, { headers: origin ? { Origin: origin } : {} });
  const getJson = async (path) => { const r = await get(path); assert.strictEqual(r.status, 200, `${path}: ${r.status} ${await r.clone().text()}`); return r.json(); };
  async function phone(code, hello = {}, tour) {
    const ws = await open(`${srv.ws}/room/${code}${tour ? '?t=' + tour : ''}`);
    ws.json({ t: 'hello', ...hello });
    ws.welcome = await ws.next('welcome', 8000);
    return ws;
  }
  const syncOf = (ws, ok) => waitFor(() => [...ws.inbox].reverse().find((x) => x.t === 'sync' && ok(x)), 15000);
  const fightsOf = (ws) => ws.inbox.filter((x) => x.t === 'fight');
  async function deploySide(ws, side, view, r) {
    const acts = Bot.deploy(local(view), side, { r });
    let seq = ws.seq || 0;
    for (const a of acts) {
      ws.json({ t: 'act', seq: ++seq, fn: a.fn, a: a.a });
      const ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000);
      if (!ack.ok) break;
    }
    ws.seq = seq;
  }
  // one round: both deploy (bot) or not, both Ready; returns the fight
  async function round(a, b, n, r) {
    const va = await syncOf(a, (x) => x.phase === 'deploy' && x.round === n);
    const vb = await syncOf(b, (x) => x.phase === 'deploy' && x.round === n);
    if (r) { await deploySide(a, 0, va.m, r); await deploySide(b, 1, vb.m, r); }
    const before = fightsOf(a).length;
    a.json({ t: 'ready', v: true }); b.json({ t: 'ready', v: true });
    const f = await waitFor(() => fightsOf(a).length > before && fightsOf(a).pop(), 20000);
    if (!f.post.over) { a.json({ t: 'next', round: f.summary.round }); b.json({ t: 'next', round: f.summary.round }); }
    return f;
  }
  const side = (w) => (w === 0 || w === 1 ? w : -1);

  try {
    // ----- a whole friend's match -----
    const code = 'H' + rnd();
    const a = await phone(code, { create: true }), b = await phone(code);
    a.json({ t: 'start', settings: { map: 'forest' } });
    const r = Bot.rng(5), fights = [];
    for (let n = 1; n <= 40; n++) { const f = await round(a, b, n, r); fights.push(f); if (f.post.over) break; }
    assert.ok(fights[fights.length - 1].post.over, 'the match ended');
    const one = await waitFor(async () => { const res = await get(`/history/${code}`); if (res.status !== 200) return null; const j = await res.json(); return j.rounds.length >= fights.length ? j : null; }, 8000);
    assert.strictEqual(one.rounds.length, fights.length, 'one row per fight');
    assert.ok(one.matchId.startsWith(code + '-'), 'match id is the room code and the match');
    one.rounds.forEach((row, k) => {
      const f = fights[k];
      assert.strictEqual(row.round, f.summary.round);
      assert.strictEqual(row.room, code);
      assert.strictEqual(row.winner, side(f.summary.winner), `round ${row.round}: winner`);
      assert.strictEqual(row.timeout, !!f.summary.timeout);
      assert.deepStrictEqual(row.dmg, [f.summary.dmg[0], f.summary.dmg[1]], `round ${row.round}: damage`);
      assert.deepStrictEqual(row.hp, [f.post.hp[0], f.post.hp[1]], `round ${row.round}: health after`);
      assert.strictEqual(row.over, !!f.post.over);
      assert.strictEqual(row.matchWinner, f.post.over ? side(f.post.winner) : null);
      assert.strictEqual(row.names, null, 'no gamertags in a friend\'s match');
      assert.strictEqual(row.tour, null);
      assert.ok(row.map === 'Forest' || row.map.length > 0, 'map');
      assert.strictEqual(row.leaders.length, 2);
      assert.ok(row.look, 'board look');
      assert.ok(row.replay, 'replay kept');
      assert.ok(Array.isArray(row.armies[0]) && Array.isArray(row.skills[1]) && row.towers.length === 2);
    });
    assert.ok(one.rounds.some((row) => row.armies[0].length && row.armies[0][0].unit && row.armies[0][0].level >= 1), 'armies saved with unit and level');
    assert.ok(one.rounds.every((row) => row.leaders.every((x) => x)), 'leaders saved');
    // a match id with the seed gives the same rounds
    assert.strictEqual((await getJson(`/history/${one.matchId}`)).rounds.length, fights.length);
    // the list: newest first, paged
    const p1 = await getJson('/history?limit=2');
    assert.strictEqual(p1.rows.length, 2);
    assert.ok(p1.rows[0].id > p1.rows[1].id, 'newest first');
    assert.strictEqual(p1.rows[0].room, code);
    assert.strictEqual(p1.rows[0].round, fights[fights.length - 1].summary.round);
    const p2 = await getJson(`/history?limit=2&before=${p1.next}`);
    assert.ok(p2.rows[0].id < p1.rows[1].id, 'next page is older');
    a.close(); b.close();
    if (process.env.VERBOSE) console.log(JSON.stringify(one.rounds[one.rounds.length - 1]));
    console.log(`friend's match: ${fights.length} rounds saved and read back`);

    // ----- a tournament match: gamertags, then a forfeit -----
    {
      const tcode = 'T' + rnd();
      const org = await open(`${srv.ws}/tour/${tcode}`);
      org.json({ t: 'create', name: 'History cup', orgName: 'Org', settings: { format: 'elim' } });
      const made = await org.next('created');
      const pl = await open(`${srv.ws}/tour/${tcode}`);
      pl.json({ t: 'hello', name: 'Otto' });
      const j1 = await pl.next('joined');
      await waitFor(() => { const s = org.last('state'); return s && s.tour.players.length === 2 ? s : null; });
      org.json({ t: 'org', op: 'advance' });
      const st = await waitFor(() => { const s = org.last('state'); return s && s.tour.status === 'running' ? s : null; });
      const mt = st.tour.rounds[0].matches[0];
      const hostId = mt[mt.host || 'a'], otherId = hostId === made.id ? j1.id : made.id;
      const keyOf = { [made.id]: made.key, [j1.id]: j1.key };
      const ph = await phone(mt.code, { id: hostId, tkey: keyOf[hostId] }, tcode);
      const pg = await phone(mt.code, { id: otherId, tkey: keyOf[otherId] }, tcode);
      const f = await round(ph, pg, 1, null);
      if (!f.post.over) { await syncOf(ph, (x) => x.phase === 'deploy' && x.round === 2); pg.json({ t: 'forfeit' }); await ph.next('forfeit'); }
      const rows = await waitFor(async () => { const res = await get(`/history/${mt.code}`); if (res.status !== 200) return null; const j = await res.json(); return j.rounds.length >= 2 ? j.rounds : null; }, 8000);
      assert.strictEqual(rows[0].tour, tcode, 'tournament code saved');
      assert.strictEqual(rows[0].match, mt.id, 'tournament match id saved');
      assert.ok(rows[0].names && rows[0].names.includes('Otto') && rows[0].names.includes('Org'), 'gamertags saved');
      assert.strictEqual(rows[1].forfeit, 1, 'the forfeit has its own row');
      assert.ok(rows[1].over && rows[1].matchWinner === 0);
      for (const s of [org, pl, ph, pg]) s.close();
      console.log('tournament match: gamertags and the forfeit saved');
    }

    // ----- a failing store: the match goes on -----
    {
      const xcode = 'XF' + rnd();
      const a2 = await phone(xcode, { create: true }), b2 = await phone(xcode);
      a2.json({ t: 'start', settings: { map: 'forest' } });
      const t0 = Date.now();
      await round(a2, b2, 1, null);
      await round(a2, b2, 2, null);
      await syncOf(a2, (x) => x.phase === 'deploy' && x.round === 3);
      await sleep(500);
      assert.strictEqual((await get(`/history/${xcode}`)).status, 404, 'nothing saved');
      assert.ok(srv.log().includes('history not saved'), 'the failure is logged');
      a2.close(); b2.close();
      console.log(`failing store: two rounds played on (${Date.now() - t0} ms), nothing saved, failure logged`);
    }

    // ----- the endpoint's limits -----
    assert.strictEqual((await get('/history', null)).status, 403, 'no Origin');
    assert.strictEqual((await get('/history', 'https://evil.example')).status, 403, 'another site');
    const ok = await get('/history?limit=1');
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), ORIGIN, 'CORS for the game\'s pages');
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=-1', 'before=1.5']) assert.strictEqual((await get('/history?' + q)).status, 400, q);
    for (const id of ['AB', 'TOOLONGCODE', 'AB$D']) assert.strictEqual((await get('/history/' + encodeURIComponent(id))).status, 400, id);
    assert.strictEqual((await get('/history/ZZZZ9')).status, 404);
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) limited = (await get('/history?limit=1')).status === 429;
    assert.ok(limited, 'reads are limited per IP');
    console.log('endpoint: origin, limits and ids checked, reads rate limited');
    console.log('server step 4 ok (match history)');
  } catch (e) {
    console.log('--- server log (end) ---\n' + srv.log().slice(-4000));
    throw e;
  } finally {
    srv.stop();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
