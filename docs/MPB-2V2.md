# 2v2 buildings (MPBs), artifacts and the artifact draft — design and work split (6 Nov 2026)

Vilhelm's "Big update" (the full list is at the end of this file, verbatim in meaning). This file is the one brief every
group builds against: the readings Claude took, the data shapes, who owns what, and the numbers Claude chose.
Anything not covered here: take the simplest reading, write it under "To check with Vilhelm" in your PATCH-NOTES
entry, keep going.

Branch: everything lands on `claude/exciting-meitner-889u3z` (merged there by the coordinator; do not push to main).

## Decisions taken with Vilhelm (6 Nov)

- **Artifact draft** (replaces the 2v2 round 3 tower vote): rounds **2 and 8** each spawn **2 artifacts**. Each artifact
  stands for one *card*: a tower type or an MPB (never the Vault). In round **3** (from round 2's artifacts) and round
  **9** (from round 8's) the two cards are dealt:
  - a team that won **both** artifacts picks one card first; the other team gets the card left;
  - each team won **one**: each gets its own;
  - an artifact **nobody** won (no points, or a tie): its card goes to a team that has no card yet; if both cards are
    unwon, a seeded coin flip says which team picks first, the other gets the card left.
  So every team gets exactly one card per artifact round.
- **A tower card replaces the team's tower type** (the Outpost in round 3, or the tower they have in round 9). The old
  round 3 tower vote is **removed in 2v2** (1v1 keeps its tower pick). A team that takes an MPB in round 3 keeps the
  Outpost until a tower card comes (maybe never). In round 9 a tower card replaces the current type; that tower's
  bought tower skills go with it (no refund — to check with Vilhelm).

## Claude's readings (flag in PATCH-NOTES "To check with Vilhelm")

- Holding points: each **squad** with at least one living, fighting body inside an artifact's circle adds its **tier**
  (1-4, `Game.tierOf`) points a second for its side (not per body: a goblin swarm would otherwise beat a giant 8:1).
  Summons count as tier 1, structures/buildings never.
- Artifact circle radius 9 m (1.5 tiles). Cap 100: the moment either side reaches 100 the artifact locks; the side
  with more points wins it. A fight that ends first: more points wins, equal = nobody.
- "Next to a building" (Assassin) = any of the 8 tiles around a building's tile (and the tile itself).
- "Edges of the deployment zone" (MPBs) = a tile is allowed only when all 8 tiles around it are tiles of the team's own
  zone that are not reserved flank tiles. "2 tile range around any other building" = Chebyshev distance ≥ 3 from every
  building tile (towers, Vault, other MPBs and their parts, the Cog Builder's Factory, walls are not buildings).
- Bastion "3 wall skill is free once a game": Defensive walls (the skill that gives 3 walls) costs 0. It is still bought
  once per match.
- An Assassin placed in the enemy zone or on a flank tile stands still the flank delay (`FLANK.delay`, 3 s) in its first
  fight, as a flank squad does (the Shadow Den removes that). Enemy squads placed this round are hidden, so an Assassin
  may share a tile with one; the fight just starts them close (as with two Forward-planted Ents today).

## Architecture (contracts every group codes against)

2v2 is two lanes (two 1v1 `Game` matches, `src/duo.js`). Everything below is **team** state, kept **identical in both
lanes** of a team, the way the tower part is today (`Duo.TEAM_FIELDS`, `copyTeam`).

### New file `src/mpb.js` (global `Mpb`, node-requirable like `src/duo.js`)

- Loaded after game.js, before duo.js (page: a `/*MPB*/` slot in `src/site-template.html`, inlined by `src/build.js`;
  node: `require('./mpb.js')` from duo.js; the server bundles it through duo.js).
- `Mpb.KINDS` — the building definitions, one entry per kind, each in its own clearly marked region
  `// ===== <kind> =====` so groups don't collide:
  `{ id, name, kind: 'economic'|'support'|'technical'|'defensive', text, downside, hp, armor, unit (its fight unit),
     skills: [{ id, name, cost, costStep?, per: 'round'|'roundPlayer'|'match'|'building'|'free', text, ... }],
     place: { where: 'interior'|'nml'|'own'|'board'|..., spacing: true|false, parts?: [...] }, hooks: { ... } }`
- Records: `m.mpb = [[rec, ...] /* side 0 */, [ ... ] /* side 1 */]`, rec =
  `{ key: 'v1', kind: 'vault', col, row, parts: { exit: { col, row } }?, round /* placed */, fell /* round it was
     destroyed in, or 0 */, skills: { <skillId>: { round, n, by: [lane0 count, lane1 count] } }, data: { ... } }`.
  `key` is unique per side for the match ('v1', 'tk2', ...).
- Fight squad ids: `Mpb.SQ = -700`; a side's MPB k (k = index in m.mpb[side]) fights as squad `-700 - k`, extra bodies
  of a kind (mine exit, second lake tile...) at `-800 - ...`. `Duo.teamBody` treats these as team bodies (lane 0's
  stand, lane 1's are dropped) — only lane 0 builds them.
- Hooks the framework calls (a kind defines only what it needs):
  - `bodies(m, side, rec, ctx)` → fight bodies of this building (structures), built in `Duo.battle`.
  - `battleOpts(m, side, rec, opts)` → adds to the Engine opts (auras, terrain, teleports...).
  - `squadMods(m, side, rec, sq, unit)` → changes a squad's fight unit before its bodies are made (Field hospital +hp...).
  - `afterFight(lanes, side, rec, res, summaries)` → after the fight (gold, Team HP, fell, next-round effects).
  - `roundStart(lanes, side, rec)` → when a round begins (interest, Study XP, golem reset...).
  - `canAct(m, side, rec, action, args)` / `act(...)` → its skills and special actions.
- Engine side: `Engine.createBattle(A, B, g, opts)` gets `opts.mpb = { auras, teleports, discover, ... }` (generic
  fields each group adds with a default that changes nothing). **1v1, the counter table and Balance Lab must stay
  byte-identical** (`node tools/tests/fairness.js`, `node tools/counter-table.js` reports no changes).
- Actions: every MPB action is a `Game`-style function `(m, side, ...args)` exposed as `Game.<fn>` (e.g.
  `Game.mpbBuy(m, side, key, skillId, ...args)`, `Game.mpbUndo`, `Game.mpbVote`, `Game.vaultPut`, `Game.vaultTake`,
  `Game.draftPick`), allowed by `Referee` `ACTIONS`, and listed in `Duo.TEAM_FNS` (so the teammate's lane gets the
  same team state) unless it is purely the player's own (gold moves are; the team part is copied after them).
  Who paid: `skills[id].by[lane]`. A take-back of the teammate's buy is refused (as for tower buys).
- Not sellable unless the kind says so. Opponents can tap an MPB and see its sheet (skills bought this round stay
  hidden until the fight, like tower skills: `Referee.hide`).
- `Game.occupied` / `canPlaceTile` treat every MPB tile (and its parts) as taken for both teams' squads (one small
  hook in game.js: `Game.mpbAt(m, col, row)`), except where a kind says otherwise (Tree kojja garrison, School...).

### Placement vote (when a team acquires an MPB)

- `m.mpbVote = [{ kind, part, votes: [lane0 tile|null, lane1 tile|null], until }, ...] /* queue per side */` (team
  state). While a team's queue has entries its players vote for the first entry with a tap on a tile allowed for that
  kind/part; same tile from both players → placed at once; different tiles → 15 s after the first vote, a seeded pick
  of one of the two; only one voted when the 15 s run out → theirs; nobody → the first allowed tile from
  `Mpb.autoSpot`. A bot votes at once (the human's tile if there is one, else autoSpot). Two MPBs (or a mine's entrance
  and exit) → one vote after the other.
- The deploy clock waits while a vote or the draft is open (as `picksPending` does now), at most 15 s per vote.
- The 15 s clock lives in `D` (src/duo.js, times passed in as `now`, the server's alarms call `Duo.tick`).

### Artifacts (engine + duo)

- Rolled by `Duo` at the start of rounds 2 and 8 (seeded, `D.seed`): `m.artifacts = { round, list: [{ id: 0|1, col,
  row, card: { type: 'tower'|'mpb', id } }] }` in all four views (the opponents see them too, cards included; a tap
  shows the card). The two spots are point mirrors of each other (fair), in no man's land, not on flank tiles, at
  least 10 tiles apart. Cards: two different ones from all tower types (`Game.TOWER_TYPES`) and all MPB kinds except
  the Vault, minus MPB kinds either team already has and tower types either team already has.
- Engine: `opts.artifacts = [{ x, y, r: 9, cap: 100 }]` → `battle.artifacts()` = `[{ x, y, r, pts: [a, b], rate: [a, b],
  locked: bool, won: -1|0|1 }]` live, and `result().artifacts` the same at the end. Units: a body with an unlocked
  artifact within its awareness (`max(range + sight, minSight)`) soft-prioritises it: it moves into the circle; melee
  bodies still leave it to attack an enemy they have picked; ranged bodies stay inside and only shoot what they can
  reach from inside (they step in first). Once the artifact locks, normal behaviour. Mirror-exact and deterministic,
  default off (`opts.artifacts` absent → nothing changes).
- After the fight: per artifact the winner (`won`); `+50` gold to each player of the winning team (each lane's
  `m.gold[side]`), `summary.artifacts`. The round after: the draft (above) → `m.draft = { round, cards, first, picks }`;
  a picked tower card sets `m.towers[side].type` in both lanes; an MPB card goes into that team's placement vote.
- Draw: both boards, 2D and 3D: a glowing orb on its tile, a ring of radius r, and a round meter with a blue (side 0)
  and red (side 1) bar filling from each side; locked: the winner's colour and a lock. The page's tap on an artifact
  shows its card (name + one line).

### The Vault (starting MPB, replaces the treasury in 2v2)

- Every team starts with a Vault on the old treasury tile (side 0 col 6 row 15; side 1 col 17 row 2). hp 900, armor 4.
- Put / take: each player may put in or take out up to **200 a round** (`vaultPut(m, side, n)`, `vaultTake`). Both
  amounts are counted over the round (no 50 x 50). A round is a **put round** or a **take round** for the whole team,
  set by its first vault action (`m.vault[side] = { gold, mode: 'put'|'take'|null, moved: [lane0, lane1], round }`).
  Take-back: Undo all undoes the player's own vault moves.
- Downside: destroyed in a fight → 80% of its gold is lost (rounded down to 10s), each opponent player +50.
- Skill **Compound interest** (200, match, permanent): at the start of each round the vault's gold grows 10%
  (rounded down).
- Skill **Coin golem** (100 each, once a round, *both* players must click it in the same round; the second click
  summons): all the vault's gold is spent; a Coin Golem fights next to the vault this round. With g = gold spent:
  hp = 300 + 3·g, hit = 30 + 0.12·g, aps 0.7, range 3 (melee), splash 1.5, armor 2 + g/250 (max 8), speed 4 (fixed),
  1 body, tier 3. Skin: bronze g < 400, silver 400-899, gold ≥ 900. (Coordinator's numbers; the Vault group may tune.)
- Loan: already every player's own (`Game.takeLoan`, every map from round 1); in 2v2 it must keep working with no
  treasury and no Bank (check, don't rebuild).

## Buildings (Vilhelm's text, with Claude's numbers where he left them open)

hp/armor below are the coordinator's starting numbers (groups may tune, keep them in the kind's region).

| Kind | hp / armor | Placement | Notes for the build |
|---|---|---|---|
| Tree kojja (`treeKojja`) | 500 / 0 | interior, spacing; extra ones: within 3 tiles of another of the team's kojjas, no spacing | Shoots like the Outpost/starter tower, 20 m range, sees stealth in range. Skill A 100 (once a round): build another (placed by the buyer, tap). Skill B 50 (per kojja, permanent): holds 1 ranged squad (garrison like Overwatch): it fights from one body, sees stealth, +3 m; 10 s with no enemy seen → steps out with all its bodies. Downside: destroyed → next round it works for the opponents (shoots for them, they may use skill B on it and garrison into it). |
| Field hospital (`fieldHospital`) | 600 / 2 | interior, spacing | Squads deployed within 1 tile: +20% hp and 2%/s regen in the fight. Each round won with it standing: +5 Team HP. Can't shoot. Skill 50 (+50 per click this round, many a round): a random allied squad +25% hp this fight. Skill 100 (once a round): pick an allied squad; the first time it is wiped out it is resurrected (full squad) on a tile next to the hospital. Downside: destroyed → −15 Team HP. |
| Coal mine (`coalMine`) | entrance 700 / 4 | entrance: interior, spacing; exit: no man's land, not flank tiles (skill: flank too) | Squads deployed within 1 tile of the entrance go in at the start of the fight, 2 s travel, come out at the exit and stand 1.5 s vulnerable (as a new flank squad). No deploying within 1 tile of the exit (both teams; it blocks those tiles, also on enemy tiles); a squad whose exit tile is held by an enemy squad simply doesn't go in. Skill 150 (match): move the exit once (flank tiles allowed). Skill 200 (match): squads coming out get +25% speed and +4 armor for 5 s. |
| Scorch turrets (`scorch`) | 450 / 2 each | each player places 1 in the team zone (own placement, no vote; spacing applies) | One Ember Imp body with Spitfire (burn), instant projectile, +10 m range, sees stealth. Not a unit (not needed to win). Downside: a turret destroyed doesn't fight the next round. Skills per turret (100 each, permanent, reset when it is destroyed): splash 5 m and +25% hit; +25% aps and +5 m; mobile (a unit: walks, must be killed to win). |
| The Oak (`oak`) | 1200 / 3 | interior, spacing | Restoration: all healing and regen of the team +25%. Skill 50 (once a round per player): heal 5 Team HP. Skill 100 (once a round): Restoration doubled this round. Skill 200 (match): sticky moss on every tile within 3 of the Oak: enemies on it 30% slower. Downside: the round after it was destroyed, a 1-body level 3 Ent with all its skills fights for the opponents. |
| Factory (`factory`) | as the Cog Builder's | interior, spacing | The Cog Builder's Factory as a team building: built at once, either player buys its unit of the round (the buyer owns it). |
| Magic lake (`magicLake`) | — (terrain) | each player places 2 lake tiles anywhere on their own half or no man's land; never closing a tile or a path (check with the map's path search) | Water tiles (Game terrain water: shot over, not walked). Skill 50 (per tile, permanent) Waterspirits allowal: allies walk through it 30% slower, +5% hp/s regen on it. Skill 200 (per tile, permanent) Water elemental: the tile becomes a Water Elemental each fight (as the Water Mage's Summon water elemental). |
| Jail (`jail`) | 1500 / 8 | interior, spacing | Skywatch: stealthed enemies within 3 tiles are revealed (lit tiles). Skill 100 (once per player, while there is room: 2 cells, one per player): jail an enemy squad: it takes no part in any fight until the jail is destroyed. Skill 150 (once per team, permanent): 4 Keep guards stand round the jail until enemies come into their awareness. Downside: destroyed → no jail next round, jailed squads freed, and their unit types can't be jailed again this match. A jailed carrier leaves its rider behind (the rider steps out). |
| School (`school`) | 700 / 2 | interior, spacing | Holds 1 allied squad (any player's), which doesn't fight; its player can't place another squad of that type while it is inside. Free Study: +1 level's XP each round. Skills bought for it are free but take 2 rounds to learn (it can't leave meanwhile). Skill 200 (team, permanent): double XP. Skill 300 (team, permanent): learning takes 1 round. Downside: destroyed → the bodies that destroyed it get half a level of XP; the squad inside loses all it gained inside. Tap the school → the squad's sheet (as a horse's rider). |
| Shadow Den (`shadowDen`) | 800 / 2 | interior, spacing | Rogues, Assassins and Shadowhands: no flank delay. Recruit Shadowhands (100): Rogue at half stats, 1 body, may be placed in no man's land. +1 Shadow deployment a round per player (only for these units). Impersonate (200, once a round per player): pick an enemy tier 1-2 squad; 5 s into the fight one of its bodies becomes a Shadowhand of yours. Sabotage (100, once a round per team): pick an enemy unit type: they can't deploy it next round (big red X on their card). Insider information (350, once a round per team): next round your team sees the opponents' deployment live and they get 15 s less; they see "You are being watched". If your Den is destroyed while it is on, they get it for free next round. Downside: destroyed → your Shadowhands are lost, no Den skills next round. |

## Global fixes (all modes and maps)

- Assassin: may be placed on **any** free tile of the board (own zone, no man's land, enemy zone, flanks; any round)
  that is not on or next to a building. Always ignores buildings (never picks a structure while a non-structure
  enemy can be picked; still hits a wall in its way so it never stalls). Bleed per hit 2 → **3** stacks.
- Bastion: Defensive walls (the 3-wall skill) costs 0.

## Work split

| Group | What | Owns | Starts |
|---|---|---|---|
| G | Global fixes (Assassin, Bastion) | game.js placement (`canPlaceTile`), engine target picking, unit/skill data, counter table | phase 1 |
| F | MPB framework: `src/mpb.js`, team state copying, placement rules + placement vote, MPB sheet UI (team buys, opponents read-only), generic 2D/3D drawing hook, fight bodies, the Vault (all of it, incl. golem), the 2v2 draft replacing the tower vote, artifact rolling + rewards (game/duo side), server wiring, bots | src/mpb.js, src/duo.js, server/src/duo.js, page MPB/draft/vote UI | phase 1 |
| A | Artifacts in the fight: engine points/lock/AI, 2D/3D drawing, tap card | engine.js (artifacts block), render2d/render3d artifact drawing | phase 1 |
| B1-B5 | The other 10 kinds (each group: rules, fight, sheet text, 3D model, 2D shape, bot use, tests) | its kinds' regions in src/mpb.js, small engine hooks | phase 2 (after F + A merge) |
| I | Integration: merge, full test pass, a full bot 2v2 to round 12 with every kind forced, desync check page vs server | — | phase 3 |

Phase 2 groups: B1 Tree kojja + Scorch turrets · B2 Field hospital + The Oak · B3 Coal mine + Magic lake ·
B4 Jail + School · B5 Shadow Den + Factory MPB.

## Tests (every group)

- Headless: a new `tools/tests/mpb-<group>.js` for your part; `node tools/tests/duo.js`; `node tools/tests/fairness.js`;
  `node tools/counter-table.js` (no changes); `cd server && npm test` when you touch server/, engine, game, referee,
  duo or mpb.
- Build: `node src/build.js` (it also parses every script).
- Browser checks (2v2 needs `wrangler dev` with `--var DUO_ANYONE:1`): ports: F 8760-8762, A 8763-8764, G 8765,
  B1 8767-8768, B2 8769-8770, B3 8771-8772, B4 8773-8774, B5 8775-8776 (8766 is the shared http.server of older
  tests). Machine has 4 cores: run only your own tests plus duo.js/fairness.js; the coordinator runs the full suites.
- PATCH-NOTES.md: one entry per group (newest first, for players), "To check with Vilhelm" list.

## Vilhelm's list (6 Nov), as given

Fixes for all modes and maps: the Assassin can be put anywhere on the map including the enemy board, on any free tile
not next to a building; always ignores buildings; more bleed per hit. Bastion's 3-wall skill is free once a game.

2v2: both teams start with a vault instead of the treasury; unique 3D models for each building; minor permanent
buildings (MPBs) as in the table above: can't be sold unless stated; not within 2 tiles of another building unless
stated; not on the outward edges of the deployment zone unless stated; both teammates see the sheet and buy skills;
opponents can open the sheet; placed through a placement vote (same tile → placed; different → random one of the two
after 15 s; one vote after the other when several). Loan is an inherent skill without the treasury. Rounds 2 and 8:
2 artifacts on fair random tiles in no man's land, ≥ 10 tiles apart, each a random tower/MPB (not the vault), held by
units (soft priority; melee prefer attacking, ranged prefer staying inside), tier points a second, both sides tick at
once, 100 cap locks, more points wins: +50 gold a player and the building; both → first pick in the draft.
