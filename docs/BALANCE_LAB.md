# NML Balance Lab

The Balance Lab runs headless matches using the **actual NML source modules**. It does not implement a second combat simulator.

## First milestone: simulation runner

From the repository root:

```bash
node tools/balance-lab.js --matches 10
```

Useful options:

```bash
node tools/balance-lab.js --matches 100 --seed 700000 --max-rounds 30 --out tools/balance-lab/results/baseline.json
```

- `--matches`: number of independent matches (default: 10).
- `--seed`: first deterministic match seed; each match increments it (default: 700000).
- `--max-rounds`: safety limit for matches that do not finish (default: 30).
- `--map`: map id (default: `standard`).
- `--mirror`: give both sides identical package/leader/tower offers and mirrored Zoe tiles, useful for controlled symmetry checks. Default: off, matching ordinary non-mirrored matches.
- `--out`: optional path for the full JSON report. No report file is written unless requested.

Units and counter table: `src/demo-units.json` (the table the real AI drafts with, built by `tools/counter-table.js`), prepared by `server/src/prepare-units.cjs`, the same code the game server uses. No battles run before the matches start. (Until 2 November 2026 the lab built its own table from `src/default-roster.json` with different settings, ~30 min, and handed the AI battle results instead of scores, so its drafts were wrong. Reports from before then are not valid.)

Both sides use the current `Game.aiDeploy` implementation. Each match uses the normal match creation, deployment, battle setup, engine stepping and round resolution functions. The runner records the seed, winner/completion, rounds, remaining HP/gold, per-round damage, battle duration and squad-level damage/survival.

## Interpreting the first report

This first runner is a **baseline harness**, not yet a reliable unit/skill ranking:
- Side 0 and side 1 win rates are reported separately. Side bias must be measured before interpreting balance.
- The current AI is not a proxy for human decision-making. Its draft, economy and placement choices influence results.
- Squad appearances and damage are descriptive. They are not causal estimates of unit or skill value.
- Matches that hit the round limit are marked unfinished and excluded from the completed-match win-rate denominator.
- A small sample is useful for checking the harness, not drawing balance conclusions.

## Engine fast paths (`opts.targetingMode === 'indexed'`)

Spatial grids that skip work the full scans do for nothing, and must give **bit-for-bit the same battles**:
- **Targeting** (`validTargets`): nearby enemies from an 8 m grid, in the original order, then the original filters.
- **Movement** (the nearest enemy each body walks to): grows its search 12 → 24 → 48 m, then falls back to the full scan.
- **Separation between allies**: the same pairs in the same order (i, then j > i), skipping only pairs too far apart to touch; the grid follows every push, and a body's list is gathered again once it has been pushed further than the slack.
- Units with `noTower` always take the full scan (`othersThan` caches its answer at its first call each tick).
- Anything that moves a body out of turn calls `invalidateTargetIndex()` (knockback, charges, teleporting towers, carrier releases, Wind Walk, Death Flurry), which also drops the movement grids.

Default is still the reference full scan everywhere (game, server, page). Measured on Goblin Swarm v Skeleton Archers (same machine, run side by side): reference 77 s, indexed 26 s.

Checks: `node tools/tests/fast-paths.js` hashes every body's position, health, heading and state on every tick in both modes, over real AI matches on all 7 maps plus mechanic fixtures (`--matrix`: every counter-table pair too, slow). `tools/tests/targeting-determinism.js` compares the target-query traces.

Profiling: `node tools/profile-matchup-matrix.js --mode indexed` (CI: run the workflow by hand with *profile* ticked).

## Next milestones

1. **Validate the baseline:** run larger samples, check side symmetry and repeatability, and profile simulation speed.
2. **Improve result data:** capture roster, purchases, upgrades, skills, leaders, towers, economy transactions and battle-event attribution.
3. **Balance dashboard:** filter by unit, skill, leader, tower, matchup, map and round.
4. **Experiments:** compare baseline and modified values with paired seeds and controlled compositions.
5. **Skill agency:** distinguish availability/selection/activation from measurable combat impact. Agency will need decision/event instrumentation; raw damage alone cannot measure it.
