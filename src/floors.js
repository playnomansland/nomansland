// ===== Painted floors and looks, shared by the 2D page (menu background, look previews) and the 3D board =====
// Moved out of scenery3d.js (2026-11-02) so the main page can paint a look without loading the 3D code.
var Floors = {};
// The painted floors for maps that have no ground of their own (the 3D board only), cached per look and size:
// meadow (dusty greens, trampled earth across no man's land, grass strokes) and sand (warm sand, wind ripples and
// darker drifts across no man's land) and autumn (the meadow turning gold, with fallen leaves). Floors.floor(ctx, W, H, t, floor) paints one.
Floors.FLOORS = {
  meadow: { base: '#5F714C', patch: ['#6A7D53', '#556944', '#718156', '#506343'], mid: ['#776C51', '#6B6248', '#7F7359'], strokes: ['#76895C', '#485B3C'], ripples: false },
  autumn: { base: '#62633E', patch: ['#6E6C3E', '#585B37', '#78693A', '#545634'], mid: ['#776146', '#6B583E', '#816A4B'], strokes: ['#8C7F4A', '#474A2C'], ripples: false, leaves: ['#B8532F', '#C9782F', '#D3A43A', '#9A3B2A'] },
  // Ashlands (2026-11-07): burnt ground, scorched no man's land, grey ash flecks and a few glowing embers
  ash: { base: '#4B4744', patch: ['#55504C', '#423E3B', '#5B5550', '#3D3937'], mid: ['#36312E', '#3F3935', '#2F2B29'], strokes: ['#625B55', '#2C2826'], ripples: false, leaves: ['#7D766F', '#8A827A', '#6B645E', '#7D766F', '#8A827A', '#C0652C', '#D98A3A'] },
  // Moonlit Snow: snow under a night sky, blue-grey, wind ripples, trampled darker across no man's land
  moonlit: { base: '#7C8BA3', patch: ['#8694AB', '#73829A', '#8E9CB2', '#6D7B93'], mid: ['#66728A', '#6E7A92', '#5F6B83'], strokes: ['#9AA8BD', '#5E6A82'], ripples: true },
  // Savanna: dry golden grass, dusty earth across no man's land
  savanna: { base: '#9E8B4F', patch: ['#AA965A', '#917F46', '#B39F61', '#887840'], mid: ['#977852', '#8B6E49', '#A3855C'], strokes: ['#C4B06C', '#6F6337'], ripples: false },
  sand: { base: '#B39A6C', patch: ['#BDA478', '#A88F62', '#C2AA7E', '#A38A5F'], mid: ['#9E8457', '#A78D60', '#94794E'], strokes: ['#C9B288', '#8F7650'], ripples: true },
};
// Looks: what each draws (its biome round the board, and its floor: one painted here, or a map's painted ground in the
// 2D renderer, bg). A map with skins (Game.SKINS) takes the match's pick (m.skin); every map has its own look too.
Floors.LOOKS = {
  meadow: { biome: 'meadow', floor: 'meadow' }, autumn: { biome: 'autumn', floor: 'autumn' }, desert: { biome: 'desert', floor: 'sand' },
  snow: { biome: 'ice', bg: 'ice' }, frost: { biome: 'frost', bg: 'darkwoods' }, forest: { biome: 'forest', bg: 'forest' }, cavern: { biome: 'cavern', bg: 'cavern' },
  ash: { biome: 'ash', floor: 'ash' }, moonlit: { biome: 'moonlit', floor: 'moonlit' }, savanna: { biome: 'savanna', floor: 'savanna' },
};
Floors.lookOf = (src) => { const k = Game.lookOf(src); return Floors.LOOKS[k] ? k : 'meadow'; };
Floors.floor = (() => {
  const cache = {};
  return (ctx, W, H, t, look) => {
    const L = Floors.FLOORS[look]; if (!L) return false;
    const key = W + 'x' + H + ':' + Game.ROWS + ':' + Game.ZONE;
    if (!cache[look] || cache[look].key !== key) {
      const oc = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
      oc.width = Math.round(W * dpr); oc.height = Math.round(H * dpr);
      const c = oc.getContext('2d'); c.scale(dpr, dpr);
      let sd = 99991; const rr = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
      c.fillStyle = L.base; c.fillRect(0, 0, W, H);
      const blob = (x, y, rx, ry, col, a) => { const g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); g.addColorStop(0, col); g.addColorStop(1, col + '00');
        c.globalAlpha = a; c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, ry, rr() * 3, 0, Math.PI * 2); c.fill(); };
      for (let k = 0; k < 70; k++) blob(rr() * W, rr() * H, t * (0.8 + rr() * 2.2), t * (0.6 + rr() * 1.6), L.patch[k % 4], 0.55);
      // no man's land: trampled earth, or darker drifts of sand
      const y0 = Game.ZONE * t, y1 = (Game.ROWS - Game.ZONE) * t;
      for (let k = 0; k < 55; k++) blob(rr() * W, y0 + rr() * (y1 - y0), t * (0.6 + rr() * 1.5), t * (0.4 + rr() * 0.8), L.mid[k % 3], 0.5);
      c.lineCap = 'round';
      if (L.ripples) { // wind ripples: long soft wavy lines, light over dark
        for (let k = 0; k < H / t * 9; k++) {
          const y = rr() * H, x0 = rr() * W - t * 2, len = t * (1.5 + rr() * 3), amp = t * 0.06, ph = rr() * 6;
          for (const [col, dy, a] of [[L.strokes[1], t * 0.035, 0.22], [L.strokes[0], 0, 0.3]]) {
            c.globalAlpha = a; c.strokeStyle = col; c.lineWidth = 1 + rr() * 0.6; c.beginPath();
            for (let s = 0; s <= 1.0001; s += 0.1) { const x = x0 + s * len, yy = y + dy + Math.sin(ph + s * 5) * amp; s ? c.lineTo(x, yy) : c.moveTo(x, yy); }
            c.stroke();
          }
        }
      } else { // painted grass strokes
        for (let k = 0; k < W * H / (t * t) * 14; k++) {
          const x = rr() * W, y = rr() * H, l = t * (0.06 + rr() * 0.1);
          c.globalAlpha = 0.25 + rr() * 0.25; c.strokeStyle = rr() < 0.5 ? L.strokes[0] : L.strokes[1]; c.lineWidth = 0.8 + rr() * 0.8;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rr() - 0.5) * l * 0.6, y - l); c.stroke();
        }
      }
      if (L.leaves) for (let k = 0; k < W * H / (t * t) * 5; k++) { // fallen leaves: small dabs in red, orange and gold, in drifts
        const x = rr() * W, y = rr() * H, r = t * (0.035 + rr() * 0.03);
        c.globalAlpha = 0.5 + rr() * 0.35; c.fillStyle = L.leaves[Math.floor(rr() * L.leaves.length)];
        c.beginPath(); c.ellipse(x, y, r, r * 0.6, rr() * 3, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
      cache[look] = { key, cv: oc };
    }
    ctx.drawImage(cache[look].cv, 0, 0, W, H);
    return true;
  };
})();
