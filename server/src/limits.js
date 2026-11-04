// Safety limits shared by every room. Kept small on purpose: a round-based game never needs more.
export const LIMITS = {
  maxMessageBytes: 256 * 1024,  // the biggest real message (a whole tournament or side) is far below this
  maxSockets: 12,               // a match room: 2 players + spectators
  maxTourSockets: 80,           // a tournament: players + watchers
  maxTourPlayers: 64,
  ratePerWindow: 40,            // messages one connection may send ...
  matchRatePerWindow: 150,      // ... (in a match: every tap that buys, places or moves is a message)
  rateWindowMs: 10_000,         // ... per 10 seconds; more and it's disconnected
  selftestEveryMs: 10_000,      // the self test runs at most once per 10 s
};

// The online lobby (2026-11-04, docs/LOBBY.md; server/src/lobby.js) and chat in match rooms.
export const LOBBY = {
  socketsPerIp: 3,              // lobby screens open per IP
  ratePerWindow: 30,            // lobby messages per socket per rateWindowMs (10 s)
  maxListings: 200,             // more public rooms than this: the oldest waiting ones aren't listed (still joinable by code)
  createPerIp: [10, 600_000],   // public rooms made per IP per 10 min
  heartbeatMs: 60_000,          // a public room re-sends its listing this often
  staleMs: 180_000,             // the lobby drops a listing not heard from for this long
  waitIdleMs: 600_000,          // a waiting room left alone this long is taken off the list
  batchMs: 1000,                // listing changes go out to lobby screens at most once a second
  watcherEveryMs: 5000,         // watcher count changes are reported at most this often
};
export const CHAT = {
  max: 120,                     // characters per line
  keep: 50,                     // lines a room keeps in memory (reconnects, reports); never saved
  burst: [3, 5000],             // lines per 5 s ...
  minute: [20, 60_000],         // ... and per minute
  emoteMs: 3000,                // one emote per 3 s
  emotes: ['bababa', 'golem', 'shock'],
  report: 20,                   // lines sent with a report
  reportsPerSide: 3,            // reports one phone may send from one room
};
// a short word list, kept short on purpose so names and normal words pass ("slut" is Swedish for "end"): the first
// group anywhere in a word, the second only as a whole word; a match becomes ***
const BAD_ANY = ['fuck', 'cunt', 'nigger', 'nigga', 'faggot'];
const BAD_WORD = ['retard', 'retarded', 'whore', 'kys', 'rape', 'fitta', 'kuk', 'hitler', 'bitch'];
const BAD_RE = new RegExp(`${BAD_ANY.join('|')}|(?<![\\p{L}\\p{N}])(?:${BAD_WORD.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
// a chat line as the server keeps it: trimmed, control characters out, spaces squeezed, at most CHAT.max, filtered; '' if empty
export function cleanChat(text) {
  if (typeof text !== 'string') return '';
  const t = [...text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, CHAT.max).join('');
  return t.replace(BAD_RE, '***').trim();
}
// counts per key in a time window, in memory (resets if the object sleeps, which only ever makes it kinder)
export class Window {
  constructor(max, ms) { this.max = max; this.ms = ms; this.m = new Map(); }
  // true if one more is allowed (and counts it)
  hit(key, now = Date.now()) {
    const r = this.m.get(key);
    if (!r || now - r.start > this.ms) { this.m.set(key, { start: now, n: 1 }); if (this.m.size > 5000) this.sweep(now); return true; }
    if (r.n >= this.max) return false;
    r.n++; return true;
  }
  sweep(now) { for (const [k, r] of this.m) if (now - r.start > this.ms) this.m.delete(k); }
}
// an IP as a short hash, so no address is kept
export async function ipHash(ip) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nml-lobby:' + (ip || 'none'))));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

// Checks one incoming message: size, rate, JSON object. Returns the parsed object, or null after closing the socket.
export function readMessage(ws, message, rate, perWindow = LIMITS.ratePerWindow) {
  const size = typeof message === 'string' ? message.length : message.byteLength;
  if (size > LIMITS.maxMessageBytes) { ws.close(1009, 'message too big'); return null; }
  const now = Date.now();
  const r = rate.get(ws) || { start: now, count: 0 };
  if (now - r.start > LIMITS.rateWindowMs) { r.start = now; r.count = 0; }
  r.count++;
  rate.set(ws, r);
  if (r.count > perWindow) { ws.close(1008, 'too many messages'); return null; }
  if (typeof message !== 'string') { ws.close(1003, 'text only'); return null; }
  let data;
  try { data = JSON.parse(message); } catch { ws.close(1007, 'not json'); return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) { ws.close(1007, 'not an object'); return null; }
  return data;
}

// A random secret (for organizer and player keys).
export function secret(n = 24) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
