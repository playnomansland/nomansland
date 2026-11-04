// Accounts (step 5). See docs/SERVER.md, "Accounts".
//
// Players start as guests: POST /account/guest gives a random player id, a gamertag and a session. "Sign in with
// Google" links a Google account to the player (or finds the player it was linked to before, on any phone). The
// player id is ours; Google's subject id is only a key to it. We never store passwords, emails or names from Google.
//
// Storage: the D1 database bound as ACCOUNTS. Without that binding every account route answers 503 'accounts off',
// so the server runs exactly as before until the database exists. Without GOOGLE_CLIENT_ID only Google sign-in is off.
//
// Sessions: a random 32-byte token the phone keeps; we store only its SHA-256. A session lasts SESSION_DAYS from its
// last rotation; once it is older than ROTATE_MS, the next /account/me hands out a new token and the old one keeps
// working for GRACE_MS (in case the answer never reached the phone). Tokens travel only in the Authorization header,
// never in a URL, and are never logged.
//
// Routes (all POST with a JSON body, origin-checked, rate limited per IP):
//   /account/guest   { tag? }            -> { player, session }
//   /account/me      (auth)              -> { player, session? (only when rotated) }
//   /account/google  { credential } (auth optional) -> { player, session, linked: 'new'|'guest'|'existing' }
//   /account/tag     { tag } (auth)      -> { player }  (once a week, developers any time: 429 'too soon' { next })
//   /account/signout { all? } (auth)     -> { ok }
//   /account/delete  (auth)              -> { ok }  (login, sessions and gamertag removed; the id stays as a tombstone)
//   /account/title   { title } (auth)   -> { player }  (shows one of the player's titles under the gamertag; '' = none)
//   /account/ranked  { on } (auth, developer only) -> { on }  (switches ranked play on or off for everyone)
//   /account/skin    { skin, worn } (auth) -> { player }  (wear or take off a skin the player owns; see SKINS below)
//   /account/invite  (auth, Google accounts) -> { code, friends, rewarded }  (this player's invite link; see INVITE below)
//   /account/discord { code, redirect } (auth) -> { player }  (Discord check for the BABABABA title; see DISCORD below)
//   /account/puzzle  { k, army } (auth)  -> { player, won, solved }  (a tutorial puzzle's fight, replayed here; see PUZZLE below)
//   /account/bug     { text, version, match, info } (auth optional) -> { ok, url }  (a post in #bug-reports; see BUG below)
// guest, google and me also take { invite: CODE }: a new account made through a friend's invite link (INVITE).
//
// Month end (2026-11-03): the Worker's hourly cron (wrangler.toml [triggers], index.js scheduled) calls awardLegends,
// which gives the top LEGEND.top of the leaderboard the gold Legend title once a month has ended (Stockholm time).
//
// Ranked play (2026-11-02): a ranked friend's match is a best of 3 refereed by the Room (room.js). When a series is
// decided the Room calls recordSeries, which adds a win, tie or loss to each player's row in 'ranked'. GET /leaderboard
// (index.js -> leaderboard) reads it. Players need an account (a guest is enough) to play ranked: the phone sends its
// session in the match's hello message (never in the URL) and the Room checks it with sessionPlayer.
import { json, secret } from './limits.js';
import Game from '../../src/game.js';
import Ref from '../../src/referee.js';
import puzzleData from './puzzle-data.cjs';
const { PUZZLES, builtin } = puzzleData;

export const ACCOUNT = {
  SESSION_DAYS: 30,
  ROTATE_MS: 24 * 3600e3,
  GRACE_MS: 5 * 60e3,
  MAX_SESSIONS: 10,        // per player; the oldest go first
  BODY_BYTES: 8 * 1024,    // a Google ID token is about 1.2 KB
  // per IP: [count, window ms]. A tournament on one wifi shares an IP, so these leave room for a full room of friends.
  RATE: { guest: [20, 3600e3], google: [30, 600e3], other: [120, 60e3], bug: [5, 600e3] },
};
const DAY = 24 * 3600e3;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, tag TEXT, created INTEGER NOT NULL, seen INTEGER NOT NULL, deleted INTEGER, dev INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS logins (provider TEXT NOT NULL, subject TEXT NOT NULL, player TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS logins_player ON logins (player)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, player TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player)`,
  `CREATE TABLE IF NOT EXISTS hits (k TEXT PRIMARY KEY, start INTEGER NOT NULL, n INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ranked (player TEXT PRIMARY KEY, w INTEGER NOT NULL DEFAULT 0, t INTEGER NOT NULL DEFAULT 0, l INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)`,
  // titles won (2026-11-03): one row per player, title and period ('legend', '2026-11'), place = leaderboard rank
  `CREATE TABLE IF NOT EXISTS awards (player TEXT NOT NULL, title TEXT NOT NULL, period TEXT NOT NULL, place INTEGER, created INTEGER NOT NULL, PRIMARY KEY (player, title, period))`,
  // unit skins (2026-11-03): src 'grant' = owned; 'dev' = only a developer's on/off choice for a skin they have as a developer
  `CREATE TABLE IF NOT EXISTS skins (player TEXT NOT NULL, skin TEXT NOT NULL, src TEXT NOT NULL, worn INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, PRIMARY KEY (player, skin))`,
  // invite a friend (2026-11-03): each Google account's own invite code, and one row per friend who came through one
  `CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, player TEXT NOT NULL UNIQUE, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS referrals (friend TEXT PRIMARY KEY, inviter TEXT NOT NULL, created INTEGER NOT NULL, played INTEGER, done INTEGER)`,
  `CREATE INDEX IF NOT EXISTS referrals_inviter ON referrals (inviter)`,
  // Discord (2026-11-03): which Discord user gave which player the BABABABA title (one player per Discord user)
  `CREATE TABLE IF NOT EXISTS discord (subject TEXT PRIMARY KEY, player TEXT NOT NULL UNIQUE, created INTEGER NOT NULL)`,
  // tutorial puzzles (2026-11-03): one row per puzzle a player has solved (k = its index in src/puzzles.json)
  `CREATE TABLE IF NOT EXISTS puzzles (player TEXT NOT NULL, k INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (player, k))`,
];
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s)))
    // players.title (2026-11-02): the title picked to show; added to a table that may already exist
    // players.tag_changed (2026-11-02): when the gamertag was last changed (one change a week; developers any time)
    // players.legend (2026-11-03): how many months the player ended in the top 5 (counted from 'awards')
    // players.online (2026-11-03): online matches the player finished (countOnline); players.discord: when the Discord check passed
    // players.initiate (2026-11-03): when the last tutorial puzzle was solved (the Initiate title)
    .then(() => Promise.all(['title TEXT', 'tag_changed INTEGER', 'legend INTEGER', 'online INTEGER', 'discord INTEGER', 'initiate INTEGER'].map((c) => db.prepare('ALTER TABLE players ADD COLUMN ' + c).run().catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) throw e; }))))
    .catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------- titles (2026-11-02) ----------
// Shown under a gamertag. Earned, never bought; decided here from the player's row:
//   day1  "Day 1" (purple): every account made in the first week, up to the end of Sunday 2026-11-08 (Stockholm time)
//   dev   "DEV" (pink): developer accounts (the server's dev column)
//   legend "Legend" (gold, 2026-11-03): ended a month in the top 5 of the leaderboard (players.legend > 0). Kept for good.
//   bababa "BABABABA" (orange, 2026-11-03): joined the game's Discord server, checked with Discord (players.discord).
//   initiate "Initiate" (light blue, 2026-11-03): solved every tutorial puzzle (players.initiate; see PUZZLE below).
// The player picks which one shows (players.title); none picked = the first earned one in the order DEV, Legend,
// BABABABA, Initiate, Day 1.
// Gamertags: one change a week (TAG_EVERY), any time for developers. Naming a brand-new account (in its first
// TAG_FRESH, e.g. sign-up's gamertag after Google) doesn't count.
export const TAG_EVERY = 7 * 24 * 3600e3;
const TAG_FRESH = 10 * 60e3;
const tagNext = (p) => (p && !p.dev && p.tag_changed ? p.tag_changed + TAG_EVERY : 0);
export const DAY1_END = Date.UTC(2026, 10, 8, 23, 0, 0); // Monday 2026-11-09 00:00 in Stockholm
export function titlesOf(p) {
  const out = [];
  if (p && p.dev) out.push('dev');
  if (p && p.legend > 0) out.push('legend');
  if (p && p.discord) out.push('bababa');
  if (p && p.initiate) out.push('initiate');
  if (p && p.created < DAY1_END) out.push('day1');
  return out;
}
export function titleShown(p) {
  const have = titlesOf(p);
  if (p && p.title === 'none') return '';
  return p && have.includes(p.title) ? p.title : have[0] || '';
}

// ---------- unit skins (2026-11-03) ----------
// A skin changes how one unit looks (src/shapes.js Shapes.SKINS has the same ids and the looks); never its stats.
// Skins are given, never bought. SKIN_GRANTS gives a skin to the account with that gamertag: the first time a player
// with that tag is found (the hourly cron and every /account/me check), the oldest such account gets it for good and
// config 'grant:<skin>:<tag>' records that it is done, so someone who takes the name later gets nothing. Developers have
// every skin (off until they wear it). Owned skins are worn by default; POST /account/skin { skin, worn } switches one.
// A match's Room puts the worn skins of each side in its players list (sessionPlayer), so the other phone draws them.
// Owned = a row with src 'grant' (SKIN_GRANTS) or 'invite' (INVITE: the reward for inviting a friend).
export const SKINS = ['brute-champion', 'golem-aquamarine'];
export const SKIN_GRANTS = [{ skin: 'brute-champion', tag: 'Gubbolas Cage' }];
let grantsDone = false;
export async function grantSkins(env, now = Date.now()) {
  const db = env.ACCOUNTS;
  if (grantsDone || !db) return;
  await ensureSchema(db);
  let left = 0;
  for (const g of SKIN_GRANTS) {
    const key = `grant:${g.skin}:${g.tag}`;
    if (await db.prepare('SELECT 1 FROM config WHERE k = ?').bind(key).first()) continue;
    const p = await db.prepare('SELECT id FROM players WHERE deleted IS NULL AND lower(tag) = lower(?) ORDER BY created LIMIT 1').bind(g.tag).first();
    if (!p) { left++; continue; }
    await db.batch([
      db.prepare(`INSERT INTO skins (player, skin, src, worn, created) VALUES (?1, ?2, 'grant', 1, ?3) ON CONFLICT (player, skin) DO UPDATE SET src = 'grant'`).bind(p.id, g.skin, now),
      db.prepare('INSERT OR REPLACE INTO config (k, v) VALUES (?, ?)').bind(key, p.id),
    ]);
  }
  if (!left) grantsDone = true;
}
// the skins a player owns, [{ id, worn }]: granted rows, plus every skin for a developer
async function skinsOf(db, id, dev) {
  const rows = (await db.prepare('SELECT skin, src, worn FROM skins WHERE player = ?').bind(id).all()).results;
  return SKINS.filter((k) => dev || rows.some((r) => r.skin === k && r.src !== 'dev'))
    .map((k) => { const r = rows.find((x) => x.skin === k); return { id: k, worn: r ? !!r.worn : !dev }; });
}
const wornSkins = async (db, id, dev) => (await skinsOf(db, id, dev)).filter((k) => k.worn).map((k) => k.id);

// ---------- invite a friend (2026-11-03) ----------
// A Google-signed account (a confirmed account; guests can't invite) gets an invite code: the link ?invite=CODE.
// A friend who opens it and makes a NEW account (guest or Google, sent as { invite } with guest, google or me) is
// tied to the inviter in 'referrals', once. "New" = made in the last INVITE.claimMs and no online match finished
// yet, so an old account can't be counted as invited. The reward, the limited Aquamarine Ether Golem skin, goes to
// the inviter once a friend has (1) signed in with Google (a confirmed account too, so one person can't farm it with
// throwaway guests) and (2) finished an online match (countOnline: a server match against another phone that
// lasted at least INVITE.minFights fights and that the friend didn't leave). Settled (settleReferral) whenever
// either happens last; given once per inviter, however many friends come.
export const INVITE = { skin: 'golem-aquamarine', claimMs: 24 * 3600e3, minFights: 3, len: 6, letters: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' };
const cleanInvite = (c) => (typeof c === 'string' && new RegExp(`^[${INVITE.letters}]{${INVITE.len}}$`).test(c.toUpperCase()) ? c.toUpperCase() : null);
function newInviteCode() {
  const a = new Uint8Array(INVITE.len); crypto.getRandomValues(a);
  return [...a].map((b) => INVITE.letters[b % INVITE.letters.length]).join('');
}
const hasGoogle = async (db, id) => !!(await db.prepare(`SELECT 1 FROM logins WHERE player = ? AND provider = 'google'`).bind(id).first());
async function inviteCodeOf(db, id, now) {
  const r = await db.prepare('SELECT code FROM invites WHERE player = ?').bind(id).first();
  if (r) return r.code;
  for (let i = 0; i < 5; i++) {
    const code = newInviteCode();
    const ok = await db.prepare('INSERT OR IGNORE INTO invites (code, player, created) VALUES (?, ?, ?) RETURNING code').bind(code, id, now).first();
    if (ok) return ok.code;
    const again = await db.prepare('SELECT code FROM invites WHERE player = ?').bind(id).first(); // made at the same moment by another request
    if (again) return again.code;
  }
  throw new Error('no invite code');
}
// ties a new account to the inviter behind code; returns true when it did
async function claimInvite(db, friend, code, now) {
  code = cleanInvite(code);
  if (!code) return false;
  const inv = await db.prepare('SELECT i.player FROM invites i JOIN players p ON p.id = i.player WHERE i.code = ? AND p.deleted IS NULL').bind(code).first();
  if (!inv || inv.player === friend) return false;
  const f = await db.prepare('SELECT created, online, deleted FROM players WHERE id = ?').bind(friend).first();
  if (!f || f.deleted || now - f.created > INVITE.claimMs || f.online > 0) return false;
  if (!(await hasGoogle(db, inv.player))) return false;
  const r = await db.prepare('INSERT OR IGNORE INTO referrals (friend, inviter, created) VALUES (?, ?, ?) RETURNING friend').bind(friend, inv.player, now).first();
  return !!r;
}
// gives the reward if this friend's referral is now complete (see INVITE)
async function settleReferral(db, friend, now) {
  const r = await db.prepare('SELECT inviter, played, done FROM referrals WHERE friend = ?').bind(friend).first();
  if (!r || r.done || !r.played) return false;
  if (!(await hasGoogle(db, friend)) || !(await hasGoogle(db, r.inviter))) return false;
  const inv = await db.prepare('SELECT deleted FROM players WHERE id = ?').bind(r.inviter).first();
  if (!inv || inv.deleted) return false;
  await db.batch([
    db.prepare('UPDATE referrals SET done = ? WHERE friend = ? AND done IS NULL').bind(now, friend),
    db.prepare(`INSERT INTO skins (player, skin, src, worn, created) VALUES (?1, ?2, 'invite', 1, ?3) ON CONFLICT (player, skin) DO UPDATE SET src = CASE WHEN src = 'dev' THEN 'invite' ELSE src END`).bind(r.inviter, INVITE.skin, now),
  ]);
  return true;
}
// Called by a match Room when an online match ends. players: [side 0's player id or null, side 1's]; left: the side
// that forfeited, or null; fights: fights played. A side counts when it has an account, didn't leave, the other phone
// isn't the same player, and the match lasted INVITE.minFights fights.
export async function countOnline(env, players, left, fights) {
  const db = env.ACCOUNTS;
  if (!db || !Array.isArray(players) || !(fights >= INVITE.minFights)) return;
  await ensureSchema(db);
  const now = Date.now();
  for (const sd of [0, 1]) {
    const id = players[sd];
    if (!id || left === sd || players[1 - sd] === id) continue;
    await db.batch([
      db.prepare('UPDATE players SET online = COALESCE(online, 0) + 1 WHERE id = ?').bind(id),
      db.prepare('UPDATE referrals SET played = ? WHERE friend = ? AND played IS NULL').bind(now, id),
    ]);
    await settleReferral(db, id, now);
  }
}
async function inviteOut(db, id, now) {
  const code = await inviteCodeOf(db, id, now);
  const rows = (await db.prepare(`SELECT r.friend, r.played, r.done, p.tag, p.deleted FROM referrals r JOIN players p ON p.id = r.friend WHERE r.inviter = ? ORDER BY r.created DESC LIMIT 50`).bind(id).all()).results;
  const friends = [];
  for (const r of rows) if (!r.deleted) friends.push({ tag: r.tag || 'Player', google: await hasGoogle(db, r.friend), played: !!r.played, done: !!r.done });
  const own = await db.prepare(`SELECT 1 FROM skins WHERE player = ? AND skin = ? AND src = 'invite'`).bind(id, INVITE.skin).first();
  return { code, friends, rewarded: !!own, skin: INVITE.skin, minFights: INVITE.minFights };
}

// ---------- Discord: the BABABABA title (2026-11-03) ----------
// The player joins the game's Discord server, then lets the page ask Discord who they are (OAuth2, scopes identify and
// guilds; the page sends the one-time code here). The server swaps the code for a token (with DISCORD_CLIENT_SECRET,
// a Cloudflare secret), reads the user and their servers, and gives the title only if DISCORD_GUILD_ID is one of them.
// One Discord user gives the title to one player (table 'discord'). Discord's token is used once and never stored.
// Off (503 'discord off') until DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and DISCORD_GUILD_ID are all set.
// DISCORD_INVITE (the server's invite link) is passed on to the page by /account/me. DISCORD_API is for tests only.
export const DISCORD = { title: 'bababa', api: 'https://discord.com/api/v10' };
const discordOn = (env) => !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_GUILD_ID);
const discordApi = (env) => (env.DISCORD_API && /^http:\/\/127\.0\.0\.1:\d+$/.test(env.DISCORD_API) ? env.DISCORD_API : DISCORD.api);
const discordInfo = (env) => (env.DISCORD_CLIENT_ID && env.DISCORD_GUILD_ID ? { clientId: env.DISCORD_CLIENT_ID, invite: env.DISCORD_INVITE || '', check: discordOn(env), bugs: bugOn(env) } : null);
async function discordCheck(env, code, redirect) {
  const api = discordApi(env);
  const tok = await fetch(`${api}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET }) });
  if (!tok.ok) return { error: 'discord code' };
  const t = await tok.json();
  if (!t || typeof t.access_token !== 'string') return { error: 'discord code' };
  const auth = { Authorization: 'Bearer ' + t.access_token };
  const [u, g] = await Promise.all([fetch(`${api}/users/@me`, { headers: auth }), fetch(`${api}/users/@me/guilds`, { headers: auth })]);
  if (!u.ok || !g.ok) return { error: 'discord unavailable' };
  const user = await u.json(), guilds = await g.json();
  if (!user || typeof user.id !== 'string' || !/^\d{1,24}$/.test(user.id)) return { error: 'discord unavailable' };
  return { subject: user.id, member: Array.isArray(guilds) && guilds.some((x) => x && String(x.id) === String(env.DISCORD_GUILD_ID)) };
}

const enc = new TextEncoder();
// ---------- bug reports (2026-11-04) ----------
// POST /account/bug { text, version, match, info } -> a new post in the Discord forum #bug-reports, made through a webhook
// on that channel (BUG_WEBHOOK, a Cloudflare secret the deploy workflow copies from the GitHub secret DISCORD_BUG_WEBHOOK).
// The post's title is the first line of the player's text; the body has the game version, the match id and the rest of
// `info` filled in. A session is optional (it names the player). No pings (allowed_mentions empty). Per IP: 5 per 10 min.
// BUG_TAG (optional var): a forum tag id put on every post, for a forum that requires tags.
// Off (503 'bugs off') until BUG_WEBHOOK is set; the page then copies the report and opens the Discord server instead.
export const BUG = { textMax: 1500, titleMax: 90, fieldMax: 160, info: ['mode', 'round', 'phase', 'map', 'board', 'device', 'screen', 'page'] };
const BUG_HOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
const BUG_HOOK_TEST = /^http:\/\/127\.0\.0\.1:\d+\/api\/webhooks\/\d+\/[\w-]+$/;
const bugField = (v, max = BUG.fieldMax) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export function bugPost(body, who) {
  const text = String(body.text == null ? '' : body.text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, BUG.textMax);
  if (text.length < 3) return null;
  const first = text.split('\n')[0].replace(/\s+/g, ' ').trim();
  const title = (first.length > BUG.titleMax ? first.slice(0, BUG.titleMax - 1).trimEnd() + '…' : first) || 'Bug report';
  const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info : {};
  const line = (k, v) => (v ? `${k}: \`${v}\`` : null);
  const facts = [
    line('Version', bugField(body.version, 60) || 'unknown'),
    line('Match', bugField(body.match, 60) || 'none'),
    ...BUG.info.map((k) => line(k[0].toUpperCase() + k.slice(1), bugField(info[k]))),
    who ? line('Player', `${bugField(who.tag, 40)} (${who.player})`) : line('Player', 'not logged in'),
  ].filter(Boolean);
  return { title, content: (text + '\n\n' + facts.join('\n')).slice(0, 2000) };
}
const bugOn = (env) => BUG_HOOK.test(env.BUG_WEBHOOK || '') || BUG_HOOK_TEST.test(env.BUG_WEBHOOK || '');
async function bugReport(db, request, body, env, cors) {
  const hook = env.BUG_WEBHOOK || '';
  if (!bugOn(env)) return json({ error: 'bugs off' }, 503, cors);
  const post = bugPost(body, await auth(db, request));
  if (!post) return json({ error: 'too short' }, 400, cors);
  const msg = { thread_name: post.title, content: post.content, username: 'Bug report', allowed_mentions: { parse: [] } };
  if (/^\d{5,25}$/.test(env.BUG_TAG || '')) msg.applied_tags = [env.BUG_TAG];
  let res;
  try { res = await fetch(hook + '?wait=true', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) }); }
  catch (e) { return json({ error: 'discord unavailable' }, 502, cors); }
  if (!res.ok) { console.warn('bug report', res.status, (await res.text().catch(() => '')).slice(0, 300)); return json({ error: 'discord', code: res.status }, 502, cors); }
  const out = await res.json().catch(() => ({}));
  const thread = /^\d+$/.test(String(out.channel_id || '')) ? String(out.channel_id) : '';
  const guild = /^\d+$/.test(env.DISCORD_GUILD_ID || '') ? env.DISCORD_GUILD_ID : '';
  return json({ ok: true, url: guild && thread ? `https://discord.com/channels/${guild}/${thread}` : '' }, 200, cors);
}

async function sha256(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Gamertags: 2-16 letters (any language), digits, space, _ . -; spaces squeezed.
export function cleanTag(t) {
  if (typeof t !== 'string') return null;
  const s = t.normalize('NFC').replace(/\s+/g, ' ').trim();
  return /^[\p{L}\p{N} _.-]{2,16}$/u.test(s) ? s : null;
}
const guestTag = () => 'Guest ' + (1000 + Math.floor(Math.random() * 9000));
const newPlayerId = () => 'p' + secret(8);   // 16 hex digits: public, like tournament player ids

// ---------- Google ID tokens ----------
const GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
let jwks = { url: '', keys: null, until: 0 };

function b64urlBytes(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function googleKeys(env, force) {
  // GOOGLE_JWKS_URL is for tests only (a local key server); production always uses Google's.
  let url = GOOGLE_CERTS;
  if (env.GOOGLE_JWKS_URL && /^http:\/\/127\.0\.0\.1:\d+\//.test(env.GOOGLE_JWKS_URL)) url = env.GOOGLE_JWKS_URL;
  if (!force && jwks.url === url && jwks.keys && Date.now() < jwks.until) return jwks.keys;
  let res;
  for (let i = 0; i < 2 && !(res && res.ok); i++) { try { res = await fetch(url); } catch (e) { res = null; } }
  if (!res || !res.ok) { const e = new Error('google keys unavailable'); e.unavailable = true; throw e; }
  const age = +((res.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600;
  const body = await res.json();
  jwks = { url, keys: Array.isArray(body.keys) ? body.keys : [], until: Date.now() + Math.min(age, 6 * 3600) * 1000 };
  return jwks.keys;
}

// Returns the token's claims if Google signed it for our client and it is current; throws otherwise.
export async function verifyGoogle(token, env) {
  if (typeof token !== 'string' || token.length > 4096) throw new Error('bad token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('bad token');
  let head, claims;
  try { head = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { throw new Error('bad token'); }
  if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error('bad alg');
  let jwk = (await googleKeys(env)).find((k) => k.kid === head.kid);
  if (!jwk) jwk = (await googleKeys(env, true)).find((k) => k.kid === head.kid);   // Google rotated its keys
  if (!jwk || jwk.kty !== 'RSA') throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  const now = Date.now() / 1000;
  if (!GOOGLE_ISS.includes(claims.iss)) throw new Error('bad issuer');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('bad audience');
  if (!(claims.exp > now - 60)) throw new Error('expired');
  if (claims.iat && claims.iat > now + 300) throw new Error('issued in the future');
  if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(claims.sub)) throw new Error('bad subject');
  return claims;
}

// ---------- storage helpers ----------
async function hit(db, bucket, ip, env) {
  let [max, win] = ACCOUNT.RATE[bucket];
  if (bucket === 'google' && +env.ACCOUNT_GOOGLE_RATE) max = +env.ACCOUNT_GOOGLE_RATE;   // tests only
  const now = Date.now();
  // the IP only as a hash, and only for the length of the window (old rows are swept on guest creation)
  const k = bucket + ':' + (await sha256('nml-ip:' + (ip || 'none'))).slice(0, 32);
  const row = await db.prepare(
    `INSERT INTO hits (k, start, n) VALUES (?1, ?2, 1)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN start < ?3 THEN 1 ELSE n + 1 END, start = CASE WHEN start < ?3 THEN ?2 ELSE start END
     RETURNING n`).bind(k, now, now - win).first();
  return row.n <= max;
}

async function newSession(db, player) {
  const token = secret(32);
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO sessions (hash, player, created, expires) VALUES (?, ?, ?, ?)').bind(await sha256(token), player, now, now + ACCOUNT.SESSION_DAYS * DAY),
    // keep the newest MAX_SESSIONS (this one included)
    db.prepare(`DELETE FROM sessions WHERE player = ?1 AND hash NOT IN (SELECT hash FROM sessions WHERE player = ?1 ORDER BY created DESC LIMIT ?2)`).bind(player, ACCOUNT.MAX_SESSIONS),
  ]);
  return token;
}

async function auth(db, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([0-9a-f]{64})$/);
  if (!m) return null;
  const hash = await sha256(m[1]);
  const s = await db.prepare(
    `SELECT s.hash, s.player, s.created, s.expires, p.tag, p.deleted FROM sessions s JOIN players p ON p.id = s.player WHERE s.hash = ?`).bind(hash).first();
  if (!s || s.expires < Date.now() || s.deleted) return null;
  return s;
}

// ---------- ranked play and the leaderboard (used by room.js and index.js) ----------
// The player behind a session token (sent by a phone in a match's hello), or null.
export async function sessionPlayer(env, token) {
  const db = env.ACCOUNTS;
  if (!db || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  await ensureSchema(db);
  const s = await db.prepare(`SELECT s.player, s.expires, p.tag, p.deleted, p.dev FROM sessions s JOIN players p ON p.id = s.player WHERE s.hash = ?`).bind(await sha256(token)).first();
  if (!s || s.expires < Date.now() || s.deleted) return null;
  const p = await db.prepare('SELECT created, dev, title, legend, discord, initiate FROM players WHERE id = ?').bind(s.player).first();
  let skins = [];
  try { skins = await wornSkins(db, s.player, !!s.dev); } catch (e) { skins = []; } // a look only: never in the way of playing
  return { id: s.player, tag: s.tag || 'Player', dev: !!s.dev, title: titleShown(p), skins };
}
// Ranked play is on unless a developer switched it off (config 'ranked' = 'off'). No database: off.
export async function rankedOn(env) {
  const db = env.ACCOUNTS;
  if (!db) return false;
  await ensureSchema(db);
  const r = await db.prepare(`SELECT v FROM config WHERE k = 'ranked'`).first();
  return !(r && r.v === 'off');
}
// A decided best of 3: ids = [side 0's player, side 1's], winner = 0 | 1 | -1 (a tie).
export async function recordSeries(env, ids, winner) {
  const db = env.ACCOUNTS;
  if (!db || !ids || !ids[0] || !ids[1] || ids[0] === ids[1]) return;
  await ensureSchema(db);
  const now = Date.now();
  const row = (id, col) => db.prepare(`INSERT INTO ranked (player, ${col}, updated) VALUES (?1, 1, ?2) ON CONFLICT (player) DO UPDATE SET ${col} = ${col} + 1, updated = ?2`).bind(id, now);
  const col = (sd) => winner === -1 ? 't' : winner === sd ? 'w' : 'l';
  await db.batch([row(ids[0], col(0)), row(ids[1], col(1))]);
}
// The leaderboard's order (2026-11-03): a score of 75% wins and 25% win share. Wins count against the most wins on
// the board (the leader in wins gets the full 75); the win share counts a tie as half a win. Then wins, then fewest
// losses. score is 0 to 100. Deleted accounts drop off.
export const BOARD_WEIGHTS = { wins: 0.75, share: 0.25 };
const BOARD_SQL = `WITH b AS (SELECT p.id, p.tag, p.created, p.dev, p.title, p.legend, p.discord, p.initiate, r.w, r.t, r.l FROM ranked r JOIN players p ON p.id = r.player
    WHERE p.deleted IS NULL AND (r.w + r.t + r.l) > 0), top AS (SELECT MAX(w) AS mw FROM b)
  SELECT b.*, 100.0 * (${BOARD_WEIGHTS.wins} * (CASE WHEN top.mw > 0 THEN b.w * 1.0 / top.mw ELSE 0 END)
    + ${BOARD_WEIGHTS.share} * (b.w + 0.5 * b.t) * 1.0 / (b.w + b.t + b.l)) AS score
  FROM b, top ORDER BY score DESC, b.w DESC, b.l ASC`;

// ---------- Legend: the top 5 when a month ends (2026-11-03) ----------
// Months are Stockholm months ('2026-11'). LEGEND.first is the first month that counts (ranked play began 2026-11-02).
// Run by the hourly cron: once the clock is past a month's end and that month hasn't been awarded (config
// 'legend_month'), the top LEGEND.top of the leaderboard as it stands get an 'awards' row and players.legend is
// recounted. Safe to run any number of times: the rows are keyed by player and month. The board itself isn't reset.
export const LEGEND = { top: 5, first: '2026-11' };
const stockholm = (t) => {
  const o = {};
  for (const x of new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', year: 'numeric', month: 'numeric', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t))) o[x.type] = +x.value;
  return o;
};
export const monthKey = (t) => { const s = stockholm(t); return s.year + '-' + String(s.month).padStart(2, '0'); };
const prevKey = (k) => { const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
// when the month that t is in ends: 00:00 on the 1st of the next month in Stockholm (UTC midnight there is 01:00 or 02:00)
export function monthEnd(t) {
  const s = stockholm(t), at = Date.UTC(s.month === 12 ? s.year + 1 : s.year, s.month % 12, 1);
  return at - stockholm(at).hour * 3600e3;
}
export async function awardLegends(env, now = Date.now()) {
  const db = env.ACCOUNTS;
  if (!db) return null;
  await ensureSchema(db);
  const month = prevKey(monthKey(now));
  if (month < LEGEND.first) return null;
  const done = await db.prepare(`SELECT v FROM config WHERE k = 'legend_month'`).first();
  if (done && done.v >= month) return null;
  const top = (await db.prepare(`${BOARD_SQL} LIMIT ?`).bind(LEGEND.top).all()).results;
  await db.batch([
    ...top.map((r, i) => db.prepare(`INSERT OR IGNORE INTO awards (player, title, period, place, created) VALUES (?, 'legend', ?, ?, ?)`).bind(r.id, month, i + 1, now)),
    ...top.map((r) => db.prepare(`UPDATE players SET legend = (SELECT COUNT(*) FROM awards WHERE player = ?1 AND title = 'legend') WHERE id = ?1`).bind(r.id)),
    db.prepare(`INSERT OR REPLACE INTO config (k, v) VALUES ('legend_month', ?)`).bind(month),
  ]);
  return { month, players: top.map((r) => r.id) };
}

// GET /leaderboard: every ranked player with a name, best first (score: 75% wins, 25% win share; see BOARD_SQL). Deleted
// accounts drop off. Ties count as half a win in the share.
export async function leaderboard(env, cors) {
  const db = env.ACCOUNTS;
  if (!db) return json({ on: false, rows: [] }, 200, cors);
  try {
    await ensureSchema(db);
    const on = await rankedOn(env);
    const res = await db.prepare(`${BOARD_SQL} LIMIT 200`).all();
    return json({ on, legend: { top: LEGEND.top, ends: monthEnd(Date.now()) }, rows: res.results.map((r) => ({ id: r.id, tag: r.tag || 'Player', title: titleShown(r), w: r.w, t: r.t, l: r.l, score: Math.round((+r.score || 0) * 10) / 10 })) }, 200, { ...cors, 'cache-control': 'no-store' });
  } catch (e) {
    console.warn('leaderboard', e && e.message);
    return json({ error: 'leaderboard unavailable' }, 503, cors);
  }
}

async function playerOut(db, id) {
  const p = await db.prepare('SELECT id, tag, created, dev, title, tag_changed, legend, discord, initiate FROM players WHERE id = ?').bind(id).first();
  const logins = await db.prepare('SELECT provider FROM logins WHERE player = ?').bind(id).all();
  return { id: p.id, tag: p.tag, created: p.created, google: logins.results.some((r) => r.provider === 'google'), dev: !!p.dev, titles: titlesOf(p), title: titleShown(p), tagNext: tagNext(p) > Date.now() ? tagNext(p) : 0, skins: await skinsOf(db, id, !!p.dev), discord: !!p.discord, puzzles: (await db.prepare('SELECT k FROM puzzles WHERE player = ? ORDER BY k').bind(id).all()).results.map((r) => r.k) };
}

// Developer mode: a Google account whose verified email is in the secret DEV_EMAILS (comma separated; a Cloudflare
// secret, never in the repo). Decided by the server at every Google sign-in, so removing an email takes it away at
// that account's next sign-in. The email is compared and dropped, never stored. Guests are never developers.
// Every feature that is ever locked or gated per player must let a player with dev: true through.
function isDevEmail(claims, env) {
  if (!env.DEV_EMAILS || claims.email_verified !== true || typeof claims.email !== 'string') return false;
  const list = env.DEV_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(claims.email.trim().toLowerCase());
}

// ---------- tutorial puzzles: the Initiate title (2026-11-03) ----------
// The page's puzzles (src/puzzles.json, PUZZLES there too) are one fight each against an army in plain sight. A win
// is saved on the phone, and sent here as the player's army: { k, army: [[unit name, col, row], ...] }. The server sets
// the fight up exactly as the page's startPuzzle does (the built-in units on the Old standard board, the enemy's
// squads as if from an earlier round, the puzzle's gold and shop) and plays it with the same referee, so a phone can't
// claim a win it didn't get. One row per solved puzzle (table 'puzzles'); solving the last one sets players.initiate.
export const PUZZLE = { title: 'initiate', count: PUZZLES.length, maxArmy: 12 };
export function puzzleWon(k, army) {
  const P = PUZZLES[k];
  if (!P || !Array.isArray(army) || army.length > PUZZLE.maxArmy) return false;
  const { units, matrix } = builtin();
  const ix = (n) => units.findIndex((u) => u.name === n);
  const m = Game.createMatch(units, matrix, 1, 'standard');
  m.packages = [[], []];
  for (const n of P.shop) m.unlocks[0][ix(n)] = 1;
  for (const [n] of P.foe) m.unlocks[1][ix(n)] = 1;
  m.gold = [P.gold, 9999];
  for (const [n, c, r] of P.foe) { const q = Game.place(m, 1, ix(n), c, r); if (!q) return false; q.round = 0; }
  for (const a of army) {
    if (!Array.isArray(a) || a.length !== 3 || typeof a[0] !== 'string' || !P.shop.includes(a[0])) return false;
    const c = a[1], r = a[2];
    if (!Number.isInteger(c) || !Number.isInteger(r)) return false;
    if (!Game.place(m, 0, ix(a[0]), c, r)) return false;   // not in the zone, no gold, a taken tile
  }
  if (!m.armies[0].length) return false;
  const f = Ref.fight(m);
  return f.summary.winner === 0 && !f.summary.timeout;
}

// ---------- the route handler ----------
export async function handleAccount(request, env, cors) {
  const db = env.ACCOUNTS;
  if (!db) return json({ error: 'accounts off' }, 503, cors);
  const route = new URL(request.url).pathname.replace(/^\/account\/?/, '').replace(/\/$/, '');
  if (!['guest', 'me', 'google', 'tag', 'signout', 'delete', 'ranked', 'title', 'skin', 'invite', 'discord', 'puzzle', 'bug'].includes(route)) return json({ error: 'not found' }, 404, cors);
  if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);

  let body = {};
  const text = await request.text();
  if (text.length > ACCOUNT.BODY_BYTES) return json({ error: 'too big' }, 413, cors);
  if (text) { try { body = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, cors); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'not an object' }, 400, cors);

  try {
    await ensureSchema(db);
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const bucket = route === 'guest' ? 'guest' : route === 'google' ? 'google' : route === 'bug' ? 'bug' : 'other';
    if (!(await hit(db, bucket, ip, env))) return json({ error: 'slow down' }, 429, cors);
    const now = Date.now();

    if (route === 'bug') return await bugReport(db, request, body, env, cors);

    if (route === 'guest') {
      const tag = body.tag == null ? guestTag() : cleanTag(body.tag);
      if (!tag) return json({ error: 'bad tag' }, 400, cors);
      const id = newPlayerId();
      await db.prepare('INSERT INTO players (id, tag, created, seen) VALUES (?, ?, ?, ?)').bind(id, tag, now, now).run();
      if (body.invite) await claimInvite(db, id, body.invite, now);
      const session = await newSession(db, id);
      if (Math.random() < 0.05) await db.prepare('DELETE FROM hits WHERE start < ?').bind(now - DAY).run();
      return json({ player: await playerOut(db, id), session }, 200, cors);
    }

    if (route === 'google') {
      if (!env.GOOGLE_CLIENT_ID) return json({ error: 'google off' }, 503, cors);
      let claims;
      try { claims = await verifyGoogle(body.credential, env); }
      catch (e) {
        if (e.unavailable) return json({ error: 'google unavailable' }, 503, cors);
        return json({ error: 'google token', why: e.message }, 401, cors);
      }
      const me = await auth(db, request);   // optional: the guest who is signing in
      const known = await db.prepare(`SELECT l.player FROM logins l JOIN players p ON p.id = l.player WHERE l.provider = 'google' AND l.subject = ? AND p.deleted IS NULL`).bind(claims.sub).first();
      let id, linked;
      if (known) { id = known.player; linked = 'existing'; }
      else {
        const meHasLogin = me && (await db.prepare('SELECT 1 FROM logins WHERE player = ?').bind(me.player).first());
        if (me && !meHasLogin) { id = me.player; linked = 'guest'; }
        else {
          id = newPlayerId(); linked = 'new';
          await db.prepare('INSERT INTO players (id, tag, created, seen) VALUES (?, ?, ?, ?)').bind(id, guestTag(), now, now).run();
        }
        // a deleted account's old login row may still be there: replace it
        await db.prepare(`INSERT OR REPLACE INTO logins (provider, subject, player, created) VALUES ('google', ?, ?, ?)`).bind(claims.sub, id, now).run();
      }
      // the guest session that signed in is done either way; the phone gets a session for the signed-in player
      if (me) await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(me.hash).run();
      await db.prepare('UPDATE players SET seen = ?, dev = ? WHERE id = ?').bind(now, isDevEmail(claims, env) ? 1 : 0, id).run();
      // invite a friend: a new account through a link, and a friend who now has a confirmed account may complete it
      if (body.invite && linked !== 'existing') await claimInvite(db, id, body.invite, now);
      await settleReferral(db, id, now);
      const session = await newSession(db, id);
      return json({ player: await playerOut(db, id), session, linked }, 200, cors);
    }

    const me = await auth(db, request);
    if (!me) return json({ error: 'signed out' }, 401, cors);

    if (route === 'title') {
      const t = typeof body.title === 'string' ? body.title : '';
      const p = await db.prepare('SELECT created, dev, legend, discord, initiate FROM players WHERE id = ?').bind(me.player).first();
      if (t && !titlesOf(p).includes(t)) return json({ error: 'not your title' }, 400, cors);
      await db.prepare('UPDATE players SET title = ? WHERE id = ?').bind(t || 'none', me.player).run();
      return json({ player: await playerOut(db, me.player) }, 200, cors);
    }
    if (route === 'skin') {
      const k = typeof body.skin === 'string' ? body.skin : '', p = await db.prepare('SELECT dev FROM players WHERE id = ?').bind(me.player).first();
      if (!(await skinsOf(db, me.player, !!(p && p.dev))).some((x) => x.id === k)) return json({ error: 'not your skin' }, 400, cors);
      await db.prepare(`INSERT INTO skins (player, skin, src, worn, created) VALUES (?1, ?2, 'dev', ?3, ?4) ON CONFLICT (player, skin) DO UPDATE SET worn = ?3`).bind(me.player, k, body.worn ? 1 : 0, now).run();
      return json({ player: await playerOut(db, me.player) }, 200, cors);
    }
    if (route === 'ranked') {
      // a developer switches ranked play on or off for everyone (the server's own dev flag, never the phone's word)
      const p = await db.prepare('SELECT dev FROM players WHERE id = ?').bind(me.player).first();
      if (!p || !p.dev) return json({ error: 'not a developer' }, 403, cors);
      if (typeof body.on === 'boolean') await db.prepare(`INSERT OR REPLACE INTO config (k, v) VALUES ('ranked', ?)`).bind(body.on ? 'on' : 'off').run();
      return json({ on: await rankedOn(env) }, 200, cors);
    }
    if (route === 'invite') {
      if (!(await hasGoogle(db, me.player))) return json({ error: 'google needed' }, 403, cors);
      return json(await inviteOut(db, me.player, now), 200, cors);
    }
    if (route === 'discord') {
      if (!discordOn(env)) return json({ error: 'discord off' }, 503, cors);
      const code = typeof body.code === 'string' && /^[\w-]{6,128}$/.test(body.code) ? body.code : '';
      const redirect = typeof body.redirect === 'string' && body.redirect.length < 300 ? body.redirect : '';
      let okRedirect = false;
      try { const u = new URL(redirect); okRedirect = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).includes(u.origin) && !u.search && !u.hash; } catch (e) {}
      if (!code || !okRedirect) return json({ error: 'bad request' }, 400, cors);
      let r;
      try { r = await discordCheck(env, code, redirect); } catch (e) { r = { error: 'discord unavailable' }; }
      if (r.error) return json({ error: r.error }, r.error === 'discord code' ? 401 : 503, cors);
      if (!r.member) return json({ error: 'not in server', invite: env.DISCORD_INVITE || '' }, 403, cors);
      const used = await db.prepare('SELECT d.player FROM discord d JOIN players p ON p.id = d.player WHERE d.subject = ? AND p.deleted IS NULL').bind(r.subject).first();
      if (used && used.player !== me.player) return json({ error: 'discord used' }, 409, cors);
      await db.batch([
        db.prepare('DELETE FROM discord WHERE player = ? OR subject = ?').bind(me.player, r.subject), // a deleted account's old row, or this player's earlier one
        db.prepare('INSERT INTO discord (subject, player, created) VALUES (?, ?, ?)').bind(r.subject, me.player, now),
        db.prepare('UPDATE players SET discord = COALESCE(discord, ?) WHERE id = ?').bind(now, me.player),
      ]);
      return json({ player: await playerOut(db, me.player) }, 200, cors);
    }
    if (route === 'puzzle') {
      const k = Number.isInteger(body.k) ? body.k : -1;
      if (k < 0 || k >= PUZZLE.count) return json({ error: 'no such puzzle' }, 400, cors);
      const had = await db.prepare('SELECT 1 FROM puzzles WHERE player = ? AND k = ?').bind(me.player, k).first();
      let won = !!had;
      if (!had) {
        try { won = puzzleWon(k, body.army); } catch (e) { console.warn('puzzle', e && e.message); won = false; }
        if (won) {
          await db.prepare('INSERT OR IGNORE INTO puzzles (player, k, created) VALUES (?, ?, ?)').bind(me.player, k, now).run();
          const n = await db.prepare('SELECT COUNT(*) AS n FROM puzzles WHERE player = ?').bind(me.player).first();
          if (n && n.n >= PUZZLE.count) await db.prepare('UPDATE players SET initiate = COALESCE(initiate, ?) WHERE id = ?').bind(now, me.player).run();
        }
      }
      const out = await playerOut(db, me.player);
      return json({ player: out, won, solved: out.puzzles }, 200, cors);
    }
    if (route === 'me') {
      try { await grantSkins(env, now); } catch (e) { console.warn('skins', e && e.message); }
      if (body.invite) { try { await claimInvite(db, me.player, body.invite, now); } catch (e) { console.warn('invite', e && e.message); } }
      const out = { player: await playerOut(db, me.player), rankedOn: await rankedOn(env), discord: discordInfo(env) };
      const lastRotation = me.expires - ACCOUNT.SESSION_DAYS * DAY;
      if (now - lastRotation > (+env.ACCOUNT_ROTATE_MS || ACCOUNT.ROTATE_MS)) {   // the setting is for tests
        out.session = await newSession(db, me.player);
        await db.prepare('UPDATE sessions SET expires = ? WHERE hash = ?').bind(Math.min(me.expires, now + ACCOUNT.GRACE_MS), me.hash).run();
      }
      await db.prepare('UPDATE players SET seen = ? WHERE id = ?').bind(now, me.player).run();
      return json(out, 200, cors);
    }
    if (route === 'tag') {
      const tag = cleanTag(body.tag);
      if (!tag) return json({ error: 'bad tag' }, 400, cors);
      const p = await db.prepare('SELECT tag, created, dev, tag_changed FROM players WHERE id = ?').bind(me.player).first();
      if (tag !== p.tag) {
        if (tagNext(p) > now) return json({ error: 'too soon', next: tagNext(p) }, 429, cors);
        const fresh = now - p.created < (env.ACCOUNT_TAG_FRESH_MS != null ? +env.ACCOUNT_TAG_FRESH_MS : TAG_FRESH); // the setting is for tests
        await db.prepare('UPDATE players SET tag = ?, tag_changed = ? WHERE id = ?').bind(tag, fresh || p.dev ? p.tag_changed : now, me.player).run();
      }
      return json({ player: await playerOut(db, me.player) }, 200, cors);
    }
    if (route === 'signout') {
      if (body.all) await db.prepare('DELETE FROM sessions WHERE player = ?').bind(me.player).run();
      else await db.prepare('DELETE FROM sessions WHERE hash = ?').bind(me.hash).run();
      return json({ ok: true }, 200, cors);
    }
    if (route === 'delete') {
      // The id stays as a tombstone (deleted, no tag) so past results can point at an anonymous player.
      await db.batch([
        db.prepare('DELETE FROM logins WHERE player = ?').bind(me.player),
        db.prepare('DELETE FROM sessions WHERE player = ?').bind(me.player),
        db.prepare('UPDATE players SET tag = NULL, deleted = ? WHERE id = ?').bind(now, me.player),
      ]);
      return json({ ok: true }, 200, cors);
    }
  } catch (e) {
    console.warn('account', route, e && e.message);   // never the body or headers: they carry tokens
    return json({ error: 'accounts unavailable' }, 503, cors);
  }
}
