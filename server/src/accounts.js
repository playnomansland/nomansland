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
//   /account/tag     { tag } (auth)      -> { player }
//   /account/signout { all? } (auth)     -> { ok }
//   /account/delete  (auth)              -> { ok }  (login, sessions and gamertag removed; the id stays as a tombstone)
//   /account/title   { title } (auth)   -> { player }  (shows one of the player's titles under the gamertag; '' = none)
//   /account/ranked  { on } (auth, developer only) -> { on }  (switches ranked play on or off for everyone)
//
// Ranked play (2026-11-02): a ranked friend's match is a best of 3 refereed by the Room (room.js). When a series is
// decided the Room calls recordSeries, which adds a win, tie or loss to each player's row in 'ranked'. GET /leaderboard
// (index.js -> leaderboard) reads it. Players need an account (a guest is enough) to play ranked: the phone sends its
// session in the match's hello message (never in the URL) and the Room checks it with sessionPlayer.
import { json, secret } from './limits.js';

export const ACCOUNT = {
  SESSION_DAYS: 30,
  ROTATE_MS: 24 * 3600e3,
  GRACE_MS: 5 * 60e3,
  MAX_SESSIONS: 10,        // per player; the oldest go first
  BODY_BYTES: 8 * 1024,    // a Google ID token is about 1.2 KB
  // per IP: [count, window ms]. A tournament on one wifi shares an IP, so these leave room for a full room of friends.
  RATE: { guest: [20, 3600e3], google: [30, 600e3], other: [120, 60e3] },
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
];
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s)))
    // players.title (2026-11-02): the title picked to show; added to a table that may already exist
    .then(() => db.prepare('ALTER TABLE players ADD COLUMN title TEXT').run().catch((e) => { if (!/duplicate column/i.test(String(e && e.message))) throw e; }))
    .catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

// ---------- titles (2026-11-02) ----------
// Shown under a gamertag. Earned, never bought; decided here from the player's row:
//   day1  "Day 1" (purple): every account made in the first week, up to the end of Sunday 2026-11-08 (Stockholm time)
//   dev   "DEV" (pink): developer accounts (the server's dev column)
// The player picks which one shows (players.title); none picked = the newest earned one (DEV before Day 1).
export const DAY1_END = Date.UTC(2026, 10, 8, 23, 0, 0); // Monday 2026-11-09 00:00 in Stockholm
export function titlesOf(p) {
  const out = [];
  if (p && p.dev) out.push('dev');
  if (p && p.created < DAY1_END) out.push('day1');
  return out;
}
export function titleShown(p) {
  const have = titlesOf(p);
  if (p && p.title === 'none') return '';
  return p && have.includes(p.title) ? p.title : have[0] || '';
}

const enc = new TextEncoder();
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
  const p = await db.prepare('SELECT created, dev, title FROM players WHERE id = ?').bind(s.player).first();
  return { id: s.player, tag: s.tag || 'Player', dev: !!s.dev, title: titleShown(p) };
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
// GET /leaderboard: every ranked player with a name, best first (win share, then wins, then fewest losses). Deleted
// accounts drop off. Ties count as half a win in the share.
export async function leaderboard(env, cors) {
  const db = env.ACCOUNTS;
  if (!db) return json({ on: false, rows: [] }, 200, cors);
  try {
    await ensureSchema(db);
    const on = await rankedOn(env);
    const res = await db.prepare(`SELECT p.id, p.tag, p.created, p.dev, p.title, r.w, r.t, r.l FROM ranked r JOIN players p ON p.id = r.player WHERE p.deleted IS NULL AND (r.w + r.t + r.l) > 0
      ORDER BY (r.w + 0.5 * r.t) * 1.0 / (r.w + r.t + r.l) DESC, r.w DESC, r.l ASC LIMIT 200`).all();
    return json({ on, rows: res.results.map((r) => ({ id: r.id, tag: r.tag || 'Player', title: titleShown(r), w: r.w, t: r.t, l: r.l })) }, 200, { ...cors, 'cache-control': 'no-store' });
  } catch (e) {
    console.warn('leaderboard', e && e.message);
    return json({ error: 'leaderboard unavailable' }, 503, cors);
  }
}

async function playerOut(db, id) {
  const p = await db.prepare('SELECT id, tag, created, dev, title FROM players WHERE id = ?').bind(id).first();
  const logins = await db.prepare('SELECT provider FROM logins WHERE player = ?').bind(id).all();
  return { id: p.id, tag: p.tag, created: p.created, google: logins.results.some((r) => r.provider === 'google'), dev: !!p.dev, titles: titlesOf(p), title: titleShown(p) };
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

// ---------- the route handler ----------
export async function handleAccount(request, env, cors) {
  const db = env.ACCOUNTS;
  if (!db) return json({ error: 'accounts off' }, 503, cors);
  const route = new URL(request.url).pathname.replace(/^\/account\/?/, '').replace(/\/$/, '');
  if (!['guest', 'me', 'google', 'tag', 'signout', 'delete', 'ranked', 'title'].includes(route)) return json({ error: 'not found' }, 404, cors);
  if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);

  let body = {};
  const text = await request.text();
  if (text.length > ACCOUNT.BODY_BYTES) return json({ error: 'too big' }, 413, cors);
  if (text) { try { body = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, cors); } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'not an object' }, 400, cors);

  try {
    await ensureSchema(db);
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const bucket = route === 'guest' ? 'guest' : route === 'google' ? 'google' : 'other';
    if (!(await hit(db, bucket, ip, env))) return json({ error: 'slow down' }, 429, cors);
    const now = Date.now();

    if (route === 'guest') {
      const tag = body.tag == null ? guestTag() : cleanTag(body.tag);
      if (!tag) return json({ error: 'bad tag' }, 400, cors);
      const id = newPlayerId();
      await db.prepare('INSERT INTO players (id, tag, created, seen) VALUES (?, ?, ?, ?)').bind(id, tag, now, now).run();
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
      const session = await newSession(db, id);
      return json({ player: await playerOut(db, id), session, linked }, 200, cors);
    }

    const me = await auth(db, request);
    if (!me) return json({ error: 'signed out' }, 401, cors);

    if (route === 'title') {
      const t = typeof body.title === 'string' ? body.title : '';
      const p = await db.prepare('SELECT created, dev FROM players WHERE id = ?').bind(me.player).first();
      if (t && !titlesOf(p).includes(t)) return json({ error: 'not your title' }, 400, cors);
      await db.prepare('UPDATE players SET title = ? WHERE id = ?').bind(t || 'none', me.player).run();
      return json({ player: await playerOut(db, me.player) }, 200, cors);
    }
    if (route === 'ranked') {
      // a developer switches ranked play on or off for everyone (the server's own dev flag, never the phone's word)
      const p = await db.prepare('SELECT dev FROM players WHERE id = ?').bind(me.player).first();
      if (!p || !p.dev) return json({ error: 'not a developer' }, 403, cors);
      if (typeof body.on === 'boolean') await db.prepare(`INSERT OR REPLACE INTO config (k, v) VALUES ('ranked', ?)`).bind(body.on ? 'on' : 'off').run();
      return json({ on: await rankedOn(env) }, 200, cors);
    }
    if (route === 'me') {
      const out = { player: await playerOut(db, me.player), rankedOn: await rankedOn(env) };
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
      await db.prepare('UPDATE players SET tag = ? WHERE id = ?').bind(tag, me.player).run();
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
