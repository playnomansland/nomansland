// ===== 2v2 (developer test, 2026-11-02) =====
// Two Standard boards side by side. Each board is a lane: an ordinary 1v1 match of its own (src/game.js), so deploying,
// the shop, levels, skills, leaders and towers all work as in 1v1, and each phone plays its own lane with the usual UI.
// The two teams are the two sides: team A is side 0 in both lanes, team B side 1.
//
//   seat 0 = A1 (lane 0, side 0)   seat 1 = A2 (lane 1, side 0)
//   seat 2 = B1 (lane 0, side 1)   seat 3 = B2 (lane 1, side 1)
//
// The fight is one battle on the wide field: every body of both lanes, lane 0 on the left, lane 1 on the right (each
// lane's own board shifted half a board sideways, Game.withXOff). Nothing keeps units in their lane: awareness works as
// in any fight, so a squad near the middle can spot, walk over to and fight the other lane's enemies.
// After the fight the result is split back by lane (squad ids of lane 1 are moved by OFF inside the battle), each lane
// is resolved as a 1v1 round (XP, gold, streaks, treasuries ...), and the damage both lanes take comes off one shared
// team health.
//
// This file also has the refereed 2v2 match (D) the game server keeps (server/src/duo.js), built from two Referee
// lanes. Draws nothing and sends nothing: the page, the server and node tests share it.
//   const Duo = require('./src/duo.js')   (in the page: the global Duo)
(function (root) {
  const G = (typeof Game !== 'undefined') ? Game : require('./game.js');
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');
  const Ref = (typeof Referee !== 'undefined') ? Referee : require('./referee.js');

  const V = 1;
  const MAP = 'testgrid';            // both lanes are Standard boards
  const VIEW_MAP = 'duo';            // the wide board a 2v2 fight is drawn on (Game.VIEW_MAPS)
  const OFF = 1000000;               // lane 1's squad ids inside the fight are moved by this
  const GAP = 2;                     // open tiles between the two boards (walkable: crossing over takes a few steps)
  const HP = 2 * G.START_HP;         // each team's shared health (two lanes take damage every round)
  const BIG = 1e6;                   // a lane's health while it is resolved (the team's health is kept apart)
  const SEATS = [{ lane: 0, side: 0 }, { lane: 1, side: 0 }, { lane: 0, side: 1 }, { lane: 1, side: 1 }];
  const SEAT_NAMES = ['A1', 'A2', 'B1', 'B2'];
  // team talk (server/src/duo.js relays them to the team only): pings on a tile, and quick lines
  const PINGS = ['?', '!', 'go'];
  const EMOTES = ['nice', 'help', 'sorry', 'wait', 'thanks', 'gg'];
  const EMOTE_TEXT = { nice: 'Nice! 👍', help: 'Help me!', sorry: 'Sorry!', wait: 'Wait for me', thanks: 'Thanks!', gg: 'GG' };
  const seatOf = (lane, side) => SEATS.findIndex(s => s.lane === lane && s.side === side);
  const mateOf = (seat) => seatOf(1 - SEATS[seat].lane, SEATS[seat].side);

  // ----- squad ids inside the fight -----
  const remap = (L, id) => L === 0 || typeof id !== 'number' ? id : id >= 0 ? id + OFF : id - OFF;
  const laneOfId = (id) => id >= OFF || id <= -OFF ? 1 : 0;
  const unmap = (id) => id >= OFF ? id - OFF : id <= -OFF ? id + OFF : id;

  // a lane's column on the wide board, and back (null: the open strip between the boards)
  function wideCol(lane, col) { G.useGrid(MAP); return lane === 0 ? col : col + G.COLS + GAP; }
  function laneCol(wcol) { G.useGrid(MAP); const c = G.COLS; return wcol < c ? { lane: 0, col: wcol } : wcol >= c + GAP && wcol < 2 * c + GAP ? { lane: 1, col: wcol - c - GAP } : null; }
  // how far each lane's board is moved sideways (metres): half a Standard board and half the gap each way
  function laneDx(L) { G.useGrid(MAP); return (L === 0 ? -1 : 1) * (G.COLS + GAP) * G.TILE / 2; }

  // as Referee.fight: towers, packages, tower picks and walls nobody placed are settled first
  function settle(m) {
    G.ensureTower(m, 0); G.ensureTower(m, 1);
    G.ensurePack(m, 0); G.ensurePack(m, 1);
    G.settleTowerPicks(m);
    G.ensureBwalls(m, 0); G.ensureBwalls(m, 1);
  }

  // The fight of two lanes (matches with units, as they stand when it begins): a steppable Engine battle on the wide
  // field. Changes nothing. Bodies carry .lane.
  function battle(lanes, opts = {}) {
    const A = [], B = [], tiles = [], strikes = [], neutrals = [], charm = [{}, {}];
    let g = null;
    lanes.forEach((m, L) => {
      const dx = laneDx(L);
      G.withXOff(dx, () => {
        const s = G.battleSetup(m);
        if (!g) g = s.g;
        tiles.push(...(s.opts.tiles || [])); strikes.push(...(s.opts.strikes || [])); neutrals.push(...(s.opts.neutrals || []));
        for (const sd of [0, 1]) {
          const c = s.opts.charm && s.opts.charm[sd];
          if (c) for (const k in c) charm[sd][remap(L, +k)] = c[k];
          for (const b of G.bodiesFor(m, sd)) { b.squad = remap(L, b.squad); b.lane = L; (sd === 0 ? A : B).push(b); }
        }
      });
    });
    G.useGrid(MAP);
    const half = (2 * G.COLS + GAP) * G.TILE / 2, rows = G.ROWS * G.TILE / 2;
    g = { ...g, bounds: { x0: -half, x1: half, y0: -rows, y1: rows } };
    const ch = charm.map(c => Object.keys(c).length ? c : null);
    return E.createBattle(A, B, g, { tiles, strikes, neutrals, charm: ch, terrain: null, objective: null, lanes: true, record: opts.record !== false });
  }

  // lane L's share of a wide fight's result, in that lane's own squad ids (as Game.resolve wants it). The winner and
  // timeout are the whole fight's: a team wins or loses the round together.
  function laneResult(res, L, m) {
    const squads = {};
    for (const k in res.squads) {
      const q = res.squads[k];
      if (laneOfId(q.squad) !== L) continue;
      const id = unmap(q.squad);
      squads[q.side + ':' + id] = { ...q, squad: id };
    }
    const charm = (res.charm || [null, null]).map(c => {
      if (!c) return null;
      const o = {};
      for (const k in c) if (laneOfId(+k) === L) o[unmap(+k)] = c[k];
      return Object.keys(o).length ? o : null;
    });
    // Mark Bounty: the whole fight says a side's Sniper took a marked squad's last body; it pays in the lane whose mark it was
    const markKill = [0, 1].map(sd => {
      if (!(res.markKill && res.markKill[sd])) return false;
      const mk = G.markOf(m, sd), q = mk && squads[(1 - sd) + ':' + mk.squad];
      return !!(q && q.alive === 0);
    });
    const buildings = (res.buildings || []).filter(b => laneOfId(b.squad) === L).map(b => ({ ...b, squad: unmap(b.squad) }));
    return { ...res, squads, charm, markKill, buildings, objective: -1 };
  }

  // Plays the fight of two lanes and applies it. lanes: the two matches (changed), hp: [team A, team B] (changed).
  // Returns { pres, posts, summaries } (snapshots before and after, each lane's summary; summary.duo has the team's).
  function fight(lanes, hp) {
    for (const m of lanes) settle(m);
    const pres = lanes.map(m => Ref.snapshot(m));
    const bt = battle(lanes, { record: false });
    while (bt.step()) {}
    const res = bt.result();
    const lost = [0, 0], dmg = [0, 0], towerHp = [0, 0];
    const summaries = lanes.map((m, L) => {
      m.hp = [BIG, BIG];
      const sm = G.resolve(m, laneResult(res, L, m));
      for (const sd of [0, 1]) { lost[sd] += BIG - m.hp[sd]; dmg[sd] += sm.dmg[sd] || 0; towerHp[sd] += (sm.towerHp && sm.towerHp[sd]) || 0; }
      return sm;
    });
    for (const sd of [0, 1]) hp[sd] = Math.max(0, hp[sd] - lost[sd]);
    const over = hp[0] <= 0 || hp[1] <= 0, winner = hp[0] > 0 ? 0 : hp[1] > 0 ? 1 : -1;
    lanes.forEach((m, L) => {
      m.hp = hp.slice();
      if (over) { m.over = true; m.winner = winner; }
      const sm = summaries[L];
      sm.duo = { lane: L, laneDmg: sm.dmg.slice(), laneTowerHp: (sm.towerHp || [0, 0]).slice(), lost: lost.slice(), hp: hp.slice(), winner: res.winner, over };
      sm.dmg = dmg.slice(); sm.towerHp = towerHp.slice(); // the results screen shows the team's damage
    });
    return { pres, posts: lanes.map(m => Ref.snapshot(m)), summaries };
  }

  // A picture of the two lanes on the wide board (a match on Game's 'duo' view map), for drawing a 2v2 fight: lane 0's
  // match with both lanes' squads (lane 1's moved COLS tiles right, ids by OFF). Snapshots in, a snapshot out.
  function view(pres) {
    G.useGrid(MAP);
    const cols = G.COLS, v = JSON.parse(JSON.stringify(pres[0]));
    v.map = { ...(v.map || {}), id: VIEW_MAP };
    v.armies = [0, 1].map(sd => (pres[0].armies[sd] || []).map(q => ({ ...q, lane: 0 }))
      .concat((pres[1].armies[sd] || []).map(q => ({ ...q, col: q.col + cols + GAP, id: remap(1, q.id), lane: 1 }))));
    v.duo = { cols, gap: GAP }; // one board's columns, and the open columns between the boards
    G.useGrid(VIEW_MAP); // left on the wide board: whoever draws it next reads Game.COLS
    return v;
  }

  // ===================== the refereed 2v2 match (the game server keeps it) =====================
  // D: { v, settings, phase: 'lobby' | 'deploy' | 'result' | 'end', lanes: [R, R] (Referee lanes), bots: [b x4],
  //      hp: [team A, team B], ready, nextReady, rematch, away: [x4], deadline, held, summary: [lane 0's, lane 1's],
  //      fights, seed, forfeit (the seat that left, or null) }
  // A seat's actions go through its lane's Referee (the very same checks as 1v1); the clock, Ready and the fight are
  // the whole match's. Times are passed in (now).
  const AWAY_MAX_MS = Ref.AWAY_MAX_MS, GRACE_MS = Ref.GRACE_MS, MIN_LEFT_MS = 10000;

  function create(settings, units) {
    const s = Ref.cleanSettings({ ...(settings || {}), map: MAP }, units);
    s.map = MAP;
    return { v: V, settings: s, phase: 'lobby', lanes: [null, null], bots: [false, false, false, false], hp: [HP, HP],
      ready: [false, false, false, false], nextReady: [false, false, false, false], rematch: [false, false, false, false],
      away: [0, 0, 0, 0], deadline: 0, held: 0, summary: null, fights: 0, seed: 0, forfeit: null };
  }
  const laneOf = (D, seat) => D.lanes[SEATS[seat].lane];
  const deployMsOf = (D) => (D.lanes[0].m.round === 1 ? D.settings.deploy1 : D.settings.deploy) * 1000;
  const humans = (D) => [0, 1, 2, 3].filter(k => !D.bots[k]);
  const picksPending = (D) => humans(D).some(k => G.needsTowerPick(laneOf(D, k).m, SEATS[k].side));
  const someoneAway = (D, now) => humans(D).some(k => D.away[k] && now - D.away[k] < AWAY_MAX_MS);
  // each lane's own referee state follows the match's (its act checks phase, Ready and the deadline)
  function mirror(D) {
    for (const R of D.lanes) {
      if (!R) continue;
      R.phase = D.phase; R.deadline = D.deadline; R.held = D.held;
      R.ready = [0, 1].map(sd => !!D.ready[seatOf(D.lanes.indexOf(R), sd)]);
      R.summary = D.summary ? D.summary[D.lanes.indexOf(R)] : null;
    }
  }
  function clock(D, now) {
    if (D.phase !== 'deploy') { D.deadline = 0; D.held = 0; mirror(D); return; }
    const stop = picksPending(D) || someoneAway(D, now);
    if (stop && D.deadline) { D.held = Math.max(MIN_LEFT_MS / 2, D.deadline - now); D.deadline = 0; }
    else if (!stop && !D.deadline) { D.deadline = now + Math.max(MIN_LEFT_MS, D.held || deployMsOf(D)); D.held = 0; }
    mirror(D);
  }
  // a bot's turn at the start of a round: package, tower pick and squads (it levels up when the fight begins)
  function botTurn(D, seat) {
    const R = laneOf(D, seat), m = R.m, sd = SEATS[seat].side;
    if (G.needsPack(m, sd)) G.choosePack(m, sd, Math.floor(Math.random() * m.packages[sd].length));
    if (G.needsTowerPick(m, sd)) { const ch = G.towerChoices(m, sd); G.setTowerType(m, sd, ch[Math.floor(Math.random() * ch.length)].id); }
    G.aiDeploy(m, sd);
  }
  function beginRound(D, now) {
    D.phase = 'deploy';
    D.ready = D.bots.slice(); D.nextReady = [false, false, false, false]; D.rematch = [false, false, false, false];
    for (const R of D.lanes) {
      R.round = R.m.round; R.nextReady = [false, false]; R.rematch = [false, false]; R.undo = [null, null];
      R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
    }
    for (let k = 0; k < 4; k++) if (D.bots[k]) botTurn(D, k);
    D.deadline = 0; D.held = deployMsOf(D);
    clock(D, now);
  }
  // a new match (the lobby's Start, or a rematch). bots: the seats nobody sits in.
  function start(D, units, matrix, now, seed, bots) {
    if (bots) D.bots = bots.slice(0, 4).map(Boolean);
    D.seed = seed >>> 0;
    D.lanes = [0, 1].map(L => {
      const R = Ref.create(D.settings, units);
      R.settings = D.settings;
      Ref.start(R, units, matrix, now, (D.seed + L * 0x9e3779b1) >>> 0);
      return R;
    });
    D.hp = [HP, HP];
    for (const R of D.lanes) R.m.hp = D.hp.slice();
    D.summary = null; D.fights = 0; D.forfeit = null;
    beginRound(D, now);
    return true;
  }
  const canAct = (D, seat) => D.phase === 'deploy' && !D.ready[seat] && !D.lanes[0].m.over;
  // one action from a seat (as Referee.act: { seq, fn, a }). Returns { ok, h, why }.
  function act(D, seat, d, now) {
    const R = laneOf(D, seat), sd = SEATS[seat].side;
    mirror(D);
    if (!canAct(D, seat)) {
      const seq = Number.isInteger(d && d.seq) ? d.seq : 0;
      if (seq > R.seq[sd]) R.seq[sd] = seq;
      return { ok: false, why: D.ready[seat] ? 'ready' : 'phase' };
    }
    const r = Ref.act(R, sd, d, now);
    clock(D, now); // a tower pick may let the clock start (Referee.act only looks at its own lane)
    return r;
  }
  function setReady(D, seat, v, now) {
    if (D.phase !== 'deploy' || D.lanes[0].m.over || (D.deadline && now > D.deadline + GRACE_MS)) return null;
    D.ready[seat] = !!v; mirror(D);
    return D.ready.every(Boolean) ? runFight(D, now) : null;
  }
  function runFight(D, now) {
    if (D.phase !== 'deploy') return null;
    for (let k = 0; k < 4; k++) if (D.bots[k]) G.aiLevel(laneOf(D, k).m, SEATS[k].side);
    const f = fight(D.lanes.map(R => R.m), D.hp);
    D.fights++;
    for (const R of D.lanes) R.fights = D.fights;
    D.summary = f.summaries;
    D.phase = D.lanes[0].m.over ? 'end' : 'result';
    D.ready = [false, false, false, false]; D.rematch = [false, false, false, false];
    D.nextReady = [0, 1, 2, 3].map(k => D.bots[k] || !!D.away[k]); // bots, and players who are away, move on by themselves
    D.deadline = 0; D.held = 0;
    mirror(D);
    return f;
  }
  function tick(D, now) {
    if (D.phase === 'deploy') {
      clock(D, now);
      if (D.deadline && now >= D.deadline + GRACE_MS) return runFight(D, now);
    }
    return null;
  }
  function due(D, now) {
    if (D.phase !== 'deploy') return 0;
    if (D.deadline) return D.deadline + GRACE_MS;
    const left = humans(D).filter(k => D.away[k]).map(k => D.away[k] + AWAY_MAX_MS).filter(t => t > now);
    return left.length ? Math.min(...left) + 50 : 0;
  }
  function next(D, seat, round, now) {
    if (D.phase !== 'result' || !D.summary || round !== D.summary[0].round) return false;
    D.nextReady[seat] = true;
    if (D.nextReady.every(Boolean)) { beginRound(D, now); return true; }
    return false;
  }
  function rematch(D, seat, units, matrix, now, seed) {
    if (D.phase !== 'end') return false;
    D.rematch[seat] = true;
    if (humans(D).every(k => D.rematch[k])) return start(D, units, matrix, now, seed);
    return false;
  }
  // a player leaves: their team loses
  function forfeit(D, seat) {
    if (D.phase === 'lobby' || D.phase === 'end' || !D.lanes[0] || D.lanes[0].m.over) return false;
    const sd = SEATS[seat].side;
    D.hp[sd] = 0;
    for (const R of D.lanes) { R.m.over = true; R.m.winner = 1 - sd; R.m.hp = D.hp.slice(); }
    D.phase = 'end'; D.deadline = 0; D.held = 0; D.forfeit = seat;
    for (const R of D.lanes) R.forfeit = sd;
    mirror(D);
    return true;
  }
  function setAway(D, seat, away, now) {
    D.away[seat] = away ? (D.away[seat] || now) : 0;
    if (away && D.phase === 'result') { D.nextReady[seat] = true; if (D.nextReady.every(Boolean)) { beginRound(D, now); return true; } }
    clock(D, now);
    return false;
  }
  // what one seat sees: its own lane as in 1v1 (m), and its teammate's lane as their team sees it (mate)
  function viewFor(D, seat) {
    const own = SEATS[seat], R = D.lanes[own.lane], O = D.lanes[1 - own.lane], deploy = D.phase === 'deploy';
    return { m: Ref.view(R.m, own.side, deploy, R.base), mate: Ref.view(O.m, own.side, deploy, O.base) };
  }
  const save = (D) => ({ ...D, lanes: D.lanes.map(R => R ? Ref.save(R) : null) });
  const load = (o, units, matrix) => o && o.v === V ? { ...o, lanes: (o.lanes || [null, null]).map(R => R ? Ref.load(R, units, matrix) : null) } : null;

  const api = {
    V, MAP, VIEW_MAP, OFF, GAP, HP, wideCol, laneCol, PINGS, EMOTES, EMOTE_TEXT, SEATS, SEAT_NAMES, seatOf, mateOf, remap, unmap, laneOfId, laneDx, settle, battle, laneResult, fight, view,
    create, start, act, setReady, runFight, tick, due, next, rematch, forfeit, setAway, viewFor, clock, canAct, save, load, humans,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Duo = api;
})(typeof window !== 'undefined' ? window : globalThis);
