// The built-in units every tournament (and later every server match) uses.
import Engine from '../../src/engine.js';
import demo from '../../src/demo-units.json';
import prepareUnits from './prepare-units.cjs';

let cache = null;
export const builtin = () => cache || (cache = prepareUnits(Engine, demo));
