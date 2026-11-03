# Families and classes: what the economy needs

Status: **analysis, nothing decided.** Companion to `docs/CLASSES.md` (the classes draft). Written 3 November 2026.

The question: if level-ups go away and classes (unlocked by XP) take their place, what has to change in income, prices and sinks so the game still has a sensible gold curve and power curve?

Short answer: level-ups are doing two jobs today. They soak up about a fifth of all gold, and they double the army's strength over a match. Classes have to take over **both** jobs. The cleanest way is to make **converting a squad to a class cost gold, about what a level-up costs now**. Fully free conversion breaks prices and needs a much flatter income to compensate.

---

## 1. Where gold goes today (measured)

Balance Lab, 80 matches, seeds 720000-720079, ranked settings, `--no-mirror`, 8.9 rounds a match on average. AI vs AI, so this is how the AI spends, not humans; still the clearest picture we have.

Gold spent per side, per round (rounded):

| Round | Gold at start | Units | Skills | Unlocks | Level-ups | Squads on board | Avg level |
|---|---|---|---|---|---|---|---|
| 1 | 250 | 169 | 21 | 41 | 6 | 3.6 | 0.03 |
| 3 | 430 | 178 | 100 | 28 | 44 | 6.4 | 0.19 |
| 5 | 680 | 188 | 167 | 30 | 141 | 9.1 | 0.56 |
| 7 | 895 | 310 | 215 | 44 | 216 | 12.1 | 0.87 |
| 9 | 1103 | 378 | 278 | 41 | 281 | 15.4 | 1.06 |
| 11 | 1274 | 538 | 251 | 41 | 335 | 18.6 | 1.18 |

Over the whole match: **units 39%, skills 24%, level-ups 21%, unlocks 6%**, the rest towers, extra deployments, moves and the like.

Things that stand out:

- **Squads are capped by deployments, not gold.** The AI places about 1.5 squads a round (the cap is 2, or 3 with the extra). From round 5 on, most of the gold has nowhere to go but skills and levels.
- **Level-ups are the late-game sink.** From round 6 on they take about 30% of each round's gold (180-330 a round).
- **Levels double the army.** A level gives +100% health and hit, which is about 2x a squad's worth (`docs/STAT-LEVERS.md`: worth follows √(health × damage)). Weighting each squad by price × (1 + level):

| Round | Board value (prices) | Strength from levels |
|---|---|---|
| 3 | 821 | ×1.16 |
| 5 | 1221 | ×1.50 |
| 7 | 1790 | ×1.80 |
| 9 | 2483 | ×2.01 |

  So by round 9 half the army's strength comes from levels, not from squads.
- **Level-ups are the most gold-efficient buy.** Stat levers study: a level is worth +52% (level 1) and +70% (level 2) more than spending the same gold on new squads. That is the "investy" part of the current game.
- **Tier 4 barely shows up:** about one tier-4 squad per side by round 9. Squads are mostly tier 1 (9.7) and tier 2 (3.9).

---

## 2. What the classes draft changes, economically

| Draft rule | Economic effect |
|---|---|
| Level-ups removed | Lose ~21% of the gold sink and the ×2 power growth. |
| Classes unlocked by XP | A time gate instead of a gold gate. The first class arrives around round 2, much earlier than levels pay off today (×1.16 at round 3). |
| Free conversion of Level 1 squads | Power with no gold attached. Also makes class prices meaningless (see 3). |
| Shop sells families | Fewer unlocks (13 families vs 28 units); each unlock opens more. |
| Skills move onto classes | The skill trees' branch choice (slot 2 or 3) partly becomes the class choice, so fewer skill buys per family: the 24% skill sink may shrink too. |

If nothing else changes, the late game has roughly **300-500 gold a round with no home** (the level-up share plus some of the skills). With the 500 carry cap, that gold is just lost. Players would hit the cap every round from about round 6, which is the opposite of interesting decisions.

---

## 3. The core problem with free conversion

If a Level 1 Mage can be converted to Anger for free, nobody ever buys an Anger squad at a higher price: they buy a Mage and convert it. So:

- **Every class effectively costs the Level 1 price.** A class that is stronger than its Level 1 is then simply better per gold, and the Level 1 only exists as a coupon.
- **Power grows with no gold.** The board strength curve has to come from somewhere: today it is paid for with ~21% of all gold. Free conversion gives it away, so income has to be cut by about that much to keep the game the same length.
- **Hidden spike.** Converting six squads at once in one deploy is a large hidden swing with no cost signal. (Paid conversion still hides it, but it competes with buying new squads, so it is a real trade-off.)

---

## 4. Recommended direction: paid conversion ("class fee")

Treat **converting a squad to a class exactly like today's level-up**: it costs gold, needs XP (the family's, not the squad's), and makes that squad stronger. A subclass is a second step, like level 2.

| Family tier | Level 1 price | Class price (buy new) | Convert L1 → class | Class → subclass | Family unlock |
|---|---|---|---|---|---|
| 1 | 100 | 150 | 50 | 50 | 50 |
| 2 | 200 | 300 | 100 | 100 | 75 |
| 3 | 300 | 450 | 150 | 150 | 100 |
| 4 | 500 | 750 | 250 | 250 | 150 |

Rules that go with it:

- **Class price = Level 1 price + convert fee**, always. Buying a class squad directly and buying Level 1 then converting cost the same; converting is just the "invest early, upgrade later" route.
- **Strength target per step:** class about **1.6-1.7x** a Level 1's worth, subclass about **2.3-2.5x**, for 1.5x and 2x the price. That keeps investing rewarding (about 10-15% better per gold than new squads) but less than today's levels (+52% / +70%), which helps the snowball problem (Fire Mages, Sniper walls).
  - "Worth" here is the stat-levers measure: e.g. +30% health and +100% damage, or +60% of both, both give about 1.6x; plus whatever the class's own trait is worth.
- **The fee is the same as today's level-up** (half the Level 1 price per step), so income and sink stay close to what the game is tuned for. Two steps (class, subclass) replace levels 1-2; level 3 is rare today (it only shows up in long matches).
- **Selling** refunds half of everything paid into the squad (price + fees), rounded down to 5.
- **Conversion uses a deployment? No.** Levels don't today; keep it that way so gold, not the deploy cap, is the throttle.

What this keeps:

- Income (250, +100 a round), carry cap 500, loans, shutdown, loser bonus: **unchanged** for the first test.
- Board strength curve: same shape as today if the class/subclass values hit their targets.
- Gold at the fight stays near 0 (the AI spends all of it today; humans will have the same outlets as now).

What it changes in feel: conversion becomes a real choice each round ("convert two Mages to Anger, or buy another Brute?"), and the hidden information (what did they convert?) is backed by a gold trade-off.

---

## 5. If you want conversion to stay free

Possible, but the economy has to shrink to match. Suggested set:

- **Income growth +60 a round instead of +100** (round 9: 670 instead of 950). This removes roughly the gold levels absorb today.
- **Conversions count against the deployment cap** (a conversion uses one deployment), so you can't convert six squads in one round. This turns the deploy cap into the throttle on power growth.
- **Class squads bought new cost the Level 1 price** (no premium; with free conversion a premium can't work).
- **Class strength target lower** (about 1.3-1.4x Level 1), since it costs nothing.
- **Keep or raise skill prices** so skills stay a real sink.

Risks: players sit near the carry cap more often; power growth is set by deploy slots, so a player who fell behind can't spend their way back (gold buys squads only). The paid version is easier to balance and closer to what's tested.

A middle ground: **first conversion of each family free, the rest paid.** Rewards opening a family without breaking prices.

---

## 6. Other numbers that move

- **XP: fixed per fight, per family.** Damage-based XP pays the winner more (winners deal more damage), which would snowball class unlocks. A fixed amount per fight the family took part in (plus a small damage bonus at most) keeps the loser on schedule. Suggested first thresholds: tier 1-2 classes after 1 fight, subclasses after 3; tier 3-4 classes after 2 fights.
- **Unlock costs:** today 6% of spending. A family unlock opens 3-4 classes, so it's worth more than a unit unlock; raise tiers 2+ a little (table in 4). Classes themselves have no gold unlock, only XP.
- **Tier 4 families:** if the big units become classes of lower families (Necromancer under Skeletons), the 500 + 150 hurdle mostly goes away, which also fixes the AI never drafting them.
- **Skills:** check after porting the first family how many skill buys a class has left. If it drops from ~2-3 per unit to ~1, the class fee alone won't replace the lost sink: raise class fees or skill prices.
- **Carry cap 500:** keep. Track `capLost` in the lab: if the class economy works, it stays near 0.
- **Things that lean on levels today** need a decision: Noah (starts squads levelled), Yot (Ember Imps level up by themselves), Level all, the XP bounty for killing levelled bodies, the AI's `aiLevel`, DEVTESTLATEGAME. Natural mapping: "level" → "class step" (Noah's squads start as their class, Yot's Imps convert for free in round 3 and subclass in round 6).

---

## 7. How to test it

1. Build the conversion action and `aiConvert` (the AI picks a class by the counter table and converts at fight time, the way `aiLevel` works now) before any tuning; without it the lab can't measure anything.
2. Port one family (Mages) with paid conversion; levels stay on for the other families.
3. Balance Lab, paired seeds, old vs new, 200+ matches. Targets:
   - match length about 9 rounds (today 8.9);
   - strength from classes ×1.5 by round 5 and ×2 by round 9 (same curve as levels);
   - gold left at the fight < 50, `capLost` near 0;
   - win rate when Mages are fielded close to the old Fire/Water/Earth/Steel mages.
4. Then the free-conversion variant (section 5) on the same seeds, to compare.

---

## 8. Decisions for Vilhelm

1. Paid conversion (recommended), free conversion with a smaller economy, or "first conversion per family free"?
2. Two steps (class, subclass) to replace levels 1-2, or keep a small level for Level 1 units?
3. XP fixed per fight per family (recommended) or damage-based?
4. Should the class premium be the same 50% for every family, or set per class?
