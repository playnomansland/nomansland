#!/usr/bin/env node
// Triangle inventory of the 3D board's models (docs/RENDER-BUDGET.md, step 1).
// Builds every model in src/models3d.js headless (three.js in node, no browser) and prints:
//   - triangles per model (one body, all parts), for every BUILD key, skins included;
//   - the Model Forge saves in models/ that aren't built into the game yet;
//   - per squad of src/default-roster.json: the model its units get (Models3D.kindOf), tier (by price), bodies per
//     squad, and triangles per squad (triangles x bodies).
// Usage: node tools/tri-budget/count.js [--json out.json]
const { load } = require('./models.js');
const roster = require('../../src/default-roster.json');

(async () => {
  const { models, tris, extra } = await load();
  const skinOf = {}; // model key -> skin name (src/shapes.js SKINS)
  const shapesSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'shapes.js'), 'utf8');
  for (const [, id, model] of shapesSrc.matchAll(/'([a-z-]+)':\s*\{[^}]*?model:\s*'([^']+)'/g)) skinOf[model] = id;
  const groupOf = (k) => skinOf[k] ? 'skin' : /^tower:|^building|^lesser$|^treasury$|^watchtower$|^wall$|^stonewall$|^spire$/.test(k) ? 'structure' : /:awake$|:eye$|:unfolded$/.test(k) ? 'variant' : k === 'spear' ? 'projectile' : 'unit';
  const all = models.KINDS.map(k => ({ kind: k, group: groupOf(k), skin: skinOf[k] || null, tris: tris(k) })).sort((a, b) => b.tris - a.tris);

  const prices = [...new Set(roster.units.map(u => u.cost))].sort((a, b) => a - b);
  const squads = roster.units.map(u => {
    const kind = models.kindOf({ ...u, bodies: u.bodies }), bodies = Math.max(1, Math.round(u.bodies)), t = tris(kind);
    return { unit: u.name, tier: prices.indexOf(u.cost) + 1, kind, bodies, trisPerBody: t, trisPerSquad: t * bodies };
  }).sort((a, b) => a.tier - b.tier || b.trisPerSquad - a.trisPerSquad);

  const pad = (s, n) => String(s).padEnd(n), num = (x, n) => String(x).padStart(n);
  console.log('Models in src/models3d.js (triangles for one body)');
  for (const r of all) console.log('  ' + pad(r.kind, 26) + num(r.tris, 6) + '  ' + r.group + (r.skin ? ' (' + r.skin + ')' : ''));
  console.log('\nModel Forge saves in models/, not built into the game');
  for (const [file, r] of Object.entries(extra)) console.log('  ' + pad(file, 40) + pad(r.key, 16) + num(r.tris, 6) + (models.KINDS.includes(r.key) ? `  (in game now: ${tris(r.key)})` : ''));
  console.log('\nSquads of src/default-roster.json');
  console.log('  ' + pad('unit', 18) + pad('tier', 6) + pad('model', 16) + num('bodies', 7) + num('tris/body', 11) + num('tris/squad', 12));
  for (const s of squads) console.log('  ' + pad(s.unit, 18) + pad(s.tier, 6) + pad(s.kind, 16) + num(s.bodies, 7) + num(s.trisPerBody, 11) + num(s.trisPerSquad, 12));

  const i = process.argv.indexOf('--json');
  if (i > 0) require('fs').writeFileSync(process.argv[i + 1], JSON.stringify({ models: all, forge: extra, squads }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
