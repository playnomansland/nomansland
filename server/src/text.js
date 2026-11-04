// Text from players (2026-11-04): shared by room chat (lobby work) and private messages (friends work).
// Keep the API small; both branches use it unchanged:
//   cleanText(s, max)          -> the text trimmed, control characters removed, spaces squeezed, at most max characters ('' if nothing is left)
//   filterWords(s)             -> the text with words from the short filter list replaced by ***
//   rateOk(state, key, n, ms)  -> true while key has been used fewer than n times in the last ms (and counts this use)

export function cleanText(s, max = 120) {
  if (typeof s !== 'string') return '';
  const t = s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...t].slice(0, max).join('').trim();
}

// A short list on purpose: slurs and the worst insults, matched as whole words or with letters repeated
// (fuuuck), and with a few look-alike digits (sh1t). Not a moderation system; Report is.
const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'dick', 'cock', 'pussy', 'asshole',
  'bastard', 'retard', 'retarded', 'faggot', 'fag', 'nigger', 'nigga', 'kike', 'spic', 'chink', 'tranny', 'rape', 'rapist',
  'kys', 'fitta', 'kuk', 'neger', 'bög',
];
const LOOK = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const squeeze = (w) => w.toLowerCase().replace(/[013457@$!]/g, (c) => LOOK[c]).replace(/(.)\1+/g, '$1');
const BAD = new Set(WORDS.map(squeeze));
export function filterWords(s) {
  if (typeof s !== 'string') return '';
  const bad = (w) => { const q = squeeze(w); return ['', 'ing', 'er', 'ed', 'es', 's', 'z'].some((x) => q.endsWith(x) && BAD.has(q.slice(0, q.length - x.length))); };
  return s.replace(/[\p{L}\p{N}@$!]+/gu, (w) => (bad(w) ? '***' : w));
}

// state: any object kept by the caller (per socket, per player); key: what is limited ('dm10s', 'dmHour'...)
export function rateOk(state, key, n, ms, now = Date.now()) {
  const list = (state[key] || []).filter((t) => now - t < ms);
  if (list.length >= n) { state[key] = list; return false; }
  list.push(now); state[key] = list;
  return true;
}
