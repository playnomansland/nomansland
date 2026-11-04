# Online lobby, chat and emotes (design, 2026-11-04)

Status: **design only, nothing built.** Build handoff: `docs/HANDOFF-LOBBY.md`. Decisions are Vilhelm's (2026-11-04) unless marked *proposal* or *open*.
Builds on the server described in `docs/SERVER.md` (Room, DuoRoom, TourRoom, accounts).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Room list | **One list, "Rooms"**, holding every public room (Standard, Ranked, and 2v2 for developers). No filter chips; a **Sort** button instead (name, date/time, category, mode). Private rooms aren't listed. |
| Ranked | **In the list** for the test season (no real player base yet). A queue replaces or joins it once there are enough players (§5). |
| 2v2 | Built into the lobby architecture now, but **developer only** until 2v2 works as intended. |
| Chat | Text chat in waiting rooms and matches, **for signed-in players only** (guests read and use emotes). Spectators chat in **their own room**, which **merges with the players' chat when the match ends**. |
| Emotes | Three emotes the opponent sees, mutable by the opponent: **Flame Wizard "BABABABA"**, **Happy Ether Golem**, **Shell-shocked Sniper**. In waiting rooms and in matches. Based on the 3D models, **drawn in a cartoonish 2D style. No sounds for now.** |
| Spectating | **On by default**; the host can turn it off. |

---

## 2. Queue vs list for ranked

- **List:** ranked rooms sit in the lobby and anyone picks one. You see the host's name and rating before joining, so you can farm weak players, dodge strong ones, or trade wins with a friend (take turns losing).
- **Queue:** you press *Find ranked match*; the server picks an opponent near your rating. You can't choose who you play, so none of the above works.
- Decision for the test season: **list**. With few players a queue would mostly sit waiting, and win trading matters little before rankings mean anything. Today's ranked-by-code keeps working too.
- Once the player base grows: add the queue (§5), and either drop ranked rooms from the list or keep them with safeguards (a rating band for who may join; a cap on ranked games against the same player per day).

---

## 3. What players see

### Lobby screen (PLAY → Online)
- **Top:** **Quick play**, **Create room**, the join-by-code box, and a **Sort** button.
- **One list, "Rooms":** every public room, Standard and Ranked together (2v2 too, for developers only).
- **Sort** (a small sheet): *Name* (A–Z), *Date/time* (newest first; the default), *Category* (Standard / Ranked), *Mode* (1v1 / 2v2). Picking the active option again flips the order. Within a group, newest first. The choice is remembered on the phone (`pb-lobby-sort`).
- **Room cards:** host's nameplate (username + title), room name (auto: "Vilhelm's room"; no free text, nothing to moderate), tags, map, players (1/2, or 3/4 for 2v2), round if in progress, a 👁 count of watchers, and **Join** / **Watch**.
- Private rooms are never listed. They work as today: code or `?play=CODE` link.
- **Quick play:** joins the oldest open public Standard room; if there is none, creates one and waits in it.
- **Ranked rooms:** created with Mode *Ranked* (account needed, fixed RANKED settings, best of 3, as today). Joining one needs an account too; the card shows the host's leaderboard score.

### Create room (sheet)
Mode (Standard, Ranked; 2v2 for developers), public / private, map, look, timers, **Spectators on/off** (default on).

### Waiting room
Both nameplates, ready check, the host's settings (host can change them until both are ready), **Kick** (host only), the chat panel and the emote button. A waiting room closes after 10 min idle, or when the host leaves before the start.

### In a match
- An **emote button** (small speech bubble) in the tray row opens a wheel: the 3 emotes plus a chat line.
- Emotes play as a ~1.5 s sticker by the sender's nameplate (and over their tower on the board). No sound.
- Chat shows as a short-lived line under the HUD, and in full in a chat sheet.
- Tapping the opponent's nameplate: **Mute emotes**, **Mute chat** (separately), **Report**.
- After the match **Rematch** keeps the room (and the chat).

### Ranked queue (later)
*Find ranked match* (account needed) → a searching banner with the time and a Cancel button; the lobby stays usable. When paired, both phones go straight into the match (no waiting room).

---

## 4. Architecture

### New: LobbyRoom (Durable Object `/lobby`, one instance named `all`, like HistoryRoom)
Holds three things in memory (rebuilt from the rooms' reports after a restart):
1. **Listings** `{ code → listing }`: `{ code, kind: 'match'|'duo', mode: 'standard'|'ranked'|'2v2', host: { tag, title }, map, look, players, seats, phase: 'waiting'|'playing'|'ended', round, watchers, spectate, dev: bool, at }`. Public rooms only.
2. **Subscribers:** lobby sockets, each with `{ dev }` from its session (accounts.js `sessionPlayer`, the server's own dev column, never the phone's word).
3. **Ranked queue** (§5, later; not in the first build).

Messages (WebSocket `/lobby`):
- in: `hello { session? }`, `quick`, `ping` (later: `queue`, `unqueue`)
- out: `rooms { list }` (snapshot on hello), then `room { listing }` / `gone { code }` diffs, batched once a second; `quick { code, create? }`; `pong` (later: `queued { since }`, `paired { code, side, key }`).
- Listings with `dev: true` (2v2 for now) are only sent to sockets whose session is a developer.
- `GET /lobby` returns the same snapshot without a socket (for a quick first paint; dev listings left out).

### Rooms report to the lobby
- `Room` and `DuoRoom` get a `public` setting. When public, they call `LobbyRoom.upsert(listing)` (DO RPC, like `TourRoom.serverResult`) on: created, a player joins or leaves, start, each new round, watcher count change (throttled), settings change; and `LobbyRoom.drop(code)` when the match ends, the room closes or goes private.
- Heartbeat: every room re-sends its listing each 60 s while public; the lobby's alarm drops listings older than 3 min (a crashed or evicted room disappears by itself).
- No change to how a match is played: joining a listed room is the existing `hello {}` to `/room/CODE`; watching is the existing `hello { watch }`.

### Spectating toggle
- Room setting `spectate` (default `true`). Host can flip it in the waiting room or during the match (`{ t: 'spectate', on }`, host only).
- Off: new `hello { watch }` gets `denied { why: 'no watchers' }`, connected watchers are closed with the same reason, and the listing's Watch button goes away.
- Watchers see `Referee.view(m, -1)`, which already hides what each player placed this round.
- Ranked rooms: the host's choice, like any room.

### 2v2 in the lobby (developer only)
- `DuoRoom` registers listings with `kind: 'duo', mode: '2v2', seats: 4, dev: true`.
- Gate in one place: `config` table key `lobby_duo` = `'dev'` (default) or `'all'`. When `'all'`, the listings go out with `dev: false` and DuoRoom's create check (`who.dev`) is lifted. Flipping it needs no deploy.
- Empty seats still fill with AI when the host starts. Quick play never picks 2v2.

### Limits (limits.js)
- One open room per player (by session; guests by key + hashed IP).
- Create: 10 per 10 min per IP. Lobby sockets: 3 per IP. Lobby messages: 30 per 10 s.
- Listed rooms at most 200; the oldest waiting rooms beyond that aren't listed (still joinable by code).

---

## 5. Ranked queue (later, once there are players)

- In `LobbyRoom`. Entry: `{ player, rating, since, socket }`; only accounts (`sessionPlayer`), one entry per player.
- Every 2 s: pair the two longest waiters whose ratings are within a band that widens with waiting time: ±100 at first, +50 every 10 s, unlimited after 60 s.
- Never pair the same two players twice within 30 min if anyone else is waiting (*proposal*).
- On a pair: create a ranked Room with both players assigned in advance (like `TourRoom.matchFor`: side, key), send `paired` to both, and remove them from the queue. If a phone doesn't connect within 30 s, the other is put back at the front of the queue.
- When the queue arrives, ranked rooms in the list and ranked-by-code are either switched off for players (developers keep them for testing) or kept with the safeguards in §2.
- *Open:* what "rating" is. Today's leaderboard is a score from wins and games, not a rating. The queue needs one number per player: either Elo (new column, updated by `recordSeries`) or today's score as a stand-in.

---

## 6. Chat and emotes

### Messages (Room, DuoRoom; same shape in both)
- in: `chat { text }`, `emote { id }` with id one of `bababa`, `golem`, `shock`.
- out: `chat { from, tag, text, at }`, `emote { from, id }` (`from` = side, or seat in 2v2).
- Server checks: text trimmed, control characters removed, at most 120 characters; word filter (a short list, matches replaced by `***`); rate 3 lines per 5 s and 20 per minute; emotes 1 per 3 s. Over the limit: dropped, the sender gets `denied { why: 'slow down' }`.
- Who gets what:
  - players' chat and emotes → both players and the watchers;
  - watchers' chat → other watchers only while the match runs (players never see it, so nobody can pass hidden information to a player);
  - **when the match ends** (the result is in, or a forfeit), the two chats **merge**: everyone in the room (players and watchers) gets the watchers' lines from that match, interleaved by time, and from then on every line goes to everyone. A rematch starting splits them again. Message: `chatMerge { lines }` to players, then normal `chat` to all;
  - 2v2: a *Team* / *All* switch. Team goes to the teammate only (as the current quick lines); All to everyone in the room.
- The room keeps the last 50 lines in memory (for a reconnecting phone and for reports). Chat is **not** saved in match history.
- PeerJS matches (the fallback) get no chat or emotes.

### Muting and reporting (on the phone)
- Opponent's nameplate → **Mute emotes** / **Mute chat**, separately. Muted messages still arrive but aren't shown. Remembered for that match code (localStorage), so a reload keeps it.
- Settings sheet: **Chat** on/off and **Emotes** on/off for every match (hides everyone's).
- **Report** (on a chat line or the nameplate) posts the last 20 lines plus both usernames and the match id to a Discord channel, through the same webhook path as bug reports (`accounts.js` BUG) with its own channel and limit.
- **Text chat is for signed-in players only** (the room checks the account session from hello). Guests see chat, can send emotes, and get a "Sign in to chat" line in place of the text box.
- *Later:* **Block player** (account-level, D1 `blocks` table): hides their chat and emotes in every future match.

### The three emotes
| id | Look |
|---|---|
| `bababa` | Flame Wizard shouting, mouth wide, staff shaking, a comic speech burst "BABABABA!" (same style as the Animation Lab's "AAARGH!"). Matches the Discord title. |
| `golem` | Happy Ether Golem: big closed-eye smile, bouncing, a few sparkles. |
| `shock` | Shell-shocked Sniper: huge round eyes, soot on the face, smoke wisps, a twitch, ring lines around the head. |

- **Style:** cartoonish 2D, drawn by hand as SVG: thick dark outlines, flat colours with one shade, exaggerated faces and proportions (big head). Each keeps the silhouette, colours and props of the unit's 3D model in `src/models3d.js` (Flame Wizard: wizard:fire's hat, robe and staff with the fire orb; Ether Golem: its stone body and glow; Sniper: its headgear, rifle and scope), so players recognise the unit. Render the model once for reference (as for the skin pictures) and draw from it.
- Files `img/emotes/bababa.svg`, `golem.svg`, `shock.svg`. Animated with CSS (pop in, shake / bounce / twitch, fade out after ~1.5 s).
- **No sounds for now.**
- Emotes carry no game information, so they need no hiding rules.

---

## 7. Page

- New screen `#lobby` under the home layer (home screens in `site-template.html`): the Rooms list with Sort, room cards, Quick play / Find ranked / Create room, join box. Opened from PLAY → *Online*.
- `lobbyOpen / lobbyRecv / lobbyDraw` (one socket while the screen is open; closed when a match starts).
- Chat and emote UI shared by the waiting room and the match: `chatPanel`, `emoteWheel`, `emoteShow(from, id)`, mute state `pb-mute-<code>`.
- Settings: `snd`-style keys `chatOn`, `emotesOn`.

---

## 8. Build order (*proposal*)

1. **Lobby list:** LobbyRoom, rooms register when public (Standard and Ranked), the lobby screen, Join / Watch, Quick play, spectate toggle.
2. **Chat and emotes:** messages in Room, the chat panel and emote wheel, muting, reporting, the three emote pictures.
3. **Friends, game invites and private messages:** see `docs/FRIENDS.md`; built in parallel by a separate agent (`docs/HANDOFF-FRIENDS.md`).
4. **2v2 listings** (developer only), Team / All chat.
5. Later, once there are players: the ranked queue (rating, queue, paired rooms).
6. Later: block list, lobby-wide chat channel (not planned; moderation load).

Tests to add: `server/test/lobby.test.js` (listings appear and vanish, dev filter, ranked rooms need an account, heartbeat expiry, limits), chat checks in `match.test.js` (signed-in only, limits, filter, watchers isolated during the match, merge at the end, split on rematch), `tools/tests/lobby-ui.js`.

Timing: all of this changes how online matches start and adds messages to match rooms, so it goes in **after the tournament on Sunday 2026-11-08** (match-play freeze from Saturday).

---

## 9. Open questions

1. Rating for the later queue: Elo or today's leaderboard score?
(Settled 2026-11-04: one Rooms list with Sort; chat signed-in only; watchers chat in their own room, merged at the end; emotes drawn 2D, no sounds.)
