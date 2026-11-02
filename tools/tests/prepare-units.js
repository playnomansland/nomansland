// The server prepares the built-in units with server/src/prepare-units.cjs; the page with useSet() in
// src/site-template.html. A fight on the server must use exactly the units the phones play it back with, so this runs
// the page's own useSet (cut out of the template) and compares everything but the drawing (shape, colour).
// Run: node tools/tests/prepare-units.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Engine = require('../../src/engine.js');
const Shapes = new Function(require('fs').readFileSync(require('path').join(__dirname, '../../src/shapes.js'), 'utf8') + '\nreturn Shapes;')();
const prepare = require('../../server/src/prepare-units.cjs');

const tpl = fs.readFileSync(path.join(__dirname, '../../src/site-template.html'), 'utf8');
const start = tpl.indexOf('  function useSet(set, custom) {');
assert.ok(start > 0, 'useSet found in the page');
const end = tpl.indexOf('\n  }\n', start) + 4;
const code = tpl.slice(start, end);
const page = new Function('Engine', 'Shapes', `let units, M, customSet, rawSet;\n${code}\nreturn (set) => { useSet(set, false); return { units, matrix: M }; };`)(Engine, Shapes);

const drawOnly = ['shape', 'color'];
const strip = (u) => { const o = JSON.parse(JSON.stringify(u)); for (const k of drawOnly) delete o[k]; return o; };
const sets = {
  'built-in': require('../../src/demo-units.json'),
  'default roster': require('../../src/default-roster.json'),
};
// and a set with names and skill names that need cleaning
const odd = JSON.parse(JSON.stringify(sets['built-in']));
odd.units[0].name = '  <b>Goblin & "Co"</b>  ';
odd.units[1].name = '   ';
if (odd.skills && odd.skills[0]) odd.skills[0].name = '<i>Shiny</i> "skill" & more and a very long name past forty letters';
if (odd.units[2].skillMods) odd.units[2].skillMods = [{ cost: 5, params: { x: 1 } }, null];
sets.odd = odd;

for (const [name, set] of Object.entries(sets)) {
  if (!set.matrix) set.matrix = set.units.map(() => set.units.map(() => 0));
  const a = page(set), b = prepare(Engine, set);
  assert.strictEqual(a.units.length, b.units.length);
  a.units.forEach((u, i) => assert.deepStrictEqual(strip(b.units[i]), strip(u), `${name}: ${u.name}`));
  assert.strictEqual(a.matrix, b.matrix);
  console.log(`${name}: ${a.units.length} units the same`);
}
console.log('prepare-units: ok');
