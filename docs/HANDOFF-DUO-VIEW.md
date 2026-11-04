# Handoff D: 2v2 view (sheets, owners, rings, team stats, pings, tower and treasury spots)

Branch `duo-view`. Read `docs/HANDOFFS-1105.md` first (shared rules). Test ports 8765, 8767-8768. Background: `claude/duo-2v2.md` in the Project, README "2v2 (developer test)", `src/duo.js` header comment.

You own the view/sync side of 2v2: `m.team` (what each phone gets about the other lane), the page's drawing and sheets. Group E1 works on the fight side (`Duo.fight`, `laneResult`, engine) at the same time; keep out of those functions. Group E2 (horses) starts after you merge, and builds on your ally sheets and ownership, so keep ownership in one helper (see 2).

## 1. Tower and treasury spots

Vilhelm: tower 5 squares to the right, treasury 4 squares to the left, mirrored for the opponent like the 1v1 map.

`src/game.js` EDITOR_MAPS.duo (~521), `buildings`:
- side 0 tower col 12 -> 17 (row 16); side 1 tower col 11 -> 6 (row 1)
- side 0 treasury col 10 -> 6 (row 15); side 1 treasury col 13 -> 17 (row 2)
(Point symmetry, as Test Grid: its tower is right of centre and its treasury left.) Check: lane 1's copies use the same tiles (Duo note: lane 0's stand in the fight), Overwatch/garrison into tower and treasury, Bastion walls and Fortify spots, the Sniper tower's paratroopers (group B) land by the enemy tower wherever it is, the bot's placement (`aiSpot`) keeps clear, 2D and 3D scenery. `tools/tests/duo.js` has spot checks: update them.

## 2. Tap any unit, see whose it is

Vilhelm: always able to click any unit to pull up its sheet, and the sheet says whose unit it is. Able to see allies' unit sheets.

- One helper `ownerOf(sq)` -> { seat, name, rel: 'you' | 'mate' | 'foe' } for any squad on a 2v2 board (own army, `Game.teamArmy`, the opponents' seen squads). Use the lobby/seat names (`seatName`), never "gamertag".
- In 2v2, every squad on the board can be tapped in every phase (deploy, battle playback, results, Replay a round). Own squads: the normal sheet. Teammate's: the full sheet (stats, level, XP, skills, awaken, direction) read-only, no buy/sell/move buttons. Opponents': the foe sheet as in 1v1 (hidden-info rules unchanged: nothing placed this round, no skills bought this round).
- Sheet header line: "Yours", "<name>'s (teammate)" or "<name>'s (opponent)", in that player's ring colour (3).
- In battle, tapping a body opens its squad's sheet the same way (1v1 battle tapping: keep whatever works there; just make it work for all four players' squads).

## 3. A colour per player

Vilhelm: different coloured circle outlines under units, to see whose unit is whose.

- In 2v2 every squad gets an outline circle under it in its player's colour, on both boards (render2d ~612-648 and ~989, render3d ~541-560 where the teammate ring is drawn now). Bodies keep their team colours, so teams still read at a glance.
- Colours: you = your team colour's light shade, teammate = a second shade of your team (e.g. cyan next to blue), opponents = two clearly different warm colours (e.g. red and orange). Colour-blind check: also differ in lightness. Show the four colours with names in the HUD (a small legend by the team health) and in the ping toast.
- Replace the current small teammate ring with this system.

## 4. Allies' direction arrows

Vilhelm: see the other allied player's direction inputs for melee units.

- `sq.aim` (src/game.js AIM, `claude/direction-arrows.md`) has to reach the teammate: include it in `m.team.armies` for the teammate's squads (src/duo.js view ~423 and server/src/duo.js), never for the opponents' while deploying (Referee.hide rules stay).
- Draw the teammate's arrows in their colour, thinner or dashed, in 2D and 3D. Their sheet shows the direction read-only.

## 5. Team units damage toggle

Vilhelm: the round's damage stats only show the user's damage; add a button to toggle team units.

- `openStats` (site-template ~7024). Add a toggle "My units / Team units" (remember the choice per session). Team units lists both players' squads, each row tagged with the owner's colour/name, and a total per player. The fight is one battle with all bodies, so the per-body numbers exist on every phone; map them back to squads via the Duo lane offsets (`Duo.OFF` ids).
- 1v1 keeps the screen as it is (no toggle).

## 6. Pings fade faster

`PING_MS = 8000` (site-template ~8373): set to 3000, and make the ripple ring animation fit inside that time (CSS ~405). `render` timer at ~8403 follows PING_MS.

## Tests

- `tools/tests/duo.js` (headless): new spots, teammate `aim` in `m.team` and not in the opponents' view during deploy.
- `tools/tests/duo-ui.js` or a new `duo-view-ui.js` (port 8765): tap a teammate's squad -> read-only sheet with owner line; tap an opponent's; colours differ per seat; stats toggle shows the teammate's rows; a ping is gone after ~3 s.
- `cd server && npm test` (duo.test.js).

PATCH-NOTES entry: "2v2: see whose unit is whose".
