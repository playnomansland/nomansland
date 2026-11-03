# Stat levers and the baseline unit (study, 3 November 2026)

Which stats move a unit's strength the most, how they couple, and what an "okay" unit looks like. Measured with the real engine (`src/engine.js`) at the counter table's settings; cross-checked with 200 Balance Lab matches. The slide deck "Stat Levers & the Baseline Unit" presents the same results.

## Method

- **Probe unit:** a plain 100-gold unit with no skills and no traits. Every stat is a dial.
- **Opponents:** each of the 28 roster units (innate skills applied, as `tools/counter-table.js` does) at 3,000 gold a side ("late"), the tier 1–2 units at 1,000 gold ("early"), and 24 seeded mixed armies of 3 roster units, 1,000 gold each ("mixed").
- **Score:** the engine's battle score (probe's health left minus the opponent's, −1..+1), averaged over the opponents.
- **Currency:** every change is converted into gold: the gold multiplier at which the plain baseline scores the same (its gold curve, phase B). "+26% gold" = as good as 26% more squads.
- **Balance Lab:** `node tools/balance-lab.js --matches 200 --seed 710000 --no-mirror`. 200/200 completed, 18,135 moves accepted, 0 refused, 0 desyncs, sides 101–99. Summary kept in `tools/stat-levers/out/lab-200-summary.json`.

## The baseline unit

Tier 1, 100 gold: 3 bodies, health 147 each, hit 19, 1.0 attacks/s, range 14 m, move speed 3 m/s, no splash, armor, ward, projectile or wind-up. Per 100 gold: 440 health, 57 DPS.

- The rounded card: late average −0.01, wins 15 of 28; early +0.03, wins 7 of 14; mixed armies wins 17 of 24. The study itself used the unrounded tuning (health 146.6, hit 19.06). The same numbers are fair early and late (power factor 1.47 vs 1.45).
- Picked from 15 shapes (1/3/8 bodies × 2/8/14/20/26 m), each tuned to average 0. Every shape's matchups spread about ±0.6: "okay" means average, not flat. The roster is rock-paper-scissors.
- It needs 1.47× the roster's median health and DPS per gold; that gap is what skills and traits are worth.

## Results (late game, gold equivalent of one step from the baseline)

| Change | Late | Early | Mixed |
|---|---|---|---|
| Level-up instead of 50% more squads | +52% | – | – |
| Ward 40 | +43% | +19% | +50% |
| Splash 0 → 3 m | +31% | +29% | +18% |
| Range +4 m | +26% | +18% | +30% |
| Move speed ×2 | +20% | +12% | +19% |
| Armor +6 | +20% | +16% | +19% |
| Health +30% | +16% | +9% | +20% |
| One body instead of three (same totals) | +15% | +7% | +9% |
| Hit +30% | +13% | +9% | +17% |
| Attack speed +30% | +11% | +10% | +15% |
| Projectile 30 m/s (not instant) | −10% | −7% | −10% |
| Wind-up 1 s | −16% | −17% | −20% |
| Range −4 m | −18% | −19% | −22% |

Main findings:

1. **Health × damage is one stat.** Gold ∝ HP^0.50 × DPS^0.54 (25-point grid, 3% mean error). Equal products are worth the same (0.98–1.03). Doubling both doubles worth: Lanchester's square law.
2. **Range is the strongest lever: ≈ 5.5% gold per metre** (4.6% one body, 6.7% eight bodies), no levelling off up to 26 m. A 2 m melee unit needs 2.0× the health × damage of a 14 m unit (8-body swarm 2.45×; early game 1.6×). Range also swallows health: 26 m with half health still scores +0.52.
3. **Balance Lab agrees:** survival after a fight melee 1% / short 3% / mid 15% / long 35%; damage per 100 gold per fight 53 / 293 / 554 / 628. Range correlates 0.83 with survival, 0.68 with log damage per gold (20 units).
4. **Speed only pays for walkers:** 1.5 → 8 m/s is +0.39..0.54 score at 2–14 m and +0.10 at 26 m. Melee at 8 m/s still −0.40.
5. **Armor and ward are counters.** Armor is a multiplier on health against a hit size (armor 6: ×6.7 vs hit 7, ×1.03 vs hit 210); ward the opposite. Armor 10 is worth ~+32% at 0.6× and 1.7× health alike: price it as a share of the unit.
6. **Splash is a cliff at 2.45 m** (0.7 × spacing 3.5, the minimum distance between allies): 0–2 m worth nothing, 3 m +31%, 4 m +60%. Roster check: Earth Wizard splash 2 → 0 changes +0.51 → +0.50, Steel Wizard +0.40 → +0.35, Ent −0.35 → −0.37; Ember Imps 3 → 2 drops +0.19 → −0.13; Fire Mage 4 → 2 drops −0.02 → −0.58.
7. **Taxes:** projectile 60/30/15 m/s = 0.93/0.90/0.88; wind-up 0.5/1/2 s = 0.89/0.84/0.73. 12 roster units fire projectiles.
8. **Fewer, bigger:** same totals over 1/2/3/6/12/24 bodies = 1.15/1.09/1.00/0.96/0.93/0.97. Same DPS at 0.25/0.5/1/2/4 attacks/s = 1.10/1.06/1.00/0.91/0.88. One body loses ground to multi-target units.
9. **Power vs identity levers** (correlation of a change's per-opponent shifts with a gold increase's): hit 0.86, attack speed 0.83, wind-up 0.81, splash 0.75, range 0.74, health 0.72 | bodies 0.48, armor 0.45, speed 0.45, projectile 0.43, ward 0.19. Fix prices with power levers; build counters with identity levers.
10. **Level-ups:** same gold as level 1 everywhere = +52%, level 2 = +70% (2× power for 1.5× price, plus fewer bigger bodies). The Balance Lab AI made 5,588 level-ups in 200 matches.

## Pricing recipe

Worth (gold) = 100 × √(HP/440 × DPS/57) × 1.055^(range − 14) × traits, with HP and DPS per 100 gold of price (all bodies). Traits: splash < 2.5 m ×1, 3 m ×1.3, 4 m ×1.6; one body ×1.15; double speed ×1.2 at 14 m (more for melee, ~×1 at 26 m); projectile 30 m/s ×0.9; wind-up 1 s ×0.84; armor ≈ ×1.03–1.04 per point; ward 40 ≈ ×1.4. First-order: good within ±4 m of 14 m and ±50% on health or damage.

Checked against the roster (phase E below), the recipe on base stats alone correlates 0.80 (log) with the measured worth and is within 25% for 12 of 27 units. Where it falls far short, the unit's traits and skills carry it: War Mammoth (recipe 0.45, measured 1.18), Flame Wizard (0.56 vs 1.11), Necromancer (0.69 vs 1.33), Rogue (0.40 vs 1.00), Ether Golem (0.55 vs 1.00).

## Roster: worth ÷ price

Phase E: for each roster unit, the factor p on its health and hit at which it averages 0 against the roster at 3,000 gold (innate skills only). Since health × hit scales like gold, worth ÷ price = 1/p, and price ÷ p is a fair price.

| Unit | Worth ÷ price | | Unit | Worth ÷ price |
|---|---|---|---|---|
| Slime Wizard | 2.37 | | Fire Mage | 1.00 |
| Meteor Caller | 1.94 | | Ether Golem | 1.00 |
| Earth Wizard | 1.81 | | Rogue | 1.00 |
| Steel Wizard | 1.47 | | Water Mage | 1.00 |
| Necromancer | 1.33 | | Frost Wizard | 0.98 |
| Sun Priest | 1.28 | | Shiv | 0.95 |
| Sniper | 1.25 | | Wisps | 0.91 |
| Ember Imps | 1.19 | | Truespear | 0.81 |
| War Mammoth | 1.18 | | Ent | 0.78 |
| Skeleton Archers | 1.17 | | Spiders | 0.68 |
| Goblin Swarm | 1.16 | | Obelisk | 0.66 |
| Slimeshots | 1.16 | | Leaf Wizard | 0.50 |
| Flame Wizard | 1.11 | | Assassin | 0.36 |
| Brute | 1.04 | | Just a horse | not measurable (a carrier) |

Single-unit fights at 3,000 gold favour splash and big late-game units more than early rounds do (see the counter table notes).

## Limits

- One unit type a side at counter-table settings; no towers, flanks or placement (mixed armies agree in direction and roughly in size).
- Most matchups are already ±1, so a lever's worth comes from the 5–10 matchups near the tipping point; the numbers move when the roster changes.
- The probe has no skills; roster units have their innate skills only (as the counter table).
- The Balance Lab is AI vs AI; melee's damage per gold misses its screening value.

## Running it

```
node tools/stat-levers/phaseA.js all     # shapes x ranges, power to break even (also: early)
node tools/stat-levers/mkbase.js         # out/baseline.json from phase A (3 bodies, 14 m)
node tools/stat-levers/phaseB.js all     # single levers + gold curve (also: early)
node tools/stat-levers/phaseC.js all     # coupled stats
node tools/stat-levers/phaseD.js         # mixed armies + roster splash check
node tools/stat-levers/phaseE.js         # roster fair power
node tools/stat-levers/analyze.js        # out/summary.json (all phases, gold equivalents, roster worth)
```

Every battle is cached in `tools/stat-levers/cache.json` (not committed), keyed by the engine's hash, the probe, the gold and the opponent; editing `src/engine.js` invalidates it. Each script uses every CPU core. On 2 cores the whole study takes about 2.5 hours.
