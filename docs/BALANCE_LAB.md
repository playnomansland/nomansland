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
- `--out`: optional path for the full JSON report. No report file is written unless requested.

Both sides use the current `Game.aiDeploy` implementation. Each match uses the normal match creation, deployment, battle setup, engine stepping and round resolution functions. The runner records the seed, winner/completion, rounds, remaining HP/gold, per-round damage, battle duration and squad-level damage/survival.

## Interpreting the first report

This first runner is a **baseline harness**, not yet a reliable unit/skill ranking:
- Side 0 and side 1 win rates are reported separately. Side bias must be measured before interpreting balance.
- The current AI is not a proxy for human decision-making. Its draft, economy and placement choices influence results.
- Squad appearances and damage are descriptive. They are not causal estimates of unit or skill value.
- Matches that hit the round limit are marked unfinished and excluded from the completed-match win-rate denominator.
- A small sample is useful for checking the harness, not drawing balance conclusions.

## Next milestones

1. **Validate the baseline:** run larger samples, check side symmetry and repeatability, and profile simulation speed.
2. **Improve result data:** capture roster, purchases, upgrades, skills, leaders, towers, economy transactions and battle-event attribution.
3. **Balance dashboard:** filter by unit, skill, leader, tower, matchup, map and round.
4. **Experiments:** compare baseline and modified values with paired seeds and controlled compositions.
5. **Skill agency:** distinguish availability/selection/activation from measurable combat impact. Agency will need decision/event instrumentation; raw damage alone cannot measure it.
