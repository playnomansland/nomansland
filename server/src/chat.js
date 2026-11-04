// Chat and emotes in a match room (2026-11-04, docs/LOBBY.md §6), shared by Room and DuoRoom. The room decides who
// may send and who gets a line; this keeps the lines, the limits and the filter.
//
// - Text chat only from a phone whose account session (sent in hello) has a Google login; guests read chat and may
//   send emotes. Lines: trimmed, control characters out, at most CHAT.max characters, a short word filter (***).
// - Limits per sender: CHAT.burst (3 lines per 5 s) and CHAT.minute (20 a minute); one emote per CHAT.emoteMs.
//   Over a limit the line is dropped and the sender gets denied { why: 'slow down' }.
// - The room keeps the last CHAT.keep lines (for a phone that reconnects, and for a report) in its own storage,
//   deleted with the room; chat is never in match history.
// - A line: { from, tag, text, at, w (a watcher's), hid (sent to watchers only so far), seed (the match it was in) }.
import { CHAT, cleanChat, Window } from './limits.js';

export class Chat {
  constructor(storage) {
    this.storage = storage;
    this.lines = [];
    this.burst = new Window(CHAT.burst[0], CHAT.burst[1]);
    this.minute = new Window(CHAT.minute[0], CHAT.minute[1]);
    this.emotes = new Window(1, CHAT.emoteMs);
    this.reports = new Map();
  }
  async load() { this.lines = (await this.storage.get('chat')) || []; }
  // a new line from sender key k (null: dropped; 'slow down' / 'empty': why)
  async add(k, from, tag, text, extra = {}) {
    const t = cleanChat(text);
    if (!t) return { why: 'empty' };
    const now = Date.now();
    if (!this.burst.hit(k, now) || !this.minute.hit(k, now)) return { why: 'slow down' };
    const line = { from, tag: String(tag || '').slice(0, 24), text: t, at: now, ...extra };
    this.lines.push(line);
    if (this.lines.length > CHAT.keep) this.lines.splice(0, this.lines.length - CHAT.keep);
    await this.save();
    return { line };
  }
  emote(k, id) {
    if (!CHAT.emotes.includes(id)) return { why: 'bad' };
    return this.emotes.hit(k) ? { ok: true } : { why: 'slow down' };
  }
  async save() { try { await this.storage.put('chat', this.lines); } catch (e) {} }
  // a line as a phone gets it (nothing the room keeps for itself)
  static out(l) { return { t: 'chat', from: l.from, tag: l.tag, text: l.text, at: l.at, ...(l.w ? { w: true } : {}), ...(l.team ? { team: true } : {}) }; }
  // may sender k send one more report from this room?
  report(k) { const n = this.reports.get(k) || 0; if (n >= CHAT.reportsPerSide) return false; this.reports.set(k, n + 1); return true; }
}
