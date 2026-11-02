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
4. Match history in the server's database instead of the Google Sheet (the Sheet is exported and kept).
5. Accounts (below). 6. Ranked (below).

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
- Daily database export (Durable Object SQLite also has 30-day point-in-time recovery).

## Accounts (step 5)

- Play as a guest first: the phone gets a random player id from the server and a gamertag. No sign-up needed to try the game.
- One tap to keep it: "Sign in with Google" (and "Sign in with Apple", which the App Store requires when an iPhone app offers Google sign-in). Later maybe Discord.
- The player's id is our own; Google/Apple are just keys linked to it. Signing in on a new phone finds the same player. A guest who signs in keeps their history.
- The server checks Google's and Apple's signed tokens itself, then gives the phone its own session (expires, can be revoked). No passwords stored by us.
- Accounts and sessions go in a Cloudflare D1 database (SQL, also on the free plan); matches and tournaments stay in their Rooms.
- Needed from Vilhelm then: a Google Cloud OAuth client id (free) and, for the iPhone app, an Apple Developer account.
- Account deletion removes the login and personal data; past match results stay with an anonymous name.

## Ranked (later)

- Only when enough players are online that queue times stay short. Until then: tournaments, invite codes and vs AI.
- Built on steps 3 and 5: only server-refereed matches between signed-in players count. A rating (Glicko-2 or similar) per player, a matchmaking Room that pairs by rating and widens the range the longer someone waits, and the queue only open when the expected wait is short.
