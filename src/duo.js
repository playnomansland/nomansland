// ===== 2v2 (developer test; one shared board since 2026-11-03) =====
// One wide board (Game's 'duo' map: 24 x 19, no man's land rows 7-11 with a middle row 9 that is nobody's, two columns
// of flank tiles on each edge). Both players of a team deploy in the same zone, and each team has one tower and one
// treasury. No leaders.
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
// - The team's tower: lane 0's stands in the fight; lane 1's never does (same tile, same type). Tower purchases (tower
//   skills, walls, Fortify, mage generals) are the team's: whoever buys pays, and both lanes get it (copyTeam). Only the
//   buyer can take back their own buy. The Bank's Major investment stays each player's own.
// - 2v2 buildings (src/mpb.js, docs/MPB-2V2.md, 2026-11-06): the Vault (in place of the treasury) and the MPBs are team
//   state too (m.mpb, m.mpbVote, m.vault in TEAM_FIELDS); lane 0's stand in the fight. Rounds 2 and 8 put two artifacts
//   in no man's land; their cards are dealt in rounds 3 and 9 (the artifact draft, which replaced the round 3 tower
//   vote: the tower is the Outpost until a tower card comes). An MPB card opens the team's placement vote. The vote's
//   and the draft's 15 s clocks are D.mclock.
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
  const M = (typeof Mpb !== 'undefined') ? Mpb : require('./mpb.js');

  const V = 4; // 3: the 2v2 buildings (2026-11-06); 4: the 24 x 19 board (2026-11-07; server/src/duo.js turns away a page of another V)
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
  // a carrier link (sq.in) seen from the other lane: a carrier in that lane is moved by OFF, and a ride in this lane's
  // teammate's carrier (already moved) points back at this lane's own id (2v2 rides, see Game.mateRide)
  const flip = (id) => typeof id !== 'number' ? id : id >= OFF ? id - OFF : move(id);
  const moved = (q) => { const o = { ...q, id: move(q.id) }; if (q.in != null) o.in = flip(q.in); if (q.from && q.from.in != null) o.from = { ...q.from, in: flip(q.from.in) }; return o; };
  // the squads of match o (the other lane) as m.team carries them; half: the half of the board this lane's players use.
  // buildings: the other lane's buildings from skills (the Cog Builder's Factory: { id, col, row, round, built,
  // progress, level, fell }), so their tiles are taken in this lane too (Game.occupied) and both boards draw them
  // (built, being rebuilt after it fell, or a new site; 2026-11-07).
  // tech: that lane's skills, so a teammate's (or the other opponent's) unit sheet shows their own (a seat's view gets
  // o as Referee.view hides it, so the opponents' skills bought this round stay hidden). Direction arrows (sq.aim) come
  // along with the squads: the teammate's all, the opponents' never while deploying (Referee.hide drops them).
  const teamOf = (o, half) => ({ half, armies: [0, 1].map(sd => (o.armies[sd] || []).map(moved)),
    buildings: [0, 1].map(sd => ((o.buildings && o.buildings[sd]) || []).map(b => ({ id: b.id, col: b.col, row: b.row, round: b.round, built: !!b.built, progress: b.progress || 0, level: b.level || 0, fell: b.fell || 0 }))),
    tech: [0, 1].map(sd => (o.tech && o.tech[sd]) || null),
    // squads sold this round (as Game.soldNow): the Shadow Den's Impersonate may still pick one (src/mpb.js teamSold)
    sold: [0, 1].map(sd => G.soldNow(o, sd).map(moved)),
    // each carrier's one in and one out this round (Game.horseOk), under the carrier's id as this lane sees it
    horse: [0, 1].map(sd => { const h = (o.horse && o.horse[sd]) || {}, out = {}; for (const k in h) out[flip(+k)] = { r: h[k].r, in: h[k].in != null ? 1 : null, out: h[k].out != null ? 1 : null }; return out; }) });
  // the server's copy: each lane gets the other lane's squads as they really stand (the rules check against them)
  function setTeam(lanes, L) { lanes[L].team = teamOf(lanes[1 - L], L); }
  // both lanes, and riders in a teammate's carrier follow it (moved) or step out (sold, taken back): those riders
  // changed, so the other lane's copy is made again
  function setTeams(lanes) {
    setTeam(lanes, 0); setTeam(lanes, 1);
    const was = JSON.stringify(lanes.map(m => [0, 1].map(sd => (m.armies[sd] || []).filter(G.mateRide).map(q => [q.id, q.col, q.row, q.in]))));
    for (const m of lanes) for (const sd of [0, 1]) G.syncRiders(m, sd);
    const now = JSON.stringify(lanes.map(m => [0, 1].map(sd => (m.armies[sd] || []).filter(G.mateRide).map(q => [q.id, q.col, q.row, q.in]))));
    if (was !== now) { setTeam(lanes, 0); setTeam(lanes, 1); }
  }

  // ----- the team's tower: what is shared, and copying it from one lane to the other -----
  // (mpb, mpbVote, mpbSeen, vault: the 2v2 buildings, src/mpb.js)
  const TEAM_FIELDS = ['towerSkill', 'towerSkill2', 'bwalls', 'mageGen', 'tround', 'mpb', 'mpbVote', 'mpbSeen', 'vault'];
  const TEAM_FNS = new Set(['buyTowerSkill', 'undoTowerSkill', 'buyTowerSkill2', 'undoTowerSkill2', 'fortify', 'placeBwall', 'unplaceBwall', 'buyMageGen', 'undoMageGen', 'buyTround', 'undoTround',
    'mpbBuy', 'mpbUndo', 'mpbAct', 'vaultPut', 'vaultTake']);
  // the team's actions Duo handles itself (both lanes at once, logged as the system's so Undo all keeps them)
  const SYS_FNS = new Set(['mpbVote', 'draftPick']);
  const isBank = (m, sd) => G.towerType(m, sd).id === 'bank';
  const BLANK = { towerSkill: 0, towerSkill2: 0, bwalls: [], mageGen: null, tround: {}, mpb: [], mpbVote: [], mpbSeen: [], vault: null };
  const getF = (m, f, sd) => m[f] ? m[f][sd] : BLANK[f];
  function setF(m, f, sd, v) { if (!m[f]) m[f] = [BLANK[f], BLANK[f]].map(x => JSON.parse(JSON.stringify(x))); m[f][sd] = v == null ? v : JSON.parse(JSON.stringify(v)); }
  // the tower part of side sd from src to dst (the Bank's Major investment is each player's own: it pays them back)
  function copyTeam(src, dst, sd) {
    for (const f of TEAM_FIELDS) { if (f === 'towerSkill2' && (isBank(src, sd) || isBank(dst, sd))) continue; setF(dst, f, sd, getF(src, f, sd)); }
  }
  const teamState = (m, sd) => JSON.parse(JSON.stringify(Object.fromEntries(TEAM_FIELDS.map(f => [f, getF(m, f, sd)]))));
  function putTeamState(m, sd, st) { for (const f of TEAM_FIELDS) { if (f === 'towerSkill2' && isBank(m, sd)) continue; setF(m, f, sd, st[f]); } }
  // everything both lanes share, from src to dst: both teams' parts, the tower types, the artifacts and the draft
  function copyAll(src, dst) {
    for (const sd of [0, 1]) { copyTeam(src, dst, sd); if (src.towers && src.towers[sd] && dst.towers && dst.towers[sd]) dst.towers[sd].type = src.towers[sd].type; }
    dst.artifacts = src.artifacts ? JSON.parse(JSON.stringify(src.artifacts)) : null;
    dst.draft = src.draft ? JSON.parse(JSON.stringify(src.draft)) : null;
  }

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
    M.settle(lanes); // the 2v2 buildings: what nobody settled (a Magic lake tile nobody put down)
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
    const units = base.units.concat(add.map(u => { const { faction, ...rest } = u; return rest; })).concat(M.extraUnits(base.units)); // + units the 2v2 buildings bring (the Shadow Den's Shadowhands)
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

  // the team's tower (and the paratroopers it drops), its guards, its treasury, its walls and its buildings (src/mpb.js:
  // Mpb.SQ - k and Mpb.XSQ - ...): lane 0's stand in the fight, lane 1's don't (lane 1 never builds MPB bodies)
  const teamBody = (sq) => sq === -2 || sq === -3 || sq === -4 || sq === G.TREASURY_SQ || (sq <= G.BWALL_SQ && sq > G.BWALL_SQ - 100) || M.isSquad(sq);

  // ----- two squads on one tile (Vilhelm, 6 Nov: "if things are placed on the same tile, they find another spot close
  // to it"). A squad may be put on a tile an enemy squad of this round stands on (it can't be seen: the Assassin's
  // 'anywhere', Forward planting, Shadowhands), and a teammate's Undo all may bring a squad back onto a tile the other
  // player took meanwhile. The newer of the two moves to the nearest tile it may stand on. -----
  const covering = (m, q) => G.blockOf(m, q.unit, q.col, q.row);
  const overlap = (ma, a, mb, b) => { const B = covering(mb, b); return covering(ma, a).some(([c, r]) => B.some(([c2, r2]) => c === c2 && r === r2)); };
  // squad q of side sd in lanes[L] to the nearest tile it may be deployed on (its own placement rules, as a move) with
  // nothing on it in either lane; riders in it go along (the teammate's follow: setTeams). Returns the tile, or null.
  // seen: while deploying (a teammate's Undo all): the opponents still see it where it stood until the fight (as
  // Game.moveSquad's free move), and the other team's things count only as this team sees them (their squads put down
  // this round don't, nor their buildings placed this round: Mpb.asSeen), so the tile it lands on gives nothing away
  // (the fight's start puts right what then meets: settleBoard). ok(col, row) (optional): also needed of every tile.
  function relocate(lanes, L, sd, q, seen, ok) {
    setTeams(lanes);
    const m = lanes[L], arr = m.armies[sd], i = arr.indexOf(q), ui = q.unit;
    G.useGrid(m);
    const COLS = G.COLS, ROWS = G.ROWS;
    const foe = seen ? (cc, rr) => G.enemyHolds(m, sd, cc, rr) || G.bldgSeen(m, sd, cc, rr) : (cc, rr) => G.occupied(m, 1 - sd, cc, rr);
    const clear = (c, r) => G.blockOf(m, ui, c, r).every(([cc, rr]) => cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && !G.occupied(m, sd, cc, rr) && !foe(cc, rr) && !G.terrainBlocks(m, cc, rr) && (!ok || ok(cc, rr)));
    let best = null;
    arr.splice(i, 1); // (its own tiles don't count while it looks)
    try {
      for (const loose of [false, true]) { // (none by its rules: any free tile of its own zone)
        let bd = 0, be = 0;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          if (c === q.col && r === q.row) continue;
          if (!(loose ? G.inZone(sd, r) && !G.reserved(sd, c, r) : G.canPlaceAt(m, sd, c, r, ui, true)) || !clear(c, r)) continue;
          const d = Math.max(Math.abs(c - q.col), Math.abs(r - q.row)), e = Math.hypot(c - q.col, r - q.row);
          if (!best || d < bd || (d === bd && e < be - 1e-9)) { best = { col: c, row: r }; bd = d; be = e; }
        }
        if (best) break;
      }
    } finally { arr.splice(i, 0, q); }
    if (!best) return null;
    const was = { col: q.col, row: q.row };
    if (seen && q.round !== m.round && !(q.from && q.movedRound === m.round)) { q.from = { col: q.col, row: q.row, ...(G.isRider(q) ? { in: q.in } : {}) }; q.movedRound = m.round; }
    q.col = best.col; q.row = best.row;
    for (const x of arr) if (x !== q && x.in === q.id && x.col === was.col && x.row === was.row) { x.col = best.col; x.row = best.row; }
    setTeams(lanes);
    return best;
  }
  // every two squads on one tile, either team, either lane (settleBoard does this and more at the fight's start): on a
  // tile of a team's own zone that team's squad stays and the other team's moves (prioOf); elsewhere, and two of one
  // team, the newer moves (D.stamp: when each seat's squads last took their tiles this round; one from an earlier
  // round or a bot's turn counts as oldest). The same age: the one outside its own zone moves, then a seeded coin.
  function unstack(D) {
    const lanes = ms(D);
    setTeams(lanes);
    for (let guard = 0; guard < 64; guard++) {
      const all = [];
      lanes.forEach((m, L) => { for (const sd of [0, 1]) for (const q of m.armies[sd] || []) if (!G.isRider(q) && !G.mpbHeld(q)) all.push({ L, sd, q, m }); });
      let pair = null;
      for (let a = 0; a < all.length && !pair; a++) for (let b = a + 1; b < all.length; b++) if (overlap(all[a].m, all[a].q, all[b].m, all[b].q)) { pair = [all[a], all[b]]; break; }
      if (!pair) return;
      const age = (x) => stampOf(D, seatOf(x.L, x.sd), x.q.id), out = (x) => !G.inZone(x.sd, x.q.row);
      const [x, y] = pair, own = prioOf({ sd: x.sd, tiles: covering(x.m, x.q) }, { sd: y.sd, tiles: covering(y.m, y.q) });
      const mover = own >= 0 ? (x.sd === own ? y : x) : age(x) !== age(y) ? (age(x) > age(y) ? x : y) : out(x) !== out(y) ? (out(x) ? x : y) : (mrand(D, 17 + guard) < 0.5 ? x : y);
      if (!relocate(lanes, mover.L, mover.sd, mover.q)) return; // (no room at all: they stay)
    }
  }
  // ----- the fight's start, everything known: what was hidden meets (Vilhelm, 6 Nov: "They should be hidden until the
  // fight just like everything else in the game"; "if things are placed on the same tile, they find another spot close
  // to it"). docs/MPB-2V2.md "Hidden until the fight". -----
  // The things on the board (as each lane stands): squads (not riders, not one held in a building), Cog Builder's
  // Factories, the teams' building tiles and parts, Magic lake tiles and Bastion walls. fresh: put down, placed or
  // moved this round (the other team couldn't see it there); n: its stamp (the newer, the bigger). A squad in its
  // team's building (a Tree kojja's Nest: hooks.holds) is no thing of its own: it goes with the building (occ), whose
  // stamp is the newer of the two (the newest arrival on that tile), so a paid Nest is never left empty.
  const RANK = { sq: 0, part: 1, b: 2, w: 3, wall: 4, fac: 9 }; // a tie: the squad moves first, then a part, a building, water, a wall
  // the building of side's in lane L that holds squad q (on its tile, hooks.holds), or null
  const hostOf = (L, sd, q) => (M.on(L) && M.recs(L, sd).find(r => !r.away && r.col === q.col && r.row === q.row && ((M.kindOf(r.kind) || {}).hooks || {}).holds && M.kindOf(r.kind).hooks.holds(L, sd, r, q.unit))) || null;
  // one Bastion wall's edge, however it is named (Game's edgeKey: a tile's s edge is the n edge of the tile below it)
  const edgeKey = (sd, w) => { const e = G.edgeOf(sd, w); return e === 's' ? `${w.col},${w.row + 1},n` : e === 'e' ? `${w.col + 1},${w.row},w` : `${w.col},${w.row},${e}`; };
  // "You always have 'prio' in your own zone" (Vilhelm, 6 Nov): of two teams' things that meet on a tile (or a wall
  // and the water on its tile, or two walls on one edge), the team whose own zone that tile is in keeps its thing
  // there, whatever their stamps; the other team's moves. Its zone is its rows but the edge tiles kept as the other
  // team's flank tiles (Game.reserved: "the enemy's and never yours", src/game.js FLANK): those are nobody's zone,
  // as their half of no man's land is. Returns that team, or -1: no man's land, a flank tile, or two of one team
  // (the newer moves). X, Y: { sd, tiles } (two walls: the tiles on both sides of the edge count)
  function prioOf(X, Y) {
    if (!X || !Y || X.sd === Y.sd) return -1;
    const T = X.t === 'wall' && Y.t === 'wall' ? X.tiles.concat(Y.tiles) : X.tiles.filter(([c, r]) => Y.tiles.some(([c2, r2]) => c === c2 && r === r2));
    const own = [0, 1].filter(sd => T.some(([c, r]) => G.inZone(sd, r) && !G.reserved(sd, c, r)));
    return own.length === 1 ? own[0] : -1;
  }
  function things(D, lanes) {
    const m = lanes[0], round = m.round, out = [], occ = {};
    lanes.forEach((L, li) => {
      for (const sd of [0, 1]) {
        for (const q of L.armies[sd] || []) {
          if (G.isRider(q) || G.mpbHeld(q)) continue;
          const host = hostOf(L, sd, q);
          if (host) { (occ[sd + ':' + host.key] = occ[sd + ':' + host.key] || []).push({ L: li, q, n: stampOf(D, seatOf(li, sd), q.id) }); continue; }
          out.push({ t: 'sq', id: 's' + li + ':' + sd + ':' + q.id, L: li, sd, q, col: q.col, row: q.row, tiles: G.blockOf(L, q.unit, q.col, q.row),
            n: stampOf(D, seatOf(li, sd), q.id), fresh: q.round === round || !!(q.from && q.movedRound === round), any: G.anywhere(L, q.unit), rank: RANK.sq });
        }
        for (const b of G.buildingsOf(L, sd)) out.push({ t: 'fac', id: 'f' + li + ':' + sd + ':' + b.id, L: li, sd, col: b.col, row: b.row, tiles: [[b.col, b.row]], n: 0, fresh: b.round === round, rank: RANK.fac });
      }
    });
    for (const sd of [0, 1]) {
      for (const x of M.boardTiles(m, sd)) {
        const o = !x.part && !x.terrain ? occ[sd + ':' + x.rec.key] || null : null, n = bstampOf(D, sd, x.id);
        out.push({ ...x, t: x.terrain ? 'w' : 'b', id: 'b' + sd + ':' + x.id, key: x.id, tiles: [[x.col, x.row]], occ: o, n: o ? Math.max(n, ...o.map(z => z.n)) : n, rank: x.terrain ? RANK.w : x.part ? RANK.part : RANK.b });
      }
      for (const w of (m.bwalls && m.bwalls[sd]) || []) {
        const key = 'w|' + w.col + ',' + w.row + ',' + w.edge;
        out.push({ t: 'wall', id: 'w' + sd + ':' + key, key, sd, w, col: w.col, row: w.row, tiles: [[w.col, w.row]], edge: edgeKey(sd, w), n: bstampOf(D, sd, key), fresh: w.round === round, rank: RANK.wall });
      }
    }
    return out;
  }
  const hits = (A, B) => A.some(([c, r]) => B.some(([c2, r2]) => c === c2 && r === r2));
  const within = (A, B, d) => A.some(([c, r]) => B.some(([c2, r2]) => Math.max(Math.abs(c - c2), Math.abs(r - r2)) <= d));
  // does X break one of its own placement rules because of Y, everything known? 'same' (one tile, or two teams' walls
  // on one edge: Y breaks it too), 'water' (a wall and the water on its tile, either way round: Vilhelm, 6 Nov, "no
  // walls on the lake"); null: no. Only things on the same tile meet (Vilhelm,
  // 6 Nov): a rule one thing has against things around it is never checked again here, so an Assassin next to a
  // building it couldn't see, a building within 2 tiles of one it couldn't see, and a squad or building round an exit
  // dug next to it all stay ("It stays in that spot"). A part that stays (place.parts' stays: the Coal mine's exit)
  // never meets anything: it is just blocked ("any units that would end up on the blocked tile simply do not go
  // through the mine to begin with")
  function breaks(X, Y) {
    if (X === Y || (X.rec && Y.rec && X.rec === Y.rec) || X.stays || Y.stays) return null;
    if (X.t === 'wall') return Y.t === 'w' && hits(X.tiles, Y.tiles) ? 'water' : Y.t === 'wall' && Y.sd !== X.sd && Y.edge === X.edge ? 'same' : null;
    if (Y.t === 'wall') return X.t === 'w' && hits(X.tiles, Y.tiles) ? 'water' : null; // ("no walls on the lake", 6 Nov: the water breaks it as much as the wall)
    if (hits(X.tiles, Y.tiles)) return X.t === 'fac' && Y.t === 'fac' ? null : 'same';
    return null;
  }
  // every rule broken now: { X (it breaks it), Y (because of it; null: the water shuts a tile off), why }. Two things
  // of one team never meet (teammates see each other's at once), but for two squads (a teammate's Undo all) and
  // for a thing this settle moved
  function conflicts(lanes, all, moved) {
    const out = [], m = lanes[0];
    for (const X of all) for (const Y of all) {
      const why = X !== Y && breaks(X, Y);
      if (!why) continue;
      if (X.sd === Y.sd && !(X.t === 'sq' && Y.t === 'sq') && !moved.has(X.id) && !moved.has(Y.id)) continue;
      out.push({ X, Y, why });
    }
    // water that, with all the water known, shuts a tile or a way off (two teams' tiles put down this round together)
    for (const X of all) {
      if (X.t !== 'w' || !(X.fresh || moved.has(X.id))) continue;
      const rec = X.rec, was = { col: rec.col, row: rec.row };
      rec.col = -1; rec.row = -1;
      let ok = true;
      try { ok = M.KINDS.magicLake.lakeFree(m, was.col, was.row); } finally { rec.col = was.col; rec.row = was.row; }
      if (!ok) out.push({ X, Y: null, why: 'shut' });
    }
    return out;
  }
  // The settle (Duo.runFight, before the fight): Magic lake tiles nobody put down go down first (everything known, so
  // they meet nothing), then until nothing is broken: of every rule broken, the thing that broke it moves to the
  // nearest tile its own kind's rules allow, everything known; both broke it (one tile, a wall and the water on its
  // tile): on a tile of a team's own zone the other team's thing moves, whatever the stamps ("You always have 'prio'
  // in your own zone", Vilhelm, 6 Nov: prioOf); elsewhere (no man's land) and between two of one team the newer
  // moves (the same stamp: the one outside its own zone, then
  // a squad before a part, a building, water, a wall, then a coin seeded from D.secret, which no view holds). Of all
  // that must move, the newest moves first. Nothing is called off or paid back. Outside prio only what was put down,
  // placed or moved this round moves (the rest was seen by all: the other thing moves). A Cog Builder's Factory
  // never moves (outside prio the other thing does). A thing with no tile anywhere stays, and outside prio the other
  // one moves instead if it can (one tile); neither can, or prio's other-team thing can't: both stay (the zone's
  // owner's thing never moves for it). A moved thing keeps its stamp. A building goes to the nearest tile its rules
  // allow (its own rules as a normal placement: in no man's land); of the tiles as near (the same ring round it), one where nothing else
  // then stands on the same tile (a wall under water) if there is one. The squads in a building go with it (a Nest's,
  // a School's pupil: they stand on its tile). The Coal mine's exit never moves and moves nothing (it is just blocked:
  // the squads that would come up on a taken tile stay home, src/mpb.js coalMine).
  function settleBoard(D) {
    const lanes = ms(D), m = lanes[0];
    setTeams(lanes);
    G.useGrid(m);
    if (M.on(m)) { M.settleLakes(lanes); for (const sd of [0, 1]) { copyTeam(lanes[0], lanes[1], sd); bstamp(D, sd); } }
    const moved = new Set(), stuck = new Set(), log = [];
    // (two squads on one tile: either may move, as unstack did: an Undo all may bring back an older one; the other
    // team's thing on a team's own zone may move whatever its age: prioOf)
    const can = (Z, c, any) => !!Z && !stuck.has(Z.id) && Z.t !== 'fac' && !Z.fixed && (any || Z.fresh || moved.has(Z.id) || (c.why === 'same' && c.X.t === 'sq' && c.Y.t === 'sq'));
    for (let guard = 0; guard < 160; guard++) {
      setTeams(lanes);
      G.useGrid(m);
      const all = things(D, lanes), list = conflicts(lanes, all, moved), jobs = [];
      for (const c of list) {
        const both = c.Y && (c.why === 'same' || !!breaks(c.Y, c.X));
        const own = both ? prioOf(c.X, c.Y) : -1;
        if (own >= 0) { // a team's own zone: its thing always stays, the other team's moves (it can't go anywhere: both stay)
          const guest = c.X.sd === own ? c.Y : c.X;
          if (can(guest, c, true)) jobs.push({ mover: guest, other: null, c });
          continue;
        }
        const xs = both ? [c.X, c.Y].filter(Z => can(Z, c)) : [c.X].filter(Z => can(Z, c));
        if (!xs.length) continue;
        let mover = xs[0], other = xs[1] || null;
        if (other) {
          const out = (Z) => !G.inZone(Z.sd, Z.row);
          const pick = mover.n !== other.n ? (mover.n > other.n ? mover : other) : out(mover) !== out(other) ? (out(mover) ? mover : other)
            : mover.rank !== other.rank ? (mover.rank < other.rank ? mover : other) : (mrand(D, 17 + guard) < 0.5) === (mover.id < other.id) ? mover : other; // (the coin the same whichever way round the pair was found)
          other = pick === mover ? other : mover; mover = pick;
        }
        jobs.push({ mover, other, c });
      }
      if (!jobs.length) break;
      jobs.sort((a, b) => b.mover.n - a.mover.n || a.mover.rank - b.mover.rank || a.mover.sd - b.mover.sd || (a.mover.id < b.mover.id ? -1 : a.mover.id > b.mover.id ? 1 : 0));
      const job = jobs[0];
      let to = moveThing(D, lanes, all, job.mover, moved);
      if (!to) { stuck.add(job.mover.id); if (job.other) { to = moveThing(D, lanes, all, job.other, moved); if (!to) stuck.add(job.other.id); } }
      log.push({ id: (to && to.id) || job.mover.id, why: job.c.why, to: to ? { col: to.col, row: to.row } : null });
    }
    D.settled = log; // (tests: what moved, and why)
    for (const sd of [0, 1]) copyTeam(lanes[0], lanes[1], sd);
    setTeams(lanes);
  }
  // one thing to the nearest tile its rules allow, everything known (see settleBoard). Returns { id, col, row } or null.
  function moveThing(D, lanes, all, X, moved) {
    const m = lanes[0];
    let to = null, id = X.id;
    if (X.t === 'sq') {
      // (an Assassin: never next to a Cog Builder's Factory of the other team's, this round's too)
      const facs = all.filter(f => f.t === 'fac' && f.sd !== X.sd);
      to = relocate(lanes, X.L, X.sd, X.q, false, X.any ? (c, r) => !within([[c, r]], facs.flatMap(f => f.tiles), 1) : null);
    } else if (X.t === 'b' || X.t === 'w') {
      // first a tile where nothing else then breaks a rule because of it (everything this round, or moved now)
      const others = all.filter(Z => Z !== X && Z.rec !== X.rec && (Z.fresh || moved.has(Z.id)));
      const prefer = (c, r) => { const Xp = { ...X, col: c, row: r, tiles: [[c, r]] }; return !others.some(Z => breaks(Z, Xp)); };
      to = M.moveTile(lanes, X.sd, X.rec, X.part || null, prefer);
      if (to && !X.part && X.t === 'b') carry(D, lanes, X, to);
    } else if (X.t === 'wall') {
      const list = m.bwalls[X.sd], i = list.indexOf(X.w);
      if (i >= 0) {
        list.splice(i, 1);
        const ok = [];
        const e = G.edgeOf(X.sd, X.w);
        try { for (let r = 0; r < G.ROWS; r++) for (let c = 0; c < G.COLS; c++) if (!(c === X.w.col && r === X.w.row) && G.bwallSpotOk(m, X.sd, c, r, e)) ok.push({ col: c, row: r }); } finally { list.splice(i, 0, X.w); }
        to = M.nearestOf(ok, X.w.col, X.w.row);
        if (to) {
          const st = D.bstamp && D.bstamp[X.sd] && D.bstamp[X.sd][X.key];
          X.w.col = to.col; X.w.row = to.row;
          const key = 'w|' + to.col + ',' + to.row + ',' + X.w.edge;
          id = 'w' + X.sd + ':' + key;
          if (st && D.bstamp) D.bstamp[X.sd][key] = { c: to.col, r: to.row, n: st.n }; // (it keeps its stamp)
        }
      }
    }
    if (!to) return null;
    if (X.t === 'sq') { const s = D.stamp && D.stamp[seatOf(X.L, X.sd)] && D.stamp[seatOf(X.L, X.sd)][X.q.id]; if (s) D.stamp[seatOf(X.L, X.sd)][X.q.id] = { c: to.col, r: to.row, n: s.n }; }
    else if (X.t !== 'wall') { const s = D.bstamp && D.bstamp[X.sd] && D.bstamp[X.sd][X.key]; if (s) D.bstamp[X.sd][X.key] = { c: to.col, r: to.row, n: s.n }; }
    for (const sd of [0, 1]) copyTeam(lanes[0], lanes[1], sd);
    setTeams(lanes);
    moved.add(id);
    return { id, col: to.col, row: to.row };
  }

  // the squads standing in building X (moved to tile to): a Nest's (X.occ, with what rides in it) and those a kind holds
  // on its tile (a School's pupil, a Jail's prisoner: sq.school / sq.jailed with the record's key), in both lanes, go
  // onto its new tile (keeping their stamps)
  function carry(D, lanes, X, to) {
    const key = X.rec.key, moveQ = (li, sd, q, arr) => {
      const was = { col: q.col, row: q.row };
      q.col = to.col; q.row = to.row;
      for (const x of arr) if (x !== q && x.in === q.id && x.col === was.col && x.row === was.row) { x.col = to.col; x.row = to.row; }
      const st = D.stamp && D.stamp[seatOf(li, sd)];
      if (st && st[q.id]) st[q.id] = { c: to.col, r: to.row, n: st[q.id].n };
    };
    for (const o of X.occ || []) { const arr = lanes[o.L].armies[X.sd]; if (arr.includes(o.q) && o.q.col === X.col && o.q.row === X.row) moveQ(o.L, X.sd, o.q, arr); }
    lanes.forEach((L, li) => {
      for (const sd of [0, 1]) for (const q of L.armies[sd] || []) {
        const held = (q.school && sd === X.sd && q.school.key === key) || (q.jailed && q.jailed.side === X.sd && q.jailed.key === key);
        if (held && q.col === X.col && q.row === X.row) moveQ(li, sd, q, L.armies[sd]);
      }
    });
    setTeams(lanes);
  }

  // when each seat's squads took their tiles this round (D.stamp[seat][id] = { c, r, n }; n 0: from before the round's
  // first action, or back on the tile it stood on then: D.stamp0), noted after every action. The team's building
  // tiles the same (D.bstamp[team]['<key>|<part>'], a Bastion wall 'w|<col>,<row>,<edge>'; D.bstamp0), on the one
  // counter D.stampN: so of any two things on the board the newer is known. Server only (in no view: the count would
  // tell how many actions the other team made).
  const stampOf = (D, seat, id) => { const s = D.stamp && D.stamp[seat] && D.stamp[seat][id]; return s ? s.n : 0; };
  const bstampOf = (D, sd, id) => { const s = D.bstamp && D.bstamp[sd] && D.bstamp[sd][id]; return s ? s.n : 0; };
  function noteAll(prev, base0, items, base, D) {
    const next = {};
    for (const [id, c, r] of items) {
      const p = prev[id], b = base0[id];
      next[id] = p && p.c === c && p.r === r ? p : { c, r, n: base || (b && b.c === c && b.r === r) ? 0 : ++D.stampN };
    }
    return next;
  }
  function stamp(D, seat, base) {
    const own = SEATS[seat], m = D.lanes[own.lane].m;
    if (!D.stamp) D.stamp = [{}, {}, {}, {}];
    if (!D.stamp0) D.stamp0 = [{}, {}, {}, {}];
    if (!D.stampN) D.stampN = 0;
    const items = (m.armies[own.side] || []).map(q => [q.id, q.col, q.row]);
    if (base) D.stamp0[seat] = Object.fromEntries(items.map(([id, c, r]) => [id, { c, r }]));
    D.stamp[seat] = noteAll(base ? {} : D.stamp[seat] || {}, D.stamp0[seat] || {}, items, base, D);
    if (base) bstamp(D, own.side, true);
  }
  // team sd's building tiles and walls (lane 0's: team state)
  function bstamp(D, sd, base) {
    const m = D.lanes[0] && D.lanes[0].m;
    if (!m) return;
    if (!D.bstamp) D.bstamp = [{}, {}];
    if (!D.bstamp0) D.bstamp0 = [{}, {}];
    if (!D.stampN) D.stampN = 0;
    const items = M.recs(m, sd).flatMap(rec => M.tilesOf(rec).map(t => [rec.key + '|' + t.part, t.col, t.row]))
      .concat(((m.bwalls && m.bwalls[sd]) || []).map(w => ['w|' + w.col + ',' + w.row + ',' + w.edge, w.col, w.row]));
    if (base) D.bstamp0[sd] = Object.fromEntries(items.map(([id, c, r]) => [id, { c, r }]));
    D.bstamp[sd] = noteAll(base ? {} : D.bstamp[sd] || {}, D.bstamp0[sd] || {}, items, base, D);
  }
  // everything on the board, after any action (the seats in order, then the teams' buildings)
  function stampAll(D, base) { if (!D.lanes[0]) return; for (let k = 0; k < 4; k++) stamp(D, k, base); for (const sd of [0, 1]) bstamp(D, sd, base); }

  // The fight of two lanes (matches with units, as they stand when it begins): a steppable Engine battle on the one
  // board. Changes nothing. Bodies carry .lane.
  function battle(lanes, opts = {}) {
    const A = [], B = [], charm = [{}, {}], host = [{}, {}], dropped = new Map(), rides = [];
    let s0 = null;
    lanes.forEach((m, L) => {
      const s = G.battleSetup(m);
      if (!s0) s0 = s;
      for (const sd of [0, 1]) {
        const c = s.opts.charm && s.opts.charm[sd];
        if (c) for (const k in c) charm[sd][remap(L, +k)] = c[k];
        const bodies = G.bodiesFor(m, sd);
        // a squad riding in the teammate's carrier: its bodies go inside that carrier (its id in the fight: lane 1's
        // are moved by OFF, so lane 0's link already is; lane 1's points at lane 0's own id)
        for (const q of m.armies[sd]) if (G.mateRide(q)) rides.push({ sd, rider: remap(L, q.id), carrier: L === 0 ? q.in : q.in - OFF });
        for (const b of bodies) if (teamBody(b.squad)) { if (L === 1) dropped.set(b, b.squad); else if (!host[sd][b.squad]) host[sd][b.squad] = b; }
        for (const b of bodies) {
          if (dropped.has(b)) continue;
          if (b.inside && dropped.has(b.inside)) { const h = host[sd][dropped.get(b.inside)]; if (h) { b.inside = h; b.x = h.x; b.y = h.y; } } // Overwatch in the team's tower or treasury
          b.squad = remap(L, b.squad); b.lane = L; (sd === 0 ? A : B).push(b);
        }
      }
    });
    for (const r of rides) {
      const list = r.sd === 0 ? A : B, c = list.find(x => x.squad === r.carrier);
      if (c) for (const x of list) if (x.squad === r.rider) { x.boarded = true; x.alive = false; x.carrier = c; x.x = c.x; x.y = c.y; x.delay = 0; }
    }
    // the team's buildings (src/mpb.js): lane 0 builds them, once for the team
    for (const sd of [0, 1]) for (const b of M.bodies(lanes[0], sd, undefined, lanes)) { b.lane = 0; (sd === 0 ? A : B).push(b); }
    M.link(lanes[0], A, B); // a building that ties bodies to its own (hooks.link: the squad in a Tree kojja)
    G.useGrid(MAP);
    const ch = charm.map(c => Object.keys(c).length ? c : null);
    // portal: where a team's tower falls, a portal to the other team's tower opens (Engine opts.portal; 2v2 only)
    const portal = { towers: [0, 1].map(sd => host[sd][-2] || null) };
    const o = { tiles: s0.opts.tiles || [], strikes: s0.opts.strikes || [], neutrals: s0.opts.neutrals || [], charm: ch, terrain: s0.opts.terrain || null, objective: null, record: opts.record !== false, portal };
    const art = M.artifactsFor(lanes[0]); // rounds 2 and 8: the two artifacts (Engine opts.artifacts)
    if (art) o.artifacts = art;
    M.battleOpts(lanes[0], o, lanes); // what the buildings add (o.mpb and the rest)
    G.useGrid(MAP);
    return E.createBattle(A, B, s0.g, o);
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
    for (const m of lanes) delete m.fhSeed; // in pres only (the page plays the fight from them), not in the state after it
    while (bt.step()) {}
    const res = bt.result();
    const lost = [0, 0], dmg = [0, 0], towerHp = [0, 0];
    const summaries = lanes.map((m, L) => {
      m.hp = [BIG, BIG];
      const sm = G.resolve(m, laneResult(res, L, m));
      for (const sd of [0, 1]) { lost[sd] += BIG - m.hp[sd]; dmg[sd] += sm.dmg[sd] || 0; towerHp[sd] += (sm.towerHp && sm.towerHp[sd]) || 0; }
      return sm;
    });
    M.teamHeal(lanes, hp, summaries[0].round, summaries); // Team HP the buildings add before the fight's damage (the Oak's Heal)
    for (const sd of [0, 1]) hp[sd] = Math.max(0, hp[sd] - lost[sd]);
    // the buildings: fell, their afterFight (Team HP, gold, next-round effects), the artifacts' winners; lane 0's team
    // state goes to lane 1
    M.afterFight(lanes, res, summaries, hp);
    for (const sd of [0, 1]) hp[sd] = Math.max(0, hp[sd]);
    copyAll(lanes[0], lanes[1]);
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
  //      fights, seed (the lanes' m.seed come from it: known to all), secret (the server's own streams: in no view,
  //      sec), forfeit (the seat that left, or null),
  //      tbase: [team A's team part as the round began, team B's], tlog: [[{ lane, fn, a, as }, ...] this round, x2]
  //      (lane -1: the system's: a placement vote, a placed building, a draft pick; fn 'sys:<Mpb.SYS name>'),
  //      mclock: { vote: [{ key, until } | null, x2] (the team's placement vote), draft: until | 0 } }
  // A seat's actions go through its lane's Referee (the very same checks as 1v1); the clock, Ready and the fight are
  // the whole match's. Times are passed in (now).
  const AWAY_MAX_MS = Ref.AWAY_MAX_MS, GRACE_MS = Ref.GRACE_MS, MIN_LEFT_MS = 10000;

  function create(settings, units) {
    const s = Ref.cleanSettings({ ...(settings || {}), map: MAP, noChars: true }, units);
    s.map = MAP; s.noChars = true;
    return { v: V, settings: s, phase: 'lobby', lanes: [null, null], bots: [false, false, false, false], hp: [HP, HP],
      ready: [false, false, false, false], nextReady: [false, false, false, false], rematch: [false, false, false, false],
      away: [0, 0, 0, 0], deadline: 0, held: 0, summary: null, fights: 0, seed: 0, forfeit: null, tbase: [null, null], tlog: [[], []], mclock: { vote: [null, null], draft: 0 } };
  }
  const laneOf = (D, seat) => D.lanes[SEATS[seat].lane];
  const ms = (D) => D.lanes.map(R => R.m);
  const deployMsOf = (D) => (D.lanes[0].m.round === 1 ? D.settings.deploy1 : D.settings.deploy) * 1000;
  const humans = (D) => [0, 1, 2, 3].filter(k => !D.bots[k]);
  // (a 1v1-style tower pick; never in 2v2, m.duoTowers. The 2v2 draft and placement votes never hold the deploy clock:
  // "Votes don't hold the clock, independent systems" (Vilhelm, 6 Nov). Each has its own 15 s; one still open when the
  // deploy clock ends is settled as the fight starts, as its own clock running out would: runFight -> mpbSettle)
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
    else if (!stop && !D.deadline) { D.deadline = now + Math.max(MIN_LEFT_MS, D.held || deployMsOf(D)); D.held = 0; setDenCut(D, now); }
    mirror(D);
  }

  // ----- the 2v2 buildings: the artifact draft and the placement votes (src/mpb.js), their clocks (D.mclock) -----
  // (each has its own 15 s; none of them ever holds the shared deploy clock, so the opponents' clock never tells them
  // anything about a team's votes. mpbPending: a public vote or the draft is open, for tests and the page's line)
  const mpbPending = (D) => { const m = D.lanes[0] && D.lanes[0].m; return !!m && (M.draftOpen(m) || [0, 1].some(sd => M.voteQueue(m, sd).some(e => !e.skill))); };
  const mpbOpen = (D) => { const m = D.lanes[0] && D.lanes[0].m; return !!m && (M.draftOpen(m) || [0, 1].some(sd => !!M.voteHead(m, sd))); }; // (anything at all still to settle before the fight)
  const seatsOf = (sd) => [seatOf(0, sd), seatOf(1, sd)];
  // a system action on team sd's part in lane L (as: whose vote), then the same part in the other lane; logged
  function sysApply(D, sd, fn, a, L = 0) {
    const lanes = ms(D);
    setTeams(lanes);
    if (!M.asSeen(sd, () => M.SYS[fn](lanes[L], sd, ...a))) return false; // (as team sd sees the board: Mpb.asSeen)
    copyTeam(lanes[L], lanes[1 - L], sd);
    D.tlog[sd].push({ lane: -1, fn: 'sys:' + fn, a: a.slice(), as: L });
    return true;
  }
  // the draft's pick (team `team` takes card idx; in lane L), then the other lane
  function sysDraft(D, team, idx, L = 0) {
    const lanes = ms(D);
    if (!G.draftPick(lanes[L], team, idx)) return false;
    const O = lanes[1 - L];
    O.draft = JSON.parse(JSON.stringify({ ...lanes[L].draft, done: false }));
    M.applyDraft(O);
    for (const sd of [0, 1]) D.tlog[sd].push({ lane: -1, fn: 'sys:draft', a: lanes[L].draft.owner.slice(), as: L });
    return true;
  }
  // the server's own streams (the vote's and the draft's coins, the fight-start settle's coin, the artifacts and draft
  // deals, the bots' building moves, Field dressing): from D.secret, which no view holds (the lanes' m.seed come from
  // D.seed, and every seat's view has its lane's, so D.seed itself is known to all); a match without one (an older
  // save, a test that passes none): D.seed, as before
  const sec = (D) => (D.secret != null ? D.secret : D.seed) >>> 0;
  const mrand = (D, k) => M.rng((sec(D) + D.lanes[0].m.round * 7919 + k * 104729) >>> 0)();
  // the clocks: 15 s for each building at the head of a team's queue, 15 s for the draft's pick
  function mpbClock(D, now) {
    const m = D.lanes[0].m;
    if (!D.mclock) D.mclock = { vote: [null, null], draft: 0 };
    for (const sd of [0, 1]) {
      // (a one-player placement at the head keeps its clock while the teammate places theirs: Mpb.voteEntry)
      const h = M.voteHead(m, sd), key = h ? [h.lane != null ? 'L' + h.lane : M.recs(m, sd).length, h.kind, h.part || '', h.key || ''].join('|') : '';
      if (!key) D.mclock.vote[sd] = null;
      else if (!D.mclock.vote[sd] || D.mclock.vote[sd].key !== key) D.mclock.vote[sd] = { key, until: now + M.VOTE_MS };
    }
    if (!M.draftOpen(m)) D.mclock.draft = 0; else if (!D.mclock.draft) D.mclock.draft = now + M.DRAFT_MS;
  }
  // what bots do at once: the draft's pick (when the picking team has one), and a vote: the human teammate's tile if
  // they voted, else the first allowed tile (a building with no room anywhere is lost)
  function mpbBots(D) {
    const lanes = ms(D);
    for (let guard = 0; guard < 40; guard++) {
      let did = false;
      if (M.draftOpen(lanes[0])) {
        // only a team of two bots picks at once: a human on the team makes the pick (or the 15 s clock does)
        const t = lanes[0].draft.first, bot = seatsOf(t).every(k => D.bots[k]) ? seatsOf(t)[0] : null;
        if (bot != null) did = sysDraft(D, t, M.botPick(lanes[0], t), SEATS[bot].lane);
      }
      if (!did) for (const sd of [0, 1]) {
        setTeams(lanes);
        if (!M.voteHead(lanes[0], sd)) continue;
        for (const L of [0, 1]) {
          const head = M.voteEntry(lanes[0], sd, L); // (a building one player places alone: only their own, Mpb.queue's lane)
          if (!D.bots[seatOf(L, sd)] || !head) continue;
          // (as the bot's team sees the board: its human teammate sees its vote, Mpb.asSeen)
          const [human, mine, want] = M.asSeen(sd, () => {
            const mate = head.votes[1 - L], hu = mate && !D.bots[seatOf(1 - L, sd)] && M.spotOk(lanes[L], sd, head.kind, head.part, mate.col, mate.row) ? mate : null;
            const mi = head.votes[L] && M.spotOk(lanes[L], sd, head.kind, head.part, head.votes[L].col, head.votes[L].row) ? head.votes[L] : null;
            return [hu, mi, hu || mi || M.autoSpot(lanes[L], sd, head.kind, head.part)];
          });
          if (!want) { did = sysApply(D, sd, 'drop', [], L); break; }
          if (mine && mine.col === want.col && mine.row === want.row) continue;
          did = sysApply(D, sd, 'vote', [want.col, want.row], L);
          break;
        }
        if (did) break;
      }
      if (!did) break;
    }
  }
  // a clock ran out (or the fight starts: force): the draft's seeded pick, a vote's result
  function mpbTick(D, now, force) {
    const lanes = ms(D), c = D.mclock || { vote: [null, null], draft: 0 };
    let did = false;
    if (M.draftOpen(lanes[0]) && (force || (c.draft && now >= c.draft))) {
      const t = lanes[0].draft.first;
      did = sysDraft(D, t, mrand(D, 11) < 0.5 ? 0 : 1, 0) || did;
    }
    for (const sd of [0, 1]) {
      const v = c.vote[sd];
      if (!M.voteHead(lanes[0], sd) || !(force || (v && now >= v.until))) continue;
      setTeams(lanes);
      const t = M.asSeen(sd, () => M.voteResult(lanes[0], sd, mrand(D, 13 + sd * 2 + M.recs(lanes[0], sd).length * 31))); // (as the team sees the board)
      did = (t ? sysApply(D, sd, 'place', [t.col, t.row], 0) : sysApply(D, sd, 'drop', [], 0)) || did;
    }
    return did;
  }
  // after anything that may have opened or changed a vote or the draft
  function mpbAfter(D, now) { mpbBots(D); mpbClock(D, now); setTeams(ms(D)); stampAll(D); }
  // before the fight: nothing may stay open
  function mpbSettle(D, now) { for (let k = 0; k < 40 && mpbOpen(D); k++) { mpbTick(D, now, true); mpbBots(D); } mpbClock(D, now); }
  // the start of a round: the buildings' roundStart, the artifacts (rounds 2 and 8), the draft (3 and 9)
  function mpbRound(D, now) {
    const lanes = ms(D), m = lanes[0];
    if (!M.on(m)) return;
    setTeams(lanes);
    M.roundStart(lanes);
    if (M.ARTIFACT.rounds.includes(m.round)) m.artifacts = M.rollArtifacts(m, M.rng((sec(D) + m.round * 6151) >>> 0));
    const d = M.dealDraft(m, M.rng((sec(D) + m.round * 7307) >>> 0)() < 0.5 ? 0 : 1);
    if (d) m.draft = d;
    if (m.artifacts && m.artifacts.round < m.round) m.artifacts = null; // (the draft has their cards and winners)
    copyAll(m, lanes[1]);
    for (const L of lanes) M.applyDraft(L); // a deal with no pick: each team gets its card in both lanes
    D.mclock = { vote: [null, null], draft: 0 };
  }
  // the clocks as a seat sees them: ms left for its team's placement vote and for the draft's pick (0: none)
  function clocks(D, seat, now) {
    const c = D.mclock || { vote: [null, null], draft: 0 }, v = c.vote[SEATS[seat].side];
    return { vote: v ? Math.max(0, v.until - now) : 0, draft: c.draft ? Math.max(0, c.draft - now) : 0 };
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
  // the team's part as the round began with the log's actions played again on a copy of lane `from`; ok: the entries
  // whose action worked (a 2v2 building's: Mpb's actions say so)
  const CHECKED = new Set(['mpbBuy', 'mpbUndo', 'mpbAct', 'vaultPut', 'vaultTake']);
  function replayTeam(D, sd, from, log) {
    const O = D.lanes[from].m, sc = Ref.withUnits(Ref.snapshot(O), O.units, O.matrix), ok = new Set();
    if (D.tbase[sd]) putTeamState(sc, sd, D.tbase[sd]);
    sc.gold[sd] = 1e9;
    sc.mpbReplay = true; // (a building's canBuy doesn't check the other team's squads again: the Shadow Den's Impersonate)
    for (const e of log) {
      const sys = e.fn.startsWith('sys:'), fn = sys ? M.SYS[e.fn.slice(4)] : G[e.fn === 'unfortify' ? 'unplaceBwall' : e.fn];
      sc.duoLane = sys ? e.as : e.lane >= 0 ? e.lane : O.duoLane; // who voted (who paid)
      try { if (typeof fn === 'function' && fn(sc, sd, ...e.a) !== false) ok.add(e); } catch (err) {}
    }
    return { sc, ok };
  }
  // the team's part as Undo all by lane `lane` leaves it: the round's start, then the log played again (the teammate's
  // actions, the system's, and this player's own building clicks, mpbBuy / mpbUndo, in place), then this player's clicks
  // taken back, latest first, by the rules of a single take-back (Mpb.canUndo; group B1: records keep their keys, a
  // click that can't be taken back stays bought). { sc, ok (replayTeam's), log (the new D.tlog[sd]), kept (what this
  // player's clicks still standing cost) }
  function undoReplay(D, sd, lane) {
    const click = (e) => e.lane === lane && (e.fn === 'mpbBuy' || e.fn === 'mpbUndo');
    const log = D.tlog[sd].filter(e => e.lane !== lane || click(e));
    const { sc, ok } = replayTeam(D, sd, 1 - lane, log);
    sc.duoLane = lane;
    for (let k = log.length - 1; k >= 0; k--) {
      const e = log[k];
      if (e.lane !== lane || e.fn !== 'mpbBuy') continue;
      try { if (G.mpbUndo(sc, sd, e.a[0], e.a[1])) log.push({ lane, fn: 'mpbUndo', a: [e.a[0], e.a[1]] }); } catch (err) {}
    }
    let kept = 0;
    for (const rec of M.recs(sc, sd)) for (const id of Object.keys(rec.skills)) { const x = rec.skills[id]; if (x.round === sc.round) for (const c of x.log) if (c.lane === lane) kept += c.cost; }
    return { sc, ok, log, kept };
  }
  // may this seat press Undo all? (2v2 buildings) Not while one of the teammate's building actions this round relied on
  // one of this seat's (a skill on this player's lake tile put down this round, water where the exit stood: played
  // again without this seat's actions it no longer works, so their gold or tile would be lost), nor while the buildings
  // can't go back (Mpb.undoAllOk: the Coal mine's exit on a tile taken since)
  // (as the team sees the board: the other team's hidden things never decide it, Mpb.asSeen)
  function undoAllAllowed(D, seat) { return M.asSeen(SEATS[seat].side, () => undoAllAllowedSeen(D, seat)); }
  function undoAllAllowedSeen(D, seat) {
    const own = SEATS[seat], sd = own.side, m = D.lanes[own.lane].m;
    if (!M.on(m)) return true;
    const log = D.tlog[sd], mate = log.filter(e => e.lane !== own.lane);
    if (!log.some(e => e.lane === own.lane)) return M.undoAllOk(m, sd, null);
    const all = replayTeam(D, sd, 1 - own.lane, log), without = undoReplay(D, sd, own.lane); // (as rebuildTeam would leave it)
    // what is left of the teammate's: a buy they took back again, an act they did again later (moved the same tile
    // again) counts for nothing, nor does a free act Mpb.reconcile puts right (the School's enrolment)
    const net = new Set(mate.filter(e => e.lane >= 0 && CHECKED.has(e.fn) && !(e.fn === 'mpbAct' && M.reconciles(m, sd, e.a[0])))), same = (a, b) => a.lane === b.lane && a.a[0] === b.a[0] && a.a[1] === b.a[1];
    mate.forEach((e, i) => {
      if (e.fn === 'mpbUndo') { const b = mate.slice(0, i).reverse().find(x => x.fn === 'mpbBuy' && net.has(x) && same(x, e)); if (b) { net.delete(b); net.delete(e); } }
      if (e.fn === 'mpbAct') for (const x of mate.slice(0, i)) if (x.fn === 'mpbAct' && same(x, e)) net.delete(x);
    });
    if ([...net].some(e => all.ok.has(e) && !without.ok.has(e))) return false;
    return M.undoAllOk(m, sd, without.sc);
  }
  // after Undo all in one lane: the team's part is the round's start plus every team action the teammate made this
  // round and the system's (votes, placed buildings, the draft), replayed on a copy in order, in both lanes. The
  // tower type stays (only the draft sets it in 2v2).
  // The player's own building skill clicks (mpbBuy / mpbUndo) are replayed too, in place, and then taken back, latest
  // first, by the rules of a single take-back (Mpb.canUndo): so a building a click added stays in the list (taken
  // back), the records keep their keys and the teammate's buys on them still find them. A click that can't be taken
  // back (a Tree kojja's Nest with the teammate's squad in it) stays bought, and stays paid for by this player.
  // (as the team sees the board: the replay and the moved squad never show a hidden thing of the other team's)
  function rebuildTeam(D, sd, lane) { return M.asSeen(sd, () => rebuildTeamSeen(D, sd, lane)); }
  function rebuildTeamSeen(D, sd, lane) {
    setTeams(ms(D)); // this lane's squads as they stand after the undo (a take-back may look at them)
    const O = D.lanes[1 - lane].m, { sc, log, kept } = undoReplay(D, sd, lane);
    D.tlog[sd] = log;
    if (kept) D.lanes[lane].m.gold[sd] -= kept; // what this player's clicks still standing cost (their gold is back at the round's start)
    const mine = D.lanes[lane].m;
    if (mine.towers && mine.towers[sd] && O.towers && O.towers[sd]) mine.towers[sd].type = O.towers[sd].type;
    for (const m of ms(D)) copyTeam(sc, m, sd);
    M.reconcile(ms(D)); // a building's record and the lanes' squads agree again (the School)
    // a squad of this player's back on a tile the teammate took meanwhile (a Tree kojja's Nest too): it moves to the
    // nearest tile it may stand on (the teammate's stays where they put it)
    const lanes = ms(D);
    setTeams(lanes);
    for (const q of lanes[lane].armies[sd].slice()) {
      if (G.isRider(q) || G.mpbHeld(q)) continue;
      if (lanes[1 - lane].armies[sd].some(o => !G.isRider(o) && overlap(lanes[lane], q, lanes[1 - lane], o))) relocate(lanes, lane, sd, q, true);
    }
  }

  // a bot's turn at the start of a round: package, tower pick and squads (it levels up when the fight begins)
  // (as the bot's team sees the board: the other team's bots of this round are hidden from it, Mpb.asSeen)
  function botTurn(D, seat) { return M.asSeen(SEATS[seat].side, () => botTurnSeen(D, seat)); }
  function botTurnSeen(D, seat) {
    const own = SEATS[seat], R = laneOf(D, seat), m = R.m, sd = own.side;
    setTeam(ms(D), own.lane);
    // (the package and tower picks: a stream of their own from D.secret, so a bot-played match can be played again and
    // the stream r below, for its buildings' skills, stays as it was)
    const pick = M.rng((sec(D) + m.round * 3571 + seat * 131 + 99991) >>> 0);
    if (G.needsPack(m, sd)) G.choosePack(m, sd, Math.floor(pick() * m.packages[sd].length));
    if (G.needsTowerPick(m, sd)) { const ch = G.towerChoices(m, sd); G.setTowerType(m, sd, ch[Math.floor(pick() * ch.length)].id); }
    const r = M.rng((sec(D) + m.round * 3571 + seat * 131) >>> 0);
    M.bots(m, sd, r); // the team's buildings' skills now and then (src/mpb.js hooks.bot, before the squads)
    G.aiDeploy(m, sd);
    M.botsAfter(m, sd, r); // and those on its squads (hooks.botAfter)
    // the Vault: gold the carry cap would take next round goes in instead (a put round only)
    const spare = Math.min(m.gold[sd] - G.CARRY_CAP, M.vaultRoom(m, sd, 'put'));
    if (spare > 0) G.vaultPut(m, sd, spare);
    copyTeam(m, D.lanes[1 - own.lane].m, sd);
  }
  function beginRound(D, now) {
    D.phase = 'deploy';
    D.ready = D.bots.slice(); D.nextReady = [false, false, false, false]; D.rematch = [false, false, false, false];
    for (const R of D.lanes) { R.round = R.m.round; R.nextReady = [false, false]; R.rematch = [false, false]; R.undo = [null, null]; }
    D.tlog = [[], []];
    mpbRound(D, now); // the buildings' round start, the artifacts, the draft
    for (const R of D.lanes) R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
    for (let k = 0; k < 4; k++) if (D.bots[k]) botTurn(D, k);
    mpbAfter(D, now); // bots pick and vote at once
    setTeams(ms(D));
    D.tbase = [0, 1].map(sd => teamState(D.lanes[0].m, sd)); D.tlog = [[], []];
    stampAll(D, true); // (everything on the board now, the bots' squads and buildings too, counts as oldest)
    D.deadline = 0; D.held = deployMsOf(D);
    clock(D, now);
  }
  // a new match (the lobby's Start, or a rematch). bots: the seats nobody sits in. secret (optional, the server draws
  // it): the seed of the streams no player may work out while deploying (sec)
  function start(D, units, matrix, now, seed, bots, secret) {
    if (bots) D.bots = bots.slice(0, 4).map(Boolean);
    D.seed = seed >>> 0;
    if (secret != null) D.secret = secret >>> 0; else delete D.secret;
    D.settings = { ...D.settings, map: MAP, noChars: true };
    D.lanes = [0, 1].map(L => {
      const R = Ref.create(D.settings, units);
      R.settings = D.settings;
      Ref.start(R, units, matrix, now, (D.seed + L * 0x9e3779b1) >>> 0);
      return R;
    });
    D.hp = [HP, HP];
    for (const R of D.lanes) R.m.hp = D.hp.slice();
    D.lanes.forEach((R, L) => M.init(R.m, L)); // the Vaults, no tower pick (the artifact draft instead), who is who
    for (const R of D.lanes) for (const f of TEAM_FIELDS) if (!R.m[f]) R.m[f] = [BLANK[f], BLANK[f]].map(x => JSON.parse(JSON.stringify(x))); // (every team field from the start: a first team action adds none to the opponents' view)
    D.summary = null; D.fights = 0; D.forfeit = null; D.mclock = { vote: [null, null], draft: 0 };
    beginRound(D, now);
    return true;
  }
  const canAct = (D, seat) => D.phase === 'deploy' && !D.ready[seat] && !D.lanes[0].m.over;
  // ms off this seat's deploy clock: the other team's Shadow Den watches them (Insider information, src/mpb.js). The
  // fight still starts at D.deadline; their actions stop that much sooner (act) and their clock shows it (the server:
  // remainingFor, heldFor). The cut is fixed each time the clock (re)starts (D.denCut, by team) and leaves them at least
  // DEN_MIN_MS: a clock back from a pause with 10 s left doesn't run out at once.
  const DEN_MIN_MS = 5000;
  const denCutOf = (D, sd, span) => (D.lanes[0] ? Math.min(M.deployCut(D.lanes[0].m, sd), Math.max(0, span - DEN_MIN_MS)) : 0);
  function setDenCut(D, now) { D.denCut = [0, 1].map(sd => denCutOf(D, sd, D.deadline - now)); }
  const cutFor = (D, seat) => (D.phase === 'deploy' && D.deadline && D.denCut ? D.denCut[SEATS[seat].side] || 0 : 0);
  // what the server sends as the seat's clock: ms left (a watched team's at least 1 while the clock runs: "Time's up",
  // not "paused"), and while it is held
  function remainingFor(D, seat, now) { if (!D.deadline) return 0; const c = cutFor(D, seat); return c ? Math.max(1, D.deadline - c - now) : D.deadline - now; }
  function heldFor(D, seat) { const c = D.held && D.phase === 'deploy' ? denCutOf(D, SEATS[seat].side, Math.max(MIN_LEFT_MS, D.held)) : 0; return c ? Math.max(1, D.held - c) : D.held; }
  // a placement vote or the draft's pick: both lanes at once (Referee.act's checks: the action's number, the clock,
  // its arguments)
  function sysAct(D, seat, d, now) {
    const own = SEATS[seat], R = D.lanes[own.lane], sd = own.side, fn = d.fn;
    const seq = Number.isInteger(d.seq) ? d.seq : 0;
    if (seq <= R.seq[sd]) return { ok: false, why: 'dup' };
    R.seq[sd] = seq;
    if (D.deadline && now > D.deadline + GRACE_MS) return { ok: false, why: 'time' };
    const args = Ref.cleanArgs(fn, d.a);
    if (!args) return { ok: false, why: 'bad' };
    setTeams(ms(D));
    const ok = fn === 'mpbVote' ? sysApply(D, sd, 'vote', args, own.lane) : M.asSeen(sd, () => sysDraft(D, sd, args[0], own.lane));
    if (!ok) { clock(D, now); return { ok: false, why: 'rules' }; }
    mpbAfter(D, now);
    clock(D, now);
    return { ok: true, h: Ref.sideHash(R.m, sd), team: true };
  }
  // one action from a seat (as Referee.act: { seq, fn, a }). Returns { ok, h, why, team } (team: something else on
  // the team changed too: a tower or building buy went to the teammate's lane, a vote, the draft).
  function act(D, seat, d, now) {
    const own = SEATS[seat], R = D.lanes[own.lane], O = D.lanes[1 - own.lane], sd = own.side, fn = d && d.fn;
    mirror(D);
    const no = (why) => { const seq = Number.isInteger(d && d.seq) ? d.seq : 0; if (seq > R.seq[sd]) R.seq[sd] = seq; return { ok: false, why }; };
    if (!canAct(D, seat)) return no(D.ready[seat] ? 'ready' : 'phase');
    if (D.deadline && cutFor(D, seat) && now > D.deadline - cutFor(D, seat) + GRACE_MS) return no('time'); // watched: their clock runs out sooner
    if (SYS_FNS.has(fn)) return sysAct(D, seat, d, now);
    if (TEAM_FNS.has(fn) && !undoAllowed(D, seat, fn, d.a)) return no('team');
    if (fn === 'undoAll' && !undoAllAllowed(D, seat)) return no('team'); // (2v2 buildings: the teammate relied on it)
    setTeams(ms(D));
    const before = fn === 'unplaceBwall' && Array.isArray(d.a) && d.a.length === 3 ? G.bwallOn(R.m, sd, d.a[0], d.a[1], d.a[2]) : null;
    // judged as this seat's team sees the board (Mpb.asSeen: the other team's buildings placed this round don't count),
    // so the page, which holds that view, gives the same answer and a refusal shows nothing hidden
    const r = M.asSeen(sd, () => Ref.act(R, sd, d, now));
    let team = false;
    if (r.ok) {
      if (TEAM_FNS.has(fn)) { logTeam(D, sd, own.lane, fn, d.a, before && { ...before }); copyTeam(R.m, O.m, sd); team = true; }
      else if (fn === 'undoAll') { rebuildTeam(D, sd, own.lane); team = true; }
      stampAll(D); // (what took a tile now: of two things on one tile at the fight's start the newer moves, settleBoard)
      mpbAfter(D, now); // a building's action may have opened a vote (bots vote at once)
      r.h = Ref.sideHash(R.m, sd); // this lane may have changed again (the team's part)
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
    mpbSettle(D, now); // a draft pick or a placement vote still open: settled now
    stampAll(D); // (what those placed is the newest)
    settleBoard(D); // everything known: of two things on one tile (or a rule only now broken) the newer moves to the nearest tile it may stand on
    for (const m of ms(D)) m.fhSeed = M.rng((sec(D) + m.round * 4111 + 17) >>> 0)() * 4294967296 >>> 0; // Field hospital's Field dressing picks (src/mpb.js): out of the views until the fight
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
      mpbTick(D, now); mpbAfter(D, now); // a vote's or the draft's 15 s ran out (or one just opened: bots vote, its clock starts)
      clock(D, now);
      if (D.deadline && now >= D.deadline + GRACE_MS) return runFight(D, now);
    }
    return null;
  }
  function due(D, now) {
    if (D.phase !== 'deploy') return 0;
    // (the deploy clock's end; while it is held, a player away coming back in time; and always the votes' and the
    // draft's own 15 s, which run beside the deploy clock and never hold it)
    const left = D.deadline ? [D.deadline + GRACE_MS] : humans(D).filter(k => D.away[k]).map(k => D.away[k] + AWAY_MAX_MS).filter(t => t > now).map(t => t + 50);
    const c = D.mclock || { vote: [], draft: 0 };
    for (const v of c.vote) if (v) left.push(v.until); // a placement vote's 15 s
    if (c.draft) left.push(c.draft);                   // the draft's pick
    return left.length ? Math.min(...left) : 0;
  }
  function next(D, seat, round, now) {
    if (D.phase !== 'result' || !D.summary || round !== D.summary[0].round) return false;
    D.nextReady[seat] = true;
    if (D.nextReady.every(Boolean)) { beginRound(D, now); return true; }
    return false;
  }
  function rematch(D, seat, units, matrix, now, seed, secret) {
    if (D.phase !== 'end') return false;
    D.rematch[seat] = true;
    if (humans(D).every(k => D.rematch[k])) return start(D, units, matrix, now, seed, null, secret);
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
  // the teammate's squads all, the other opponent's as an opponent sees them while deploying). The team's buildings,
  // placement votes (both players' tiles) and Vault are in m (team state); the opponents' buildings without this
  // round's skills, votes and Vault moves (Referee.hide -> Mpb.hide). The clocks: clocks(D, seat, now).
  function viewFor(D, seat) {
    const own = SEATS[seat], R = D.lanes[own.lane], O = D.lanes[1 - own.lane], deploy = D.phase === 'deploy';
    // (the Shadow Den's Insider information: Referee.hide shows a watched team's squads live, Game.foeSeen)
    const v = Ref.view(R.m, own.side, deploy, R.base), o = Ref.view(O.m, own.side, deploy, O.base);
    v.team = teamOf(o, own.lane);
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
    MECHITES, unitSet, TEAM_FIELDS, TEAM_FNS, SYS_FNS, copyTeam, copyAll, teamBody, settle, battle, laneResult, fight, view,
    create, start, act, setReady, runFight, tick, due, next, rematch, forfeit, setAway, viewFor, clock, clocks, canAct, cutFor, remainingFor, heldFor, save, load, humans,
    mpbPending, mpbTick, mpbSettle, rebuildTeam, undoAllAllowed, teamState, unstack, relocate, stamp, stampAll, bstamp, stampOf, bstampOf, settleBoard, things, conflicts, prioOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Duo = api;
})(typeof window !== 'undefined' ? window : globalThis);
