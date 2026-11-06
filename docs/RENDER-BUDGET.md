# Render budget: triangles for unit models on the 3D board

**Status (2026-11-06): done.** Measured on PC (steps 1–3) and on Vilhelm's iPhone (step 4). **Budget: 500,000 triangles for all unit models on the board; 2,890 triangles per body as the absolute ceiling; or by squad size, from 4,600 a body for a single-body unit down to 990 for a 12-body swarm.** No model today is over it.

Until now the only rule was the Model Forge's Game check: a warning above 1,400 triangles per model, and "try to stay under about 1,000". That number was a guess, and it was per body, so it said nothing about a full board. This doc replaces it with a total for the board and a per-body ceiling taken from it.

The wider plan for 3D speed (cheaper materials, resolution, shadows, LOD) is in `docs/PERFORMANCE.md`. Its A/B tests can reuse the stress page below.

Tools (all in `tools/tri-budget/`):

| File | What it does |
|---|---|
| `models.js` | Loads three.js and `src/models3d.js` in node (no browser), plus the Model Forge saves in `models/`. |
| `count.js` | Step 1: triangles per model, and bodies and triangles per squad. `node tools/tri-budget/count.js [--json out.json]` |
| `worst.js` | Step 2: a Balance Lab batch that watches every fight and records the biggest board. It writes `worst.json` (every fight) and `worst-fight.json` (the match just before the biggest fight). `node tools/tri-budget/worst.js --matches 40` |
| `stress.html` | Step 4: the stress page (dev only, nothing links to it). See "Stress test" below. |

## 1. Triangles per model

Triangles for one body, all parts (`count.js`, 2026-11-06). Every model is flat-shaded and non-indexed, so vertices are 3× triangles.

**Units** (largest first): obelisk:eye 904, obelisk 776, mammoth 464, roller 364, sunPriest 352, roller:unfolded 320, leafmech 312, spider 296, cogBuilder 276, necro 262, truespear 240, hellfiend 230, ent 228, meteor 224, skeleton 220, golem 220, mechGuard 200, cogMech 196, cogTurret:awake 196, sniper 192, archer 184, drone 184, cogGunner 168, cogTurret 164, wizard:water 162, wizard:frost 162, shiv 160, assassin 156, cogFighter 156, wizard:leaf 154, wizard:earth 150, rogue 144, brute 140, wizard:fire 140, wizard:slime 140, wizard:steel 138, goblin 136, wizard:flame 134, minebot 132, caster 120, soldier 116, slimeshot 112, horse 108, repairbot 100, flier 88, healbot 84. Spear (projectile) 24.

**Skins:** brute:omniper 816, brute:champion 502, wizard:fire:ember 399, golem:aquamarine 380.

**Structures:** treasury 3,412 (the KayKit chest and coins), building:altar:awake 772, building:altar 676, building:factory:awake 668, tower:f-mechites:awake 632, tower:bastion 548, tower:keep 516, tower:f-mechites 448, building:factory 344, tower:slime 290, tower:faction 244, tower:sniper 196, wall 192, tower:bank 180, watchtower 140, tower:outpost 96, tower:mage 90, lesser 84, stonewall 84, spire 76.

**Model Forge saves in `models/`, not built into the game yet:**

| File | Key | Triangles | In the game now |
|---|---|---|---|
| `models/base/fire-mage.model.js` | wizard:fire | 351 | 140 |
| `models/base/leaf-wizard.model.js` | wizard:leaf | 327 | 154 |
| `models/skins/spiders-gold.model.js` | spider:gold | 280 | (spider 296) |

**Squads of `src/default-roster.json`** (tier = price step: 100 / 200 / 300 / 500 gold):

| Unit | Tier | Model | Bodies | Tris/body | Tris/squad |
|---|---|---|---|---|---|
| Skeleton Archers | 1 | skeleton | 8 | 220 | 1,760 |
| Goblin Swarm | 1 | goblin | 12 | 136 | 1,632 |
| Ent | 1 | ent | 2 | 228 | 456 |
| Ember Imps | 1 | flier | 4 | 88 | 352 |
| Sniper | 1 | sniper | 1 | 192 | 192 |
| Wisps | 1 | flier | 2 | 88 | 176 |
| Fire Mage | 1 | wizard:fire | 1 | 140 | 140 |
| Spiders | 2 | spider | 6 | 296 | 1,776 |
| Slimeshots | 2 | slimeshot | 10 | 112 | 1,120 |
| Shiv | 2 | shiv | 3 | 160 | 480 |
| Leaf Wizard | 2 | wizard:leaf | 1 | 154 | 154 |
| Earth Wizard | 2 | wizard:earth | 1 | 150 | 150 |
| Brute | 2 | brute | 1 | 140 | 140 |
| Just a horse | 2 | horse | 1 | 108 | 108 |
| Obelisk | 3 | obelisk | 1 | 776 | 776 |
| Rogue | 3 | rogue | 2 | 144 | 288 |
| Water Mage | 3 | wizard:water | 1 | 162 | 162 |
| Frost Wizard | 3 | wizard:frost | 1 | 162 | 162 |
| Slime Wizard | 3 | wizard:slime | 1 | 140 | 140 |
| Steel Wizard | 3 | wizard:steel | 1 | 138 | 138 |
| Flame Wizard | 3 | wizard:flame | 1 | 134 | 134 |
| War Mammoth | 4 | mammoth | 1 | 464 | 464 |
| Sun Priest | 4 | sunPriest | 1 | 352 | 352 |
| Necromancer | 4 | necro | 1 | 262 | 262 |
| Truespear | 4 | truespear | 1 | 240 | 240 |
| Meteor Caller | 4 | meteor | 1 | 224 | 224 |
| Ether Golem | 4 | golem | 1 | 220 | 220 |
| Assassin | 4 | assassin | 1 | 156 | 156 |

Every model today sits far under the old 1,000 guideline. The biggest squads are the swarms (Spiders, Skeleton Archers and Goblin Swarm at about 1,600–1,800 triangles a squad), not the giants.

## 2. Worst case on the board

`worst.js --matches 40` (seeds 700000–700039, no mirror, ranked settings, AI vs AI, refereed). Each fight was checked every engine step (0.05 s). Bodies are live unit bodies on both sides (towers, buildings and walls not included). Unit triangles use each body's own model.

| Round | Fights | Avg squads (both sides) | Avg peak bodies | Max peak bodies | Max unit tris |
|---|---|---|---|---|---|
| 1 | 40 | 7.5 | 28 | 54 | 8,176 |
| 3 | 40 | 13.1 | 55 | 88 | 14,502 |
| 5 | 40 | 18.4 | 77 | 140 | 21,094 |
| 7 | 33 | 23.9 | 95 | 137 | 20,468 |
| 9 | 24 | 29.7 | 113 | 156 | 22,786 |
| 10 | 18 | 33.1 | 125 | 169 | 25,338 |
| 11 | 8 | 37.3 | 134 | **173** | **26,150** |
| 12 | 4 | 39.8 | 146 | 162 | 23,442 |
| 13 | 1 | 44.0 | 145 | 145 | 20,848 |

The squad counts match Balance Lab's: about 15 a side at round 9 and about 19 at round 11.

**The worst fight:** match 700017, round 11, Test Grid. 42 squads (22 + 20) and **173 bodies at the start of the fight**: 60 goblins, 32 skeletons, 30 slimeshots, 20 imps, 7 Fire Mages, 7 Earth Wizards, 6 spiders, 5 Meteor Callers and 6 others. That's 26,150 unit triangles. The same fight also had the most unit triangles of the batch. Bodies drop fast once the shooting starts: 173 at 1 s, 134 at 3 s, 81 at 5 s, 43 at 10 s.

The rest of that frame, from the stress page with the game's own models (PC, quality High, strategic view, the main pass), in the fight's own look (Test Grid draws as Frozen Peak) and in Meadow, the heaviest look:

| Part | Own look | Meadow | Note |
|---|---|---|---|
| Unit bodies | about 23k | about 23k | 153 bodies on average over the first 4 s |
| Structures | 7.3k | 7.3k | 4 in this fight. A treasury alone is 3.4k. |
| Scenery | 127k | 279k | Per look: Frost 127k, Snow 136k, Desert 167k, Autumn 263k, Meadow 279k |
| Ground, rings, markers, effects, projectiles | about 39k | about 42k | Most of it is the ground plane: 96 × 128 height samples, 24.6k triangles, even on flat maps. |
| **Whole frame** | **196k** | **351k** | 78 / 92 draw calls |

Projectiles: up to 59 in flight in one fight, and up to 42 shots in 0.3 s. Shots are beams, and projectiles are one instanced sphere mesh. Both cost little.

## 3. How render3d draws units: instanced already

Units are **instanced already**. `placeBodies()` in `src/render3d.js` groups bodies by model and look (`kind#look`). Each model is up to three merged geometries (`tint`, `team`, `fixed`, see `Models3D.parts`), and each one is a single `THREE.InstancedMesh` for every body of that model. So draw calls grow with the number of **different models** on the board, not with bodies.

- In the worst fight, 13 unit models make 39 draw calls for 173 bodies. The whole frame is 78 calls in the main pass (`renderer.info.render.calls`), 92 in Meadow.
- With shadows on (quality High and Medium), every unit mesh is drawn a second time into the shadow map. `renderer.info.render` doesn't count that pass, because three.js resets it after the shadows are drawn. So on High and Medium **a unit's real vertex cost is about 2× its triangles**. The per-body numbers below already allow for this, since the stress test runs with shadows on.

**Draw calls are not the limit.** 78 calls is low for a phone (95 on the iPhone in Meadow, at every step), and adding bodies doesn't add calls. The budget is in triangles (vertices), and on a phone at 2× pixel ratio, in fill rate. Merging further (all unit models into one mesh) would save about 30 draw calls and wouldn't raise the triangle budget. Nothing to build here (step 7).

## 4. Stress test on the iPhone

**Page:** https://playnomansland.github.io/tools/tri-budget/stress.html (dev only: nothing in the game links to it, and it changes nothing in the game). Locally: serve the repo and open `/tools/tri-budget/stress.html`.

What it does: it plays the worst fight from step 2 (`worst-fight.json`) on the real 3D board, with the real towers and effects, in the Meadow look (the most scenery, 279k triangles). The first 4 fight-seconds play on a loop at the game's speed (1.5×), so the board stays near its peak (about 155 bodies on average, never under 106) and full of shots. Every unit model is swapped for a test body with a set number of triangles (three spheres, split 60/30/10 over the tint, fixed and team parts like a real model, so the draw calls stay the same). Towers and buildings keep their own models. **Run sweep** steps through total unit triangles (the game's own models, then 50k, 100k, 200k, 400k and 800k at 173 bodies). Each step warms up for 3 s and is measured for 10 s. The page then shows average fps, the 95th and 99th percentile frame times, the worst frame, frames over 20 ms, frame triangles, draw calls, scenery triangles and bodies. **Copy results** puts the table on the clipboard.

A step **holds 60** when it averages ≥ 57 fps with the 95th percentile frame at ≤ 20 ms. It **holds 30** at ≥ 29 fps with ≤ 40 ms.

URL options: `q=high|medium|low` (default High, the game's default), `view=0..3` (camera level, default Strategic), `look=meadow|autumn|snow|frost|desert|own` (default meadow), `levels=real,50,100,...` (in thousands), `secs=10`, `loop=4`.

PC check (Windows, Chrome, 390 × 844 at 3× DPR, High, so 2× pixels, the fight's own look): every step held 60. With the game's models the frame was 196k triangles. At 800k unit triangles (4,624 a body) the frame was 970k and still above 120 fps. A PC tells nothing about the phone, so this only shows the page works.

### iPhone results

Vilhelm's iPhone (428 × 926 screen, DPR 3, iOS 18.7 Safari), 2026-11-06. Settings: quality High (2× pixels, shadows on), strategic view, Meadow look, the worst fight looping (about 155 bodies on average, never under 106), 3 s warm-up and 10 s measured for each step. The sweep ran in two parts, 09:00 and 09:03.

| Level | Tris/body | Unit tris | fps | p95 ms | p99 ms | Worst ms | > 20 ms | Frame tris | Calls | Holds |
|---|---|---|---|---|---|---|---|---|---|---|
| game models | – | ~23k | 59.5 | 19 | 20 | 66 | 1% | 351k | 95 | 60 |
| 50k | 288 | 45k | 59.3 | 19 | 21 | 67 | 1% | 375k | 95 | 60 |
| 100k | 566 | 87k | 59.4 | 20 | 23 | 65 | 2% | 423k | 95 | 60 |
| 150k | 874 | 135k | 59.4 | 20 | 21 | 66 | 2% | 476k | 95 | 60 |
| 200k | 1,164 | 180k | 58.8 | 20 | 29 | 69 | 4% | 526k | 95 | 60 |
| 400k | 2,332 | 361k | 59.1 | 19 | 21 | 73 | 1% | 728k | 95 | 60 |
| 800k | 4,624 | **714k** | 59.1 | 19 | 21 | 77 | 2% | **1,125k** | 95 | 60 |

What it shows:

- **Every step held 60 fps**, up to 714k unit triangles (4,624 a body) and a 1.1 M-triangle frame. With shadows on, the GPU drew about twice that, so roughly 1.4 M unit triangles. The sweep didn't find where 60 breaks, and it didn't get anywhere near 30, so **T60 ≥ 714k** is a measured floor, not the exact limit.
- **Unit triangles are not what limits this phone.** Frame times barely moved from the game's own models to 30× more unit triangles: the 95th percentile frame stayed at 19–20 ms and 1–4% of frames went over 20 ms at every step, the game's own models included. Those occasional slow frames come from something else: pixels (2× resolution, MSAA, MeshStandardMaterial), scenery or frame pacing. `docs/PERFORMANCE.md` (T1–T3, T7) is where to look for them.
- Each step was 10 s on a cool phone. A whole match on a warm phone may throttle. The 30% headroom in the budget is there partly for that.
- 30 fps: not reached in this sweep (all ≥ 58.8 fps). A higher sweep (`?levels=1600,3200`) would find the limits, but the budget below doesn't need them.

## 5. Budget

T60 = 714k unit triangles (the highest total measured, which still held 60 fps).

- **Board total for unit models: 500,000 triangles** (0.7 × 714k). The 30% headroom covers effects, projectiles, scenery and the UI on top of what the sweep already had (the heaviest scenery and a full fight's effects), plus a warm phone, 2v2 and new effects. The **whole frame** at T60 was 1.1 M triangles in the main pass.
- **Absolute per-body ceiling: 2,890 triangles** (500k ÷ 173). Any model under this fits even if every body on the worst board wears it. For the Model Forge, this is the one number to check against when it doesn't know the squad size.
- **Per squad: 11,900 triangles** (500k ÷ 42, the most squads on one board). A squad's triangles per body = 11,900 ÷ its bodies, capped at 4,600 (the biggest body measured). This holds for any mix, as long as there are no more than 42 squads.

| Bodies in the squad | Max triangles a body | Examples today (tris/body now) |
|---|---|---|
| 1 | 4,600 | Brute 140, Obelisk 776, War Mammoth 464, the wizards 134–162 |
| 2 | 4,600 | Ent 228, Rogue 144, Wisps 88 |
| 3 | 3,900 | Shiv 160 |
| 4 | 2,900 | Ember Imps 88 |
| 6 | 1,950 | Spiders 296 |
| 8 | 1,450 | Skeleton Archers 220 |
| 10 | 1,150 | Slimeshots 112 |
| 12 | 990 | Goblin Swarm 136 |

**By tier**, from today's roster: tier 1 has the big swarms (Goblin Swarm 12, Skeleton Archers 8), so it takes the tightest per-body numbers (990–1,450). Tier 2 has Spiders and Slimeshots (1,150–1,950 a body), and its single-body units get 4,600. Tiers 3 and 4 are single bodies apart from the 2-body Rogue, so they get 4,600. Go by the squad's bodies, not its tier: a squad's bodies fix its share.

**Skins and leaders:** a skin replaces a unit's model for every squad of that unit, so it follows the same line as the unit's body count: up to 4,600 for a single-body unit's skin (Brute, Golem, Fire Mage), the swarm's number for a swarm skin (Gold Spiders: 1,950). Leaders have no 3D model today. If one gets one (one body a side), it can take 4,600 too. Nothing above 4,600 a body was measured, so going over that needs another stress run first.

**Spawned bodies** (Necromancer skeletons, goblins from Spawn) were in the measured fights. A unit that spawns many bodies should count them in its squad's bodies.

**Models over the budget: none.** The biggest body today is obelisk:eye at 904 triangles (a 1-body unit, allowed 4,600), and the biggest squad is Spiders at 1,776 (allowed 11,900). The Model Forge saves (Fire Mage 351, Leaf Wizard 327, Gold Spiders 280) are all well under. Today's game uses about 5% of the unit budget (26k of 500k on the worst board).

**For the Model Forge's Game check** (it lives in the claude.ai artifact): replace "warn above 1,400, try to stay under about 1,000" with:
- warn above **2,890** a body when the squad size isn't known;
- when it is known, warn above **min(4,600, 11,900 ÷ bodies)** (the table above);
- always warn above **4,600** (bigger than anything measured on the iPhone).

## 6. Notes for later (not built)

- **Shadows double the unit cost.** On High and Medium every unit is drawn again into the shadow map. If the iPhone turns out to be vertex-bound, a cheap shadow proxy (a simple blob or low-poly stand-in for the shadow pass) would almost double the unit budget. That isn't a small change in three.js, so ask first.
- **The ground plane is 24.6k triangles on every map**, there for terrain heights. Maps without terrain could use 2 triangles. That's a small change in `render3d.js` (`useHeights`), but it saves only about 12% of today's frame.
- Instancing is already in place (step 3), so there's no merging to do.
