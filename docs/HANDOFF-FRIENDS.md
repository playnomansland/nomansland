# Handoff: build friends, game invites and private messages

For the Claude Code agent building this (written 2026-11-04). The design is `docs/FRIENDS.md`; read it first, then `docs/SERVER.md` (accounts, sessions, limits, D1, Durable Objects). Where this file and FRIENDS.md differ, FRIENDS.md wins.

Another agent builds the online lobby, room chat and emotes at the same time (`docs/LOBBY.md`, `docs/HANDOFF-LOBBY.md`, branch `lobby`). See "Working next to the lobby agent".

## Words
Players see **username**, never "gamertag" (code keeps the existing `tag` names: `players.tag`, `/account/tag`).

## Timing and branches
- Tournament on **Sunday 2026-11-08**. Nothing that changes how online matches start or run may reach the server or the site before **Monday 2026-11-09**. Pushes to main deploy the server (any change under `server/`, `src/engine.js`, `src/game.js`, `src/referee.js`, `src/tournament.js`, `src/*.json`) and the site.
- So: work on branch **`friends`**, push the branch as you go, merge to main from Monday on (Vilhelm's rule is otherwise "push everything to main").
- Read `README.md`, `PATCH-NOTES.md` (top) and the newest commits on main first. Rebase on main before merging.

## What to build (in this order; each step mergeable on its own)
1. **Friends list** (no live parts yet)
   - D1 tables in `accounts.js` (it creates its own tables at start): `friends (a, b, since)` with `a < b`, `friend_requests (sender, target, created)`.
   - Endpoints (session in the Authorization header, signed-in players only: a Google login, not a bare guest): `POST /account/friends`, `/account/friend/add { tag | id }`, `/friend/accept { id }`, `/friend/decline { id }`, `/friend/cancel { id }`, `/friend/remove { id }`. Both asking = friends at once. Requests last 30 days. Declining and removing are silent.
   - Limits: 100 friends, 20 outgoing requests waiting, 20 new requests a day, username lookups 30 / 10 min per player. A lookup returns only `{ id, tag, title }`.
   - `/account/me` gains `friends: { requests, unread }` for the badge. `/account/delete` removes the player's friendships, requests and messages.
   - Friends are stored by **player id**, so a username change keeps them.
   - Page: a **Friends** button on the home menu's top bar (people icon, red badge) and in the in-match menu; Friends sheet with tabs **Friends** and **Requests**, an *Add by username* box; friend row with dot, nameplate, status line, **Invite**, **Message**, ⋯ (**Remove friend** with a confirm, **Mute messages**). Nameplate menus (rooms, matches, leaderboard) get **Add friend** / **Message**. Guests see "Sign in to add friends".
2. **Online status (PlayerHub)**
   - `server/src/hub.js`: `PlayerHub` Durable Object, one per player (named by player id), WebSocket route `/hub`, `hello { session }`. Several phones of one player may connect at once.
   - The page keeps one hub socket open while the app is open (menu, rooms, matches), reconnecting with backoff, and sends `status { where: 'menu'|'room'|'match', code?, round? }` when it changes.
   - The hub pushes status changes to each friend's hub (DO RPC), which forwards to that friend's sockets. Last seen = when the last socket closed (`players.seen`).
   - **Dot by every friend's name: green = online** (menu, room or match), **grey = offline.** Beside it: *Online*, *In a room*, *In a match · round 4*, or *Last seen 2 h ago*. Online friends first, then by last seen. No "show me as offline" switch.
   - Live events: `request`, `accepted`, `removed` (list update only), `status`.
3. **Game invites**
   - Friend row **Invite** (online friends only; greyed with a grey dot): opens Create room with *Private* preselected (Standard; Ranked allowed in the test season), creates the room the normal way (`hello { create }` to `/room/CODE`), then sends `invite { to, code }` over the hub. Inside a waiting room, an **Invite friend** button sends that room's code.
   - The friend gets `invite { from, code, mode, expires }`: a banner "**Vilhelm** invites you to a Standard match" with Join / Decline outside matches; during a match only the badge, shown after the match. Join = the normal `hello {}`. Decline → the inviter gets `declined`.
   - Expires after 5 min, or when the inviter cancels or leaves the room (`inviteCancel { code }` from the inviter's page → `inviteGone`). **No changes to `server/src/room.js`** (the lobby agent is changing it); a room that already filled or started answers `full` / `nomatch` as today, shown as "That match has already started".
   - Limits: one open invite per friend, 10 invites a minute.
4. **Private messages**
   - Tables `dms (pair, sender, text, created)` with an index on `(pair, created)`, `dm_read (player, pair, at)`, `friend_mutes (player, muted)`.
   - Send over the hub: `dm { to, text }`, friends only; checked (300 characters, control characters stripped, word filter, 5 / 10 s and 60 / hour), saved, delivered to the friend's hub. Keep the last 100 per pair. `POST /account/dm/list { id, before? }` (pages of 30), `/dm/read { id }`. Unread badge per friend and on the Friends button.
   - Thread sheet. During a match: badge only. **Report** posts the last 20 lines, both usernames and the time through the report path (the bug-report webhook in `accounts.js`, own channel and limit). Mute is stored on the server.
   - Removing a friend deletes the pair's messages.

Not to touch: the existing **Invite a friend** referral (Aquamarine Golem skin; tables `invites`, `referrals`, `?invite=` links). Different feature, keep it as is, and pick names that don't clash (`room invite`, `friend_*`).

## Working next to the lobby agent
- It works on branch `lobby` and owns: `server/src/lobby.js` (LobbyRoom), the `public`/`spectate` settings and chat/emote messages in `room.js` and `duo.js`, the `#lobby` screen, the room chat panel and emote wheel. Don't touch those.
- Shared: `server/src/text.js` (clean text, word filter, rate helper). Whoever needs it first writes it on their branch; the other copies it unchanged. API: `cleanText(s, max)`, `filterWords(s)`, `rateOk(state, key, n, ms)`.
- Shared files you will both touch: `wrangler.toml` (Durable Object bindings and **migrations**: use the tag `hub-1` for PlayerHub; the lobby uses `lobby-1`; whoever merges second puts its migration after the other's), `server/src/index.js` (routes), `server/src/limits.js`, `src/site-template.html`, `PATCH-NOTES.md`, `README.md`, `docs/SERVER.md`. Keep your changes in their own blocks so rebases stay easy.
- The thread sheet can start as its own small component; once the lobby's chat panel is on main, reuse it if that's simple.
- Merge order doesn't matter; whoever merges second rebases on main and reruns `cd server && npm test`.

## Tests
- `server/test/friends.test.js`: add / accept / decline / cancel / remove, both-ask, limits, lookup limit, guests refused, rename keeps friends, account delete cleans up.
- `server/test/hub.test.js`: two phones of one player, status to friends only, dot data (online / offline / last seen), invites (online only, 5 min expiry, cancel), DMs friends only, filter and limits, 100-message trim, unread counts.
- `tools/tests/friends-ui.js`: two browsers signed in as two test accounts (see `server/test/accounts-env.js` for local D1 and the stand-in Google key server): add, accept, green dot appears, invite → both in the same room, message both ways, remove, dot gone.
- Run `cd server && npm test` and the existing referee / tournament / duo tests before merging.
- Ports 8784-8798 are taken by other tests and the lobby agent has 8780-8781: use **8782-8783**.
- Local notes: `wrangler dev` keeps Durable Object storage between runs (use fresh ids); kill leftovers with `pkill -f "[w]orkerd"` and `pkill -f "[w]rangler-dist"`; browser tests need `python3 -m http.server 8766` and pages with `?server=http://127.0.0.1:<port>`.

## When done
- Patch notes: rewrite the "Friends (design)" line under Coming up into a proper dated entry (what players get), and keep the file tidy (project rule).
- README: a short "Friends" section; docs/SERVER.md: PlayerHub, the new tables and endpoints, hub messages, limits.
- Ask Vilhelm to try it on his iPhone with a friend: add, accept, dots, invite into a room, message, remove.
- Plain-text replies to Vilhelm, no bold markers; direct answers.
