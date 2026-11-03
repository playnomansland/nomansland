# Game server (Cloudflare Workers + Durable Objects)

Started 2026-11-02. The website stays on GitHub Pages; the server only handles online play. vs AI, solo, devtest and Counter Lab never need it.

## How it is built

- `server/` is a Cloudflare Worker (`server/src/index.js`). Each match or tournament code gets its own Durable Object (`Room`): a small program with its own WebSocket connections and its own SQLite database. Free plan to start; Workers Paid ($5/month) when traffic needs it.
- The server bundles the same `src/engine.js` and `src/game.js` the page uses, so a battle on the server gives exactly the result the phones play back (checked by the test).
- One battle takes about 0.3 s of CPU (0.8 s at most in bot-vs-bot rounds). A Durable Object may use 30 s per message, so there is plenty of room.
- Deploy: `.github/workflows/server-deploy.yml` runs the tests on every push to main that touches the server or the game rules, then deploys if the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set.
- Local: `cd server && npm i && npm run dev` (port 8787). Test: `npm test` (starts its own server on 8799).

## Steps

1. Setup (live since 2026-11-02 at https://nml-server.nomansland.workers.dev): `/health`, `/selftest` (one bot round on the server), `/room/<CODE>` WebSocket rooms that relay messages, with the limits below.
2. Tournaments on the server (live since 2026-11-02): `TourRoom` (`server/src/tour.js`) keeps each tournament in its own storage and runs `Tour.apply` for the organizer. Organizer and players each get a secret key; ids are public, keys never are. Bot-vs-bot matches are played by the server. Tournaments are deleted when ended or after 14 days untouched. Matches themselves are still phone-to-phone (step 3). Old tournament history is not carried over.
3. Server as referee (live since 2026-11-02): `Room` (`server/src/room.js`) keeps each live match; the rules are `src/referee.js` (shared with the page and node tests). Phones send actions (`{ t: 'act', seq, fn, a }`: a Game function from `Referee.ACTIONS` and its arguments), never their gold or army. The Room runs them through the same Game functions (which check gold, tiles and unlocks), on that player's side only, only while deploying and before Ready, and acks each with a fingerprint of that side. It runs the deploy clock (alarms), the fight and the round flow, and sends each phone only its view (`Referee.view`). A friend's match: the phone that makes it is side 0 (`hello { create }`), the friend side 1, each with a secret key for reconnects. A tournament match (`/room/<CODE>?t=<T>`): `TourRoom.matchFor` checks the player's tournament key and says the side; the Room reports the result with `TourRoom.serverResult` (Durable Object RPC), and phones' own reports are ignored. Matches are deleted after a day untouched. PeerJS stays as a fallback (Factions, Counter Lab units, a tournament's `net: 'peer'` setting, and when the server can't be reached) until a tournament has run on the server.
4. Match history on the server (built 2026-11-02): the server saves every round of every server match itself; the phones no longer post server matches to the Google Sheet (the Sheet is exported and kept as an archive). Details below.
5. Accounts (live since 2026-11-02: guests and Sign in with Google; details below). 6. Ranked (below).

## Match history (step 4)

- Where: one `HistoryRoom` Durable Object (`server/src/history.js`, named `all`) with its own SQLite table `rounds`. Chosen over D1 for now: it needs no new database, dashboard step or token rights (the deploy token's Workers rights cover it), and it is the same kind of storage as the Rooms. Accounts (step 5) can still go to D1; if history ever needs SQL joins with accounts, it moves there with a one-off copy.
- When: the Room saves a round right after the fight message has gone out to the phones (`Room.record`, called from `broadcastFight`; a forfeit gets a row too). It is a Durable Object RPC call the match never waits for, and any error is logged (`history not saved`) and swallowed: a failing or slow store can't stop or slow a match. `server/test/history.test.js` checks this with a store that always fails (`HISTORY_FAIL_ROOMS`, a test-only setting that production never sets).
- What, per round: room code, tournament code and match id (tournament matches), the match id `<ROOM>-<seed>` (a room's rematch is a new match), round, map, look, both leaders, each army (unit, level, tile), skills bought, tower types, winner, timeout, seconds, damage, health after, match over and match winner, time, and for a forfeit which side gave up. Gamertags only for tournament matches. The pre-fight snapshot and the fight summary are kept gzipped (about 1-3 KB a round; dropped if over 64 KB) so replays can be added later.
- Reading: `GET /history?limit=&before=` (newest first, `limit` 1-100, default 40; `before` is the `next` id from the page before) and `GET /history/<match>` (one match, oldest round first; a bare room code gives that room's newest match). Same origin check as the rooms, and at most 60 reads a minute per IP. The page's Match history sheet reads it (Online matches tab); the Phone-to-phone tab and the fallback when the server can't be reached read the Sheet.
- Phone-to-phone (PeerJS) matches still post to the Sheet from the host's phone for now: the server never sees them, and they are the fallback until the server has carried a tournament. They stop when PeerJS goes.
- Retention: rounds are kept for 1 year (`KEEP_DAYS`), then deleted by a daily alarm. No personal data beyond tournament gamertags; no IP addresses are stored (the read limit keeps them in memory only for a minute).

## Security: built in from the start

The goal is that nothing has to be redesigned if thousands of strangers show up. Only capacity and moderation tools get added then.

- The server decides. Since step 3 no result, gold amount or army comes from a phone; a modified client can only send actions the rules allow (`node tools/tests/referee.js` and `server/test/match.test.js` try the cheats: unknown functions, extra arguments, wrong types, locked units, bad tiles, no gold, the other side's squads, actions after Ready or the clock).
- Each player and the organizer have their own secret key: nobody can act or report as someone else, and only the organizer's key runs organizer actions, which the server checks against the rules (`Tour.apply`) and a list of allowed settings.
- Limits per connection: messages over 256 KB, more than 40 messages per 10 s (150 in a match room, where every tap is an action), non-JSON or binary messages close the connection. At most 12 connections per room. Codes are 4-8 letters/digits.
- Origin check: only the game's own pages (GitHub Pages, local test servers) can open a connection from a browser. Scripts can fake this, so it is a first filter, not the lock; the referee and the limits are the lock.
- Secrets live in GitHub Actions secrets and Cloudflare, never in the repo. The Cloudflare token is limited to Workers.
- Cloudflare's network absorbs floods (DDoS protection is included on every plan).
- Pinned tool versions and a committed `server/package-lock.json`, so builds are reproducible.

Added when the player count calls for it (no redesign needed):

- Per-IP rate limits on new rooms and sign-ups (Cloudflare rate limiting rules, Turnstile bot check on sign-up).
- Gamertag filter and a report button; admin actions (ban, rename, settle a disputed result) only through the server with an audit log.
- Error alerts, usage and spending alerts, a status page.
- Daily database export (Durable Object SQLite also has 30-day point-in-time recovery; the History object is one database, so one export covers all match history).

## Accounts (step 5)

The idea:

- Play as a guest first: the phone gets a random player id from the server and a gamertag. No sign-up needed to try the game.
- One tap to keep it: "Sign in with Google" (and "Sign in with Apple", which the App Store requires when an iPhone app offers Google sign-in). Later maybe Discord.
- The player's id is our own; Google/Apple are just keys linked to it. Signing in on a new phone finds the same player. A guest who signs in keeps their id and gamertag.
- The server checks Google's and Apple's signed tokens itself, then gives the phone its own session (expires, can be revoked). No passwords stored by us.
- Account deletion removes the login and personal data; past match results stay with an anonymous name.

Built 2026-11-02 (`server/src/accounts.js`, routes in `server/src/index.js`):

- Storage: the D1 database `nml-accounts`, bound as `ACCOUNTS`. The block in `server/wrangler.toml` stays commented out until the database exists; until then every `/account/*` route answers 503 `accounts off` and nothing else changes. The Worker makes its own tables (`CREATE TABLE IF NOT EXISTS`, once per isolate), so no migration step is needed in the deploy.
- Routes, all `POST` with a JSON body (8 KB at most), the same origin check as the rooms, and a preflight answer for the Authorization header:
  - `/account/guest { tag? }` -> `{ player, session }`. A new player `p` + 16 hex digits, gamertag `Guest NNNN` unless one is given.
  - `/account/google { credential }` -> `{ player, session, linked }`. Verifies Google's ID token: RS256 signature against Google's published keys (cached by their max-age, refetched once for an unknown key id), audience = `GOOGLE_CLIENT_ID`, issuer, expiry (1 minute leeway), not issued in the future. `linked` is `existing` (that Google account's player, on any phone), `guest` (the signed-in guest gets the login and keeps id and gamertag) or `new`. The session that made the call ends either way.
  - `/account/me` -> `{ player, session? }`, `/account/tag { tag }`, `/account/signout { all? }`, `/account/delete`. These need `Authorization: Bearer <session>`.
- Developer mode: a player is a developer when they sign in with a Google account whose verified email is in the secret `DEV_EMAILS` (comma separated). It is a Cloudflare secret, put there by the deploy workflow from the GitHub secret of the same name, so no email is in the repo. Checked at every Google sign-in (removing an email takes it away at that account's next sign-in); the email is compared and dropped, never stored; guests are never developers. `player.dev` comes back from every account route; the page's `devMode()` reads it. Rule for the future: every feature that is locked or gated per player lets developers through (on the server by its own `dev` column, never by the phone's word).
- Gamertags: 2-16 letters (any language), digits, space, `_ . -`. Not unique.
- Sessions: 32 random bytes; the phone keeps the token (`phonebellum.account.v1`), the server only its SHA-256. 30 days from the last rotation; `/account/me` rotates a session older than a day and leaves the old token working for 5 minutes. At most 10 per player (the oldest go). Tokens only in the Authorization header, never in URLs or logs.
- Limits per IP (the IP kept only as a hash, for the length of the window): 20 guest requests an hour, 30 Google sign-ins per 10 minutes, 120 other calls a minute. A tournament on one wifi stays well inside these.
- What is stored: `players` (id, gamertag, created, last seen, deleted, dev), `logins` (provider, Google's subject id, player), `sessions` (token hash, player, created, expires), `hits` (rate-limit counters). No email, name or picture from Google. Deleting an account removes its logins and sessions and blanks the gamertag; the id stays as a tombstone so past results can point at an anonymous player. Account rows have no expiry; sessions end after 30 days.
- The page: Account on the start screen (`openAccountSheet` in `src/site-template.html`). Nothing is created until the player taps Play as a guest or signs in. Google's script (`accounts.google.com/gsi/client`) is loaded only when the sheet opens and `GOOGLE_CLIENT_ID` is set in the page.
- Not yet (after the 2026-11-08 tournament): tournament players and match history rows linked to player ids, so a player's history follows the account. A guest who signs in to a Google account that already has a player becomes that player; the old guest is left as it is (it has no history to move yet).
- Tests: `server/test/accounts.test.js` (in `npm test`; signs its own Google-style tokens against a local key server, checks every route, rotation, limits and refusals) and `node tools/tests/account-ui.js` (the sheet in the browser with a fake Google button; needs `python3 -m http.server 8766`). Both run against a local D1 database (`server/test/accounts-env.js`).
- Setup (done 2026-11-02): D1 database `nml-accounts` bound in `wrangler.toml`; the deploy token has Account / D1 / Edit; GitHub secret `DEV_EMAILS` (Vilhelm's Google email); Google OAuth client (Google Auth Platform, Web application, origins snetendare.github.io, playnomansland.github.io and the two local test servers) with its id in `[vars]` and the page's `GOOGLE_CLIENT_ID`. A new site address must be added to the client's origins and to `ALLOWED_ORIGINS`.

## Ranked (later)

- Only when enough players are online that queue times stay short. Until then: tournaments, invite codes and vs AI.
- Built on steps 3 and 5: only server-refereed matches between signed-in players count. A rating (Glicko-2 or similar) per player, a matchmaking Room that pairs by rating and widens the range the longer someone waits, and the queue only open when the expected wait is short.


## Ranked play and the leaderboard (2026-11-02)

- A ranked match is a friend's match on the Room with hello { create, ranked: true, session }. Both phones send their account session in hello (never in the URL); the Room checks it with accounts.js sessionPlayer. No account: denied { why: 'account' }; the same player on both sides: 'self'; switched off: 'ranked off' (developers may still create one).
- Settings are fixed by the server (room.js RANKED): map testgrid ("Standard"), packOptions 5, mirror, offChars ['blixten']; only the creator's look is kept.
- meta.ranked keeps the series ({ ids, tags, wins, ties, games, done, result, forfeit, counted }); tally() counts each finished game once (by seed). Best of 3: 2 wins, or 3 games (equal wins = a tie). A forfeit loses the series. When decided, recordSeries adds w/t/l to D1 table ranked. Rematch = next game; after a decided series, a new series. welcome, lobby, sync, fight and forfeit carry ranked.
- D1 tables: ranked (player, w, t, l, updated) and config (k, v; 'ranked' = 'on' | 'off'). POST /account/ranked { on } (developer only, the server's dev column) switches it; /account/me returns rankedOn. GET /leaderboard (origin-checked) -> { on, rows: [{ id, tag, w, t, l }] }, best win share first, deleted accounts left out.
- Tests: server/test/ranked.test.js (in npm test).

## Titles (2026-11-02)

- accounts.js titlesOf(player): 'dev' (players.dev) and 'day1' (players.created before DAY1_END = 2026-11-09 00:00 Stockholm). players.title (added by ensureSchema with ALTER TABLE) is the pick: an id, 'none', or NULL (= the first earned). Player objects carry titles and title; POST /account/title { title } ('' = none; only an earned title). The leaderboard rows and the ranked series (titles) carry the shown title. Page: TITLES, nameplate(), popup for titles not yet announced on this phone (pb-titles-seen).
- Legend title (2026-11-03): gold, for the top LEGEND.top (5) of the leaderboard when a Stockholm month ends, kept for good. The Worker's hourly cron ([triggers] crons = "7 * * * *", index.js scheduled) calls accounts.js awardLegends: once the clock is past a month (LEGEND.first = '2026-11') not yet in config 'legend_month', the top 5 by the leaderboard's order (BOARD_SQL) get an 'awards' row (player, title, period, place) and players.legend is recounted. Idempotent. The board is not reset. GET /leaderboard also returns legend { top, ends }. LEGEND_NOW (ms) is a test-only stand-in for the clock. Tests: tools/tests/legend.js (headless, node:sqlite as D1), server/test/ranked.test.js (the cron through wrangler --test-scheduled).

## Unit skins (2026-11-03)

- A skin changes how one unit looks, never its stats. Looks live in src/shapes.js (Shapes.SKINS: unit, name, text, 3D model in models3d.js BUILD, pic = a picture of the model for menus in img/skins/). The 2D board always keeps the unit's own symbol (Vilhelm's call); the server only knows the ids (accounts.js SKINS). First skin: 'brute-champion' (Champion Brute: crown, gold armour, cape, war hammer).
- Table skins (player, skin, src, worn, created). src 'grant' = owned; src 'dev' = only a developer's on/off choice. Developers own every skin, off until worn; granted skins start worn.
- SKIN_GRANTS gives a skin to a gamertag (first: Champion Brute to "Gubbolas Cage"). grantSkins runs on every POST /account/me and in the hourly cron: the oldest live account with that tag (any case) gets it for good and config 'grant:<skin>:<tag>' marks it done, so renaming keeps it and taking the name later gives nothing. Until such an account exists it keeps trying.
- Player objects carry skins [{ id, worn }]. POST /account/skin { skin, worn } (owned skins only, 400 'not your skin'). sessionPlayer returns the worn ids, and a match Room puts them in players[side].skins, so the other phone and spectators draw them. Tournament matches and 2v2 show no skins yet; vs AI and phone-to-phone matches show your own.
- Page: Shapes.useSkins([side 0 ids, side 1 ids]) in render() (syncSkins: own side from the account, the opponent's from net.players); render3d swaps in the skin's model. Profile has a Skins row (On / Off); the menu shows a "new skin" popup once per phone (pb-skins-seen; not for developers).
- Tests: server/test/skins.test.js (in npm test), tools/tests/skins-ui.js (browser, own accounts server on 8789; PB_BOARD=3d for 3D, which is slow headless and can time out on the first click).
