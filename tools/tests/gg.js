// GG and the Good sport title (2026-11-04): server/src/accounts.js GG, recordGG, ggCount, titles.
// Headless: runs accounts.js against node's built-in SQLite through a small stand-in for D1 (as tools/tests/legend.js).
// Checks:
//  - a GG counts once per giver and match; never to yourself, never with too few fights
//  - at most GG.perGiver GGs from one player count
//  - GG.need counted GGs give the Good sport title for good (shown after Initiate, before Day 1) and it can be picked
// Run: node tools/tests/gg.js
const assert = require('assert');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

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
  const db = fakeD1(), env = { ACCOUNTS: db };
  await A.recordGG(env, 'pa', 'pb', 'X-1', 0).catch(() => {}); // makes the tables (returns early: too few fights)
  await A.rankedOn(env); // ensureSchema
  const now = Date.now(), late = A.DAY1_END + 1000; // accounts made after Day 1, so only Good sport shows
  for (const id of ['pa', 'pb', 'pc', 'pd', 'pe', 'pf']) db.sql.prepare('INSERT INTO players (id, tag, created, seen) VALUES (?, ?, ?, ?)').run(id, id.toUpperCase(), late, now);
  const count = (id) => A.ggCount(db, id);

  assert.strictEqual(await A.recordGG(env, 'pa', 'pb', 'M-1', 3), true, 'a GG after 3 fights counts');
  assert.strictEqual(await A.recordGG(env, 'pa', 'pb', 'M-1', 3), false, 'once per match');
  assert.strictEqual(await A.recordGG(env, 'pa', 'pa', 'M-2', 5), false, 'never to yourself');
  assert.strictEqual(await A.recordGG(env, 'pc', 'pb', 'M-3', 2), false, 'not with 2 fights');
  assert.strictEqual(await count('pb'), 1);

  for (const k of [4, 5, 6, 7]) await A.recordGG(env, 'pa', 'pb', 'M-' + k, 3); // pa has now given 5
  assert.strictEqual(await count('pb'), A.GG.perGiver, `at most ${A.GG.perGiver} from one player count`);

  // reach the title: 3 more players, 3 each (3 + 9 = 12 counted, title at 10)
  let t = null;
  for (const g of ['pc', 'pd', 'pe']) for (let k = 0; k < 3; k++) await A.recordGG(env, g, 'pb', `${g}-${k}`, 4);
  assert.strictEqual(await count('pb'), 12);
  t = db.sql.prepare('SELECT goodsport, title FROM players WHERE id = ?').get('pb');
  assert.ok(t.goodsport > 0, 'Good sport given');
  assert.deepStrictEqual(A.titlesOf({ ...t, created: late }), ['goodsport']);
  assert.strictEqual(A.titleShown({ ...t, created: late }), 'goodsport', 'shown when nothing is picked');
  assert.deepStrictEqual(A.titlesOf({ initiate: 1, goodsport: 1, created: 0 }), ['initiate', 'goodsport', 'day1'], 'order: after Initiate, before Day 1');

  // just short: 9 counted, no title
  for (const g of ['pa', 'pc', 'pd']) for (let k = 0; k < 3; k++) await A.recordGG(env, g, 'pf', `${g}-f${k}`, 3);
  assert.strictEqual(await count('pf'), 9);
  assert.ok(!db.sql.prepare('SELECT goodsport FROM players WHERE id = ?').get('pf').goodsport, '9 is not enough');
  await A.recordGG(env, 'pe', 'pf', 'pe-f', 3);
  assert.ok(db.sql.prepare('SELECT goodsport FROM players WHERE id = ?').get('pf').goodsport, 'the 10th gives it');

  console.log('gg: counting, the per-player cap, the Good sport title at', A.GG.need, 'all pass');
})().catch((e) => { console.error(e); process.exit(1); });
