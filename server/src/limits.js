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
