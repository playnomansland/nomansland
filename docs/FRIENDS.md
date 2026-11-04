# Friends, game invites and private messages (design, 2026-11-04)

Status: **built 2026-11-04** (sections 1-4; the Watch button in 3b is not built yet) (server side: `docs/SERVER.md` "Friends"). Mute is kept (stored on the server); "Messages in matches: show" isn't built (badge only). Companion to `docs/LOBBY.md` (lobby, chat, emotes). Built by its own agent: see `docs/HANDOFF-FRIENDS.md`. Decisions are Vilhelm's (2026-11-04) unless marked *proposal*.

Not to be confused with **Invite a friend** (the referral that gives the Aquamarine Golem skin, tables `invites` / `referrals`). That stays as it is.

---

## 1. What Vilhelm asked for

- A **friends list**.
- **Add friend:** a request the other player has to **accept**.
- **Remove friend.**
- **Invite friend:** makes a room and sends that player's **account** an invite to it.
- **Private messages** between friends.

---

## 2. Rules

- **Signed-in players only** (Google account), like chat. Guests see a "Sign in to add friends" line.
- Friends are stored by **player id**, so a username change keeps every friend and every message.
- **Add friend** from: a username typed in the Friends sheet (exact match, any case), an opponent's or watcher's nameplate (in a room, a match or after it), the leaderboard.
  - The other player gets a request with Accept / Decline. Declining is silent: the request just disappears for both.
  - Requests last 30 days. If both players ask each other, they become friends at once.
  - Limits (*proposal*): 100 friends, 20 outgoing requests waiting, 20 new requests a day per player; username lookups 30 / 10 min per player (so nobody can probe which tags exist).
- **Remove friend:** either player, at once, silent (no notice to the other). Removes the friendship both ways and deletes the pair's private messages.
- **Status:** a small **dot** by each friend's name: **green = online** (on the menu, in a room or in a match), **grey = offline**. Next to it a short line: *Online*, *In a room*, *In a match · round 4*, or *Last seen 2 h ago*. No "show me as offline" switch (decided 2026-11-04).
- **Account deleted** (`/account/delete`): its friendships, requests and messages are deleted.

---

## 3. Game invites

- In the Friends sheet, an online friend has **Invite**. It opens the Create room sheet with *Private* preselected (mode Standard, or Ranked in the test season; 2v2 for developers), creates the room, puts you in it, and sends the invite.
- Inside a waiting room (yours or not), an **Invite friend** button sends that room's code to a friend.
- The friend sees a banner wherever they are: "**Vilhelm** invites you to a Standard match" with **Join** / **Decline**. In a match it waits as a badge on the Friends button until the match ends (*proposal*), so nobody is pulled out mid-match.
- Join = the normal `hello {}` to `/room/CODE`. Decline tells the inviter ("Otto declined"). An invite expires after 5 minutes, or when the inviter cancels it or leaves the room.
- Only online friends can be invited (grey dot = Invite greyed). At most one open invite per friend, and 10 invites a minute per player.

---

## 3b. Watch a friend (added 2026-11-04)

- A friend who is **in a match** (status *In a match · round N*) gets a **Watch** button in the friends list.
- It opens the match as a spectator: the existing watcher join, `hello { watch: true }` to `/room/CODE`, which already shows the spectator view (nobody's new squads while they deploy). The friend's hub status carries the match code (`status { where: 'match', code, round }`), sent to friends only.
- Respects the room's spectating setting (lobby work: on by default, the host can turn it off): if watching is off, Watch is greyed with "Watching is off for this match".
- Tournament matches can be watched as today; 2v2 not yet.

## 3c. Add friend in Match history (added 2026-11-04)

- Match history (Profile → Match history → My matches) already shows each opponent's username (built 2026-11-04). The page has a hook `histFriendBtn(tag)` that returns '' today: make it return an **Add friend** button (or "Friends ✓" / "Request sent") for that username, using the friends endpoints.

## 4. Private messages

- **Between friends only.** Opened from the friend's row (**Message**) or their nameplate.
- Same checks as room chat: 300 characters (*proposal*; room chat is 120), control characters stripped, the word filter, 5 messages / 10 s and 60 / hour per player.
- Kept on the server so they're there on another phone: the **last 100 messages per pair**, older ones deleted. Unread count per friend, shown as a badge on the Friends button and the friend's row. Seen when the thread is opened (no "read" ticks shown to the sender, *proposal*).
- During a match: no pop-ups, only the badge (*proposal*; a setting *Messages in matches: badge only / show*).
- **Report** on a message posts the last 20 lines of the thread, both usernames and the time through the report path (as room chat reports).
- **Mute** a friend's messages without removing them (*proposal*): stored on the server, so it holds on every phone.

---

## 5. Architecture

### D1 tables (accounts database)
- `friends (a TEXT, b TEXT, since INTEGER, PRIMARY KEY (a, b))`: one row per pair, `a < b` (player ids sorted), so a pair is stored once.
- `friend_requests (sender TEXT, target TEXT, created INTEGER, PRIMARY KEY (sender, target))`.
- `dms (pair TEXT, sender TEXT, text TEXT, created INTEGER)` with an index on `(pair, created)`; `pair = a + ':' + b`. Trimmed to 100 per pair on insert.
- `dm_read (player TEXT, pair TEXT, at INTEGER, PRIMARY KEY (player, pair))`: when each player last opened the thread (unread = newer messages from the other).
- `friend_mutes (player TEXT, muted TEXT, PRIMARY KEY (player, muted))` if muting is kept.

### HTTP (accounts.js, session in the Authorization header as today)
- `POST /account/friends` → `{ friends: [{ id, tag, title, status, seen, unread }], incoming: [...], outgoing: [...] }`.
- `POST /account/friend/add { tag | id }`, `/friend/accept { id }`, `/friend/decline { id }`, `/friend/cancel { id }`, `/friend/remove { id }`.
- `POST /account/dm/list { id, before? }` (a page of 30), `/dm/read { id }`. Sending goes over the hub socket (below).
- `/account/me` gains `friends: { requests, unread }` counts for the badge.
- Players are referred to by **id**; responses carry the current username and title. A lookup by tag returns only `{ id, tag, title }`.

### PlayerHub (new Durable Object, one per player, `/hub`)
The live part: presence, requests, invites and messages arriving while the app is open.
- The page keeps one WebSocket to its own hub while open (menu, lobby, rooms, matches): `hello { session }` → the server checks the session and uses the player's id as the DO name. Several phones of the same player can be connected at once.
- **Presence:** the hub knows the player is online while any socket is open; the page sends `status { where: 'menu'|'room'|'match', code?, round? }` when it changes. On a change (and on connect / last disconnect) the hub tells each friend's hub (DO RPC `friendStatus(id, status)`), which forwards it to that friend's open sockets. Last seen = when the last socket closed, written to `players.seen`.
- **Events pushed to the player:** `request { from }`, `accepted { by }`, `removed { by }` (only to update the list, not shown as a notice), `invite { from, code, mode, expires }`, `inviteGone { code }` (expired or cancelled), `declined { by, code }`, `dm { from, text, at }`, `status { id, status }`.
- **Messages in:** `dm { to, text }` (checked, saved to D1, then RPC `deliver` to the friend's hub), `invite { to, code }`, `inviteCancel { code }` (the hub checks friendship, the friend's status and limits, then RPC to the friend's hub), `decline { code }`, `status {...}`, `ping`.
- The account endpoints call the hubs too (accept → both hubs refresh their friend list; remove → both hubs drop presence links).
- An idle hub (no sockets) keeps nothing in memory; everything durable is in D1.

### Rooms
- No changes to `room.js` (it is being changed by the lobby work at the same time). An invite simply expires after 5 minutes or when the inviter cancels it or leaves the room (the inviter's page tells its hub: `inviteCancel { code }`). Joining a room that has filled or started meets the room's existing `full` / `nomatch` answers, which the page shows as "That match has already started".
- Joining from an invite needs nothing new: the code is a private room's code.

### Page
- **Friends** button on the home menu's top bar (people icon, red badge = requests + unread messages). Also in the in-match menu.
- Friends sheet: tabs **Friends** (online first, then by last seen) and **Requests** (incoming with Accept / Decline, outgoing with Cancel); an *Add by username* box at the top.
- Friend row: green or grey dot, nameplate, status line, **Invite**, **Message**, and a ⋯ menu with **Remove friend** (with a confirm), **Mute messages**.
- Thread sheet for private messages (the same chat component as room chat, wider).
- Invite banner over everything outside matches; badge only during a match.
- Nameplate menus (rooms, matches, leaderboard) get **Add friend** / **Message** next to Mute and Report.
- `hubOpen / hubRecv / hubSend` (reconnects with backoff like the match socket); one socket per page.

---

## 6. Tests

- `server/test/friends.test.js`: request / accept / decline / cancel / remove, both-ask = friends, limits, tag lookup limits, guests refused, rename keeps friends, account delete cleans up.
- `server/test/hub.test.js`: presence across two phones of one player, status pushed to friends only, invites (online only, expire after 5 min or when cancelled), DMs only between friends, filter and limits, 100-message trim, unread counts.
- `tools/tests/friends-ui.js`: two browsers signed in as two test accounts: add, accept, invite → join the same room, message both ways, remove.

---

## 7. Build order

After the lobby list and room chat (it reuses the chat component, filter and report path):
1. Tables, the account endpoints and the Friends sheet (add, accept, remove, list without live status).
2. PlayerHub: presence and live requests.
3. Game invites.
4. Private messages.

---

## 8. Open questions

Settled 2026-11-04: invites go to online friends only; no "show me as offline"; guests keep joining by link but have no friends list; the word is **username** everywhere players see it (never "gamertag").
