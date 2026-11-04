# Handoff C: music player, chat input, Omni-Per Brute skin

Branch `polish-1105`. Read `docs/HANDOFFS-1105.md` first (shared rules). Test ports 8762-8764. Nothing here changes match play.

## 1. Music player everywhere outside battle

Vilhelm: always able to reach the music player and use all its functions when not in battle. Any song the player wants should be playable, even in battle, but the map's combo stays the default.

Now (src/site-template.html): the player (`playerHtml`, `wirePlayer`, `openPlaylist`, `wireSongList`, ~1196-1260) only lives on the start screen card and the playlist sheet. `syncMusic()` (~1146) picks the menu playlist outside a match and the look's combo (`LOOK_MUSIC` -> `MUSIC_COMBOS`) or the standard `PLAYLISTS` for deploy/battle. `menuPaused` is session-only.

Build:
- A music button reachable in every non-battle phase: lobby, draft/package pick, deploy, results, match over, tournament screens, the home menu. Suggestion: a note icon next to the settings cog (in a match) that opens the playlist sheet with the full player (play/pause, back, next, shuffle, repeat, song list). In battle the button can stay hidden (Vilhelm: "when not in battle").
- Picking a song in a match = "my music": that song (and the playlist it continues into, with the player's shuffle/repeat) plays through deploy AND battle, instead of the map combo, until the player taps "Map music" (a clear first row in the sheet, marked as the default) or the match ends. Every new match starts on the map combo again.
- Outside a match the player works as now (menu playlist, list order, `snd.shuffle`, `snd.repeat`).
- Music Off in Settings still silences everything; pressing Play turns it on (as the menu player does now: `setMusic(true)`).
- Keep the iPhone audio rules (`wakeAudio`, a tap is needed to start sound).

Tests: update or replace the stale `tools/tests/music-ui.js` (pre-UI2) with one that: opens the player in deploy, picks a song, checks it keeps playing into the battle, checks "Map music" goes back to the combo, and a new match starts on the combo. Port 8762.

## 2. Chat input

Vilhelm: typing in chat should switch off other inputs like rotating the map; the chat button always in the top left corner on PC.

- Keys: `src/camera3d.js` ~280 listens to keydown on window (Q/E rotate, Escape); the page has other key handlers (site-template ~7034 Escape, ~6555 Enter/Space on `.up` rows, any hotkeys). Add one guard used by all of them: ignore the key when the event target is an `input`, `textarea`, `select` or contenteditable (and stop the 3D camera's held keys when focus moves into one, so a held Q doesn't keep turning). Applies to the chat line in the talk wheel, the friends' DM box, the bug report, the username box, the code box.
- Button: the talk button is `#talk-btn` in the deploy tray and `#talk-fab` on the board otherwise (site-template ~8126). On PC (`pcLayout`), show one talk button fixed in the top left corner of the screen in every phase of a server match (deploy, battle, results), with the unread dot, and don't show the tray copy. Phones stay as they are. Make sure it doesn't cover the HUD names/health or the 2v2 ping buttons; move those if needed.

Tests: extend `tools/tests/chat-ui.js` (or a new chat-pc-ui.js on 8763): typing "qe" in the chat line doesn't rotate the 3D camera (`PB_BOARD=3d`), and on a PC-sized viewport the talk button's box is in the top left in deploy and battle.

## 3. Omni-Per Brute skin

Vilhelm left the look and who gets it to Claude. Decision:
- Look: a chrome war-machine Brute. Polished silver plating over the whole body, a helmet with a single glowing teal visor slit, a big hydraulic power fist on the right arm (pistons on the forearm), a glowing teal core in the chest, two small exhaust stacks on the back, team-colour stripes on the shoulder plates. Same silhouette size as the Brute so it reads as a Brute.
- Name "Omni-Per Brute", id `brute-omniper`, text "A chrome war machine with a power fist." 3D only, like Champion Brute (the 2D board keeps the plain square).
- Who gets it: nobody yet. Developers own it (as with every skin, off until worn); no `SKIN_GRANTS` line. Vilhelm decides later how it's earned.

Steps (docs/SERVER.md "Unit skins", `claude/skins.md`): model `brute:omniper` in `src/models3d.js` BUILD; picture `img/skins/brute-omniper.png` rendered from the model with headless Chromium + vendor three (same way as the other two); entry in `Shapes.SKINS` (src/shapes.js); id in `server/src/accounts.js` SKINS. A developer can wear one Brute skin at a time: check how two skins for the same unit behave (Profile toggles, `Shapes.skinOf`) and make wearing one take the other off.

Tests: `server/test/skins.test.js` (developers own all three skins, a normal account owns none of the new one), `tools/tests/skins-ui.js` (wear Omni-Per, the Brute model swaps; wearing Champion takes Omni-Per off).

PATCH-NOTES entry: "Music anywhere", "Chat typing fix", "New skin: Omni-Per Brute".
