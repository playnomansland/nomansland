# Models

Source models for the game. Nothing in here is built into the game by itself.

## Model Forge saves

The Model Forge artifact saves low-poly models here with **Save to repo**, one file per model, in a folder for what it is for:

| Folder | What goes in it | Model key in the file |
|---|---|---|
| `base/` | A unit's own model (what everyone sees) | `wizard:leaf`, `brute` |
| `skins/` | A skin for a unit (looks only) | `brute:champion` |
| `upgrades/` | How a unit looks after a skill or upgrade (Awaken, a master skill) | `sniper:hunter` |
| `buildings/` | Buildings and lesser buildings | `building:factory` |
| `towers/` | Tower models | `tower:keep` |
| `props/` | Weapons, staffs, banners, projectiles, scenery bits | `prop:banner` |

Each `*.model.js` file is a fragment, not a module:

- a header comment with the type, the unit, the Forge model and variant it came from, and the date;
- the BUILD entry in the format of `src/models3d.js` (`'key': () => [P(...), ...]`), ready to paste into `BUILD`;
- a `FORGE_SPEC` comment with the part list as JSON, so the model can be opened in the Forge again.

To put one in the game: copy its BUILD entry into `src/models3d.js` (and for a skin, add it to `Shapes.SKINS` and the server's skin ids, like the Champion Brute), rebuild, test.

## Other files

`leaf_wizard.blend`, `leaf_wizard.glb`, `leaf_wizard_sheet.png` and `scenery.bin` are earlier assets made outside the Forge.
