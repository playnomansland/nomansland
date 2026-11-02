// The built-in units, prepared the way the page's useSet() does it (site-template.html), minus the drawing shapes and
// colours (Shapes.assign), which never change a fight. CommonJS so the node tests can use the very same code.
// tools/tests/prepare-units.js checks it against the page's own useSet, so the two can't drift apart.
const clean = (s, fallback) => String(s).replace(/[<>&"]/g, '').trim().slice(0, 40) || fallback;
module.exports = function prepareUnits(Engine, set) {
  const skills = (set.skills || []).filter((sk) => sk && typeof sk.id === 'string' && Engine.SKILL_TYPES[sk.type])
    .map((sk) => ({ ...sk, name: String(sk.name || Engine.SKILL_TYPES[sk.type].label).replace(/[<>&"]/g, '').slice(0, 40) }));
  const units = set.units.map((u) => ({
    ...Engine.withTraits(u), name: clean(u.name, 'Unit'), level: 0, bodies: Math.max(1, Math.round(u.bodies)),
    skillDefs: Engine.SLOTS.map((k) => {
      const base = Array.isArray(u.skills) && skills.find((sk) => sk.id === u.skills[k]);
      if (!base) return null;
      const mod = Array.isArray(u.skillMods) && u.skillMods[k] && typeof u.skillMods[k] === 'object' ? u.skillMods[k] : null;
      return mod ? { ...base, cost: isFinite(+mod.cost) && mod.cost !== null ? +mod.cost : base.cost, params: { ...base.params, ...(mod.params || {}) } } : base;
    }),
  }));
  return { units, matrix: set.matrix };
};
