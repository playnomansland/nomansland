// Starts `wrangler dev` for a test (or uses one already running with SERVER_UP=1) and gives small WebSocket helpers.
const { spawn } = require('child_process');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(25); }
  throw new Error('timed out');
}

async function startServer(port, extra = []) {
  const base = `http://127.0.0.1:${port}`;
  const dev = process.env.SERVER_UP ? { kill() {} } : spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', ...extra], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false' },
  });
  let log = '';
  if (dev.stdout) { dev.stdout.on('data', (d) => (log += d)); dev.stderr.on('data', (d) => (log += d)); }
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
    if (i > 120) throw new Error('server did not start:\n' + log);
    await sleep(500);
  }
  return { base, ws: base.replace('http', 'ws'), stop: () => dev.kill('SIGTERM'), log: () => log };
}

// a socket that keeps everything it receives in .inbox; .next(type) waits for the next message of that type
function open(url, origin = 'http://localhost:8766') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    ws.inbox = []; ws.seen = 0;
    ws.onmessage = (e) => ws.inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws error'));
    ws.json = (o) => ws.send(JSON.stringify(o));
    ws.next = (type, ms) => waitFor(() => { const k = ws.inbox.findIndex((x, i) => i >= ws.seen && x.t === type); if (k < 0) return null; ws.seen = k + 1; return ws.inbox[k]; }, ms);
    ws.last = (type) => [...ws.inbox].reverse().find((x) => x.t === type);
  });
}
const closed = (ws) => new Promise((r) => { if (ws.readyState === 3) r(ws.closeCode); ws.onclose = (e) => r(e.code); });

module.exports = { sleep, waitFor, startServer, open, closed };
