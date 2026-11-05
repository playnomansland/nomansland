# Free-for-all on a "Fia med knuff" board (design, 5 November 2026)

Status: **design only, nothing built.** Handoff: `docs/HANDOFF-FFA.md` (group G). Vilhelm's answers to the questions at the end decide phase 1.

Vilhelm's idea: a free-for-all mode for 4 players on a board like Fia med knuff: a centre square with a smaller square on each side, one per player.

## The short version

- **Board:** 24 x 24 tiles. A 12 x 12 centre square (no man's land) and four arms of 8 x 6 tiles (each player's zone). The corners are off the board.
- **Fights:** everyone in one battle each round. Units attack the nearest enemy of any colour.
- **Damage:** the round's placing decides it. The last army standing takes nothing; the others take damage from the units still standing, more the earlier they fell.
- **Under the hood:** like 2v2, each player keeps an ordinary 1v1 match of their own (gold, shop, levels, skills, every action through the same Referee checks), drawn in their own frame with their arm at the bottom. Only the fight is new: the engine learns to run 4 sides at once.
- **1v1 stays byte for byte the same.** The engine change is written so that with 2 sides every list and every order is exactly what it is today, and a test checks that tick by tick.
- **First playable:** developer only, you against 3 AIs on one phone, no towers, no leaders, no treasury, no flanks. Online comes after.

---

## 1. The board

### Size and shape

```
 0 # # # # # # # # N N N N N N N N # # # # # # # #
 1 # # # # # # # # N N N T N N N N # # # # # # # #
 2 # # # # # # # # N N N N N N N N # # # # # # # #
 3 # # # # # # # # N N N N N N N N # # # # # # # #
 4 # # # # # # # # N N N N N N N N # # # # # # # #
 5 # # # # # # # # N N N N N N N N # # # # # # # #
 6 # # # # # # . . . . . . . . . . . . # # # # # #
 7 # # # # # # . . . . . . . . . . . . # # # # # #
 8 W W W W W W . . . . . . . . . . . . E E E E E E
 9 W W W W W W . . . . . . . . . . . . E E E E E E
10 W W W W W W . . . . . . . . . . . . E E E E E E
11 W W W W W W . . . . . . . . . . . . E E E E T E
12 W T W W W W . . . . . . . . . . . . E E E E E E
13 W W W W W W . . . . . . . . . . . . E E E E E E
14 W W W W W W . . . . . . . . . . . . E E E E E E
15 W W W W W W . . . . . . . . . . . . E E E E E E
16 # # # # # # . . . . . . . . . . . . # # # # # #
17 # # # # # # . . . . . . . . . . . . # # # # # #
18 # # # # # # # # S S S S S S S S # # # # # # # #
19 # # # # # # # # S S S S S S S S # # # # # # # #
20 # # # # # # # # S S S S S S S S # # # # # # # #
21 # # # # # # # # S S S S S S S S # # # # # # # #
22 # # # # # # # # S S S S T S S S # # # # # # # #
23 # # # # # # # # S S S S S S S S # # # # # # # #
```

`S W N E` = the four players' zones (seats 0-3, clockwise: south, west, north, east). `.` = no man's land. `T` = tower spot (from phase 5; empty until then). `#` = off the board.

| | This board | 1v1 Standard (for comparison) |
|---|---|---|
| Board | 24 x 24 (144 m) | 14 x 18 |
| Your zone | 8 x 6 = 48 tiles | 14 x 7 = 98 tiles |
| Gap to a neighbour's zone (nearest tiles) | about 4.2 tiles = 25 m, across the corner | 5 tiles = 30 m |
| Gap to the opposite zone | 13 tiles = 78 m | – |

Why these numbers:
- **24 wide** is what the 2v2 board already uses, so we know it fits a phone.
- **The centre is wider than an arm (12 vs 8).** If the arms were as wide as the centre (a plain plus sign), two neighbours' zones would touch at the corner, one tile apart. With the narrower arms, neighbours are 25 m apart, a bit closer than in 1v1.
- **48 tiles a zone** holds the 15-18 squads a player has by round 9, but it is tighter than Standard. If it feels cramped, arms of 10 x 6 (60 tiles) with a 14 x 14 centre give a 26 x 26 board.
- **Neighbours are close, the opposite player is far.** Your two neighbours meet you first; the opposite army arrives late. That is the Fia med knuff feel, and it is the same for every seat, so it's fair.

Rejected: a plain plus (zones touch at the corners), a diamond (hard to draw on a square tile grid), a ring board (no centre to fight over).

### Tiles that are off the board

A new tile kind, "off the board": nothing can stand on it or walk through it, and shots and sight pass over it (like the water `~` on the Bridge map). Unlike water it also stops flying units, which today ignore walls and water, so an airship or a flier can't cut across a corner. It is drawn as a drop into darkness or as the table under the board, not as rock. The existing map format (`EDITOR_MAPS`, `terrainBlocks`) already has tiles that block placing and walking, so this is one more character, not a new system.

### Towers, treasuries, flanks

- **Phase 1: none.** No towers, no treasury, no flank tiles, no Forward planting.
- Later: one tower per arm at the `T` spots (the board turned four ways, so every seat's tower stands in the same place in its own arm). Flank tiles would be the arm's two side columns, opening onto the centre.

### Your arm at the bottom

Each phone shows its own arm at the bottom, so the board is turned 0, 90, 180 or 270 degrees. Today only 0 and 180 exist (`me === 1` flips the board).

Recommended: **each player works in their own frame**, where their arm is the bottom one. Their match (gold, squads, every rule) lives in that frame, so the game rules see exactly what they see in 1v1: own zone at the bottom rows. Only the fight runs on the shared board, and the FFA module turns positions in and out of it. Turning a tile or a point by 90 degrees only swaps and negates numbers, so it stays exact and deterministic.

What that means for drawing:
- **While deploying** the renderers need nothing new for the turning: the other players' squads arrive already turned into your frame.
- **During the fight** the module turns the playback frames into your frame before they are drawn: bodies, shots, projectiles, pools, portals, walls, guide arrows, spell zones, mines and the battle camera. Missing one of these is the main risk (something drawn on the wrong arm); the browser test checks each kind.
- Today's 0/180 code that stays as it is: `render2d` (`flip`, `PX`/`PY`, `scol`/`srow`), `render3d` (`tileCenter`, `screenTile`, the `f` sign in models, effects and the battle camera), `camera3d` (fits the board; a square board needs no change), and tile input (`tileAt`). In FFA every phone is "side 0" in its own frame, so these never flip.

Rejected: teaching the renderers and input a general turn (0-3). It touches every one of those spots for 1v1 too, and it still leaves the rules needing four different zone shapes.

### Colours

Four colours, from Fia med knuff: red, blue, yellow, green. Recommended: **each seat keeps its colour on every phone** (south is always red and so on), with your own zone outlined, so "the green player" means the same thing to everyone in chat. The alternative, "you are always blue" as in 1v1, is easier to read for yourself but makes talking about the others confusing. Question 3 below.

---

## 2. Who fights whom

**Recommended: everyone in one battle each round.** All four armies start together; each unit attacks the nearest enemy it can see, whatever its colour. The fight ends when at most one army has units left, or at the time limit.

| | One battle (recommended) | Pairings per round (rejected) |
|---|---|---|
| Feel | A real free-for-all: the Fia board in play | A 1v1 each round, using two arms of the board |
| Reading it on a phone | Busy: four armies meet in the centre | As clear as 1v1 |
| Counter-play | You counter your neighbours, keep an eye on the opposite player | Pure counter puzzle against one known opponent |
| Kingmaking | Someone can let two others wear each other down, then sweep up. Everyone has the same chance to do it, which is part of the mode | None |
| Fight length | Longer: allow a higher time limit | As 1v1 |
| Code | The engine needs N sides | Almost no new engine code |

Pairings are the safe option, but they don't use the board Vilhelm described: half of it would sit empty each round, and the result is 1v1 in a new frame. If the one big battle turns out unreadable in playtests, pairings are the fallback, and most of the FFA module (seats, frames, damage, placings) carries over.

Rejected as well: two-vs-two alliances that change every round (needs a deal-making UI; maybe later as a mode of its own).

---

## 3. Damage, elimination and the end of the match

### Placing in a round

- The army that is wiped out first places 4th, the next 3rd, and so on. The last army standing places 1st.
- At the time limit, the armies still standing are placed by how much of their starting health they have left (the same measure as a 1v1 timeout, `frac`).
- Two armies wiped out on the same tick share the lower place.

### Damage

Each player takes the 1v1 damage (`survivorDamage`: tier damage of the squads still standing, scaled by how much of each is left) of **all surviving units that aren't theirs**, times a factor for their place:

| Place | Factor |
|---|---|
| 1st | 0 |
| 2nd | 0.5 |
| 3rd | 0.75 |
| 4th | 1 |

At most 35 a round, as in 1v1 (`MAX_ROUND_DMG`). Spawned bodies and buildings don't count, as in 1v1.

Why this one: it reuses the 1v1 damage, it pays for outliving the others (so turtling in your arm while neighbours fight has a reward, but not the full reward), and nobody has to work out "who killed whom", which is hard to read and invites ganging up.

Rejected: damage from whoever killed your units (unreadable, and two players can gang up); a flat damage per place (ignores how big the win was).

### Health and elimination

- 100 health each, as in 1v1. More players take damage each round than in 1v1, but the place factors bring the total down; the first bot-vs-bot runs (phase 2) will tell whether the match length is right. Target: about 10-12 rounds.
- At 0 health a player is out. Their army leaves the board, their arm stays empty (nothing walks there anyway), and they can keep watching or leave.
- **The match ends when one player is left.** Final places: by the round each player went out (later = better); players out in the same round are placed by their health before that round, then by that round's place.
- When only two are left, it plays as a 1v1 on the cross board. If they sit opposite each other the walk is long (78 m); a later idea is to shrink the board in the final, not needed for phase 1.

---

## 4. Economy

| | 1v1 | FFA (proposal) |
|---|---|---|
| Starting gold, income (+100 a round from round 3) | as now | **same** |
| Loser bonus (+50 from round 3) | the loser | **the players placed 3rd and 4th** that round |
| Carry cap 500, loans | as now | **same** |
| Shutdown bounty (breaking a 3+ win streak) | as now | **off in phase 1.** A "win" in FFA is a 1st place; who gets the bounty when two players outlive the streaker is unclear. Revisit once we see how often streaks happen |
| Packages (pick 1 of 3) | as now | **same**, without leaders in phase 1 |

---

## 5. What you see of three opponents

The 1v1 rule, applied to each opponent: **you see their squads from earlier rounds, not what they placed, moved, levelled or bought this round.** The same hiding (`Referee.hide`) runs once per opponent. Their gold, health and place last round are shown in a small table on the HUD.

Phase 1 has no leaders or towers, so there is nothing else to hide. When leaders come in, the 1v1 rule (hidden until the first fight) applies to each.

---

## 6. Engine plan: N sides

### What changes

The engine is built around two sides: `sides[1 - b.side]` ("the enemy") appears 32 times in `src/engine.js`, and about 15-20 places use "forward = `side === 0 ? 1 : -1`" (spawn spots, marching direction, walls, builders, drops). Plus a handful of two-slot arrays and the result.

| Part | Change |
|---|---|
| "The enemy" (32 spots) | `foes(side)`: all other sides in a fixed order (side+1, side+2, side+3, each round the circle). With 2 sides it returns the very same array as `sides[1 - side]` today. The circular order means every seat sees the same order relative to itself, so ties are broken the same way for everyone |
| Forward direction (about 15-20 spots) | `fwd(side)`: a direction per side. Sides 0 and 1 keep today's (0, +1) and (0, -1). In FFA every army marches toward the centre; the per-body `march` field that flank squads already use carries it. Spawn spots are turned with it |
| Fast targeting (`indexedTargets`, movement grids) | One grid per side as now; a body asks each foe's grid and the answers are merged in the `foes` order |
| Two-slot arrays (`cripple`, `charmUsed`, `spawnNo`, `stats`, survivors) | N slots |
| Fight end and result | "At most one side has units left"; the result gains per-side places and times out. With 2 sides `winner`, `frac`, `score`, `survivors` are exactly today's |
| Side switches (Gentleman, the Lich's raise) | Already move a body to the converter's side; they only need the N-slot arrays |

### Keeping 1v1 identical

- The rule: with 2 sides, every list holds the same bodies **in the same order** as today, and nothing new is computed. Where FFA needs a different path, it is a branch on the number of sides, not a rewrite of the 1v1 path.
- Checked by: per-tick state hashes of a set of 1v1 battles before and after (as `tools/tests/fast-paths.js` does), `tools/tests/fairness.js`, `tools/tests/referee.js`, the counter table rebuilt with the same numbers, and a short Balance Lab run with byte-identical reports.
- New: a 4-way fairness test: the same army in all four arms, turned, must give the same result for every seat.

### Size and risks

About 150-250 changed lines in the engine, mostly mechanical. Riskiest spots:
1. **Order of work within a tick.** The 2026-10-14 fix (bodies killed in a tick still attack in it) keeps 1v1 fair; with four sides a processing-order bias could show up again. The 4-way fairness test is there to catch it.
2. **Tie-breaks in target choice** ("if `d <= bd`" keeps the last of equal distances): with the circular foe order they are the same for every seat; checked by the same test.
3. **Spawns and drops** (goblins, Necromancer, Water Elemental, Airship): spots ahead of the summoner need the turned direction.
4. **Area effects that assume one enemy** (pools, burn zones, Gentleman stacks, mines): each one is checked by name in the test.
5. **Speed.** Four late-game armies is about the size of 2v2's (already tested up to 213 bodies), so the server can carry it. The fast targeting mode may have to be on for FFA fights.

---

## 7. Server

- A new 4-seat room, `FfaRoom` at `/ffa/<CODE>`, started from the 2v2 `DuoRoom`: the same lobby with seats, swap and kick, AI in empty seats, keys for reconnects, the away clock, chat and emotes.
- Each seat has its own match (its own frame), refereed by the same `Referee.act` as 1v1. The room builds the fight from all four (`Ffa.battle`), sends each phone its own frame, then resolves each match.
- Leaving a match = your health goes to 0 that round (your army leaves). An away player's army still fights with what it has.
- Developer only to create (as 2v2's `who.dev`); later listed in the lobby as its own kind.

---

## 8. The AI

- Placement: the AI's normal placement (`aiSpot`) in its own arm; it already thinks in "my zone at the bottom".
- What to buy: the AI counters the **two neighbours first** (weight 1 each) and the opposite player less (weight 0.5), using the counter table as it does now.
- It doesn't pick targets (the fight does that) and doesn't play around placings in phase 1.

---

## 9. Phase 1 scope (first playable)

- Developer only. You against 3 AIs, on one phone (offline, like vs AI today).
- The cross board, packages without leaders, the built-in units, skills, levels, moves, selling, loans.
- **Off:** towers and everything bought through them (tower skills, walls, Fortify, mage generals, Mark Bounty), treasury, leaders, flanks, Forward planting, Hunter marks (they target one enemy squad; which opponent's is a question for later).
- HUD: four health bars with colours and last round's places. Results screen: places and damage for all four. End screen: final places.

---

## 10. Build order

Each phase: 1v1 untouched (`fairness.js`, `referee.js`, the counter table unchanged), its own tests, a PATCH-NOTES entry. One phase per session.

| Phase | What | Tests |
|---|---|---|
| 1 | **Engine N sides.** `foes`, `fwd`, N-slot arrays, N-side result. No game change | Per-tick hashes of 1v1 battles before/after; 4-way fairness (`tools/tests/ffa-engine.js`) |
| 2 | **`src/ffa.js`, headless.** The `ffa` map, four matches in their frames, turning in and out, the battle, places, damage, elimination, economy, the AI on all four seats | `tools/tests/ffa.js`: whole bot-only matches, every seat wins some, match length, determinism |
| 3 | **On the phone (developer menu): FFA vs 3 AI.** Board with off-board corners, four colours, other players' squads, the fight turned into your frame, HUD, results and end screens | `tools/tests/ffa-ui.js` (port 8774) |
| 4 | **Online.** `FfaRoom`, lobby seats, AI fill, reconnect, hiding per opponent | `server/test/ffa.test.js` (ports 8775-8776) |
| 5 | **Towers, treasury, leaders, flanks**, then balance runs (place-factor and health tuning) and lobby listing | Extended `ffa.js` |

Phases 1 and 2 have no visible change, so they can go to main as soon as their tests pass.

---

## Questions for Vilhelm

1. **One battle for everyone** (recommended), or a 1v1 pairing each round?
2. **Board:** 24 x 24 with arms of 8 x 6 (48-tile zones, recommended), or bigger arms (10 x 6 on 26 x 26)?
3. **Colours:** fixed Fia colours per seat on every phone (recommended), or "you are always blue"?
4. **Damage:** place factors 0 / 0.5 / 0.75 / 1 times the survivors' damage (recommended), or something else, such as only the last-placed player taking damage?
5. **Eliminated players:** watch until the end (recommended), or leave straight away?
6. **Phase 1 without towers, leaders and treasury** (recommended), or should towers be in from the start?
7. **Online:** only with friends by code at first (recommended), or listed in the lobby right away?
