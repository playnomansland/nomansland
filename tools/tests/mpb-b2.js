// Headless check of group B2's 2v2 buildings (src/mpb.js regions fieldHospital and oak, docs/MPB-2V2.md): no server.
//  - placement: interior tiles with 2 tiles of room, as every MPB
//  - Field hospital: squads within 1 tile (either lane) +20% health and 2%/s regen (measured in a real Duo fight);
//    +5 Team HP for a round won with it standing (never above 200), −15 when destroyed; Field dressing (50, +50 per
//    click of yours this round): a random allied squad +25% health this fight (seeded, deterministic); Second wind
//    (100, once a round): the chosen squad comes back whole in front of the hospital the first time it is wiped out,
//    once; its target hidden from the opponents, movable by either teammate
//  - The Oak: Restoration ×1.25 on every heal of its team while it stands (×1.5 with Double restoration), measured on
//    regen in a real Duo fight and on the Engine's other heals; Heal +5 Team HP before the fight's damage (once a round
//    each, never above 200); Sticky moss: enemies on tiles within 3 of it 30% slower (not its own team, not
//    Berserkers); downside: the round after it fell, a 1-body level 3 Ent with all its skills fights for the opponents
//  - mirror symmetry of the fight effects when both teams have them; hidden info; the page's copy hashing as the
//    server's after every action; bots use the skills; a full bot 2v2 to round 10 with both kinds on both teams
// Run: node tools/tests/mpb-b2.js
const assert = require('assert');
const Game = require('../../src/game.js');
const Engine = require('../../src/engine.js');
const Ref = require('../../src/referee.js');
const Duo = require('../../src/duo.js');
const Mpb = require('../../src/mpb.js');
const demo = require('../../src/demo-units.json'), F = require('../../src/faction-units.json');
const { units, matrix } = require('../../server/src/prepare-units.cjs')(Engine, Duo.unitSet(demo, F));

const copy = (o) => JSON.parse(JSON.stringify(o));
const W = (s) => Ref.withUnits(copy(s), units, matrix);
let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e && e.stack ? e.stack.split('\n').slice(0, 8).join('\n      ') : e); } };

// ----- helpers (as tools/tests/mpb.js) -----
function match(seed, bots = [false, false, false, false]) {
  const D = Duo.create({}, units);
  const T = 1e12;
  Duo.start(D, units, matrix, T, seed, bots);
  const seq = [0, 0, 0, 0];
  const act = (seat, fn, ...a) => Duo.act(D, seat, { seq: ++seq[seat] + 10, fn, a }, D.now || T);
  for (let k = 0; k < 4; k++) if (!bots[k]) assert.ok(act(k, 'choosePack', 0).ok, 'seat ' + k + ' picks a package');
  return { D, T, act, m: (L) => D.lanes[L].m };
}
function playTo(x, round, hook) {
  const { D } = x;
  while (D.lanes[0].m.round < round && D.phase !== 'end') {
    for (let k = 0; k < 4; k++) Duo.setReady(D, k, true, x.T);
    if (hook) hook(D);
    for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, x.T);
  }
}
const sameTeam = (D, sd) => { for (const f of ['mpb', 'mpbVote', 'vault']) assert.deepStrictEqual(D.lanes[0].m[f][sd], D.lanes[1].m[f][sd], 'team ' + sd + ' ' + f + ' the same in both lanes'); };
// a building of kind on a tile (default: the first allowed one) in both lanes, as if it stood when the round began
function addKind(D, sd, kind, at) {
  const m = D.lanes[0].m;
  Duo.setTeams(D.lanes.map(R => R.m));
  const t = at || Mpb.autoSpot(m, sd, kind, null);
  for (const R of D.lanes) Mpb.addRec(R.m, sd, kind, t.col, t.row);
  if (D.tbase[sd]) D.tbase[sd].mpb.push(copy(Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1]));
  return Mpb.recs(m, sd)[Mpb.recs(m, sd).length - 1];
}
const UI = (name) => { const i = units.findIndex(u => u.name === name); assert.ok(i >= 0, name); return i; };
// a squad of unit `name` on (col, row) in lane L, side sd (straight into the army, as a placed squad)
function put(D, L, sd, name, col, row, extra = {}) {
  const m = D.lanes[L].m, sq = { id: m.nextId[sd]++, unit: UI(name), col, row, round: m.round, xp: 0, level: 0, cost: 100, ...extra };
  m.armies[sd].push(sq);
  Duo.setTeams(D.lanes.map(R => R.m));
  return sq;
}
// a fresh match with no squads (bots' deployments cleared), both lanes in step
function bare(seed) {
  const x = match(seed);
  for (const R of x.D.lanes) for (const sd of [0, 1]) R.m.armies[sd] = [];
  Duo.setTeams(x.D.lanes.map(R => R.m));
  return x;
}
const lanesOf = (D) => D.lanes.map(R => R.m);
function battleOf(D) { const lanes = lanesOf(D); Duo.settle(lanes); return Duo.battle(lanes); }
const bodiesOf = (bt, sd, sq) => bt.bodies.filter(b => b.side === sd && b.squad === sq);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
// the largest rise of a body's health from one tick to the next over a whole fight (its pure regen tick, untouched)
function maxRise(bt, pick, until) {
  let best = 0, prev = new Map();
  for (let k = 0; k < 4000 && bt.step(); k++) {
    for (const b of pick()) { const p = prev.get(b); if (p != null && b.alive) best = Math.max(best, b.hp - p); prev.set(b, b.hp); }
    if (until && until()) break;
  }
  return best;
}

check('placement: interior tiles, 2 tiles of room round every building', () => {
  const x = match(3), m = x.m(0);
  Duo.setTeams(lanesOf(x.D));
  for (const kind of ['fieldHospital', 'oak']) {
    const ok = Mpb.spots(m, 0, kind, null);
    assert.ok(ok.length > 10, kind + ': room on the board');
    for (const t of ok) assert.ok(Mpb.interior(0, t.col, t.row) && Mpb.spaced(m, t.col, t.row), kind + ' tile ' + t.col + ',' + t.row);
    assert.ok(!Mpb.spotOk(m, 0, kind, null, 10, 18) && !Mpb.spotOk(m, 0, kind, null, 2, 15) && !Mpb.spotOk(m, 0, kind, null, 10, 5), kind + ': not on an edge, not in the enemy zone');
  }
  const h = addKind(x.D, 0, 'fieldHospital');
  assert.ok(!Mpb.spotOk(m, 0, 'oak', null, h.col + 2, h.row), 'the Oak not within 2 tiles of the hospital');
  for (const sd of [0, 1]) assert.ok(Game.occupied(m, sd, h.col, h.row), 'its tile taken for both teams');
  assert.strictEqual(Mpb.KINDS.fieldHospital.hp, 600); assert.strictEqual(Mpb.KINDS.oak.hp, 1200); assert.strictEqual(Mpb.KINDS.oak.armor, 3);
});

check('Field hospital: squads within 1 tile (both lanes) +20% health and 2%/s regen, measured in a real Duo fight', () => {
  const x = bare(11), { D } = x;
  const h = addKind(D, 0, 'fieldHospital', { col: 10, row: 15 });
  const a = put(D, 0, 0, 'Brute', 11, 14), b = put(D, 1, 0, 'Brute', 9, 16), far = put(D, 0, 0, 'Brute', 14, 14);
  put(D, 0, 1, 'Skeleton Archers', 11, 6); put(D, 1, 1, 'Skeleton Archers', 13, 6);
  const bt = battleOf(D), base = units[UI('Brute')].hp;
  const [ba] = bodiesOf(bt, 0, a.id), [bb] = bodiesOf(bt, 0, Duo.move(b.id)), [bf] = bodiesOf(bt, 0, far.id);
  assert.ok(near(ba.u.hp, base * 1.2) && near(bb.u.hp, base * 1.2), 'lane 0 and lane 1 squads next to it: +20% health');
  assert.ok(near(bf.u.hp, base) && !bf.u.regen, 'a squad 4 tiles away: nothing');
  assert.strictEqual(ba.u.regen, 2); assert.strictEqual(bb.u.regen, 2);
  assert.ok(bt.bodies.some(q => q.u.mpb === 'fieldHospital' && q.u.structure && !(q.u.hit > 0)), 'the hospital stands in the fight and can\'t shoot');
  const rise = maxRise(bt, () => [ba], () => !ba.alive), want = ba.u.hp * 0.02 * Game.SETTINGS.dt;
  assert.ok(rise > 0 && near(rise, want, 1e-6), `it regains 2% a second: ${rise} a tick, want ${want}`);
});

check('Field hospital: +5 Team HP for a round won with it standing (at most 200), −15 when destroyed', () => {
  const x = bare(12), { D } = x, lanes = lanesOf(D);
  const h = addKind(D, 0, 'fieldHospital'), k = Mpb.recs(lanes[0], 0).indexOf(h);
  const run = (hp, res) => { const sums = lanes.map(m => ({ round: m.round })), v = hp.slice(); h.fell = 0; Mpb.afterFight(lanes, res, sums, v); return { v, sums }; };
  assert.deepStrictEqual(run([150, 150], { squads: {}, winner: 0 }).v, [155, 150], 'won: +5');
  assert.deepStrictEqual(run([198, 150], { squads: {}, winner: 0 }).v, [200, 150], 'never above 200');
  assert.deepStrictEqual(run([200, 150], { squads: {}, winner: 0 }).v, [200, 150]);
  assert.deepStrictEqual(run([150, 150], { squads: {}, winner: 1 }).v, [150, 150], 'lost: nothing');
  assert.deepStrictEqual(run([150, 150], { squads: {}, winner: -1 }).v, [150, 150], 'a draw: nothing');
  const fell = { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } }, winner: 0 };
  const r = run([150, 150], fell);
  assert.deepStrictEqual(r.v, [135, 150], 'destroyed: −15, and no +5 though the round was won');
  assert.ok(r.sums.every(s => s.mpbNews[0].some(n => n.kind === 'fieldHospital' && n.lost === 15 && n.text)), 'the news in both summaries');
  assert.deepStrictEqual(run([10, 150], fell).v, [0, 150], 'down to 0 at most');
  // a real fight: the Team HP comes out as the fight's damage plus the hospital's part
  const y = bare(13), Y = y.D;
  addKind(Y, 0, 'fieldHospital');
  put(Y, 0, 0, 'Brute', 8, 13); put(Y, 1, 0, 'Brute', 15, 13); put(Y, 0, 1, 'Goblin Swarm', 10, 5);
  Y.hp = [150, 150]; for (const R of Y.lanes) R.m.hp = Y.hp.slice();
  for (let s = 0; s < 4; s++) Duo.setReady(Y, s, true, y.T);
  const sm = Y.summary[0], hr = Mpb.recs(y.m(0), 0).find(q => q.kind === 'fieldHospital'), fellNow = hr.fell === sm.round;
  const want = Math.max(0, 150 - sm.duo.lost[0]), plus = fellNow ? -15 : sm.duo.winner === 0 ? 5 : 0;
  assert.strictEqual(Y.hp[0], Math.max(0, Math.min(Math.max(want, 200), want + plus)), `Team HP after a real fight (lost ${sm.duo.lost[0]}, winner ${sm.duo.winner})`);
});

check('Field dressing: 50, 100... a click each (per player), a random allied squad +25% health this fight, seeded', () => {
  const x = bare(14), { D } = x, a = x.m(0), b = x.m(1);
  const h = addKind(D, 0, 'fieldHospital');
  for (const m of [a, b]) m.gold[0] = 1000;
  const sqs = [put(D, 0, 0, 'Brute', 5, 13), put(D, 0, 0, 'Ent', 8, 13), put(D, 1, 0, 'Brute', 15, 13), put(D, 1, 0, 'Spiders', 18, 13)];
  put(D, 0, 1, 'Goblin Swarm', 10, 5);
  const hp0 = {}, foe0 = {};
  for (const bd of battleOf(D).bodies) { if (bd.side === 0 && bd.squad >= 0) hp0[bd.squad] = bd.u.hp; if (bd.side === 1) foe0[bd.squad] = bd.u.hp; }
  assert.ok(x.act(0, 'mpbBuy', h.key, 'dress').ok && x.act(0, 'mpbBuy', h.key, 'dress').ok, 'A1 clicks twice');
  assert.strictEqual(a.gold[0], 1000 - 50 - 100, 'A1 paid 50 + 100');
  assert.strictEqual(Mpb.skillCost(b, 0, h.key, 'dress'), 50, 'A2\'s first click is 50');
  assert.ok(x.act(1, 'mpbBuy', h.key, 'dress').ok); assert.strictEqual(b.gold[0], 950);
  sameTeam(D, 0);
  const boosted = (bt) => {
    const out = {};
    for (const id in hp0) { const bs = bodiesOf(bt, 0, +id); out[id] = Math.round(bs[0].u.hp / hp0[id] * 1000) / 1000; }
    return out;
  };
  const bt1 = battleOf(D), k1 = boosted(bt1), k2 = boosted(battleOf(D));
  assert.deepStrictEqual(k1, k2, 'the same squads every time (seeded, the same on the page and the server)');
  const extra = Object.values(k1).reduce((s, v) => s + Math.round((v - 1) / 0.25), 0);
  assert.strictEqual(extra, 3, 'three clicks: +25% three times among the team\'s squads ' + JSON.stringify(k1));
  for (const bd of bt1.bodies.filter(q => q.side === 0 && q.squad >= 0)) assert.ok(near(bd.hp, bd.u.hp), 'they start at full (new) health');
  assert.ok([sqs[0].id, sqs[1].id, Duo.move(sqs[2].id), Duo.move(sqs[3].id)].every(id => hp0[id] > 0), 'squads of both lanes of team A are in it');
  assert.ok(bt1.bodies.filter(q => q.side === 1).every(q => near(q.u.hp, foe0[q.squad])), 'the other team untouched');
  // picks spread over the squads (different matches pick different squads)
  const seen = new Set();
  for (let s = 0; s < 12; s++) { for (const R of D.lanes) R.m.seed = 1000 + s; const k = boosted(battleOf(D)); Object.keys(k).forEach(id => { if (k[id] > 1) seen.add(id); }); }
  assert.ok(seen.size >= 3, 'random: several squads get it over different matches (' + [...seen] + ')');
  // only this round's
  playTo(x, 2);
  const o = { mpb: {} }; Mpb.battleOpts(x.m(0), o);
  assert.deepStrictEqual(o.mpb.fieldHospital.dress, [[], []], 'next round: no Field dressing unless clicked again');
});

check('Second wind: once a round, the chosen squad comes back whole in front of the hospital the first time it is wiped out', () => {
  const x = bare(15), { D } = x, a = x.m(0);
  const h = addKind(D, 0, 'fieldHospital', { col: 10, row: 15 });
  for (const R of D.lanes) R.m.gold[0] = 1000;
  const gob = put(D, 1, 0, 'Goblin Swarm', 6, 13), bru = put(D, 0, 0, 'Brute', 16, 13);
  put(D, 0, 1, 'Brute', 9, 5); put(D, 1, 1, 'Skeleton Archers', 12, 5);
  assert.ok(!x.act(0, 'mpbBuy', h.key, 'wind').ok, 'needs a squad');
  assert.ok(!Mpb.canBuy(a, 0, h.key, 'wind', 2, 1), 'a lane is 0 or 1');
  assert.ok(x.act(0, 'mpbBuy', h.key, 'wind', 0, bru.id).ok, 'A1 buys it for their Brute');
  assert.strictEqual(a.gold[0], 900);
  assert.ok(!x.act(1, 'mpbBuy', h.key, 'wind', 1, gob.id).ok, 'once a round for the team');
  assert.ok(x.act(1, 'mpbAct', h.key, 'wind', 1, gob.id).ok, 'A2 moves it to their goblins (no gold)');
  assert.strictEqual(x.m(1).gold[0], 1000);
  sameTeam(D, 0);
  assert.deepStrictEqual(Mpb.recOf(x.m(0), 0, h.key).data.wind, { round: 1, lane: 1, id: gob.id, u: gob.unit }, 'the squad and its unit type (review 2026-11-06)');
  assert.ok(!x.act(1, 'mpbAct', h.key, 'wind', 1, 999).ok, 'a squad of the team\'s only');
  // hidden from the opponents, seen by the teammate
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, h.key).data.wind && !Mpb.recOf(Duo.viewFor(D, 3).m, 0, h.key).skills.wind, 'the opponents see no Second wind');
  assert.ok(Mpb.recOf(Duo.viewFor(D, 0).m, 0, h.key).data.wind, 'the teammate does');
  // the fight: the goblins (lane 1) are marked; weaken them so they fall at once, then they come back, once
  const bt = battleOf(D), id = Duo.move(gob.id), orig = bodiesOf(bt, 0, id), front = Game.tileToWorld(10, 14);
  assert.ok(orig.length === 12 && orig.every(b => b.fhRevive && near(b.fhRevive.x, front.x) && near(b.fhRevive.y, front.y)), 'the 12 goblins carry the mark, the tile in front of the hospital');
  assert.ok(bt.bodies.filter(b => b.side === 0 && b.squad !== id).every(b => !b.fhRevive), 'no other squad');
  for (const b of orig) b.hp = 0.5;
  let back = [];
  for (let k = 0; k < 6000 && bt.step(); k++) { back = bodiesOf(bt, 0, id).filter(b => b.fhBack); if (back.length) break; }
  assert.strictEqual(back.length, 12, 'the whole squad comes back');
  assert.ok(back.every(b => near(b.hp, b.u.hp) && b.u.hp === orig[0].u.hp && Math.hypot(b.x - front.x, b.y - front.y) < Game.TILE), 'at full health, in front of the hospital');
  assert.ok(orig.every(b => !b.alive && b.fhGone));
  for (const b of back) b.hp = 0.5;
  while (bt.step()) {}
  assert.strictEqual(bodiesOf(bt, 0, id).length, 24, 'only once');
  const q = bt.result().squads['0:' + id];
  assert.strictEqual(q.total, 12, 'the result counts the new bodies only');
  // the take-back: A1 can't (A2 moved it, A1 paid): A1's Undo gives A1 their gold back and the target goes
  assert.ok(x.act(0, 'mpbUndo', h.key, 'wind').ok); assert.strictEqual(a.gold[0], 1000);
  assert.ok(!Mpb.recOf(x.m(1), 0, h.key).data.wind, 'gone in both lanes');
  assert.ok(!battleOf(D).bodies.some(b => b.fhRevive), 'no mark without it');
});

check('Second wind in a whole Duo fight: a squad wiped out comes back and fights on', () => {
  const x = bare(16), { D } = x;
  const h = addKind(D, 0, 'fieldHospital', { col: 10, row: 15 });
  for (const R of D.lanes) R.m.gold[0] = 1000;
  const gob = put(D, 0, 0, 'Goblin Swarm', 10, 11);
  put(D, 0, 1, 'Flame Wizard', 10, 6); put(D, 1, 1, 'Steel Wizard', 13, 6);
  assert.ok(x.act(0, 'mpbBuy', h.key, 'wind', 0, gob.id).ok);
  const lanes = lanesOf(D); Duo.settle(lanes);
  const bt = Duo.battle(lanes); while (bt.step()) {}
  const all = bodiesOf(bt, 0, gob.id);
  assert.ok(all.length === 24 && all.filter(b => b.fhBack).length === 12, 'wiped out once, back once: ' + all.length);
  assert.ok(all.filter(b => b.fhBack).some(b => b.dealt > 0 || !b.alive || b.xp > 0), 'the squad brought back took part');
});

// the regen of one Brute standing next to a hospital, rising ticks measured in a real Duo fight
function regenWith(seed, setup) {
  const x = bare(seed), { D } = x;
  addKind(D, 0, 'fieldHospital', { col: 10, row: 15 });
  const oak = addKind(D, 0, 'oak', { col: 16, row: 15 });
  const a = put(D, 0, 0, 'Brute', 11, 14);
  put(D, 0, 1, 'Skeleton Archers', 11, 6); put(D, 1, 1, 'Skeleton Archers', 13, 6);
  for (const R of D.lanes) R.m.gold[0] = 1000;
  if (setup) setup(x, oak);
  const bt = battleOf(D), [ba] = bodiesOf(bt, 0, a.id), ob = bt.bodies.find(b => b.u.mpb === 'oak');
  return { x, bt, ba, ob };
}
check('The Oak: Restoration ×1.25 on its team\'s regen while it stands, ×1.5 with Double restoration (a real Duo fight)', () => {
  const dt = Game.SETTINGS.dt;
  { const { bt, ba, ob } = regenWith(21);
    assert.ok(ob && ob.oakRestore === 1.25 && ob.u.structure && ob.u.hp === 1200 && ob.u.defVal === 3, 'the Oak: 1200 health, 3 armor, Restoration 1.25');
    const r = maxRise(bt, () => [ba], () => !ba.alive);
    assert.ok(near(r, ba.u.hp * 0.02 * dt * 1.25), `regen ×1.25: ${r}`); }
  { const { x, bt, ba } = regenWith(21, (x, oak) => assert.ok(x.act(1, 'mpbBuy', oak.key, 'boost').ok, 'A2 buys Double restoration'));
    const r = maxRise(bt, () => [ba], () => !ba.alive);
    assert.ok(near(r, ba.u.hp * 0.02 * dt * 1.5), `regen ×1.5: ${r}`);
    assert.ok(!x.act(0, 'mpbBuy', Mpb.recs(x.m(0), 0).find(q => q.kind === 'oak').key, 'boost').ok, 'once a round for the team'); }
  { const { bt, ba, ob } = regenWith(21);
    ob.alive = false; ob.hp = 0; // the Oak is down: Restoration stops
    const r = maxRise(bt, () => [ba], () => !ba.alive);
    assert.ok(near(r, ba.u.hp * 0.02 * dt), `without a standing Oak: plain regen ${r}`); }
  // the other team's heals: untouched
  { const { bt } = regenWith(21), foe = bt.bodies.filter(b => b.side === 1 && !b.u.structure)[0];
    foe.u = { ...foe.u, regen: 4 }; foe.hp = foe.u.hp / 2;
    const r = maxRise(bt, () => [foe], () => !foe.alive);
    assert.ok(near(r, foe.u.hp * 0.04 * dt), 'the opponents\' regen is plain'); }
});

check('Restoration on the Engine\'s other heals (mending, water healing: every heal goes through the Engine\'s heal()): ×1.25', () => {
  const G = { ...Game.SETTINGS, bounds: { x0: -40, x1: 40, y0: -40, y1: 40 } };
  const oakU = Engine.withTraits({ name: 'The Oak', cost: 0, bodies: 1, hp: 1200, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, structure: true, lesser: true, kind: 'mpb', mpb: 'oak' });
  // one healer and one wounded ally on side 0, a dummy far away on side 1; the healed amount with and without the Oak
  const healed = (healer, withOak) => {
    const A = Engine.buildSquad(healer, 0, 0, -10, 1, 6, 0), hurt = Engine.buildSquad(Engine.withTraits({ name: 'Dummy', cost: 0, bodies: 1, hp: 1000, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 0, 0, -12, 2, 6, 5)[0];
    hurt.hp = 300; A.push(hurt);
    if (withOak) { const o = Engine.buildSquad(oakU, 0, -20, -30, -700, 6, 9)[0]; o.oakRestore = 1.25; A.push(o); }
    const B = Engine.buildSquad(Engine.withTraits({ name: 'Wall', cost: 0, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 1, 0, 30, 3, 6, 20);
    const bt = Engine.createBattle(A, B, G, withOak ? { mpb: { oak: true } } : {});
    for (let k = 0; k < 40; k++) bt.step();
    return hurt.hp - 300;
  };
  const mender = Engine.withTraits({ name: 'Mender', cost: 0, bodies: 1, hp: 100, hit: 10, aps: 1, range: 8, speed: 0, splash: 0, mend: 20 });
  const a = healed(mender, false), b = healed(mender, true);
  assert.ok(a > 0 && near(b, a * 1.25), `mending: ${a} -> ${b}`);
  const water = Engine.withTraits({ name: 'Water', cost: 0, bodies: 1, hp: 100, hit: 30, aps: 1, range: 10, speed: 0, splash: 3, waterHeal: 1 });
  const w0 = healed(water, false), w1 = healed(water, true);
  assert.ok(w0 > 0 && near(w1, w0 * 1.25), `water healing: ${w0} -> ${w1}`);
  // 1v1 untouched: no opts.mpb, an oakRestore body does nothing
  const c = (() => { const A = Engine.buildSquad(mender, 0, 0, -10, 1, 6, 0), hurt = Engine.buildSquad(Engine.withTraits({ name: 'D', cost: 0, bodies: 1, hp: 1000, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 0, 0, -12, 2, 6, 5)[0]; hurt.hp = 300; A.push(hurt); const o = Engine.buildSquad(oakU, 0, -20, -30, -700, 6, 9)[0]; o.oakRestore = 1.25; A.push(o);
    const bt = Engine.createBattle(A, Engine.buildSquad(Engine.withTraits({ name: 'W', cost: 0, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 1, 0, 30, 3, 6, 20), G, {}); for (let k = 0; k < 40; k++) bt.step(); return hurt.hp - 300; })();
  assert.ok(near(c, a), 'without opts.mpb.oak nothing changes');
});

check('The Oak\'s Heal: +5 Team HP a click (once a round each), before the fight\'s damage, never above 200', () => {
  const x = bare(22), { D } = x;
  const oak = addKind(D, 0, 'oak');
  for (const R of D.lanes) R.m.gold[0] = 1000;
  assert.strictEqual(Mpb.whyNot(x.m(0), 0, oak.key, 'heal', []), 'rules', 'at full Team HP it would do nothing: refused (review 2026-11-06)');
  D.hp = [196, 200]; for (const R of D.lanes) R.m.hp = D.hp.slice();
  assert.ok(x.act(0, 'mpbBuy', oak.key, 'heal').ok, 'one click can still add something');
  assert.ok(!x.act(1, 'mpbBuy', oak.key, 'heal').ok, 'a second would only reach 200 already');
  assert.ok(x.act(0, 'mpbUndo', oak.key, 'heal').ok);
  D.hp = [150, 200]; for (const R of D.lanes) R.m.hp = D.hp.slice();
  assert.ok(x.act(0, 'mpbBuy', oak.key, 'heal').ok && x.act(1, 'mpbBuy', oak.key, 'heal').ok, 'each player once');
  assert.ok(!x.act(0, 'mpbBuy', oak.key, 'heal').ok, 'not twice a round');
  assert.strictEqual(x.m(0).gold[0], 950); assert.strictEqual(x.m(1).gold[0], 950);
  const lanes = lanesOf(D), hp = (v) => { const h = v.slice(); Mpb.teamHeal(lanes, h, lanes[0].round); return h; };
  assert.deepStrictEqual(hp([150, 150]), [160, 150]); assert.deepStrictEqual(hp([195, 150]), [200, 150], 'never above 200'); assert.deepStrictEqual(hp([0, 150]), [0, 150], 'a beaten team stays beaten');
  // a real fight: 150 + 10, then the damage
  put(D, 0, 0, 'Goblin Swarm', 10, 13); put(D, 0, 1, 'Brute', 10, 5); put(D, 1, 1, 'Ether Golem', 13, 5);
  D.hp = [150, 150]; for (const R of D.lanes) R.m.hp = D.hp.slice();
  for (let s = 0; s < 4; s++) Duo.setReady(D, s, true, x.T);
  const sm = D.summary[0];
  assert.ok(sm.duo.lost[0] > 0, 'team A took damage');
  assert.strictEqual(D.hp[0], Math.max(0, 160 - sm.duo.lost[0]), `150 + 10 − ${sm.duo.lost[0]}`);
  // next round: open again, nothing carried over
  for (let k = 0; k < 4; k++) Duo.next(D, k, sm.round, x.T);
  const h2 = D.hp.slice(); Mpb.teamHeal(lanesOf(D), h2, D.lanes[0].m.round);
  assert.deepStrictEqual(h2, D.hp, 'no heal in a round nobody clicked it');
});

check('Sticky moss: once a match; enemies on the tiles within 3 of the Oak move 30% slower, not its own team, not Berserkers', () => {
  const x = bare(23), { D } = x;
  const oak = addKind(D, 0, 'oak', { col: 10, row: 14 });
  for (const R of D.lanes) R.m.gold[0] = 1000;
  const o0 = { mpb: {} }; Mpb.battleOpts(x.m(0), o0);
  assert.ok(o0.mpb.oak && !(o0.tiles || []).some(t => t.oak), 'no moss before it is bought');
  assert.ok(x.act(1, 'mpbBuy', oak.key, 'moss').ok, 'A2 buys it');
  assert.ok(!x.act(0, 'mpbBuy', oak.key, 'moss').ok, 'once a match');
  assert.ok(!Mpb.recOf(Duo.viewFor(D, 2).m, 0, oak.key).skills.moss && !Mpb.oakMossTiles(Duo.viewFor(D, 2).m, Mpb.recOf(Duo.viewFor(D, 2).m, 0, oak.key)).length, 'hidden from the opponents until the fight');
  const o = { mpb: {} }; Mpb.battleOpts(x.m(0), o);
  const moss = o.tiles.filter(t => t.oak);
  assert.strictEqual(moss.length, 49, 'the 7×7 tiles round the Oak (Chebyshev 3), its own too');
  assert.ok(moss.every(t => t.type === 'mud' && t.side === 0 && t.slow === 30));
  // a real Duo fight: a Brute of team B walks in; a Berserker Brute of team B too; team A's own Brute stands in it
  const foe = put(D, 0, 1, 'Brute', 10, 8), zerk = put(D, 1, 1, 'Brute', 12, 8), own = put(D, 0, 0, 'Brute', 9, 13);
  for (const R of D.lanes) R.m.tech = R.m.tech || [{}, {}];
  const zi = UI('Brute'), slot = units[zi].skills.indexOf('berserkers');
  const bt = battleOf(D), [fb] = bodiesOf(bt, 1, foe.id), [zb] = bodiesOf(bt, 1, Duo.move(zerk.id)), [ob] = bodiesOf(bt, 0, own.id);
  zb.u = { ...zb.u, unstoppable: true }; // (as the Berserkers skill makes it)
  const w = Game.tileToWorld(10, 14), half = Game.TILE * 3.5, inMoss = (b) => Math.abs(b.x - w.x) < half && Math.abs(b.y - w.y) < half;
  let slowed = 0, zSlowed = 0, ownSlowed = 0, fIn = 0, zIn = 0, oIn = 0;
  for (let k = 0; k < 3000; k++) { // (where each stood as the tick began: the tiles act before anyone moves)
    const f0 = fb.alive && inMoss(fb), z0 = zb.alive && inMoss(zb), o0 = ob.alive && inMoss(ob);
    if (!bt.step()) break;
    if (f0) { fIn++; if (fb.slowT > 0 && fb.slowMove >= 30) slowed++; }
    if (z0) { zIn++; if (zb.slowT > 0) zSlowed++; }
    if (o0) { oIn++; if (ob.slowT > 0 && ob.slowMove >= 30) ownSlowed++; }
  }
  assert.ok(fIn > 0 && slowed === fIn, `the enemy Brute slowed on the moss (${slowed} of ${fIn} ticks)`);
  assert.ok(zIn > 0 && oIn > 0, 'both walked on it'); assert.strictEqual(zSlowed, 0, 'a Berserker isn\'t'); assert.strictEqual(ownSlowed, 0, 'its own team isn\'t');
  playTo(x, 2);
  const o2 = { mpb: {} }; Mpb.battleOpts(x.m(0), o2);
  assert.strictEqual(o2.tiles.filter(t => t.oak).length, 49, 'for good: still there next round');
  assert.ok(Mpb.oakMossTiles(Duo.viewFor(D, 2).m, Mpb.recOf(Duo.viewFor(D, 2).m, 0, oak.key)).length === 49, 'and now the opponents see it');
});

check('The Oak\'s downside: the round after it fell, a 1-body level 3 Ent with all its skills fights for the opponents', () => {
  const x = bare(24), { D } = x;
  playTo(x, 2);
  for (const R of D.lanes) { for (const sd of [0, 1]) R.m.armies[sd] = []; R.m.artifacts = null; }
  const oak = addKind(D, 0, 'oak');
  put(D, 0, 0, 'Brute', 8, 13); put(D, 0, 1, 'Goblin Swarm', 10, 5);
  assert.ok(!battleOf(D).bodies.some(b => b.u.name === 'Ent'), 'no Ent while the Oak never fell');
  for (const R of D.lanes) Mpb.recOf(R.m, 0, oak.key).fell = R.m.round - 1; // it fell in last round's fight
  const bt = battleOf(D), ents = bt.bodies.filter(b => b.u.name === 'Ent');
  assert.strictEqual(ents.length, 1, 'one body');
  const e = ents[0], base = units[UI('Ent')];
  assert.strictEqual(e.side, 1, 'for the opponents'); assert.strictEqual(e.level, 2, 'level 3 (two levels up)');
  assert.ok((e.u.defVal || 0) + (e.u.bonusArmor || 0) >= 4 && e.u.roots && e.u.deathBlast > 0, 'Reinforced bark, Grasping roots and Explode on death');
  assert.ok(e.u.hp > base.hp * 3, 'more health than a plain level 3 Ent (bark, planting): ' + e.u.hp);
  assert.ok(Duo.teamBody(e.squad) && Mpb.isSquad(e.squad), 'a team body of lane 0 (lane 1 never gets its result)');
  assert.ok(!e.u.structure && !e.u.noCount, 'it counts as a unit');
  const t = x.m(0).towers[1], tw = Game.tileToWorld(t.col, t.row + 1);
  assert.ok(Math.hypot(e.x - tw.x, e.y - tw.y) < Game.TILE, 'in front of the opponents\' tower');
  assert.ok(!bt.bodies.some(b => b.side === 0 && b.u.name === 'Ent'), 'not for the Oak\'s own team');
  while (bt.step()) {}
  assert.ok(bt.result().squads['1:' + e.squad], 'its result is the opponents\'');
  // only the round right after
  for (const R of D.lanes) Mpb.recOf(R.m, 0, oak.key).fell = R.m.round - 2;
  assert.ok(!battleOf(D).bodies.some(b => b.u.name === 'Ent'), 'not two rounds after');
  // the whole thing in a played match: the Oak destroyed (afterFight) -> next round's fight has the Ent
  const y = bare(25), Y = y.D, ok2 = addKind(Y, 0, 'oak'), k = Mpb.recs(y.m(0), 0).indexOf(ok2);
  const sums = lanesOf(Y).map(m => ({ round: m.round }));
  Mpb.afterFight(lanesOf(Y), { squads: { ['0:' + Mpb.squadOf(k)]: { side: 0, squad: Mpb.squadOf(k), total: 1, alive: 0 } }, winner: 1 }, sums, [200, 200]);
  assert.ok(sums[0].mpbNews[0].some(n => n.kind === 'oak' && n.ent), 'the news says so');
  for (const R of Y.lanes) R.m.round++;
  Duo.copyAll(Y.lanes[0].m, Y.lanes[1].m);
  put(Y, 0, 0, 'Brute', 8, 13); put(Y, 0, 1, 'Goblin Swarm', 10, 5);
  assert.strictEqual(battleOf(Y).bodies.filter(b => b.u.name === 'Ent' && b.side === 1).length, 1, 'next round: the Ent');
});

check('mirror symmetry: both teams with a hospital (regen, Field dressing, Second wind) and an Oak (moss): an exact mirror', () => {
  const G = { ...Game.SETTINGS, bounds: { x0: -36, x1: 36, y0: -48, y1: 48 } };
  const hosp = Engine.withTraits({ name: 'Field hospital', cost: 0, bodies: 1, hp: 600, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, structure: true, lesser: true, kind: 'mpb', mpb: 'fieldHospital', defense: 'armor', defVal: 2 });
  const oakU = Engine.withTraits({ name: 'The Oak', cost: 0, bodies: 1, hp: 1200, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, structure: true, lesser: true, kind: 'mpb', mpb: 'oak', defense: 'armor', defVal: 3 });
  const pick = (n) => units[UI(n)];
  let exact = 0, n = 0;
  for (const [name, other] of [['Brute', 'Skeleton Archers'], ['Goblin Swarm', 'Ember Imps'], ['Spiders', 'Fire Mage'], ['Earth Wizard', 'Ent'], ['Water Mage', 'Brute']]) {
    const sides = [0, 1].map(sd => {
      const f = sd === 0 ? -1 : 1, out = [];
      const add = (u, x, y, sq, idx) => { const b = Engine.buildSquad(u, sd, x, y * f, sq, 6, idx); out.push(...b); return b; };
      const a = add({ ...pick(name), regen: 2, hp: pick(name).hp * 1.2 }, -6, 18, 1, 0);
      add(pick(other), 6, 18, 2, 20);
      add(hosp, -6, 30, -700, 40);
      const o = add(oakU, 12, 30, -701, 41); o[0].oakRestore = 1.25;
      for (const b of a) b.fhRevive = { x: -6, y: 24 * f };
      return out;
    });
    const mud = [0, 1].map(sd => { const f = sd === 0 ? -1 : 1, y = 30 * f; return { x0: 12 - 21, x1: 12 + 21, y0: y - 21, y1: y + 21, type: 'mud', side: sd, slow: 30 }; });
    const bt = Engine.createBattle(sides[0], sides[1], G, { tiles: mud, mpb: { oak: true, fieldHospital: { dress: [[0.3, 0.8], [0.3, 0.8]], pct: 25 } } });
    while (bt.step()) {}
    const r = bt.result();
    n++; if (r.winner === -1 && Math.abs(r.frac[0] - r.frac[1]) < 1e-9) exact++;
    else console.log(`      (${name} + ${other}: winner ${r.winner}, ${r.frac.map(v => v.toFixed(4))})`);
  }
  assert.strictEqual(exact, n, `${exact} of ${n} exact mirrors`);
});

check('the page\'s copy hashes as the server\'s after every B2 action; the opponents see none of this round\'s', () => {
  const x = bare(26), { D } = x;
  const h = addKind(D, 0, 'fieldHospital'), oak = addKind(D, 0, 'oak');
  addKind(D, 1, 'fieldHospital'); addKind(D, 1, 'oak');
  const g0 = put(D, 0, 0, 'Brute', 5, 13), g1 = put(D, 1, 0, 'Goblin Swarm', 18, 13);
  for (const R of D.lanes) R.m.gold[0] += 2000;
  D.tbase = [0, 1].map(sd => Duo.teamState(D.lanes[0].m, sd));
  const page = (seat) => W(Duo.viewFor(D, seat).m);
  const try1 = (seat, fn, ...a) => {
    const sd = Duo.SEATS[seat].side, pm = page(seat);
    const local = Game[fn](pm, sd, ...a);
    const r = x.act(seat, fn, ...a);
    assert.strictEqual(!!local, !!r.ok, fn + ' ' + a.join(',') + ': allowed on the page as on the server');
    if (r.ok) { assert.strictEqual(Ref.sideHash(pm, sd), r.h, fn + ': the page\'s copy hashes as the server'); assert.strictEqual(Ref.sideHash(Duo.viewFor(D, seat).m, sd), r.h); }
    return r;
  };
  try1(0, 'mpbBuy', h.key, 'dress'); try1(0, 'mpbBuy', h.key, 'dress'); try1(1, 'mpbBuy', h.key, 'dress');
  try1(0, 'mpbUndo', h.key, 'dress');
  try1(1, 'mpbBuy', h.key, 'wind', 1, g1.id); try1(0, 'mpbBuy', h.key, 'wind', 0, g0.id);
  try1(0, 'mpbAct', h.key, 'wind', 0, g0.id); try1(0, 'mpbAct', h.key, 'nope', 0, g0.id);
  try1(0, 'mpbBuy', oak.key, 'heal'); try1(1, 'mpbBuy', oak.key, 'heal'); try1(1, 'mpbBuy', oak.key, 'heal');
  try1(0, 'mpbBuy', oak.key, 'boost'); try1(1, 'mpbBuy', oak.key, 'moss'); try1(1, 'mpbUndo', oak.key, 'heal');
  for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
  sameTeam(D, 0);
  // what the opponents see of team A's buildings this round: nothing bought
  for (const seat of [2, 3]) {
    const v = Duo.viewFor(D, seat).m, vh = Mpb.recOf(v, 0, h.key), vo = Mpb.recOf(v, 0, oak.key);
    assert.deepStrictEqual(vh.skills, {}, 'no hospital skills'); assert.ok(!vh.data.wind, 'no Second wind target');
    assert.deepStrictEqual(vo.skills, {}, 'no Oak skills');
    const o = { mpb: {} }; Mpb.battleOpts(W(v), o);
    assert.ok(!(o.tiles || []).some(t => t.oak) && !o.mpb.fieldHospital.dress[0].length, 'a fight built from their view has no moss and no dressing');
  }
  // Undo all: A1's go, A2's stay
  assert.ok(x.act(0, 'undoAll').ok);
  const rh = Mpb.recOf(x.m(1), 0, h.key), ro = Mpb.recOf(x.m(1), 0, oak.key);
  assert.strictEqual(rh.skills.dress.n, 1, 'A2\'s dressing stays'); assert.ok(rh.skills.wind && rh.data.wind.lane === 1, 'A2\'s Second wind stays');
  assert.ok(!ro.skills.boost && ro.skills.moss && !ro.skills.heal, 'A1\'s boost goes; A2\'s moss stays (A2 took their heal back)');
  sameTeam(D, 0);
});

check('Second wind doesn\'t fire for a squad its own portal sacrificed (Ember Imps\' Summon hellfiend): it was never wiped out', () => {
  const x = bare(31), { D } = x;
  const h = addKind(D, 0, 'fieldHospital', { col: 10, row: 15 });
  for (const R of D.lanes) R.m.gold[0] = 2000;
  const ui = UI('Ember Imps'), slot = units[ui].skills.indexOf('hellfiend');
  assert.ok(slot >= 0, 'Ember Imps have Summon hellfiend');
  for (const R of D.lanes) { R.m.tech = R.m.tech || [{}, {}]; R.m.tech[0] = R.m.tech[0] || {}; R.m.tech[0][ui] = [0, 0, 0, 0]; R.m.tech[0][ui][slot] = 1; }
  const imps = put(D, 0, 0, 'Ember Imps', 10, 13);
  put(D, 0, 1, 'Brute', 10, 3);
  assert.ok(x.act(0, 'mpbBuy', h.key, 'wind', 0, imps.id).ok);
  const bt = battleOf(D), orig = bodiesOf(bt, 0, imps.id);
  assert.ok(orig.length && orig[0].u.portal && orig.every(b => b.fhRevive), 'the imps have the portal and carry the mark');
  for (let k = 0; k < 4000 && bt.step(); k++) {}
  assert.ok(orig.some(b => b.sacrificed), 'the portal sacrificed the imps');
  assert.ok(bt.bodies.some(b => b.side === 0 && b.u.name === 'Hellfiend'), 'the Hellfiend came out');
  assert.ok(!bt.bodies.some(b => b.fhBack), 'no fresh imps: the revive is spent, nothing comes back');
});

check('Second wind\'s fresh bodies keep what the game put on the squad (Home ground, Mark Bounty, prey, Zoe, Glut count...)', () => {
  const G = { ...Game.SETTINGS, bounds: { x0: -40, x1: 40, y0: -48, y1: 48 } };
  const gobU = Engine.withTraits({ name: 'Gob', cost: 0, bodies: 3, hp: 10, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 });
  const A = Engine.buildSquad(gobU, 0, 0, -10, 1, 6, 0);
  for (const b of A) { b.fhRevive = { x: 0, y: -20 }; b.band = { y0: -100, y1: 100, armor: 2, hpPct: 10, on: false }; b.sniperMark = 5; b.prey = true; b.zoe = true; b.glutN = 3; }
  A.push(...Engine.buildSquad(Engine.withTraits({ name: 'Post', cost: 0, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 0, 20, -40, 3, 6, 5)); // side 0 fights on
  const B = Engine.buildSquad(Engine.withTraits({ name: 'Wall', cost: 0, bodies: 1, hp: 1e6, hit: 0, aps: 1, range: 0, speed: 0, splash: 0 }), 1, 0, 40, 2, 6, 10);
  const bt = Engine.createBattle(A, B, G, { mpb: { fieldHospital: { dress: [[], []], pct: 25 } } });
  bt.step();
  assert.ok(A.every(b => !b.fhRevive || b.band.on), 'the originals stood in their band');
  for (const b of A) if (b.fhRevive) { b.hp = 0; b.alive = false; }
  let back = [];
  for (let k = 0; k < 10 && bt.step(); k++) { back = bt.bodies.filter(b => b.fhBack); if (back.length) break; }
  assert.strictEqual(back.length, 3, 'all three back');
  for (const b of back) {
    assert.ok(b.band && b.band.armor === 2 && b.band.y0 === -100 && b.band !== A[0].band, 'its own Home ground band');
    assert.ok(b.sniperMark === 5 && b.prey === true && b.zoe === true && b.glutN === 3, 'the Mark, the prey, Zoe and the Glut count as the fight began');
    assert.ok(near(b.u.hp, 10), 'the stats as the fight began (no band bonus baked in)');
  }
  bt.step();
  assert.ok(back.every(b => b.band.on && near(b.u.hp, 11)), 'Home ground works on them');
});

check('Restoration is fixed as each tick starts: two Oaks falling on the same tick give an exact mirror', () => {
  const G = { ...Game.SETTINGS, bounds: { x0: -40, x1: 40, y0: -48, y1: 48 } };
  const Wu = (o) => Engine.withTraits({ cost: 0, bodies: 1, aps: 1, speed: 0, splash: 0, range: 0, hit: 0, ...o });
  let fellTogether = 0;
  for (const oakHp of [40, 60, 80, 100, 130, 170, 220, 300]) {
    const sides = [0, 1].map(sd => {
      const f = sd === 0 ? -1 : 1, out = [];
      const add = (u, x, y, sq, idx) => { const b = Engine.buildSquad(u, sd, x, y * f, sq, 6, idx); out.push(...b); return b; };
      add(Wu({ name: 'The Oak', hp: oakHp, structure: true, lesser: true, kind: 'mpb', mpb: 'oak' }), 0, 3, -701, 0)[0].oakRestore = 1.25;
      add(Wu({ name: 'Shooter', hp: 5000, hit: 20, aps: 2, range: 13, defense: 'armor', defVal: 0 }), 0, 8, 1, 1);
      add(Wu({ name: 'Mender', hp: 5000, hit: 1, aps: 20, range: 40, mend: 15 }), -20, 30, 2, 2);
      add(Wu({ name: 'Tank', hp: 100000, hit: 0 }), -20, 32, 3, 3)[0].hp = 50000;
      return out;
    });
    const bt = Engine.createBattle(sides[0], sides[1], G, { mpb: { oak: true } });
    for (let k = 0; k < 400 && bt.step(); k++) {}
    const tanks = bt.bodies.filter(b => b.u.name === 'Tank'), oaks = bt.bodies.filter(b => b.u.name === 'The Oak');
    if (oaks.every(o => !o.alive) && oaks[0].diedTick === oaks[1].diedTick) fellTogether++;
    assert.ok(tanks[0].hp > 50000 && tanks[0].hp === tanks[1].hp, `Oak health ${oakHp}: tanks ${tanks[0].hp} / ${tanks[1].hp}`);
  }
  assert.ok(fellTogether >= 4, 'the Oaks fell on the same tick in most cases: ' + fellTogether);
});

check('The Oak\'s Heal writes a results line: the HP bar and the results screen agree', () => {
  const x = bare(22), { D } = x;
  const oak = addKind(D, 0, 'oak');
  for (const R of D.lanes) R.m.gold[0] = 1000;
  D.hp = [150, 150]; for (const R of D.lanes) R.m.hp = D.hp.slice();
  assert.ok(x.act(0, 'mpbBuy', oak.key, 'heal').ok && x.act(1, 'mpbBuy', oak.key, 'heal').ok);
  put(D, 0, 0, 'Goblin Swarm', 10, 13); put(D, 0, 1, 'Brute', 10, 5); put(D, 1, 1, 'Ether Golem', 13, 5);
  D.hp = [150, 150]; for (const R of D.lanes) R.m.hp = D.hp.slice();
  let f = null; for (let s = 0; s < 4; s++) f = Duo.setReady(D, s, true, x.T) || f;
  for (const sm of f.summaries) {
    const n = sm.mpbNews[0].filter(q => q.kind === 'oak' && q.healed);
    assert.strictEqual(n.length, 1, 'one Oak line in each lane\'s results'); assert.strictEqual(n[0].healed, 10); assert.ok(/\+10 Team HP/.test(n[0].text));
    assert.ok(!(sm.mpbNews[1] || []).some(q => q.kind === 'oak'), 'nothing for the other team');
  }
  assert.strictEqual(D.hp[0], Math.max(0, 150 + 10 - f.summaries[0].duo.lost[0]));
  // at the cap: nothing gained, no line
  const y = bare(22), o2 = addKind(y.D, 0, 'oak');
  for (const R of y.D.lanes) R.m.gold[0] = 1000;
  for (const R of y.D.lanes) R.m.hp = [190, 200]; // (bought while hurt: at full health it is refused)
  assert.ok(y.act(0, 'mpbBuy', o2.key, 'heal').ok);
  const sums = [{}, {}], hp = [200, 200]; Mpb.teamHeal(lanesOf(y.D), hp, y.m(0).round, sums);
  assert.deepStrictEqual(hp, [200, 200]); assert.ok(!sums[0].mpbNews, 'no line when the team is at its starting health');
});

check('Field dressing can\'t be worked out while deploying: its seed (fhSeed) is in no view, only in the fight\'s snapshots', () => {
  let missed = 0;
  for (let s = 0; s < 8; s++) {
    const x = bare(60 + s), { D } = x;
    const h = addKind(D, 0, 'fieldHospital');
    for (const R of D.lanes) R.m.gold[0] = 2000;
    put(D, 0, 0, 'Brute', 5, 13); put(D, 0, 0, 'Ent', 8, 13); put(D, 1, 0, 'Brute', 15, 13); put(D, 1, 0, 'Spiders', 18, 13);
    put(D, 0, 1, 'Goblin Swarm', 10, 5);
    const hp0 = {}; for (const b of battleOf(D).bodies) if (b.side === 0 && b.squad >= 0) hp0[b.squad] = b.u.hp;
    assert.ok(x.act(0, 'mpbBuy', h.key, 'dress').ok);
    for (let k = 0; k < 4; k++) assert.ok(Duo.viewFor(D, k).m.fhSeed == null, 'no seat sees it');
    // what A1 would work out from their own view
    const o = { mpb: {} }; Mpb.battleOpts(W(Duo.viewFor(D, 0).m), o);
    const ids = Object.keys(hp0).map(Number).sort((a, b) => a - b), pred = ids[Math.min(ids.length - 1, Math.floor(o.mpb.fieldHospital.dress[0][0] * ids.length))];
    let f = null; for (let k = 0; k < 4; k++) f = Duo.setReady(D, k, true, x.T) || f;
    assert.ok(f.pres.every(p => p.fhSeed != null), 'the fight\'s snapshots carry it (the page plays the fight from them)');
    assert.ok(D.lanes.every(R => R.m.fhSeed == null) && f.posts.every(p => p.fhSeed == null), 'gone after the fight');
    const bt = Duo.battle(f.pres.map(W));
    const got = [...new Set(bt.bodies.filter(b => b.side === 0 && b.squad >= 0 && b.u.hp > hp0[b.squad] * 1.2).map(b => b.squad))];
    assert.strictEqual(got.length, 1, 'one squad dressed');
    if (got[0] !== pred) missed++;
  }
  assert.ok(missed >= 2, 'the view\'s guess misses: ' + missed + ' of 8');
  assert.ok(Mpb.KINDS.fieldHospital.skills.find(s => s.id === 'wind').pick, 'Second wind is bought with the sheet\'s squad picker (no generic Buy button)');
});

check('a full bot 2v2, rounds 1 to 10, both kinds on both teams: no exception, team state equal, views in step, playback, bots use the skills', () => {
  const used = {};
  for (let seed = 1; seed <= 3; seed++) {
    const D = Duo.create({}, units);
    let T = 1e12, rounds = 0;
    Duo.start(D, units, matrix, T, 2000 + seed, [true, true, true, true]);
    for (const sd of [0, 1]) { addKind(D, sd, 'fieldHospital'); addKind(D, sd, 'oak'); }
    let ents = 0, revived = 0;
    while (D.phase !== 'end' && D.lanes[0].m.round <= 10) {
      T += 1000;
      for (const sd of [0, 1]) sameTeam(D, sd);
      for (let k = 0; k < 4; k++) { const sd = Duo.SEATS[k].side; assert.strictEqual(Ref.sideHash(Duo.viewFor(D, k).m, sd), Ref.sideHash(D.lanes[Duo.SEATS[k].lane].m, sd), 'seat ' + k + ' in step'); }
      for (const sd of [0, 1]) for (const r of Mpb.recs(D.lanes[0].m, sd)) for (const id in r.skills) if (r.skills[id].round === D.lanes[0].m.round) used[r.kind + ':' + id] = (used[r.kind + ':' + id] || 0) + 1;
      const f = Duo.tick(D, T + 400000);
      assert.ok(f, 'the clock starts the fight in round ' + D.lanes[0].m.round);
      const bt = Duo.battle(f.pres.map(W)); while (bt.step()) {}
      ents += bt.bodies.filter(b => b.u.name === 'Ent' && Mpb.isSquad(b.squad)).length; revived += bt.bodies.filter(b => b.fhBack).length;
      assert.strictEqual(bt.result().winner, f.summaries[0].duo.winner, 'playback from pre: the same fight');
      rounds++;
      if (D.phase === 'result') for (let k = 0; k < 4; k++) Duo.next(D, k, D.summary[0].round, T);
    }
    console.log(`      seed ${seed}: ${rounds} rounds, hp ${D.hp.join(' / ')}, oak Ents ${ents}, bodies back by Second wind ${revived}`);
  }
  console.log('      bot buys: ' + JSON.stringify(used));
  for (const k of ['fieldHospital:dress', 'oak:heal']) assert.ok(used[k] > 0, 'bots used ' + k);
});

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall B2 checks passed');
