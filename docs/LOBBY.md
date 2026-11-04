# Online lobby, ranked queue, chat and emotes (design, 2026-11-04)

Status: **design only, nothing built.** Decisions are Vilhelm's (2026-11-04) unless marked *proposal* or *open*.
Builds on the server described in `docs/SERVER.md` (Room, DuoRoom, TourRoom, accounts).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Room list | A global list of open rooms, tagged Standard / Ranked / 2v2, public / private. |
| Ranked | Explained queue vs list; the design below uses a **queue** (*proposal*, waiting on Vilhelm's pick). |
| 2v2 | Built into the lobby architecture now, but **developer only** until 2v2 works as intended. |
| Chat | Text chat, in the lobby rooms and in matches. |
| Emotes | Three emotes the opponent sees, mutable by the opponent: **Flame Wizard "BABABABA"**, **Happy Ether Golem**, **Shell-shocked Sniper**. In the lobby and in matches. |
| Spectating | **On by default**; the host can turn it off. |

---

## 2. Queue vs list for ranked (why the queue)

- **List:** ranked rooms sit in the lobby and anyone picks one. You see the host's name and rating before joining, so you can farm weak players, dodge strong ones, or trade wins with a friend (take turns losing).
- **Queue:** you press *Find ranked match*; the server picks an opponent near your rating. You can't choose who you play, so none of the above works.
- Today's ranked is started from a match code, which is effectively the list version (a friend can make a ranked room and join it). The queue replaces that: ranked rooms can no longer be created by code.
- Playing a specific friend stays possible in Standard (private room, code or link).

---

## 3. What players see

### Lobby screen (PLAY → Online)
- **Top:** filter chips: *Standard*, *Ranked* (in-progress only, for watching), *2v2* (developers only), *Open only*. Then **Quick play**, **Find ranked match**, **Create room**, and the join-by-code box.
- **Room cards:** host's nameplate (gamertag + title), room name (auto: "Vilhelm's room"; no free text, nothing to moderate), tags, map, players (1/2, or 3/4 for 2v2), round if in progress, a 👁 count of watchers, and **Join** / **Watch**.
- Private rooms are never listed. They work as today: code or `?play=CODE` link.
- **Quick play:** joins the oldest open public Standard room; if there is none, creates one and waits in it.

### Create room (sheet)
Mode (Standard; 2v2 for developers), public / private, map, look, timers, **Spectators on/off** (default on).

### Waiting room
Both nameplates, ready check, the host's settings (host can change them until both are ready), **Kick** (host only), the chat panel and the emote button. A waiting room closes after 10 min idle, or when the host leaves before the start.

### In a match
- An **emote button** (small speech bubble) in the tray row opens a wheel: the 3 emotes plus a chat line.
- Emotes play as a ~1.5 s sticker by the sender's nameplate (and over their tower on the board), with a sound.
- Chat shows as a short-lived line under the HUD, and in full in a chat sheet.
- Tapping the opponent's nameplate: **Mute emotes**, **Mute chat** (separately), **Report**.
- After the match **Rematch** keeps the room (and the chat).

### Ranked queue
*Find ranked match* (account needed) → a searching banner with the time and a Cancel button; the lobby stays usable. When paired, both phones go straight into the match (no waiting room).

---

## 4. Architecture

### New: LobbyRoom (Durable Object `/lobby`, one instance named `all`, like HistoryRoom)
Holds three things in memory (rebuilt from the rooms' reports after a restart):
1. **Listings** `{ code → listing }`: `{ code, kind: 'match'|'duo', mode: 'standard'|'ranked'|'2v2', host: { tag, title }, map, look, players, seats, phase: 'waiting'|'playing'|'ended', round, watchers, spectate, dev: bool, at }`. Public rooms only.
2. **Subscribers:** lobby sockets, each with `{ dev }` from its session (accounts.js `sessionPlayer`, the server's own dev column, never the phone's word).
3. **Ranked queue** (§5).

Messages (WebSocket `/lobby`):
- in: `hello { session? }`, `quick`, `queue`, `unqueue`, `ping`
- out: `rooms { list }` (snapshot on hello), then `room { listing }` / `gone { code }` diffs, batched once a second; `quick { code, create? }`; `queued { since }`, `paired { code, side, key }`; `pong`.
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
- Ranked matches: spectating on, not changeable (*proposal*; keeps the queue's matches watchable).

### 2v2 in the lobby (developer only)
- `DuoRoom` registers listings with `kind: 'duo', mode: '2v2', seats: 4, dev: true`.
- Gate in one place: `config` table key `lobby_duo` = `'dev'` (default) or `'all'`. When `'all'`, the listings go out with `dev: false` and DuoRoom's create check (`who.dev`) is lifted. Flipping it needs no deploy.
- Empty seats still fill with AI when the host starts. Quick play never picks 2v2.

### Limits (limits.js)
- One open room per player (by session; guests by key + hashed IP).
- Create: 10 per 10 min per IP. Lobby sockets: 3 per IP. Lobby messages: 30 per 10 s.
- Listed rooms at most 200; the oldest waiting rooms beyond that aren't listed (still joinable by code).

---

## 5. Ranked queue

- In `LobbyRoom`. Entry: `{ player, rating, since, socket }`; only accounts (`sessionPlayer`), one entry per player.
- Every 2 s: pair the two longest waiters whose ratings are within a band that widens with waiting time: ±100 at first, +50 every 10 s, unlimited after 60 s.
- Never pair the same two players twice within 30 min if anyone else is waiting (*proposal*).
- On a pair: create a ranked Room with both players assigned in advance (like `TourRoom.matchFor`: side, key), send `paired` to both, and remove them from the queue. If a phone doesn't connect within 30 s, the other is put back at the front of the queue.
- Ranked from a code (`hello { create, ranked }`) is switched off for players; developers keep it for testing.
- *Open:* what "rating" is. Today's leaderboard is a score from wins and games, not a rating. The queue needs one number per player: either Elo (new column, updated by `recordSeries`) or today's score as a stand-in.

---

## 6. Chat and emotes

### Messages (Room, DuoRoom; same shape in both)
- in: `chat { text }`, `emote { id }` with id one of `bababa`, `golem`, `shock`.
- out: `chat { from, tag, text, at }`, `emote { from, id }` (`from` = side, or seat in 2v2).
- Server checks: text trimmed, control characters removed, at most 120 characters; word filter (a short list, matches replaced by `***`); rate 3 lines per 5 s and 20 per minute; emotes 1 per 3 s. Over the limit: dropped, the sender gets `denied { why: 'slow down' }`.
- Who gets what:
  - players' chat and emotes → both players and the watchers;
  - watchers' chat → other watchers only (players never see it, so nobody can pass hidden information to a player);
  - 2v2: a *Team* / *All* switch. Team goes to the teammate only (as the current quick lines); All to everyone in the room.
- The room keeps the last 50 lines in memory (for a reconnecting phone and for reports). Chat is **not** saved in match history.
- PeerJS matches (the fallback) get no chat or emotes.

### Muting and reporting (on the phone)
- Opponent's nameplate → **Mute emotes** / **Mute chat**, separately. Muted messages still arrive but aren't shown or played. Remembered for that match code (localStorage), so a reload keeps it.
- Settings sheet: **Chat** on/off and **Emotes** on/off for every match (hides everyone's).
- **Report** (on a chat line or the nameplate) posts the last 20 lines plus both gamertags and the match id to a Discord channel, through the same webhook path as bug reports (`accounts.js` BUG) with its own channel and limit.
- *Proposal:* text chat for signed-in players only; guests can still send emotes and read chat. Guests are free and anonymous, which is where abuse usually comes from.
- *Later:* **Block player** (account-level, D1 `blocks` table): hides their chat and emotes in every future match.

### The three emotes
| id | Look | Sound |
|---|---|---|
| `bababa` | Flame Wizard shouting, comic speech burst "BABABABA!" (same style as the Animation Lab's "AAARGH!"), staff shaking. Matches the Discord title. | short shouted "ba-ba-ba" |
| `golem` | Happy Ether Golem: bounces, glowing smile, a few sparkles. | soft happy hum / chime |
| `shock` | Shell-shocked Sniper: wide eyes, smoke wisps, a little twitch, tinnitus ring lines. | high ringing tone fading out |

- v1 art: a still picture of each, rendered from the game's own 3D models with the expression parts added (like the skin pictures in `img/skins/`), animated with CSS (pop in, shake/bounce, fade out). Files `img/emotes/*.png`. Sounds are placeholders until Vilhelm has real ones.
- Emotes carry no game information, so they need no hiding rules.

---

## 7. Page

- New screen `#lobby` under the home layer (home screens in `site-template.html`): filters, room cards, Quick play / Find ranked / Create room, join box. Opened from PLAY → *Online*.
- `lobbyOpen / lobbyRecv / lobbyDraw` (one socket while the screen is open; closed when a match starts).
- Chat and emote UI shared by the waiting room and the match: `chatPanel`, `emoteWheel`, `emoteShow(from, id)`, mute state `pb-mute-<code>`.
- Settings: `snd`-style keys `chatOn`, `emotesOn`.

---

## 8. Build order (*proposal*)

1. **Lobby list:** LobbyRoom, rooms register when public, the lobby screen, Join / Watch, Quick play, spectate toggle.
2. **Chat and emotes:** messages in Room, the chat panel and emote wheel, muting, reporting, the three emote pictures.
3. **Ranked queue:** rating, queue, paired rooms; switch off ranked-by-code for players.
4. **2v2 listings** (developer only), Team / All chat.
5. Later: block list, lobby-wide chat channel (not planned; moderation load).

Tests to add: `server/test/lobby.test.js` (listings appear and vanish, dev filter, heartbeat expiry, queue pairing and band widening, limits), chat checks in `match.test.js` (limits, filter, watcher isolation), `tools/tests/lobby-ui.js`.

Timing: all of this changes how online matches start and adds messages to match rooms, so it goes in **after the tournament on Sunday 2026-11-08** (match-play freeze from Saturday).

---

## 9. Open questions

1. Ranked: queue (proposal) or list?
2. Rating for the queue: Elo or today's leaderboard score?
3. Chat for guests too, or signed-in players only (proposal)?
4. Should watchers be able to chat at all, or only read?
5. Real sounds for the emotes, or placeholders for now?
