# Handoff: server step 5, accounts

Written 2026-11-02 at the end of step 4. Read this, then `docs/SERVER.md` (the plan, security rules, and the Accounts section), then only the files named below.

Repo: snetendare/phone-bellum, push to main. Server: https://nml-server.nomansland.workers.dev (Cloudflare Workers + Durable Objects), deployed by `.github/workflows/server-deploy.yml` on push to main once the tests pass. Vilhelm wants plain-text replies with no bold, and direct answers.

## Status (end of 2026-11-02 session)

Stages 1 and 2 are built, tested and pushed; accounts are switched off on the live server until Vilhelm's setup is done. Details: docs/SERVER.md, "Accounts (step 5)".

- Decisions (Vilhelm): D1 for accounts; tournaments and history do not use player ids before Sunday.
- Server: `server/src/accounts.js` (guest, google, me, tag, signout, delete), routed in `server/src/index.js`. No D1 binding = 503 'accounts off'. Nothing in room.js, tour.js, referee.js, tournament.js or the page's 'net' mode was touched.
- Page: Account button on the start screen, `openAccountSheet` and `GOOGLE_CLIENT_ID` (empty) in `src/site-template.html`.
- Tests: `server/test/accounts.test.js` (in npm test), `tools/tests/account-ui.js`, shared setup `server/test/accounts-env.js` (local D1 via a config copy in `server/.wrangler/accounts-test.toml`, local key server, `idToken()`).
- Developer mode (Vilhelm, 2026-11-02): his Google account gets every feature now and later. Server flag `dev` from the secret DEV_EMAILS (GitHub secret -> Cloudflare secret in the deploy workflow; the sandbox can't set GitHub secrets). Page: `devMode()`. Any future per-player lock must let developers through.
- New address (Vilhelm, 2026-11-02): the site moves to https://nomansland.github.io after Sunday's tournament. Vilhelm makes a GitHub organization nomansland and transfers the repo; then rename it nomansland.github.io, change the server's "Play at" note (server/src/index.js), drop snetendare.github.io from ALLOWED_ORIGINS some weeks later, add the new origin to the Google OAuth client, update README/docs links. Already done: nomansland.github.io is in ALLOWED_ORIGINS. Phones' saved data (tournament keys, settings, account session) does not follow to the new address.
- Waiting on Vilhelm (asked 2026-11-02): the D1 database id, D1 Edit on the deploy token, the Google OAuth client id, the GitHub secret DEV_EMAILS. Then: uncomment and fill the `[[d1_databases]]` block, add `GOOGLE_CLIENT_ID` to `[vars]` and to the page, push, and check `/account/guest` from the live page (WebFetch can't, it has no game Origin). The accounts tests then use the real block's binding locally (accountsConfig() skips the copy).
- Next (stage 3, after Sunday 2026-11-08): tournament joins and match history rows carry the player id; history per player.

## Hard rule this week

There is a real tournament on Sunday 2026-11-08 on server matches. Nothing that changes match play may be deployed after Saturday 2026-11-07: `src/referee.js`, the Room's act/ready/fight flow (`server/src/room.js`), the page's 'net' mode, and the tournament flow (`server/src/tour.js`, `src/tournament.js`). Accounts must be built beside them, not inside them, until after Sunday. If a step 5 change needs to touch any of these, do it after the tournament, or keep it behind a switch that is off and leaves today's code path unchanged.

Also: every deploy runs the server tests first. A push that touches `server/**` or the game rules deploys within minutes.

## Where things stand (steps 1-4 live)

1. Setup: `/health`, `/selftest`, WebSocket rooms with limits (`server/src/limits.js`) and an origin check (`ALLOWED_ORIGINS` in `server/wrangler.toml`).
2. Tournaments: `TourRoom` (`server/src/tour.js`). Organizer and players each get a secret key; ids are public, keys never are. Keys live on the phone in `phonebellum.tour.org.v2` / `phonebellum.tour.me.v2`.
3. Server as referee: `Room` (`server/src/room.js`) with the rules in `src/referee.js`. Friend matches give each side a secret key (`phonebellum.net.v1`). Tournament matches check the tournament key via `TourRoom.matchFor`.
4. Match history (finished 2026-11-02, live as `step4-2026-11-02`): `HistoryRoom` (`server/src/history.js`), one Durable Object named `all` with its own SQLite. The Room saves each round after the fight is sent, never awaited, failures only logged. `GET /history?limit=&before=` and `/history/<match>`, origin-checked, 60 reads/min per IP. The page's Match history reads it; phone-to-phone (PeerJS) matches still post to the Google Sheet. Rounds kept 1 year. Rows carry gamertags only for tournament matches; there are no player ids yet.

Still to confirm by hand (once): play one online round on the live site and open Match history; it should show that round under Online matches.

## Step 5 goal (from docs/SERVER.md, Accounts)

- Play as a guest first: the phone gets a random player id from the server plus a gamertag. No sign-up needed to try the game.
- One tap to keep it: "Sign in with Google" now. "Sign in with Apple" only when the iPhone app comes (the App Store requires it when Google sign-in is offered there). Maybe Discord later.
- The player id is our own; Google/Apple are keys linked to it. Signing in on a new phone finds the same player. A guest who signs in keeps their history.
- The server checks Google's signed ID token itself (Google's public keys, audience = our client id, issuer, expiry), then gives the phone its own session: random, stored hashed, expires, can be revoked. No passwords stored by us.
- Account deletion removes the login and personal data; past match results stay with an anonymous name.
- Security as in docs/SERVER.md: design for thousands of strangers. Per-IP limits on guest creation and sign-in, short sessions with rotation, tokens never in URLs, never logged.

## Decisions to make at the start (ask Vilhelm, with a recommendation)

1. Where accounts live. The plan says D1. Alternative: an `AccountsRoom` Durable Object with its own SQLite, like history (no new permissions). D1 is the better fit for lookups by Google subject id and by session hash across many players, and for joins with history later.
   If D1: Vilhelm creates it in the Cloudflare dashboard (Storage & Databases, D1, Create database, name `nml-accounts`), then sends you only the database id (it is not a secret). The deploy token in GitHub secret `CLOUDFLARE_API_TOKEN` is limited to Workers; for `wrangler d1 migrations apply` in the workflow it also needs "D1: Edit". He edits the token in the dashboard (My Profile, API Tokens, edit the token, add Account / D1 / Edit). Never ask him to paste a token or secret into the chat.
2. Google OAuth client. Vilhelm makes it in Google Cloud Console: create or pick a project, then APIs & Services, OAuth consent screen (External, app name No Mans Land, his email, scopes: openid, email, profile; publish when ready), then Credentials, Create credentials, OAuth client ID, type Web application, Authorized JavaScript origins `https://snetendare.github.io` plus `http://localhost:8766` and `http://127.0.0.1:8766` for tests. The client id is public and goes in `wrangler.toml` [vars] and the page; there is no client secret in this flow (Google Identity Services in the browser gives an ID token; the server verifies it).
3. What a guest id is tied to. Suggested: the server issues `{ playerId, session }` on first visit to anything that needs an identity (not on every page load), the phone keeps it in a new localStorage key (for example `phonebellum.account.v1`), and the gamertag moves from per-tournament to the account.
4. Whether tournament joins and match history use the player id before Sunday. Recommendation: no. Store accounts and sessions now; wire them into `TourRoom`, `Room` and history rows after the tournament.

## Suggested stages

1. Storage and API, headless: guest create, Google sign-in (verify the ID token; test with a locally signed token and a test key set, since tests can't reach Google), session check, rename gamertag, sign out, delete account. Rate limits and origin check like the rest. Tests in `server/test/` in the style of `history.test.js` (fresh ids, `startServer` from `test/harness.js`, which takes extra wrangler args).
2. Page: an account sheet from the start screen (guest name, Sign in with Google, sign out, delete). Loads Google's script only when the sheet opens. Browser test in `tools/tests/` like `server-history-ui.js`.
3. After Sunday: link tournament players and match history rows to player ids; a guest who signs in keeps their history.

At the end: PATCH-NOTES.md, docs/SERVER.md (step 5 entry, what is stored and for how long), README, and this file.

## Working notes

- Server tests: `cd server && npm test`. Browser tests need `python3 -m http.server 8766` (repo root), `node tools/peer-server.js` (9000), `cd server && npx wrangler dev --port 8798`; pages use `?server=http://127.0.0.1:8798`. Chromium: symlink `/opt/pw-browsers/chromium-1194` to `chromium-1243` and `chrome-linux` to `chrome-linux64`; install with `cd tools && npm i`.
- wrangler dev keeps storage between runs: use fresh codes and ids in tests. Stop it with `pkill -f "[w]orkerd"` and `pkill -f "[w]rangler dev"`, each in its own command (a pattern that also matches the command line it runs in kills that shell).
- The cloud shell can't reach workers.dev; use WebFetch for `/health`. `/history` refuses requests without the game's Origin, so it can't be checked from WebFetch.
- Server version string: `server/src/version.js` (bump to `step5-...` when it ships).
- Vilhelm's standing permissions: commit and push to main without asking; keep usage low (don't re-read docs needlessly, no screenshot tests for number changes).
