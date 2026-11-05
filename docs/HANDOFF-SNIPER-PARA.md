# Handoff B: Sniper tower paratroopers and the "You are marked" box

Branch `sniper-para`. Read `docs/HANDOFFS-1105.md` first (shared rules). Test ports 8760-8761.

## 1. Drop paratroopers replaces Deploy airship

Vilhelm (5 Nov): remove the airship skill from the Sniper tower, replace it with "drop paratroopers": 3 paratroopers dropped in the enemy base, dealing damage when they land, 3 seconds before they are dropped. Paratrooper = a Wisp with instant projectiles.

Where it lives now (`src/game.js`):
- Tower definition, `TOWER_TYPES` sniper entry: `skill2: { name: 'Deploy airship', cost: 400, text: ... }`.
- `AIRSHIP = { speed, hover, drop: 3, sniperHit: 30, level: 1 }` (line ~238), used in `bodiesFor` (the `if (airship)` block that builds the 'Airship' body with `drop: { unit: para, count, y, dir }`), the `+AIRSHIP.sniperHit` lines for Snipers and the tower (~1891, ~2034), and exports.
- The paratrooper is already built from the roster's Wisps (`para = withTraits({ ...Wisps, name: 'Paratrooper', bodies: 1, shape: 'diamond' })`).
- Engine: `u.drop` handling in `src/engine.js` (~2389 flight, ~2739 the drop itself). Page: the legend entry `airship: ['Airship', 'ring', ...]` (~line 7001 of site-template) and any airship text.

What to build:
- New skill2: name "Drop paratroopers", cost 400 (unchanged; flag it in "To check"). Text along the lines of: "3 seconds into each fight, 3 paratroopers drop into the enemy base and hit everything they land on."
- Paratrooper unit: the roster's Wisps with `projSpeed: 0` (instant), 1 body each, 3 bodies total, shape 'diamond', colour '#E2D3A6'. Like the airship's, it follows the roster's current Wisps stats (levels: none).
- Timing: they appear at fight time 3 s (a new timed spawn; the engine already has timed strikes for the devtest, see `timed` / strikes in engine.js, reuse what fits). During those 3 s show a landing marker (a shadow or ring on the landing spots) on both boards, 2D and 3D.
- Where: the enemy base = around the enemy tower. Spread the 3 in a small triangle about 1 tile in front of the enemy tower (toward the middle of the board), clear of the tower body. If the enemy tower is down already (can't be at 3 s, but be safe) use its tile.
- Landing hit: each paratrooper, on landing, hits every enemy body within 3 m for the paratrooper's own hit (the Wisp's hit, armor and ward apply, through `hurt()` like the death blast). Not the tower's own side. Mirror-exact: process in a fixed order (fairness.js must pass).
- Remove the airship entirely: the Airship body, `+30 hit` for Snipers and the tower (it belonged to the airship skill; flag the removal), `AIRSHIP` constants that are no longer used, the legend entry, texts. Keep the engine's generic `u.drop` code only if something else uses it; otherwise remove it too.
- Saved matches/history replays with an old airship: `towerSkill2` stays the same key, so an old match just gets paratroopers. Fine.
- 2v2 (`src/duo.js` ~87: "the team's tower, its guards and airship"): only lane 0's tower stands in the fight; make sure paratroopers come from lane 0's skill only, once per team, and land at the enemy team's tower.
- The bot / Claude opponent buy the skill2 by id, check they still do.

Tests: update `tools/tests/towers-1028.js` (it checks the airship drop) to check: 3 paratroopers appear at 3 s near the enemy tower, landing hit applied, nothing before 3 s, Snipers no longer get +30. Add the drop to `fairness.js` coverage if it isn't picked up. Server: `cd server && npm test`.

## 2. "You are marked" box in the unit sheet

Vilhelm: units that are marked should have a little "You are marked" box in their sheet, with a short description and a hold-to-read-more part.

Marks that exist:
- Mark Bounty (Sniper tower, `MARK`, `Game.markOf / markOn / markShown`): one enemy squad for the rest of the match. Sheet code around site-template ~5974 and ~6356.
- Hunter prey (awakened Hunter Sniper, `Game.preyOf / preyShown`, `sq.prey`): chip "Marks your X" today (~6316).

Build:
- In the squad sheet of a squad that is marked by the opponent (as far as the viewer may see: use `markShown` / `preyShown`, never leak a mark placed this round), a box "You are marked" using `upRow` (the existing press-and-hold row, ~6532), so it has a one-line text and a hold-to-read part:
  - Bounty: short "Their units deal +15% damage to this squad and see it through stealth." More: "Placed by their Sniper tower's Mark Bounty. Lasts the rest of the match. They get +100 gold each fight their units take its last body. Selling the squad lets them place it again for free."
  - Prey: short "Their Hunter Snipers go for this squad first and deal +100% damage to it." More: the Hunter rules (sees through stealth, the mark can move each round).
- The same box on the opponent's squad you marked, worded from your side: "Marked by you" with the same texts.
- Both marks on one squad: two boxes.
- Style: a small bordered box in the foe colour (or gold for "Marked by you"), consistent with `.up` rows; works in 2D and 3D sheet, phone and PC.

Tests: browser test `tools/tests/marked-ui.js` (port 8760): mark a squad (bot opponent or two pages), check the box shows for the marked side only after the mark is visible, and the hold reveals the more text. Headless parts in `tools/tests/towers-1103.js` style if needed.

PATCH-NOTES entry: "Sniper tower: paratroopers" and "Marked squads say so".
