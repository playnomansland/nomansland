// Legend title (2026-11-03): the top 5 of the leaderboard when a month ends (Stockholm time) get the gold Legend title.
// Headless: runs server/src/accounts.js against node's built-in SQLite through a small stand-in for D1.
// Checks:
//  - month keys and month ends in Stockholm time (winter and summer time)
//  - nothing is given before the first month (2026-11) has ended, or twice for the same month
//  - the top 5 in leaderboard order get it, the 6th doesn't, deleted accounts are skipped
//  - players.legend counts months; the title shows on the player (first after DEV, before Day 1) and can be picked
// Run: node tools/tests/legend.js
const assert = require('assert');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// just enough of D1: prepare().bind().first/all/run, and batch (one transaction)
function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
  });
  return {
    sql,
    prepare: (q) => stmt(q),
    batch: async (list) => {
      sql.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.run()); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

(async () => {
  const A = await import(path.join(__dirname, '../../server/src/accounts.js'));
  const at = (iso) => Date.parse(iso);

  // ----- Stockholm months -----
  assert.strictEqual(A.monthKey(at('2026-11-30T22:59:00Z')), '2026-11', '23:59 on 30 November in Stockholm');
  assert.strictEqual(A.monthKey(at('2026-11-30T23:00:00Z')), '2026-12', 'midnight in Stockholm is 23:00 UTC in winter');
  assert.strictEqual(A.monthEnd(at('2026-11-03T10:00:00Z')), at('2026-11-30T23:00:00Z'), 'November ends at Stockholm midnight');
  assert.strictEqual(A.monthEnd(at('2027-05-20T10:00:00Z')), at('2027-05-31T22:00:00Z'), 'summer time: 22:00 UTC');
  assert.strictEqual(A.monthEnd(at('2026-12-10T10:00:00Z')), at('2026-12-31T23:00:00Z'), 'December rolls into the next year');

  // ----- awarding -----
  const db = fakeD1();
  const env = { ACCOUNTS: db };
  assert.strictEqual(await A.awardLegends(env, at('2026-11-15T12:00:00Z')), null, 'schema made, nothing to give yet');
  const created = at('2026-11-02T12:00:00Z');
  const players = [
    ['pA', 'Alpha', 9, 0, 1], ['pB', 'Bravo', 8, 0, 2], ['pC', 'Charlie', 5, 2, 3], ['pD', 'Delta', 4, 0, 4],
    ['pE', 'Echo', 3, 0, 5], ['pF', 'Foxtrot', 1, 0, 6], ['pX', 'Gone', 20, 0, 0], ['pZ', 'Zero', 0, 0, 9],
  ];
  for (const [id, tag, w, t, l] of players) {
    db.sql.prepare('INSERT INTO players (id, tag, created, seen) VALUES (?, ?, ?, ?)').run(id, tag, created, created);
    db.sql.prepare('INSERT INTO ranked (player, w, t, l, updated) VALUES (?, ?, ?, ?, ?)').run(id, w, t, l, created);
  }
  db.sql.prepare('UPDATE players SET deleted = 1, tag = NULL WHERE id = ?').run('pX');
  db.sql.prepare('UPDATE players SET dev = 1 WHERE id = ?').run('pB');

  assert.strictEqual(await A.awardLegends(env, at('2026-11-30T22:30:00Z')), null, 'November isn\'t over yet');
  const r = await A.awardLegends(env, at('2026-11-30T23:07:00Z'));
  assert.ok(r, 'given once November has ended');
  assert.strictEqual(r.month, '2026-11');
  // win share: A 0.9, B 0.8, C 6/10, D 0.5, E 3/8, F 1/7, Z 0
  assert.deepStrictEqual(r.players, ['pA', 'pB', 'pC', 'pD', 'pE'], 'the top 5 in leaderboard order, deleted accounts skipped');
  assert.strictEqual(await A.awardLegends(env, at('2026-12-01T05:07:00Z')), null, 'not twice for the same month');

  const legend = (id) => db.sql.prepare('SELECT legend, created, dev, title FROM players WHERE id = ?').get(id);
  assert.strictEqual(legend('pA').legend, 1);
  assert.strictEqual(legend('pF').legend, null, 'the 6th gets nothing');
  assert.deepStrictEqual(A.titlesOf(legend('pA')), ['legend', 'day1'], 'Legend comes before Day 1');
  assert.strictEqual(A.titleShown(legend('pA')), 'legend', 'and shows when nothing is picked');
  assert.deepStrictEqual(A.titlesOf(legend('pB')), ['dev', 'legend', 'day1'], 'DEV stays first for a developer');
  assert.strictEqual(A.titleShown({ ...legend('pA'), title: 'day1' }), 'day1', 'a picked title still wins');
  const places = db.sql.prepare(`SELECT player, place FROM awards WHERE period = '2026-11' ORDER BY place`).all().map((x) => x.player + x.place);
  assert.deepStrictEqual(places, ['pA1', 'pB2', 'pC3', 'pD4', 'pE5'], 'places kept');

  // a second month: Foxtrot climbs in, Alpha stays; counts grow, the title stays for good
  db.sql.prepare('UPDATE ranked SET w = 50 WHERE player = ?').run('pF');
  const r2 = await A.awardLegends(env, at('2027-01-01T01:00:00Z'));
  assert.strictEqual(r2.month, '2026-12');
  assert.ok(r2.players.includes('pF') && !r2.players.includes('pE'), 'Foxtrot in, Echo out');
  assert.strictEqual(legend('pA').legend, 2, 'two months');
  assert.strictEqual(legend('pE').legend, 1, 'Echo keeps the title');
  assert.strictEqual(legend('pF').legend, 1);

  // an empty board gives nothing but still closes the month (a fresh copy of the module: it makes its tables once)
  const { pathToFileURL } = require('url');
  const A2 = await import(pathToFileURL(path.join(__dirname, '../../server/src/accounts.js')).href + '?fresh');
  const empty = fakeD1();
  const r3 = await A2.awardLegends({ ACCOUNTS: empty }, at('2026-12-01T00:30:00Z'));
  assert.deepStrictEqual(r3, { month: '2026-11', players: [] });
  assert.strictEqual(await A2.awardLegends({ ACCOUNTS: empty }, at('2026-12-02T00:30:00Z')), null);

  console.log('legend: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
