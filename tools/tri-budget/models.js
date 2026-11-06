// Shared by the tri-budget tools: three.js and src/models3d.js loaded in node, no browser.
// load() -> { THREE, models, tris(kind), extra } where tris(kind) is the triangle count of one body of that model
// (all its parts: tint + team + fixed), and extra holds the Model Forge saves in models/ that aren't in BUILD yet,
// built the same way (key -> triangles).
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..');

async function load() {
  const THREE = await import(pathToFileURL(path.join(ROOT, 'vendor', 'three.module.min.js')).href);
  // models3d.js and kaykit3d.js are plain scripts: run them with THREE (and the KayKit data, for the treasury and torches)
  const kaykit = fs.readFileSync(path.join(ROOT, 'src', 'kaykit3d.js'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'models3d.js'), 'utf8');
  global.atob = global.atob || ((b) => Buffer.from(b, 'base64').toString('binary'));
  const Models3D = new Function('THREE', kaykit + '\n' + src + '\nreturn Models3D(THREE);');
  const models = Models3D(THREE);
  const count = (g) => g ? (g.index ? g.index.count : g.getAttribute('position').count) / 3 : 0;
  const tris = (kind) => { const p = models.parts(kind); return count(p.tint) + count(p.team) + count(p.fixed); };

  // models/**/*.model.js: a BUILD entry as a fragment. Build it with the same helpers by putting it into a copy of BUILD.
  const extra = {};
  const dir = path.join(ROOT, 'models');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.model.js')) files.push(p); } })(dir);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\* FORGE_SPEC[\s\S]*?\*\//, '');
    const key = (text.match(/^\s*'([^']+)':\s*\(\)\s*=>/m) || [])[1];
    if (!key) continue;
    // set it after BUILD is made, so it replaces a built-in model of the same key (the Fire Mage's base model does)
    const body = text.slice(text.indexOf("'" + key + "'")).trim().replace(/,\s*$/, '').replace(/^'[^']+':\s*/, '');
    const anchor = 'for (const [k, f] of Object.entries(TOWERS))';
    if (!src.includes(anchor)) throw new Error('models3d.js changed: no place to add ' + key);
    const patched = src.replace(anchor, `BUILD[${JSON.stringify(key)}] = ${body};\n  ` + anchor);
    const M = new Function('THREE', kaykit + '\n' + patched + '\nreturn Models3D(THREE);')(THREE);
    const p = M.parts(key);
    extra[path.relative(ROOT, file).replace(/\\/g, '/')] = { key, tris: count(p.tint) + count(p.team) + count(p.fixed) };
  }
  return { THREE, models, tris, extra };
}
module.exports = { load, ROOT };
