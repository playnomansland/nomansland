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
  def({ id: 'coalMine', name: 'Coal mine', short: 'cm', kind: 'technical', hp: 700, armor: 4, color: '#4A4440',
    text: 'Squads deployed within 1 tile of the entrance go underground and come out at the exit in no man’s land.',
    downside: 'No squad of either team may deploy within 1 tile of its exit.',
    place: { where: 'interior', spacing: true, parts: [{ id: 'exit', name: 'exit', where: 'nml', spacing: false }] }, skills: [], hooks: {} });

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
  def({ id: 'magicLake', name: 'Magic lake', short: 'ml', kind: 'technical', hp: 0, armor: 0, color: '#3E8FC4',
    text: 'Water tiles on your half or in no man’s land: shot over, not walked.', downside: '—', place: { where: 'board', spacing: false }, skills: [], hooks: {} });

  // ===== jail =====
  // A strong technical building (docs/MPB-2V2.md, Vilhelm 6 Nov; group B4). Skywatch (free, always on): the other
  // team's stealthed bodies standing within JAIL.light tiles of it (a 7 x 7 square of tiles) are seen in the fight
  // (Engine opts.mpb.discover); the lit tiles are drawn on both boards (hooks.lit). Jail a squad (JAIL.cost, once per
  // player while the jail has room: JAIL.cells cells, one per player): an enemy squad from an earlier round (one the
  // buyer can see, in either enemy lane) takes no part in any fight until the jail falls. A carrier jailed leaves its
  // rider behind (it steps out on the tile). Jail guards (JAIL.guardsCost, once a match): JAIL.guards Keep guards round
  // the jail in every fight, holding their posts until an enemy comes into their awareness (Engine b.holdSee).
  // Destroyed: the squads in it go free (back to their own zone), their unit types can never be jailed again this
  // match, and the next round the jail does nothing (no jailing, no Skywatch, no guards).
  // rec.data = { cells: [{ by (the buyer's lane), lane, id (the squad: its lane and its id there), ui, round }],
  //   banned: [unit indices], down: the round it does nothing in (0: none) }
  // A jailed squad (in its own lane, from the fight on): sq.jailed = { side (the jail's), key, round, col, row (where it
  // stood) }; it stands on the jail's tile (Game.mpbHeld: it can't move or carry anyone; its player may sell it, which
  // frees its cell). In the round it is jailed only the jail's team knows (hide); it sits that round's fight out already.
  const JAIL = { hp: 1500, armor: 8, cells: 2, cost: 100, guardsCost: 150, guards: 4, light: 3, guardPost: 0.75 };
  const JAIL_GUARD = { name: 'Wisps', cost: 1, bodies: 2, hp: 65, hit: 75, aps: 0.7, range: 19, speed: 4, splash: 0, projSpeed: 20 }; // as Game's Keep guards when the roster has no Wisps
  const LANE_OFF = G.TEAM_ID; // (= Duo.OFF) the other lane's squad ids as a lane's m.team carries them
  const TEAM_LETTER = ['A', 'B'];
  const jailCells = (rec) => (rec && rec.data && rec.data.cells) || [];
  const jailUp = (m, rec) => !(rec.data && rec.data.down && rec.data.down === m.round);
  // squad id of lane `lane` (lanes: the two matches)
  const laneSquad = (lanes, lane, side, id) => (lanes[lane] && lanes[lane].armies[side].find(q => q.id === id)) || null;
  // an enemy squad as this player sees it while deploying: their own lane's opponent's, or the other lane's (m.team)
  function jailSeen(m, side, lane, id) {
    const foe = 1 - side, L = laneOf(m);
    if (lane === L) return G.foeSeen(m, foe).find(q => q.id === id) || null;
    if (lane === 1 - L) return G.teamSeen(m, foe).find(q => q.id === id + LANE_OFF) || null;
    return null;
  }
  // why this player may not jail the squad (lane, id) now (null: they may); no squad given: whether they may jail at all
  function jailWhy(m, side, rec, lane, id) {
    if (!jailUp(m, rec)) return 'down';
    const cells = jailCells(rec), L = laneOf(m);
    if (cells.some(c => c.by === L)) return 'you';
    if (cells.length >= JAIL.cells) return 'full';
    if (lane === undefined && id === undefined) return null;
    if (!Number.isInteger(lane) || !Number.isInteger(id)) return 'pick';
    const q = jailSeen(m, side, lane, id), u = q && m.units[q.unit];
    if (!q || !u || u.building || q.round >= m.round || G.mpbHeld(q) || G.isRider(q)) return 'squad';
    if ((rec.data.banned || []).includes(q.unit)) return 'banned';
    if (recs(m, side).some(r => jailCells(r).some(c => c.lane === lane && c.id === id))) return 'squad';
    return null;
  }
  // the enemy squads this player may jail now: [{ lane, id, sq }]
  function jailable(m, side, rec) {
    if (jailWhy(m, side, rec)) return [];
    const L = laneOf(m), out = [];
    for (const q of G.foeSeen(m, 1 - side)) if (!jailWhy(m, side, rec, L, q.id)) out.push({ lane: L, id: q.id, sq: q });
    for (const q of G.teamSeen(m, 1 - side)) if (q.id >= LANE_OFF && !jailWhy(m, side, rec, 1 - L, q.id - LANE_OFF)) out.push({ lane: 1 - L, id: q.id - LANE_OFF, sq: q });
    return out;
  }
  // a tile of side's zone for a squad coming back onto the board (out of the Jail or the School): `want` if it is free,
  // else the free tile nearest it. lanes: the matches whose squads may be in the way (both after a fight; the one lane
  // while deploying, whose m.team has the other's)
  function homeTile(lanes, side, sq, want) {
    const m = lanes[0], { COLS, ROWS } = grid(m), ui = sq.unit;
    const free = (c, r) => G.blockOf(m, ui, c, r).every(([cc, rr]) => cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && G.inZone(side, rr) && !G.reserved(side, cc, rr) && !G.terrainBlocks(m, cc, rr)
      && !lanes.some(L => G.occupied(L, side, cc, rr) || G.enemyHolds(L, side, cc, rr)));
    if (want && Number.isInteger(want.col) && Number.isInteger(want.row) && free(want.col, want.row)) return { col: want.col, row: want.row };
    const all = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (G.inZone(side, r) && free(c, r)) all.push({ col: c, row: r });
    const w = want || { col: (COLS - 1) / 2, row: G.zoneRows(side)[0] };
    const d = (a) => Math.max(Math.abs(a.col - w.col), Math.abs(a.row - w.row)), e = (a) => Math.hypot(a.col - w.col, a.row - w.row);
    all.sort((a, b) => d(a) - d(b) || e(a) - e(b) || a.row - b.row || a.col - b.col);
    return all[0] || null;
  }
  // after the fight it was jailed in: its riders step out (either lane: a teammate's squad may ride in it), it goes onto
  // the jail's tile
  function jailLock(lanes, lane, foe, q, side, rec, round) {
    lanes.forEach((L, k) => { for (const r of L.armies[foe]) if (r.in != null && (r.in >= LANE_OFF ? 1 - k === lane && r.in - LANE_OFF === q.id : k === lane && r.in === q.id)) delete r.in; });
    delete q.in; delete q.aim;
    q.jailed = { side, key: rec.key, round, col: q.col, row: q.row };
    q.col = rec.col; q.row = rec.row;
  }
  function jailFree(lanes, foe, q) {
    const j = q.jailed;
    delete q.jailed;
    const t = homeTile(lanes, foe, q, { col: j.col, row: j.row }) || { col: j.col, row: j.row };
    q.col = t.col; q.row = t.row;
  }
  def({ id: 'jail', name: 'Jail', short: 'j', kind: 'technical', hp: JAIL.hp, armor: JAIL.armor, color: '#5E6168',
    text: `Skywatch: the enemy’s stealthed units within ${JAIL.light} tiles of it are seen (its light on the board). It has ${JAIL.cells} cells, one for each of you: a jailed enemy squad takes no part in any fight until the jail is destroyed.`,
    downside: 'Destroyed: the jailed squads go free and their unit types can’t be jailed again this match; the next round the jail does nothing (no jailing, no Skywatch, no guards).',
    skills: [
      { id: 'jail', name: 'Jail a squad', cost: JAIL.cost, per: 'free', text: 'Pick an enemy squad from an earlier round: it is locked up from this round’s fight on, until the jail is destroyed (they find out at the fight). Each of you can keep one squad in it. A carrier leaves its rider behind.' },
      { id: 'guards', name: 'Jail guards', cost: JAIL.guardsCost, per: 'match', text: `${JAIL.guards} Keep guards stand round the jail in every fight. They hold their posts until an enemy comes into their awareness.` },
    ],
    hooks: {
      canBuy: (m, side, rec, sk, args) => sk.id !== 'jail' || (args.length === 2 && !jailWhy(m, side, rec, args[0], args[1])),
      bought(m, side, rec, sk, args, lane) {
        if (sk.id !== 'jail') return;
        const [ln, id] = args, q = jailSeen(m, side, ln, id);
        if (!rec.data.cells) rec.data.cells = [];
        rec.data.cells.push({ by: lane, lane: ln, id, ui: q.unit, round: m.round });
      },
      unbuy(m, side, rec, sk, lane) {
        if (sk.id !== 'jail') return;
        const cells = jailCells(rec), k = cells.map(c => c.by === lane && c.round === m.round).lastIndexOf(true);
        if (k >= 0) cells.splice(k, 1);
      },
      // the squads in it sit the fight out (an enemy squad: Mpb.squadBodies' pass over the other side's buildings)
      foeSquadBodies(m, side, rec, sq, list) {
        const L = laneOf(m);
        if (jailCells(rec).some(c => c.lane === L && c.id === sq.id)) list.length = 0;
      },
      bodies(m, side, rec, ctx) {
        const out = ctx.main();
        if (!skillN(rec, 'guards') || !jailUp(m, rec) || !out.length) return out;
        const src = (m.units || []).find(x => x && x.name === 'Wisps') || JAIL_GUARD;
        const { skills, skillDefs, skillsOn, skillsInnate, skillMods, ...plain } = src;
        const gu = E.withTraits({ ...plain, name: 'Jail Guard', level: 0, bodies: JAIL.guards, shape: 'diamond', color: '#E2D3A6' });
        const w = G.tileToWorld(rec.col, rec.row), fwd = side === 0 ? 1 : -1, off = G.TILE * JAIL.guardPost;
        const gb = E.buildSquad(gu, side, w.x, w.y, ctx.xsq(0), G.TILE, ctx.idx + 1);
        const posts = [[0, fwd], [-1, 0], [1, 0], [0, -fwd]]; // front, the two sides, behind
        gb.forEach((x, k) => { const [px, py] = posts[k % posts.length]; x.x = w.x + px * off; x.y = w.y + py * off; x.holdT = 1e9; x.holdSee = true; x.guard = true; });
        out.push(...gb);
        return out;
      },
      battleOpts(m, side, rec, opts) {
        if (!jailUp(m, rec)) return;
        const w = G.tileToWorld(rec.col, rec.row);
        opts.mpb.discover = (opts.mpb.discover || []).concat([{ x: w.x, y: w.y, r: (JAIL.light + 0.5) * G.TILE, side }]);
      },
      // Skywatch's light: every tile within JAIL.light of it (none the round after it fell)
      lit(m, side, rec) {
        if (!jailUp(m, rec)) return [];
        grid(m);
        const out = [];
        for (let r = rec.row - JAIL.light; r <= rec.row + JAIL.light; r++) for (let c = rec.col - JAIL.light; c <= rec.col + JAIL.light; c++) if (inBoard(c, r) && !(c === rec.col && r === rec.row)) out.push({ col: c, row: r });
        return out;
      },
      afterFight(lanes, side, rec, res, sums, round) {
        const foe = 1 - side, cells = jailCells(rec);
        if (rec.fell === round) { // destroyed: everyone in it goes free, their unit types for good; nothing next round
          const banned = new Set(rec.data.banned || []);
          let n = 0;
          for (const c of cells) { const q = laneSquad(lanes, c.lane, foe, c.id); if (q && q.jailed) { jailFree(lanes, foe, q); n++; } banned.add(c.ui); }
          rec.data.cells = []; rec.data.banned = [...banned].sort((a, b) => a - b); rec.data.down = round + 1;
          news(sums, side, { kind: 'jail', freed: n, text: `Team ${TEAM_LETTER[side]}’s Jail was destroyed${n ? `: ${n} jailed squad${n > 1 ? 's go' : ' goes'} free (${n > 1 ? 'their unit types' : 'its unit type'} can’t be jailed again)` : ''}. It does nothing next round.` });
          return;
        }
        // locked up now; a squad sold (or put in its School) before it could be gives its jailer the gold back; one sold
        // later frees its cell
        rec.data.cells = cells.filter(c => {
          const q = laneSquad(lanes, c.lane, foe, c.id);
          if (!q || (q.school && !q.jailed)) { if (c.round === round && lanes[c.by]) lanes[c.by].gold[side] += JAIL.cost; return false; }
          if (!q.jailed) { jailLock(lanes, c.lane, foe, q, side, rec, round); news(sums, side, { kind: 'jail', jailed: q.unit, text: `Team ${TEAM_LETTER[side]}’s Jail locked up a ${(lanes[c.lane].units[q.unit] || {}).name || 'squad'}.` }); }
          return true;
        });
      },
      // the opponents don't see this round's jailing until the fight
      hide(s, h, rec) { if (rec.data.cells) rec.data.cells = rec.data.cells.filter(c => c.round !== s.round); },
      info(m, side, rec) {
        const cells = jailCells(rec);
        return [`Skywatch${jailUp(m, rec) ? '' : ' off this round'}`, `${cells.length}/${JAIL.cells} cells taken`, (rec.data.banned || []).length ? `can’t jail again: ${rec.data.banned.map(i => (m.units[i] || {}).name).join(', ')}` : ''].filter(Boolean);
      },
      // a bot: now and then the costliest enemy squad it can see; the guards when it has gold to spare
      bot(m, side, rec) {
        const r = rng(((m.seed || 0) + m.round * 7121 + side * 89 + laneOf(m) * 13) >>> 0);
        const list = jailable(m, side, rec);
        if (list.length && m.gold[side] >= JAIL.cost + 100 && r() < 0.5) {
          const worth = (q) => G.unitCostOf(m.units[q.unit]) * (1 + (q.level || 0));
          const best = list.slice().sort((a, b) => worth(b.sq) - worth(a.sq) || a.lane - b.lane || a.id - b.id)[0];
          mpbBuy(m, side, rec.key, 'jail', best.lane, best.id);
        }
        if (canBuy(m, side, rec.key, 'guards') && m.gold[side] >= JAIL.guardsCost + 150 && r() < 0.4) mpbBuy(m, side, rec.key, 'guards');
      },
    },
  });

  // ===== school =====
  // A support building (docs/MPB-2V2.md, Vilhelm 6 Nov; group B4). Either player may put one of their own squads in it
  // while it is empty: the squad leaves the board (it stands on the school's tile, Game.mpbHeld), doesn't fight, and its
  // player can't place another squad of that unit type while it is inside (Game.schoolLock). Study (free): at the start
  // of every round it gets a level's worth of XP (levelling up still costs gold as usual); Double study (once a match):
  // twice that. Learn (free): a skill of its unit type, learnt SCHOOL.learn rounds later (Quick learning, once a match:
  // SCHOOL.fastLearn); it can't leave meanwhile. Its player takes it out (free) onto a tile they tap or the nearest free
  // one. Destroyed: the squad that cut it down gets half a level's XP (Engine opts.mpb.watchKills); the squad inside
  // comes out with the XP and level it went in with (a skill being learnt is lost).
  // rec.data = { pupil: { lane, id, ui, round (went in), learn: { k (skill slot), round } | null, sq (its sq.school) } |
  //   null, was: [this round's departures, for the opponents' view] }; the squad (in its own lane): sq.school = { key,
  //   round, col, row (where it stood), xp, level (as it went in) }. Undo all replays the teammate's school actions on
  //   their lane as it stands (Duo.rebuildTeam), so enroll and leave also work where the squad already went in or out.
  const SCHOOL = { hp: 700, armor: 2, learn: 2, fastLearn: 1, doubleCost: 200, fastCost: 300, destroyXp: 0.5 };
  const pupilOf = (rec) => (rec && rec.data && rec.data.pupil) || null;
  // the squad in it as lane m sees it (its own lane: m.armies; the other lane: m.team, its id moved)
  function pupilSq(m, side, rec) {
    const p = pupilOf(rec);
    if (!p) return null;
    if (p.lane === laneOf(m)) return m.armies[side].find(q => q.id === p.id) || null;
    return G.teamArmy(m, side).find(q => q.id === p.id + LANE_OFF) || null;
  }
  // a level's worth of XP for squad sq: the step from the XP threshold it has reached to the next one (0 at the top)
  function levelXp(m, sq) {
    const u = m.units[sq.unit];
    if (!u || (sq.level || 0) >= E.MAX_LEVEL) return 0;
    let l = 0;
    while (l < E.MAX_LEVEL && sq.xp >= G.xpNeeded(u, l)) l++;
    if (l >= E.MAX_LEVEL) return 0;
    return G.xpNeeded(u, l) - (l ? G.xpNeeded(u, l - 1) : 0);
  }
  const learnRounds = (rec) => (skillN(rec, 'fast') ? SCHOOL.fastLearn : SCHOOL.learn);
  // the skill slots squad sq's unit could learn now (Game.canBuySkill without the gold)
  function learnable(m, side, sq) {
    const out = [], g = m.gold[side];
    m.gold[side] = 1e9;
    try { for (const k of E.SLOTS) if (G.skillDef(m, sq.unit, k) && G.canBuySkill(m, side, sq.unit, k) && !G.isBuildingSkill(m, sq.unit, k)) out.push(k); } finally { m.gold[side] = g; }
    return out;
  }
  // why this player may not do `action` on the school now (null: they may). Actions (Game.mpbAct): 'enroll' id (a squad
  // of theirs), 'leave' [col, row] (their squad inside comes out, there or on the nearest free tile), 'learn' k,
  // 'unlearn' (a skill started this round)
  function schoolWhy(m, side, rec, action, args) {
    const p = pupilOf(rec), L = laneOf(m);
    if (action === 'enroll') {
      if (p) return 'full';
      const sq = m.armies[side].find(q => q.id === args[0]), u = sq && m.units[sq.unit];
      if (sq && sq.school && sq.school.key === rec.key) return null; // (Undo all replays it on a lane where it went in already)
      if (!sq || !u || u.building || G.isRider(sq) || G.riderOf(m, side, sq) || G.mpbHeld(sq) || sq.movedRound === m.round || G.footprint(m, sq.unit) > 1) return 'squad';
      return null;
    }
    const sq = p && p.lane === L ? pupilSq(m, side, rec) : null;
    if (!sq) return 'none';
    if (action === 'leave' && !sq.school) return p.learn ? 'learning' : null; // (Undo all replays it on a lane where it came out already)
    if (!sq.school) return 'none';
    if (action === 'leave') {
      if (p.learn) return 'learning';
      if (args.length && !(args.length === 2 && Number.isInteger(args[0]) && Number.isInteger(args[1]))) return 'tile';
      const t = homeTile([m], side, sq, args.length ? { col: args[0], row: args[1] } : { col: sq.school.col, row: sq.school.row });
      if (!t || (args.length && (t.col !== args[0] || t.row !== args[1]))) return 'tile';
      return null;
    }
    if (action === 'learn') return p.learn ? 'learning' : learnable(m, side, sq).includes(args[0]) ? null : 'skill';
    if (action === 'unlearn') return p.learn && p.learn.round === m.round ? null : 'none';
    return 'none';
  }
  def({ id: 'school', name: 'School', short: 'sch', kind: 'support', hp: SCHOOL.hp, armor: SCHOOL.armor, color: '#A8443A',
    text: `Holds 1 squad of yours (either of you): it doesn’t fight, and its player can’t place another squad of that unit type while it is inside. Study (free): a level’s worth of XP every round. Learn (free): a skill of its unit, ready ${SCHOOL.learn} rounds later; it can’t leave meanwhile.`,
    downside: 'Destroyed: the squad that destroyed it gets half a level’s XP; the squad inside comes out with the XP and level it went in with (a skill being learnt is lost).',
    skills: [
      { id: 'double', name: 'Double study', cost: SCHOOL.doubleCost, per: 'match', text: 'The squad inside gets twice the XP every round.' },
      { id: 'fast', name: 'Quick learning', cost: SCHOOL.fastCost, per: 'match', text: `A skill is learnt in ${SCHOOL.fastLearn} round instead of ${SCHOOL.learn}.` },
    ],
    hooks: {
      canAct: (m, side, rec, action, args) => !schoolWhy(m, side, rec, action, args),
      act(m, side, rec, action, args, lane) {
        if (action === 'enroll') {
          const sq = m.armies[side].find(q => q.id === args[0]);
          if (!sq.school) {
            sq.school = { key: rec.key, round: m.round, col: sq.col, row: sq.row, xp: sq.xp, level: sq.level || 0 };
            sq.col = rec.col; sq.row = rec.row; delete sq.aim;
          }
          rec.data.pupil = { lane, id: sq.id, ui: sq.unit, round: sq.school.round, learn: null, sq: clone(sq.school) };
          return true;
        }
        const p = pupilOf(rec), sq = pupilSq(m, side, rec);
        if (action === 'leave') {
          if (!rec.data.was) rec.data.was = [];
          rec.data.was.push({ round: m.round, pupil: clone(p), school: clone(p.sq || sq.school) });
          if (sq.school) {
            const t = homeTile([m], side, sq, args.length ? { col: args[0], row: args[1] } : { col: sq.school.col, row: sq.school.row });
            delete sq.school; sq.col = t.col; sq.row = t.row;
          }
          rec.data.pupil = null;
          return true;
        }
        if (action === 'learn') { p.learn = { k: args[0], round: m.round }; return true; }
        if (action === 'unlearn') { p.learn = null; return true; }
        return false;
      },
      squadBodies(m, side, rec, sq, list) { if (sq.school && sq.school.key === rec.key) list.length = 0; },
      // after Undo all: the pupil is the squad its record says; any other squad marked in it comes out (on its tile, or
      // the nearest free one), a pupil whose squad isn't marked (or is gone) leaves the record
      reconcile(lanes, side, rec) {
        let did = false;
        const p = pupilOf(rec);
        lanes.forEach((m, L) => {
          for (const q of m.armies[side]) {
            if (!q.school || q.school.key !== rec.key || (p && p.lane === L && p.id === q.id)) continue;
            const s = q.school;
            delete q.school;
            const t = homeTile(lanes, side, q, { col: s.col, row: s.row }) || { col: s.col, row: s.row };
            q.col = t.col; q.row = t.row; did = true;
          }
        });
        const sq = p && laneSquad(lanes, p.lane, side, p.id);
        if (p && !(sq && sq.school && sq.school.key === rec.key)) { rec.data.pupil = null; did = true; }
        return did;
      },
      // who destroys it: the Engine notes the squad that cut it down (opts.mpb.watchKills, b.watchKill)
      bodies(m, side, rec, ctx) { const out = ctx.main(); for (const b of out) b.watchKill = true; return out; },
      battleOpts(m, side, rec, opts) { opts.mpb.watchKills = true; },
      roundStart(lanes, side, rec) {
        rec.data.was = [];
        const p = pupilOf(rec);
        if (!p) return;
        const m = lanes[p.lane], sq = m && m.armies[side].find(q => q.id === p.id && q.school);
        if (!sq) { rec.data.pupil = null; return; }
        const round = lanes[0].round;
        if (p.learn && round >= p.learn.round + learnRounds(rec)) { // learnt: the skill is its unit type's, as if bought last round
          if (!G.hasSkill(m, side, sq.unit, p.learn.k)) {
            if (!m.tech) m.tech = [{}, {}];
            const t = m.tech[side][sq.unit] || (m.tech[side][sq.unit] = E.SLOTS.map(() => 0));
            t[p.learn.k] = Math.max(1, round - 1);
          }
          p.learn = null;
        }
        sq.xp += levelXp(m, sq) * (skillN(rec, 'double') ? 2 : 1); // Study
      },
      afterFight(lanes, side, rec, res, sums, round) {
        if (rec.fell !== round) return;
        const k = recs(lanes[0], side).indexOf(rec), kill = ((res && res.killedBy) || []).find(x => x.side === side && x.squad === squadOf(k)), by = kill && kill.by;
        let got = null;
        if (by && by.squad >= 0) { // the squad that cut it down (its lane from its id in the fight)
          const lane = by.squad >= LANE_OFF ? 1 : 0, q = laneSquad(lanes, lane, by.side, lane ? by.squad - LANE_OFF : by.squad);
          if (q) { const x = Math.floor(levelXp(lanes[lane], q) * SCHOOL.destroyXp); q.xp += x; got = { lane, id: q.id, unit: q.unit, xp: x }; }
        }
        const p = pupilOf(rec), sq = p && laneSquad(lanes, p.lane, side, p.id);
        let out = null;
        if (sq && sq.school) { // out it comes, as it went in
          const s = sq.school;
          sq.xp = s.xp; sq.level = s.level;
          delete sq.school;
          const t = homeTile(lanes, side, sq, { col: s.col, row: s.row }) || { col: s.col, row: s.row };
          sq.col = t.col; sq.row = t.row;
          out = { lane: p.lane, id: sq.id, unit: sq.unit };
        }
        rec.data.pupil = null;
        const nm = (ui) => (lanes[0].units[ui] || {}).name || 'squad';
        news(sums, side, { kind: 'school', xp: got, out, text: `Team ${TEAM_LETTER[side]}’s School was destroyed${got ? `: the ${nm(got.unit)} that did it got ${got.xp} XP` : ''}${out ? `${got ? ';' : ':'} the ${nm(out.unit)} inside lost what it gained there` : ''}.` });
      },
      // the opponents don't see this round's comings and goings until the fight
      hide(s, h, rec) {
        const p = pupilOf(rec), L = laneOf(s);
        if (p && p.round === s.round) {
          rec.data.pupil = null;
          const q = p.lane === L && s.armies[h].find(x => x.id === p.id && x.school);
          if (q) { q.col = q.school.col; q.row = q.school.row; delete q.school; }
        } else if (p && p.learn && p.learn.round === s.round) p.learn = null;
        for (const w of rec.data.was || []) {
          if (w.round !== s.round || w.pupil.round >= s.round) continue;
          rec.data.pupil = w.pupil;
          const q = w.pupil.lane === L && s.armies[h].find(x => x.id === w.pupil.id);
          if (q) { q.school = w.school; q.col = rec.col; q.row = rec.row; }
        }
        rec.data.was = [];
      },
      info(m, side, rec) {
        const p = pupilOf(rec), sq = pupilSq(m, side, rec);
        if (!p || !sq) return ['Empty'];
        return [`${(m.units[sq.unit] || {}).name} inside since round ${p.round}`, p.learn ? `learning ${((G.skillDef(m, sq.unit, p.learn.k) || {}).name) || 'a skill'}` : ''].filter(Boolean);
      },
      // a bot: sometimes puts its most experienced squad in, learns a skill, takes it out after a few rounds
      bot(m, side, rec) {
        const r = rng(((m.seed || 0) + m.round * 6029 + side * 97 + laneOf(m) * 17) >>> 0), L = laneOf(m), p = pupilOf(rec);
        if (!p && r() < 0.35) {
          const ok = m.armies[side].filter(q => q.round < m.round && !schoolWhy(m, side, rec, 'enroll', [q.id])).sort((a, b) => b.xp - a.xp || a.id - b.id);
          if (ok.length) mpbAct(m, side, rec.key, 'enroll', ok[0].id);
        } else if (p && p.lane === L) {
          const sq = pupilSq(m, side, rec), ks = sq && !p.learn ? learnable(m, side, sq) : [];
          if (ks.length && r() < 0.6) mpbAct(m, side, rec.key, 'learn', ks[Math.floor(r() * ks.length)]);
          else if (!p.learn && m.round - p.round >= 3 && r() < 0.5) mpbAct(m, side, rec.key, 'leave');
        }
        for (const id of ['double', 'fast']) if (pupilOf(rec) && canBuy(m, side, rec.key, id) && m.gold[side] >= skillOf('school', id).cost + 200 && r() < 0.25) mpbBuy(m, side, rec.key, id);
      },
    },
  });

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
  // every tile a building takes, with its part ('' for the building itself)
  const tilesOf = (rec) => [{ col: rec.col, row: rec.row, part: '' }].concat(Object.entries(rec.parts || {}).map(([p, t]) => ({ col: t.col, row: t.row, part: p })));
  // the building (and part) on a tile, either side: { side, rec, part } or null
  function recAt(m, col, row) {
    for (const side of [0, 1]) for (const rec of recs(m, side)) for (const t of tilesOf(rec)) if (t.col === col && t.row === row) return { side, rec, part: t.part };
    return null;
  }
  // Game.mpbAt: a tile no squad of either team may take (a kind's place.open leaves its tiles free, for its own rules)
  const at = (m, col, row) => { const x = recAt(m, col, row); return !!x && !(kindOf(x.rec.kind) || {}).place.open; };

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
      for (const r of recs(m, sd)) out.push(...tilesOf(r));
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
    for (const rec of recs(m, 1 - side)) { const K = kindOf(rec.kind); if (K && K.hooks.foeSquadBodies) K.hooks.foeSquadBodies(m, 1 - side, rec, sq, list, u); } // the other team's buildings on this squad (the Jail: it sits the fight out)
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
  // a bot's turn (Duo.botTurn, before Game.aiDeploy): each of its team's buildings may use its skills (hooks.bot)
  function botTurn(m, side) {
    if (!on(m)) return;
    for (const rec of recs(m, side).slice()) { const K = kindOf(rec.kind); if (K && K.hooks.bot) K.hooks.bot(m, side, rec); }
  }
  // after Undo all (Duo.rebuildTeam): the team's part was replayed, a lane's squads put back; a kind whose record and
  // squads must agree puts them right (hooks.reconcile(lanes, side, rec), lanes[0]'s record; then copied to lane 1)
  function reconcile(lanes) {
    if (!on(lanes[0])) return;
    for (const side of [0, 1]) {
      let did = false;
      for (const rec of recs(lanes[0], side)) { const K = kindOf(rec.kind); if (K && K.hooks.reconcile) did = K.hooks.reconcile(lanes, side, rec) || did; }
      if (did) for (const L of lanes.slice(1)) L.mpb[side] = clone(lanes[0].mpb[side]);
    }
  }
  // tiles a building lights up on the board (the Jail's Skywatch; hooks.lit): [{ col, row }], drawn by both renderers
  const litTiles = (m, side, rec) => { const K = kindOf(rec.kind); return (K && K.hooks.lit && K.hooks.lit(m, side, rec)) || []; };
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
    def, kindOf, recs, recOf, has, skillOf, skillN, addRec, tilesOf, recAt, at, init,
    interior, spaced, spotOk, spots, autoSpot,
    voteQueue, voteHead, queue, placeHead, mpbVote, voteResult,
    skillCost, whyNot, canBuy, mpbBuy, canUndo, mpbUndo, mpbAct,
    vaultOf, vaultRec, vaultMode, vaultMoved, vaultRoom, canVault, vaultPut, vaultTake, golemOf, golemUnit, golemSkin,
    hide, unitOf, squadOf, extraOf, indexOf, isSquad, bodies, battleOpts, squadMods, squadBodies, news, afterFight, roundStart, botTurn, litTiles, reconcile,
    JAIL, jailWhy, jailable, jailSeen, homeTile, SCHOOL, pupilOf, pupilSq, levelXp, learnable, schoolWhy,
    cardPool, cardName, cardText, rollArtifacts, artifactsFor,
    dealDraft, draftOpen, draftTurn, giveCard, applyDraft, draftPick, botPick, rng, laneOf, on,
  };
  // the player actions (Referee.ACTIONS lists them) and the hooks Game calls (occupied, bodiesFor, Referee.hide)
  Object.assign(G, { mpbBuy, mpbUndo, mpbAct, mpbVote, vaultPut, vaultTake, draftPick });
  if (G.setMpb) G.setMpb(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Mpb = api;
})(typeof window !== 'undefined' ? window : globalThis);
