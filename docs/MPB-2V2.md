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

- **Hidden until the fight** (Vilhelm, 6 Nov: "They should be hidden until the fight just like everything else in the
  game"; "if things are placed on the same tile, they find another spot close to it"): every building placement and
  board change a team makes this round (a building by the vote, the clock or a bot; the Coal mine's entrance and exit;
  both Scorch turrets; a grown Tree kojja; Magic lake tiles put down or moved; Dig a new exit) is hidden from both
  opponents, in both lanes, until the fight, exactly as this round's squads are: they keep seeing the board as the round
  began (the exit on its old tile, with its old ring). Teammates see everything at once; the fight shows everything;
  buildings of earlier rounds stay seen. As the fight starts, everything known, what then meets is settled: the newer
  of two things on one tile (or the one whose own rule only full knowledge shows broken) moves to the nearest tile its
  own rules allow (see "Hidden until the fight" under Architecture). Nothing is called off or paid back.

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
  may share a tile with one; as the fight starts the one put there later moves to the nearest tile it may stand on
  (Vilhelm, 6 Nov: "if things are placed on the same tile, they find another spot close to it"; `Duo.settleBoard`).
- Hidden until the fight, readings: (a) a rule only one side's thing has (the Assassin's "not on or next to a
  building", a building's 2-tile room, "no squad or building on the 8 tiles round an exit", a lake tile never shutting
  a tile off, a wall never on water) is checked again as the fight starts with everything known; the thing whose rule
  is broken moves (even when it was there first), the newer one when both broke one (the same tile). Only what was
  put down, placed or moved this round moves: the rest was seen by all. (b) The vote and the draft stay open to all
  (the artifact's card says which building the team got) but never the tile chosen or the tile votes; the shared
  deploy clock still waits for a vote and starts again once both teams' are done, so the opponents learn when, never
  where. (c) Every deploy check is judged as the acting team sees the board (the page holds that view; the server
  judges in `Mpb.asSeen`), so a refusal never shows a hidden thing, and page and server always agree. Also: a moved
  building goes, when it can, to the nearest tile where nothing else then breaks a rule (so an Oak voted onto a
  hidden Assassin lands 2 tiles off, not next to it, and the Assassin stays); a Cog Builder's Factory never moves (the
  other thing does); a thing with no room anywhere stays, and the other one moves instead if it can; neither can: both
  stay. Insider information (the Shadow Den) shows squads only, never this round's buildings.

## Architecture (contracts every group codes against; as built by group F, 6 Nov)

2v2 is two lanes (two 1v1 `Game` matches, `src/duo.js`). Everything below is **team** state, kept **identical in both
lanes** of a team, the way the tower part is (`Duo.TEAM_FIELDS`, `copyTeam`).

### `src/mpb.js` (global `Mpb`, node-requirable)

- Loaded after game.js and referee.js, before duo.js (page: the `/*MPB*/` slot in `src/site-template.html`, inlined by
  `src/build.js`; node: `require('./mpb.js')` from duo.js; the server bundles it through duo.js). On load it puts the
  player actions on `Game` (`mpbBuy`, `mpbUndo`, `mpbAct`, `mpbVote`, `vaultPut`, `vaultTake`, `draftPick`) and
  registers itself with `Game.setMpb(Mpb)` (so `Game.mpbAt`, `Game.bodiesFor` and `Referee.hide` reach it).
- `Mpb.KINDS[id]`, made with `Mpb.def({...})`, one region per kind `// ===== <kind> =====` (stubs for all ten B kinds,
  with name/text/downside/hp/armor and `skills: []`). Fields: `id, name, short` (key prefix), `kind` ('economic' |
  'support' | 'technical' | 'defensive'), `text, downside, hp, armor, color, draft` (false: never a card; only the Vault),
  `skills: [{ id, name, cost, costStep?, per, text, max? }]`, `place: { where, spacing, open?, parts? }`, `hooks`.
  - `per`: `'round'` (once a round for the team), `'roundPlayer'` (once a round each), `'match'` (once a match for the
    team, across all buildings of the kind), `'building'` (once for this building record), `'free'` (no limit).
    `costStep`: + that much for each click **this player** made of it this round (per player, so one player's
    take-back never changes the other's price). `max`: at most that many in all (optional).
  - `place.where`: `'interior'` (default: the tile and all 8 round it are the team's own zone, no flank tiles),
    `'own'` (own zone, not the enemy's flank tiles), `'nml'` (no man's land, not flank tiles), `'board'` (own or
    `nml`), `'fixed'` (never voted: the Vault). `spacing` (default true): Chebyshev ≥ `Mpb.SPACING` (3) from every
    building tile (towers, MPBs and their parts, the Cog Builder's Factory; either team). `open: true`: its tiles do
    not count as taken for squads (`Mpb.at`). `parts: [{ id, name, where, spacing }]`: voted on one after the other,
    stored in `rec.parts[id] = { col, row }` (the coal mine stub has `exit`).
- Records `m.mpb = [[rec, ...], [...]]`, rec = `{ key, kind, col, row, parts: {}, round (placed), fell (last round it was
  destroyed in, 0 never), skills: { <id>: { round (last bought), n, by: [lane 0's, lane 1's], log: [{ lane, cost }]
  (this round's clicks) } }, data: {} }` (`data` is the kind's own). `key` = short + index + 1 ('v1', 'tk2'); records
  are never removed. Lookups: `Mpb.recs(m, side)`, `recOf(m, side, key)`, `has(m, side, kind)` (placed or in the vote
  queue), `tilesOf(rec)`, `recAt(m, col, row)` → `{ side, rec, part }`, `skillN(rec, id)`, `kindOf(id)`.
- Lane state: `m.duoLane` (0/1: who paid, whose vote; `Mpb.laneOf(m)`), `m.duoTowers` (2v2 towers: no tower pick,
  `Game.towerType` gives the Outpost while a team has no tower card, any round). Set by `Mpb.init(m, lane)` in
  `Duo.start`, which also puts both Vaults down.
- Skills: `Mpb.whyNot(m, side, key, id, args)` (null = may buy; else 'round' | 'you' | 'have' | 'max' | 'gold' |
  'rules' ...), `skillCost`, `canBuy`, `Game.mpbBuy(m, side, key, id, ...args)` (args: up to 3, each a whole number
  0-999999 or a string ≤ 40), `canUndo`, `Game.mpbUndo(m, side, key, id)` (the player's own last click this round;
  the teammate's can't be taken back), `Game.mpbAct(m, side, key, action, ...args)` (a kind's own action: hooks
  `canAct` / `act`). All three are `Duo.TEAM_FNS` (copied to the other lane, logged for Undo all).
- Hooks (all optional; `lanes` = the two matches `[m0, m1]`; change team state in `lanes[0]`, Duo copies it to lane 1;
  each lane's own gold in that lane):
  - `unit(m, side, rec)` → its fight unit (default `Mpb.unitOf`: a structure, `lesser`, `kind: 'mpb'`, `mpb: <kind>`,
    hp/armor of the kind; structures never count for winning a round).
  - `bodies(m, side, rec, ctx)` → its fight bodies (built once, from lane 0, in `Duo.battle`). `ctx = { k, squad
    (Mpb.SQ - k), xsq(j) (Mpb.XSQ - 10k - j, j < 10: extra bodies), idx (body index base), main() (the default body) }`.
    Set `b.tier` on a walking body that may hold an artifact (the Coin Golem: 3).
  - `battleOpts(m, side, rec, opts)` → add to the Engine options (`opts.mpb` is `{}` for the kinds' fields; `opts.tiles`
    and the rest are there too). Engine defaults must change nothing when a field is absent.
  - `squadMods(m, side, rec, sq, u)` → a squad's unit before its bodies are made (called from `Game.bodiesFor` for both
    lanes' squads; return the new unit). `squadBodies(m, side, rec, sq, bodies, u)` → after (flank delay, a tunnel...).
  - `afterFight(lanes, side, rec, res, sums, round, hp)` → after both lanes are resolved (`res`: the whole fight, lane 0
    ids for MPB squads; `sums`: both lanes' summaries; `hp`: the shared Team HP `[A, B]`, changeable). `rec.fell` is
    already set when its main body (`SQ - k`) died. `Mpb.news(sums, side, { kind, ... })` adds a results line
    (`summary.mpbNews[side]`; give `text` for the page's generic line).
  - `roundStart(lanes, side, rec)` → at the start of each round (after the skill logs reset).
  - `canBuy(m, side, rec, sk, args)`, `bought(m, side, rec, sk, args, lane)`, `unbuy(m, side, rec, sk, lane, entry)`.
  - `canAct(m, side, rec, action, args)` / `act(m, side, rec, action, args, lane)` (`Game.mpbAct`).
  - `hide(s, h, rec)` → what the opponents mustn't see while deploying (the framework already hides this round's skill
    clicks and the team's votes).
  - `spotOk(m, side, part, col, row)` → extra placement rule; `placed(m, side, rec)` → when a record is made;
    `acquire(m, team, card)` → instead of the placement vote when the team gets the card (each player places one,
    several tiles...); `info(m, side, rec)` → short plain lines for the generic sheet.
  - Hooks added after the integration review (6 Nov): `clear(lanes, side, rec, res, sums, round)` → squads a fall takes
    off the board, run for every building before any `afterFight` (the Den's Shadowhands); `clashOk(m, side, rec, part,
    col, row)` → where a tile (or part) may go when it must move as the fight starts (`Mpb.moveTile`, `Mpb.unclash`;
    default `spotOk(..., strict)`; the Coal mine's moved exit). `spotOk`'s 7th argument `strict`: with everything known
    (else as the team sees the board, `seenTaken`). `seen(rec, round)` (6 Nov) → the record as the opponents see it
    while deploying (`Mpb.seenList`: this round's board change undone, a copy).
  - Hooks the B groups added (all default off: a kind without them changes nothing; integrated 6 Nov):
    - Take-backs: `canUndo(m, side, rec, id, lane)` → false refuses a take-back (`Mpb.canUndo`; B1 the Tree kojja's
      Nest while a squad is in it, Grow once the new kojja has a skill; B3 Dig a new exit once the old tile is taken).
      `restoreOk(m, side, rec, was)` → false refuses Undo all (`Mpb.undoAllOk`, `was` = the record as Undo all would
      leave it; B3 the exit back on a taken tile). `reconcile(lanes, side, rec)` → after Undo all, puts the record and
      the lanes' squads right (`Mpb.reconcile`, end of `Duo.rebuildTeam`; B4 the School); its kind's acts are free and
      never refuse Undo all (`Mpb.reconciles`).
    - Squads and tiles: `holds(m, side, rec, ui)` → the building takes a squad of unit `ui` (null: any) on its tile
      (`Mpb.holds` → `Game.mpbHolds` in `garrisonFree` / `garrisonAt`; B1 the Nest). `blocks(m, side, rec, col, row)` →
      extra tiles no squad may take (`Mpb.at`; B3 the 8 tiles round the exit); `Mpb.at(m, col, row, true)` = building
      tiles only (`Game.bldgSeen`, the Assassin). `place.terrain: true` → terrain, not a building (no spacing, not in
      `Mpb.at`; `Mpb.terrainAt` → `Game.terrainBlocks`; B3 the Magic lake). `foeSquadBodies(m, side, rec, sq, list, u)`
      → the other team's buildings over a squad's bodies (`Mpb.squadBodies`; B4 the Jail empties a jailed squad).
      `settle(lanes, side, rec)` → before the fight, whatever the players left open (`Mpb.settle` from `Duo.settle`;
      B3 lake tiles nobody put down). `lit(m, side, rec)` → tiles drawn lit (`Mpb.litTiles`; B4 Skywatch).
    - Fight: `link(m, side, rec, list)` → ties fight bodies together once all are in (`Mpb.link(m, A, B)` from
      `Duo.battle`; B1 the squad in a Nest). `foeBodies(m, side, rec, ctx)` → bodies a building gives the *other* team
      (`Mpb.bodies`; B2 the Oak's Ent). `Mpb.bodies(m, side, idx0, lanes)` → `ctx.lanes` and `battleOpts(m, side, rec,
      opts, lanes)` (B5: the Factory's unit and Impersonate's Shadowhand made from the buyer's own lane).
      `teamHp(lanes, side, rec, hp, round, sums)` → Team HP before the fight's damage (`Mpb.teamHeal` from `Duo.fight`;
      B2 the Oak's Heal).
    - Units: kind field `extraUnits(units)` → units the kind adds to the 2v2 set (`Mpb.extraUnits`, appended by
      `Duo.unitSet`; B5 Shadowhands), `u.mpbUnit = <kind>` → off for a team without that building (`Mpb.unitOff` from
      `Game.isOff`). `Game.mpbLocked` (B5 Sabotage) and `Game.schoolLock` (B4) refuse a unit type in `Game.place` and
      the AI; `Game.deploysLeft(m, side, ui)` adds `Mpb.shadowBonus` (B5); `Game.foeSeen` / `teamSeen` show a watched
      team live (`Mpb.watching`, B5 Insider information; `Duo.cutFor` / `remainingFor` / `heldFor` cut its clock).
      `Game.mpbHeld(sq)` (`sq.jailed || sq.school`, B4): no move, no take-back, no carrying.
    - Bots: `bot(m, side, rec, r)` before the bot's squads (`Mpb.bots`) and `botAfter(m, side, rec, r)` after them
      (`Mpb.botsAfter`), both from `Duo.botTurn` with one seeded stream (`D.seed`, the round, the seat); a throw is
      caught (the turn goes on).
    - Sheet and view: `hide` returning `false` drops the record from the opponents' view (B1). `info(m, side, rec,
      viewer)` (B5: worded for the reader). `fellText(m, side, rec)` → the sheet's "destroyed in round N" line (B1). A
      skill's `pick: true` shows "Pick above" instead of the generic Buy button (B2). Page: `MPB_SHEET[kind].panel()` /
      `wirePanel(root)` (lines in the deploy panel: B3 lake tiles, B5 "You are being watched"), `marks(sq)` / `tap(t)`
      (B3: tiles to tap on the board), `held(sq)` (B4: the note on a held squad's sheet), and the one-shot
      `mpbPicking = (t) => bool` (B4: "tap one on the board"). render2d `MPB_DRAW['<kind>:<part>']` (B3),
      `MPB_FLOOR[kind](v, side, rec, t)` (B2: drawn on both boards' floor), `drawMpbGround` (B3: parts and kinds without
      health in a fight).
  - `rec.away = true` (B1): the record takes no tile, has no body, holds nothing and can't buy (a Tree kojja taken
    back, or standing for the other team). `rec.col < 0` (B3): not placed yet (the Magic lake's tiles), no main tile.
    `Mpb.queue(m, side, kind, part, key, lane)`: a one-player placement (only that lane places it, at once, no vote;
    `rec.data.lane` = whose). Each player places their own when they like: `Mpb.voteEntry(m, side, lane)` is the entry
    that player acts on (the head, or their own in the run of one-player entries at the head), `Mpb.placeEntry` places
    it; `Duo.mpbClock` keys a one-player head by its lane. A queue entry with `skill: true` (queued by a skill click) is
    hidden from the opponents.
- Opponents' view: `Mpb.hide(s, h)` (from `Referee.hide`): this round's clicks taken out of `n`/`by`, then each kind's
  `hide`, then this round's placements (`Mpb.seenList`, below); the team's queue is `m.mpbSeen[h]` (what was queued
  in the open, the draft's cards) with the votes blanked.

### Hidden until the fight (6 Nov, Vilhelm: "They should be hidden until the fight just like everything else")

- Markers on the records (team state, so the team sees them; only the round matters): `rec.placed = round` (a
  building `Mpb.placeEntry` placed: the vote, the clock, a bot, a one-player placement, a grown kojja, both Scorch
  turrets), `rec.pplaced[part] = round` (a part placed onto an older record), `rec.down = round` (a Magic lake tile
  put down or moved), `rec.data.moved = round` (Dig a new exit: `data.from` the old tile).
- `Mpb.seenList(list, round)`: side's records as the other team sees them while deploying: a record placed this
  round is left out, a part placed this round is left out, and a kind's `hooks.seen(rec, round)` gives the record as
  the round began (`coalMine`: the exit back on `data.from`, no `moved` / `from` / `by` keys, also none after a
  take-back's 0 / null; `magicLake`: a tile `down` this round is not down, col -1, no `down` key). Records changed are
  copies. The opponents' view is then byte-identical before and after any placement (the server's sync goes only when
  a view changes, so even its timing tells nothing). `addRec`'s key: the list's length + 1, but a record the opponents
  see at once (a lake tile from the card, a kojja standing for the other team) leaves this round's hidden placements
  out of the count, so no gap in the keys tells of one.
- `m.mpbSeen = [[entry, ...], x2]` (team state, `Duo.TEAM_FIELDS`): the queue as the opponents see it: what
  `Mpb.queue` added in the open (not a skill's `skill: true` entry, not a part's), never taken off by a placement;
  reset each round start (`Mpb.roundStart`).
- Seen mode: `Mpb.asSeen(side, fn)` runs fn with the board's tile functions (`recAt`, `at`, `terrainAt`,
  `buildingTiles` through `Mpb.tileRecs`, and so `Game.occupied` / `mpbAt`, `terrainBlocks`, `bldgSeen`, `spotOk`,
  `lakeOk` / `lakeFree`, `exitFree` / `exitMoveOk`, `canPlaceAt`...) counting the other team's records as `seenList`
  gives them (cached per list while it runs; the other team's Cog Builder's Factories only from earlier rounds). The
  server (src/duo.js) wraps every deploy-time action in it for the acting team: `Duo.act` (`Ref.act`), `sysAct` /
  `sysApply` (votes), `mpbBots` and `mpbTick` (bots' votes, the clock's result, per team), `botTurn`, `undoAllAllowed`
  and `rebuildTeam` (Undo all's replays; the presser's squad moved by `relocate(..., seen)` counts the other team only
  as seen: `Game.enemyHolds` / `bldgSeen`). The page needs nothing: its view already is that board. Outside it (the
  round's start, the artifacts' roll, the fight's start) everything is as it stands.
- Stamps (server only, in D, never in a view): `D.stamp[seat][id]` (squads) and `D.bstamp[team]['<key>|<part>']`
  (building tiles, parts, lake tiles; a Bastion wall `'w|col,row,edge'`) = `{ c, r, n }`, all on the one counter
  `D.stampN`, noted after every action, sys action and tick (`Duo.stampAll`); n is 0 for what stood as the round began
  and for a thing back on its round-start tile (`D.stamp0`, `D.bstamp0`, set in `beginRound` after the bots' turns).
- The fight's start: `Duo.runFight` → `mpbSettle` (open votes placed, as the team sees the board) → `stampAll` →
  **`Duo.settleBoard(D)`** → `fight`. settleBoard: Magic lake tiles nobody put down go down first (`Mpb.settleLakes`,
  everything known); then, until nothing is broken (at most 160 moves), `Duo.things` (squads, Cog Builder's
  Factories, `Mpb.boardTiles`: every building tile and part with `fresh` = the other team doesn't see it there, lake
  tiles, Bastion walls) and `Duo.conflicts`: `breaks(X, Y)` = 'same' (one tile), 'ring' (on a tile round a Coal mine's
  exit), 'near' (an Assassin on or next to a building tile or Factory), 'room' (a building with spacing within 2 tiles
  of another building), 'water' (a wall on water), plus 'shut' (a fresh lake tile that, with all the water known,
  shuts a tile off: `lakeFree`). Two things of one team count only for two squads (Undo all) or a thing this settle
  moved. The mover: the breaker (it must be fresh, or moved by the settle; a squad in a 'same' with another squad
  always may, as `unstack`); both broke it: the newer (bigger n), then the one out of its own zone, then `RANK` (squad,
  part, building, water, wall), then `mrand(D, 17 + guard)` with the pair in a fixed order. The newest mover goes first.
  It moves with its kind's rules, everything known: a squad `relocate` (its placement rules as a move, nothing on the
  tile in either lane; an Assassin also off the other team's Factories), a building tile or part `Mpb.moveTile`
  (`spotOk` strict, or `hooks.clashOk`; preferring a tile where no other fresh thing then breaks a rule: not next to
  an Assassin, not in another's room, no fresh thing in a moved exit's ring), a lake tile `lakeSpots` strict, a wall the
  nearest edge of the same way round `bwallSpotOk` allows. It keeps its stamp. No tile: it stays, and the other one
  moves instead if it can. `D.settled` logs the moves (tests). Then `Duo.settle` → `Mpb.settle` (`unclash`, the lake's
  `settle`) finds nothing left; they stay as the fallback for a fight without D (node tests' `Duo.settle`).
- The server (server/src/duo.js): a sync goes to a phone only when its view changed, and a 'status' only when its
  clock did (`clockNews`, after an act and after an alarm's tick; the alarm no longer forces a sync to all four).
- Placement: `Mpb.spotOk(m, side, kind, part, col, row, strict)` (as the team sees the board unless strict), `Mpb.spots(...)` (all allowed tiles, back of the zone and
  middle first), `Mpb.autoSpot(...)` (the first). `Game.mpbAt(m, col, row)` (in `Game.occupied`): every MPB tile and
  part is taken for both teams' squads (unless `place.open`). A kind that lets squads in (garrison, School) uses
  `hooks.holds` (group B1: `Game.garrisonFree` / `garrisonAt` ask `Mpb.holds`).
- Fight: `Duo.battle` adds `Mpb.bodies(lanes[0], side, undefined, lanes)` for both sides (`b.lane = 0`), then
  `Mpb.link(lanes[0], A, B)`, `opts.artifacts = Mpb.artifactsFor(lanes[0])` in rounds 2 and 8, then
  `Mpb.battleOpts(lanes[0], opts, lanes)`. `Duo.teamBody` covers
  `Mpb.isSquad(sq)` (-700 ... -1799), so lane 1 never gets MPB results. `Duo.fight` → `Mpb.afterFight(lanes, res,
  summaries, hp)` → `copyAll(lane 0 → lane 1)`.
- Draw: render2d `MPB_DRAW[kind](x, y, t, side, o)` (a building; `o.part` for a part's tile, `o.hpr` in a fight) and
  `MPB_BODY[kind](x, y, r, side, u, o)` (a walker, by `u.mpb`); models3d `BUILD['mpb:<kind>']`
  (`'mpb:<kind>:<part>'`, `'mpb:<kind>:<skin>'` with `u.mpbSkin`), fallbacks `BUILD.mpb` / `BUILD['mpb:part']`.
  Page sheet: `MPB_SHEET[kind] = { html(side, rec, live), wire(root, side, rec, again) }` in site-template.html (a
  region per kind); the generic sheet lists the kind's skills with Buy / Undo buttons for both teammates (read only for
  the opponents).

### Placement vote

- `m.mpbVote = [[{ kind, part, key, votes: [lane 0's { col, row } | null, lane 1's] }, ...], [...]]` (team state). The
  first entry is open: `Game.mpbVote(m, side, col, row)` (a tile `spotOk` allows; a player may change their vote); the
  same tile as the teammate's places it at once (`Mpb.placeHead`; its parts are queued next). `Mpb.queue(m, side,
  kind, part, key)` adds an entry (a kind's buy can, e.g. Tree kojja's "build another").
- The clock (`D.mclock.vote[side] = { key, until }`, src/duo.js): 15 s (`Mpb.VOTE_MS`) **from when the entry became
  the head** of the queue (not from the first vote). Then (`Duo.tick`, the server's alarm via `Duo.due`):
  `Mpb.voteResult`: two different allowed tiles → a seeded pick of the two; one → it; none (or no longer allowed) →
  `autoSpot`; no room at all → the entry is dropped. A bot votes at once (its human teammate's tile if they voted,
  else autoSpot; it switches to the human's tile when they vote, so that places at once). The deploy clock waits while
  any vote or the draft is open (`Duo.picksPending`). `Duo.runFight` settles anything still open first.
- Votes, placements and draft picks are **system** actions (`D.tlog` entries with `lane: -1`, `fn: 'sys:vote' |
  'sys:place' | 'sys:drop' | 'sys:draft'`, `Mpb.SYS`): Undo all replays them, so it never takes a vote or a building
  back. Seats see the clocks as `duo.clock = { vote, draft }` (ms left; `Duo.clocks(D, seat, now)`).
- Undo all (`Duo.rebuildTeam`, group B1): the player's own `mpbBuy` / `mpbUndo` clicks are replayed in place too, and
  then taken back, latest first, by the rules of a single take-back (`Mpb.canUndo`, the kinds' `canUndo`). So a
  building a click added (Grow) stays in the list as taken back, keys never shift, and the teammate's later buys stay
  on the records they were made on. A click that can't be taken back stays bought and stays paid for by that player.
  (`Duo.undoReplay`, used by `rebuildTeam`.) Undo all is refused (`'team'`, `Duo.undoAllAllowed`, group B3) while one
  of the teammate's building actions this round works only with the presser's (the log replayed with them, and as
  `undoReplay` leaves it), or a kind's `restoreOk` refuses; acts of a kind with `reconcile` don't count.

### Artifacts (rules side, group F; the fight part is group A's)

- `Duo` rolls at the start of rounds 2 and 8 (`Mpb.rollArtifacts(m, rng)`, seeded from `D.seed` and the round):
  `m.artifacts = { round, list: [{ id: 0|1, col, row, card: { type: 'tower'|'mpb', id }, won }] }` in both lanes (all
  four views; not hidden). The spots are point mirrors in no man's land, not flank tiles, ≥ 10 tiles apart
  (Euclidean); cards: two different ones from `Mpb.cardPool(m)` (all tower types and kinds with `draft !== false`,
  minus what either team has or has queued). `Mpb.artifactsFor(m)` → `opts.artifacts = [{ x, y, r: 9, cap: 100 }]`.
- After the fight `Mpb.afterFight` reads `res.artifacts[i].won` (none: nobody won), pays +50 (`Mpb.ARTIFACT.gold`) to
  each player of the winning team, `summary.artifacts = [{ id, won, card, gold }]`. At the next round's start the deal
  replaces `m.artifacts` (set to null) with `m.draft`.
- Engine (group A): `opts.artifacts = [{ x, y, r: 9, cap: 100 }]` → `battle.artifacts()` = `[{ x, y, r, pts: [a, b],
  rate: [a, b], locked: bool, won: -1|0|1 }]` live (in `m.artifacts.list` order), and `result().artifacts` the same at
  the end. Units: a body with an unlocked artifact within its awareness (`max(range + sight, minSight)`)
  soft-prioritises it: it moves into the circle; melee bodies still leave it to attack an enemy they have picked;
  ranged bodies stay inside and only shoot what they can reach from inside. Once the artifact locks, normal behaviour.
  Mirror-exact and deterministic, default off (`opts.artifacts` absent → nothing changes). Points per squad come from
  `b.tier` (`Game.bodiesFor`; a building's walker sets its own).
- Draw: both boards, 2D and 3D: a glowing orb on its tile, a ring of radius r, and a round meter with a blue (side 0)
  and red (side 1) bar filling from each side; locked: the winner's colour and a lock. The page's tap on an artifact
  shows its card (name + one line).

### The draft (rounds 3 and 9)

- `m.draft = { round, cards, won, owner: [team of card 0, of card 1] (null while a pick is due), first, how: 'both' |
  'split' | 'one' | 'none', pick, done }` (`Mpb.dealDraft`, both lanes). `split` / `one`: dealt at once; `both` (one
  team won both) and `none` (a seeded coin flip): `first` picks with `Game.draftPick(m, side, idx)` (either player;
  the first pick counts; a team of two bots picks at once (a human on the team picks, or the 15 s clock does), preferring a tower while it has the Outpost, then an MPB it
  hasn't got); 15 s (`Mpb.DRAFT_MS`, `D.mclock.draft`), then a seeded pick.
- `Mpb.giveCard(m, team, card)`: a tower card sets `m.towers[team].type` (round 9 or a team that had a type: its tower
  skills, walls, mage general, tower rounds and mark go, no refund); an MPB card queues its placement vote (or the
  kind's `acquire`).

### The Vault (`vault` region of src/mpb.js; the reference kind)

- Both teams' Vaults at the old treasury tiles (`Mpb.VAULT_SPOT`: side 0 col 6 row 15, side 1 col 17 row 2), hp 900,
  armor 4 (`Mpb.VAULT`). `m.vault[side] = { gold, mode, moved: [lane 0's, lane 1's], round, start }`.
- `Game.vaultPut(m, side, n)` / `vaultTake`: n ≥ 1, at most `VAULT.move` (200) a round per player over all moves; the
  first move of the round sets put or take for the team (`Mpb.vaultMode`); `Mpb.vaultRoom(m, side, mode)` is the most
  this player can move now. Undo all takes back the player's own moves (replay).
- Skills: Compound interest (200, match): +10% (down) at each round start. Coin golem (100, roundPlayer): the second
  player's click this round spends all the vault's gold, `rec.data.golem = { round, g }`; a take-back of either click
  puts the gold back. `Mpb.golemUnit(g)`: hp 300 + 3g, hit 30 + 0.12g, aps 0.7, range 3, splash 1.5, armor
  min(8, 2 + g/250), speed 4, 1 body, tier 3, `mpbSkin` bronze < 400 ≤ silver < 900 ≤ gold. It fights in front of the
  vault (squad `XSQ`), counts as a unit for winning. Destroyed: 80% of the gold lost (down to 10s), +50 to each
  opponent player, `summary.mpbNews`.
- The loan (`Game.takeLoan`) is every player's own and works in 2v2 without a treasury or Bank (tested).

### Adding a kind (checklist for B1-B5)

1. Fill your kind's region in `src/mpb.js` (`// ===== <kind> =====`): numbers, `skills`, `place`, `hooks`. Keep every
   constant of the kind in its region. Use only hooks; if you need a new one, add the call in the framework section
   (one line, default: nothing changes) and say so in your report.
2. Fight effects: `bodies` (structures: `structure: true, lesser: true`; set `mpb: '<kind>'` on every unit so the
   renderers find its look), `battleOpts` for engine fields (`opts.mpb.<yours>`, default off), `squadMods` /
   `squadBodies` for squads. Engine changes behind a default that changes nothing; 1v1, the counter table and Balance
   Lab stay byte-identical (`node tools/tests/fairness.js`, `node tools/counter-table.js`).
3. After-fight and round effects: `afterFight` (Team HP via `hp`, gold per lane, `Mpb.news`), `roundStart`.
4. Player actions: skills through `Game.mpbBuy` (+ `bought` / `unbuy` / `canBuy`), anything else through
   `Game.mpbAct` (`canAct` / `act`); both are already in `Referee.ACTIONS` and `Duo.TEAM_FNS`. Never add a new
   top-level action unless it can't be one of these.
5. Hidden info: `hide(s, h, rec)` for whatever the opponents mustn't see while deploying. A placement through the vote
   or `Mpb.queue` is hidden by the framework (`rec.placed`); a kind whose action changes the board some other way gives
   `seen(rec, round)` (the record as the round began, a copy) so both the view and the server's seen mode hide it.
   Take-backs: `canUndo` when a take-back would leave something wrong (a squad on the building's tile, gold stuck);
   Undo all goes through the same rule.
6. Look: `MPB_DRAW.<kind>` in src/render2d.js, `BUILD['mpb:<kind>']` in src/models3d.js (art direction:
   docs/art-direction.md), the page sheet part `MPB_SHEET.<kind>` in src/site-template.html if the generic sheet
   isn't enough (a squad to pick, a tile to tap).
7. Bots: `hooks.bot` (before the bot's squads) / `hooks.botAfter` (after them), called from `Duo.botTurn`.
8. Tests: `tools/tests/mpb-<group>.js` (copy the helpers at the top of `tools/tests/mpb.js`: `match`, `playTo`,
   `addHut`), plus `node tools/tests/mpb.js`, `node tools/tests/duo.js`.

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
