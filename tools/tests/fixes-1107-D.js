// Headless check of the 2v2 board's middle row (fixes 1107 group D, 2026-11-07): the 'duo' map is 24 x 19, so no
// man's land is 5 rows deep (rows 7-11) with a true middle row (9) that is nobody's.
//  - the board: 24 x 19, zone 7, no man's land rows 7-11, row 9 on the centre line (world y = 0); every 1v1 map as it was
//  - towers and Vaults point-mirrored (side 0's moved down one row)
//  - the middle row is nobody's: no flank tiles there for either team, no Bastion walls; flank tiles and wall spots mirror
//  - artifacts on the middle row, point-mirrored, 10+ tiles apart, never in the flank columns (0, 1, 22, 23): the same
//    distance from both teams' front rows; with no free pair on it (a Coal mine exit, lake tiles) the rows above, no crash
//  - Magic lake tile order: own half of no man's land first, then the middle row, then the other half
//  - Duo.V is 4 (the board's shape changed: server/src/duo.js turns a page of another version away)
// Run: node tools/tests/fixes-1107-D.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Duo = require('../../src/duo.js');
const Mpb = require('../../src/mpb.js');
const demo = require('../../src/demo-units.json'), F = require('../../src/faction-units.json');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, Duo.unitSet(demo, F));

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n      ') : e); } };
function match(seed) {
  const D = Duo.create({}, units);
  Duo.start(D, units, matrix, 1e12, seed, [true, true, true, true]);
  return { D, m: (L) => D.lanes[L].m };
}
const mirror = (t) => ({ col: Game.COLS - 1 - t.col, row: Game.ROWS - 1 - t.row });
const MIRROR_EDGE = { n: 's', s: 'n', e: 'w', w: 'e' };

check('the 2v2 board is 24 x 19 with a middle row; 1v1 boards unchanged', () => {
  const x = match(3), m = x.m(0);
  Game.useGrid(m);
  assert.deepStrictEqual([Game.COLS, Game.ROWS, Game.ZONE], [24, 19, 7]);
  assert.deepStrictEqual([...Array(Game.ROWS).keys()].filter(r => Game.inNoMans(r)), [7, 8, 9, 10, 11], 'no man\'s land rows 7-11');
  assert.deepStrictEqual([...Array(Game.ROWS).keys()].filter(r => Game.midRow(r)), [9], 'row 9 is the middle row');
  assert.strictEqual(Game.tileToWorld(5, 9).y, 0, 'on the centre line');
  for (const [id, rows] of [['standard', 16], ['forest', 16], ['cavern', 16], ['ice', 16], ['testgrid', 18], ['bridge', 18], ['rush', 18]]) {
    Game.useGrid(id);
    assert.strictEqual(Game.ROWS, rows, id + ' keeps ' + rows + ' rows');
    assert.ok(![...Array(Game.ROWS).keys()].some(r => Game.midRow(r)), id + ': no middle row');
  }
});

check('towers and Vaults point-mirrored', () => {
  const m = match(4).m(0);
  assert.deepStrictEqual(Game.towerSpot(m, 0), { col: 17, row: 17 });
  assert.deepStrictEqual(Game.towerSpot(m, 1), mirror(Game.towerSpot(m, 0)));
  assert.deepStrictEqual(Mpb.recs(m, 0).filter(r => r.kind === 'vault').map(r => ({ col: r.col, row: r.row })), [{ col: 6, row: 16 }]);
  assert.deepStrictEqual(Mpb.VAULT_SPOT[1], mirror(Mpb.VAULT_SPOT[0]));
});

check('the middle row is nobody\'s: no flank tiles, no Bastion walls; both teams mirror', () => {
  const m = match(5).m(0);
  Game.useGrid(m);
  for (const sd of [0, 1]) {
    assert.ok(!Game.flankRows(sd).includes(9), 'no flank row 9 for side ' + sd);
    for (let c = 0; c < Game.COLS; c++) assert.ok(!Game.isFlank(sd, c, 9) && !Game.reserved(sd, c, 9));
  }
  const key = (t) => t.col + ',' + t.row;
  assert.deepStrictEqual(Game.flankTiles(1).map(key).sort(), Game.flankTiles(0).map(mirror).map(key).sort(), 'flank tiles mirror');
  for (let r = 0; r < Game.ROWS; r++) for (let c = 0; c < Game.COLS; c++) for (const e of ['n', 's', 'e', 'w']) {
    const a = Game.bwallSpotOk(m, 0, c, r, e), p = mirror({ col: c, row: r }), b = Game.bwallSpotOk(m, 1, p.col, p.row, MIRROR_EDGE[e]);
    assert.strictEqual(a, b, `wall spot ${c},${r},${e} mirrors`);
    if (r === 9) assert.ok(!a && !Game.bwallSpotOk(m, 1, c, r, e), 'no wall on the middle row');
  }
});

check('artifacts: always on the middle row, mirrored, 10+ apart, the same distance from both front rows', () => {
  const m = match(6).m(0);
  Game.useGrid(m);
  const front0 = Game.ROWS - Game.ZONE, front1 = Game.ZONE - 1, cols = new Set();
  for (let seed = 1; seed <= 2000; seed++) {
    let a = seed >>> 0;
    const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const [p, q] = Mpb.rollArtifacts(m, r).list;
    assert.deepStrictEqual({ col: q.col, row: q.row }, mirror(p), 'point mirrors');
    for (const t of [p, q]) {
      assert.strictEqual(t.row, 9, 'on the middle row');
      assert.strictEqual(front0 - t.row, t.row - front1, 'the same distance from both front rows');
      assert.ok(!Game.isFlank(0, t.col, t.row) && !Game.isFlank(1, t.col, t.row), 'not a flank tile');
      cols.add(t.col);
    }
    assert.ok(Math.abs(p.col - q.col) >= Mpb.ARTIFACT.apart, 'at least 10 apart');
  }
  assert.deepStrictEqual([...cols].sort((x, y) => x - y), [2, 3, 4, 5, 6, 17, 18, 19, 20, 21], 'cols 2-6 and 17-21, never a flank column');
});

check('artifacts: no free pair on the middle row, so the rows above it (no crash)', () => {
  const m = match(8).m(0);
  Game.useGrid(m); m.round = 8;
  const mine = Mpb.addRec(m, 0, 'coalMine', 10, 15); mine.parts.exit = { col: 4, row: 9 }; // (its ring keeps cols 3-5 free)
  for (const c of [2, 6]) Mpb.addRec(m, 1, 'magicLake', c, 9).data.lane = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const A = Mpb.rollArtifacts(m, Mpb.rng(seed)), [p, q] = A.list;
    assert.deepStrictEqual({ col: q.col, row: q.row }, mirror(p), 'point mirrors');
    assert.ok([7, 8].includes(Math.min(p.row, q.row)) && Game.inNoMans(p.row) && Game.inNoMans(q.row), 'the rows above the middle row');
    for (const t of [p, q]) assert.ok(!Mpb.at(m, t.col, t.row) && !Game.terrainBlocks(m, t.col, t.row), 'a free tile');
  }
});

check('Magic lake tiles: own half of no man\'s land, then the middle row, then the other half', () => {
  const x = match(7);
  for (const R of x.D.lanes) Mpb.giveCard(R.m, 0, { type: 'mpb', id: 'magicLake' });
  const m = x.m(0), rec = Mpb.recs(m, 0).find(r => r.kind === 'magicLake');
  const rows = Mpb.kindOf('magicLake').lakeSpots(m, 0, rec).map(t => t.row).filter(r => Game.inNoMans(r));
  const first = (r) => rows.indexOf(r), last = (r) => rows.lastIndexOf(r);
  assert.ok(first(9) >= 0 && last(10) < first(9) && last(11) < first(9), 'side 0\'s half before the middle row');
  assert.ok(last(9) < first(8) && last(9) < first(7), 'the middle row before side 1\'s half');
});

check('Duo.V 4: the board changed shape', () => { assert.strictEqual(Duo.V, 4); });

if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('fixes-1107-D ok');
