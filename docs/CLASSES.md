# Families and classes: draft plan

Status: **draft, nothing decided.** This collects Vilhelm's idea for the unit and skill rework (3 November 2026) and the discussion around it. Everything below is a direction to try, not a rule. Numbers are placeholders. Each section ends with what is still open.

---

## 1. The idea in short

- Units are grouped into **families** (Mages, Goblins, Gunmen ...). The shop sells families, unlocked by tier as units are today.
- Buying from a family shows a choice: the family's **Level 1** unit (e.g. "Mage") or one of its **classes** (e.g. Anger, Serenity, Instinct), shown as animated 3D models.
- Each class has its own skills and progression. Some classes branch further into **subclasses** (Anger → Fury or Wrath).
- **Level-ups as they work today might go away.** XP would instead unlock classes.
- When a class unlocks, already deployed Level 1 squads of that family could be **converted to it for free**.

Direction: a more "investy" game (planning ahead pays) while trying to keep counter-play alive.

---

## 2. Families (first draft)

Indented names are possible subclasses. The list is a sketch; families, names and placement can all change.

### Tier 1

| Family | Classes (subclasses) |
|---|---|
| Skeletons | Skeletons, Archers, Knights, Lord (Necromancer) |
| Goblins | Goblins, Ember Imps (Fiends), Goblin Warriors (Orcs), Goblin Cultists |
| Wisps | Wisps, Ents, Spirits, Ghosts (Spectres, Ghouls, Zombies) |
| Gunmen | Gunman, Sniper (Deadshot), Rifleman, Cannoneer |
| Mages | Mage, Serenity – water/healing, Anger – fire (Fury – burn, Wrath – lava), Instinct – earth (Resilience – steel, Courage – rock) |

### Tier 2

| Family | Classes (subclasses) |
|---|---|
| Wizards | Wizard, Meteorcaller, Timekeeper, Frostfinder |
| Brutes | Brute, Boss – summons minions, Chainman – tank, Boxer – damage |
| Beasts | Beast, Spider (Replicate, Shadowweb), Snake (Obelisk, Venomous), Wolf (Lone, Pack) |
| Constructs | Construct, Just a Horse, X100, Rollers |

### Tier 3

| Family | Classes (subclasses) |
|---|---|
| Rogues | Rogue, Assassin, Shadow, Toxer |
| Elementals | Elemental, Ethergolem, Watcher |

### Tiers 4–5

Not sketched yet. Some current big units (War Mammoth, Sun Priest ...) could become families of their own, or subclasses of lower families.

### Thoughts so far

- Many existing units fit straight in (Sniper, Ember Imps, Ent, Necromancer, Just a Horse, Rollers, Obelisk, Ether Golem, Meteor Caller, Assassin, Spiders, the Fire/Water/Earth/Steel mages), so a lot of engine work may carry over.
- Some themes overlap: Ghosts, Ghouls and Zombies under Wisps feel undead, like Skeletons. Ents under Wisps is a stretch. One option: Wisps becomes nature spirits (Wisps, Ents, Spirits) and the undead move to Skeletons.
- Gunmen and Constructs could be where the Mechites faction ends up.
- Open: final family list, tiers 4–5, and how many classes per family (3? 4?).

---

## 3. Level 1 units

- The first entry of each family ("Mage" in Mages) is a plain unit you can always buy.
- Idea: cheap and simple, good for round 1, new players and the tutorial.
- Some families could have a Level 1 that stays useful all game (a Goblin swarm as chaff, for example).
- Open: does Level 1 have any skills, or none? Is it always cheaper than the classes?

---

## 4. XP and unlocking classes

Current thinking:

- Classes always need some XP before they can be bought. The amount can differ per class.
- For lower tiers, most classes might unlock after about 1 round of fighting.
- Consequence: round 1 is probably a Level 1 round for everyone, with classes opening from round 2.
- Consequence: a family you have never fielded can't go class right away. You field Level 1 first, then unlock. That delay is the "investy" cost.

Suggestions that came up (not decided):

- **XP pooled per family**, one bar per family ("Mages: 340 / 500"), rather than per squad.
- **XP mostly fixed per fight** the family takes part in, plus a smaller damage bonus. Today's XP (damage dealt + taken) is uneven: a squad that never reaches the enemy gets almost nothing, which would make "unlocked after 1 round" unreliable.
- **Count XP per fight for the family, not per squad**, so three Mage squads don't unlock three times faster than one. Or maybe more squads should unlock faster, as a reward for commitment. Open.
- **The player picks which class unlocks** when the bar reaches its threshold, so the XP path still reacts to the opponent.
- Per-class thresholds work as a balance lever alongside price.
- Possible softener if the delay feels too slow: unlocking a family gives it a little starting XP.

Open:
- Exact thresholds per tier and class.
- Do subclasses use the same bar (a higher threshold) or something else (gold, a skill, a milestone)?
- Is there a way to buy a class you haven't unlocked (at a premium), or is XP always required? Current leaning: XP always required.

---

## 5. Free conversion

- When a class unlocks, deployed Level 1 squads of that family can switch to it for free.
- Suggestions: one-way (an Anger squad stays Anger) to avoid free respecs every round; hidden from the opponent until the fight, like other changes made this round.
- Risk: converting many squads at once is a big hidden swing. A possible lever if it's too strong: conversions count as a deployment, or a limit per round.
- Open: one-way or not, any limit per round, does conversion keep the squad's position and items?

---

## 6. Removing level-ups

Today level-ups are a major part of power and one of the biggest gold sinks (Balance Lab: over 6,000 gold in 200 matches). If they go:

- Power comes from class instead of level, which is simpler to read.
- Gold needs somewhere else to go: class prices, class skills, more squads. Income, carry cap and prices will likely need a pass.
- Open: remove fully, or keep a small version (e.g. a level cap of 2)? Some Level 1 units might keep levels as their thing.

---

## 7. Reactivity

The main risk of the design: counter-play is the core of the game, and XP gating makes it slower to answer what the opponent just did.

Things that help:
- Picking the class at unlock time (reactive choice).
- Several classes per family unlocking after just one round.
- Level 1 units that fill a role on their own.
- A strong reason to field several families early, so you have options open later.

Open: is one round of delay fine, or does it need a softener? Playtests will tell.

---

## 8. Balance and readability concerns

- **Price:** if every class in a family costs the same, they must be worth the same, which is hard (Cannoneer vs Gunman). Alternatives: per-class prices, or small class surcharges.
- **Readability:** classes in a family need clearly different silhouettes, not just colours, so the opponent can tell them apart.
- **Assets:** roughly 13 families × 3–4 classes plus subclasses is about 60–70 looks. Start with variants of one model per family (props, size, colour, swapped parts), replace with real models over time.
- **AI and Balance Lab:** the AI needs to pick classes (and conversions) before the lab can rate anything. This should be part of the first build. Simplest first version: pick the class that counters the enemy best by the counter table.

---

## 9. How factions might fit

Not decided. Options:
- Factions become subclasses (a class branches into faction paths).
- Factions stay a separate layer (the current devtest), with families belonging to factions.
- Mixed: some families are faction-bound (Gunmen and Constructs for the Mechites).

---

## 10. Possible build order

1. Data format: family (tier, price, unlock) → classes (stats, model, skills, XP threshold, subclasses) → subclasses.
2. Buy flow: buy family → pick Level 1 or an unlocked class (card with model) → deploy. Hidden info as now.
3. Family XP bar and class unlock pick.
4. Free conversion of deployed Level 1 squads.
5. AI: class pick and conversions.
6. Port one family as the test case. Suggested: Mages (deepest tree, maps onto existing Fire/Water/Earth/Steel units).
7. Balance Lab runs, then a second, very different family (Goblins or Gunmen).
8. Then decide on level-ups, prices and the rest of the roster.

Probably best built as a separate mode or devtest first (like the Factions devtest), so the current game keeps working while this is tried.

---

## 11. Open questions (summary)

1. Final family list and tiers 4–5.
2. Classes per family: fixed set, or a random 3 offered each time?
3. Is the class pick per purchase (every squad) or once per family per match?
4. XP: per family or per squad, fixed per fight or damage-based, thresholds.
5. Subclasses: same XP bar or another route?
6. Conversion: one-way? Limits?
7. Level-ups: remove fully or keep a little?
8. Pricing: one price per family or per class?
9. Factions: subclasses, separate layer, or mixed?
10. Build as a devtest first, or straight into the main game?
