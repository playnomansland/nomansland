// Shared by server/test/accounts.test.js and tools/tests/account-ui.js: a local server with accounts switched on.
//  - a stand-in for Google's key server, and idToken() to sign ID tokens with its key (tests can't reach Google)
//  - while the D1 block in wrangler.toml is still commented out, a copy of the config with a local database added
//  - a fresh database directory per run (the per-IP limits last up to an hour)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { startServer } = require('./harness.js');

const CLIENT = 'test-client.apps.googleusercontent.com';
const KID = 'test-key-1';
const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function idToken(claims = {}, { key = kp.privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1000' + crypto.randomInt(1e9), iat: now, exp: now + 3600, ...claims };
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(body);
  return head + '.' + crypto.sign('sha256', Buffer.from(head), key).toString('base64url');
}

// wrangler args for a config with the accounts database; [] once wrangler.toml has the real block
function accountsConfig() {
  const root = path.join(__dirname, '..');
  let conf = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  if (/^\[\[d1_databases\]\]/m.test(conf)) return [];
  fs.mkdirSync(path.join(root, '.wrangler'), { recursive: true });
  conf = conf.replace(/^main = "src\//m, 'main = "../src/') +
    '\n[[d1_databases]]\nbinding = "ACCOUNTS"\ndatabase_name = "nml-accounts"\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n';
  const file = path.join(root, '.wrangler', 'accounts-test.toml');
  fs.writeFileSync(file, conf);
  return ['--config', file];
}

async function startAccounts(port, vars = {}) {
  const keys = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close'); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise((r) => keys.listen(0, '127.0.0.1', r));
  const keyUrl = `http://127.0.0.1:${keys.address().port}/certs`;
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'nml-acc-'));
  const args = [...accountsConfig(), '--persist-to', state, '--var', `GOOGLE_CLIENT_ID:${CLIENT}`, '--var', `GOOGLE_JWKS_URL:${keyUrl}`];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const srv = await startServer(port, args);
  const stop = srv.stop;
  srv.stop = () => { stop(); keys.close(); fs.rmSync(state, { recursive: true, force: true }); };
  return srv;
}

module.exports = { CLIENT, KID, other, b64, idToken, startAccounts };
