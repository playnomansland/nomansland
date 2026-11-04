# Handoff: build the online lobby, chat and emotes

For the Claude Code session building this (written 2026-11-04). The design is `docs/LOBBY.md`; read it first, then `docs/SERVER.md` (Room, DuoRoom, TourRoom, accounts, limits). Where this file and LOBBY.md differ, LOBBY.md wins. Friends (`docs/FRIENDS.md`) is built at the same time by another agent: see "Working next to the friends agent" below. Players see the word **username**, never "gamertag".

## Timing and branches
- Tournament on **Sunday 2026-11-08**. Nothing that changes how online matches start or run may reach the server or the site before **Monday 2026-11-09** (server deploy runs on every push to main that touches `server/`, `src/engine.js`, `src/game.js`, `src/referee.js`, `src/tournament.js` or `src/*.json`).
- So: work on branch **`lobby`**, push the branch as you go, and merge to main from Monday on (Vilhelm's rule is otherwise "push everything to main").
- Read `README.md`, `PATCH-NOTES.md` (top) and the newest commits on main first: other chats push to main while you work. Rebase the branch on main before merging.

## What to build (in this order; each step mergeable on its own)
1. **Lobby list**
   - `server/src/lobby.js`: `LobbyRoom` Durable Object, one instance `all`, route `/lobby` (WebSocket) and `GET /lobby` (snapshot). Add the binding and migration in `wrangler.toml`, the route in `index.js` (origin allowlist as for the other routes).
   - `Room` and `DuoRoom`: a `public` setting; public rooms report listings to the lobby by DO RPC (`upsert` / `drop`) on state changes plus a 60 s heartbeat; the lobby's alarm drops listings older than 3 min.
   - One list, **Rooms**: Standard and Ranked together, 2v2 only to developer sockets (dev from the server's own `players.dev`, via `sessionPlayer`). Gate 2v2 with the `config` key `lobby_duo` (`'dev'` default, `'all'` later).
   - Ranked rooms in the list (test season): mode *Ranked* in Create room, account needed to create and to join (the room already checks sessions for ranked). Ranked-by-code keeps working.
   - **Sort** button: Name, Date/time (default, newest first), Category (Standard / Ranked), Mode (1v1 / 2v2); tapping the active one flips the order; saved in `pb-lobby-sort`.
   - Quick play (oldest open public Standard room, else create one), Join, Watch, join by code (as today).
   - Spectating on by default; host toggle `{ t: 'spectate', on }` in the waiting room and during the match; off closes watchers with `denied { why: 'no watchers' }`.
   - Limits (limits.js): one open room per player, create 10 / 10 min per IP, 3 lobby sockets per IP, 30 lobby messages / 10 s, at most 200 listings.
   - Page: `#lobby` screen under the home layer, opened from PLAY → Online.
2. **Chat and emotes** (Room, DuoRoom, and the page)
   - `chat { text }` / `emote { id }` in; `chat { from, tag, text, at }` / `emote { from, id }` out. Ids: `bababa`, `golem`, `shock`.
   - Text chat **signed-in players only** (session from hello); guests read chat, send emotes, and see "Sign in to chat".
   - Server: 120 characters, control characters stripped, short word filter (`***`), 3 lines / 5 s and 20 / min, emotes 1 / 3 s; last 50 lines in memory, never in match history.
   - **Watchers chat in their own room** while the match runs; players never see it. **When the match ends** (result or forfeit) the chats merge: send players `chatMerge { lines }` (that match's watcher lines, by time), then every line goes to everyone. A rematch starting splits them again.
   - 2v2: Team / All switch (Team = the existing team-only relay).
   - Page: emote button in the tray row → wheel with the 3 emotes and a chat line; chat sheet; emote sticker by the sender's nameplate and over their tower (~1.5 s, CSS pop / shake / fade). Opponent's nameplate → Mute emotes, Mute chat (separately, saved per match code), Report (last 20 lines + usernames + match id through the bug-report webhook path, own channel and limit). Settings: Chat on/off, Emotes on/off.
   - **Emote art:** three hand-drawn SVGs in `img/emotes/` (bababa, golem, shock), **cartoonish 2D** (thick dark outlines, flat colours, one shade, big exaggerated faces), based on the units' 3D models in `src/models3d.js` so they're recognisable: Flame Wizard shouting "BABABABA!" in a comic speech burst, a happy Ether Golem with a closed-eye smile and sparkles, a shell-shocked Sniper with huge eyes, soot, smoke and ring lines. Render each model once for reference (as for `img/skins/`). **No sounds.**
   - PeerJS matches get no chat or emotes.
3. **Friends: not yours.** A separate agent builds friends, game invites and private messages (`docs/HANDOFF-FRIENDS.md`, branch `friends`). Coordinate through the shared pieces listed there: `server/src/text.js` (text clean-up, word filter, rate helper) and the report path. Whoever starts first creates `text.js`; the other reuses it.
4. **2v2 listings** (developer only) and Team / All chat in DuoRoom.
5. Not now: the ranked queue (LobbyRoom §5 in LOBBY.md), block list, lobby-wide chat.

## Working next to the friends agent
- It works on branch `friends` and owns: `server/src/hub.js` (PlayerHub), the friends tables and `/account/friend*` and `/account/dm*` endpoints in `accounts.js`, the Friends button and sheets on the page. Don't touch those.
- Shared: `server/src/text.js` (clean text, word filter, rate helper) for room chat and private messages. Whoever needs it first writes it on their branch; the other copies it unchanged and they converge at merge. Keep its API small: `cleanText(s, max)`, `filterWords(s)`, `rateOk(state, key, n, ms)`.
- Shared files you will both touch: `wrangler.toml` (Durable Object bindings and **migrations**: use the tag `lobby-1` for LobbyRoom; friends uses `hub-1`; whoever merges second puts its migration after the other's), `server/src/index.js` (routes), `server/src/limits.js`, `src/site-template.html`, `PATCH-NOTES.md`, `README.md`, `docs/SERVER.md`. Keep changes there in their own blocks so rebases stay easy.
- Merge order doesn't matter; whoever merges second rebases on main and reruns `cd server && npm test`.

## Tests
- `server/test/lobby.test.js` (listings appear and vanish, dev filter, ranked needs an account, heartbeat expiry, sort data present, limits); chat checks in `server/test/match.test.js` (signed-in only, limits, filter, watchers isolated during the match, merge at the end, split on rematch); `tools/tests/lobby-ui.js` and `tools/tests/chat-ui.js` (browser)
- Run `cd server && npm test` and the existing referee/tournament/duo tests before merging: the lobby must not change match play.
- Ports 8784-8798 are taken by other tests; use **8780-8781** (the friends agent has 8782-8783).
- Local notes (from earlier sessions): `wrangler dev` keeps Durable Object storage between runs (use fresh codes); kill leftovers with `pkill -f "[w]orkerd"` and `pkill -f "[w]rangler-dist"`; browser tests need `python3 -m http.server 8766` and pages with `?server=http://127.0.0.1:<port>`.

## When done
- Patch notes: rewrite the "Online lobby (design)" line under Coming up into a proper dated entry (what players get), and keep the file tidy (project rule).
- README: a short "Online lobby" section; docs/SERVER.md: LobbyRoom, messages, limits, the `lobby_duo` key.
- Ask Vilhelm to try it on his iPhone (room list, sort, chat signed in vs guest, emotes, mute, watcher chat merging at the end).
- Plain-text replies to Vilhelm, no bold markers; direct answers.
