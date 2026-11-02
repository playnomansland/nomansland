// Step 2 check: the server keeps tournaments.
//  - the organizer creates one and gets a secret key; a second create on the same code is refused
//  - players join and get their own keys; only the organizer's connection can run organizer actions
//  - a player can only report their own match; someone with a player's id but not their key can't act as them
//  - the tournament survives the organizer disconnecting, and the organizer gets their powers back with the key
//  - a dropped player is told; ending the tournament tells everyone and deletes it
//  - a practice tournament's bot-vs-bot matches are played by the server
// Run: cd server && npm test
const assert = require('assert');
const { startServer, open, sleep, waitFor, closed } = require('./harness.js');

(async () => {
  const srv = await startServer(8798);
  const tourUrl = (code) => `${srv.ws}/tour/${code}`;
  const step = (x) => process.env.VERBOSE && console.log(x);
  try {
    const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'X');

    // create
    const org = await open(tourUrl(code));
    org.json({ t: 'create', name: 'Sunday cup', orgName: 'Vilhelm', settings: { format: 'swiss', deploy: 60, evil: 1 } });
    const made = await org.next('created');
    assert.ok(made.id && made.key && made.key.length >= 32);
    let st = await org.next('state');
    assert.strictEqual(st.tour.name, 'Sunday cup');
    assert.strictEqual(st.tour.org, made.id);
    assert.strictEqual(st.tour.settings.deploy, 60);
    assert.strictEqual(st.tour.settings.evil, undefined, 'unknown settings are dropped');
    assert.ok(!JSON.stringify(st).includes(made.key), 'keys never go out in the state');
    const again = await open(tourUrl(code));
    again.json({ t: 'create', name: 'Hijack' });
    await again.next('taken');
    step('create ok');

    // players join
    const p1 = await open(tourUrl(code)), p2 = await open(tourUrl(code)), p3 = await open(tourUrl(code));
    p1.json({ t: 'hello', name: 'Otto' }); const j1 = await p1.next('joined');
    p2.json({ t: 'hello', name: 'Anna' }); const j2 = await p2.next('joined');
    p3.json({ t: 'hello', name: 'Bo' }); const j3 = await p3.next('joined');
    st = await waitFor(() => { const s = org.last('state'); return s && s.tour.players.length === 4 ? s : null; });
    assert.deepStrictEqual(st.tour.players.map((p) => p.name).sort(), ['Anna', 'Bo', 'Otto', 'Vilhelm']);
    assert.strictEqual(st.online.length, 4);
    step('join ok');

    // a player can't run organizer actions
    p1.json({ t: 'org', op: 'advance' });
    p1.json({ t: 'org', op: 'name', a: { name: 'Mine now' } });
    await sleep(300);
    assert.strictEqual(org.last('state').tour.status, 'lobby');
    assert.strictEqual(org.last('state').tour.name, 'Sunday cup');

    // the organizer can
    org.json({ t: 'org', op: 'settings', a: { bestOf: 3, deploy: 'lots' } });
    org.json({ t: 'org', op: 'advance' });
    st = await waitFor(() => { const s = p1.last('state'); return s && s.tour.status === 'running' ? s : null; });
    assert.strictEqual(st.tour.settings.bestOf, 3);
    assert.strictEqual(st.tour.settings.deploy, 60, 'a bad value is ignored');
    const round = st.tour.rounds[0];
    assert.ok(round.map, 'the round got a map');
    step('organizer actions ok');

    // results: the server referees human matches (step 3), so a phone's report doesn't count ...
    const mine = round.matches.find((mt) => mt.a === j1.id || mt.b === j1.id);
    const other = round.matches.find((mt) => mt !== mine);
    p1.json({ t: 'result', match: mine.id, game: 0, code: mine.code, winner: mine.a === j1.id ? 'a' : 'b', hp: [40, 0], rounds: 6 });
    await sleep(300);
    assert.ok(!p1.last('state').tour.rounds[0].matches.find((mt) => mt.id === mine.id).result, 'a phone can\'t report a server-refereed match');
    // ... unless the organizer switched back to phone-to-phone matches; then only your own match counts
    org.json({ t: 'org', op: 'settings', a: { net: 'peer' } });
    await waitFor(() => { const s = p1.last('state'); return s && s.tour.settings.net === 'peer' ? s : null; });
    p1.json({ t: 'result', match: other.id, game: 0, winner: 'a', hp: [50, 0], rounds: 5 });
    await sleep(300);
    assert.ok(!p1.last('state').tour.rounds[0].matches.find((mt) => mt.id === other.id).result, 'no result for someone else\'s match');
    p1.json({ t: 'result', match: mine.id, game: 0, code: mine.code, winner: mine.a === j1.id ? 'a' : 'b', hp: [40, 0], rounds: 6 });
    st = await waitFor(() => { const s = org.last('state'); return s && s.tour.rounds[0].matches.find((mt) => mt.id === mine.id).result ? s : null; });
    step('results ok');

    // someone with Anna's id but not her key: the tournament has started, so they're turned away
    const fake = await open(tourUrl(code));
    fake.json({ t: 'hello', id: j2.id, key: 'not-her-key', name: 'Anna' });
    await fake.next('closed');
    step('impersonation refused');

    // the organizer's phone goes away; the tournament stays and the organizer comes back with the key
    org.close();
    await sleep(300);
    assert.ok(!p2.last('state').online.includes(made.id), 'organizer shown offline');
    const org2 = await open(tourUrl(code));
    org2.json({ t: 'hello', id: made.id, key: made.key });
    st = await org2.next('state');
    assert.strictEqual(st.tour.status, 'running');
    org2.json({ t: 'org', op: 'swapHost', a: { id: other.id } });
    await waitFor(() => { const s = p3.last('state'); const mt = s && s.tour.rounds[0].matches.find((x) => x.id === other.id); return mt && mt.host === 'b'; });
    step('organizer reconnect ok');

    // ending tells everyone and deletes it
    org2.json({ t: 'org', op: 'end' });
    await p1.next('ended');
    const late = await open(tourUrl(code));
    late.json({ t: 'hello', id: j3.id, key: 'x' });
    await late.next('gone');
    step('end ok');

    // lobby kick
    const code2 = code.slice(0, 3) + 'K';
    const o3 = await open(tourUrl(code2));
    o3.json({ t: 'create', name: 'Kick test' }); await o3.next('created');
    const k1 = await open(tourUrl(code2)); k1.json({ t: 'hello', name: 'Leaving' }); const kj = await k1.next('joined');
    o3.json({ t: 'org', op: 'drop', a: { id: kj.id } });
    await k1.next('kicked');
    o3.json({ t: 'org', op: 'end' }); await o3.next('ended');
    step('kick ok');

    // practice: organizer + 7 bots; the server plays the bot matches
    const code3 = code.slice(0, 3) + 'P';
    const pr = await open(tourUrl(code3));
    pr.json({ t: 'create', name: 'Practice cup', bots: 7, settings: { format: 'swiss' } });
    const pm = await pr.next('created');
    st = await waitFor(() => { const s = pr.last('state'); return s && s.tour.players.length === 8 ? s : null; });
    pr.json({ t: 'org', op: 'advance' });
    st = await waitFor(() => {
      const s = pr.last('state'); const r = s && s.tour.rounds[0];
      return r && r.matches.filter((mt) => mt.b != null && mt.a !== pm.id && mt.b !== pm.id).every((mt) => mt.result) ? s : null;
    }, 90000);
    const botResults = st.tour.rounds[0].matches.filter((mt) => mt.a !== pm.id && mt.b !== pm.id && mt.b != null);
    assert.strictEqual(botResults.length, 3);
    pr.json({ t: 'org', op: 'end' }); await pr.next('ended');
    step('bots ok');

    for (const s of [p1, p2, p3, again, fake, late, k1]) { try { s.close(); } catch {} }
    console.log('server step 2 ok (tournaments kept on the server; keys, organizer rights, results, bots)');
  } finally {
    srv.stop();
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
