// 2v2 room check (server/src/duo.js). Starts the server locally (wrangler dev, with DUO_ANYONE=1 so no developer
// account is needed here), then:
//  - without a developer account (DUO_ANYONE off is checked in the code path: create without it is denied elsewhere)
//    a phone can't make a 2v2 room; with it, the creator is the host in seat A1
//  - three phones join and take the empty seats; the host swaps two seats; a fifth phone is turned away
//  - the host starts with one seat left to the AI; each phone gets its own part (side as in 1v1) on the 2v2 board, with
//    the other pair of players in m.team
//  - seats act on their own part (acked with the server's fingerprint); a teammate sees it (a 'team' message), an
//    opponent doesn't; a teammate's tile is refused
//  - the Vault (src/mpb.js): a put is acked in step with the phone; the teammate sees it, the opponent not yet
//  - all ready: one fight for all four, both lanes before it (duo.pres), which plays back the same in node
//  - a reload gets the same seat back with its key
//  - a room woken from hibernation sends the other team nothing for a hidden action (DUO_TEST_EVICT: the 'evict' message)
//  - a page of another 2v2 version (hello without Duo.V, or another V) is turned away: denied { why: 'version' } (the
//    board's shape may differ, 2026-11-07); the welcome carries the server's V
// Run: cd server && node test/duo.test.js
const assert = require('assert');
const { startServer, open, sleep, waitFor } = require('./harness.js');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Duo = require('../../src/duo.js');
const { units, matrix } = require('../src/prepare-units.cjs')(Engine, Duo.unitSet(require('../../src/demo-units.json'), require('../../src/faction-units.json'))); // the 2v2 units (server/src/units.js duoUnits)

const copy = (o) => JSON.parse(JSON.stringify(o));
const local = (view) => Ref.withUnits(copy(view), units, matrix);
const newCode = () => 'D' + Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'Q');

setTimeout(() => { console.error('test timed out'); process.exit(1); }, 4 * 60 * 1000).unref();
(async () => {
  const srv = await startServer(8791, ['--var', 'DUO_ANYONE:1', '--var', 'DUO_TEST_EVICT:1']);
  try {
    const url = (code) => `${srv.ws}/duo/${code}`;
    async function phone(code, hello = {}) {
      const ws = await open(url(code));
      ws.json({ t: 'hello', v: Duo.V, ...hello });
      ws.welcome = await ws.next('welcome', 8000);
      assert.strictEqual(ws.welcome.v, Duo.V, 'the welcome carries Duo.V');
      return ws;
    }
    const code = newCode();
    // nobody made it yet: a plain join gets nomatch
    const lost = await open(url(code)); lost.json({ t: 'hello', v: Duo.V });
    await lost.next('nomatch', 8000); lost.close();
    // a page of another version (an old page sends no v): turned away before anything else
    for (const v of [undefined, Duo.V - 1]) {
      const old = await open(url(code)); old.json({ t: 'hello', create: true, ...(v === undefined ? {} : { v }) });
      const no = await old.next('denied', 8000); old.close();
      assert.strictEqual(no.why, 'version', 'another version: denied');
    }

    const host = await phone(code, { create: true });
    assert.strictEqual(host.welcome.seat, 0); assert.strictEqual(host.welcome.host, true);
    const p1 = await phone(code), p2 = await phone(code);
    assert.deepStrictEqual([p1.welcome.seat, p2.welcome.seat], [1, 2]);
    const lob = await waitFor(() => { const l = host.last('duolobby'); return l && l.seats.filter(Boolean).length === 3 && l; }, 8000);
    assert.ok(lob.host);
    // the host moves p2 (seat 2, B1) to seat 3 (B2); a non-host can't swap
    p1.json({ t: 'seat', a: 1, b: 3 }); await sleep(300);
    host.json({ t: 'seat', a: 2, b: 3 });
    await waitFor(() => p2.inbox.some((x) => x.t === 'welcome' && x.seat === 3), 8000);
    const l2 = await waitFor(() => { const l = host.last('duolobby'); return l && l.seats[3] && !l.seats[2] && l; }, 8000);
    assert.ok(l2.seats[1], 'seat 1 not swapped by a non-host');
    const p3 = await phone(code); assert.strictEqual(p3.welcome.seat, 2, 'the freed seat');
    const p4 = await open(url(code)); p4.json({ t: 'hello', v: Duo.V }); await p4.next('full', 8000); p4.close();
    // p3 leaves; the host starts with seat 2 left to the AI
    p3.close(); await sleep(300);
    host.json({ t: 'start', settings: {} });
    const phones = { 0: host, 1: p1, 3: p2 };
    const syncs = {};
    for (const k of [0, 1, 3]) syncs[k] = await waitFor(() => [...phones[k].inbox].reverse().find((x) => x.t === 'sync' && x.phase === 'deploy'), 15000);
    for (const k of [0, 1, 3]) {
      const s = syncs[k], own = Duo.SEATS[k];
      assert.strictEqual(s.duo.seat, k); assert.strictEqual(s.duo.lane, own.lane);
      assert.ok(s.m && s.m.team && s.m.team.armies, 'own part and the other pair (m.team)');
      assert.strictEqual(s.m.map.id, 'duo');
      assert.ok(s.m.chars.every((c) => c == null), 'no leaders');
      assert.deepStrictEqual(s.duo.bots, [false, false, true, false]);
    }
    // each phone picks its package and places one squad in its lane
    const acted = {};
    for (const k of [0, 1, 3]) {
      await sleep(400); // the teammate's last squad has reached this phone
      const ws = phones[k], side = Duo.SEATS[k].side, m = local(syncs[k].m);
      m.team = [...ws.inbox].reverse().find((x) => x.t === 'team' || (x.t === 'sync' && x.m))?.team || [...ws.inbox].reverse().find((x) => x.t === 'sync' && x.m).m.team; // the other pair as they stand now
      let seq = 0;
      ws.json({ t: 'act', seq: ++seq, fn: 'choosePack', a: [0] });
      Game.choosePack(m, side, 0);
      let ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000);
      assert.ok(ack.ok, 'pack');
      const sq = m.armies[side][0], ui = sq.unit;
      // a free tile for one more of that unit, if the gold allows
      let spot = null;
      for (const row of Game.zoneRows(side)) { for (let c = 0; c < Game.COLS; c++) if (Game.canPlaceAt(m, side, c, row, ui) && !Game.occupied(m, side, c, row)) { spot = [c, row]; break; } if (spot) break; }
      if (Game.place(m, side, ui, spot[0], spot[1])) {
        ws.json({ t: 'act', seq: ++seq, fn: 'place', a: [ui, spot[0], spot[1]] });
        ack = await waitFor(() => ws.inbox.find((x) => x.t === 'ack' && x.seq === seq), 8000);
        assert.ok(ack.ok, 'place'); assert.strictEqual(ack.h, Ref.sideHash(m, side), 'phone and server in step');
        acted[k] = { spot, round: m.round };
      }
    }
    // the Vault (src/mpb.js, 2026-11-06): the host puts 50 in; the phone's copy hashes as the server's; the teammate
    // sees it, the opponent sees the vault as the round began; every sync carries the vote/draft clock
    {
      host.json({ t: 'sync' }); await sleep(500);
      const hs = [...host.inbox].reverse().find((x) => x.t === 'sync' && x.m), hm = local(hs.m);
      assert.ok(hs.duo.clock && 'vote' in hs.duo.clock && 'draft' in hs.duo.clock, 'duo.clock');
      assert.ok(Game.vaultPut(hm, 0, 50), 'the phone may put 50 in');
      host.json({ t: 'act', seq: 40, fn: 'vaultPut', a: [50] });
      const va = await waitFor(() => host.inbox.find((x) => x.t === 'ack' && x.seq === 40), 8000);
      assert.ok(va.ok, 'vaultPut'); assert.strictEqual(va.h, Ref.sideHash(hm, 0), 'phone and server in step after a Vault move');
      p1.json({ t: 'sync' }); p2.json({ t: 'sync' }); await sleep(600);
      assert.strictEqual([...p1.inbox].reverse().find((x) => x.t === 'sync').m.vault[0].gold, 50, 'the teammate sees the gold');
      assert.strictEqual([...p2.inbox].reverse().find((x) => x.t === 'sync').m.vault[0].gold, 0, 'the opponent sees the vault as the round began');
    }
    // a cheat: an action for a lane that isn't yours is just your own side in your own lane; acting on another side is impossible
    host.json({ t: 'act', seq: 50, fn: 'place', a: [0, 0, 0] });
    const bad = await waitFor(() => host.inbox.find((x) => x.t === 'ack' && x.seq === 50), 8000);
    assert.ok(!bad.ok, 'enemy zone refused');
    // teammate (seat 1) sees seat 0's new squad in mate; opponent of seat 0 in lane 0 is the AI; seat 3 (lane 1, team B)
    // must not see seat 1's new squad
    host.json({ t: 'sync' }); p1.json({ t: 'sync' }); p2.json({ t: 'sync' });
    await sleep(600);
    const s1 = [...p1.inbox].reverse().find((x) => x.t === 'sync');
    const s3 = [...p2.inbox].reverse().find((x) => x.t === 'sync');
    if (acted[0]) assert.ok(s1.m.team.armies[0].some((q) => q.col === acted[0].spot[0] && q.row === acted[0].spot[1] && q.id >= Duo.OFF), 'teammate sees it');
    if (acted[0]) assert.ok(p1.inbox.some((x) => x.t === 'team' && x.team.armies[0].some((q) => q.col === acted[0].spot[0] && q.row === acted[0].spot[1])), 'live, as a team message');
    if (acted[1]) assert.ok(!s3.m.team.armies[0].some((q) => q.col === acted[1].spot[0] && q.row === acted[1].spot[1] && q.round === acted[1].round), 'opponent does not');
    if (acted[0]) { // the teammate can't take that tile
      const m1 = local(s1.m), ui = m1.armies[0][0].unit;
      p1.json({ t: 'act', seq: 60, fn: 'place', a: [ui, acted[0].spot[0], acted[0].spot[1]] });
      const no = await waitFor(() => p1.inbox.find((x) => x.t === 'ack' && x.seq === 60), 8000);
      assert.ok(!no.ok, 'the teammate\'s tile is refused');
    }
    // a reload: same seat back
    const p1b = await phone(code, { key: p1.welcome.key });
    assert.strictEqual(p1b.welcome.seat, 1);
    phones[1] = p1b;
    // team talk: a ? ping and a quick line reach the team only ('ping' itself stays the keep-alive)
    host.json({ t: 'mark', kind: '?', col: 21, row: 12 });
    const mk = await phones[1].next('mark', 8000);
    assert.deepStrictEqual([mk.from, mk.kind, mk.col, mk.row], [0, '?', 21, 12]);
    host.json({ t: 'mark', kind: 'nope', col: 1, row: 1 });
    phones[1].json({ t: 'emote', id: 'help' });
    const em = await host.next('emote', 8000);
    assert.strictEqual(em.id, 'help');
    await sleep(500);
    assert.ok(!phones[3].inbox.some((x) => x.t === 'mark' || x.t === 'emote'), 'the other team hears nothing');
    assert.strictEqual(phones[1].inbox.filter((x) => x.t === 'mark').length, 1, 'an unknown ping kind is dropped');
    // a room woken from hibernation (its in-memory 'what each phone last got' starts empty: the test-only 'evict'
    // clears it as a fresh DuoRoom would): an action hidden from the other team (seat 1 puts gold into the Vault)
    // sends the other team nothing, so they never learn that it (or a hidden vote's 15 s running out) just happened
    {
      await sleep(500);
      phones[1].json({ t: 'evict' }); await sleep(300);
      const b0 = phones[3].inbox.length, h0 = host.inbox.length;
      phones[1].json({ t: 'act', seq: 70, fn: 'vaultPut', a: [10] });
      const va = await waitFor(() => phones[1].inbox.find((x) => x.t === 'ack' && x.seq === 70), 8000);
      assert.ok(va.ok, 'vaultPut after the room woke up');
      await sleep(800);
      assert.deepStrictEqual(phones[3].inbox.slice(b0).map((x) => x.t).filter((t) => t !== 'pong'), [], 'the other team gets no message after a wake-up');
      assert.ok(host.inbox.slice(h0).some((x) => x.t === 'sync' && x.m && x.m.vault[0].gold === 60), 'the teammate sees the Vault move');
    }
    // all ready: one fight
    for (const k of [0, 1, 3]) phones[k].json({ t: 'ready', v: true });
    const fights = {};
    for (const k of [0, 1, 3]) fights[k] = await phones[k].next('fight', 30000);
    for (const k of [0, 1, 3]) {
      const f = fights[k];
      assert.ok(f.duo && f.duo.pres && f.duo.pres.length === 2);
      assert.deepStrictEqual(f.pre, f.duo.pres[Duo.SEATS[k].lane]);
      assert.deepStrictEqual(f.summary.dmg, fights[0].summary.dmg, 'everyone sees the team damage');
    }
    const bt = Duo.battle(fights[0].duo.pres.map(local)); while (bt.step()) {}
    assert.strictEqual(bt.result().winner, fights[0].summary.duo.winner, 'plays back the same in node');
    assert.deepStrictEqual(fights[0].post.hp, fights[3].post.hp, 'shared team health');
    console.log('duo.test: all passed');
  } finally { srv.stop(); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
