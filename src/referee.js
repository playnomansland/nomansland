// ===== The referee of a live match (server step 3, 2026-11-02) =====
// The game server (server/src/room.js) keeps every live match and both phones send it actions, never state: each
// action is a Game function the player calls on their own side (place, sell, levelUp, ...), and the server runs it
// through the very same function, which checks gold, tiles and unlocks. The server runs the fight and sends each
// phone only what that player may see (view: the opponent's squads, picks and buys of this round stay hidden).
//
// This file draws nothing and sends nothing, so the page, the server and node tests share it:
//   const Ref = require('./src/referee.js')   (in the page: the global Referee)
//
// A refereed match R (plain JSON once R.m is a snapshot; see save / load):
//   { v, settings, seed, lastMap, phase: 'lobby' | 'deploy' | 'result' | 'end', m, round,
//     ready: [b, b], nextReady: [b, b], rematch: [b, b], seq: [n, n] (last action number handled per side),
//     deadline (ms, 0 = no clock running), held (ms left while the clock waits for tower picks or a player away),
//     away: [ms, ms] (when each player went away, 0 = here), undo: [state, state] (Undo all, per side),
//     summary (the last fight's), fights (fights played) }
// Times are passed in (now), so the referee never reads a clock and tests can run it at any speed.
(function (root) {
  const G = (typeof Game !== 'undefined') ? Game : require('./game.js');
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');

  const V = 1;
  const DEPLOY_SECONDS = 90, FIRST_DEPLOY_SECONDS = 90; // as the page's (site-template.html)
  const GRACE_MS = 500;      // the fight starts this long after the clock runs out, so a phone's last action gets in
  const AWAY_MAX_MS = 120000; // a player away this long no longer holds the clock: the match goes on without them
  const MIN_LEFT_MS = 10000; // a clock that was paused comes back with at least this much

  // ----- actions -----
  // The Game functions a player may call on their own side: name -> kinds of the arguments after (m, side).
  // i = integer, s = short string, x = integer or short string. A trailing '?' makes the rest optional.
  // Nothing else gets through (no fortify(..., paid = false), no addAltar, no aiDeploy).
  const ACTIONS = {
    place: 'iii', unplaceSquad: 'i', moveSquad: 'iii', undoMove: '', sell: 'i',
    levelUp: 'i', undoLevel: 'i', levelAll: 'i',
    buySkill: 'ii', undoSkill: 'ii', unlock: 'i', undoUnlock: 'i', awaken: 'i', undoAwaken: 'i', huntMark: 'ii', undoHunt: 'i',
    choosePack: 'i', setTowerType: 's',
    buyDeploy: '', refundDeploy: '', takeLoan: '', undoLoan: '', spin: '',
    buyTowerSkill: '', undoTowerSkill: '', buyTowerSkill2: '', undoTowerSkill2: '',
    fortify: 'iis', placeBwall: 'iis', unplaceBwall: 'iis', placeMark: 'i',
    buyMageGen: 's', undoMageGen: '?s', buyTround: 's', undoTround: 's',
    giveCharm: 'i', undoCharm: 'i', buyAltar: 's', undoAltar: 's', bribe: '', undoBribe: '',
    buyElfOwn: 'ii', undoElfOwn: '', removeShroom: 'ii', undoRemoveShroom: 'ii',
    setAim: 'iii', clearAim: 'i',
    buyBuilding: 'iiii', buyBuildingSkill: 'xs', undoBuildingSkill: 'x', levelBuilding: 'x', undoLevelBuilding: 'x',
  };
  const okArg = (k, v) => k === 'i' ? Number.isInteger(v) && Math.abs(v) < 1e6
    : k === 's' ? typeof v === 'string' && v.length <= 40
      : k === 'x' ? (Number.isInteger(v) && Math.abs(v) < 1e6) || (typeof v === 'string' && v.length <= 40) : false;
  // the arguments as the function gets them, or null when they don't fit
  function cleanArgs(fn, a) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, fn) || typeof G[fn] !== 'function') return null;
    const spec = ACTIONS[fn], opt = spec.indexOf('?'), kinds = spec.replace('?', ''), need = opt < 0 ? kinds.length : opt;
    const args = Array.isArray(a) ? a : [];
    if (args.length < need || args.length > kinds.length) return null;
    for (let k = 0; k < args.length; k++) if (!okArg(kinds[k], args[k])) return null;
    return args.slice();
  }

  // ----- what each player may see -----
  const snapshot = (m) => JSON.parse(JSON.stringify({ ...m, units: null, matrix: null }));
  const withUnits = (s, units, matrix) => ({ ...s, units, matrix });

  // Hides side h's squads, picks and buys of this round in a snapshot s taken while deploying (the rules the PeerJS host
  // has used for the guest since 2026-10: syncState in site-template.html), plus levels bought this round (seenLevel) and
  // their gold, extra deployment and squad count as they stood when the round began (base: { gold, nextId }; without it
  // those are left). Changes s; returns it.
  function hide(s, h, base) {
    const round = s.round;
    s.armies[h] = G.foeSeen(s, h).map(q => { // a squad sold this round still shows; a squad moved this round shows on its old tile
      delete q.soldRound; delete q.outRound;
      if (q.from && q.movedRound === round) { q.col = q.from.col; q.row = q.from.row; if (q.from.in != null) q.in = q.from.in; else delete q.in; }
      delete q.from; delete q.movedRound; delete q.luckMove; delete q.aim; // a direction arrow shows in the fight
      if (q.charmGiven === round) { delete q.charm; delete q.charmGiven; } // Matteo's first stack, given this round
      if (q.awaken === round) delete q.awaken; // an awakening bought this round
      if (q.prey) { const p = G.preyShown(s, -2, true, h, q); if (p == null) delete q.prey; else q.prey = { squad: p, round: Math.min(q.prey.round, round - 1) }; } // a Hunter's mark moved this round shows where it was
      if (q.boughtLevels && q.boughtLevels[round]) { q.level -= q.boughtLevels[round]; delete q.boughtLevels[round]; } // levels bought this round
      return q;
    });
    if (s.moved) s.moved[h] = null;
    for (const ui in (s.tech && s.tech[h]) || {}) s.tech[h][ui] = s.tech[h][ui].map(r => r === round ? 0 : r); // skills bought this round
    if (round === 1) { // the leader, buff tiles, slot spins and package stay hidden until the first fight
      if (s.chars) s.chars[h] = null;
      if (s.slots) s.slots[h] = {};
      if (s.buff) s.buff[h] = [];
      if (s.packages) s.packages[h] = [];
      if (s.pack) s.pack[h] = null;
    } else if (s.slots && s.slots[h]) delete s.slots[h][round]; // this round's spins
    if (s.sold) s.sold[h] = []; // (they are in s.armies[h] now)
    if (round === G.TOWER_PICK_ROUND && s.towers && s.towers[h]) delete s.towers[h].type; // the tower pick
    if (s.bribe) s.bribe[h] = G.bribeList(s, h).filter(r => r !== round);
    if (s.elfOwn && s.elfOwn[h] && s.elfOwn[h].round === round) s.elfOwn[h] = null;
    if (s.bwalls && s.bwalls[h]) s.bwalls[h] = s.bwalls[h].filter(w => w.round !== round);
    if (s.mark && s.mark[h] && s.mark[h].round === round) s.mark[h] = null;
    if (s.towerSkill && s.towerSkill[h] === round) s.towerSkill[h] = 0;
    if (s.towerSkill2 && s.towerSkill2[h] === round) s.towerSkill2[h] = 0;
    if (s.mageGen) { const tr = G.mageTpRound(s, h); s.mageGen[h] = tr && tr < round ? { round: -1, id: null, tp: tr } : null; } // the teleport general stays seen once its round is over
    if (s.loan && s.loan[h] === round) s.loan[h] = 0;
    if (s.tround) s.tround[h] = {};
    if (s.mapFree && s.mapFree[h]) delete s.mapFree[h][round];
    if (s.map && s.map.removed) s.map.removed = s.map.removed.filter(x => !(x.side === h && x.round === round));
    if (s.altar) s.altar = s.altar.filter(x => !(x.side === h && x.round === round));
    if (s.unlocks && s.unlocks[h]) for (const ui in s.unlocks[h]) if (s.unlocks[h][ui] === round) delete s.unlocks[h][ui];
    if (s.extraDeploys) s.extraDeploys[h] = 0;
    if (s.buildings && s.buildings[h]) s.buildings[h] = s.buildings[h].filter(b => b.round !== round).map(b => { const n = (b.levels && b.levels[round]) | 0; if (!n) return b; const levels = { ...b.levels }; delete levels[round]; return { ...b, level: b.level - n, levels }; });
    if (s.bskill) s.bskill[h] = {};
    if (base && base.gold && s.gold) s.gold[h] = base.gold[h]; // what they have left would tell what they bought
    if (base && base.nextId && s.nextId) s.nextId[h] = base.nextId[h];
    return s;
  }
  // The match as `side` may see it (0 or 1; -1: a spectator, who sees neither side's new things while they deploy).
  // deploy: the players are deploying (otherwise everything is out in the open: the fight shows it all).
  function view(m, side, deploy, base) {
    const s = snapshot(m);
    if (!deploy) return s;
    if (side !== 0) hide(s, 0, base);
    if (side !== 1) hide(s, 1, base);
    return s;
  }
  // the view for a refereed match R
  const viewOf = (R, side) => view(R.m, side, R.phase === 'deploy', R.base);

  // ----- Undo all: one side's part of the match, to put back -----
  // Every per-side field ([side 0, side 1] arrays, also in m.dev) plus this side's entries in the shared lists.
  const UNDO_SKIP = new Set(['units', 'matrix', 'history', 'round', 'over', 'winner', 'seed', 'off', 'offTowers', 'rules', 'factions', 'map', 'dev', 'altar', 'hp', 'packages']);
  const UNDO_NULL = new Set(['chars', 'elfOwn', 'mageGen', 'moved', 'towers', 'woke']); // per-side fields that start as null (see game.js)
  const perSide = (v) => Array.isArray(v) && v.length === 2;
  function sideState(m, side) {
    const o = { top: {}, dev: {} };
    for (const [k, v] of Object.entries(m)) if (!UNDO_SKIP.has(k) && perSide(v)) o.top[k] = v[side];
    if (m.dev) for (const [k, v] of Object.entries(m.dev)) if (k !== 'casts' && perSide(v)) o.dev[k] = v[side];
    o.altar = (m.altar || []).filter(x => x.side === side);
    o.removed = ((m.map && m.map.removed) || []).filter(x => x.side === side);
    o.casts = ((m.dev && m.dev.casts) || []).filter(x => x.side === side);
    return JSON.parse(JSON.stringify(o));
  }
  function restoreSide(m, side, o) {
    o = JSON.parse(JSON.stringify(o));
    const blank = (k, v) => Array.isArray(v) ? [] : typeof v === 'number' ? 0 : UNDO_NULL.has(k) || v == null ? null : {};
    for (const [k, v] of Object.entries(m)) if (!UNDO_SKIP.has(k) && perSide(v)) v[side] = k in o.top ? o.top[k] : blank(k, v[side]);
    if (m.dev) for (const [k, v] of Object.entries(m.dev)) if (k !== 'casts' && perSide(v)) v[side] = k in o.dev ? o.dev[k] : blank(k, v[side]);
    if (m.altar || o.altar.length) m.altar = (m.altar || []).filter(x => x.side !== side).concat(o.altar);
    if (m.map && (m.map.removed || o.removed.length)) m.map.removed = (m.map.removed || []).filter(x => x.side !== side).concat(o.removed);
    if (m.dev) m.dev.casts = (m.dev.casts || []).filter(x => x.side !== side).concat(o.casts);
  }

  // ----- a short fingerprint of one side, so a phone can tell it is in step with the server -----
  const stable = (o) => o === null || typeof o !== 'object' ? JSON.stringify(o)
    : Array.isArray(o) ? '[' + o.map(x => x === undefined ? 'null' : stable(x)).join(',') + ']'
      : '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }
  const sideHash = (m, side) => fnv(stable({ s: sideState(m, side), hp: m.hp[side], r: m.round }));

  // ----- the fight -----
  // As the page's runFight: towers, packages, tower picks and walls nobody placed are settled first.
  function fight(m) {
    G.ensureTower(m, 0); G.ensureTower(m, 1);
    G.ensurePack(m, 0); G.ensurePack(m, 1);
    G.settleTowerPicks(m);
    G.ensureBwalls(m, 0); G.ensureBwalls(m, 1);
    const pre = snapshot(m);
    const sim = G.startBattle(m);
    while (sim.step()) {}
    const summary = G.resolve(m, sim.result());
    return { pre, post: snapshot(m), summary };
  }

  // ----- match settings -----
  // From a friend's lobby or a tournament. units: the prepared built-in units (server/src/prepare-units.cjs).
  // Only known values get through.
  function cleanSettings(x, units) {
    x = x && typeof x === 'object' ? x : {};
    const strs = (a, ok) => Array.isArray(a) ? a.filter(v => typeof v === 'string' && v.length <= 40 && ok(v)).slice(0, 200) : [];
    const names = new Set(units.map(u => u.name));
    const mapOk = (id) => G.MAPS.some(mp => mp.id === id);
    const s = {
      map: typeof x.map === 'string' && mapOk(x.map) ? x.map : '',
      skin: typeof x.skin === 'string' && (x.skin === 'random' || G.SKINS.some(k => k.id === x.skin)) ? x.skin : '',
      offUnits: strs(x.offUnits, n => names.has(n)),
      offChars: strs(x.offChars, id => !!G.charInfo(id)),
      offTowers: strs(x.offTowers, id => G.TOWER_TYPES.some(t => t.id === id)),
      packOptions: [2, 3, 4, 5].includes(x.packOptions) ? x.packOptions : 3,
      mirror: x.mirror === true,
      late: x.late === true, // DEVTESTLATEGAME
      noChars: x.noChars === true, // no leaders (2v2)
      deploy1: Number.isInteger(x.deploy1) && x.deploy1 >= 15 && x.deploy1 <= 600 ? x.deploy1 : FIRST_DEPLOY_SECONDS,
      deploy: Number.isInteger(x.deploy) && x.deploy >= 15 && x.deploy <= 600 ? x.deploy : DEPLOY_SECONDS,
      next: Number.isInteger(x.next) && x.next >= 3 && x.next <= 120 ? x.next : 20,
    };
    return s;
  }
  function newMatch(units, matrix, s, seed, lastMap) {
    const off = units.map((u, i) => s.offUnits.includes(u.name) ? i : -1).filter(i => i >= 0);
    return G.createMatch(units, matrix, seed >>> 0, s.map || null, lastMap || null, s.offChars,
      { skin: s.skin || null, offUnits: off, offTowers: s.offTowers, mirror: s.mirror, packOptions: s.packOptions, late: s.late, noChars: s.noChars });
  }

  // ----- the refereed match -----
  function create(settings, units) { return { v: V, settings: cleanSettings(settings, units), phase: 'lobby', m: null, round: 0, ready: [false, false], nextReady: [false, false], rematch: [false, false], seq: [0, 0], deadline: 0, held: 0, away: [0, 0], undo: [null, null], summary: null, fights: 0, lastMap: null, seed: 0 }; }
  const deployMsOf = (R) => (R.m && R.m.round === 1 ? R.settings.deploy1 : R.settings.deploy) * 1000;
  const picksPending = (R) => !!R.m && (G.needsTowerPick(R.m, 0) || G.needsTowerPick(R.m, 1));
  const someoneAway = (R, now) => [0, 1].some(sd => R.away[sd] && now - R.away[sd] < AWAY_MAX_MS);

  // the clock: runs unless tower picks are pending or a player is away (then held keeps what is left)
  function clock(R, now) {
    if (R.phase !== 'deploy') { R.deadline = 0; R.held = 0; return; }
    const stop = picksPending(R) || someoneAway(R, now);
    if (stop && R.deadline) { R.held = Math.max(MIN_LEFT_MS / 2, R.deadline - now); R.deadline = 0; }
    else if (!stop && !R.deadline) { R.deadline = now + Math.max(MIN_LEFT_MS, R.held || deployMsOf(R)); R.held = 0; }
  }
  function beginRound(R, now) {
    R.phase = 'deploy'; R.round = R.m.round;
    R.ready = [false, false]; R.nextReady = [false, false]; R.rematch = [false, false];
    R.undo = [null, null]; R.deadline = 0; R.held = deployMsOf(R);
    R.base = { gold: R.m.gold.slice(), nextId: R.m.nextId.slice() };
    clock(R, now);
  }
  // a new match (the lobby's Start, a rematch, or a tournament match once both players are in)
  function start(R, units, matrix, now, seed) {
    R.seed = seed >>> 0;
    R.m = newMatch(units, matrix, R.settings, R.seed, R.lastMap);
    R.lastMap = R.m.map ? R.m.map.id : null;
    R.summary = null; R.fights = 0;
    beginRound(R, now);
    return true;
  }
  const canAct = (R, side) => R.phase === 'deploy' && !!R.m && (side === 0 || side === 1) && !R.ready[side] && !R.m.over;
  // Undo all goes back to this side as it stood once the round's picks (package, tower) were done
  function undoPoint(R, side) {
    if (R.undo[side] && R.undo[side].round === R.m.round) return;
    if (G.needsPack(R.m, side) || G.needsTowerPick(R.m, side)) return;
    R.undo[side] = { round: R.m.round, state: sideState(R.m, side) };
  }
  // One action from a player. d: { seq, fn, a }. Returns { ok, h } (h: that side's fingerprint after it).
  function act(R, side, d, now) {
    const seq = Number.isInteger(d && d.seq) ? d.seq : 0;
    if (seq > R.seq[side]) R.seq[side] = seq;
    if (!canAct(R, side)) return { ok: false, why: R.ready[side] ? 'ready' : 'phase' };
    if (R.deadline && now > R.deadline + GRACE_MS) return { ok: false, why: 'time' };
    const m = R.m;
    if (d.fn === 'undoAll') {
      const u = R.undo[side];
      if (!u || u.round !== m.round) return { ok: false, why: 'nothing' };
      restoreSide(m, side, u.state);
      return { ok: true, h: sideHash(m, side) };
    }
    const args = cleanArgs(d.fn, d.a);
    if (!args) return { ok: false, why: 'bad' };
    if (d.fn !== 'choosePack' && d.fn !== 'setTowerType') undoPoint(R, side);
    let r;
    try { r = G[d.fn](m, side, ...args); } catch (e) { return { ok: false, why: 'error' }; }
    if (!r) return { ok: false, why: 'rules' };
    if (d.fn === 'spin' && R.undo[side]) R.undo[side] = { round: m.round, state: sideState(m, side) }; // a spin can't be undone
    if (d.fn === 'choosePack' || d.fn === 'setTowerType') clock(R, now); // a tower pick may let the clock start
    return { ok: true, h: sideHash(m, side) };
  }
  // Ready (or not). Returns the fight when both are ready.
  function setReady(R, side, v, now) {
    if (R.phase !== 'deploy' || R.m.over || (R.deadline && now > R.deadline + GRACE_MS)) return null;
    R.ready[side] = !!v;
    return R.ready[0] && R.ready[1] ? runFight(R, now) : null;
  }
  function runFight(R, now) {
    if (R.phase !== 'deploy') return null;
    const f = fight(R.m);
    R.fights++;
    R.summary = f.summary;
    R.phase = R.m.over ? 'end' : 'result';
    R.ready = [false, false]; R.nextReady = [false, false]; R.rematch = [false, false];
    R.deadline = 0; R.held = 0;
    // a player who is away moves on by themselves (they get the next round when they are back)
    for (const sd of [0, 1]) if (R.away[sd]) R.nextReady[sd] = true;
    return f;
  }
  // the clock ran out (call at any time: does nothing before then). Returns the fight if it started.
  function tick(R, now) {
    if (R.phase === 'deploy') {
      clock(R, now);
      if (R.deadline && now >= R.deadline + GRACE_MS) return runFight(R, now);
    }
    return null;
  }
  // when the room should wake up next (0: no need)
  function due(R, now) {
    if (R.phase !== 'deploy') return 0;
    if (R.deadline) return R.deadline + GRACE_MS;
    const left = [0, 1].filter(sd => R.away[sd]).map(sd => R.away[sd] + AWAY_MAX_MS).filter(t => t > now);
    return left.length ? Math.min(...left) + 50 : 0;
  }
  // the results screen: both moved on (or the clock for it ran out on their phones) -> the next round
  function next(R, side, round, now) {
    if (R.phase !== 'result' || !R.summary || round !== R.summary.round) return false;
    R.nextReady[side] = true;
    if (R.nextReady[0] && R.nextReady[1]) { beginRound(R, now); return true; }
    return false;
  }
  function rematch(R, side, units, matrix, now, seed) {
    if (R.phase !== 'end') return false;
    R.rematch[side] = true;
    if (R.rematch[0] && R.rematch[1]) return start(R, units, matrix, now, seed);
    return false;
  }
  function forfeit(R, side) {
    if (!R.m || R.m.over || R.phase === 'lobby') return false;
    R.m.over = true; R.m.winner = 1 - side; R.phase = 'end'; R.deadline = 0; R.held = 0; R.forfeit = side;
    return true;
  }
  // a player's phone went away (true) or came back (false)
  function setAway(R, side, away, now) {
    R.away[side] = away ? (R.away[side] || now) : 0;
    if (away && R.phase === 'result') { R.nextReady[side] = true; if (R.nextReady[0] && R.nextReady[1]) { beginRound(R, now); return true; } }
    clock(R, now);
    return false;
  }
  // what the room keeps between wake-ups, and back
  const save = (R) => ({ ...R, m: R.m ? snapshot(R.m) : null });
  const load = (o, units, matrix) => o && o.v === V ? { ...o, m: o.m ? withUnits(o.m, units, matrix) : null } : null;

  const api = {
    V, ACTIONS, cleanArgs, snapshot, withUnits, hide, view, viewOf, sideState, restoreSide, stable, fnv, sideHash, fight,
    cleanSettings, newMatch, create, start, act, setReady, runFight, tick, due, next, rematch, forfeit, setAway, clock,
    canAct, save, load, GRACE_MS, AWAY_MAX_MS, DEPLOY_SECONDS, FIRST_DEPLOY_SECONDS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Referee = api;
})(typeof window !== 'undefined' ? window : globalThis);
