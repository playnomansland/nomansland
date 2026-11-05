// ===== 2v2 buildings: minor permanent buildings (MPBs), the Vault, artifacts and the artifact draft (6 Nov 2026) =====
// docs/MPB-2V2.md is the design. This file is the framework every building kind plugs into, plus the Vault (the
// reference kind) and the rules side of artifacts and the draft. It draws nothing and sends nothing: the page, the game
// server (through src/duo.js) and node tests share it.
//   const Mpb = require('./src/mpb.js')   (in the page: the global Mpb, loaded after game.js and before duo.js)
//
// Team state (kept identical in both lanes of a team, Duo.TEAM_FIELDS):
//   m.mpb     = [[rec, ...] side 0, [...] side 1]   the team's buildings. rec = { key, kind, col, row, parts: { <part>: { col, row } },
//               round (placed), fell (the round it was last destroyed in, 0 = never), skills: { <id>: skill entry }, data: { ... } }
//               skill entry = { round (last bought), n (bought in all), by: [lane 0's, lane 1's], log: [{ lane, cost }] (this round's clicks) }
//   m.mpbVote = [[entry, ...], [...]]  the placement vote queue. entry = { kind, part (null: the building itself), key (a part's building), votes: [lane 0's tile | null, lane 1's] }
//   m.vault   = [{ gold, mode: 'put' | 'take' | null, moved: [lane 0's, lane 1's], round, start (gold as the round began) }, x2]
// Match state (the same in all four views): m.artifacts = { round, list: [{ id, col, row, card, won }] },
//   m.draft = { round, cards, won, owner: [team of card 0, of card 1] (null while a pick is due), first, how, done }.
// Lane state: m.duoLane (0 or 1: who paid, whose vote), m.duoTowers (2v2 towers: the Outpost until a tower card comes).
// Clocks (the placement vote's and the draft's 15 s) live in the refereed match D (src/duo.js, D.mclock).
(function (root) {
  const G = (typeof Game !== 'undefined') ? Game : require('./game.js');
  const E = (typeof Engine !== 'undefined') ? Engine : require('./engine.js');

  const SQ = -700, XSQ = -800;                 // fight squad ids: MPB k of a side is SQ - k; extra bodies XSQ - 10k - j
  const VOTE_MS = 15000, DRAFT_MS = 15000;     // a placement vote, a draft pick
  const SPACING = 3;                           // Chebyshev distance from every other building tile ("2 tiles around")
  const ARTIFACT = { rounds: [2, 8], r: 9, cap: 100, gold: 50, apart: 10 };
  const DRAFT_ROUNDS = [3, 9];                 // the cards of round 2's artifacts are dealt in round 3, round 8's in 9
  const VAULT_SPOT = [{ col: 6, row: 15 }, { col: 17, row: 2 }]; // the old 2v2 treasury tiles (README, 2026-11-05)
  const PER = ['round', 'roundPlayer', 'match', 'building', 'free'];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const laneOf = (m) => (m && m.duoLane === 1 ? 1 : 0);
  const on = (m) => !!(m && Array.isArray(m.mpb));
  const grid = (m) => { G.useGrid(m); return { COLS: G.COLS, ROWS: G.ROWS }; };

  // =====================================================================
  // The kinds. One entry per kind, each in its own marked region (B groups fill theirs). Fields:
  //   id, name, short (key prefix), kind ('economic' | 'support' | 'technical' | 'defensive'), text, downside, hp,
  //   armor, color (2D and the default 3D tint), draft (false: never a card), skills: [{ id, name, cost, costStep,
  //   per, text, max }], place: { where: 'interior' | 'own' | 'nml' | 'board' | 'fixed', spacing, open, parts: [{ id,
  //   name, where, spacing }] }, hooks: { ... } (see the Hooks section below and docs/MPB-2V2.md "Adding a kind")
  // =====================================================================
  const KINDS = {};
  const def = (k) => {
    KINDS[k.id] = { kind: 'technical', text: '', downside: '', hp: 600, armor: 0, color: '#B7AE9C', draft: true, skills: [], hooks: {},
      ...k, place: { where: 'interior', spacing: true, ...(k.place || {}) } };
    return KINDS[k.id];
  };

  // ===== vault =====
  // Every team starts with one, on the old treasury tile. Put / take up to VAULT.move a round per player (a put round or
  // a take round for the whole team, set by its first move). Destroyed: VAULT.lose % of its gold is lost (down to
  // 10s) and each opponent player gets VAULT.bounty. Skills: Compound interest, Coin golem.
  const VAULT = { hp: 900, armor: 4, move: 200, lose: 80, bounty: 50, interest: 10, golemCost: 100 };
  const GOLEM = { hp: 300, hpPer: 3, hit: 30, hitPer: 0.12, aps: 0.7, range: 3, splash: 1.5, armor: 2, armorPer: 1 / 250, armorMax: 8, speed: 4, tier: 3, silver: 400, gold: 900 };
  const golemSkin = (g) => g >= GOLEM.gold ? 'gold' : g >= GOLEM.silver ? 'silver' : 'bronze';
  const GOLEM_COL = { bronze: '#B87333', silver: '#C9CED6', gold: '#E6B84A' };
  function golemUnit(g) {
    const skin = golemSkin(g);
    return E.withTraits({ name: 'Coin Golem', cost: 0, bodies: 1, hp: GOLEM.hp + GOLEM.hpPer * g, hit: GOLEM.hit + GOLEM.hitPer * g, aps: GOLEM.aps, range: GOLEM.range,
      speed: GOLEM.speed, splash: GOLEM.splash, defense: 'armor', defVal: Math.min(GOLEM.armorMax, GOLEM.armor + g * GOLEM.armorPer), shape: 'square',
      color: GOLEM_COL[skin], tier: GOLEM.tier, mpb: 'golem', mpbSkin: skin, level: 0 });
  }
  const vaultOf = (m, side) => (m && m.vault && m.vault[side]) || null;
  const vaultRec = (m, side) => recs(m, side).find(r => r.kind === 'vault') || null;
  // this round's mode and moves (a vault last touched in an earlier round has none)
  const vaultMode = (m, side) => { const v = vaultOf(m, side); return v && v.round === m.round ? v.mode : null; };
  const vaultMoved = (m, side, lane) => { const v = vaultOf(m, side); return v && v.round === m.round ? (v.moved[lane] || 0) : 0; };
  function vaultNow(m, side) { const v = vaultOf(m, side); if (v && v.round !== m.round) { v.round = m.round; v.mode = null; v.moved = [0, 0]; v.start = v.gold; } return v; }
  // the most this player can put in / take out now
  const vaultRoom = (m, side, mode) => {
    const v = vaultOf(m, side), cur = vaultMode(m, side);
    if (!v || !vaultRec(m, side) || m.over || (cur && cur !== mode)) return 0;
    const left = VAULT.move - vaultMoved(m, side, laneOf(m));
    return Math.max(0, Math.min(left, mode === 'put' ? m.gold[side] : v.gold));
  };
  const canVault = (m, side, mode, n) => on(m) && Number.isInteger(n) && n >= 1 && n <= vaultRoom(m, side, mode);
  function vaultMove(m, side, mode, n) {
    if (!canVault(m, side, mode, n)) return false;
    const v = vaultNow(m, side), L = laneOf(m);
    v.mode = mode; v.moved[L] = (v.moved[L] || 0) + n;
    if (mode === 'put') { m.gold[side] -= n; v.gold += n; } else { v.gold -= n; m.gold[side] += n; }
    return true;
  }
  const vaultPut = (m, side, n) => vaultMove(m, side, 'put', n);
  const vaultTake = (m, side, n) => vaultMove(m, side, 'take', n);
  const golemOf = (m, side) => { const r = vaultRec(m, side), g = r && r.data.golem; return g && g.round === m.round ? g : null; };
  def({
    id: 'vault', name: 'The Vault', short: 'v', kind: 'economic', hp: VAULT.hp, armor: VAULT.armor, color: '#C9A24A', draft: false,
    text: `Each of you may put in or take out up to ${VAULT.move} gold a round. A round is a put round or a take round for the whole team: the first move sets it.`,
    downside: `Destroyed in a fight: ${VAULT.lose}% of its gold is lost and each opponent gets ${VAULT.bounty} gold.`,
    place: { where: 'fixed', spacing: false },
    skills: [
      { id: 'interest', name: 'Compound interest', cost: 200, per: 'match', text: `At the start of every round the vault’s gold grows ${VAULT.interest}%.` },
      { id: 'golem', name: 'Coin golem', cost: VAULT.golemCost, per: 'roundPlayer', text: 'Both of you click it in the same round: all the vault’s gold becomes a Coin Golem that fights next to the vault this round.' },
    ],
    hooks: {
      canBuy: (m, side, rec, sk) => sk.id !== 'golem' || !golemOf(m, side),
      // the second click (one from each player this round) spends all the vault's gold on the golem
      bought(m, side, rec, sk) {
        if (sk.id !== 'golem') return;
        const log = rec.skills.golem.log, lanes = new Set(log.map(e => e.lane));
        if (lanes.size < 2) return;
        const v = vaultNow(m, side);
        rec.data.golem = { round: m.round, g: v.gold };
        v.gold = 0;
      },
      unbuy(m, side, rec, sk) {
        const g = sk.id === 'golem' && golemOf(m, side);
        if (g) { vaultNow(m, side).gold += g.g; rec.data.golem = null; }
      },
      bodies(m, side, rec, ctx) {
        const out = ctx.main();
        const g = golemOf(m, side);
        if (g) { // in front of the vault (toward the enemy)
          const w = G.tileToWorld(rec.col, rec.row + (side === 0 ? -1 : 1));
          const gb = E.buildSquad(golemUnit(g.g), side, w.x, w.y, ctx.xsq(0), G.TILE, ctx.idx + 1);
          for (const b of gb) b.tier = GOLEM.tier; // what it holds an artifact for (Engine: b.tier)
          out.push(...gb);
        }
        return out;
      },
      roundStart(lanes, side, rec) {
        const m = lanes[0], v = vaultOf(m, side);
        if (!v) return;
        if (skillN(rec, 'interest') > 0) v.gold += Math.floor(v.gold * VAULT.interest / 100);
        v.round = m.round; v.mode = null; v.moved = [0, 0]; v.start = v.gold;
      },
      afterFight(lanes, side, rec, res, sums, round) {
        const m = lanes[0], v = vaultOf(m, side);
        if (!v || rec.fell !== round) return;
        const lost = Math.floor(v.gold * VAULT.lose / 100 / 10) * 10;
        v.gold -= lost;
        for (const L of lanes) L.gold[1 - side] += VAULT.bounty;
        news(sums, side, { kind: 'vault', lost, bounty: VAULT.bounty });
      },
      // the opponents see the vault as it stood when the round began
      hide(s, h, rec) {
        const v = vaultOf(s, h);
        if (v && v.round === s.round) { v.gold = v.start || 0; v.mode = null; v.moved = [0, 0]; }
        if (rec.data.golem && rec.data.golem.round === s.round) rec.data.golem = null;
      },
      info(m, side, rec) {
        const v = vaultOf(m, side), g = golemOf(m, side);
        return [`${v ? v.gold : 0} gold inside`, g ? `Coin Golem this round: ${g.g} gold (${golemSkin(g.g)})` : ''].filter(Boolean);
      },
    },
  });

  // ===== treeKojja =====
  def({ id: 'treeKojja', name: 'Tree kojja', short: 'tk', kind: 'defensive', hp: 500, armor: 0, color: '#6B8E3D',
    text: 'Shoots like the Outpost, 20 m range, sees stealth in range.', downside: 'Destroyed: the next round it works for the opponents.', skills: [], hooks: {} });

  // ===== fieldHospital =====
  // A canvas field tent (group B2). Squads of either teammate deployed on its tile's 8 neighbours (Chebyshev 1) get
  // +FH.hp % health and FH.regen % of their health a second in the fight (squadMods). A round the team wins with the
  // hospital standing: +FH.win Team HP (never above the team's starting health, TEAM_HP_CAP); destroyed: −FH.lose.
  // Field dressing (50, +50 for each of your clicks this round): each click gives a random allied squad (either
  // player's, picked when the fight starts: Engine opts.mpb.fieldHospital.dress, seeded from the match) +FH.dress %
  // health for this fight. Second wind (100, once a round for the team): the chosen allied squad (args: its lane and
  // its id in that lane) comes back whole, once, on the tile in front of the hospital the first time it is wiped out
  // (bodies marked b.fhRevive; the Engine brings them back). rec.data.wind = { round, lane, id }.
  const FH = { hp: 20, regen: 2, win: 5, lose: 15, dress: 25, range: 1 };
  const TEAM_HP_CAP = 2 * G.START_HP; // a team's starting health (Duo.HP): Team HP heals never go above it (also the Oak's)
  const fhNear = (rec, sq) => Math.max(Math.abs(sq.col - rec.col), Math.abs(sq.row - rec.row)) <= FH.range;
  const fhClicks = (m, rec, id) => { const e = rec.skills[id]; return e && e.round === m.round ? e.log.length : 0; };
  const fhWind = (m, rec) => { const w = rec.data.wind; return w && w.round === m.round && fhClicks(m, rec, 'wind') > 0 ? w : null; };
  const fhFront = (rec, side) => ({ col: rec.col, row: rec.row + (side === 0 ? -1 : 1) }); // where Second wind brings a squad back (toward the enemy)
  const fhTeam = (side) => side === 0 ? 'Team A' : 'Team B';
  const fhTarget = (args) => (args[0] === 0 || args[0] === 1) && Number.isInteger(args[1]) && args[1] >= 0;
  def({ id: 'fieldHospital', name: 'Field hospital', short: 'fh', kind: 'support', hp: 600, armor: 2, color: '#E8E2D0',
    text: `Squads deployed within 1 tile: +${FH.hp}% health and ${FH.regen}% health a second in the fight. Each round your team wins with it standing: +${FH.win} Team HP. Can’t shoot.`,
    downside: `Destroyed: −${FH.lose} Team HP.`,
    skills: [
      { id: 'dress', name: 'Field dressing', cost: 50, costStep: 50, per: 'free', text: `A random allied squad (yours or your teammate’s) gets +${FH.dress}% health for this round’s fight. Click as often as you like.` },
      { id: 'wind', name: 'Second wind', cost: 100, per: 'round', pick: true, text: 'Pick an allied squad: the first time it is wiped out in this round’s fight, it comes back whole on the tile in front of the hospital.' },
    ],
    hooks: {
      canBuy: (m, side, rec, sk, args) => sk.id !== 'wind' || fhTarget(args), // the squad: (lane, id); a squad that is gone by the fight just doesn't come back
      bought(m, side, rec, sk, args) { if (sk.id === 'wind') rec.data.wind = { round: m.round, lane: args[0], id: args[1] }; },
      unbuy(m, side, rec, sk) { if (sk.id === 'wind') rec.data.wind = null; },
      // pick another squad for this round's Second wind (either of you)
      canAct: (m, side, rec, action, args) => action === 'wind' && !!fhWind(m, rec) && fhTarget(args),
      act(m, side, rec, action, args) { rec.data.wind = { round: m.round, lane: args[0], id: args[1] }; return true; },
      squadMods(m, side, rec, sq, u) {
        if (!fhNear(rec, sq) || G.isRider(sq)) return u;
        return { ...u, hp: u.hp * (1 + FH.hp / 100), regen: (u.regen || 0) + FH.regen };
      },
      squadBodies(m, side, rec, sq, list) {
        const w = fhWind(m, rec);
        if (!w || w.lane !== laneOf(m) || w.id !== sq.id) return;
        const at = G.tileToWorld(fhFront(rec, side).col, fhFront(rec, side).row);
        for (const b of list) b.fhRevive = { x: at.x, y: at.y };
      },
      // Field dressing: one seeded number a click (the Engine picks the squad from all the side's squads in the fight)
      battleOpts(m, side, rec, opts) {
        const o = opts.mpb.fieldHospital || (opts.mpb.fieldHospital = { dress: [[], []], pct: FH.dress });
        // seeded from m.fhSeed (Duo.runFight sets it from the duo's seed, which no seat's view holds, just before the
        // fight, so nobody can work the picks out while deploying; the fight's snapshots carry it), else the match's seed
        const n = fhClicks(m, rec, 'dress'), r = rng(((m.fhSeed != null ? m.fhSeed : m.seed) >>> 0) + m.round * 7919 + 4111 >>> 0); // the same numbers for both sides: a mirror is a mirror
        for (let k = 0; k < n; k++) o.dress[side].push(r());
      },
      afterFight(lanes, side, rec, res, sums, round, hp) {
        if (rec.fell === round) {
          hp[side] = Math.max(0, hp[side] - FH.lose);
          news(sums, side, { kind: 'fieldHospital', lost: FH.lose, text: `${fhTeam(side)}’s Field hospital was destroyed: −${FH.lose} Team HP.` });
        } else if (res.winner === side && hp[side] > 0) {
          const was = hp[side];
          hp[side] = Math.min(Math.max(was, TEAM_HP_CAP), was + FH.win);
          if (hp[side] > was) news(sums, side, { kind: 'fieldHospital', healed: hp[side] - was, text: `${fhTeam(side)}’s Field hospital: +${hp[side] - was} Team HP for the round won.` });
        }
      },
      hide(s, h, rec) { if (rec.data.wind && rec.data.wind.round === s.round) rec.data.wind = null; },
      info(m, side, rec) {
        const w = fhWind(m, rec), d = fhClicks(m, rec, 'dress');
        return [d ? `Field dressing this round: ${d}×` : '', w ? `Second wind this round: squad ${w.id} of ${w.lane === laneOf(m) ? 'yours' : 'your teammate’s'}` : ''];
      },
      // a bot (Duo.botTurn): Field dressing now and then, Second wind on its dearest squad when it is rich
      botAfter(m, side, rec) {
        const r = rng(((m.seed >>> 0) + m.round * 131 + laneOf(m) * 17 + 5) >>> 0);
        if (m.gold[side] >= 250 && r() < 0.4) mpbBuy(m, side, rec.key, 'dress');
        const best = m.armies[side].filter(q => !G.isRider(q)).sort((a, b) => (b.cost || 0) - (a.cost || 0) || a.id - b.id)[0];
        if (best && m.gold[side] >= 300 && r() < 0.3) mpbBuy(m, side, rec.key, 'wind', laneOf(m), best.id);
      },
    },
  });

  // ===== coalMine =====
  // An entrance in the team's zone and an exit in no man's land (two placement votes, one after the other). Squads
  // deployed on the 8 tiles round the entrance go down the mine as the fight starts and come up on the matching tile
  // round the exit (the same offset) COAL.travel s later, then stand COAL.rise s more (vulnerable, as a squad new on a
  // flank tile). No squad of either team may be deployed on the 8 tiles round the exit (hooks.blocks; enemy tiles too).
  // A squad whose tile at the exit an enemy squad stands on as the fight starts doesn't go in (Engine: mineTo). The
  // entrance is a structure that can be destroyed (squads already on their way still come up); the exit is a shaft on
  // the board, not a fight body. Skills: Dig a new exit (move it once; a flank tile of the enemy's half too), Fresh
  // air (squads coming up faster and tougher for a while).
  const COAL = { hp: 700, armor: 4, travel: 2, rise: 1.5, moveCost: 150, airCost: 200, air: { speed: 25, armor: 4, secs: 5 } };
  const exitOf = (rec) => (rec && rec.parts && rec.parts.exit) || null;
  const cheb = (c0, r0, c1, r1) => Math.max(Math.abs(c0 - c1), Math.abs(r0 - r1));
  // the tile a squad on (col, row) comes up on, or null (not round the entrance, no exit yet, off the board, or that
  // tile is water or a building's: the squad stays home)
  function mineOut(m, rec, col, row) {
    const x = exitOf(rec);
    if (!x || rec.col < 0 || cheb(col, row, rec.col, rec.row) !== 1) return null;
    grid(m);
    const c = x.col + col - rec.col, r = x.row + row - rec.row;
    if (!inBoard(c, r) || G.terrainBlocks(m, c, r) || buildingTiles(m).some(t => t.col === c && t.row === r)) return null;
    return { col: c, row: r };
  }
  // may the exit stand on (col, row), as this player sees the board (squads the opponents put down this round don't
  // count: a refusal would show where they are)? Its own tile and the tiles round it don't count: the exit leaves them
  function exitFree(m, side, rec, col, row) {
    const x = exitOf(rec);
    if (!on(m) || !x || !Number.isInteger(col) || !Number.isInteger(row)) return false;
    grid(m);
    if (!inBoard(col, row) || G.terrainBlocks(m, col, row)) return false;
    delete rec.parts.exit;
    try { return !seenTaken(m, side, col, row); } finally { rec.parts.exit = x; }
  }
  // may the exit be moved to (col, row) (Dig a new exit)? No man's land (not flank tiles) as before, or a flank tile of
  // the enemy's half; a free tile
  function exitMoveOk(m, side, rec, col, row) {
    const x = exitOf(rec);
    if (!x || (x.col === col && x.row === row)) return false;
    grid(m);
    if (!(nmlOk(col, row) || G.isFlank(side, col, row))) return false;
    return exitFree(m, side, rec, col, row);
  }
  // may Dig a new exit (or Undo all) put the exit back on its old tile? Only while that tile is still free (no water, no
  // other exit or building, no squad of the team's) – else the take-back is refused
  const exitBackOk = (m, side, rec, t) => !t || exitFree(m, side, rec, t.col, t.row);
  function exitSpots(m, side, rec) {
    const out = [];
    if (!on(m)) return out;
    const { COLS, ROWS } = grid(m);
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (exitMoveOk(m, side, rec, col, row)) out.push({ col, row });
    return out;
  }
  const canMoveExit = (m, side, rec) => skillN(rec, 'shaft') > 0 && !rec.data.moved && !!exitOf(rec);
  def({ id: 'coalMine', name: 'Coal mine', short: 'cm', kind: 'technical', hp: COAL.hp, armor: COAL.armor, color: '#4A4440',
    text: `Squads deployed on the 8 tiles round the entrance go down the mine as the fight starts and come up round the exit in no man’s land ${COAL.travel} s later (on the matching tile), then stand ${COAL.rise} s before they fight.`,
    downside: 'No squad of either team may be deployed on the 8 tiles round its exit. A squad whose tile at the exit an enemy squad holds stays where it is.',
    place: { where: 'interior', spacing: true, parts: [{ id: 'exit', name: 'exit', where: 'nml', spacing: false }] },
    skills: [
      { id: 'shaft', name: 'Dig a new exit', cost: COAL.moveCost, per: 'match', text: 'Move the exit once, to any tile of no man’s land or a flank tile of the enemy’s half.' },
      { id: 'air', name: 'Fresh air', cost: COAL.airCost, per: 'match', text: `Squads coming up the mine move ${COAL.air.speed}% faster and have +${COAL.air.armor} armor for ${COAL.air.secs} s.` },
    ],
    COAL, mineOut, exitMoveOk, exitBackOk, exitSpots, canMoveExit,
    hooks: {
      // the 8 tiles round the exit: no squad of either team (Game.occupied through Mpb.at)
      blocks(m, side, rec, col, row) { const x = exitOf(rec); return !!x && cheb(col, row, x.col, x.row) === 1; },
      // a squad round the entrance: its bodies go down (Engine mineTo; the Engine leaves out a squad whose exit tile an enemy holds)
      squadBodies(m, side, rec, sq, list) {
        if (sq.in != null || !list.length) return; // a rider goes with its carrier
        const t = mineOut(m, rec, sq.col, sq.row);
        if (!t) return;
        const a = G.tileToWorld(sq.col, sq.row), b = G.tileToWorld(t.col, t.row);
        const air = skillN(rec, 'air') > 0 ? { ...COAL.air } : null;
        for (const x of list) x.mineTo = { x: b.x, y: b.y, dx: b.x - a.x, dy: b.y - a.y, h: G.TILE / 2, t: COAL.travel, rise: COAL.rise, boost: air };
      },
      canBuy: (m, side, rec) => !!exitOf(rec),
      // Dig a new exit taken back the round it was bought: the exit goes back too (refused once its old tile is taken)
      canUndo: (m, side, rec, id) => id !== 'shaft' || !(rec.data.moved === m.round && rec.data.from) || exitBackOk(m, side, rec, rec.data.from),
      // Undo all would put the exit back where it stood (restoreOk: was = the record as it would be again)
      restoreOk(m, side, rec, was) { const a = exitOf(rec), b = exitOf(was); return !b || (a && a.col === b.col && a.row === b.row) || exitBackOk(m, side, rec, b); },
      unbuy(m, side, rec, sk) { if (sk.id === 'shaft' && rec.data.moved === m.round && rec.data.from) { rec.parts.exit = { ...rec.data.from }; rec.data.moved = 0; rec.data.from = null; } },
      canAct: (m, side, rec, action, args) => action === 'exit' && canMoveExit(m, side, rec) && exitMoveOk(m, side, rec, args[0], args[1]),
      act(m, side, rec, action, args, lane) {
        rec.data.from = { ...exitOf(rec) }; rec.data.moved = m.round; rec.data.by = lane;
        rec.parts.exit = { col: args[0], row: args[1] };
        return true;
      },
      // bots: now and then one of the squads they put down this round goes round the entrance (down the mine), Fresh
      // air when they have gold to spare, and sometimes a new exit nearer the enemy
      botAfter(m, side, rec, r) {
        if (!exitOf(rec)) return;
        if (r() < 0.5) {
          const sq = m.armies[side].find(q => q.round === m.round && q.in == null && !(m.units[q.unit] || {}).building && !mineOut(m, rec, q.col, q.row));
          const to = [];
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dc || dr) to.push({ col: rec.col + dc, row: rec.row + dr });
          if (sq) for (const t of to.sort((a, b) => (side === 0 ? a.row - b.row : b.row - a.row) || Math.abs(a.col - rec.col) - Math.abs(b.col - rec.col) || a.col - b.col)) if (mineOut(m, rec, t.col, t.row) && G.moveSquad(m, side, sq.id, t.col, t.row)) break;
        }
        const spare = () => m.gold[side] - G.CARRY_CAP / 2;
        if (!skillN(rec, 'air') && spare() >= COAL.airCost && r() < 0.35) G.mpbBuy(m, side, rec.key, 'air');
        if (!skillN(rec, 'shaft') && spare() >= COAL.moveCost && r() < 0.2) {
          const fwd = (t) => side === 0 ? t.row : G.ROWS - 1 - t.row, mid = (G.COLS - 1) / 2; // nearer the enemy: smaller
          const best = exitSpots(m, side, rec).filter(t => !G.isFlank(side, t.col, t.row)).sort((a, b) => fwd(a) - fwd(b) || Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.col - b.col)[0];
          if (best && G.mpbBuy(m, side, rec.key, 'shaft')) G.mpbAct(m, side, rec.key, 'exit', best.col, best.row);
        }
      },
      info(m, side, rec) {
        const x = exitOf(rec);
        return [x ? `Exit at column ${x.col + 1}, row ${x.row + 1}` : 'No exit yet', skillN(rec, 'shaft') ? (rec.data.moved ? 'The exit has been moved' : 'The exit can be moved once') : '', skillN(rec, 'air') ? 'Fresh air' : ''].filter(Boolean);
      },
    },
  });

  // ===== scorch =====
  def({ id: 'scorch', name: 'Scorch turrets', short: 'sc', kind: 'defensive', hp: 450, armor: 2, color: '#D9622B',
    text: 'One Ember Imp turret per player: Spitfire burn, +10 m range, sees stealth. Not a unit.',
    downside: 'A turret destroyed doesn’t fight the next round.', place: { where: 'own', spacing: true }, skills: [], hooks: {} });

  // ===== oak =====
  // An old oak (group B2). Restoration: while it stands in a fight, every heal and regen on its team's bodies is
  // ×(1 + OAK.restore %) (Engine opts.mpb.oak; the Oak's body carries b.oakRestore), ×(1 + OAK.boosted %) the round
  // Double restoration was bought. Heal (50, once a round each): +OAK.heal Team HP, added before the round's fight
  // takes its damage (hooks.teamHp), never above the team's starting health. Sticky moss (200, once a match): every
  // tile within OAK.moss of the Oak is moss (mud tiles in opts.tiles): the opponents' bodies on it move OAK.slow %
  // slower (the strongest slow counts; Berserkers can't be slowed). Downside: the round after it was destroyed, a
  // 1-body level 3 Ent with all its skills fights for the opponents, in front of their tower (hooks.foeBodies).
  const OAK = { restore: 25, boosted: 50, heal: 5, moss: 3, slow: 30, ent: 'Ent', entLevel: 2, entJ: 9 }; // entLevel 2: the third level ("level 3")
  const oakClicks = (m, rec, id) => { const e = rec.skills[id]; return e && e.round === m.round ? e.log.length : 0; };
  const oakRestore = (m, rec) => 1 + (oakClicks(m, rec, 'boost') > 0 ? OAK.boosted : OAK.restore) / 100;
  const oakEntDue = (m, rec) => rec.fell > 0 && m.round === rec.fell + 1;
  // the moss: the tiles within OAK.moss of the Oak (on the board, its own tile too), once Sticky moss is bought
  function oakMossTiles(m, rec) {
    if (skillN(rec, 'moss') <= 0) return [];
    const { COLS, ROWS } = grid(m), out = [];
    for (let dr = -OAK.moss; dr <= OAK.moss; dr++) for (let dc = -OAK.moss; dc <= OAK.moss; dc++) {
      const col = rec.col + dc, row = rec.row + dr;
      if (col >= 0 && col < COLS && row >= 0 && row < ROWS) out.push({ col, row });
    }
    return out;
  }
  // the Ent the opponents get: one body, level 3, every skill of the unit (null when the roster has no Ent)
  function oakEntUnit(m) {
    const ui = (m.units || []).findIndex(u => u && u.name === OAK.ent);
    if (ui < 0) return null;
    const base = { ...m.units[ui], bodies: 1 }, defs = E.SLOTS.map(k => G.skillDef(m, ui, k)).filter(Boolean);
    return { ui, u: { ...(defs.length ? E.applySkills(base, defs, m.units) : E.withTraits(base)), bodies: 1 } };
  }
  def({ id: 'oak', name: 'The Oak', short: 'oak', kind: 'support', hp: 1200, armor: 3, color: '#7A5A36',
    text: `Restoration: while it stands in a fight, all healing and regeneration of your team is +${OAK.restore}% as effective. Can’t shoot.`,
    downside: 'The round after it was destroyed, a level 3 Ent with all its skills fights for the opponents.',
    skills: [
      { id: 'heal', name: 'Heal', cost: 50, per: 'roundPlayer', text: `+${OAK.heal} Team HP (before this round’s fight; never above your starting health).` },
      { id: 'boost', name: 'Double restoration', cost: 100, per: 'round', text: `Restoration is +${OAK.boosted}% instead of +${OAK.restore}% in this round’s fight.` },
      { id: 'moss', name: 'Sticky moss', cost: 200, per: 'match', text: `For good: moss on every tile within ${OAK.moss} tiles of the Oak. Enemies on it move ${OAK.slow}% slower (Berserkers can’t be slowed).` },
    ],
    hooks: {
      bodies(m, side, rec, ctx) {
        const out = ctx.main();
        for (const b of out) b.oakRestore = oakRestore(m, rec);
        return out;
      },
      battleOpts(m, side, rec, opts) {
        opts.mpb.oak = true; // Restoration (the Engine reads b.oakRestore of a standing Oak)
        const moss = oakMossTiles(m, rec);
        if (!moss.length) return;
        const h = G.TILE / 2;
        opts.tiles = (opts.tiles || []).concat(moss.map(t => { const w = G.tileToWorld(t.col, t.row); return { x0: w.x - h, x1: w.x + h, y0: w.y - h, y1: w.y + h, type: 'mud', side, slow: OAK.slow, oak: true }; }));
      },
      // Heal: +OAK.heal Team HP a click this round, before the fight's damage (Duo.fight -> Mpb.teamHeal)
      teamHp(lanes, side, rec, hp, round, sums) {
        const e = rec.skills.heal, n = e && e.round === round ? e.log.length : 0;
        if (!(n > 0 && hp[side] > 0)) return;
        const was = hp[side];
        hp[side] = Math.min(Math.max(was, TEAM_HP_CAP), was + OAK.heal * n);
        if (sums && hp[side] > was) news(sums, side, { kind: 'oak', healed: hp[side] - was, text: `${side === 0 ? 'Team A' : 'Team B'}’s Oak: +${hp[side] - was} Team HP.` });
      },
      // the downside: the round after the Oak fell, an Ent for the opponents (side: the team it fights for)
      foeBodies(m, side, rec, ctx) {
        if (!oakEntDue(m, rec)) return [];
        const e = oakEntUnit(m), t = (m.towers && m.towers[side]) || G.towerSpot(m, side);
        if (!e || !t) return [];
        const w = G.tileToWorld(t.col, t.row + (side === 0 ? -1 : 1));
        const out = E.buildSquad(e.u, side, w.x, w.y, ctx.xsq(OAK.entJ), G.TILE, ctx.idx, OAK.entLevel);
        const tier = G.tierOf(m.units, e.ui);
        for (const b of out) b.tier = tier;
        return out;
      },
      afterFight(lanes, side, rec, res, sums, round) {
        if (rec.fell === round) news(sums, side, { kind: 'oak', ent: true, text: `${side === 0 ? 'Team A' : 'Team B'}’s Oak was destroyed: next round a level 3 Ent fights for ${side === 0 ? 'Team B' : 'Team A'}.` });
      },
      info(m, side, rec) {
        const k = Math.round((oakRestore(m, rec) - 1) * 100), h = oakClicks(m, rec, 'heal');
        return [`Restoration +${k}%${k !== OAK.restore ? ' this round' : ''}`, h ? `+${h * OAK.heal} Team HP before this round’s fight` : '',
          skillN(rec, 'moss') > 0 ? `Sticky moss within ${OAK.moss} tiles` : '', oakEntDue(m, rec) ? 'Destroyed last round: an Ent fights for the opponents this round' : ''];
      },
      // a bot (Duo.botTurn): Heal when the team is hurt, the moss once it is rich, Double restoration now and then
      botAfter(m, side, rec) {
        const r = rng(((m.seed >>> 0) + m.round * 137 + laneOf(m) * 19 + 7) >>> 0), hp = (m.hp && m.hp[side]) || 0;
        if (hp > 0 && hp <= TEAM_HP_CAP - 40 && m.gold[side] >= 150 && r() < 0.6) mpbBuy(m, side, rec.key, 'heal');
        if (m.gold[side] >= 300 && r() < 0.5) mpbBuy(m, side, rec.key, 'moss');
        if (m.gold[side] >= 300 && r() < 0.25) mpbBuy(m, side, rec.key, 'boost');
      },
    },
  });

  // ===== factory =====
  // The Cog Builder's Factory (Game BUILDINGS 'factory', src/faction-units.json) as a team building: standing at once
  // (no builder, no site), not levelled. Each round either player may buy one of its units for the team (one a round
  // for this factory): the buyer pays, and the unit comes out in front of the factory FAC.skills' time into the fight,
  // marked as the buyer's (its lane), made by the very code that makes the Cog Builder's (Game.buildingMakes, with
  // the buyer's lane's match: Duo.battle's ctx.lanes; no builder skills, no blessing). Destroyed in a fight: like the
  // Cog Builder's it must be rebuilt, so it makes nothing the next round. A Cog Builder's own Factory in a lane works
  // beside it as before.
  const FAC = { hp: 1000, armor: 0, building: 'factory', noBuff: { aps: 0, shield: 0, armor: 0, faster: 0 } };
  const facResting = (m, rec) => !!rec && rec.fell > 0 && rec.fell === m.round - 1;
  // this round's buy: { id (the building's skill), lane (who paid) } or null
  const facNow = (m, rec) => { for (const id of ['fighter', 'gunner', 'cogmech']) { const log = thisRound(m, rec.skills[id]); if (log.length) return { id, lane: log[0].lane }; } return null; };
  def({ id: 'factory', name: 'Factory', short: 'fa', kind: 'economic', hp: FAC.hp, armor: FAC.armor, color: '#B07A3C',
    text: 'The Cog Builder’s Factory as a team building, built at once. Each round either of you can buy one of its units for the team; whoever buys pays, and it fights for your team.',
    downside: 'Destroyed in a fight: it is rebuilt, so it makes nothing the next round.',
    // the prices are the Cog Builder's Factory's (tools/tests/mpb-b5.js checks them against the building's data)
    skills: [
      { id: 'fighter', name: 'Cogbot Fighter', cost: 100, per: 'round', text: 'A tough melee bot (1500 health, 4 armor, a 2-hit shield) walks out 2 s into the fight.' },
      { id: 'gunner', name: 'Cogbot Machinegunner', cost: 100, per: 'round', text: 'A long-range gunner that spins up its fire walks out 2 s into the fight.' },
      { id: 'cogmech', name: 'CogMech', cost: 300, per: 'round', text: 'A walking mech with two turrets (2000 health, 4 armor, splash) walks out 4 s into the fight.' },
    ],
    hooks: {
      // one unit a round for the team (a take-back frees it), none the round after it was destroyed
      canBuy: (m, side, rec, sk) => !facResting(m, rec) && !facNow(m, rec) && !!G.buildingSkillInfo(FAC.building, sk.id),
      bodies(m, side, rec, ctx) {
        const out = ctx.main(), b = out[0], now = facNow(m, rec), info = G.buildingInfo(FAC.building);
        if (b && now && info) {
          const pr = G.buildingMakes((ctx.lanes && ctx.lanes[now.lane]) || m, side, info, G.buildingSkillInfo(FAC.building, now.id), 0, FAC.noBuff, null);
          if (pr) b.produce = { ...pr, lane: now.lane }; // (Engine: lane marks whose it is)
        }
        return out;
      },
      info(m, side, rec) {
        const now = facNow(m, rec);
        return [facResting(m, rec) ? 'Being rebuilt this round: it makes nothing.' : now ? `This round: ${(skillOf('factory', now.id) || {}).name}` : 'Nothing bought this round', 'One unit a round for your team.'];
      },
      // a bot buys one of its units most rounds when it has gold to spare
      bot(m, side, rec, r) {
        if (r() >= 0.6) return;
        const ok = KINDS.factory.skills.filter(sk => m.gold[side] - skillCost(m, side, rec.key, sk.id) >= 150 && canBuy(m, side, rec.key, sk.id));
        if (ok.length) mpbBuy(m, side, rec.key, ok[Math.floor(r() * ok.length)].id);
      },
    },
  });

  // ===== magicLake =====
  // Terrain, not a building: each player of the team puts down LAKE.tiles water tiles (their own, no vote: Game.mpbAct
  // 'place') anywhere on the team's own zone or in no man's land (flank tiles too), never on a squad or building (as
  // the player sees the board: the opponents' squads of this round don't count, so a refusal gives nothing away), and
  // never so that some tile can no longer be walked to (lakeFree: the board's walkable tiles stay one area). As the
  // fight starts (hooks.settle) a tile not put down yet, or one put down this round on a squad or building the player
  // couldn't see, goes on the first tile allowed with everything known. Water is the
  // game's water (Game.terrainBlocks, via Mpb.terrainAt; the Engine's terrain): shot over, not walked on, nobody can
  // be deployed on it; it can't be destroyed. Each tile is a record of its own (rec.data.lane: whose), so its skills
  // are its own. Waterspirits allowal: the team walks on that tile LAKE.slow % slower and regains LAKE.regen % health
  // a second on it (Engine opts.mpb.lakeWalk, 'wade' and 'mpbLake' tiles). Become Water elemental: each fight a Water
  // Elemental (the Water Mage's Summon water elemental, as a level LAKE.mageLevel + 1 Water Mage summons it) rises
  // from the tile for the team; the tile stays water.
  const LAKE = { tiles: 2, slow: 30, regen: 5, spiritsCost: 50, elementalCost: 200, mageLevel: 1 };
  const LAKE_ELEMENTAL = { type: 'elemental', params: { hp: 600, unit: 'Ember Imps', level: 1, ahead: 9, pool: 4, pct: 50, speed: 0.5, secs: 2 } }; // (a roster with no Water Mage)
  const lakeRecs = (m, side) => recs(m, side).filter(r => r.kind === 'magicLake');
  // the board's walkable tiles (no walls or water) still one area (4 ways round) with (col, row) water too
  let lakeWet = null; // (lakeSpots: the board's water, worked out once for all its tiles)
  function lakeFree(m, col, row) {
    const { COLS, ROWS } = grid(m), N = COLS * ROWS, base = lakeWet || Uint8Array.from({ length: N }, (_, i) => G.terrainBlocks(m, i % COLS, Math.floor(i / COLS)) ? 1 : 0);
    // all 8 tiles round it on the board and dry: the ways round it stay open (a ring of 8 is one area)
    let ring = true;
    for (let dr = -1; dr <= 1 && ring; dr++) for (let dc = -1; dc <= 1; dc++) { const c = col + dc, r = row + dr; if ((dc || dr) && (!inBoard(c, r) || base[r * COLS + c])) { ring = false; break; } }
    if (ring) return true;
    const wet = Uint8Array.from(base);
    wet[row * COLS + col] = 1;
    let open = 0, start = -1;
    for (let i = 0; i < N; i++) if (!wet[i]) { open++; if (start < 0) start = i; }
    if (start < 0) return false;
    const seen = new Uint8Array(N), stack = [start];
    seen[start] = 1;
    let n = 0;
    while (stack.length) {
      const i = stack.pop(), c = i % COLS, r = (i - c) / COLS;
      n++;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c2 = c + dc, r2 = r + dr, j = r2 * COLS + c2;
        if (c2 < 0 || r2 < 0 || c2 >= COLS || r2 >= ROWS || wet[j] || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    return n === open;
  }
  // the team's own zone or no man's land, any column
  const lakeWhere = (side, col, row) => inBoard(col, row) && (G.inZone(side, row) || G.inNoMans(row));
  // may this player put lake tile rec on (col, row)? (their own tile, not down yet or put down this round.) strict: with
  // the squads the player can't see too (the fight's start, hooks.settle)
  function lakeOk(m, side, rec, col, row, strict) {
    if (!on(m) || !rec || rec.kind !== 'magicLake' || rec.data.lane !== laneOf(m) || !(rec.col < 0 || rec.round === m.round)) return false;
    if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
    grid(m);
    if (!lakeWhere(side, col, row)) return false;
    const was = { col: rec.col, row: rec.row };
    rec.col = -1; rec.row = -1; // (a tile being moved: its old tile is dry for the check)
    try { return !G.terrainBlocks(m, col, row) && !(strict ? taken : seenTaken)(m, side, col, row) && lakeFree(m, col, row); } finally { rec.col = was.col; rec.row = was.row; }
  }
  // where lake tile rec may go, best first: no man's land on the team's own half (the rows nearest its zone first),
  // then the rest of no man's land, then the zone (its front first); each player toward the columns of their own half
  function lakeSpots(m, side, rec, strict) {
    const out = [];
    if (!on(m) || !rec) return out;
    const { COLS, ROWS } = grid(m), was = { col: rec.col, row: rec.row };
    rec.col = -1; rec.row = -1;
    try {
      lakeWet = Uint8Array.from({ length: COLS * ROWS }, (_, i) => G.terrainBlocks(m, i % COLS, Math.floor(i / COLS)) ? 1 : 0);
      rec.col = was.col; rec.row = was.row;
      for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (lakeOk(m, side, rec, col, row, strict)) out.push({ col, row });
    } finally { lakeWet = null; rec.col = was.col; rec.row = was.row; }
    const half = (rec.data.lane === 1 ? 3 : 1) * COLS / 4 - 0.5, own = (r) => side === 0 ? r >= ROWS / 2 : r < ROWS / 2;
    const band = (t) => G.inNoMans(t.row) ? (own(t.row) ? 0 : 1) : 2, back = (t) => side === 0 ? ROWS - 1 - t.row : t.row;
    return out.sort((a, b) => band(a) - band(b) || (band(a) === 1 ? back(b) - back(a) : back(a) - back(b)) || Math.abs(a.col - half) - Math.abs(b.col - half) || a.col - b.col);
  }
  // this player's lake tiles still to put down
  const lakeTodo = (m, side, lane) => lakeRecs(m, side).filter(r => r.col < 0 && r.data.lane === lane);
  // the Water Elemental a lake tile becomes: the roster's Water Mage's Summon water elemental, as fast as she is (its
  // bodies are made at level LAKE.mageLevel, 0 = as bought: as a Water Mage of that level summons it)
  function lakeElemental(m) {
    const wm = (m.units || []).find(u => u && u.name === 'Water Mage');
    const d = (wm && (wm.skillDefs || []).find(x => x && x.type === 'elemental')) || LAKE_ELEMENTAL;
    const src = wm || { name: 'Water Mage', cost: 0, bodies: 1, hp: 600, hit: 50, aps: 0.9, range: 22, speed: 2.1, splash: 3.5 };
    const el = E.applySkills({ ...src, level: 0 }, [d], m.units || []).elemental;
    if (!el) return null;
    return { ...el.unit, speed: src.speed, mpb: 'magicLake', mpbSkin: 'walker' };
  }
  const lakeSkin = (rec) => { const s = skillN(rec, 'spirits') > 0, e = skillN(rec, 'elemental') > 0; return s && e ? 'both' : s ? 'spirits' : e ? 'elemental' : ''; };
  def({ id: 'magicLake', name: 'Magic lake', short: 'ml', kind: 'technical', hp: 0, armor: 0, color: '#3E8FC4',
    text: `Each of you puts down ${LAKE.tiles} water tiles on your zone or in no man’s land: shot over, never walked on, nobody deploys on them. Water never shuts a tile or a way off.`,
    downside: '', place: { where: 'board', spacing: false, terrain: true },
    skills: [
      { id: 'spirits', name: 'Waterspirits allowal', cost: LAKE.spiritsCost, per: 'building', text: `Your units can walk through this tile, ${LAKE.slow}% slower, and regain ${LAKE.regen}% health a second while on it.` },
      { id: 'elemental', name: 'Become Water elemental', cost: LAKE.elementalCost, per: 'building', text: 'Every fight a Water Elemental rises from this tile and fights for your team (the Water Mage’s Summon water elemental). The tile stays water.' },
    ],
    LAKE, lakeOk, lakeSpots, lakeFree, lakeTodo, lakeElemental,
    hooks: {
      // the card: each player gets LAKE.tiles tiles to put down (col -1 until then)
      acquire(m, team) { for (const L of [0, 1]) for (let k = 0; k < LAKE.tiles; k++) addRec(m, team, 'magicLake', -1, -1).data.lane = L; },
      // a lake that came by a placement vote: that tile is the voter's, the rest are still to put down
      placed(m, side, rec) {
        if (rec.col < 0 || rec.data.lane != null) return;
        rec.data.lane = laneOf(m);
        for (const L of [0, 1]) for (let k = lakeRecs(m, side).filter(r => r.data.lane === L).length; k < LAKE.tiles; k++) addRec(m, side, 'magicLake', -1, -1).data.lane = L;
      },
      spotOk: (m, side, part, col, row) => lakeFree(m, col, row), // (a lake by a placement vote, never in a real match)
      // (for the boards: its look shows its skills)
      unit: (m, side, rec) => E.withTraits({ name: 'Magic lake', cost: 0, bodies: 1, hp: 1, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, shape: 'square', color: '#3E8FC4',
        structure: true, lesser: true, kind: 'mpb', mpb: 'magicLake', level: 0, ...(lakeSkin(rec) ? { mpbSkin: lakeSkin(rec) } : {}) }),
      canBuy: (m, side, rec) => rec.col >= 0,
      canAct: (m, side, rec, action, args) => action === 'place' && lakeOk(m, side, rec, args[0], args[1]),
      act(m, side, rec, action, args) { rec.col = args[0]; rec.row = args[1]; rec.round = m.round; return true; },
      // as the fight starts: a tile nobody put down, or one put down this round on an opponent's squad (or building) its
      // player couldn't see (either lane), goes on the first tile its player could have put it, everything known
      settle(lanes, side, rec) {
        const m = lanes[0];
        if (rec.col >= 0 && !(rec.round === m.round && lanes.some(L => G.squadAt(L, 1 - side, rec.col, rec.row) || G.buildingAt(L, 1 - side, rec.col, rec.row)))) return;
        const was = m.duoLane;
        m.duoLane = rec.data.lane;
        const t = lakeSpots(m, side, rec, true)[0];
        m.duoLane = was;
        if (t) { rec.col = t.col; rec.row = t.row; rec.round = m.round; }
      },
      // each fight: the Water Elemental of a tile that became one
      bodies(m, side, rec, ctx) {
        if (rec.col < 0 || !(skillN(rec, 'elemental') > 0)) return [];
        const u = lakeElemental(m);
        if (!u) return [];
        const w = G.tileToWorld(rec.col, rec.row), out = E.buildSquad(u, side, w.x, w.y, ctx.xsq(0), G.TILE, ctx.idx + 1, LAKE.mageLevel);
        for (const b of out) b.tier = 1; // a summon (for the artifacts)
        return out;
      },
      // the water in the fight, once for both teams: the Engine's terrain, and each team's Waterspirits tiles
      battleOpts(m, side, rec, opts) {
        if (opts.mpb.lake) return;
        opts.mpb.lake = true;
        const all = [0, 1].flatMap(sd => lakeRecs(m, sd).filter(r => r.col >= 0).map(r => ({ sd, r })));
        if (!all.length) return;
        const { COLS, ROWS } = grid(m), k = G.TERRAIN.sub, cols = COLS * k, rows = ROWS * k, base = opts.terrain, T2 = G.TILE / 2, n = cols * rows;
        const ter = { cols, rows, cell: G.TILE / k, x0: -COLS * G.TILE / 2, y1: ROWS * G.TILE / 2,
          block: base ? Uint8Array.from(base.block) : new Uint8Array(n), sight: base ? Uint8Array.from(base.sight) : new Uint8Array(n), level: base ? Int8Array.from(base.level) : new Int8Array(n) };
        const walk = [[], []], tiles = [];
        for (const { sd, r } of all) {
          const cells = [];
          for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) cells.push((r.row * k + j) * cols + r.col * k + i);
          for (const c of cells) ter.block[c] = 1;
          if (!(skillN(r, 'spirits') > 0)) continue;
          walk[sd].push(...cells);
          const w = G.tileToWorld(r.col, r.row), box = { x0: w.x - T2, x1: w.x + T2, y0: w.y - T2, y1: w.y + T2 };
          tiles.push({ type: 'wade', slow: LAKE.slow, ...box }, { type: 'mpbLake', side: sd, pct: LAKE.regen, ...box });
        }
        opts.terrain = ter;
        if (walk[0].length || walk[1].length) opts.mpb.lakeWalk = walk;
        if (tiles.length) opts.tiles = (opts.tiles || []).concat(tiles);
      },
      // bots: they put their tiles down at once, and now and then buy a tile's skill
      botAfter(m, side, rec, r) {
        if (rec.data.lane !== laneOf(m)) return;
        if (rec.col < 0) { const t = lakeSpots(m, side, rec)[0]; if (t) G.mpbAct(m, side, rec.key, 'place', t.col, t.row); }
        if (rec.col < 0) return;
        const spare = () => m.gold[side] - G.CARRY_CAP / 2;
        if (!skillN(rec, 'spirits') && spare() >= LAKE.spiritsCost && r() < 0.3) G.mpbBuy(m, side, rec.key, 'spirits');
        if (!skillN(rec, 'elemental') && spare() >= LAKE.elementalCost && r() < 0.2) G.mpbBuy(m, side, rec.key, 'elemental');
      },
      info(m, side, rec) {
        return [rec.col < 0 ? 'Not put down yet' : 'Water: shot over, never walked on',
          skillN(rec, 'spirits') ? `Waterspirits: the team walks it ${LAKE.slow}% slower and regains ${LAKE.regen}% health a second on it` : '',
          skillN(rec, 'elemental') ? 'A Water Elemental rises from it every fight' : ''].filter(Boolean);
      },
    },
  });

  // ===== jail =====
  def({ id: 'jail', name: 'Jail', short: 'j', kind: 'defensive', hp: 1500, armor: 8, color: '#5E6168',
    text: 'Skywatch: stealthed enemies within 3 tiles are revealed.', downside: 'Destroyed: no jail next round, jailed squads go free, and their unit types can’t be jailed again this match.', skills: [], hooks: {} });

  // ===== school =====
  def({ id: 'school', name: 'School', short: 'sch', kind: 'support', hp: 700, armor: 2, color: '#A8443A',
    text: 'Holds 1 allied squad, which doesn’t fight. Free Study: +1 level’s XP each round.',
    downside: 'Destroyed: the bodies that destroyed it get half a level of XP; the squad inside loses what it gained inside.', skills: [], hooks: {} });

  // ===== shadowDen =====
  // Technical. While a team has its Den:
  //  - Rogues, Assassins and Shadowhands (DEN.units) placed this round on a flank tile (an Assassin also in the enemy's
  //    zone) don't stand still the flank delay in their first fight (squadBodies);
  //  - Shadowhands: a unit of the 2v2 set (extraUnits, added by Duo.unitSet; u.mpbUnit) only a team with a Den has in
  //    its shop (Game.isOff -> unitOff): the Rogue at half health and hit, 1 body, tier 1 (100 gold), no unlock, the
  //    Rogue's Stealth and Forward planting built in (it may go in no man's land), its own look (mpb 'shadowDen', skin 'hand');
  //  - each player has DEN.tokens Shadow deployment a round on top of their own, only for those three units
  //    (Game.deploysLeft -> shadowBonus).
  // Skills: Impersonate (per player): an enemy tier 1-2 squad the buyer can see; DEN.impAt s into the fight one of its
  //   bodies leaves and a Shadowhand of the buyer's team stands in its place (Engine opts.mpb.shadowImpersonate).
  //   Sabotage (team): an enemy unit type they can't deploy next round (Game.place -> sabotaged; their shop shows a red X).
  //   Insider information (team): next round this team sees the opponents' squads live (Game.foeSeen / teamSeen ->
  //   watching, so Referee.hide shows them where they stand; their gold, buys and levels stay hidden) and the opponents'
  //   deploy clock is DEN.cut ms shorter (Duo.cutFor: at most down to 5 s); they see "You are being watched". Bought in
  //   a round whose fight destroys the Den: the opponents get it, free, instead.
  // Downside: destroyed: the team's Shadowhands squads are removed (nothing back) and no Den skills the next round.
  // rec.data: imp [{ round, lane (buyer), tl (target's lane), id (its id there), u (its unit type) }], sab [{ round
  //   (bought in), ui, lane }] (this round's buy and the one in force, kept apart), insider { round, lane },
  //   watch { round (the round it works in), by (the side that watches), free }
  const DEN = { hp: 800, armor: 2, units: ['Rogue', 'Assassin', 'Shadowhands'], hands: 'Shadowhands', from: 'Rogue', half: 0.5, cost: 1, tokens: 1,
    impersonate: 200, impAt: 5, impTier: 2, sabotage: 100, insider: 350, cut: 15000, color: '#8E7CC3' };
  const LANE_OFF = 1000000; // = Duo.OFF: lane 1's squad ids in a fight (and the other lane's in m.team) are moved by this
  const denOf = (m, side) => recs(m, side).find(r => r.kind === 'shadowDen') || null;
  const denUnit = (m, ui) => !!(m && m.units && m.units[ui] && DEN.units.includes(m.units[ui].name));
  const handsIdx = (m) => (m && m.units ? m.units.findIndex(u => u && u.mpbUnit === 'shadowDen') : -1);
  const isHands = (m, ui) => !!(m && m.units && m.units[ui] && m.units[ui].mpbUnit === 'shadowDen');
  // no Den skills the round after it was destroyed
  const denResting = (m, rec) => !!rec && rec.fell > 0 && rec.fell === m.round - 1;
  // Game.deploysLeft: the Shadow deployment. ui: a Den unit about to be placed may use it; any other placement may use
  // only what Den units already took (so the player's own deployments are never more than before)
  function shadowBonus(m, side, ui) {
    if (!on(m) || !denOf(m, side)) return 0;
    const used = m.armies[side].filter(s => s.round === m.round && !s.free && !s.gift && denUnit(m, s.unit)).length;
    return ui != null && denUnit(m, ui) ? DEN.tokens : Math.min(used, DEN.tokens);
  }
  // Game.mpbLocked: side may not deploy unit type ui this round (the other team sabotaged it last round)
  const sabList = (rec) => (rec && Array.isArray(rec.data.sab) ? rec.data.sab : []);
  const sabNow = (m, rec) => sabList(rec).find(x => x.round === m.round) || null;      // bought this round (works next round)
  const sabLive = (m, rec) => sabList(rec).find(x => x.round === m.round - 1) || null; // bought last round: in force now
  const sabotaged = (m, side, ui) => on(m) && recs(m, 1 - side).some(r => r.kind === 'shadowDen' && (sabLive(m, r) || {}).ui === ui);
  // side sees the other team's deployment live this round (Insider information; either Den may hold it)
  const watching = (m, side) => on(m) && [0, 1].some(sd => recs(m, sd).some(r => r.kind === 'shadowDen' && r.data.watch && r.data.watch.round === m.round && r.data.watch.by === side));
  const deployCut = (m, side) => watching(m, 1 - side) ? DEN.cut : 0; // ms off side's deploy clock (Duo)
  // the enemy squads a player of side may impersonate: tier 1-2 squads they can see, in their own lane (who 0) or the
  // other one (who 1, m.team; id: that lane's own id). As foeSeen, a squad sold this round still shows (m.team.sold,
  // Duo.teamOf: the server's other lane has it there, the page's hidden view in its armies), unless they are watched live
  const teamSold = (m, side) => (watching(m, 1 - side) ? [] : ((m.team && m.team.sold && m.team.sold[side]) || []).filter(q => q.soldRound === m.round && q.round < m.round && !G.hiddenFromFoe(m, q)));
  const impTier = (m, ui) => !!(m.units[ui] && !m.units[ui].building && G.tierOf(m.units, ui) <= DEN.impTier);
  function impTargets(m, side) {
    const ok = (q) => !G.isRider(q) && impTier(m, q.unit);
    return G.foeSeen(m, 1 - side).filter(ok).map(q => ({ who: 0, id: q.id, sq: q }))
      .concat(G.teamSeen(m, 1 - side).concat(teamSold(m, 1 - side)).filter(ok).map(q => ({ who: 1, id: q.id >= LANE_OFF ? q.id - LANE_OFF : q.id, sq: q })));
  }
  // the target's squad wherever it stands (also sold or riding): its unit type is kept with the buy, so a squad id
  // used again after their Undo all (a live target while watching) is no target
  function impFind(m, side, who, id) {
    const f = 1 - side, mine = who === 0, tid = mine ? id : id + LANE_OFF;
    const list = mine ? m.armies[f].concat(G.soldNow(m, f)) : ((m.team && m.team.armies && m.team.armies[f]) || []).concat((m.team && m.team.sold && m.team.sold[f]) || []);
    return list.find(q => q.id === tid) || null;
  }
  const impNow = (m, rec) => (rec.data.imp || []).filter(x => x.round === m.round);
  const sabOk = (m, ui) => Number.isInteger(ui) && ui >= 0 && ui < m.units.length && !m.units[ui].building && !(Array.isArray(m.off) && m.off.includes(ui));
  def({ id: 'shadowDen', name: 'Shadow Den', short: 'sd', kind: 'technical', hp: DEN.hp, armor: DEN.armor, color: '#3B3350',
    text: `Rogues, Assassins and Shadowhands: no flank delay, and ${DEN.tokens} extra Shadow deployment a round for each of you, only for them. Recruit Shadowhands in the shop (tier 1, ${DEN.cost * 100} gold): a Rogue at half strength, 1 body, may go in no man’s land.`,
    downside: 'Destroyed: your Shadowhands are lost, and no Den skills the next round.',
    skills: [
      { id: 'impersonate', name: 'Impersonate', cost: DEN.impersonate, per: 'roundPlayer', text: `Pick an enemy tier 1 or 2 squad you can see: ${DEN.impAt} s into the fight one of its bodies becomes a Shadowhand of yours.` },
      { id: 'sabotage', name: 'Sabotage', cost: DEN.sabotage, per: 'round', text: 'Pick a unit type: the other team can’t deploy it next round (a big red X on their card).' },
      { id: 'insider', name: 'Insider information', cost: DEN.insider, per: 'round', text: `Next round your team sees their deployment live and their deploy clock is ${DEN.cut / 1000} s shorter; they see “You are being watched”. If your Den is destroyed in this round’s fight, they get it for free instead.` },
    ],
    // the Shadowhands unit, made from the set's Rogue (Duo.unitSet)
    extraUnits(units) {
      const r = units.find(u => u && u.name === DEN.from);
      if (!r) return [];
      const sk = Array.isArray(r.skills) ? r.skills : [], mods = Array.isArray(r.skillMods) ? r.skillMods : [];
      return [{ ...r, name: DEN.hands, cost: DEN.cost, unlock: 0, bodies: 1, hp: r.hp * DEN.half, hit: r.hit * DEN.half, shape: 'knife', color: DEN.color,
        skills: ['stealth', 'forward', sk[2] || null], skillsInnate: [true, true, false], skillMods: [null, null, mods[2] || null],
        mpbUnit: 'shadowDen', mpb: 'shadowDen', mpbSkin: 'hand', noPack: true }]; // (noPack: never in a starting package)
    },
    hooks: {
      canBuy(m, side, rec, sk, args) {
        if (denResting(m, rec)) return false;
        if (sk.id === 'impersonate') {
          const [who, id] = args;
          if (!((who === 0 || who === 1) && Number.isInteger(id) && handsIdx(m) >= 0)) return false;
          // Duo.rebuildTeam replays the teammate's buy (m.mpbReplay): it was checked when bought, and the target may
          // have been sold or taken back since (the buy stands, as their gold stays paid)
          return !!m.mpbReplay || impTargets(m, side).some(t => t.who === who && t.id === id);
        }
        if (sk.id === 'sabotage') return sabOk(m, args[0]);
        return true;
      },
      bought(m, side, rec, sk, args, lane) {
        if (sk.id === 'impersonate') { const q = impFind(m, side, args[0], args[1]); rec.data.imp = impNow(m, rec).concat({ round: m.round, lane, tl: args[0] === 0 ? lane : 1 - lane, id: args[1], u: q ? q.unit : null }); }
        if (sk.id === 'sabotage') rec.data.sab = sabList(rec).filter(x => x.round !== m.round).concat({ round: m.round, ui: args[0], lane }); // (last round's, in force now, stays)
        if (sk.id === 'insider') rec.data.insider = { round: m.round, lane };
      },
      unbuy(m, side, rec, sk, lane) {
        if (sk.id === 'impersonate') rec.data.imp = impNow(m, rec).filter(x => x.lane !== lane);
        if (sk.id === 'sabotage') rec.data.sab = sabList(rec).filter(x => x.round !== m.round);
        if (sk.id === 'insider' && rec.data.insider && rec.data.insider.round === m.round) delete rec.data.insider;
      },
      // no flank delay for its units (an Assassin in the enemy's zone neither), as Game.bodiesFor sets it
      squadBodies(m, side, rec, sq, list) {
        if (!denUnit(m, sq.unit) || !(sq.round === m.round || sq.movedRound === m.round)) return;
        if (G.isFlank(side, sq.col, sq.row) || (G.anywhere(m, sq.unit) && (G.inZone(1 - side, sq.row) || G.isFlank(1 - side, sq.col, sq.row)))) for (const b of list) b.delay = 0;
      },
      // Impersonate: what the Engine needs for this round's targets (fight ids: lane 1's moved by LANE_OFF). lanes (Duo.battle):
      // the target must still be that squad (its unit type, tier 1-2) in its lane; the Shadowhand is the buyer's own
      // (their lane's Shadowhands skills)
      battleOpts(m, side, rec, opts, lanes) {
        const list = impNow(m, rec), hi = handsIdx(m), k = recs(m, side).indexOf(rec);
        if (!list.length || hi < 0) return;
        const ls = lanes || [m];
        const out = list.map((x, j) => {
          const L = ls[x.tl], q = L && L.armies[1 - side].find(s => s.id === x.id);
          if (L && !(q && q.unit === x.u && impTier(L, q.unit))) return null;
          return { side, squad: x.tl === 0 ? x.id : x.id + LANE_OFF, at: DEN.impAt, unit: E.leveled(G.unitFor(ls[x.lane] || m, side, hi), 0), sq: extraOf(k, j), lane: x.lane };
        }).filter(Boolean);
        if (out.length) opts.mpb.shadowImpersonate = (opts.mpb.shadowImpersonate || []).concat(out);
      },
      afterFight(lanes, side, rec, res, sums, round) {
        const m = lanes[0], fell = rec.fell === round, k = recs(m, side).indexOf(rec); // (m.round is the next round already)
        const made = (rec.data.imp || []).filter(x => x.round === round).filter((x, j) => res.squads && res.squads[side + ':' + extraOf(k, j)]).length;
        if (made) news(sums, side, { kind: 'shadowDen', imp: made, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den: ${made} enemy bod${made > 1 ? 'ies' : 'y'} turned into Shadowhands.` });
        const ins = rec.data.insider;
        if (ins && ins.round === round) {
          rec.data.watch = { round: round + 1, by: fell ? 1 - side : side, free: fell };
          delete rec.data.insider;
          if (fell) news(sums, side, { kind: 'shadowDen', flip: true, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den fell while its Insider information was on: the other team gets it for free next round.` });
        }
        if (!fell) return;
        let lost = 0;
        for (const L of lanes) { const before = L.armies[side].length; L.armies[side] = L.armies[side].filter(q => !isHands(L, q.unit)); lost += before - L.armies[side].length; }
        news(sums, side, { kind: 'shadowDen', lost, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den was destroyed: ${lost ? `${lost} Shadowhands squad${lost > 1 ? 's' : ''} lost, ` : ''}no Den skills next round.` });
      },
      // old buys are done with: a lock only lasts the round after it was bought, a watch only its own round
      roundStart(lanes, side, rec) {
        const m = lanes[0], d = rec.data;
        if (d.imp) d.imp = d.imp.filter(x => x.round === m.round);
        if (d.sab) d.sab = sabList(rec).filter(x => x.round >= m.round - 1);
        if (d.insider && d.insider.round < m.round) delete d.insider;
        if (d.watch && d.watch.round < m.round) delete d.watch;
      },
      // the opponents don't see this round's targets, sabotage or Insider information until the fight
      hide(s, h, rec) {
        const d = rec.data;
        if (d.imp) d.imp = d.imp.filter(x => x.round !== s.round);
        if (d.sab) d.sab = sabList(rec).filter(x => x.round !== s.round); // (the one in force since the round began shows)
        if (d.insider && d.insider.round === s.round) delete d.insider;
      },
      // viewer: the side reading the sheet (the owners by default)
      info(m, side, rec, viewer = side) {
        const out = [], ours = viewer === side, live = sabLive(m, rec);
        if (denResting(m, rec)) out.push(ours ? 'Destroyed last round: no Den skills this round.' : 'Destroyed last round: no Den skills for them this round.');
        if (live) out.push(`Sabotage: ${ours ? 'their' : 'your'} ${(m.units[live.ui] || {}).name || 'unit'} can’t be deployed this round.`);
        for (const sd of [side, 1 - side]) if (watching(m, sd)) out.push(sd === viewer ? 'Insider information: you see their deployment live.' : 'Insider information: they see your deployment live.');
        return out;
      },
      // a bot now and then: impersonates a squad, sabotages a unit type they field, buys Insider information
      bot(m, side, rec, r) {
        const spare = (c) => m.gold[side] - c >= 150;
        if (r() < 0.3 && spare(DEN.impersonate)) { const t = impTargets(m, side); if (t.length) { const x = t[Math.floor(r() * t.length)]; mpbBuy(m, side, rec.key, 'impersonate', x.who, x.id); } }
        if (r() < 0.25 && spare(DEN.sabotage)) {
          const types = [...new Set(G.foeSeen(m, 1 - side).concat(G.teamSeen(m, 1 - side)).map(q => q.unit))].filter(ui => sabOk(m, ui)).sort((a, b) => a - b);
          if (types.length) mpbBuy(m, side, rec.key, 'sabotage', types[Math.floor(r() * types.length)]); // (the lock in force from last round's stays)
        }
        if (r() < 0.15 && spare(DEN.insider + 50)) mpbBuy(m, side, rec.key, 'insider');
      },
    },
  });

  // =====================================================================
  // Records
  // =====================================================================
  const kindOf = (id) => KINDS[id] || null;
  const recs = (m, side) => (m && m.mpb && m.mpb[side]) || [];
  const recOf = (m, side, key) => recs(m, side).find(r => r.key === key) || null;
  const has = (m, side, kindId) => recs(m, side).some(r => r.kind === kindId) || voteQueue(m, side).some(e => e.kind === kindId && !e.part);
  const skillOf = (kindId, id) => ((kindOf(kindId) || {}).skills || []).find(s => s.id === id) || null;
  const skillN = (rec, id) => (rec && rec.skills[id] ? rec.skills[id].n : 0);
  const thisRound = (m, e) => (e && e.round === m.round ? e.log : []);
  // a new building of kind on a tile (the caller checked the tile)
  function addRec(m, side, kindId, col, row) {
    if (!m.mpb) m.mpb = [[], []];
    const K = kindOf(kindId), list = m.mpb[side];
    const rec = { key: K.short + (list.length + 1), kind: kindId, col, row, parts: {}, round: m.round, fell: 0, skills: {}, data: {} };
    list.push(rec);
    if (K.hooks.placed) K.hooks.placed(m, side, rec);
    return rec;
  }
  // every tile a building takes, with its part ('' for the building itself; none while it isn't placed yet: col < 0,
  // the Magic lake's tiles before their player puts them down)
  const tilesOf = (rec) => (rec.col >= 0 ? [{ col: rec.col, row: rec.row, part: '' }] : []).concat(Object.entries(rec.parts || {}).map(([p, t]) => ({ col: t.col, row: t.row, part: p })));
  // the building (and part) on a tile, either side: { side, rec, part } or null
  function recAt(m, col, row) {
    for (const side of [0, 1]) for (const rec of recs(m, side)) for (const t of tilesOf(rec)) if (t.col === col && t.row === row) return { side, rec, part: t.part };
    return null;
  }
  // Game.mpbAt: a tile no squad of either team may take (a kind's place.open leaves its tiles free, for its own rules;
  // place.terrain: terrain, see terrainAt), or one a kind's hooks.blocks(m, side, rec, col, row) keeps free (the tiles
  // round a Coal mine's exit)
  // (only: building tiles alone, not the tiles a kind keeps free: Game.bldgSeen, the Assassin's 'next to a building')
  function at(m, col, row, only) {
    const x = recAt(m, col, row);
    if (x) { const pl = (kindOf(x.rec.kind) || {}).place || {}; if (!pl.open && !pl.terrain) return true; }
    if (only) return false;
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.blocks && K.hooks.blocks(m, side, rec, col, row)) return true; }
    return false;
  }
  // Game.terrainBlocks: a tile of a kind that is terrain (place.terrain: the Magic lake's water), either team
  const terrainAt = (m, col, row) => on(m) && [0, 1].some(side => recs(m, side).some(rec => !!((kindOf(rec.kind) || {}).place || {}).terrain && tilesOf(rec).some(t => t.col === col && t.row === row)));

  // the starting state of a 2v2 lane: both Vaults, no votes (Duo.start, in both lanes)
  function init(m, lane) {
    m.duoLane = lane; m.duoTowers = true;
    m.mpb = [[], []]; m.mpbVote = [[], []];
    m.vault = [0, 1].map(() => ({ gold: 0, mode: null, moved: [0, 0], round: m.round, start: 0 }));
    for (const side of [0, 1]) addRec(m, side, 'vault', VAULT_SPOT[side].col, VAULT_SPOT[side].row);
    m.artifacts = null; m.draft = null;
  }

  // =====================================================================
  // Placement rules
  // =====================================================================
  const inBoard = (col, row) => col >= 0 && col < G.COLS && row >= 0 && row < G.ROWS;
  const flank = (col, row) => G.isFlank(0, col, row) || G.isFlank(1, col, row);
  const ownOk = (side, col, row) => inBoard(col, row) && G.inZone(side, row) && !G.reserved(side, col, row);
  const nmlOk = (col, row) => inBoard(col, row) && G.inNoMans(row) && !flank(col, row);
  // the tile and all 8 around it are the team's own zone and not the enemy's flank tiles
  const interior = (side, col, row) => { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (!ownOk(side, col + dc, row + dr)) return false; return true; };
  const WHERE = {
    interior,
    own: ownOk,
    nml: (side, col, row) => nmlOk(col, row),
    board: (side, col, row) => ownOk(side, col, row) || nmlOk(col, row),
    fixed: () => false,
  };
  // every building tile on the board (towers, MPBs and their parts, the Cog Builder's Factory, either team; walls aren't)
  function buildingTiles(m) {
    const out = [];
    for (const sd of [0, 1]) {
      const t = (m.towers && m.towers[sd]) || G.towerSpot(m, sd);
      if (t) out.push({ col: t.col, row: t.row });
      for (const r of recs(m, sd)) if (!((kindOf(r.kind) || {}).place || {}).terrain) out.push(...tilesOf(r)); // (terrain isn't a building)
      for (const b of G.buildingsOf(m, sd).concat(G.teamBuildings(m, sd))) out.push({ col: b.col, row: b.row });
    }
    return out;
  }
  const spaced = (m, col, row) => buildingTiles(m).every(t => Math.max(Math.abs(t.col - col), Math.abs(t.row - row)) >= SPACING);
  // no squad (either team, either lane), tower, building or MPB on it
  const taken = (m, side, col, row) => G.occupied(m, side, col, row) || G.occupied(m, 1 - side, col, row) || G.enemyHolds(m, side, col, row) || !!recAt(m, col, row);
  // the same, as team `side`'s player sees the board while deploying: the opponents' squads and buildings only once
  // they may be seen (a refusal never shows where a hidden one stands; the Coal mine's exit, the Magic lake)
  const seenTaken = (m, side, col, row) => G.occupied(m, side, col, row) || G.bldgSeen(m, side, col, row) || G.enemyHolds(m, side, col, row) || !!recAt(m, col, row);
  const placeOf = (kindId, part) => { const K = kindOf(kindId); if (!K) return null; return part ? (K.place.parts || []).find(p => p.id === part) || null : K.place; };
  // may team `side` put building kind (or its part) on this tile?
  function spotOk(m, side, kindId, part, col, row) {
    if (!on(m)) return false;
    grid(m);
    const K = kindOf(kindId), pl = placeOf(kindId, part);
    if (!K || !pl || !Number.isInteger(col) || !Number.isInteger(row) || !inBoard(col, row)) return false;
    if (!(WHERE[pl.where] || WHERE.interior)(side, col, row)) return false;
    if (G.terrainBlocks(m, col, row) || taken(m, side, col, row)) return false;
    if (pl.spacing !== false && !spaced(m, col, row)) return false;
    if (K.hooks.spotOk && !K.hooks.spotOk(m, side, part || null, col, row)) return false;
    return true;
  }
  // every allowed tile, best first: the back of the zone, then the middle (for no man's land: the own side, the middle)
  function spots(m, side, kindId, part) {
    const { COLS, ROWS } = grid(m), out = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (spotOk(m, side, kindId, part, col, row)) out.push({ col, row });
    const back = (r) => side === 0 ? ROWS - 1 - r : r, mid = (COLS - 1) / 2;
    return out.sort((a, b) => back(a.row) - back(b.row) || Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.col - b.col);
  }
  const autoSpot = (m, side, kindId, part) => spots(m, side, kindId, part)[0] || null;

  // =====================================================================
  // The placement vote (team state m.mpbVote; its 15 s clock is in D)
  // =====================================================================
  const voteQueue = (m, side) => (m && m.mpbVote && m.mpbVote[side]) || [];
  const voteHead = (m, side) => voteQueue(m, side)[0] || null;
  const queue = (m, side, kindId, part, key) => { if (!m.mpbVote) m.mpbVote = [[], []]; m.mpbVote[side].push({ kind: kindId, part: part || null, key: key || null, votes: [null, null] }); };
  // the head of the queue goes on (col, row): a new building (its parts are voted on next), or a part of one
  function placeHead(m, side, col, row) {
    const q = voteQueue(m, side), head = q.shift();
    if (!head) return null;
    if (head.part) { const rec = recOf(m, side, head.key); if (rec) rec.parts[head.part] = { col, row }; return rec; }
    const rec = addRec(m, side, head.kind, col, row);
    ((kindOf(head.kind).place.parts) || []).slice().reverse().forEach(p => q.unshift({ kind: head.kind, part: p.id, key: rec.key, votes: [null, null] }));
    return rec;
  }
  // a player's vote (Game.mpbVote): a tile allowed for the first building in the queue; the same tile as the
  // teammate's places it at once
  function mpbVote(m, side, col, row) {
    const head = voteHead(m, side);
    if (!head || !spotOk(m, side, head.kind, head.part, col, row)) return false;
    const L = laneOf(m), o = head.votes[1 - L];
    head.votes[L] = { col, row };
    if (o && o.col === col && o.row === row) placeHead(m, side, col, row);
    return true;
  }
  // the 15 s ran out: one of the two votes (seeded, r: 0..1), the only vote, or the first allowed tile. A vote whose
  // tile isn't allowed any more (a squad stands there now) is passed over. Returns the tile, or null (no room at all:
  // the building is lost).
  function voteResult(m, side, r) {
    const head = voteHead(m, side);
    if (!head) return null;
    const ok = head.votes.filter(Boolean).filter(t => spotOk(m, side, head.kind, head.part, t.col, t.row));
    if (ok.length === 2 && (ok[0].col !== ok[1].col || ok[0].row !== ok[1].row)) return ok[r < 0.5 ? 0 : 1];
    return ok[0] || autoSpot(m, side, head.kind, head.part);
  }

  // =====================================================================
  // Skills (generic purchase), actions, take-backs
  // =====================================================================
  // price of the next click: cost + costStep for every click this player made this round (costStep: per player)
  function skillCost(m, side, key, id) {
    const rec = recOf(m, side, key), sk = rec && skillOf(rec.kind, id);
    if (!sk) return 0;
    const mine = thisRound(m, rec.skills[id]).filter(e => e.lane === laneOf(m)).length;
    return Math.max(0, Math.round((sk.cost || 0) + (sk.costStep || 0) * mine));
  }
  // may this player click skill id of building key now? (null: yes, else why not, for the sheet)
  function whyNot(m, side, key, id, args) {
    if (!on(m) || m.over) return 'off';
    const rec = recOf(m, side, key), sk = rec && skillOf(rec.kind, id), K = rec && kindOf(rec.kind);
    if (!sk) return 'none';
    const e = rec.skills[id], log = thisRound(m, e), L = laneOf(m);
    const per = PER.includes(sk.per) ? sk.per : 'free';
    if (per === 'round' && log.length) return 'round';
    if (per === 'roundPlayer' && log.some(x => x.lane === L)) return 'you';
    if (per === 'building' && skillN(rec, id) > 0) return 'have';
    if (per === 'match' && recs(m, side).some(r => r.kind === rec.kind && skillN(r, id) > 0)) return 'have';
    if (sk.max && skillN(rec, id) >= sk.max) return 'max';
    if (m.gold[side] < skillCost(m, side, key, id)) return 'gold';
    if (K.hooks.canBuy && !K.hooks.canBuy(m, side, rec, sk, args || [])) return 'rules';
    return null;
  }
  const canBuy = (m, side, key, id, ...args) => !whyNot(m, side, key, id, args);
  function mpbBuy(m, side, key, id, ...args) {
    if (!canBuy(m, side, key, id, ...args)) return false;
    const rec = recOf(m, side, key), sk = skillOf(rec.kind, id), L = laneOf(m), cost = skillCost(m, side, key, id);
    const e = rec.skills[id] || (rec.skills[id] = { round: m.round, n: 0, by: [0, 0], log: [] });
    if (e.round !== m.round) { e.round = m.round; e.log = []; }
    m.gold[side] -= cost;
    e.n++; e.by[L]++; e.log.push({ lane: L, cost });
    const K = kindOf(rec.kind);
    if (K.hooks.bought) K.hooks.bought(m, side, rec, sk, args, L);
    return true;
  }
  // a player takes back their own last click of skill id this round (never the teammate's: their gold; hooks.canUndo
  // (m, side, rec, id): a kind may refuse, the Coal mine's exit can't go back to a tile taken since)
  const canUndo = (m, side, key, id) => { const rec = recOf(m, side, key), K = rec && kindOf(rec.kind); return !!rec && thisRound(m, rec.skills[id]).some(e => e.lane === laneOf(m)) && !m.over && !(K && K.hooks.canUndo && !K.hooks.canUndo(m, side, rec, id)); };
  // Undo all (Duo): may team `side`'s buildings go back to how they would be again (sc: the rebuilt copy)? Each of
  // this player's clicks this round must be one they could take back, and each kind's hooks.restoreOk(m, side, rec,
  // was) agree (the Coal mine: its exit back on a tile still free). m: the player's lane as it stands.
  function undoAllOk(m, side, sc) {
    if (!on(m)) return true;
    const L = laneOf(m);
    for (const rec of recs(m, side)) {
      const K = kindOf(rec.kind);
      if (!K) continue;
      for (const id of Object.keys(rec.skills)) if (thisRound(m, rec.skills[id]).some(e => e.lane === L) && K.hooks.canUndo && !K.hooks.canUndo(m, side, rec, id)) return false;
      const was = sc && recOf(sc, side, rec.key);
      if (was && K.hooks.restoreOk && !K.hooks.restoreOk(m, side, rec, was)) return false;
    }
    return true;
  }
  function mpbUndo(m, side, key, id) {
    if (!canUndo(m, side, key, id)) return false;
    const rec = recOf(m, side, key), e = rec.skills[id], L = laneOf(m), sk = skillOf(rec.kind, id);
    let k = e.log.length - 1; while (e.log[k].lane !== L) k--;
    const [x] = e.log.splice(k, 1);
    m.gold[side] += x.cost;
    e.n--; e.by[L]--;
    const K = kindOf(rec.kind);
    if (K.hooks.unbuy) K.hooks.unbuy(m, side, rec, sk, L, x);
    if (!e.n) delete rec.skills[id];
    return true;
  }
  // a kind's own action (tap a squad, move the exit...): hooks.canAct / hooks.act
  function mpbAct(m, side, key, action, ...args) {
    if (!on(m) || m.over) return false;
    const rec = recOf(m, side, key), K = rec && kindOf(rec.kind);
    if (!K || !K.hooks.act || (K.hooks.canAct && !K.hooks.canAct(m, side, rec, action, args))) return false;
    return !!K.hooks.act(m, side, rec, action, args, laneOf(m));
  }

  // =====================================================================
  // What the opponents may see while deploying (Referee.hide): this round's skill clicks, the votes, a kind's hide
  // =====================================================================
  function hide(s, h) {
    if (!on(s)) return s;
    for (const rec of recs(s, h)) {
      for (const id of Object.keys(rec.skills)) {
        const e = rec.skills[id];
        if (e.round !== s.round || !e.log.length) continue;
        for (const x of e.log) { e.n--; e.by[x.lane]--; }
        e.log = [];
        if (e.n <= 0) delete rec.skills[id];
      }
      const K = kindOf(rec.kind);
      if (K && K.hooks.hide) K.hooks.hide(s, h, rec);
    }
    if (s.mpbVote && s.mpbVote[h]) for (const e of s.mpbVote[h]) e.votes = [null, null];
    return s;
  }

  // =====================================================================
  // Fights (Duo.battle, Duo.fight)
  // =====================================================================
  // a building's plain fight unit: a structure that doesn't count for winning (Engine counts)
  function unitOf(m, side, rec) {
    const K = kindOf(rec.kind);
    if (K.hooks.unit) return K.hooks.unit(m, side, rec);
    return E.withTraits({ name: K.name, cost: 0, bodies: 1, hp: Math.max(1, K.hp), hit: 0, aps: 1, range: 0, speed: 0, splash: 0, shape: 'square', color: K.color,
      structure: true, lesser: true, kind: 'mpb', mpb: K.id, level: 0, ...(K.armor ? { defense: 'armor', defVal: K.armor } : {}) });
  }
  const squadOf = (k) => SQ - k;
  const extraOf = (k, j) => XSQ - k * 10 - j;
  // which building of a side a fight squad id is (k), or -1
  const indexOf = (sq) => sq <= SQ && sq > XSQ ? SQ - sq : sq <= XSQ && sq > XSQ - 1000 ? Math.floor((XSQ - sq) / 10) : -1;
  const isSquad = (sq) => typeof sq === 'number' && sq <= SQ && sq > XSQ - 1000;
  // lane 0's MPB bodies for side (Duo.battle builds them once for the team). lanes (optional): both lanes' matches, as
  // ctx.lanes (a kind that makes a unit for one player: the Factory's buyer)
  function bodies(m, side, idx0 = 5000, lanes = null) {
    if (!on(m)) return [];
    grid(m);
    const out = [];
    recs(m, side).forEach((rec, k) => {
      const K = kindOf(rec.kind);
      if (!K) return;
      const idx = idx0 + k * 20;
      const ctx = { k, squad: squadOf(k), xsq: (j) => extraOf(k, j), idx, lanes,
        main: () => { if (!(K.hp > 0)) return []; const w = G.tileToWorld(rec.col, rec.row); return E.buildSquad(unitOf(m, side, rec), side, w.x, w.y, squadOf(k), G.TILE, idx); } };
      out.push(...(K.hooks.bodies ? K.hooks.bodies(m, side, rec, ctx) : ctx.main()));
    });
    // bodies the other team's buildings give this side (hooks.foeBodies; the Oak's downside: an Ent): squad ids
    // xsq(j) of that building's index k (j chosen by the kind so it never meets this side's own)
    recs(m, 1 - side).forEach((rec, k) => {
      const K = kindOf(rec.kind);
      if (K && K.hooks.foeBodies) out.push(...K.hooks.foeBodies(m, side, rec, { k, xsq: (j) => extraOf(k, j), idx: idx0 + 400 + k * 20 }));
    });
    return out;
  }
  // the Engine options the buildings add (opts.mpb: fields the kinds fill; opts as a whole for tiles and the like).
  // lanes (optional): both lanes' matches, the hook's 5th argument
  function battleOpts(m, opts, lanes = null) {
    if (!on(m)) return opts;
    if (!opts.mpb) opts.mpb = {};
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.battleOpts) K.hooks.battleOpts(m, side, rec, opts, lanes); }
    return opts;
  }
  // Game.bodiesFor: a squad's fight unit (before its bodies are made) and its bodies (after)
  function squadMods(m, side, sq, u) {
    for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.squadMods) u = K.hooks.squadMods(m, side, rec, sq, u) || u; }
    return u;
  }
  function squadBodies(m, side, sq, list, u) {
    for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.squadBodies) K.hooks.squadBodies(m, side, rec, sq, list, u); }
  }
  // units a kind brings into the 2v2 set (kind field extraUnits(units) -> [unit]; Duo.unitSet appends them). Game.isOff
  // asks unitOff: such a unit (u.mpbUnit = the kind) is off for a team without a building of that kind (group B5)
  const extraUnits = (units) => Object.values(KINDS).flatMap(K => (K.extraUnits ? K.extraUnits(units) : []));
  const unitOff = (m, side, ui) => { const u = m && m.units && m.units[ui]; return !!(u && u.mpbUnit) && !(side != null && recs(m, side).some(r => r.kind === u.mpbUnit)); };
  // A bot's turn (Duo.botTurn, in the bot's lane m; r: a seeded 0..1 source): each building's hooks.bot(m, side, rec, r)
  // before its squads (Game.aiDeploy), then hooks.botAfter(m, side, rec, r) after them (a skill on a squad it just
  // placed). Never throws: a kind's bot slip leaves the turn as it is.
  function botsBy(hook, m, side, r) {
    if (!on(m)) return;
    for (const rec of recs(m, side).slice()) { const K = kindOf(rec.kind); if (K && K.hooks[hook]) { try { K.hooks[hook](m, side, rec, r); } catch (e) {} } }
  }
  const bots = (m, side, r) => botsBy('bot', m, side, r);
  const botsAfter = (m, side, r) => botsBy('botAfter', m, side, r);
  // a line for the results screen: summaries[L].mpbNews[side] gets { kind, ... } (the page words it)
  function news(sums, side, item) { for (const s of sums) { if (!s.mpbNews) s.mpbNews = [[], []]; s.mpbNews[side].push(item); } }
  // After the fight (Duo.fight, both lanes resolved): fell, the kinds' afterFight, the artifacts' winners and gold.
  // lanes: the two matches; team state is changed in lanes[0] (Duo copies it to lane 1); gold in each lane.
  // hp: the shared Team HP [team A, team B] (a kind may change it: Field hospital)
  function afterFight(lanes, res, sums, hp) {
    const m = lanes[0];
    if (!on(m)) return;
    const round = sums[0].round;
    for (const side of [0, 1]) recs(m, side).forEach((rec, k) => {
      const q = res.squads[side + ':' + squadOf(k)];
      if (q && q.total > 0 && q.alive === 0) rec.fell = round;
    });
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.afterFight) K.hooks.afterFight(lanes, side, rec, res, sums, round, hp || [0, 0]); }
    // artifacts: res.artifacts (Engine, group A) [{ won: -1 | 0 | 1 }]; without it nobody won
    const A = m.artifacts;
    if (A && A.round === round) {
      A.list.forEach((a, i) => { const r = res.artifacts && res.artifacts[i]; a.won = r && (r.won === 0 || r.won === 1) ? r.won : -1; });
      for (const s of sums) s.artifacts = A.list.map(a => ({ id: a.id, won: a.won, card: { ...a.card }, gold: a.won >= 0 ? ARTIFACT.gold : 0 }));
      for (const a of A.list) if (a.won >= 0) for (const L of lanes) L.gold[a.won] += ARTIFACT.gold;
      for (const L of lanes.slice(1)) L.artifacts = clone(A);
    }
  }
  // Team HP changes bought for round `round`'s fight (hooks.teamHp: the Oak's Heal), before the fight's damage comes
  // off (Duo.fight; the lanes may be in the next round already). hp: the shared Team HP [team A, team B], changed.
  function teamHeal(lanes, hp, round, sums) {
    const m = lanes[0];
    if (!on(m)) return;
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.teamHp) K.hooks.teamHp(lanes, side, rec, hp, round, sums); }
  }
  // before a fight (Duo.settle, the lanes as they will fight): whatever the kinds leave unsettled (hooks.settle(lanes,
  // side, rec): a Magic lake tile nobody put down); change lanes[0], Duo copies it to lane 1
  function settle(lanes) {
    const m = lanes[0];
    if (!on(m)) return;
    for (const side of [0, 1]) for (const rec of recs(m, side).slice()) { const K = kindOf(rec.kind); if (K && K.hooks.settle) K.hooks.settle(lanes, side, rec); }
  }
  // the start of a round (Duo.beginRound): this round's skill logs start empty, then the kinds' roundStart
  function roundStart(lanes) {
    const m = lanes[0];
    if (!on(m)) return;
    for (const side of [0, 1]) for (const rec of recs(m, side)) for (const id of Object.keys(rec.skills)) { const e = rec.skills[id]; if (e.round !== m.round) e.log = []; }
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.roundStart) K.hooks.roundStart(lanes, side, rec); }
  }

  // =====================================================================
  // Artifacts (rolled by Duo at the start of rounds 2 and 8)
  // =====================================================================
  // the cards on offer: every tower type and every MPB kind but the Vault, minus what either team has
  function cardPool(m) {
    const towers = new Set([0, 1].map(sd => m.towers && m.towers[sd] && m.towers[sd].type).filter(Boolean));
    const out = G.TOWER_TYPES.filter(t => !towers.has(t.id)).map(t => ({ type: 'tower', id: t.id }));
    for (const id of Object.keys(KINDS)) if (KINDS[id].draft !== false && !has(m, 0, id) && !has(m, 1, id)) out.push({ type: 'mpb', id });
    return out;
  }
  const cardName = (c) => !c ? '' : c.type === 'tower' ? ((G.TOWER_TYPES.find(t => t.id === c.id) || {}).name || c.id) : ((kindOf(c.id) || {}).name || c.id);
  const cardText = (c) => !c ? '' : c.type === 'tower' ? ((G.TOWER_TYPES.find(t => t.id === c.id) || {}).text || '') : ((kindOf(c.id) || {}).text || '');
  // two point-mirrored tiles in no man's land (not flank tiles, not water), at least ARTIFACT.apart tiles apart, and
  // two different cards. r: a seeded 0..1 source. Returns { round, list }.
  function rollArtifacts(m, r) {
    const { COLS, ROWS } = grid(m), mirror = (c, w) => ({ col: COLS - 1 - c, row: ROWS - 1 - w });
    const ok = [];
    for (let row = 0; row < ROWS / 2; row++) for (let col = 0; col < COLS; col++) {
      const p = mirror(col, row);
      if (!nmlOk(col, row) || !nmlOk(p.col, p.row) || G.terrainBlocks(m, col, row) || G.terrainBlocks(m, p.col, p.row)) continue;
      if (Math.hypot(p.col - col, p.row - row) < ARTIFACT.apart) continue;
      ok.push({ col, row });
    }
    const a = ok[Math.floor(r() * ok.length)], b = mirror(a.col, a.row);
    const pool = cardPool(m), cards = [];
    while (cards.length < 2 && pool.length) cards.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    const pair = r() < 0.5 ? [a, b] : [b, a];
    return { round: m.round, list: pair.map((t, id) => ({ id, col: t.col, row: t.row, card: cards[id] || null, won: null })) };
  }
  // what Duo.battle hands the Engine (opts.artifacts), world metres
  function artifactsFor(m) {
    const A = m && m.artifacts;
    if (!A || A.round !== m.round) return null;
    grid(m);
    return A.list.map(a => { const w = G.tileToWorld(a.col, a.row); return { x: w.x, y: w.y, r: ARTIFACT.r, cap: ARTIFACT.cap }; });
  }

  // =====================================================================
  // The artifact draft (rounds 3 and 9)
  // =====================================================================
  // from the artifacts of the round before: { round, cards, won, owner, first, how } (owner null: `first` must pick)
  function dealDraft(m, coin) {
    const A = m.artifacts;
    if (!A || A.round !== m.round - 1 || !DRAFT_ROUNDS.includes(m.round)) return null;
    const cards = A.list.map(a => a.card), won = A.list.map(a => (a.won === 0 || a.won === 1 ? a.won : -1));
    const d = { round: m.round, cards, won, owner: [null, null], first: null, how: '', done: false };
    if (won[0] >= 0 && won[0] === won[1]) { d.how = 'both'; d.first = won[0]; }
    else if (won[0] >= 0 && won[1] >= 0) { d.how = 'split'; d.owner = won.slice(); }
    else if (won[0] >= 0 || won[1] >= 0) { const i = won[0] >= 0 ? 0 : 1; d.how = 'one'; d.owner[i] = won[i]; d.owner[1 - i] = 1 - won[i]; }
    else { d.how = 'none'; d.first = coin; }
    if (!cards[0] || !cards[1]) { d.owner = [0, 1]; d.how = d.how || 'split'; } // (never: the pool always has two)
    return d;
  }
  const draftOpen = (m) => !!(m && m.draft && m.draft.round === m.round && m.draft.owner[0] == null);
  const draftTurn = (m, side) => draftOpen(m) && m.draft.first === side;
  // a card goes to its team in this lane: a tower card replaces the tower (and what was bought for the old one), an MPB
  // card goes into the team's placement vote (or the kind's own acquire)
  function giveCard(m, team, card) {
    if (!card) return;
    if (card.type === 'tower') {
      const t = m.towers && m.towers[team];
      if (!t) return;
      const had = !!t.type;
      t.type = card.id;
      if (had || m.round > G.TOWER_PICK_ROUND) { // the old tower's skills, walls and mage general go with it
        for (const f of ['towerSkill', 'towerSkill2']) if (m[f]) m[f][team] = 0;
        if (m.bwalls) m.bwalls[team] = [];
        if (m.mageGen) m.mageGen[team] = null;
        if (m.tround) m.tround[team] = {};
        if (m.mark) m.mark[team] = null;
      }
      while (m.extraDeploys && G.musterOn(m, team) && m.extraDeploys[team] > 0) { m.extraDeploys[team]--; m.gold[team] += G.deployCost(m, team); }
      return;
    }
    const K = kindOf(card.id);
    if (!K) return;
    if (K.hooks.acquire) K.hooks.acquire(m, team, card); else queue(m, team, card.id, null, null);
  }
  function applyDraft(m) {
    const d = m.draft;
    if (!d || d.done || d.owner[0] == null) return false;
    d.done = true;
    d.cards.forEach((c, i) => giveCard(m, d.owner[i], c));
    return true;
  }
  // Game.draftPick: the team that picks first takes card idx; the other team gets the one left
  function draftPick(m, side, idx) {
    if (!draftTurn(m, side) || (idx !== 0 && idx !== 1)) return false;
    m.draft.owner[idx] = side; m.draft.owner[1 - idx] = 1 - side; m.draft.pick = idx;
    applyDraft(m);
    return true;
  }
  // a bot's pick: an MPB it doesn't have, else a tower while it has the Outpost, else card 0
  function botPick(m, side) {
    const d = m.draft, cs = d.cards;
    const score = (c) => !c ? -1 : c.type === 'mpb' && !has(m, side, c.id) ? 2 : c.type === 'tower' && !(m.towers[side] && m.towers[side].type) ? 3 : 1;
    return score(cs[1]) > score(cs[0]) ? 1 : 0;
  }

  // =====================================================================
  // System actions (Duo logs them so Undo all keeps them; replayed on a copy in rebuildTeam). (m, side, ...a)
  // =====================================================================
  const SYS = {
    vote: (m, side, col, row) => mpbVote(m, side, col, row),
    place: (m, side, col, row) => { placeHead(m, side, col, row); return true; },
    drop: (m, side) => { voteQueue(m, side).shift(); return true; },
    draft: (m, side, o0, o1) => { if (!m.draft) return false; m.draft.owner = [o0, o1]; m.draft.done = false; return applyDraft(m); },
  };

  const api = {
    SQ, XSQ, VOTE_MS, DRAFT_MS, SPACING, ARTIFACT, DRAFT_ROUNDS, VAULT_SPOT, PER, VAULT, GOLEM, KINDS, SYS,
    def, kindOf, recs, recOf, has, skillOf, skillN, addRec, tilesOf, recAt, at, terrainAt, settle, init,
    interior, spaced, spotOk, spots, autoSpot,
    voteQueue, voteHead, queue, placeHead, mpbVote, voteResult,
    skillCost, whyNot, canBuy, mpbBuy, canUndo, undoAllOk, mpbUndo, mpbAct, seenTaken,
    vaultOf, vaultRec, vaultMode, vaultMoved, vaultRoom, canVault, vaultPut, vaultTake, golemOf, golemUnit, golemSkin,
    hide, unitOf, squadOf, extraOf, indexOf, isSquad, bodies, battleOpts, squadMods, squadBodies, news, afterFight, roundStart, teamHeal, FH, OAK, oakMossTiles, oakEntUnit,
    cardPool, cardName, cardText, rollArtifacts, artifactsFor,
    dealDraft, draftOpen, draftTurn, giveCard, applyDraft, draftPick, botPick, rng, laneOf, on,
    extraUnits, unitOff, bots, botsAfter,
    // the Factory and the Shadow Den (group B5)
    FAC, facNow, facResting, DEN, LANE_OFF, denOf, denUnit, handsIdx, isHands, denResting, shadowBonus, sabotaged, sabNow, sabLive, watching, deployCut, impTargets, impFind, impNow,
  };
  // the player actions (Referee.ACTIONS lists them) and the hooks Game calls (occupied, bodiesFor, Referee.hide)
  Object.assign(G, { mpbBuy, mpbUndo, mpbAct, mpbVote, vaultPut, vaultTake, draftPick });
  if (G.setMpb) G.setMpb(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mpb = api;
})(typeof window !== 'undefined' ? window : globalThis);
