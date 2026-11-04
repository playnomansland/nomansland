# Handoff E1: 2v2 gameplay (portal, Mechite units)

Branch `duo-play`. Read `docs/HANDOFFS-1105.md` first (shared rules). Test ports 8769-8771. Background: `claude/duo-2v2.md` in the Project, README "2v2 (developer test)", `src/duo.js` header comment.

You own the fight side of 2v2: `Duo.fight`, `Duo.laneResult`, the engine, and the 2v2 unit set. Group D works on the view side (`m.team`, sheets, drawing, the map's tower/treasury spots) at the same time: keep out of those, and rebase often. D moves the towers (side 0 col 17 row 16, side 1 col 6 row 1); don't hard-code tower tiles, read them from the map.

## 1. Portal where an enemy tower fell (2v2 only)

Vilhelm: after destroying the opponents' tower, a portal appears in its place. All allied units prioritise moving into the portal over everything except enemy units in awareness range. The portal goes to the allied tower. "It's just a transporter."

Rules:
- When a team's tower dies in a 2v2 fight, a portal opens on its spot for the rest of that fight. It belongs to the team that took the tower.
- Every body of that team (both players' squads) that can walk switches its goal to the portal, unless an enemy body is within its awareness/sight range (then it fights as normal and goes back to the portal afterwards). Not structures, buildings, things that never walk, riders still inside a carrier (the carrier walks in and the rider goes with it), or bodies in the middle of a charge/trample run (they finish it first).
- A body that reaches the portal (within ~1 m of its centre) is moved to just in front of its own team's tower spot (spread on free formation spots so they don't stack) and goes on fighting as usual from there.
- Each body uses the portal at most once per fight (otherwise they loop home -> portal -> home). This is Claude's reading; put it under "To check with Vilhelm".
- If its own tower has fallen too, the exit is still its own tower's spot.
- Engine: behind an option (e.g. `g.portal = true`, set only by `Duo.fight`), so 1v1, the counter table and Balance Lab are byte-identical. Deterministic and mirror-exact: process in a fixed order, no `Math.random`; `tools/tests/fairness.js` must pass and add a mirrored 2v2 tower-fall case to it or to `tools/tests/duo.js`.
- Where it hooks in: tower death is where `cripple` / `downNow` are set (engine.js ~813-822; mind the Teleport mage general's tower jump, which isn't a fall). Movement goals: the per-body goal/target picking in the move step (search "lock on", `aware`, `sight`).
- Drawing: a portal on both boards (2D render2d, 3D render3d) at the fallen tower, and a short flash at both ends when a body goes through. Playback on every phone comes from the same deterministic fight, so no extra sync.
- Survivor damage, XP and kill credit: unchanged (a body that went through still counts as its squad).

## 2. Mechite units in 2v2

Vilhelm: add the Mechite units to 2v2, all except Altar of Build.

- In: Rollers, Cog Builder (with its Factory, the building it makes), Mechite Guards; data in `src/factions.json` (faction 'mechites') and `src/faction-units.json`. Out: Altar of Build (the unit and the building).
- 2v2 matches use the built-in units (page `useSet`, server `server/src/units.js` + `prepare-units.cjs`, compared by `tools/tests/prepare-units.js`). Give 2v2 its own unit set = built-in units + the three Mechite units, prepared the same way on page and server, so the referee and every phone agree. 1v1, ranked and tournaments stay on the built-in set.
- They go in the shop by tier and can come in packages (same rules as other units).
- Factory/buildings in a non-devtest match: `Game.setBuildings`, `buildingAt`, `buyBuilding`, the building's own tile rules; in 2v2 a building must also block the teammate's tiles (`Game.teamArmy` tile sharing ~1022) and reach the teammate's phone (coordinate the `m.team` field with group D: add buildings to what `m.team` carries, in one small commit, and tell D in the commit message). Referee `ACTIONS` must allow what the Cog Builder needs (check `addAltar` stays out).
- The bot in 2v2 (`Duo` bot turn ~286, `aiDeploy`) may buy them; check it handles the Factory or skip Cog Builder for the bot (note it).
- Unit sheets/encyclopedia texts: ROLES already has Mechite lines (site-template ~827).

## Tests

- `tools/tests/duo.js`: portal opens on a tower fall, bodies go through once and come out at their own tower, nothing happens in 1v1; a 2v2 match with Mechite units (Factory built, shared tiles, no desync between lanes and server).
- `tools/tests/fairness.js` passes; counter table unchanged (`node tools/counter-table.js` reports no changes).
- `cd server && npm test` (duo.test.js, match tests).

PATCH-NOTES entry: "2v2: tower portal and Mechites".
