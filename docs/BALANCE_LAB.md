# NML Balance Lab

The Balance Lab runs headless matches using the **actual NML source modules**. It does not implement a second combat simulator.

## Running it

From the repository root:

```bash
node tools/balance-lab.js --matches 10
node tools/balance-lab.js --matches 200 --seed 700000 --out reports/lab.json
```

- `--matches`: number of matches (default 10). `--seed`: the first match's seed, +1 per match (default 700000).
- `--max-rounds`: safety limit (default 30); matches that hit it count as unfinished.
- `--map`: map id (default `testgrid`, the map players get, shown as "Standard"); `random` picks one per match.
- `--no-mirror`: different package/leader/tower offers per side (default: mirrored, as in ranked).
- `--out`: write the full JSON report (every match, every round). Nothing is written without it.

Speed: about 3.5 s per match (200 matches: 11 min on one core).

## How a match is played: like a server match

Each match is a **refereed match** (`src/referee.js`, the code the game server runs), with the server's **ranked** settings (`server/src/room.js` RANKED: Standard map, 5 package offers, mirrored offers, no Blixten):
- Units and counter table: `src/demo-units.json` (the table the real AI drafts with, built by `tools/counter-table.js`), prepared by `server/src/prepare-units.cjs`, as on the server.
- Each side is the game's AI, playing on **what that side may see** (the referee's view: none of the opponent's new squads, buys or picks this round). `Game.aiDeploy(view, side, rec)` records every move that worked as an action, and the lab sends them to the referee one by one, as a phone does. At fight time the AI spends its level-ups (`Game.aiLevel`), as the page's AI and the server's tournament bots do.
- The referee checks every move against its whitelist and the rules, settles what nobody picked (packages, tower picks, walls), runs the fight and resolves the round.
- The report counts moves the referee accepted, **refused** (an AI move a player couldn't make) and **desyncs** (the AI's view and the referee's match differ after its moves). Both should be 0.

The recorder (`aiCall` in `src/game.js`) changes nothing in how the AI plays: 28 whole AI matches on all 7 maps ended byte-identical before and after it.

Reports from before 3 November 2026 are not valid: the lab drafted with battle results instead of scores (until 2 November), never levelled up, skipped the server's pre-fight settling, and played the developer-only Old standard map.

## What the report holds

Per match: seed, map, winner, rounds, health and gold left, leaders and towers, referee counts, and per round: gold at the start, at the fight and after, what each side bought (units, skills incl. Awaken, level-ups, unlocks, everything else by action), damage to each side, fight time, and every squad's level, survival and damage.

Summary (`summary` in the report, printed by the CLI):
- `wins` / `winRate` per side: **side bias**. With mirrored offers the sides should be even; check this before reading anything else.
- `referee`: accepted, refused (by action and reason), desyncs.
- `economy`: average gold at the round's start, left at the fight, spent per round, earned between rounds; level-ups; every other purchase by action.
- `leaders`, `towers`, `skills`: games, wins and win rate (completed matches), most played first.
- `unitStats` per unit: squads bought, rounds fielded, damage (total and per squad-round), average survival, matches fielded and win rate in those matches.

## Reading it

- These are the **AI's** results, not humans'. The AI's drafting, economy and placement shape everything. Use it to compare strategies the AI plays, and to see what a change does, not as human win rates.
- Win rates "when fielded" or "when bought" are **descriptive**, not causal: a unit the AI buys when it is already winning looks good.
- Look at `games` before any rate: below ~50 games a rate swings by 10+ points by chance.
- With mirrored offers (the default) both AIs almost always pick the **same leader** (197 of 200 matches), so leader win rates sit at 50% and say nothing: run `--no-mirror` for leaders. Tower types are picked at random among the offers, so tower win rates are the cleanest signal the lab has.
- The AI almost never buys the 500-gold units with a 150-gold unlock (Ether Golem, Necromancer, Truespear, Assassin, Sun Priest) or the Obelisk: the lab can't rate them until the AI drafts them.

## Engine fast paths (`opts.targetingMode === 'indexed'`)

Spatial grids that skip work the full scans do for nothing, and must give **bit-for-bit the same battles**:
- **Targeting** (`validTargets`): nearby enemies from an 8 m grid, in the original order, then the original filters.
- **Movement** (the nearest enemy each body walks to): grows its search 12 → 24 → 48 m, then falls back to the full scan.
- **Separation between allies**: the same pairs in the same order (i, then j > i), skipping only pairs too far apart to touch; the grid follows every push, and a body's list is gathered again once it has been pushed further than the slack.
- Units with `noTower` always take the full scan (`othersThan` caches its answer at its first call each tick).
- Anything that moves a body out of turn calls `invalidateTargetIndex()` (knockback, charges, teleporting towers, carrier releases, Wind Walk, Death Flurry), which also drops the movement grids.

On: the counter tables (`tools/counter-table.js` and the page's Counter Lab, `matrixGen`). Off (reference full scan): real matches, the server referee, the page's fights, the lab's matches; they gain nothing (small armies: 35 s either way for 7 lab matches). Measured on Goblin Swarm v Skeleton Archers (same machine, side by side): reference 77 s, indexed 26 s. Both shipped tables rebuilt with `--full` on the fast paths came out cell-for-cell identical (378 + 91 battles, 2 min 51 s on 2 cores).

Checks: `node tools/tests/fast-paths.js` hashes every body's position, health, heading and state on every tick in both modes, over real AI matches on all 7 maps, 2v2 fights on the wide field (up to ~200 bodies) and mechanic fixtures (`--matrix`: every counter-table pair too, slow). `tools/tests/targeting-determinism.js` compares the target-query traces.

Profiling: `node tools/profile-matchup-matrix.js --mode indexed` (CI: run the workflow by hand with *profile* ticked).

## Next milestones

1. **Balance dashboard:** a page over a report: filter by unit, skill, leader, tower, map and round, with sample sizes.
2. **Experiments:** run the same seeds with old and new values (paired seeds) and compare, before a change ships.
3. **Real armies:** replay players' matches from the server's history (seed + actions) instead of only AI-vs-AI.
4. **Skill agency:** tell availability, selection and activation apart from measurable combat impact (needs fight events, not just damage).
