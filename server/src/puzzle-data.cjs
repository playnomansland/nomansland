// The tutorial puzzles (src/puzzles.json) and the built-in units they are played with, for accounts.js (puzzleWon).
// A .cjs file so plain node (tools/tests/legend.js imports accounts.js) can load the JSON without import attributes.
const Engine = require('../../src/engine.js');
const prepareUnits = require('./prepare-units.cjs');
const PUZZLES = require('../../src/puzzles.json');
let cache = null;
module.exports = { PUZZLES, builtin: () => cache || (cache = prepareUnits(Engine, require('../../src/demo-units.json'))) };
