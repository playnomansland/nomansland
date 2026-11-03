# Roadmap: PC focus (from 2026-11-03)

The coming sessions focus on the PC version. These are in the pipeline, in no fixed order. Nothing here is built yet; each item gets its own plan doc in `docs/` when work starts.

## 1. Skill rework: larger skill trees

Today: each unit has a few skill slots (2 normal plus a master/Awaken slot on some units), bought once per match for gold, with `skillOr` / `skillNeedsAny` for simple requirements.

Goal: a real tree per unit, with branches and milestones, so a unit can be built in clearly different directions during a match.

Open questions:
- Paid with gold as now, with a separate currency (XP, skill points per round), or both?
- How many nodes per unit, and how many can one match realistically fill?
- Does the tree belong to the unit type (as skills do now) or to each squad?
- How the opponent sees picks (hidden until the fight, as now?).

## 2. Factions as specs inside the skill trees

Today: factions live in the Factions devtest (`src/factions.json`: lesser buildings, Powers, faction units, Mechites' Factory and Altar).

Goal: factions become branches you "spec" into through the skill trees, instead of a separate draft. A unit's tree could fork into faction paths, and speccing deep into one faction unlocks its traits.

Open questions:
- Spec per unit, or one faction choice per player that colours all trees?
- Can a player mix factions across units?
- What happens to faction-only units, buildings and Powers from the devtest?

## 3. New 3D models for tree milestones

Goal: reaching a milestone changes how the unit looks. Example: the Ent becomes a different kind of tree depending on its spec.

Notes: the 3D board draws units from `models3d` (kindOf per shape). Milestone looks need a model variant per spec, chosen per squad at fight time and in deploy. Asset sources so far: KayKit, Quaternius, Kenney packs (D:\3DASSETS on Vilhelm's PC) and Blender.

## 4. More lore

Goal: a world, factions and units with a story. Unit and leader texts, faction backstories, encyclopedia entries, and spec names that fit the lore.

Notes: the encyclopedia (start screen) is the obvious home. Older theme idea: 1920s New York occult.

## 5. More balancing

Tools: Balance Lab (`tools/balance-lab.js`, `docs/BALANCE_LAB.md`), counter table, fairness tests. Known gaps: the AI never drafts tier-5 units, leaders need `--no-mirror` runs, side bias needs more matches. Skill trees will need the AI to pick tree paths before the lab can rate them.

## 6. Damage types: physical and magic (idea)

Idea: split damage into physical and magic. Armor would reduce physical; a new resist (or the existing ward) would handle magic.

Open questions:
- Does every unit deal one type, or can skills/specs change it?
- How it fits with existing rules: armor floor 15%, ward caps, poison ignoring both.
- Worth it? It adds a counter layer (good for the game's core), but also a lot to read on a card. Prototype in the counter table first.
