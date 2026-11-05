# Handoff G: Free-for-all mode on a "Fia med knuff" board (design first)

Branch `ffa`. Read `docs/HANDOFFS-1105.md` first. Test ports 8774-8776.

Vilhelm: a free-for-all mode with a "Fia med knuff" style map: a centre square and 4 smaller squares, one on each side.

This is a new mode, not a map. The game today has exactly two sides everywhere: the engine (side 0 / 1, `1 - side` for "the enemy"), match state (`m.armies[2]`, gold, towers...), hidden info (Referee.hide), the board rotation, the server rooms. 2v2 got around that by running two 1v1 lanes in one fight (`src/duo.js`); four players who all fight each other don't fit that trick. So phase 1 is a design doc, reviewed by Vilhelm, before code.

**Status (5 November 2026): phase 1 done.** The design is in `docs/FFA.md`, with Vilhelm's questions at the end. Wait for his answers before phase 2+ (the doc's build order starts with the engine's N sides).

## Phase 1: write docs/FFA.md (no game code)

Read first: `src/duo.js` header and `claude/duo-2v2.md` (how 2v2 shares one fight), `src/engine.js` (where it assumes two sides: grep `1 - `, `side === 0`, `sides`, `cripple`), `src/referee.js` (view/hide), `server/src/duo.js` (a 4-seat room), README "Maps".

The doc proposes, with a recommendation for each and the options it rejected:

1. The board: size in tiles, the cross shape (centre square + 4 arms), which tiles are each player's zone, no man's land, flank tiles, where each tower and treasury stands. Draw it as an ASCII grid like EDITOR_MAPS. Each player sees their own arm at the bottom (rotations of 0/90/180/270 degrees; today only 0/180 exist: list what in render2d/render3d/camera3d/input assumes 0/180).
2. Who fights whom: everyone in one battle each round (units target the nearest enemy of any colour), or pairings per round. Recommendation with reasons (readability on a phone, kingmaking, fight length).
3. Damage and elimination: who takes how much damage after a round (e.g. survivors per enemy player), health per player, what happens when a player reaches 0 (their army leaves; the board shrinks or their arm becomes no man's land), how the match ends (last one standing), placings.
4. Economy: income, loser bonus (who counts as a loser in a 4-way round?), shutdown bounty, carry cap.
5. Hidden info with three opponents: what each player sees while deploying.
6. Engine plan: N sides (side ids 0-3, "enemy" = any other side), with 1v1 byte-identical (fairness.js, the counter table, Balance Lab and the server referee must not change). Estimate the size of the change and the riskiest spots (targeting, cripple per side, spawns, side switches like the Gentleman, Lich raise).
7. Server: a 4-seat room (start from DuoRoom), AI for empty seats, reconnects.
8. The AI in FFA (who it targets/defends against).
9. Scope for a first playable: e.g. developer-only, vs 3 AIs on one phone, no towers or leaders, then online.
10. A build order in phases, each with its tests.

Keep the doc readable for Vilhelm: plain sentences, short tables, no code dumps. Push it to main and stop. List the questions he has to answer at the end.

## Phase 2+

After Vilhelm answers, build in the phases the doc lays out, developer-only (like 2v2's `who.dev` gate), one phase per session. Every phase: 1v1 untouched (`tools/tests/fairness.js`, `tools/tests/referee.js`, counter table unchanged), its own headless test (`tools/tests/ffa.js`), PATCH-NOTES entry.
