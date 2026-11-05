// ===== 2v2 (developer test; one shared board since 2026-11-03) =====
// One wide board (Game's 'duo' map: 24 x 18, two columns of flank tiles on each edge). Both players of a team deploy
// in the same zone, and each team has one tower and one treasury. No leaders.
//
// Under the hood each pair of opponents is still a lane: an ordinary 1v1 match of its own (src/game.js), so each
// player keeps their own gold, shop, unlocks, skills, levels and deployments, and every action goes through the very
// same Referee checks as 1v1. All four players share the board's coordinates:
//
//   seat 0 = A1 (lane 0, side 0)   seat 1 = A2 (lane 1, side 0)
//   seat 2 = B1 (lane 0, side 1)   seat 3 = B2 (lane 1, side 1)
//
// - m.team (Game.teamArmy / teamSeen): each lane's match carries the other lane's squads, so a teammate's squad takes
//   its tile and the other opponent's squads hold theirs, as your own would. Their ids are moved by OFF. It also carries
//   that lane's skills (tech) for the unit sheets; the page's ownerOf says whose any squad is (seat, name, you/mate/foe).
// - The team's tower and treasury: lane 0's stand in the fight; lane 1's never do (same tiles, same type). Tower
//   purchases (tower skills, walls, Fortify, mage generals) are the team's: whoever buys pays, and both lanes get it
//   (copyTeam). Only the buyer can take back their own buy. The Bank's Major investment stays each player's own.
// - The tower type is a vote in round 3: each player picks in their own lane; if the two differ, a human's vote beats
//   an AI's, and between two humans a coin flip (seeded) decides. Tower buys wait until the vote is settled.
// - The fight: every body of both lanes on the one board (lane 1's squad ids moved by OFF). Afterwards each lane is
//   resolved as a 1v1 round (XP, gold, streaks...); lane 1 gets the shared treasury's result too (each player is paid
//   or raided), the tower's fall counts once, and the damage both lanes take comes off one shared team health.
//
// This file also has the refereed 2v2 match (D) the game server keeps (server/src/duo.js). Draws nothing and sends
// nothing: the page, the server and node tests share it.
//   const Duo = require('./src/duo.js')   (in the page: the global Duo)
(function (root) {
  const G = (typeof Game !== 'undefined') ? Game : require('./game.js');
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');
  const Ref = (typeof Referee !== 'undefined') ? Referee : require('./referee.js');

  const V = 2;
  const MAP = 'duo';                 // the 2v2 board (Game.TEAM_MAPS)
  const OFF = 1000000;               // lane 1's squad ids inside the fight (and the other lane's squads in m.team) are moved by this
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

  // ----- squad ids -----
  const move = (id) => typeof id !== 'number' ? id : id >= 0 ? id + OFF : id - OFF;
  const remap = (L, id) => L === 0 ? id : move(id);
  const laneOfId = (id) => id >= OFF || id <= -OFF ? 1 : 0;
  const unmap = (id) => id >= OFF ? id - OFF : id <= -OFF ? id + OFF : id;

  // ----- the other lane on this lane's board (m.team) -----
  const moved = (q) => { const o = { ...q, id: move(q.id) }; if (q.in != null) o.in = move(q.in); if (q.from && q.from.in != null) o.from = { ...q.from, in: move(q.from.in) }; return o; };
  // the squads of match o (the other lane) as m.team carries them; half: the half of the board this lane's players use.
  // buildings: the other lane's buildings from skills (the Cog Builder's Factory: { id, col, row, round, built }), so
  // their tiles are taken in this lane too (Game.occupied) and the board can draw them.
  // tech: that lane's skills, so a teammate's (or the other opponent's) unit sheet shows their own (a seat's view gets
  // o as Referee.view hides it, so the opponents' skills bought this round stay hidden). Direction arrows (sq.aim) come
  // along with the squads: the teammate's all, the opponents' never while deploying (Referee.hide drops them).
  const teamOf = (o, half) => ({ half, armies: [0, 1].map(sd => (o.armies[sd] || []).map(moved)),
    buildings: [0, 1].map(sd => ((o.buildings && o.buildings[sd]) || []).map(b => ({ id: b.id, col: b.col, row: b.row, round: b.round, built: !!b.built }))),
    tech: [0, 1].map(sd => (o.tech && o.tech[sd]) || null) });
  // the server's copy: each lane gets the other lane's squads as they really stand (the rules check against them)
  function setTeam(lanes, L) { lanes[L].team = teamOf(lanes[1 - L], L); }
  function setTeams(lanes) { setTeam(lanes, 0); setTeam(lanes, 1); }

  // ----- the team's tower: what is shared, and copying it from one lane to the other -----
  const TEAM_FIELDS = ['towerSkill', 'towerSkill2', 'bwalls', 'mageGen', 'tround'];
  const TEAM_FNS = new Set(['buyTowerSkill', 'undoTowerSkill', 'buyTowerSkill2', 'undoTowerSkill2', 'fortify', 'placeBwall', 'unplaceBwall', 'buyMageGen', 'undoMageGen', 'buyTround', 'undoTround']);
  const isBank = (m, sd) => G.towerType(m, sd).id === 'bank';
  const BLANK = { towerSkill: 0, towerSkill2: 0, bwalls: [], mageGen: null, tround: {} };
  const getF = (m, f, sd) => m[f] ? m[f][sd] : BLANK[f];
  function setF(m, f, sd, v) { if (!m[f]) m[f] = [BLANK[f], BLANK[f]].map(x => JSON.parse(JSON.stringify(x))); m[f][sd] = v == null ? v : JSON.parse(JSON.stringify(v)); }
  // the tower part of side sd from src to dst (the Bank's Major investment is each player's own: it pays them back)
  function copyTeam(src, dst, sd) {
    for (const f of TEAM_FIELDS) { if (f === 'towerSkill2' && (isBank(src, sd) || isBank(dst, sd))) continue; setF(dst, f, sd, getF(src, f, sd)); }
  }
  const teamState = (m, sd) => JSON.parse(JSON.stringify(Object.fromEntries(TEAM_FIELDS.map(f => [f, getF(m, f, sd)]))));
  function putTeamState(m, sd, st) { for (const f of TEAM_FIELDS) { if (f === 'towerSkill2' && isBank(m, sd)) continue; setF(m, f, sd, st[f]); } }

  // as Referee.fight: towers, packages, tower picks and walls nobody placed are settled first (lane by lane, so lane 1's
  // package squads see lane 0's)
  function settle(lanes) {
    lanes.forEach((m, L) => {
      setTeam(lanes, L);
      G.ensureTower(m, 0); G.ensureTower(m, 1);
      G.ensurePack(m, 0); G.ensurePack(m, 1);
      G.settleTowerPicks(m);
    });
    for (const sd of [0, 1]) copyTeam(lanes[0], lanes[1], sd);
    lanes.forEach(m => { G.ensureBwalls(m, 0); G.ensureBwalls(m, 1); });
    for (const sd of [0, 1]) copyTeam(lanes[0], lanes[1], sd);
  }

  // ----- the 2v2 units: the built-in units plus three Mechite units -----
  // 1v1, ranked and tournaments stay on the built-in units; a 2v2 match (page: useSet, server: server/src/units.js
  // duoUnits) is played with this set, prepared the same way on both, so the referee and every phone agree. The
  // Mechites come from the Factions data (src/faction-units.json, F) without their faction (no faction trait, open to
  // everyone as any unit): Rollers, Cog Builder (with its Factory) and Mechite Guards. The Altar of Build stays out.
  const MECHITES = ['Rollers', 'Cog Builder', 'Mechite Guards'];
  const DUO_BUILDINGS = ['factory'];
  // base: { units, matrix, skills } (src/demo-units.json); F: { units, matrix, skills, buildings }. Returns a set
  // { units, matrix, skills } and makes sure Game knows the Factory (Game.setBuildings; the page has it already, the
  // server and node tests get it here).
  function unitSet(base, F) {
    const add = MECHITES.map(n => F.units.find(u => u.name === n)).filter(Boolean);
    const units = base.units.concat(add.map(u => { const { faction, ...rest } = u; return rest; }));
    const n0 = base.units.length, fi = (name) => F.units.findIndex(u => u.name === name);
    // the counter table (the AI's guide): the built-in part as it is; with a Mechite unit, the Factions table's value
    // where it has the other unit too (Goblin Swarm, Brute, Ent...), else 0 (not measured)
    const cell = (i, j) => {
      if (i < n0 && j < n0) return base.matrix[i][j];
      if (i === j) return 0;
      const a = fi(units[i].name), b = fi(units[j].name);
      return a >= 0 && b >= 0 && F.matrix[a] && isFinite(+F.matrix[a][b]) ? +F.matrix[a][b] : 0;
    };
    const matrix = units.map((_, i) => units.map((__, j) => cell(i, j)));
    const have = new Set((base.skills || []).map(s => s.id)), want = new Set(add.flatMap(u => u.skills || []).filter(Boolean));
    const skills = (base.skills || []).concat((F.skills || []).filter(s => want.has(s.id) && !have.has(s.id)));
    const missing = (F.buildings || []).filter(b => DUO_BUILDINGS.includes(b.id) && !G.buildingInfo(b.id));
    if (missing.length) G.setBuildings(G.BUILDINGS().concat(missing));
    return { units, matrix, skills };
  }

  // the team's tower, its guards and airship, its treasury and its walls: lane 0's stand in the fight, lane 1's don't
  const teamBody = (sq) => sq === -2 || sq === -3 || sq === -4 || sq === G.TREASURY_SQ || (sq <= G.BWALL_SQ && sq > G.BWALL_SQ - 100);

  // The fight of two lanes (matches with units, as they stand when it begins): a steppable Engine battle on the one
  // board. Changes nothing. Bodies carry .lane.
  function battle(lanes, opts = {}) {
    const A = [], B = [], charm = [{}, {}], host = [{}, {}], dropped = new Map();
    let s0 = null;
    lanes.forEach((m, L) => {
      const s = G.battleSetup(m);
      if (!s0) s0 = s;
      for (const sd of [0, 1]) {
        const c = s.opts.charm && s.opts.charm[sd];
        if (c) for (const k in c) charm[sd][remap(L, +k)] = c[k];
        const bodies = G.bodiesFor(m, sd);
        for (const b of bodies) if (teamBody(b.squad)) { if (L === 1) dropped.set(b, b.squad); else if (!host[sd][b.squad]) host[sd][b.squad] = b; }
        for (const b of bodies) {
          if (dropped.has(b)) continue;
          if (b.inside && dropped.has(b.inside)) { const h = host[sd][dropped.get(b.inside)]; if (h) { b.inside = h; b.x = h.x; b.y = h.y; } } // Overwatch in the team's tower or treasury
          b.squad = remap(L, b.squad); b.lane = L; (sd === 0 ? A : B).push(b);
        }
      }
    });
    G.useGrid(MAP);
    const ch = charm.map(c => Object.keys(c).length ? c : null);
    // portal: where a team's tower falls, a portal to the other team's tower opens (Engine opts.portal; 2v2 only)
    const portal = { towers: [0, 1].map(sd => host[sd][-2] || null) };
    return E.createBattle(A, B, s0.g, { tiles: s0.opts.tiles || [], strikes: s0.opts.strikes || [], neutrals: s0.opts.neutrals || [], charm: ch, terrain: s0.opts.terrain || null, objective: null, record: opts.record !== false, portal });
  }

  // lane L's share of a fight's result, in that lane's own squad ids (as Game.resolve wants it). The winner and
  // timeout are the whole fight's: a team wins or loses the round together. Lane 1 also gets the shared treasury.
  function laneResult(res, L, m) {
    const squads = {};
    for (const k in res.squads) {
      const q = res.squads[k];
      if (laneOfId(q.squad) !== L) continue;
      if (L === 1 && teamBody(q.squad)) continue;
      const id = unmap(q.squad);
      squads[q.side + ':' + id] = { ...q, squad: id };
    }
    if (L === 1) for (const sd of [0, 1]) { const t = res.squads[sd + ':' + G.TREASURY_SQ]; if (t) squads[sd + ':' + G.TREASURY_SQ] = { ...t, dealt: 0 }; }
    const charm = (res.charm || [null, null]).map(c => {
      if (!c) return null;
      const o = {};
      for (const k in c) if (laneOfId(+k) === L) o[unmap(+k)] = c[k];
      return Object.keys(o).length ? o : null;
    });
    // Mark Bounty: the whole fight says a side's units took a marked squad's last body; it pays in the lane whose mark it was
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
    settle(lanes);
    for (const m of lanes) delete m.team;
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
    const towerFell = (summaries[0].towerFell || [false, false]).slice();
    lanes.forEach((m, L) => {
      m.hp = hp.slice();
      if (over) { m.over = true; m.winner = winner; }
      const sm = summaries[L];
      sm.duo = { lane: L, laneDmg: sm.dmg.slice(), lost: lost.slice(), hp: hp.slice(), winner: res.winner, over };
      sm.dmg = dmg.slice(); sm.towerHp = towerHp.slice(); sm.towerFell = towerFell.slice(); // the results screen shows the team's
    });
    return { pres, posts: lanes.map(m => Ref.snapshot(m)), summaries };
  }

  // A picture of the fight on the board (for drawing it): lane `lane`'s match before the fight, with both lanes'
  // squads in it under their ids in the fight (lane 1's moved by OFF). Snapshots in, a snapshot out.
  function view(pres, lane = 0) {
    const v = JSON.parse(JSON.stringify(pres[lane]));
    delete v.team;
    v.armies = [0, 1].map(sd => [0, 1].flatMap(L => (pres[L].armies[sd] || []).map(q => L === 0 ? { ...q, lane: 0 } : { ...moved(q), lane: 1 })));
    G.useGrid(MAP);
    return v;
  }

  // ===================== the refereed 2v2 match (the game server keeps it) =====================
  // D: { v, settings, phase: 'lobby' | 'deploy' | 'result' | 'end', lanes: [R, R] (Referee lanes), bots: [b x4],
  //      hp: [team A, team B], ready, nextReady, rematch, away: [x4], deadline, held, summary: [lane 0's, lane 1's],
  //      fights, seed, forfeit (the seat that left, or null),
  //      tbase: [team A's tower part as the round began, team B's], tlog: [[{ lane, fn, a }, ...] this round, x2],
  //      vote: [{ round, votes: [lane 0's, lane 1's], type, flip } | null, x2] (the round 3 tower vote) }
  // A seat's actions go through its lane's Referee (the very same checks as 1v1); the clock, Ready and the fight are
  // the whole match's. Times are passed in (now).
  const AWAY_MAX_MS = Ref.AWAY_MAX_MS, GRACE_MS = Ref.GRACE_MS, MIN_LEFT_MS = 10000;

  function create(settings, units) {
    const s = Ref.cleanSettings({ ...(settings || {}), map: MAP, noChars: true }, units);
    s.map = MAP; s.noChars = true;
    return { v: V, settings: s, phase: 'lobby', lanes: [null, null], bots: [false, false, false, false], hp: [HP, HP],
      ready: [false, false, false, false], nextReady: [false, false, false, false], rematch: [false, false, false, false],
      away: [0, 0, 0, 0], deadline: 0, held: 0, summary: null, fights: 0, seed: 0, forfeit: null, tbase: [null, null], tlog: [[], []], vote: [null, null] };
  }
  const laneOf = (D, seat) => D.lanes[SEATS[seat].lane];
  const ms = (D) => D.lanes.map(R => R.m);
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

  // ----- the tower vote (round 3) -----
  const voteOpen = (D, sd) => ms(D).some(m => G.needsTowerPick(m, sd));
  // both players of team sd have picked: one type for both lanes. A human's vote beats an AI's; two humans: a coin flip.
  // Returns true when a lane's type was changed.
  function settleVote(D, sd) {
    const [a, b] = ms(D);
    if (a.round !== G.TOWER_PICK_ROUND || voteOpen(D, sd) || !a.towers[sd] || !b.towers[sd]) return false;
    if (D.vote[sd] && D.vote[sd].round === a.round) return false;
    const votes = [a.towers[sd].type, b.towers[sd].type], bots = [D.bots[seatOf(0, sd)], D.bots[seatOf(1, sd)]];
    let win = 0, flip = false;
    if (votes[0] !== votes[1]) {
      if (bots[0] !== bots[1]) win = bots[0] ? 1 : 0;
      else { flip = true; win = (D.seed + a.round * 7919 + sd * 104729) % 2; }
    }
    const type = votes[win];
    D.vote[sd] = { round: a.round, votes, type, flip };
    let changed = false;
    for (const m of [a, b]) if (m.towers[sd].type !== type) {
      m.towers[sd].type = type; changed = true;
      // as setTowerType: an extra deployment bought before the team got the Keep is now given, so it is refunded
      while (m.extraDeploys && G.musterOn(m, sd) && m.extraDeploys[sd] > 0) { m.extraDeploys[sd]--; m.gold[sd] += G.deployCost(m, sd); }
    }
    return changed;
  }

  // ----- tower buys: who may take one back -----
  const UNDO_OF = { undoTowerSkill: 'buyTowerSkill', undoTowerSkill2: 'buyTowerSkill2', undoMageGen: 'buyMageGen', undoTround: 'buyTround' };
  const BUY_OF = Object.fromEntries(Object.entries(UNDO_OF).map(([u, b]) => [b, u]));
  // the last buy or take-back of a kind this round for team sd: its lane, or -1 when it stands taken back (or never was)
  function lastBuyer(D, sd, buy) {
    const undo = BUY_OF[buy];
    for (let k = D.tlog[sd].length - 1; k >= 0; k--) { const e = D.tlog[sd][k]; if (e.fn === buy) return e.lane; if (e.fn === undo) return -1; }
    return -1;
  }
  // a take-back of a team buy the teammate paid for is refused (the gold would come back to the wrong player)
  function undoAllowed(D, seat, fn, a) {
    const own = SEATS[seat], sd = own.side, m = laneOf(D, seat).m, other = (L) => L >= 0 && L !== own.lane;
    if (UNDO_OF[fn] && other(lastBuyer(D, sd, UNDO_OF[fn]))) return false;
    if (fn === 'undoTowerSkill' && other(lastBuyer(D, sd, 'buyTowerSkill2'))) return false; // it would take the second skill with it
    if (fn === 'unplaceBwall') {
      const w = Array.isArray(a) && a.length === 3 ? G.bwallOn(m, sd, a[0], a[1], a[2]) : null;
      if (w && w.temp && other(lastBuyer(D, sd, 'fortify'))) return false;
    }
    return true;
  }
  BUY_OF.fortify = 'unfortify';
  function logTeam(D, sd, lane, fn, a, before) {
    // a Fortify wall taken back is noted as 'unfortify' (its gold goes back)
    const name = fn === 'unplaceBwall' && before && before.temp ? 'unfortify' : fn;
    D.tlog[sd].push({ lane, fn: name, a: Array.isArray(a) ? a.slice() : [] });
  }
  // after Undo all in one lane: the team's tower part is the round's start plus every tower action the teammate made
  // this round (replayed on a copy), in both lanes. The vote's type stays.
  function rebuildTeam(D, sd, lane) {
    D.tlog[sd] = D.tlog[sd].filter(e => e.lane !== lane);
    const O = D.lanes[1 - lane].m, sc = Ref.withUnits(Ref.snapshot(O), O.units, O.matrix);
    if (D.tbase[sd]) putTeamState(sc, sd, D.tbase[sd]);
    sc.gold[sd] = 1e9;
    for (const e of D.tlog[sd]) { const fn = e.fn === 'unfortify' ? 'unplaceBwall' : e.fn; try { if (typeof G[fn] === 'function') G[fn](sc, sd, ...e.a); } catch (err) {} }
    const mine = D.lanes[lane].m, v = D.vote[sd];
    if (v && v.round === mine.round && mine.towers && mine.towers[sd]) mine.towers[sd].type = v.type; // should Undo all have put this lane's own vote back
    for (const m of ms(D)) copyTeam(sc, m, sd);
  }

  // a bot's turn at the start of a round: package, tower pick and squads (it levels up when the fight begins)
  function botTurn(D, seat) {
    const own = SEATS[seat], R = laneOf(D, seat), m = R.m, sd = own.side;
    setTeam(ms(D), own.lane);
    if (G.needsPack(m, sd)) G.choosePack(m, sd, Math.floor(Math.random() * m.packages[sd].length));
    if (G.needsTowerPick(m, sd)) { const ch = G.towerChoices(m, sd); G.setTowerType(m, sd, ch[Math.floor(Math.random() * ch.length)].id); }
    G.aiDeploy(m, sd);
    copyTeam(m, D.lanes[1 - own.lane].m, sd);
  }
  function beginRound(D, now) {
    D.phase = 'deploy';
    D.ready = D.bots.slice(); D.nextReady = [false, false, false, false]; D.rematch = [false, false, false, false];
    for (const R of D.lanes) {
      R.round = R.m.round; R.nextReady = [false, false]; R.rematch = [false, false]; R.undo = [null, null];
      R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
    }
    for (let k = 0; k < 4; k++) if (D.bots[k]) botTurn(D, k);
    for (const sd of [0, 1]) settleVote(D, sd);
    setTeams(ms(D));
    D.tbase = [0, 1].map(sd => teamState(D.lanes[0].m, sd)); D.tlog = [[], []];
    D.deadline = 0; D.held = deployMsOf(D);
    clock(D, now);
  }
  // a new match (the lobby's Start, or a rematch). bots: the seats nobody sits in.
  function start(D, units, matrix, now, seed, bots) {
    if (bots) D.bots = bots.slice(0, 4).map(Boolean);
    D.seed = seed >>> 0;
    D.settings = { ...D.settings, map: MAP, noChars: true };
    D.lanes = [0, 1].map(L => {
      const R = Ref.create(D.settings, units);
      R.settings = D.settings;
      Ref.start(R, units, matrix, now, (D.seed + L * 0x9e3779b1) >>> 0);
      return R;
    });
    D.hp = [HP, HP];
    for (const R of D.lanes) R.m.hp = D.hp.slice();
    const offer = [0, 1].map(sd => G.towerChoices(D.lanes[0].m, sd).map(x => x.id)); // teammates vote between the same towers
    for (const R of D.lanes) R.m.towerOffer = offer.map(o => o.slice());
    D.summary = null; D.fights = 0; D.forfeit = null; D.vote = [null, null];
    beginRound(D, now);
    return true;
  }
  const canAct = (D, seat) => D.phase === 'deploy' && !D.ready[seat] && !D.lanes[0].m.over;
  // one action from a seat (as Referee.act: { seq, fn, a }). Returns { ok, h, why, team } (team: something else on
  // the team changed too: the vote was settled, or a tower buy went to the teammate's lane).
  function act(D, seat, d, now) {
    const own = SEATS[seat], R = D.lanes[own.lane], O = D.lanes[1 - own.lane], sd = own.side, fn = d && d.fn;
    mirror(D);
    const no = (why) => { const seq = Number.isInteger(d && d.seq) ? d.seq : 0; if (seq > R.seq[sd]) R.seq[sd] = seq; return { ok: false, why }; };
    if (!canAct(D, seat)) return no(D.ready[seat] ? 'ready' : 'phase');
    if (TEAM_FNS.has(fn) && voteOpen(D, sd)) return no('vote');
    if (TEAM_FNS.has(fn) && !undoAllowed(D, seat, fn, d.a)) return no('team');
    setTeams(ms(D));
    const before = fn === 'unplaceBwall' && Array.isArray(d.a) && d.a.length === 3 ? G.bwallOn(R.m, sd, d.a[0], d.a[1], d.a[2]) : null;
    const r = Ref.act(R, sd, d, now);
    let team = false;
    if (r.ok) {
      if (TEAM_FNS.has(fn)) { logTeam(D, sd, own.lane, fn, d.a, before && { ...before }); copyTeam(R.m, O.m, sd); team = true; }
      else if (fn === 'setTowerType') team = settleVote(D, sd) || !G.needsTowerPick(O.m, sd);
      else if (fn === 'undoAll') { rebuildTeam(D, sd, own.lane); team = true; }
      setTeams(ms(D));
      r.h = Ref.sideHash(R.m, sd); // this lane may have changed again (the vote, the team's tower)
    }
    clock(D, now); // a tower pick may let the clock start (Referee.act only looks at its own lane)
    return { ...r, team };
  }
  function setReady(D, seat, v, now) {
    if (D.phase !== 'deploy' || D.lanes[0].m.over || (D.deadline && now > D.deadline + GRACE_MS)) return null;
    D.ready[seat] = !!v; mirror(D);
    return D.ready.every(Boolean) ? runFight(D, now) : null;
  }
  function runFight(D, now) {
    if (D.phase !== 'deploy') return null;
    for (let k = 0; k < 4; k++) if (D.bots[k]) { setTeam(ms(D), SEATS[k].lane); G.aiLevel(laneOf(D, k).m, SEATS[k].side); }
    for (const m of ms(D)) G.settleTowerPicks(m);
    for (const sd of [0, 1]) settleVote(D, sd);
    const f = fight(ms(D), D.hp);
    setTeams(ms(D));
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
  // what one seat sees: its own lane as in 1v1 (m), with the other lane in it as this seat's team may see it (m.team:
  // the teammate's squads all, the other opponent's as an opponent sees them while deploying; vote: the teammate's
  // tower vote while the vote is open)
  function viewFor(D, seat) {
    const own = SEATS[seat], R = D.lanes[own.lane], O = D.lanes[1 - own.lane], deploy = D.phase === 'deploy';
    const v = Ref.view(R.m, own.side, deploy, R.base), o = Ref.view(O.m, own.side, deploy, O.base);
    v.team = teamOf(o, own.lane);
    if (O.m.round === G.TOWER_PICK_ROUND && O.m.towers && O.m.towers[own.side]) v.team.vote = O.m.towers[own.side].type || null;
    return { m: v };
  }
  const save = (D) => ({ ...D, lanes: D.lanes.map(R => R ? Ref.save(R) : null) });
  const load = (o, units, matrix) => {
    if (!(o && o.v === V)) return null;
    const D = { ...o, lanes: (o.lanes || [null, null]).map(R => R ? Ref.load(R, units, matrix) : null) };
    if (D.lanes[0] && D.lanes[1]) setTeams(ms(D));
    return D;
  };

  const api = {
    V, MAP, OFF, HP, PINGS, EMOTES, EMOTE_TEXT, SEATS, SEAT_NAMES, seatOf, mateOf, remap, unmap, laneOfId, move, teamOf, setTeam, setTeams,
    MECHITES, unitSet, TEAM_FIELDS, TEAM_FNS, copyTeam, teamBody, settle, battle, laneResult, fight, view,
    create, start, act, setReady, runFight, tick, due, next, rematch, forfeit, setAway, viewFor, clock, canAct, save, load, humans, settleVote, voteOpen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Duo = api;
})(typeof window !== 'undefined' ? window : globalThis);
