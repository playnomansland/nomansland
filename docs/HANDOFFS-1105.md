# Work split, 5 November 2026

Vilhelm's list from 5 November, split into groups that separate Claude Code sessions can build side by side. The match-play freeze before the Sunday tournament is cancelled, so everything can start today and push to main when its tests pass.

| Group | Handoff | Who | Starts |
|---|---|---|---|
| A – Quick balance (Mammoth, Spiders) | this file, below | Claude in the Phone Bellum Project | now |
| B – Sniper tower paratroopers, "You are marked" box | `docs/HANDOFF-SNIPER-PARA.md` | Claude Code | now |
| C – Music player, chat input, Omni-Per Brute skin | `docs/HANDOFF-POLISH.md` | Claude Code | now |
| D – 2v2 view: sheets, owners, rings, team stats, pings, tower/treasury spots | `docs/HANDOFF-DUO-VIEW.md` | Claude Code | now |
| E1 – 2v2 gameplay: portal, Mechites | `docs/HANDOFF-DUO-PLAY.md` | Claude Code | now |
| E2 – 2v2: units into an ally's horse | `docs/HANDOFF-DUO-HORSE.md` | Claude Code | after D is on main |
| G – Free-for-all "Fia med knuff" | `docs/HANDOFF-FFA.md` | Claude Code (design first) | design done (`docs/FFA.md`); build waits for Vilhelm's answers |

## Rules for every group

- Work on your own branch (name in your handoff). Before pushing: `git fetch origin main`, rebase onto it, run your tests, then push to main. Pushing to main deploys the server (`.github/workflows/server-deploy.yml`), so a group that touches `server/`, `src/engine.js`, `src/game.js`, `src/referee.js`, `src/duo.js` or `src/*.json` also runs `cd server && npm test`.
- Unit changes: `node tools/counter-table.js`, then `node src/build.js`. `node tools/tests/fairness.js` must still pass after any engine change.
- Add one entry to `PATCH-NOTES.md` (newest first, written for players; technical detail goes in README/docs). Don't tidy other groups' entries; the last group to merge tidies the file.
- Use the dedicated test ports already listed in your handoff. Taken ports so far: 8766 (http.server), 9000 (peer server), 8777-8798. New tests pick from 8760-8776 (each group has its own block below).
- Sandbox: kill leftover servers with `pkill -f "[w]orkerd"` and `pkill -f "[w]rangler-dist"`; Chromium is `/opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (symlink chromium-1194 / chrome-linux for older tests).
- Players see "username", never "gamertag".
- When a decision isn't covered, take the simplest reading, write it down in your PATCH-NOTES entry under "To check with Vilhelm", and keep going.

| Group | Test ports |
|---|---|
| B | 8760-8761 |
| C | 8762-8764 |
| D | 8765, 8767-8768 |
| E1 | 8769-8771 |
| E2 | 8772-8773 |
| G | 8774-8776 |

## Who touches what (to keep merges small)

- `src/site-template.html`: everyone. Keep edits inside the functions named in your handoff and don't reformat other code.
- `src/engine.js`: B (drop delay, landing hit), E1 (portal), A (stealth hit param). Small, separate places.
- `src/duo.js`, `server/src/duo.js`: D and E1. D owns the view/sync side (`view`, `m.team`), E1 owns the fight side (`fight`, `laneResult`). E2 waits for D.
- `src/game.js`: B (AIRSHIP block, tower text), D (2v2 map spots), E1 (2v2 unit set), E2 (carriers).
- `server/src/accounts.js`: C only (skin id).

## Group A (done in the Project chat)

- War Mammoth hp +200 (2450 -> 2650).
- Cavestalkers (Spiders' stealth skill): also +25% hit. The stealth skill type gets an optional `hit` param (default 0); Cavestalkers sets it to 25.
