// The built-in units, prepared the way the page's useSet() does it (site-template.html), minus the drawing shapes.
// CommonJS so the node tests can use the very same code.
module.exports = function prepareUnits(Engine, set) {
  const skills = (set.skills || []).filter((sk) => sk && typeof sk.id === 'string' && Engine.SKILL_TYPES[sk.type]);
  const units = set.units.map((u) => ({
    ...Engine.withTraits(u), level: 0, bodies: Math.max(1, Math.round(u.bodies)),
    skillDefs: Engine.SLOTS.map((k) => {
      const base = Array.isArray(u.skills) && skills.find((sk) => sk.id === u.skills[k]);
      if (!base) return null;
      const mod = Array.isArray(u.skillMods) && u.skillMods[k] && typeof u.skillMods[k] === 'object' ? u.skillMods[k] : null;
      return mod ? { ...base, cost: isFinite(+mod.cost) && mod.cost !== null ? +mod.cost : base.cost, params: { ...base.params, ...(mod.params || {}) } } : base;
    }),
  }));
  return { units, matrix: set.matrix };
};
