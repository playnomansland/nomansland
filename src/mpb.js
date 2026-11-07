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
  // = Duo.OFF (Game.TEAM_ID): lane 1's squad ids in a fight, and the other lane's in a lane's m.team, are moved by this
  const LANE_OFF = G.TEAM_ID || 1000000;
  const SPACING = 3;                           // Chebyshev distance from every other building tile ("2 tiles around")
  const ARTIFACT = { rounds: [2, 8], r: 9, cap: 100, gold: 50, apart: 10 };
  const DRAFT_ROUNDS = [3, 9];                 // the cards of round 2's artifacts are dealt in round 3, round 8's in 9
  const VAULT_SPOT = [{ col: 6, row: 16 }, { col: 17, row: 2 }]; // the old 2v2 treasury tiles (README, 2026-11-05; side 0's a row down on the 19-row board, 2026-11-07)
  const PER = ['round', 'roundPlayer', 'match', 'building', 'free'];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const laneOf = (m) => (m && m.duoLane === 1 ? 1 : 0);
  const on = (m) => !!(m && Array.isArray(m.mpb));
  const grid = (m) => { G.useGrid(m); return { COLS: G.COLS, ROWS: G.ROWS }; };

  // =====================================================================
  // The kinds. One entry per kind, each in its own marked region (B groups fill theirs). Fields:
  //   id, name, short (key prefix), kind ('economic' | 'support' | 'technical' | 'defensive'), text, downside, hp,
  //   armor, color (2D and the default 3D tint), draft (false: never a card), skills: [{ id, name, cost, costStep, costRise,
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
        if (!rec.data.golem || rec.data.golem.round === s.round) delete rec.data.golem; // (as when the round began: no key, not null)
      },
      info(m, side, rec) {
        const v = vaultOf(m, side), g = golemOf(m, side);
        return [`${v ? v.gold : 0} gold inside`, g ? `Coin Golem this round: ${g.g} gold (${golemSkin(g.g)})` : ''].filter(Boolean);
      },
    },
  });

  // ===== treeKojja =====
  // A small watchtower in a tree (Vilhelm, 6 Nov): it shoots like the Outpost (its hit and attack speed) with
  // KOJJA.range m and sees stealthed units within that range (Engine u.trueSight).
  // Grow (KOJJA.growCost, once a round for the team): the buyer places another kojja within KOJJA.grow tiles
  // (Chebyshev) of one of the team's kojjas: own zone, no 2-tile spacing, on their own (Mpb.queue with the buyer's
  // lane: no vote). The first kojja (from the draft) keeps the usual rules (interior, spacing).
  // Nest (KOJJA.nestCost, once per kojja): the kojja holds one ranged squad (range over KOJJA.ranged m, the Engine's
  // melee reach) of either player, placed or moved onto its tile (hooks.holds -> Game.garrisonFree). In a fight one
  // body of it shoots from inside (the rest of the squad rides in that body: hooks.link, Engine b.nest), with
  // +KOJJA.nestRange m and stealth sight in range; after Engine.WATCH_IDLE s seeing no enemy, or when the kojja falls,
  // the whole squad steps out and fights on foot.
  // Downside: destroyed in a fight, it stands for the opponents the next round: the kojja is away that round
  // (rec.away, rec.data.turned = the round) and a record in the opponents' list stands in for it (rec.data.ghost = the
  // kojja's key; one per kojja, used again each time): it shoots for them, they may buy Nest on it (a Nest the owners
  // bought comes with it) and put a ranged squad of theirs in it. The round after, it is the owners' again (the
  // opponents' Nest goes with the stand-in). A squad standing on a kojja when it changes hands steps out at the
  // round's start to the nearest free tile of its own zone.
  // Take-backs (hooks.canUndo): Nest not while a squad stands in it; Grow not once a skill was bought on the new kojja.
  const KOJJA = { hp: 500, armor: 0, range: 20, nestRange: 3, ranged: 5, grow: 3, growCost: 100, nestCost: 50, botGold: 150 };
  const isGhost = (rec) => !!(rec && rec.data && rec.data.ghost);
  // the team's own kojjas standing this round (not one standing for the other team, nor one taken back)
  const ownKojjas = (m, side) => recs(m, side).filter(r => r.kind === 'treeKojja' && !r.away && !isGhost(r));
  const ghostOf = (m, side, rec) => recs(m, 1 - side).find(r => r.kind === 'treeKojja' && r.data.ghost === rec.key) || null;
  const nestOn = (rec) => skillN(rec, 'nest') > 0;
  const rangedUnit = (m, side, ui) => { const u = m && m.units && m.units[ui]; return !!u && !u.building && G.unitFor(m, side, ui).range > KOJJA.ranged; };
  function kojjaUnit() {
    const o = G.OUTPOST.unit;
    return E.withTraits({ name: 'Tree kojja', cost: 0, bodies: 1, hp: KOJJA.hp, hit: o.hit, aps: o.aps, range: KOJJA.range, speed: 0, splash: o.splash || 0, projSpeed: o.projSpeed || 0,
      shape: 'square', color: '#6B8E3D', structure: true, lesser: true, trueSight: true, kind: 'mpb', mpb: 'treeKojja', level: 0 });
  }
  // the nearest tile (Chebyshev rings round col, row) of side's own zone with nothing on it in either lane
  function freeTileNear(lanes, side, col, row) {
    const m = lanes[0], { COLS, ROWS } = grid(m);
    const busy = (c, r) => G.terrainBlocks(m, c, r) || !!recAt(m, c, r) || lanes.some(L => G.occupied(L, side, c, r) || G.occupied(L, 1 - side, c, r));
    for (let d = 1; d < Math.max(COLS, ROWS); d++) for (let r = row - d; r <= row + d; r++) for (let c = col - d; c <= col + d; c++) {
      if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== d || !inBoard(c, r) || !G.inZone(side, r) || G.reserved(side, c, r)) continue;
      if (!busy(c, r)) return { col: c, row: r };
    }
    return null;
  }
  // side's squads (both lanes) standing on (col, row) step out to the nearest free tile of their own zone
  function evict(lanes, side, col, row) {
    for (const L of lanes) for (const q of L.armies[side] || []) {
      if (q.col !== col || q.row !== row || G.isRider(q)) continue;
      const t = freeTileNear(lanes, side, col, row);
      if (t) { q.col = t.col; q.row = t.row; }
    }
  }
  // the squad standing in a kojja (either lane's: this lane's own or its m.team copy of the other's), or null
  const nestSquad = (m, side, rec) => (m.armies[side] || []).concat(G.teamArmy(m, side)).find(q => q.col === rec.col && q.row === rec.row && !G.isRider(q)) || null;
  // the kojja player `lane` grew this round (with rec's Grow), or null
  const grownBy = (m, side, rec, lane) => ownKojjas(m, side).find(r => r.round === m.round && r.data.lane === lane && r !== rec) || null;
  def({ id: 'treeKojja', name: 'Tree kojja', short: 'tk', kind: 'defensive', hp: KOJJA.hp, armor: KOJJA.armor, color: '#6B8E3D',
    text: `A small watchtower: shoots like the Outpost with ${KOJJA.range} m range and sees stealthed units within it.`,
    downside: 'Destroyed: the next round it works for the opponents (they may use its Nest, even on your board).',
    place: { where: 'own', spacing: false }, // the first one: interior and spacing all the same (hooks.spotOk)
    skills: [
      { id: 'grow', name: 'Grow another', cost: KOJJA.growCost, per: 'round', text: `Place a new Tree kojja within ${KOJJA.grow} tiles of one of your kojjas (the one who buys it places it; no 2-tile room needed). Once a round for the team.` },
      { id: 'nest', name: 'Nest', cost: KOJJA.nestCost, per: 'building', text: `This kojja holds 1 ranged squad (yours or your teammate’s: put it on the kojja). It shoots from 1 body, +${KOJJA.nestRange} m range, and sees stealth. After ${E.WATCH_IDLE} s with no enemy in sight it steps out with all its bodies.` },
    ],
    hooks: {
      unit: () => kojjaUnit(),
      spotOk(m, side, part, col, row) {
        const mine = ownKojjas(m, side);
        if (!mine.length) return interior(side, col, row) && spaced(m, col, row);
        return mine.some(r => Math.max(Math.abs(r.col - col), Math.abs(r.row - row)) <= KOJJA.grow);
      },
      canBuy(m, side, rec, sk) {
        if (rec.away) return false; // standing for the other team this round (or taken back)
        if (sk.id !== 'grow') return true;
        if (isGhost(rec) || ownKojjas(m, side).some(r => thisRound(m, r.skills.grow).length)) return false; // once a round for the team
        if (voteQueue(m, side).some(e => e.kind === 'treeKojja')) return false;
        return spots(m, side, 'treeKojja', null).length > 0;
      },
      // (the queue entry is hidden from the opponents as the click is: Mpb.hide drops entries with `skill`)
      bought(m, side, rec, sk, args, lane) { if (sk.id === 'grow') queue(m, side, 'treeKojja', null, null, lane, true); },
      // no take-back of Nest while a squad stands in the kojja (it would be left on a building's tile; as Overwatch,
      // game.js), nor of Grow once someone bought a skill on the new kojja (that gold would be stuck on it)
      canUndo(m, side, rec, id, lane) {
        if (id === 'nest') return !nestSquad(m, side, rec);
        const g = id === 'grow' && grownBy(m, side, rec, lane);
        return !g || !Object.values(g.skills).some(e => thisRound(m, e).length);
      },
      // Grow taken back: the kojja it was to place (or has placed) goes
      unbuy(m, side, rec, sk, lane) {
        if (sk.id !== 'grow') return;
        const q = voteQueue(m, side), i = q.findIndex(e => e.kind === 'treeKojja' && e.lane === lane);
        if (i >= 0) { q.splice(i, 1); return; }
        const g = grownBy(m, side, rec, lane);
        if (g) { g.away = true; g.data.undone = m.round; }
      },
      // the opponents never see a kojja that was grown and taken back
      hide: (s, h, rec) => !rec.data.undone,
      fellText: (m, side, rec) => `Destroyed in round ${rec.fell}’s fight: the round after, it stands for the other team; then it is back.`,
      holds: (m, side, rec, ui) => nestOn(rec) && (ui == null || rangedUnit(m, side, ui)),
      // the squad on a kojja with Nest: its bodies are marked for link (both lanes' squads, before their ids are moved)
      squadBodies(m, side, rec, sq, list, u) {
        if (rec.away || !nestOn(rec) || sq.col !== rec.col || sq.row !== rec.row || G.isRider(sq) || !(u.range > KOJJA.ranged)) return;
        for (const b of list) b.nestOf = rec.key;
      },
      bodies(m, side, rec, ctx) { const out = ctx.main(); for (const b of out) b.mpbKey = rec.key; return out; },
      // one body inside, the rest of the squad riding in it (Engine: b.inside, b.nest; boarded bodies)
      link(m, side, rec, list) {
        const host = list.find(b => b.mpbKey === rec.key), all = list.filter(b => b.nestOf === rec.key), first = all.length ? all[0].squad : null;
        const mine = all.filter(b => b.squad === first); // one squad only (two on the tile never share it: they fight as they are)
        for (const b of all) if (b.squad !== first) delete b.nestOf;
        if (!host || !mine.length) return;
        for (const b of mine) if (b.inside && b.inside.u.kind === 'watchtower') { const i = list.indexOf(b.inside); if (i >= 0) list.splice(i, 1); } // (an Overwatch squad: the kojja instead of a watchtower)
        const [lead, ...rest] = mine;
        lead.inside = host; lead.x = host.x; lead.y = host.y; lead.delay = 0;
        lead.nest = { range: KOJJA.nestRange, sight: lead.u.trueSight };
        lead.u = { ...lead.u, range: lead.u.range + KOJJA.nestRange, trueSight: true };
        for (const b of rest) { b.inside = null; b.boarded = true; b.alive = false; b.carrier = lead; b.x = host.x; b.y = host.y; b.delay = 0; }
      },
      afterFight(lanes, side, rec, res, sums, round) {
        if (rec.fell === round && !isGhost(rec)) news(sums, side, { kind: 'treeKojja', key: rec.key, text: 'A Tree kojja was destroyed: next round it stands for the other team.' });
      },
      roundStart(lanes, side, rec) {
        const m = lanes[0];
        if (isGhost(rec) || rec.data.undone) return;
        const g = ghostOf(m, side, rec);
        if (rec.away && rec.data.turned < m.round) { // back from the other team; a squad of theirs in it steps out
          delete rec.away;
          if (g) { g.away = true; evict(lanes, 1 - side, rec.col, rec.row); }
        }
        if (!rec.away && rec.fell && rec.fell === m.round - 1) { // destroyed in the last fight: it stands for the opponents this round
          rec.away = true; rec.data.turned = m.round;
          evict(lanes, side, rec.col, rec.row);
          const gh = g || addRec(m, 1 - side, 'treeKojja', rec.col, rec.row);
          delete gh.away; gh.col = rec.col; gh.row = rec.row; gh.round = m.round; gh.fell = 0;
          gh.data = { ghost: rec.key, turned: m.round };
          gh.skills = nestOn(rec) ? { nest: { round: 0, n: 1, by: [0, 0], log: [] } } : {};
        }
      },
      info(m, side, rec) {
        const sq = nestSquad(m, side, rec);
        return [isGhost(rec) ? 'Taken from the other team: it stands for this team this round only.' : '',
          nestOn(rec) ? (sq ? `In it: ${(m.units[sq.unit] || {}).name || 'a squad'}` : 'Nest: room for 1 ranged squad') : ''].filter(Boolean);
      },
      // a bot: Nest now and then and a ranged squad of its own in it; Grow now and then
      bot(m, side, rec, r) {
        if (rec.away) return;
        if (!nestOn(rec) && r() < 0.5 && m.gold[side] >= KOJJA.nestCost + KOJJA.botGold) mpbBuy(m, side, rec.key, 'nest');
        if (nestOn(rec) && r() < 0.6 && m.gold[side] >= KOJJA.botGold) {
          const can = m.units.map((u, ui) => ui).filter(ui => rangedUnit(m, side, ui) && G.garrisonFree(m, side, rec.col, rec.row, ui));
          while (can.length) { const ui = can.splice(Math.floor(r() * can.length), 1)[0]; if (G.place(m, side, ui, rec.col, rec.row)) break; }
        }
        if (!isGhost(rec) && r() < 0.25 && m.gold[side] >= KOJJA.growCost + KOJJA.botGold) mpbBuy(m, side, rec.key, 'grow');
      },
    },
  });

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
  // the team's squad (lane, id) as this lane sees it (the teammate's in m.team), or null
  const fhSquad = (m, side, lane, id) => lane === laneOf(m) ? (m.armies[side] || []).find(q => q.id === id) || null : ((m.team && m.team.armies && m.team.armies[side]) || []).find(q => q.id === id + LANE_OFF) || null;
  // Second wind's target: its unit type is kept with it (u; -1: no such squad), so a squad id used again after an Undo
  // all is no target (a squad gone by the fight just doesn't come back)
  const fhWindOf = (m, side, lane, id) => { const q = fhSquad(m, side, lane, id); return { round: m.round, lane, id, u: q ? q.unit : -1 }; };
  const fhPick = (m, side, args) => fhTarget(args) && (!!m.mpbReplay || !!fhSquad(m, side, args[0], args[1])); // (Undo all replays the teammate's buy as it was)
  def({ id: 'fieldHospital', name: 'Field hospital', short: 'fh', kind: 'support', hp: 600, armor: 2, color: '#E8E2D0',
    text: `Squads deployed within 1 tile: +${FH.hp}% health and ${FH.regen}% health a second in the fight. Each round your team wins with it standing: +${FH.win} Team HP. Can’t shoot.`,
    downside: `Destroyed: −${FH.lose} Team HP.`,
    skills: [
      { id: 'dress', name: 'Field dressing', cost: 50, costStep: 50, per: 'free', text: `A random allied squad (yours or your teammate’s) gets +${FH.dress}% health for this round’s fight. Click as often as you like.` },
      { id: 'wind', name: 'Second wind', cost: 100, per: 'round', pick: true, text: 'Pick an allied squad: the first time it is wiped out in this round’s fight, it comes back whole on the tile in front of the hospital.' },
    ],
    hooks: {
      canBuy: (m, side, rec, sk, args) => sk.id !== 'wind' || fhPick(m, side, args), // the squad: (lane, id), one of the team's
      bought(m, side, rec, sk, args) { if (sk.id === 'wind') rec.data.wind = fhWindOf(m, side, args[0], args[1]); },
      unbuy(m, side, rec, sk) { if (sk.id === 'wind') rec.data.wind = null; },
      // pick another squad for this round's Second wind (either of you)
      canAct: (m, side, rec, action, args) => action === 'wind' && !!fhWind(m, rec) && fhPick(m, side, args),
      act(m, side, rec, action, args) { rec.data.wind = fhWindOf(m, side, args[0], args[1]); return true; },
      squadMods(m, side, rec, sq, u) {
        if (!fhNear(rec, sq) || G.isRider(sq)) return u;
        return { ...u, hp: u.hp * (1 + FH.hp / 100), regen: (u.regen || 0) + FH.regen };
      },
      squadBodies(m, side, rec, sq, list) {
        const w = fhWind(m, rec);
        if (!w || w.lane !== laneOf(m) || w.id !== sq.id || (w.u != null && w.u !== sq.unit)) return;
        const at = G.tileToWorld(fhFront(rec, side).col, fhFront(rec, side).row);
        for (const b of list) b.fhRevive = { x: at.x, y: at.y };
      },
      // Field dressing: one seeded number a click (the Engine picks the squad from all the side's squads in the fight)
      battleOpts(m, side, rec, opts) {
        const o = opts.mpb.fieldHospital || (opts.mpb.fieldHospital = { dress: [[], []], pct: FH.dress });
        // seeded from m.fhSeed (Duo.runFight sets it from the duo's D.secret, which no seat's view holds, just before
        // the fight, so nobody can work the picks out while deploying; the fight's snapshots carry it), else the match's seed
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
      hide(s, h, rec) { if (!rec.data.wind || rec.data.wind.round === s.round) delete rec.data.wind; }, // (no key, not null: nothing to tell apart)
      info(m, side, rec) {
        const w = fhWind(m, rec), d = fhClicks(m, rec, 'dress');
        return [d ? `Field dressing this round: ${d}×` : '', w ? `Second wind this round: squad ${w.id} of ${w.lane === laneOf(m) ? 'yours' : 'your teammate’s'}` : ''];
      },
      // a bot (Duo.botTurn): Field dressing now and then, Second wind on its dearest squad when it is rich
      botAfter(m, side, rec, r0) {
        const r = r0 || rng(((m.seed >>> 0) + m.round * 131 + laneOf(m) * 17 + 5) >>> 0); // (r0: Duo.botTurn's stream, seeded from D.seed: in no view)
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
  // A squad whose tile at the exit is taken as the fight starts (a squad of either team, or a building's units standing
  // there: the other lane's Factory, Jail guards, a golem: Engine mineTo; a building,
  // water or a Bastion wall: mineOut), or whose exit tile itself is taken, doesn't go in (Vilhelm, 6 Nov: "the mine
  // exit tiles can be blocked and any units that would end up on the blocked tile simply do not go through the mine to
  // begin with"). So the exit and its ring never make anything move at the fight's start (place.parts' stays). Rogues,
  // Assassins and Shadowhands of a team with a Shadow Den come up without the COAL.rise wait. The entrance is a structure that can be destroyed (squads already on their way still come up); the exit is a shaft on
  // the board, not a fight body. Skills: Dig a new exit (move it; a flank tile of the enemy's half too), Fresh
  // air (squads coming up faster and tougher for a while).
  // Destroyed in a fight (2026-11-07, Vilhelm): the mine is shut the next round (cmResting): nobody goes down it or
  // comes up, but it still stands in the fight as a target, its exit still blocks its ring, and both skills can still
  // be bought. Destroyed again that round: shut again the round after.
  // Dig a new exit (2026-11-07): once a round per mine, each dig 50 gold more than the last (moveRise: per earlier dig
  // of this mine this match, Mpb.skillCost's costRise); rec.data.digs = moves made, so a dig bought is one move. A dig
  // is used the round it is bought: one bought and not used is lost as the next round begins (rec.data.lapsed, roundStart).
  const COAL = { hp: 700, armor: 4, travel: 2, rise: 1.5, moveCost: 150, moveRise: 50, airCost: 200, air: { speed: 25, armor: 4, secs: 5 } };
  const cmResting = (m, rec) => !!rec && rec.fell > 0 && rec.fell === m.round - 1;
  const exitOf = (rec) => (rec && rec.parts && rec.parts.exit) || null;
  const cheb = (c0, r0, c1, r1) => Math.max(Math.abs(c0 - c1), Math.abs(r0 - r1));
  // a tile the mine can't use as the fight starts: water, a building's tile (but the exit's own: exit), a Bastion wall
  // of either team put up on it (squads: the Engine, mineTo's tile and ex)
  const mineShut = (m, c, r, exit) => G.terrainBlocks(m, c, r) || buildingTiles(m).filter(t => t.col === c && t.row === r).length > (exit ? 1 : 0)
    || [0, 1].some(sd => G.bwallsFighting(m, sd).some(w => w.col === c && w.row === r));
  // the tile a squad on (col, row) comes up on, or null (not round the entrance, no exit yet, off the board, that tile
  // or the exit's own is water, a building's or a wall's: the squad stays home)
  function mineOut(m, rec, col, row) {
    const x = exitOf(rec);
    if (!x || rec.col < 0 || cheb(col, row, rec.col, rec.row) !== 1) return null;
    grid(m);
    const c = x.col + col - rec.col, r = x.row + row - rec.row;
    if (!inBoard(c, r) || mineShut(m, x.col, x.row, true) || mineShut(m, c, r)) return null;
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
    if (!(nmlOk(col, row) || G.isFlank(side, col, row)) || nearArtifact(m, col, row)) return false;
    return exitFree(m, side, rec, col, row);
  }
  // this round's artifacts (rounds 2 and 8) on or next to (col, row): no exit there (it would keep the tiles round an
  // artifact free for one team only)
  const nearArtifact = (m, col, row) => !!(m.artifacts && m.artifacts.round === m.round && (m.artifacts.list || []).some(a => cheb(a.col, a.row, col, row) <= 1));
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
  // a dig bought and not used yet (one move for each buy: data.digs counts the moves, data.lapsed the ones lost), and
  // none made this round
  const digsLeft = (rec) => skillN(rec, 'shaft') - (rec.data.digs || 0) - (rec.data.lapsed || 0);
  const canMoveExit = (m, side, rec) => digsLeft(rec) > 0 && rec.data.moved !== m.round && !!exitOf(rec);
  def({ id: 'coalMine', name: 'Coal mine', short: 'cm', kind: 'technical', hp: COAL.hp, armor: COAL.armor, color: '#4A4440',
    text: `Squads deployed on the 8 tiles round the entrance go down the mine as the fight starts and come up round the exit in no man’s land ${COAL.travel} s later (on the matching tile), then stand ${COAL.rise} s before they fight (not Rogues, Assassins or Shadowhands with a Shadow Den).`,
    downside: 'No squad of either team may be deployed on the 8 tiles round its exit. If the exit, or the tile a squad would come up on, is taken (a squad or any other unit, a building, water or a wall, of either team), that squad doesn’t go down the mine: it fights from its own tile. Destroyed in a fight: the mine is shut the next round (nobody goes down it).',
    // (stays: the exit never moves at the fight's start and never makes anything move: it is just blocked, Duo.settleBoard)
    place: { where: 'interior', spacing: true, parts: [{ id: 'exit', name: 'exit', where: 'nml', spacing: false, stays: true }] },
    skills: [
      { id: 'shaft', name: 'Dig a new exit', cost: COAL.moveCost, costRise: COAL.moveRise, per: 'round', text: `Move the exit to any tile of no man’s land or a flank tile of the enemy’s half. Once a round; each dig costs ${COAL.moveRise} gold more than the last.` },
      { id: 'air', name: 'Fresh air', cost: COAL.airCost, per: 'match', text: `Squads coming up the mine move ${COAL.air.speed}% faster and have +${COAL.air.armor} armor for ${COAL.air.secs} s.` },
    ],
    COAL, mineOut, exitMoveOk, exitBackOk, exitSpots, canMoveExit, cmResting,
    hooks: {
      resting: (m, side, rec) => cmResting(m, rec),
      fellText: (m, side, rec) => cmResting(m, rec) ? `Destroyed in round ${rec.fell}’s fight: the mine is shut this round (nobody goes down it); it still stands in the fight.` : `Destroyed in round ${rec.fell}’s fight; it stands again in every fight.`,
      spotOk: (m, side, part, col, row) => part !== 'exit' || !nearArtifact(m, col, row),
      // the 8 tiles round the exit: no squad of either team (Game.occupied through Mpb.at)
      blocks(m, side, rec, col, row) { const x = exitOf(rec); return !!x && cheb(col, row, x.col, x.row) === 1; },
      // a squad round the entrance: its bodies go down (Engine mineTo; the Engine leaves out a squad whose tile at the
      // exit, or the exit's own tile (ex), a squad of either team stands on). Rogues, Assassins and Shadowhands of a team
      // with a Shadow Den come up without the wait (Vilhelm, 6 Nov: "Den removes the wait for rogues, assassins etc.";
      // the same units as the Den's no flank delay)
      squadBodies(m, side, rec, sq, list) {
        if (sq.in != null || !list.length || cmResting(m, rec)) return; // a rider goes with its carrier; a shut mine takes nobody
        const t = mineOut(m, rec, sq.col, sq.row);
        if (!t) return;
        const a = G.tileToWorld(sq.col, sq.row), b = G.tileToWorld(t.col, t.row), x0 = exitOf(rec), e = G.tileToWorld(x0.col, x0.row);
        const air = skillN(rec, 'air') > 0 ? { ...COAL.air } : null;
        const rise = denOf(m, side) && denUnit(m, sq.unit) ? 0 : COAL.rise;
        for (const x of list) x.mineTo = { x: b.x, y: b.y, dx: b.x - a.x, dy: b.y - a.y, h: G.TILE / 2, t: COAL.travel, rise, boost: air, ex: { x: e.x, y: e.y } };
      },
      // Dig a new exit: not while a dig bought is still unused, nor once the exit moved this round (so a dig taken back
      // is always the one this round's move used)
      canBuy: (m, side, rec, sk) => !!exitOf(rec) && (sk.id !== 'shaft' || (digsLeft(rec) <= 0 && rec.data.moved !== m.round)),
      // Dig a new exit taken back the round it was bought: the exit goes back too (refused once its old tile is taken)
      canUndo: (m, side, rec, id) => id !== 'shaft' || !(rec.data.moved === m.round && rec.data.from) || exitBackOk(m, side, rec, rec.data.from),
      // Undo all would put the exit back where it stood (restoreOk: was = the record as it would be again)
      restoreOk(m, side, rec, was) { const a = exitOf(rec), b = exitOf(was); return !b || (a && a.col === b.col && a.row === b.row) || exitBackOk(m, side, rec, b); },
      // (the record's data as the round began: data.was, kept by act)
      unbuy(m, side, rec, sk) { const w = rec.data.was; if (sk.id === 'shaft' && rec.data.moved === m.round && rec.data.from) { rec.parts.exit = { ...rec.data.from }; rec.data = w && w.round === m.round ? clone(w.data) : {}; } },
      canAct: (m, side, rec, action, args) => action === 'exit' && canMoveExit(m, side, rec) && exitMoveOk(m, side, rec, args[0], args[1]),
      act(m, side, rec, action, args, lane) {
        const was = clone(rec.data); // (once a round: canMoveExit)
        rec.data.was = { round: m.round, data: was };
        rec.data.from = { ...exitOf(rec) }; rec.data.moved = m.round; rec.data.by = lane; rec.data.digs = (was.digs || 0) + 1;
        rec.parts.exit = { col: args[0], row: args[1] };
        return true;
      },
      // the opponents (Mpb.seenList): an exit dug this round still stands on its old tile (its old ring too) until the
      // fight, and the record's data is as the round began (data.was: no dig keys, or an earlier dig's, and its count)
      seen(rec, round) {
        const d = rec.data || {}, dug = d.moved === round && d.from;
        if (!dug) return rec;
        return { ...rec, parts: { ...rec.parts, exit: { col: d.from.col, row: d.from.row } }, data: d.was && d.was.round === round ? clone(d.was.data) : {} };
      },
      // an earlier round's round-start copy goes (so the record as a round begins never holds one), and a dig bought
      // last round and not used is lost (a dig is used the round it is bought)
      roundStart(lanes, side, rec) {
        if (rec.data.was && rec.data.was.round !== lanes[0].round) delete rec.data.was;
        if (digsLeft(rec) > 0) rec.data.lapsed = (rec.data.lapsed || 0) + digsLeft(rec);
      },
      // bots: now and then one of the squads they put down this round goes round the entrance (down the mine), Fresh
      // air when they have gold to spare, and sometimes a new exit nearer the enemy
      botAfter(m, side, rec, r) {
        if (!exitOf(rec)) return;
        if (r() < 0.5 && !cmResting(m, rec)) { // (a shut mine: nobody goes down it this round)
          const sq = m.armies[side].find(q => q.round === m.round && q.in == null && !(m.units[q.unit] || {}).building && !mineOut(m, rec, q.col, q.row));
          const to = [];
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dc || dr) to.push({ col: rec.col + dc, row: rec.row + dr });
          if (sq) for (const t of to.sort((a, b) => (side === 0 ? a.row - b.row : b.row - a.row) || Math.abs(a.col - rec.col) - Math.abs(b.col - rec.col) || a.col - b.col)) if (mineOut(m, rec, t.col, t.row) && G.moveSquad(m, side, sq.id, t.col, t.row)) break;
        }
        const spare = () => m.gold[side] - G.CARRY_CAP / 2;
        if (!skillN(rec, 'air') && spare() >= COAL.airCost && r() < 0.35) G.mpbBuy(m, side, rec.key, 'air');
        if (canBuy(m, side, rec.key, 'shaft') && spare() >= skillCost(m, side, rec.key, 'shaft') && r() < (skillN(rec, 'shaft') ? 0.08 : 0.2)) { // (again now and then: each dig costs more)
          const fwd = (t) => side === 0 ? t.row : G.ROWS - 1 - t.row, mid = (G.COLS - 1) / 2; // nearer the enemy: smaller
          const best = exitSpots(m, side, rec).filter(t => !G.isFlank(side, t.col, t.row)).sort((a, b) => fwd(a) - fwd(b) || Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.col - b.col)[0];
          if (best && G.mpbBuy(m, side, rec.key, 'shaft')) G.mpbAct(m, side, rec.key, 'exit', best.col, best.row);
        }
      },
      info(m, side, rec) {
        const x = exitOf(rec);
        const n = rec.data.digs || 0; // (moves made; the opponents get the count as the round began: seen)
        return [cmResting(m, rec) ? `Shut this round: destroyed in round ${rec.fell}’s fight, nobody goes down it` : '', x ? `Exit at column ${x.col + 1}, row ${x.row + 1}` : 'No exit yet',
          canMoveExit(m, side, rec) ? 'A dig is ready: move the exit' : rec.data.moved === m.round ? 'The exit was moved this round' : '',
          n ? `Dug ${n} time${n > 1 ? 's' : ''}` : '', skillN(rec, 'air') ? 'Fresh air' : ''].filter(Boolean);
      },
    },
  });

  // ===== scorch =====
  // Scorch turrets (Vilhelm, 6 Nov): the card gives the team two, one for each player, who places it alone
  // (hooks.acquire: Mpb.queue with the player's lane; interior and spacing as any building; rec.data.lane = whose).
  // Each player places theirs when they like (Mpb.voteEntry: neither waits for the other's).
  // A turret fights as one body of the match's Ember Imps with Spitfire (burn), its shots instant, +SCORCH.range m,
  // SCORCH.hp health and SCORCH.armor armor, and sees stealthed units at any distance (Engine u.scorchSight). It is a
  // structure: not needed to win the round. Its skills (each SCORCH.cost, once per turret, lost when it is
  // destroyed): Blaze (splash SCORCH.splash m in all, +SCORCH.hitPct% hit), Rapid fire (+SCORCH.apsPct% attack speed,
  // +SCORCH.range2 m), Legs (it walks at the Ember Imps' speed and counts as a unit: it must be destroyed to win).
  // Downside: a turret destroyed in a fight sits out the next round's fight (rec.data.out = that round).
  const SCORCH = { hp: 450, armor: 2, unit: 'Ember Imps', range: 10, cost: 100, splash: 5, hitPct: 25, apsPct: 25, range2: 5, botGold: 150,
    imp: { name: 'Ember Imps', bodies: 1, hp: 90, hit: 20, aps: 0.8, range: 10, speed: 4, splash: 3, burn: 50 } }; // (imp: a roster without Ember Imps)
  function scorchUnit(m, rec) {
    const units = (m && m.units) || [], ui = units.findIndex(u => u && u.name === SCORCH.unit), base = ui >= 0 ? units[ui] : SCORCH.imp;
    const burn = (base.skillDefs || []).find(d => d && d.type === 'burn');
    const { skills, skillDefs, skillsOn, skillsInnate, skillMods, skillOr, skillNeedsAny, ...plain } = burn ? E.applySkills(base, [burn], units) : E.withTraits(base);
    const blaze = skillN(rec, 'blaze') > 0, rapid = skillN(rec, 'rapid') > 0, legs = skillN(rec, 'legs') > 0;
    return E.withTraits({ ...plain, name: 'Scorch turret', cost: 0, bodies: 1, level: 0, hp: SCORCH.hp, defense: 'armor', defVal: SCORCH.armor, projSpeed: 0,
      hit: plain.hit * (blaze ? 1 + SCORCH.hitPct / 100 : 1), splash: blaze ? SCORCH.splash : plain.splash,
      aps: plain.aps * (rapid ? 1 + SCORCH.apsPct / 100 : 1), range: plain.range + SCORCH.range + (rapid ? SCORCH.range2 : 0),
      trueSight: true, scorchSight: true, shape: 'square', color: '#D9622B', kind: 'mpb', mpb: 'scorch',
      ...(legs ? { speed: plain.speed, mpbSkin: 'mobile' } : { speed: 0, structure: true, lesser: true }) });
  }
  const scorchOut = (m, rec) => rec.data.out === m.round;
  def({ id: 'scorch', name: 'Scorch turrets', short: 'sc', kind: 'defensive', hp: SCORCH.hp, armor: SCORCH.armor, color: '#D9622B', single: 'Scorch turret',
    text: `Each of you places one turret: an Ember Imp with Spitfire (burn), instant shots, +${SCORCH.range} m range; it always sees stealthed units. Not a unit: it isn’t needed to win the round.`,
    downside: 'A turret destroyed in a fight doesn’t fight the next round, and loses its upgrades.',
    place: { where: 'interior', spacing: true },
    skills: [
      { id: 'blaze', name: 'Blaze', cost: SCORCH.cost, per: 'building', text: `Splash ${SCORCH.splash} m in all and +${SCORCH.hitPct}% hit. Lost when the turret is destroyed.` },
      { id: 'rapid', name: 'Rapid fire', cost: SCORCH.cost, per: 'building', text: `+${SCORCH.apsPct}% attack speed and +${SCORCH.range2} m range. Lost when the turret is destroyed.` },
      { id: 'legs', name: 'Legs', cost: SCORCH.cost, per: 'building', text: 'It walks (as fast as Ember Imps) and counts as a unit: the opponents must destroy it to win the round. Lost when the turret is destroyed.' },
    ],
    hooks: {
      acquire(m, team) { queue(m, team, 'scorch', null, null, 0); queue(m, team, 'scorch', null, null, 1); }, // one each, placed alone
      unit: (m, side, rec) => scorchUnit(m, rec),
      bodies(m, side, rec, ctx) {
        if (scorchOut(m, rec)) return [];
        const out = ctx.main();
        if (skillN(rec, 'legs') > 0) { const ui = (m.units || []).findIndex(u => u && u.name === SCORCH.unit); for (const b of out) b.tier = ui >= 0 ? G.tierOf(m.units, ui) : 1; } // a unit now: it holds artifacts
        return out;
      },
      fellText: (m, side, rec) => `Destroyed in round ${rec.fell}’s fight: it sits out the fight after and loses its upgrades.`,
      afterFight(lanes, side, rec, res, sums, round) {
        if (rec.fell !== round) return;
        rec.skills = {}; rec.data.out = round + 1;
        news(sums, side, { kind: 'scorch', key: rec.key, lane: rec.data.lane, text: 'A Scorch turret was destroyed: it sits out the next fight and its upgrades are lost.' });
      },
      info(m, side, rec) {
        const u = scorchUnit(m, rec);
        return [scorchOut(m, rec) ? 'Destroyed in the last fight: it sits out this round.' : '', `${Math.round(u.range)} m range, ${Math.round(u.hit)} hit, splash ${u.splash} m${u.structure ? '' : ', walks'}`].filter(Boolean);
      },
      // a bot: its own turret's skills now and then (Blaze, Rapid fire, then Legs)
      bot(m, side, rec, r) {
        if (rec.data.lane !== laneOf(m)) return;
        for (const id of ['blaze', 'rapid', 'legs']) if (skillN(rec, id) === 0) { if (r() < 0.35 && m.gold[side] >= SCORCH.cost + SCORCH.botGold) mpbBuy(m, side, rec.key, id); break; }
      },
    },
  });

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
  // the team's health with this round's Heal clicks is at its starting health already: another Heal would do nothing
  const oakFull = (m, side, rec) => { const hp = m.hp && m.hp[side]; return Number.isFinite(hp) && hp + OAK.heal * oakClicks(m, rec, 'heal') >= TEAM_HP_CAP; };
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
      // Heal only while it can still add something (it is never above the starting health); Undo all replays a buy as it was
      canBuy: (m, side, rec, sk) => sk.id !== 'heal' || !!m.mpbReplay || !oakFull(m, side, rec),
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
        return [`Restoration +${k}%${k !== OAK.restore ? ' this round' : ''}`, h ? `+${h * OAK.heal} Team HP before this round’s fight` : '', oakFull(m, side, rec) ? 'Team HP is full: Heal would do nothing' : '',
          skillN(rec, 'moss') > 0 ? `Sticky moss within ${OAK.moss} tiles` : '', oakEntDue(m, rec) ? 'Destroyed last round: an Ent fights for the opponents this round' : ''];
      },
      // a bot (Duo.botTurn): Heal when the team is hurt, the moss once it is rich, Double restoration now and then
      botAfter(m, side, rec, r0) {
        const r = r0 || rng(((m.seed >>> 0) + m.round * 137 + laneOf(m) * 19 + 7) >>> 0), hp = (m.hp && m.hp[side]) || 0;
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
      resting: (m, side, rec) => facResting(m, rec), // (the boards' out-of-action look, Mpb.resting)
      fellText: (m, side, rec) => facResting(m, rec) ? `Destroyed in round ${rec.fell}’s fight: it is being rebuilt this round and makes nothing; it still stands in the fight.` : `Destroyed in round ${rec.fell}’s fight; it stands again in every fight.`,
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
      info(m, side, rec, viewer = side) {
        const now = facNow(m, rec);
        return [facResting(m, rec) ? 'Being rebuilt this round: it makes nothing.' : now ? `This round: ${(skillOf('factory', now.id) || {}).name}` : 'Nothing bought this round', viewer === side ? 'One unit a round for your team.' : 'One unit a round for their team.'];
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
  // never so that some tile can no longer be walked to (lakeFree: the board's walkable tiles stay one area), never on
  // a Bastion wall's tile (Vilhelm, 6 Nov: "no walls on the lake"; Game.bwallTile). As the
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
  // the squads the player can't see too (the fight's start, hooks.settle). Never on a Bastion wall's tile ("no walls on
  // the lake", Vilhelm, 6 Nov: Game.bwallTile, as the team sees the board; its own team's and the teammate's walls
  // always count, the other team's of this round only once seen)
  function lakeOk(m, side, rec, col, row, strict) {
    if (!on(m) || !rec || rec.kind !== 'magicLake' || rec.data.lane !== laneOf(m) || !(rec.col < 0 || rec.round === m.round)) return false;
    if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
    grid(m);
    if (!lakeWhere(side, col, row)) return false;
    const was = { col: rec.col, row: rec.row };
    rec.col = -1; rec.row = -1; // (a tile being moved: its old tile is dry for the check)
    try { return !G.terrainBlocks(m, col, row) && !(strict ? taken : seenTaken)(m, side, col, row) && !G.bwallTile(m, side, col, row) && lakeFree(m, col, row); } finally { rec.col = was.col; rec.row = was.row; }
  }
  // where lake tile rec may go, best first: no man's land on the team's own half (the rows nearest its zone first),
  // then its middle row (nobody's, Game.midRow, 2026-11-07), then the rest of no man's land, then the zone (its front
  // first); each player toward the columns of their own half
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
    const band = (t) => G.inNoMans(t.row) ? (G.midRow(t.row) ? 1 : own(t.row) ? 0 : 2) : 3, back = (t) => side === 0 ? ROWS - 1 - t.row : t.row;
    return out.sort((a, b) => band(a) - band(b) || (band(a) === 2 ? back(b) - back(a) : back(a) - back(b)) || Math.abs(a.col - half) - Math.abs(b.col - half) || a.col - b.col);
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
      spotOk: (m, side, part, col, row) => !G.bwallTile(m, side, col, row) && lakeFree(m, col, row), // (a lake by a placement vote, never in a real match)
      // (for the boards: its look shows its skills)
      unit: (m, side, rec) => E.withTraits({ name: 'Magic lake', cost: 0, bodies: 1, hp: 1, hit: 0, aps: 1, range: 0, speed: 0, splash: 0, shape: 'square', color: '#3E8FC4',
        structure: true, lesser: true, kind: 'mpb', mpb: 'magicLake', level: 0, ...(lakeSkin(rec) ? { mpbSkin: lakeSkin(rec) } : {}) }),
      canBuy: (m, side, rec) => rec.col >= 0,
      canAct: (m, side, rec, action, args) => action === 'place' && lakeOk(m, side, rec, args[0], args[1]),
      // (rec.down: put down by its player this round, so hidden from the opponents until the fight: hooks.seen)
      act(m, side, rec, action, args) { rec.col = args[0]; rec.row = args[1]; rec.round = m.round; rec.down = m.round; return true; },
      // the opponents (Mpb.seenList): a tile put down (or moved) this round is not down yet for them until the fight
      seen(rec, round) { if (rec.down !== round) return rec; const { down, ...r } = rec; return rec.col >= 0 ? { ...r, col: -1, row: -1 } : r; },
      // as the fight starts: a tile nobody put down, or one put down this round on an opponent's squad (or building) its
      // player couldn't see (either lane), goes on the first tile its player could have put it, everything known
      settle(lanes, side, rec) {
        const m = lanes[0];
        if (rec.col >= 0 && !(rec.round === m.round && lanes.some(L => G.squadAt(L, 1 - side, rec.col, rec.row) || G.buildingAt(L, 1 - side, rec.col, rec.row)))) return;
        const was = m.duoLane;
        m.duoLane = rec.data.lane;
        const all = lakeSpots(m, side, rec, true), t = rec.col >= 0 ? nearestOf(all, rec.col, rec.row) : all[0]; // (on a squad: the nearest tile to the one chosen)
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
  const TEAM_LETTER = ['A', 'B'];
  const aName = (n) => (/^[AEIOU]/i.test(n) ? 'an ' : 'a ') + n; // 'an Ent', 'a Brute'
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
  // an enemy squad held in a building as its opponents see it while deploying (Referee.hide): in a jail, or in its
  // School since an earlier round. One that went into the School this round still stands on its tile for them (it can be
  // jailed: the jailer gets the gold back after the fight), one that came out this round is still inside. The same on
  // the page (the hidden view) and the server (the real state), so a refused jailing tells the jailer nothing.
  function heldSeen(m, foe, lane, q) {
    if (q.jailed) return true;
    if (recs(m, foe).some(r => r.kind === 'school' && ((r.data && r.data.was) || []).some(w => w.round === m.round && w.pupil.round < m.round && w.pupil.lane === lane && w.pupil.id === q.id))) return true;
    return !!q.school && q.school.round < m.round;
  }
  // this round's jailing of squad (lane, id) of side sd is called off (the squad sat this fight out in its School, which
  // fell, so the School's afterFight puts it back first): the cell goes, its jailer gets the gold back. The Jail's own
  // afterFight does the same for a squad still in its School, so the outcome doesn't depend on which side's buildings
  // run first.
  function jailCallOff(lanes, sd, lane, id, round) {
    for (const r of recs(lanes[0], 1 - sd)) {
      if (r.kind !== 'jail' || !r.data || !r.data.cells) continue;
      r.data.cells = r.data.cells.filter(c => {
        if (!(c.lane === lane && c.id === id && c.round === round)) return true;
        if (lanes[c.by]) lanes[c.by].gold[1 - sd] += JAIL.cost;
        return false;
      });
    }
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
    if (!q || !u || u.building || q.round >= m.round || heldSeen(m, 1 - side, lane, q) || G.isRider(q)) return 'squad';
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
        // (only while the jail's own body stands: squad, the Engine looks for it every tick)
        opts.mpb.discover = (opts.mpb.discover || []).concat([{ x: w.x, y: w.y, r: (JAIL.light + 0.5) * G.TILE, side, squad: squadOf(recs(m, side).indexOf(rec)) }]);
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
          // A squad jailed this round (not locked up yet) goes free with no ban: it sat this fight out, which is what the
          // gold bought; one sold or sitting in its School this fight was never held: its jailer gets the gold back
          const banned = new Set(rec.data.banned || []);
          let n = 0, spared = 0;
          for (const c of cells) {
            const q = laneSquad(lanes, c.lane, foe, c.id);
            if (q && q.jailed) { jailFree(lanes, foe, q); n++; banned.add(c.ui); }
            else if (c.round === round && (!q || q.school)) { if (lanes[c.by]) lanes[c.by].gold[side] += JAIL.cost; }
            else if (c.round === round) spared++;
          }
          rec.data.cells = []; rec.data.banned = [...banned].sort((a, b) => a - b); rec.data.down = round + 1;
          news(sums, side, { kind: 'jail', freed: n, spared, text: `Team ${TEAM_LETTER[side]}’s Jail was destroyed${n ? `: ${n} jailed squad${n > 1 ? 's go' : ' goes'} free (${n > 1 ? 'their unit types' : 'its unit type'} can’t be jailed again)` : ''}${spared ? `${n ? ';' : ':'} the squad it was to lock up this round is not taken` : ''}. It does nothing next round.` });
          return;
        }
        // locked up now; a squad sold (or put in its School) before it could be gives its jailer the gold back; one sold
        // later frees its cell
        rec.data.cells = cells.filter(c => {
          const q = laneSquad(lanes, c.lane, foe, c.id);
          if (!q || (q.school && !q.jailed)) { if (c.round === round && lanes[c.by]) lanes[c.by].gold[side] += JAIL.cost; return false; }
          if (!q.jailed) { jailLock(lanes, c.lane, foe, q, side, rec, round); news(sums, side, { kind: 'jail', jailed: q.unit, text: `Team ${TEAM_LETTER[side]}’s Jail locked up ${aName((lanes[c.lane].units[q.unit] || {}).name || 'squad')}.` }); }
          return true;
        });
      },
      // the opponents don't see this round's jailing until the fight
      hide(s, h, rec) { if (rec.data.cells) rec.data.cells = rec.data.cells.filter(c => c.round !== s.round); if (!jailCells(rec).length) delete rec.data.cells; }, // (no key when empty: a first jailing leaves no trace)
      info(m, side, rec) {
        const cells = jailCells(rec);
        return [`Skywatch${jailUp(m, rec) ? '' : ' off this round'}`, `${cells.length}/${JAIL.cells} cells taken`, (rec.data.banned || []).length ? `can’t jail again: ${rec.data.banned.map(i => (m.units[i] || {}).name).join(', ')}` : ''].filter(Boolean);
      },
      // a bot: now and then the costliest enemy squad it can see; the guards when it has gold to spare
      bot(m, side, rec, r0) {
        const r = r0 || rng(((m.seed || 0) + m.round * 7121 + side * 89 + laneOf(m) * 13) >>> 0); // (r0: Duo.botTurn's stream, in no view)
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
  // Respec (Vilhelm, 7 Nov 2026): once a round, free, the pupil's player swaps an either-or skill of the pupil's unit
  // type (owned since an earlier round) for the other one of its pair. The pupil must have sat a fight out in here
  // already. It counts in this round's fight and stays even if the School falls; Undo respec (this round) gives the use
  // back. Kept in the player's own lane, not the team's (m.respec[side], Game.respecNow), so a teammate's Undo all
  // doesn't touch it; the opponents see the old skill until the fight (hide). A skill with deploy-time state (a
  // building, Forward planting, Overwatch, Spirit walk) is never swapped; no either-or pair has one today.
  const RESPEC_NO = new Set(['building', 'forward', 'overwatch', 'freeMove']);
  const respecOf = (m, side, key) => ((m.respec && m.respec[side]) || []).find(x => x.round === m.round && x.key === key) || null;
  // the swaps { from, to } open to squad sq's unit now (the School's own rules aside: see schoolWhy)
  function respecs(m, side, sq) {
    const ui = sq.unit, t = m.tech && m.tech[side] && m.tech[side][ui], out = [];
    if (!t || G.charOf(m, side) === 'enzo') return out;
    const plain = (k) => { const d = G.skillDef(m, ui, k); return !!d && !RESPEC_NO.has(d.type) && !G.isInnate(m, ui, k) && !G.isFlat(m, ui, k) && !G.isAwaken(m, ui, k) && !G.isEvolve(m, ui, k); };
    for (const from of E.SLOTS) {
      if (!(t[from] > 0 && t[from] < m.round) || !plain(from)) continue;
      for (const to of G.skillOr(m, ui, from)) {
        if (G.hasSkill(m, side, ui, to) || !plain(to)) continue;
        // the swap tried out: nothing owned (an awakened squad's Awaken skill too) loses a skill it needs, and the new
        // one has what it needs
        const was = t[from];
        t[to] = m.round;
        const held = G.skillHeldUp(m, side, ui, from);
        t[from] = 0;
        const bad = held || G.skillNeedsMissing(m, side, ui, to).length || G.skillOrTaken(m, side, ui, to).length;
        t[from] = was; t[to] = 0;
        if (!bad) out.push({ from, to });
      }
    }
    return out;
  }
  // the tile a squad put in the School this round came from is still free (a squad of theirs may have been placed there)
  const backFree = (m, side, sq) => G.blockOf(m, sq.unit, sq.school.col, sq.school.row).every(([c, r]) => !G.occupied(m, side, c, r) && !G.enemyHolds(m, side, c, r));
  // why this player may not do `action` on the school now (null: they may). Actions (Game.mpbAct): 'enroll' id (a squad
  // of theirs), 'leave' [col, row] (their squad inside comes out, there or on the nearest free tile), 'learn' k,
  // 'unlearn' (a skill started this round), 'respec' from, to (see respecs), 'unrespec' (this round's respec)
  function schoolWhy(m, side, rec, action, args) {
    const p = pupilOf(rec), L = laneOf(m);
    if (action === 'unrespec') { // (also once the pupil has left again)
      const x = respecOf(m, side, rec.key), t = x && m.tech[side][x.ui];
      if (!x || !t) return 'none';
      t[x.from] = x.fromRound;
      const held = G.skillHeldUp(m, side, x.ui, x.to); // a skill bought since on top of the new one goes first
      t[x.from] = 0;
      return held ? 'held' : null;
    }
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
      // put in this round: taking it out only takes the enrolment back, onto the tile it came from (no free move)
      if (p.round === m.round) return (args.length && (args[0] !== sq.school.col || args[1] !== sq.school.row)) || !backFree(m, side, sq) ? 'tile' : null;
      const t = homeTile([m], side, sq, args.length ? { col: args[0], row: args[1] } : { col: sq.school.col, row: sq.school.row });
      if (!t || (args.length && (t.col !== args[0] || t.row !== args[1]))) return 'tile';
      return null;
    }
    if (action === 'learn') return p.learn ? 'learning' : learnable(m, side, sq).includes(args[0]) ? null : 'skill';
    if (action === 'unlearn') return p.learn && p.learn.round === m.round ? null : 'none';
    if (action === 'respec') {
      if (p.round >= m.round) return 'new'; // it sits a fight out in here first
      if (respecOf(m, side, rec.key)) return 'used';
      if (p.learn && args.includes(p.learn.k)) return 'skill';
      return respecs(m, side, sq).some(x => x.from === args[0] && x.to === args[1]) ? null : 'skill';
    }
    return 'none';
  }
  def({ id: 'school', name: 'School', short: 'sch', kind: 'support', hp: SCHOOL.hp, armor: SCHOOL.armor, color: '#A8443A',
    text: `Holds 1 squad of yours (either of you): it doesn’t fight, and its player can’t place another squad of that unit type while it is inside. Study (free): a level’s worth of XP every round. Learn (free): a skill of its unit, ready ${SCHOOL.learn} rounds later; it can’t leave meanwhile. Respec (free, once a round): swap an either-or skill of its unit for the other one, once it has sat a fight out inside.`,
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
          const back = p.round === m.round; // the enrolment taken back: onto its own tile, nothing for the opponents to see
          if (!back) { if (!rec.data.was) rec.data.was = []; rec.data.was.push({ round: m.round, pupil: clone(p), school: clone(p.sq || sq.school) }); }
          if (sq.school) {
            const t = back ? { col: sq.school.col, row: sq.school.row } : homeTile([m], side, sq, args.length ? { col: args[0], row: args[1] } : { col: sq.school.col, row: sq.school.row });
            delete sq.school; sq.col = t.col; sq.row = t.row;
          }
          rec.data.pupil = null;
          return true;
        }
        if (action === 'learn') { p.learn = { k: args[0], round: m.round }; return true; }
        if (action === 'unlearn') { p.learn = null; return true; }
        if (action === 'respec') { // the swap, now (no gold either way: Game.skillsBought stays the same)
          const [from, to] = args, t = m.tech[side][sq.unit];
          if (!m.respec) m.respec = [[], []];
          m.respec[side] = (m.respec[side] || []).filter(x => x.round === m.round).concat({ key: rec.key, round: m.round, ui: sq.unit, from, fromRound: t[from], to });
          t[from] = 0; t[to] = m.round;
          return true;
        }
        if (action === 'unrespec') {
          const x = respecOf(m, side, rec.key), t = m.tech[side][x.ui];
          t[x.from] = x.fromRound; t[x.to] = 0;
          m.respec[side] = m.respec[side].filter(y => y !== x);
          return true;
        }
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
          // ...if it still may be (a skill it needs taken back meanwhile: not learnt; the other one of an either-or pair
          // can't be bought meanwhile, Game.canBuySkill's schoolLearning)
          if (!G.hasSkill(m, side, sq.unit, p.learn.k) && !G.skillNeedsMissing(m, side, sq.unit, p.learn.k).length && !G.skillOrTaken(m, side, sq.unit, p.learn.k).length) {
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
        if (sq && sq.school) { // out it comes, as it went in (a jailing of it this round is called off first)
          jailCallOff(lanes, side, p.lane, sq.id, round);
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
        if (watching(s, 1 - h)) { // (watched live, Insider information: who is in the School shows as it stands; not what it learns)
          if (p && p.learn && p.learn.round === s.round) p.learn = null;
          rec.data.was = [];
          return;
        }
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
        if (!rec.data.pupil) delete rec.data.pupil; // (no key when empty, not null: a first enrolment leaves no trace)
      },
      info(m, side, rec) {
        const p = pupilOf(rec), sq = pupilSq(m, side, rec);
        if (!p || !sq) return ['Empty'];
        return [`${(m.units[sq.unit] || {}).name} inside since round ${p.round}`, p.learn ? `learning ${((G.skillDef(m, sq.unit, p.learn.k) || {}).name) || 'a skill'}` : ''].filter(Boolean);
      },
      // a bot: sometimes puts its most experienced squad in, learns a skill, takes it out after a few rounds
      bot(m, side, rec, r0) {
        const r = r0 || rng(((m.seed || 0) + m.round * 6029 + side * 97 + laneOf(m) * 17) >>> 0), L = laneOf(m), p = pupilOf(rec);
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
  // (a squad the buyer can see is held, in a Jail or its School since an earlier round, has no body in the fight: no
  // target; heldSeen, as the Jail's, so page and server agree and nothing hidden shows)
  function impTargets(m, side) {
    const L = laneOf(m), ok = (lane) => (q) => !G.isRider(q) && impTier(m, q.unit) && !heldSeen(m, 1 - side, lane, { ...q, id: q.id >= LANE_OFF ? q.id - LANE_OFF : q.id });
    return G.foeSeen(m, 1 - side).filter(ok(L)).map(q => ({ who: 0, id: q.id, sq: q }))
      .concat(G.teamSeen(m, 1 - side).concat(teamSold(m, 1 - side)).filter(ok(1 - L)).map(q => ({ who: 1, id: q.id >= LANE_OFF ? q.id - LANE_OFF : q.id, sq: q })));
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
        const now = (rec.data.imp || []).filter(x => x.round === round), sq = res.squads || {};
        const made = now.filter((x, j) => sq[side + ':' + extraOf(k, j)]).length;
        if (made) news(sums, side, { kind: 'shadowDen', imp: made, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den: ${made} enemy bod${made > 1 ? 'ies' : 'y'} turned into Shadowhands.` });
        // a target that still stands but had no body in the fight (it sat it out in its School, or a Jail locked it up
        // this round): nothing could be taken, the buyer gets the gold back (as the Jail's own rule). A target sold or
        // taken back is no refund (PATCH-NOTES).
        let back = 0;
        now.forEach((x, j) => {
          const q = lanes[x.tl] && lanes[x.tl].armies[1 - side].find(s => s.id === x.id);
          if (sq[side + ':' + extraOf(k, j)] || !q || q.unit !== x.u || sq[(1 - side) + ':' + (x.tl === 0 ? x.id : x.id + LANE_OFF)]) return;
          if (lanes[x.lane]) { lanes[x.lane].gold[side] += DEN.impersonate; back++; }
        });
        if (back) news(sums, side, { kind: 'shadowDen', back, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den: ${back > 1 ? 'two Impersonate targets' : 'an Impersonate target'} sat the fight out (School or Jail): ${DEN.impersonate} gold back.` });
        const ins = rec.data.insider;
        if (ins && ins.round === round) {
          rec.data.watch = { round: round + 1, by: fell ? 1 - side : side, free: fell };
          delete rec.data.insider;
          if (fell) news(sums, side, { kind: 'shadowDen', flip: true, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den fell while its Insider information was on: the other team gets it for free next round.` });
        }
        if (fell) news(sums, side, { kind: 'shadowDen', lost: rec.data.lost || 0, text: `${side === 0 ? 'Team A' : 'Team B'}’s Shadow Den was destroyed: ${rec.data.lost ? `${rec.data.lost} Shadowhands squad${rec.data.lost > 1 ? 's' : ''} lost, ` : ''}no Den skills next round.` });
        delete rec.data.lost;
      },
      // destroyed: the team's Shadowhands squads go before any building's afterFight runs (Mpb.afterFight's clear
      // pass), so the other team's Jail sees them gone whichever side's buildings run first (a cell on one: the gold back)
      clear(lanes, side, rec, res, sums, round) {
        if (rec.fell !== round) return;
        let lost = 0;
        for (const L of lanes) { const before = L.armies[side].length; L.armies[side] = L.armies[side].filter(q => !isHands(L, q.unit)); lost += before - L.armies[side].length; }
        rec.data.lost = lost;
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
        for (const f of ['imp', 'sab']) if (Array.isArray(d[f]) && !d[f].length) delete d[f]; // (no key when empty: a first buy leaves no trace)
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
  // a new building of kind on a tile (the caller checked the tile). placed: put down by the team this round (a
  // placement: Mpb.placeEntry), so hidden from the opponents until the fight (rec.placed = the round, Mpb.seenList).
  // Its key is the kind's short name and a number: the list's length + 1; a record the opponents see at once (a Magic
  // lake's tiles from the card, a kojja standing for the other team) leaves out this round's hidden placements, so
  // its key is the one it would have had without them (a gap would tell them one was made)
  function addRec(m, side, kindId, col, row, placed) {
    if (!m.mpb) m.mpb = [[], []];
    const K = kindOf(kindId), list = m.mpb[side];
    let n = (placed ? list.length : list.filter(r => r.placed !== m.round).length) + 1;
    while (list.some(r => r.key === K.short + n)) n++;
    const rec = { key: K.short + n, kind: kindId, col, row, parts: {}, round: m.round, fell: 0, skills: {}, data: {} };
    if (placed) rec.placed = m.round;
    list.push(rec);
    if (K.hooks.placed) K.hooks.placed(m, side, rec);
    return rec;
  }
  // ----- this round's placements, as the opponents see them (Vilhelm, 6 Nov: "They should be hidden until the fight
  // just like everything else in the game") -----
  // Side's records as the other team sees them while deploying: a building placed this round isn't there (rec.placed;
  // also a part placed this round onto an older one: rec.pplaced[part]), and a kind's hooks.seen(rec, round) gives the
  // record as it stood when the round began (the Coal mine's exit dug this round on its old tile, a Magic lake tile put
  // down this round not down yet). The records changed are copies; the list is a new one. Mpb.hide (the opponents'
  // view) and the server's seen mode (asSeen: the deploy checks as the acting team sees the board) both use it.
  function seenList(list, round) {
    const out = [];
    for (let rec of list) {
      if (rec.placed === round) continue;
      if (rec.pplaced) {
        const pp = { ...rec.pplaced }, parts = { ...rec.parts };
        for (const p of Object.keys(pp)) if (pp[p] === round) { delete pp[p]; delete parts[p]; }
        rec = { ...rec, parts };
        if (Object.keys(pp).length) rec.pplaced = pp; else delete rec.pplaced;
      }
      const K = kindOf(rec.kind);
      if (K && K.hooks.seen) rec = K.hooks.seen(rec, round);
      out.push(rec);
    }
    return out;
  }
  // Seen mode (the server, src/duo.js): while asSeen(side, fn) runs, the board's tiles (recAt, at, terrainAt,
  // buildingTiles: Game.occupied, terrainBlocks, bldgSeen...) count the other team's buildings only as that team's
  // player sees them (seenList), so the server judges a deploy action exactly as the player's page does (it holds that
  // view) and a refusal never shows a hidden building. Outside it (the fight's start, the round's start, the page)
  // everything is as it stands. Nested calls are fine (the bots of the other team vote inside a player's action).
  let SEE = null, seenCache = new WeakMap();
  function asSeen(side, fn) {
    const was = SEE;
    SEE = side === 0 || side === 1 ? side : null; seenCache = new WeakMap();
    try { return fn(); } finally { SEE = was; seenCache = new WeakMap(); }
  }
  const seeing = () => SEE;
  // side's records for the board's tiles: as they stand, or (seen mode, the other team's) as seenList gives them; a
  // team the seeing one watches (the Shadow Den's Insider information: watching) as they stand, live
  function tileRecs(m, side) {
    const list = recs(m, side);
    if (SEE !== 1 - side || !list.length || watching(m, SEE)) return list;
    let c = seenCache.get(list);
    if (!c || c.round !== m.round) { c = { round: m.round, list: seenList(list, m.round) }; seenCache.set(list, c); }
    return c.list;
  }
  // every tile a building takes, with its part ('' for the building itself; none while it isn't placed yet: col < 0,
  // the Magic lake's tiles before their player puts them down). A record with rec.away (set by its kind: a Tree kojja
  // taken back, or standing for the other team this round) takes no tile, has no body and holds nothing.
  const tilesOf = (rec) => rec.away ? [] : (rec.col >= 0 ? [{ col: rec.col, row: rec.row, part: '' }] : []).concat(Object.entries(rec.parts || {}).map(([p, t]) => ({ col: t.col, row: t.row, part: p })));
  // the building (and part) on a tile, either side: { side, rec, part } or null
  function recAt(m, col, row) {
    for (const side of [0, 1]) for (const rec of tileRecs(m, side)) for (const t of tilesOf(rec)) if (t.col === col && t.row === row) return { side, rec, part: t.part };
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
    for (const side of [0, 1]) for (const rec of tileRecs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.blocks && K.hooks.blocks(m, side, rec, col, row)) return true; }
    return false;
  }
  // Game.terrainBlocks: a tile of a kind that is terrain (place.terrain: the Magic lake's water), either team
  const terrainAt = (m, col, row) => on(m) && [0, 1].some(side => tileRecs(m, side).some(rec => !!((kindOf(rec.kind) || {}).place || {}).terrain && tilesOf(rec).some(t => t.col === col && t.row === row)));

  // the starting state of a 2v2 lane: both Vaults, no votes (Duo.start, in both lanes)
  function init(m, lane) {
    m.duoLane = lane; m.duoTowers = true;
    m.mpb = [[], []]; m.mpbVote = [[], []]; m.mpbSeen = [[], []];
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
      for (const r of tileRecs(m, sd)) if (!((kindOf(r.kind) || {}).place || {}).terrain) out.push(...tilesOf(r)); // (terrain isn't a building)
      // (seen mode: the other team's Cog Builder's Factories only from earlier rounds, as Referee.hide shows them; all
      // of them to a team that watches them live)
      for (const b of G.buildingsOf(m, sd).concat(G.teamBuildings(m, sd))) if (SEE !== 1 - sd || b.round < m.round || watching(m, SEE)) out.push({ col: b.col, row: b.row });
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
  // may team `side` put building kind (or its part) on this tile? As the team sees the board (seenTaken: the
  // opponents' squads put down this round don't count, so page and server agree and a refusal shows nothing hidden.
  // One found there as the fight starts is settled by Duo.settleBoard: on a tile of the building's own zone the
  // building stays and that squad moves (prio); in no man's land the newer one moves. Only the D-less fallback,
  // settle / unclash, used by node tests alone, always moves the building to the nearest tile it may stand on.)
  // strict: with everything known (the fight's start)
  function spotOk(m, side, kindId, part, col, row, strict) {
    if (!on(m)) return false;
    grid(m);
    const K = kindOf(kindId), pl = placeOf(kindId, part);
    if (!K || !pl || !Number.isInteger(col) || !Number.isInteger(row) || !inBoard(col, row)) return false;
    if (!(WHERE[pl.where] || WHERE.interior)(side, col, row)) return false;
    if (G.terrainBlocks(m, col, row) || (strict ? taken : seenTaken)(m, side, col, row)) return false;
    if (pl.spacing !== false && !spaced(m, col, row)) return false;
    if (K.hooks.spotOk && !K.hooks.spotOk(m, side, part || null, col, row)) return false;
    return true;
  }
  // every allowed tile, best first: the back of the zone, then the middle (for no man's land: the own side, the middle)
  function spots(m, side, kindId, part, strict) {
    const { COLS, ROWS } = grid(m), out = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (spotOk(m, side, kindId, part, col, row, strict)) out.push({ col, row });
    const back = (r) => side === 0 ? ROWS - 1 - r : r, mid = (COLS - 1) / 2;
    return out.sort((a, b) => back(a.row) - back(b.row) || Math.abs(a.col - mid) - Math.abs(b.col - mid) || a.col - b.col);
  }
  const autoSpot = (m, side, kindId, part) => spots(m, side, kindId, part)[0] || null;
  // the tile of list nearest (col, row): Chebyshev rings, then the straight line, then the list's own order
  function nearestOf(list, col, row) {
    let best = null, bd = 0, be = 0;
    for (const t of list) {
      const d = Math.max(Math.abs(t.col - col), Math.abs(t.row - row)), e = Math.hypot(t.col - col, t.row - row);
      if (!best || d < bd || (d === bd && e < be - 1e-9)) { best = t; bd = d; be = e; }
    }
    return best ? { col: best.col, row: best.row } : null;
  }
  // a squad of the other team (either lane) stands on (col, row), or their Cog Builder's Factory (not one held: a
  // jailed squad stands on the jail's tile)
  const foeOn = (lanes, side, col, row) => lanes.some(L => (L.armies[1 - side] || []).some(q => !G.isRider(q) && !G.mpbHeld(q) && G.blockOf(L, q.unit, q.col, q.row).some(([c, r]) => c === col && r === row)) || !!G.buildingAt(L, 1 - side, col, row));
  // "If things are placed on the same tile, they find another spot close to it" (Vilhelm, 6 Nov). As the fight starts
  // (Mpb.settle, everything known): a building tile (or part) that stands on a squad of the other team the team
  // couldn't see when it voted (placed later than it: the building's tile was seen, the squad's wasn't) moves to the
  // nearest tile its kind may stand on (spotOk, strict; a kind's hooks.clashOk instead). A part that stays
  // (place.parts' stays: the Coal mine's exit) never moves: it is just blocked.
  // Terrain has its own (the Magic lake's settle). Nothing found: it stays.
  function unclash(lanes) {
    const m = lanes[0];
    grid(m);
    for (const side of [0, 1]) for (const rec of recs(m, side)) {
      const K = kindOf(rec.kind);
      if (!K || rec.away || K.place.terrain || K.place.where === 'fixed') continue;
      for (const t of tilesOf(rec)) {
        if ((placeOf(rec.kind, t.part || null) || {}).stays || !foeOn(lanes, side, t.col, t.row)) continue; // (a part that stays, the Coal mine's exit: just blocked)
        const part = t.part || null, ok = [];
        const was = part ? rec.parts[part] : null;
        if (part) delete rec.parts[part]; else rec.away = true; // (its own tile doesn't count while it looks)
        try {
          const { COLS, ROWS } = grid(m);
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            if (foeOn(lanes, side, c, r)) continue;
            if (K.hooks.clashOk ? K.hooks.clashOk(m, side, rec, part, c, r) : spotOk(m, side, rec.kind, part, c, r, true)) ok.push({ col: c, row: r });
          }
        } finally { if (part) rec.parts[part] = was; else delete rec.away; }
        const to = nearestOf(ok, t.col, t.row);
        if (to) { if (part) rec.parts[part] = to; else { rec.col = to.col; rec.row = to.row; } }
      }
    }
  }

  // ----- the fight's start with everything known (Duo.settleBoard: what was hidden meets) -----
  // side's building tiles: { sd, rec, part ('' the building itself), col, row, id (rec.key|part), fresh (the other team
  // doesn't see it there: placed, put down or moved this round, seenList), terrain (a Magic lake tile), spacing (its
  // kind's 2-tile room), fixed (never moves: the Vault), stays (a part that never moves and never makes anything move
  // at the fight's start, place.parts' stays: the Coal mine's exit, just blocked) }
  function boardTiles(m, side) {
    const out = [];
    if (!on(m)) return out;
    grid(m);
    const seen = new Set();
    for (const r of seenList(recs(m, side), m.round)) for (const t of tilesOf(r)) seen.add(r.key + '|' + t.part + '@' + t.col + ',' + t.row);
    for (const rec of recs(m, side)) {
      const K = kindOf(rec.kind);
      if (!K) continue;
      for (const t of tilesOf(rec)) {
        const pl = placeOf(rec.kind, t.part || null) || {};
        out.push({ sd: side, rec, part: t.part, col: t.col, row: t.row, id: rec.key + '|' + t.part, fresh: !seen.has(rec.key + '|' + t.part + '@' + t.col + ',' + t.row),
          terrain: !!K.place.terrain, spacing: pl.spacing !== false && !K.place.terrain, fixed: K.place.where === 'fixed', stays: !!pl.stays });
      }
    }
    return out;
  }
  // a building tile (or part, or Magic lake tile) of side's to the nearest tile its kind may stand on with everything
  // known (spotOk strict, a kind's hooks.clashOk, a lake tile's lakeSpots strict); prefer(col, row) (optional): of the
  // tiles as near as the nearest allowed one (its ring), those to take first when there are any (Duo: where nothing
  // else would have to move then). Returns the tile or null
  // (no room anywhere: it stays). lanes[0]'s record (Duo copies it to lane 1).
  function moveTile(lanes, side, rec, part, prefer) {
    const m = lanes[0], K = kindOf(rec.kind);
    if (!on(m) || !K || K.place.where === 'fixed' || rec.away) return null;
    const { COLS, ROWS } = grid(m), from = part ? rec.parts[part] : { col: rec.col, row: rec.row };
    if (!from) return null;
    let all = [];
    if (K.place.terrain) {
      const was = m.duoLane;
      m.duoLane = rec.data.lane;
      try { all = lakeSpots(m, side, rec, true); } finally { m.duoLane = was; }
    } else {
      const was = part ? rec.parts[part] : null;
      if (part) delete rec.parts[part]; else rec.away = true; // (its own tile doesn't count while it looks)
      try {
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (K.hooks.clashOk ? K.hooks.clashOk(m, side, rec, part || null, c, r) : spotOk(m, side, rec.kind, part || null, c, r, true)) all.push({ col: c, row: r });
      } finally { if (part) rec.parts[part] = was; else delete rec.away; }
    }
    all = all.filter(t => !(t.col === from.col && t.row === from.row));
    // the nearest tile allowed (rings round its tile, then straight-line distance); prefer only chooses among the tiles
    // of that same ring (a building never goes further off for it)
    const near = nearestOf(all, from.col, from.row);
    if (!near) return null;
    const ring = cheb(near.col, near.row, from.col, from.row);
    const to = (prefer && nearestOf(all.filter(t => cheb(t.col, t.row, from.col, from.row) === ring && prefer(t.col, t.row)), from.col, from.row)) || near;
    if (part) rec.parts[part] = to; else { rec.col = to.col; rec.row = to.row; }
    return to;
  }

  // =====================================================================
  // The placement vote (team state m.mpbVote; its 15 s clock is in D)
  // =====================================================================
  const voteQueue = (m, side) => (m && m.mpbVote && m.mpbVote[side]) || [];
  const voteHead = (m, side) => voteQueue(m, side)[0] || null;
  // the entry player L acts on now: the head (a team vote, or L's own one-player placement), or L's own first one in
  // the run of one-player placements at the head (so each player places theirs without waiting for the other's)
  function voteEntry(m, side, L) {
    const q = voteQueue(m, side);
    for (let i = 0; i < q.length; i++) { const e = q[i]; if (e.lane == null) return i === 0 ? e : null; if (e.lane === L) return e; }
    return null;
  }
  // lane (optional, 0 or 1): only that player places it, at once, with no vote (Scorch turrets, a Tree kojja's Grow).
  // skill: queued by a skill click (a Tree kojja's Grow: hidden from the opponents as the click is).
  // m.mpbSeen (team state): the queue as the opponents see it this round: the entries queued in the open (the draft's
  // cards), never a skill's, never a part's (it comes once a building is placed), and never taken off by a placement
  // (where and when the team placed it shows in the fight). Mpb.hide gives it to the opponents as the team's queue.
  function queue(m, side, kindId, part, key, lane, skill) {
    if (!m.mpbVote) m.mpbVote = [[], []];
    const e = { kind: kindId, part: part || null, key: key || null, votes: [null, null] };
    if (lane === 0 || lane === 1) e.lane = lane;
    if (skill) e.skill = true;
    // an entry queued in the open goes ahead of any a skill click queued (a hidden Grow never holds back a public vote;
    // no vote ever holds the shared deploy clock: each has its own 15 s, Duo.mpbClock)
    const q = m.mpbVote[side], k = skill ? -1 : q.findIndex(x => x.skill);
    if (k >= 0) q.splice(k, 0, e); else q.push(e);
    if (!e.part && !skill) { if (!m.mpbSeen) m.mpbSeen = [[], []]; m.mpbSeen[side].push(clone(e)); }
  }
  // the head of the queue goes on (col, row): a new building (its parts are voted on next), or a part of one
  const placeHead = (m, side, col, row) => placeEntry(m, side, voteHead(m, side), col, row);
  // an entry of the queue (the head, or a one-player placement: voteEntry) goes on (col, row)
  function placeEntry(m, side, head, col, row) {
    const q = voteQueue(m, side), i = head ? q.indexOf(head) : -1;
    if (i < 0) return null;
    q.splice(i, 1);
    if (head.part) {
      const rec = recOf(m, side, head.key);
      if (rec) { rec.parts[head.part] = { col, row }; if (rec.placed !== m.round) rec.pplaced = { ...(rec.pplaced || {}), [head.part]: m.round }; } // (hidden as a new building is: seenList)
      return rec;
    }
    const rec = addRec(m, side, head.kind, col, row, true); // (rec.placed: hidden from the opponents until the fight)
    if (head.lane != null) rec.data.lane = head.lane; // whose it is (placed by one player alone)
    q.splice(i, 0, ...((kindOf(head.kind).place.parts) || []).map(p => ({ kind: head.kind, part: p.id, key: rec.key, votes: [null, null] })));
    return rec;
  }
  // a player's vote (Game.mpbVote): a tile allowed for the first building in the queue; the same tile as the
  // teammate's places it at once
  function mpbVote(m, side, col, row) {
    const L = laneOf(m), head = voteEntry(m, side, L);
    if (!head || !spotOk(m, side, head.kind, head.part, col, row)) return false;
    const o = head.votes[1 - L];
    if (head.lane != null) { head.votes[L] = { col, row }; placeEntry(m, side, head, col, row); return true; } // one player's own: placed at once
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
  // price of the next click: cost + costStep for every click this player made this round (costStep: per player) +
  // costRise for every buy of this building's skill in earlier rounds (2026-11-07, the Coal mine's Dig a new exit; the
  // opponents' view has this round's buys taken off, so it shows nothing new)
  function skillCost(m, side, key, id) {
    const rec = recOf(m, side, key), sk = rec && skillOf(rec.kind, id);
    if (!sk) return 0;
    const log = thisRound(m, rec.skills[id]), mine = log.filter(e => e.lane === laneOf(m)).length, before = skillN(rec, id) - log.length;
    return Math.max(0, Math.round((sk.cost || 0) + (sk.costStep || 0) * mine + (sk.costRise || 0) * before));
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
    if (e.round !== m.round) { if (e.n > 0) e.prev = e.round; e.round = m.round; e.log = []; } // (prev: the round of the buy before this round's, for hide and a take-back)
    m.gold[side] -= cost;
    e.n++; e.by[L]++; e.log.push({ lane: L, cost });
    const K = kindOf(rec.kind);
    if (K.hooks.bought) K.hooks.bought(m, side, rec, sk, args, L);
    return true;
  }
  // a player takes back their own last click of skill id this round (never the teammate's: their gold). A kind's
  // hooks.canUndo(m, side, rec, id, lane) may refuse it: the Coal mine's exit can't go back to a tile taken since, the
  // Tree kojja's Nest not while a squad is in it.
  function canUndo(m, side, key, id) {
    const rec = recOf(m, side, key), K = rec && kindOf(rec.kind);
    if (!rec || m.over || !thisRound(m, rec.skills[id]).some(e => e.lane === laneOf(m))) return false;
    return !(K && K.hooks.canUndo && !K.hooks.canUndo(m, side, rec, id, laneOf(m)));
  }
  // Undo all (Duo): may team `side`'s buildings go back to how they would be again (sc: the rebuilt copy, Duo's
  // undoReplay)? Each kind's hooks.restoreOk(m, side, rec, was) must agree (the Coal mine: its exit back on a tile still
  // free). A click of this player's that canUndo refuses doesn't stop it: Undo all leaves it bought and paid (group B1).
  // m: the player's lane as it stands.
  function undoAllOk(m, side, sc) {
    if (!on(m)) return true;
    for (const rec of recs(m, side)) {
      const K = kindOf(rec.kind);
      if (!K) continue;
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
    else if (!e.log.length && e.prev != null) { e.round = e.prev; delete e.prev; } // (as it stood before this round's clicks)
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
  // A team the viewers watch (the Shadow Den's Insider information, watching(s, 1 - h): Vilhelm, 6 Nov, "Should show
  // everything") is shown live on the board: this round's placements (buildings, parts, water, a dug exit, turrets,
  // grown kojjas) as they stand and their placement votes with both players' tiles. Their skill clicks, the kinds' own
  // hidden picks and the Vault stay hidden (buys and gold, not the board).
  function hide(s, h) {
    if (!on(s)) return s;
    const live = watching(s, 1 - h), drop = new Set();
    if (s.respec && s.respec[h]) { // a School respec this round: the skill it had (Referee.hide took the new one off already)
      for (const x of s.respec[h]) if (x.round === s.round && s.tech && s.tech[h] && s.tech[h][x.ui]) { s.tech[h][x.ui][x.from] = x.fromRound; s.tech[h][x.ui][x.to] = 0; }
      s.respec[h] = [];
    }
    for (const rec of recs(s, h)) {
      for (const id of Object.keys(rec.skills)) {
        const e = rec.skills[id], prev = e.prev;
        delete e.prev; // (the team's own note: never in the opponents' view)
        if (e.round !== s.round || !e.log.length) continue;
        for (const x of e.log) { e.n--; e.by[x.lane]--; }
        e.log = [];
        if (e.n <= 0) delete rec.skills[id];
        else if (prev != null) e.round = prev; // a skill bought again this round: as it stood when the round began
      }
      const K = kindOf(rec.kind);
      if (K && K.hooks.hide && K.hooks.hide(s, h, rec) === false) drop.add(rec); // (false: not seen at all)
    }
    if (drop.size) s.mpb[h] = s.mpb[h].filter(r => !drop.has(r));
    if (live) return s; // (watched: the board and the votes as they stand)
    s.mpb[h] = seenList(s.mpb[h], s.round); // this round's placements: as the round began (after the kinds' hooks: the School puts its squad back first)
    if (s.mpbVote && s.mpbVote[h]) {
      // the queue as queued in the open (m.mpbSeen: the draft's cards; a placement never takes one off, a skill's never
      // shows); without it (an older match), the queue without what a skill click queued
      const pub = s.mpbSeen && s.mpbSeen[h];
      s.mpbVote[h] = (pub ? clone(pub) : s.mpbVote[h].filter(e => !e.skill)).map(e => ({ ...e, votes: [null, null] }));
    }
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
      if (!K || rec.away) return;
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
  // Duo.battle, once all bodies are in (A: side 0's, B: side 1's): a kind's link(m, side, rec, list) may tie bodies
  // together (the Tree kojja: the squad standing on it goes inside)
  function link(m, A, B) {
    if (!on(m)) return;
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && !rec.away && K.hooks.link) K.hooks.link(m, side, rec, side === 0 ? A : B); }
  }
  // Game.garrisonFree / garrisonAt: a building of side's on (col, row) that holds a squad of unit ui (null: any squad)
  // (a kind's holds(m, side, rec, ui); Game checks the tile is free of the team's own squads)
  function holds(m, side, col, row, ui) {
    if (!on(m)) return false;
    for (const rec of recs(m, side)) {
      if (rec.away || rec.col !== col || rec.row !== row) continue;
      const K = kindOf(rec.kind);
      if (K && K.hooks.holds && K.hooks.holds(m, side, rec, ui)) return true;
    }
    return false;
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
    for (const rec of recs(m, 1 - side)) { const K = kindOf(rec.kind); if (K && K.hooks.foeSquadBodies) K.hooks.foeSquadBodies(m, 1 - side, rec, sq, list, u); } // the other team's buildings on this squad (the Jail: it sits the fight out)
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
    // squads a building's fall takes off the board (hooks.clear: the Shadow Den's Shadowhands) go first, both sides,
    // so no kind's afterFight depends on which side's buildings run first
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.clear) K.hooks.clear(lanes, side, rec, res, sums, round); }
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
    unclash(lanes); // a building on a squad its team couldn't see: the nearest tile it may stand on
    for (const side of [0, 1]) for (const rec of recs(m, side).slice()) { const K = kindOf(rec.kind); if (K && K.hooks.settle) K.hooks.settle(lanes, side, rec); }
  }
  // the Magic lake tiles nobody put down go down now, on the first tile their player could have put them, everything
  // known (Duo.settleBoard, before the fight's same-tile check: they are the newest things on the board)
  function settleLakes(lanes) {
    const m = lanes[0];
    if (!on(m)) return;
    for (const side of [0, 1]) for (const rec of lakeRecs(m, side)) if (rec.col < 0) KINDS.magicLake.hooks.settle(lanes, side, rec);
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
  // Duo.undoAllAllowed: a building whose kind puts its record and the squads right after Undo all (hooks.reconcile: the
  // School) has free actions that may simply be undone with it (a teammate's enrolment that needed the seat the
  // presser freed comes out again), so they never stop Undo all
  const reconciles = (m, side, key) => { const r = recOf(m, side, key), K = r && kindOf(r.kind); return !!(K && K.hooks.reconcile); };
  // tiles a building lights up on the board (the Jail's Skywatch; hooks.lit): [{ col, row }], drawn by both renderers
  const litTiles = (m, side, rec) => { const K = kindOf(rec.kind); return (K && K.hooks.lit && K.hooks.lit(m, side, rec)) || []; };
  // out of action this round (hooks.resting: the Factory being rebuilt, a shut Coal mine; 2026-11-07): both boards
  // draw it greyed with the shared badge while deploying (not in the fight, where it still stands as a target)
  const resting = (m, side, rec) => { const K = rec && kindOf(rec.kind); return !!(K && K.hooks.resting && K.hooks.resting(m, side, rec)); };
  // the start of a round (Duo.beginRound): this round's skill logs start empty, then the kinds' roundStart
  function roundStart(lanes) {
    const m = lanes[0];
    if (!on(m)) return;
    m.mpbSeen = [0, 1].map(sd => voteQueue(m, sd).filter(e => !e.part && !e.skill).map(e => ({ ...clone(e), votes: [null, null] }))); // (none: every vote is settled before a fight)
    for (const side of [0, 1]) for (const rec of recs(m, side)) for (const id of Object.keys(rec.skills)) { const e = rec.skills[id]; if (e.round !== m.round) e.log = []; }
    for (const side of [0, 1]) for (const rec of recs(m, side)) { const K = kindOf(rec.kind); if (K && K.hooks.roundStart) K.hooks.roundStart(lanes, side, rec); }
  }

  // =====================================================================
  // Artifacts (rolled by Duo at the start of rounds 2 and 8)
  // =====================================================================
  // the cards an artifact may stand for: every tower type (the Outpost every team starts with isn't one) and every MPB
  // kind but the Vault, minus the cards of this match's earlier artifacts, so the four artifacts of a match are all
  // different (Vilhelm, 6 Nov: "No 1 MPB or tower can show up more than 1 times"). Rolled when they spawn, so what the
  // teams already have doesn't matter: the artifact rounds decide that. The earlier cards: round 2's are in m.draft
  // (round 3's deal keeps them until round 9's), and m.artifacts of an earlier round if it is still there.
  function cardsUsed(m) {
    const out = [];
    if (m.draft && Array.isArray(m.draft.cards) && m.draft.round < m.round) out.push(...m.draft.cards);
    if (m.artifacts && m.artifacts.round < m.round) out.push(...(m.artifacts.list || []).map(a => a.card));
    return out.filter(Boolean);
  }
  function cardPool(m) {
    const used = new Set(cardsUsed(m).map(c => c.type + ':' + c.id));
    const out = G.TOWER_TYPES.map(t => ({ type: 'tower', id: t.id }));
    for (const id of Object.keys(KINDS)) if (KINDS[id].draft !== false) out.push({ type: 'mpb', id });
    return out.filter(c => !used.has(c.type + ':' + c.id));
  }
  const cardName = (c) => !c ? '' : c.type === 'tower' ? ((G.TOWER_TYPES.find(t => t.id === c.id) || {}).name || c.id) : ((kindOf(c.id) || {}).name || c.id);
  const cardText = (c) => !c ? '' : c.type === 'tower' ? ((G.TOWER_TYPES.find(t => t.id === c.id) || {}).text || '') : ((kindOf(c.id) || {}).text || '');
  // two point-mirrored tiles in no man's land (not flank tiles, not water), at least ARTIFACT.apart tiles apart, and
  // two different cards. r: a seeded 0..1 source. Returns { round, list }. On a board with a middle row (the 2v2
  // board, 2026-11-07) both stand on it: the same distance from both teams' zones, and not in the flank columns (the
  // middle row has no flank tiles, so a column with flank tiles beside it is kept free, as before). If the middle row
  // has no free pair left (Coal mine exits, lake tiles), the top half's rows of no man's land, as before. Null: none.
  function rollArtifacts(m, r) {
    const { COLS, ROWS } = grid(m), mirror = (c, w) => ({ col: COLS - 1 - c, row: ROWS - 1 - w });
    // (not water, nor a building's tile, nor one a Coal mine's exit keeps free)
    const free = (col, row) => nmlOk(col, row) && !G.terrainBlocks(m, col, row) && !at(m, col, row) && !(G.midRow(row) && (flank(col, row - 1) || flank(col, row + 1)));
    const pairs = (rows) => {
      const ok = [];
      for (const row of rows) for (let col = 0; col < COLS; col++) {
        const p = mirror(col, row);
        if (!free(col, row) || !free(p.col, p.row)) continue; // (a fair pair)
        if (Math.hypot(p.col - col, p.row - row) < ARTIFACT.apart) continue;
        ok.push({ col, row });
      }
      return ok;
    };
    let ok = ROWS % 2 ? pairs([(ROWS - 1) / 2]) : [];
    if (!ok.length) ok = pairs(Array.from({ length: Math.floor(ROWS / 2) }, (_, i) => i));
    if (!ok.length) return null; // (never in play: no free pair anywhere, so no artifacts this round)
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
    KOJJA, SCORCH, kojjaUnit, scorchUnit,
    def, kindOf, recs, recOf, has, skillOf, skillN, addRec, tilesOf, recAt, at, terrainAt, settle, init,
    interior, spaced, spotOk, spots, autoSpot, nearestOf, unclash, placeOf, buildingTiles,
    seenList, asSeen, seeing, tileRecs, boardTiles, moveTile, settleLakes,
    voteQueue, voteHead, voteEntry, queue, placeHead, placeEntry, mpbVote, voteResult,
    skillCost, whyNot, canBuy, mpbBuy, canUndo, undoAllOk, mpbUndo, mpbAct, seenTaken,
    vaultOf, vaultRec, vaultMode, vaultMoved, vaultRoom, canVault, vaultPut, vaultTake, golemOf, golemUnit, golemSkin,
    hide, unitOf, squadOf, extraOf, indexOf, isSquad, bodies, link, holds, battleOpts, squadMods, squadBodies, news, afterFight, roundStart, teamHeal, litTiles, resting, reconcile, reconciles,
    FH, OAK, oakMossTiles, oakEntUnit,
    JAIL, jailWhy, jailable, jailSeen, homeTile, SCHOOL, pupilOf, pupilSq, levelXp, learnable, schoolWhy, respecs, respecOf,
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
