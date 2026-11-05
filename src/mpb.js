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
  def({ id: 'fieldHospital', name: 'Field hospital', short: 'fh', kind: 'support', hp: 600, armor: 2, color: '#E8E2D0',
    text: 'Squads deployed within 1 tile: +20% health and 2%/s regen in the fight. Each round won with it standing: +5 Team HP. Can’t shoot.',
    downside: 'Destroyed: −15 Team HP.', skills: [], hooks: {} });

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
  // the tile a squad on (col, row) comes up on, or null (not round the entrance, no exit yet, off the board)
  function mineOut(m, rec, col, row) {
    const x = exitOf(rec);
    if (!x || rec.col < 0 || cheb(col, row, rec.col, rec.row) !== 1) return null;
    grid(m);
    const c = x.col + col - rec.col, r = x.row + row - rec.row;
    return inBoard(c, r) ? { col: c, row: r } : null;
  }
  // may the exit be moved to (col, row) (Dig a new exit)? No man's land (not flank tiles) as before, or a flank tile of
  // the enemy's half; a free tile (its old tile and the tiles round it don't count: the exit leaves them)
  function exitMoveOk(m, side, rec, col, row) {
    const x = exitOf(rec);
    if (!on(m) || !x || !Number.isInteger(col) || !Number.isInteger(row)) return false;
    grid(m);
    if (!inBoard(col, row) || (x.col === col && x.row === row)) return false;
    if (!(nmlOk(col, row) || G.isFlank(side, col, row)) || G.terrainBlocks(m, col, row)) return false;
    delete rec.parts.exit;
    try { return !taken(m, side, col, row); } finally { rec.parts.exit = x; }
  }
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
    COAL, mineOut, exitMoveOk, exitSpots, canMoveExit,
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
      // Dig a new exit taken back the round it was bought: the exit goes back too
      unbuy(m, side, rec, sk) { if (sk.id === 'shaft' && rec.data.moved === m.round && rec.data.from) { rec.parts.exit = { ...rec.data.from }; rec.data.moved = 0; rec.data.from = null; } },
      canAct: (m, side, rec, action, args) => action === 'exit' && canMoveExit(m, side, rec) && exitMoveOk(m, side, rec, args[0], args[1]),
      act(m, side, rec, action, args, lane) {
        rec.data.from = { ...exitOf(rec) }; rec.data.moved = m.round; rec.data.by = lane;
        rec.parts.exit = { col: args[0], row: args[1] };
        return true;
      },
      // bots: now and then one of the squads they put down this round goes round the entrance (down the mine), Fresh
      // air when they have gold to spare, and sometimes a new exit nearer the enemy
      bot(m, side, rec, lane, r) {
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
  def({ id: 'oak', name: 'The Oak', short: 'oak', kind: 'support', hp: 1200, armor: 3, color: '#7A5A36',
    text: 'Restoration: all healing and regen of the team +25%.', downside: 'The round after it was destroyed, a level 3 Ent with all its skills fights for the opponents.', skills: [], hooks: {} });

  // ===== factory =====
  def({ id: 'factory', name: 'Factory', short: 'fa', kind: 'economic', hp: 1000, armor: 0, color: '#B07A3C',
    text: 'The Cog Builder’s Factory as a team building: built at once, either player buys its unit of the round.',
    downside: 'As the Cog Builder’s Factory.', skills: [], hooks: {} });

  // ===== magicLake =====
  // Terrain, not a building: each player of the team puts down LAKE.tiles water tiles (their own, no vote: Game.mpbAct
  // 'place') on the team's own zone (not the enemy's flank tiles) or anywhere in no man's land (not flank tiles), never
  // on a squad or building, and never so that some tile can no longer be walked to (lakeFree: the board's walkable
  // tiles stay one area). A tile not put down by the fight goes on the first allowed tile (hooks.settle). Water is the
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
  // may this player put lake tile rec on (col, row)? (their own tile, not down yet or put down this round)
  function lakeOk(m, side, rec, col, row) {
    if (!on(m) || !rec || rec.kind !== 'magicLake' || rec.data.lane !== laneOf(m) || !(rec.col < 0 || rec.round === m.round)) return false;
    const was = { col: rec.col, row: rec.row };
    rec.col = -1; rec.row = -1; // (a tile being moved: its old tile is dry for the check)
    try { return spotOk(m, side, 'magicLake', null, col, row); } finally { rec.col = was.col; rec.row = was.row; }
  }
  // where lake tile rec may go, best first: no man's land on the team's own half (the rows nearest its zone first),
  // then the rest of no man's land, then the zone (its front first); each player toward the columns of their own half
  function lakeSpots(m, side, rec) {
    const out = [];
    if (!on(m) || !rec) return out;
    const { COLS, ROWS } = grid(m), was = { col: rec.col, row: rec.row };
    rec.col = -1; rec.row = -1;
    try {
      lakeWet = Uint8Array.from({ length: COLS * ROWS }, (_, i) => G.terrainBlocks(m, i % COLS, Math.floor(i / COLS)) ? 1 : 0);
      rec.col = was.col; rec.row = was.row;
      for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (lakeOk(m, side, rec, col, row)) out.push({ col, row });
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
      spotOk: (m, side, part, col, row) => lakeFree(m, col, row),
      // (for the boards: its look shows its skills)
      unit: (m, side, rec) => E.withTraits({ name: 'Magic lake', cost: 0, bodies: 1, hp: 1, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, shape: 'square', color: '#3E8FC4',
        structure: true, lesser: true, kind: 'mpb', mpb: 'magicLake', level: 0, ...(lakeSkin(rec) ? { mpbSkin: lakeSkin(rec) } : {}) }),
      canBuy: (m, side, rec) => rec.col >= 0,
      canAct: (m, side, rec, action, args) => action === 'place' && lakeOk(m, side, rec, args[0], args[1]),
      act(m, side, rec, action, args) { rec.col = args[0]; rec.row = args[1]; rec.round = m.round; return true; },
      // a tile nobody put down by the fight: on the first tile its player could have put it
      settle(lanes, side, rec) {
        const m = lanes[0];
        if (rec.col >= 0) return;
        const was = m.duoLane;
        m.duoLane = rec.data.lane;
        const t = lakeSpots(m, side, rec)[0];
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
      bot(m, side, rec, lane, r) {
        if (rec.data.lane !== lane) return;
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
  def({ id: 'shadowDen', name: 'Shadow Den', short: 'sd', kind: 'technical', hp: 800, armor: 2, color: '#3B3350',
    text: 'Rogues, Assassins and Shadowhands: no flank delay.', downside: 'Destroyed: your Shadowhands are lost, no Den skills next round.', skills: [], hooks: {} });

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
  function at(m, col, row) {
    const x = recAt(m, col, row);
    if (x) { const pl = (kindOf(x.rec.kind) || {}).place || {}; if (!pl.open && !pl.terrain) return true; }
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.blocks && K.hooks.blocks(m, side, rec, col, row)) return true; }
    return false;
  }
  // Game.terrainBlocks: a tile of a kind that is terrain (place.terrain: the Magic lake's water), either team
  const terrainAt = (m, col, row) => { const x = on(m) && recAt(m, col, row); return !!x && !!((kindOf(x.rec.kind) || {}).place || {}).terrain; };

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
  // a player takes back their own last click of skill id this round (never the teammate's: their gold)
  const canUndo = (m, side, key, id) => { const rec = recOf(m, side, key); return !!rec && thisRound(m, rec.skills[id]).some(e => e.lane === laneOf(m)) && !m.over; };
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
  // lane 0's MPB bodies for side (Duo.battle builds them once for the team)
  function bodies(m, side, idx0 = 5000) {
    if (!on(m)) return [];
    grid(m);
    const out = [];
    recs(m, side).forEach((rec, k) => {
      const K = kindOf(rec.kind);
      if (!K) return;
      const idx = idx0 + k * 20;
      const ctx = { k, squad: squadOf(k), xsq: (j) => extraOf(k, j), idx,
        main: () => { if (!(K.hp > 0)) return []; const w = G.tileToWorld(rec.col, rec.row); return E.buildSquad(unitOf(m, side, rec), side, w.x, w.y, squadOf(k), G.TILE, idx); } };
      out.push(...(K.hooks.bodies ? K.hooks.bodies(m, side, rec, ctx) : ctx.main()));
    });
    return out;
  }
  // the Engine options the buildings add (opts.mpb: fields the kinds fill; opts as a whole for tiles and the like)
  function battleOpts(m, opts) {
    if (!on(m)) return opts;
    if (!opts.mpb) opts.mpb = {};
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.battleOpts) K.hooks.battleOpts(m, side, rec, opts); }
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
  // a bot's turn (Duo.botTurn, in the bot's lane): the kinds' hooks.bot(m, side, rec, lane, r) (r: a seeded 0..1 source)
  function botTurn(m, side) {
    if (!on(m)) return;
    const r = rng(((m.seed || 0) + m.round * 4241 + side * 977 + laneOf(m) * 131) >>> 0);
    for (const rec of recs(m, side).slice()) { const K = kindOf(rec.kind); if (K && K.hooks.bot) K.hooks.bot(m, side, rec, laneOf(m), r); }
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
    def, kindOf, recs, recOf, has, skillOf, skillN, addRec, tilesOf, recAt, at, terrainAt, botTurn, settle, init,
    interior, spaced, spotOk, spots, autoSpot,
    voteQueue, voteHead, queue, placeHead, mpbVote, voteResult,
    skillCost, whyNot, canBuy, mpbBuy, canUndo, mpbUndo, mpbAct,
    vaultOf, vaultRec, vaultMode, vaultMoved, vaultRoom, canVault, vaultPut, vaultTake, golemOf, golemUnit, golemSkin,
    hide, unitOf, squadOf, extraOf, indexOf, isSquad, bodies, battleOpts, squadMods, squadBodies, news, afterFight, roundStart,
    cardPool, cardName, cardText, rollArtifacts, artifactsFor,
    dealDraft, draftOpen, draftTurn, giveCard, applyDraft, draftPick, botPick, rng, laneOf, on,
  };
  // the player actions (Referee.ACTIONS lists them) and the hooks Game calls (occupied, bodiesFor, Referee.hide)
  Object.assign(G, { mpbBuy, mpbUndo, mpbAct, mpbVote, vaultPut, vaultTake, draftPick });
  if (G.setMpb) G.setMpb(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mpb = api;
})(typeof window !== 'undefined' ? window : globalThis);
