// The built-in units every tournament (and later every server match) uses, and the 2v2 units (the built-in units plus
// three Mechite units: src/duo.js unitSet), prepared the way the page's useSet() does it.
import Engine from '../../src/engine.js';
import Duo from '../../src/duo.js';
import demo from '../../src/demo-units.json';
import factions from '../../src/faction-units.json';
import prepareUnits from './prepare-units.cjs';

let cache = null, duoCache = null;
export const builtin = () => cache || (cache = prepareUnits(Engine, demo));
export const duoUnits = () => duoCache || (duoCache = prepareUnits(Engine, Duo.unitSet(demo, factions)));
