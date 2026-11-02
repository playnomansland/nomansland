// Match history (server step 4, 2026-11-02): every round of every server match, saved by the server itself.
//
// One Durable Object ("History", named 'all') with its own SQLite database. Chosen over D1 for now: no new database
// or token rights to set up, and the Room only talks to it after the fight has been sent (HistoryRoom.add over
// Durable Object RPC, not awaited by the match). Accounts (step 5) may still go to D1; history can move there later
// with a one-off copy if it ever needs SQL joins with accounts.
//
// What is kept per round (one row): see roundRow below. Gamertags only for tournament matches. The pre-fight
// snapshot and the fight summary are kept gzipped (a few KB) when they stay under REPLAY_MAX, so replays are
// possible later. Rows older than KEEP_DAYS are deleted by a daily alarm. No other personal data.
//
// Reading (src/index.js): GET /history?limit=&before= (newest first, paged by row id) and GET /history/<match id>
// (one match, oldest round first). A <match id> is "<ROOM CODE>-<seed>"; a bare room code gives that room's newest match.
import { DurableObject } from 'cloudflare:workers';
import Game from '../../src/game.js';
import Engine from '../../src/engine.js';
import { json } from './limits.js';

export const KEEP_DAYS = 365;
const DAY_MS = 24 * 3600 * 1000;
const REPLAY_MAX = 64 * 1024;     // a gzipped replay bigger than this is not kept (a long match is ~3 KB a round)
const PAGE_MAX = 100;             // rows per /history page
const MATCH_MAX = 200;            // rounds per /history/<id>
const READS_PER_MIN = 60;         // per IP; more and /history answers 429
const ID_RE = /^[A-Z0-9]{4,8}(-[a-z0-9]{1,12})?$/;

// ----- building a row (runs in the Room, after the fight message has gone out) -----
const sideOf = (w) => (w === 0 || w === 1 ? w : -1);
function skillsOf(p, side) {
  const out = [];
  (p.units || []).forEach((u, i) => Engine.SLOTS.forEach((k) => {
    try { if (Game.hasSkill(p, side, i, k) && !Game.isInnate(p, i, k)) out.push(`${(u.skillDefs && u.skillDefs[k] || {}).name || k} (${u.name})`); } catch {}
  }));
  return out;
}
function towerName(p, side) { try { const t = Game.towerType(p, side); return t ? t.name || t.id || '' : ''; } catch { return ''; } }
function leaderName(p, side) { try { const c = Game.charInfo(Game.charOf(p, side)); return c ? c.name : ''; } catch { return ''; } }

// One round as a row. pre: the pre-fight snapshot with units (Ref.withUnits); m: the match after the fight;
// info: { room, tour, match, matchId, names (tournament only) }.
export function roundRow(pre, sum, m, info) {
  const army = (sd) => (pre.armies[sd] || []).map((q) => ({ unit: (pre.units[q.unit] || {}).name || String(q.unit), level: (q.level | 0) + 1, col: q.col, row: q.row }));
  let look = '';
  try { const id = Game.lookOf(pre) || ''; look = (Game.SKINS.find((k) => k.id === id) || {}).name || id; } catch { look = pre.skin || ''; }
  return {
    room: info.room, tour: info.tour || null, match: info.match || null, matchId: info.matchId,
    round: sum.round, map: (Game.mapOf(pre) || {}).name || '', look,
    leaders: [leaderName(pre, 0), leaderName(pre, 1)],
    names: info.names || null,
    armies: [army(0), army(1)], skills: [skillsOf(pre, 0), skillsOf(pre, 1)], towers: [towerName(pre, 0), towerName(pre, 1)],
    winner: sideOf(sum.winner), timeout: !!sum.timeout, seconds: Math.round(sum.time || 0),
    dmg: [sum.dmg ? sum.dmg[0] | 0 : 0, sum.dmg ? sum.dmg[1] | 0 : 0], hp: [m.hp[0], m.hp[1]],
    over: !!m.over, matchWinner: m.over ? sideOf(m.winner) : null,
  };
}

// A forfeit ends the match without a fight: one row that says so (no armies).
export function forfeitRow(m, side, info) {
  let leaders = ['', ''];
  try { leaders = [leaderName(m, 0), leaderName(m, 1)]; } catch {}
  return {
    room: info.room, tour: info.tour || null, match: info.match || null, matchId: info.matchId,
    round: m.round, map: (Game.mapOf(m) || {}).name || '', look: '', leaders, names: info.names || null,
    armies: [[], []], skills: [[], []], towers: ['', ''], winner: -1, timeout: false, seconds: 0, dmg: [0, 0],
    hp: [m.hp[0], m.hp[1]], over: true, matchWinner: sideOf(m.winner), forfeit: side,
  };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class HistoryRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.reads = new Map(); // ip -> { start, count }; resets when the object sleeps, which is fine
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, match_id TEXT NOT NULL, room TEXT NOT NULL,
      tour TEXT, round INTEGER NOT NULL, row TEXT NOT NULL, replay BLOB)`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS rounds_match ON rounds (match_id, round)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rounds_room ON rounds (room, id)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS rounds_time ON rounds (time)');
  }

  // Saves one round. replay: { pre, summary } or null. Called by the Room without waiting on it.
  async add(row, replay) {
    const fail = (this.env.HISTORY_FAIL_ROOMS || '').split(',').filter(Boolean);
    if (fail.some((p) => String(row.room).startsWith(p))) throw new Error('history store failing (test setting)');
    let blob = null;
    if (replay) { try { const z = await gzip(JSON.stringify(replay)); if (z.byteLength <= REPLAY_MAX) blob = z; } catch { blob = null; } }
    const time = Date.now();
    this.sql.exec('INSERT INTO rounds (time, match_id, room, tour, round, row, replay) VALUES (?, ?, ?, ?, ?, ?, ?)',
      time, String(row.matchId), String(row.room), row.tour || null, row.round | 0, JSON.stringify(row), blob);
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(time + DAY_MS);
    return true;
  }

  // the daily clean-up: rounds older than KEEP_DAYS go
  async alarm() {
    this.sql.exec('DELETE FROM rounds WHERE time < ?', Date.now() - KEEP_DAYS * DAY_MS);
    const left = this.sql.exec('SELECT COUNT(*) AS n FROM rounds').one().n;
    if (left) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  static out(r) { return { id: r.id, time: new Date(r.time).toISOString(), replay: r.has_replay ? true : false, ...JSON.parse(r.row) }; }

  // GET /history and /history/<id>, routed here by src/index.js (the origin check is done there)
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {};
    const origin = request.headers.get('x-origin');
    if (origin) { cors['access-control-allow-origin'] = origin; cors.vary = 'Origin'; }
    // rate limit per IP
    const ip = request.headers.get('x-ip') || '?', now = Date.now();
    const r = this.reads.get(ip) || { start: now, count: 0 };
    if (now - r.start > 60_000) { r.start = now; r.count = 0; }
    r.count++; this.reads.set(ip, r);
    if (this.reads.size > 5000) this.reads.clear();
    if (r.count > READS_PER_MIN) return json({ error: 'too many requests' }, 429, { ...cors, 'retry-after': '60' });

    const id = url.searchParams.get('id');
    if (id != null) {
      if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400, cors);
      let matchId = id;
      if (!id.includes('-')) { // a bare room code: that room's newest match
        const last = this.sql.exec('SELECT match_id FROM rounds WHERE room = ? ORDER BY id DESC LIMIT 1', id).toArray()[0];
        if (!last) return json({ error: 'not found' }, 404, cors);
        matchId = last.match_id;
      }
      const rows = this.sql.exec('SELECT id, time, row, replay IS NOT NULL AS has_replay FROM rounds WHERE match_id = ? ORDER BY round, id LIMIT ?', matchId, MATCH_MAX).toArray();
      if (!rows.length) return json({ error: 'not found' }, 404, cors);
      return json({ matchId, rounds: rows.map(HistoryRoom.out) }, 200, cors);
    }
    const limRaw = url.searchParams.get('limit'), befRaw = url.searchParams.get('before');
    const limit = limRaw == null || limRaw === '' ? 40 : Number(limRaw);
    const before = befRaw == null || befRaw === '' ? null : Number(befRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) return json({ error: `limit must be 1-${PAGE_MAX}` }, 400, cors);
    if (before != null && (!Number.isInteger(before) || before < 1)) return json({ error: 'bad before' }, 400, cors);
    const rows = (before == null
      ? this.sql.exec('SELECT id, time, row, replay IS NOT NULL AS has_replay FROM rounds ORDER BY id DESC LIMIT ?', limit)
      : this.sql.exec('SELECT id, time, row, replay IS NOT NULL AS has_replay FROM rounds WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit)).toArray();
    const next = rows.length === limit ? rows[rows.length - 1].id : null;
    return json({ rows: rows.map(HistoryRoom.out), next }, 200, cors);
  }
}
