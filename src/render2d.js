// ===== 2D board renderer: draws the board, the squads and the battles on a <canvas> =====
// It sees the game only through view(), which it calls at the start of every draw and which returns what this
// screen shows right now:
//   { m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile, rangeOf,
//     editable, placingUnit, placingElf, placingTower, placingWall, placingBuilding, battleCam, dev }
// aim: { id, end } while a melee squad's direction arrow is being set (end: the tile under the finger, or null); see aimFloor.
// dev (Factions devtest only): { bPlacing, castMode, guideMode, guideId, guide }: the building being placed, the spell being
// cast, and the arrow being drawn (guide: its points so far, for squad guideId).
// fx: short-lived battle effects as plain data (shots, flames, bolts, heals, deaths, and 'gold': the text over a
// treasury that fell), in board metres.
// rangeOf: { side, id } of the squad last tapped, or null (its range ring is drawn by the page, over the board, with the
// same measure as the ring under the mouse: boardMarks in site-template.html).
// battleCam: { zoom, x, y } while the battle cam zooms in on the final seconds of a fight (board metres), else null.
// Calls: size() after the canvas changes size, draw(), tileAt(clientX, clientY) -> { col, row } or null,
// thumb(match) -> a data URL of a small picture of that match's board (null: a plain board with a question mark),
// floor(plain): only the board itself (map, zones, tiles), no squads or towers: the 3D renderer lays it on the ground;
// plain leaves out the zones, grid and tile markers (for the 3D ground-level view).
// A 3D renderer can take its place by offering the same calls.
// opts (the 3D board's floor): look(match) -> { bg, floor }: the map ground to paint (bg: a map's painted ground, by id) or
// the floor for ground(ctx, W, H, tilePx, floor), which paints it and returns true; grid and zoneA: the grid lines'
// colour and how strongly the zones are tinted on a painted floor.
const Render2D = (cv, view, opts = {}) => {
  let ctx = cv.getContext('2d'); // swapped for a moment while drawing map thumbnails (thumb)
  let m = null, me = 0, phase = 'start', units = [], mode = 'ai', bt = null, battlePre = null, fx = [], battleCam = null, win = null;
  let selected = null, moving = null, drag = null, hoverTile = null, rangeOf = null, editable = false, placingUnit = null, placingElf = false, placingTower = false, placingWall = false, dev = null, placingBuilding = null, aim = null, duo = null;
  const pull = () => { ({ m, me, phase, units, mode, bt, battlePre, fx, selected, moving, drag, hoverTile, rangeOf, editable, placingUnit, placingElf, placingTower, placingWall, placingBuilding, battleCam, dev, aim = null, win = null, duo = null } = view()); };
  // win (a 2v2 fight on a phone): { aspect, cols, x } the canvas is shaped for `aspect` columns, shows `cols` of them
  // (zoomed out up to the whole wide board) and starts at screen column x; the board sits in the middle top to bottom
  const foe = () => 1 - me;
  const css = Art.css, tag = Shapes.tag;
  const { ELF_COL, SHROOM_COL, CHARM_COL, BLEED_COL, POOL_COL, FROST_COL, GLUT_COL } = Art;
  let W = 0, H = 0, S = 0;
  function size() {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    pull();
    if (m) Game.useGrid(m); // the board as drawn (view() may have used the page's match: a 2v2 picture is wider)
    W = r.width; H = W * Game.ROWS / (win ? win.aspect : Game.COLS);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = W / (Game.COLS * Game.TILE);
  }
  // The board is turned around for side 1, so both players see their own zone at the bottom (read from Game each
  // time: the Test Grid map has a bigger board)
  const flip = () => me === 1 ? -1 : 1;
  const PX = (x) => (Game.COLS * Game.TILE / 2 + x * flip()) * S;
  const PY = (y) => (Game.ROWS * Game.TILE / 2 - y * flip()) * S;
  const scol = (c) => me === 1 ? Game.COLS - 1 - c : c;   // model column -> screen column (and back)
  const srow = (r) => me === 1 ? Game.ROWS - 1 - r : r;
  const tilePx = () => Game.TILE * S;
  // size from health, but a leveled unit (2x, 3x health) only counts part of its extra health, and swarms
  // (5+ bodies) even less, so level 2 and 3 squads don't crowd the board
  const LEVEL_SIZE = [1, 0.8, 0.65], SWARM_SIZE = [1, 0.72, 0.56];
  const radius = (u) => Math.max(0.6, Math.min(2.4, 0.55 + Math.sqrt(u.hp * ((u.bodies >= 5 ? SWARM_SIZE : LEVEL_SIZE)[u.level | 0] || 1)) / 30)) * S;
  const teamCol = (side) => Art.teamCol(side, me);
  const upOf = (side) => side === me ? 1 : -1;

  // ---------- map backgrounds ----------
  // Each map's floor is painted once per board size onto a canvas of its own, then copied onto the board every
  // frame. paint(c, rr, t): the canvas context, a seeded random number generator (same picture every time), tile size in px.
  let mapBg = null;
  function mapBackground(id) {
    const key = id + W + 'x' + H;
    if (mapBg && mapBg.key === key) return mapBg.cv;
    const [seed, paint] = BACKGROUNDS[id];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const oc = document.createElement('canvas'); oc.width = Math.round(W * dpr); oc.height = Math.round(H * dpr);
    const c = oc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    let sd = seed; const rr = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
    paint(c, rr, tilePx());
    c.globalAlpha = 1;
    mapBg = { key, cv: oc };
    return oc;
  }
  // Forest Clearing: an open, faded green glade in the middle, with the edge of a dense forest
  // closing in on both flanks. Kept dark and muted so the squads stand out.
  function paintForest(c, rr, t) {
    // the clearing: a soft lighter patch in the middle of a dark green floor
    c.fillStyle = '#132219'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.62);
    gl.addColorStop(0, '#1F3923'); gl.addColorStop(0.55, '#1A301F'); gl.addColorStop(1, '#13241A');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // patches of slightly different greens and faint grass tufts
    const tints = ['#223D27', '#1B321F', '#26392A', '#182C1C'];
    for (let k = 0; k < 26; k++) {
      c.globalAlpha = 0.35; c.fillStyle = tints[k % tints.length];
      c.beginPath(); c.ellipse(t + rr() * (W - 2 * t), rr() * H, t * (0.6 + rr() * 1.4), t * (0.4 + rr() * 0.9), rr() * 3, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#3E5E40'; c.lineWidth = 1;
    for (let k = 0; k < 260; k++) {
      const x = rr() * W, y = rr() * H, h = 2 + rr() * 3;
      c.globalAlpha = 0.12 + rr() * 0.1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 1, y - h); c.moveTo(x, y); c.lineTo(x + 1.2, y - h * 0.8); c.stroke();
    }
    // the forest edge: shade darkening toward both sides of the board
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.6 : W - t * 1.6;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(6,14,9,0.85)'); sh.addColorStop(0.45, 'rgba(8,18,11,0.45)'); sh.addColorStop(1, 'rgba(8,18,11,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
    }
    // trees: crowded canopies at the very edge, thinning out toward the clearing
    const trees = [];
    for (const left of [true, false]) {
      for (let k = 0; k < Math.round(H / t * 5); k++) {
        const depth = rr() * rr();                       // most trees close to the edge
        const r = t * (0.28 + rr() * 0.3) * (1 - depth * 0.35);
        const dx = -t * 0.25 + depth * t * 1.15;          // from just past the edge to a little into column 2
        trees.push({ x: left ? dx : W - dx, y: rr() * (H + t) - t / 2, r, depth });
      }
    }
    trees.sort((a, b) => a.y - b.y);
    const leaf = ['#0B1C10', '#0F2414', '#132B18', '#17311C'];
    for (const tr of trees) { // shadow cast down and away from the clearing
      c.globalAlpha = 0.35; c.fillStyle = '#050B07';
      c.beginPath(); c.ellipse(tr.x + (tr.x < W / 2 ? -1 : 1) * tr.r * 0.15, tr.y + tr.r * 0.35, tr.r * 1.05, tr.r * 0.8, 0, 0, Math.PI * 2); c.fill();
    }
    for (const tr of trees) {
      const a = 0.92 - tr.depth * 0.45;                  // trees further into the clearing are fainter
      c.globalAlpha = a; c.fillStyle = leaf[Math.floor(rr() * leaf.length)];
      c.beginPath();
      for (let k = 0; k < 7; k++) { // a lumpy canopy: a ring of overlapping blobs
        const ang = k / 7 * Math.PI * 2, br = tr.r * (0.55 + rr() * 0.15);
        c.moveTo(tr.x + Math.cos(ang) * tr.r * 0.5 + br, tr.y + Math.sin(ang) * tr.r * 0.5);
        c.arc(tr.x + Math.cos(ang) * tr.r * 0.5, tr.y + Math.sin(ang) * tr.r * 0.5, br, 0, Math.PI * 2);
      }
      c.fill();
      c.globalAlpha = a * 0.3; c.fillStyle = '#2A4A2C'; // light from the top left
      c.beginPath(); c.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.3, tr.r * 0.45, 0, Math.PI * 2); c.fill();
    }
  }

  // Mushroom Cavern: a dim purple cave floor, darker rock shading the flanks, and faded glowing mushrooms
  // (big and small) scattered around.
  function paintCavern(c, rr, t) {
    c.fillStyle = '#16111D'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    gl.addColorStop(0, '#221A2C'); gl.addColorStop(0.6, '#1B1524'); gl.addColorStop(1, '#130F19');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // uneven rock floor: soft darker and lighter patches
    for (let k = 0; k < 30; k++) {
      c.globalAlpha = 0.3; c.fillStyle = k % 2 ? '#2A2033' : '#120E17';
      c.beginPath(); c.ellipse(rr() * W, rr() * H, t * (0.5 + rr() * 1.3), t * (0.3 + rr() * 0.8), rr() * 3, 0, Math.PI * 2); c.fill();
    }
    // the flanks: cave walls closing in, darker toward the edge, with rough boulders
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.5 : W - t * 1.5;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(5,3,8,0.9)'); sh.addColorStop(0.5, 'rgba(8,5,12,0.5)'); sh.addColorStop(1, 'rgba(8,5,12,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
      for (let k = 0; k < Math.round(H / t * 3); k++) {
        const depth = rr() * rr(), r = t * (0.25 + rr() * 0.3) * (1 - depth * 0.4), dx = -t * 0.2 + depth * t;
        const x = left ? dx : W - dx, y = rr() * H;
        c.globalAlpha = 0.8 - depth * 0.5; c.fillStyle = ['#0B0810', '#100C16', '#151019'][Math.floor(rr() * 3)];
        c.beginPath(); c.ellipse(x, y, r * 1.2, r, rr() * 3, 0, Math.PI * 2); c.fill();
        c.globalAlpha = (0.8 - depth * 0.5) * 0.35; c.fillStyle = '#2A2135'; // a faint lit edge
        c.beginPath(); c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.5, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // faded glowing mushrooms, big and small
    const shroom = (x, y, sz, a) => {
      const glow = c.createRadialGradient(x, y - sz * 0.4, 0, x, y - sz * 0.4, sz * 2.2);
      glow.addColorStop(0, 'rgba(176,110,240,0.35)'); glow.addColorStop(1, 'rgba(176,110,240,0)');
      c.globalAlpha = a; c.fillStyle = glow; c.beginPath(); c.arc(x, y - sz * 0.4, sz * 2.2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#6B5A78'; c.fillRect(x - sz * 0.13, y - sz * 0.5, sz * 0.26, sz * 0.75); // stem
      c.fillStyle = '#8A5DB8'; c.beginPath(); c.ellipse(x, y - sz * 0.5, sz * 0.6, sz * 0.38, 0, Math.PI, 0); c.fill(); // cap
      c.fillStyle = '#D2B4F2'; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(x + (k - 1) * sz * 0.25, y - sz * 0.68 + (k === 1 ? -sz * 0.06 : 0), sz * 0.06, 0, Math.PI * 2); c.fill(); }
    };
    const list = [];
    for (let k = 0; k < 34; k++) { // clusters: one bigger mushroom with a couple of small ones next to it
      const x = rr() * W, y = rr() * H, edge = Math.min(x, W - x) < t * 1.3;
      list.push({ x, y, sz: t * (edge ? 0.35 : 0.22 + rr() * 0.28), a: edge ? 0.26 : 0.16 });
      const n = Math.floor(rr() * 3);
      for (let j = 0; j < n; j++) list.push({ x: x + (rr() - 0.5) * t * 0.7, y: y + (rr() - 0.2) * t * 0.4, sz: t * (0.1 + rr() * 0.08), a: 0.18 });
    }
    list.sort((a, b) => a.y - b.y).forEach(q => shroom(q.x, q.y, q.sz, q.a));
  }
  // a mushroom tile: tinted tile with a small glowing mushroom in the tile's colour
  // Frozen Peak: a dark icy floor with snow drifts and cracks in the ice, and snow-capped rock on both flanks.
  // snow = false: Darkwoods (the same dark ground and rock, with no snow drifts, snow caps or snowflakes)
  function paintIce(c, rr, t, snow = true) {
    c.fillStyle = '#131B22'; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
    gl.addColorStop(0, '#1D2833'); gl.addColorStop(0.6, '#18212A'); gl.addColorStop(1, '#121920');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    // snow drifts: soft pale patches
    if (snow) for (let k = 0; k < 30; k++) {
      c.globalAlpha = 0.12 + rr() * 0.08; c.fillStyle = k % 3 ? '#3A4B5A' : '#4B5E6E';
      c.beginPath(); c.ellipse(rr() * W, rr() * H, t * (0.6 + rr() * 1.5), t * (0.25 + rr() * 0.5), (rr() - 0.5) * 0.6, 0, Math.PI * 2); c.fill();
    }
    // cracks in the ice
    c.strokeStyle = '#9FC3D9'; c.lineWidth = 0.8;
    for (let k = 0; k < 14; k++) {
      let x = t + rr() * (W - 2 * t), y = rr() * H;
      c.globalAlpha = 0.1 + rr() * 0.08; c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += (rr() - 0.5) * t * 0.9; y += (rr() - 0.5) * t * 0.9; c.lineTo(x, y); }
      c.stroke();
    }
    // the flanks: mountain rock rising on both sides, with snow on top
    for (const left of [true, false]) {
      const x0 = left ? 0 : W, x1 = left ? t * 1.5 : W - t * 1.5;
      const sh = c.createLinearGradient(x0, 0, x1, 0);
      sh.addColorStop(0, 'rgba(6,9,12,0.9)'); sh.addColorStop(0.5, 'rgba(8,12,16,0.5)'); sh.addColorStop(1, 'rgba(8,12,16,0)');
      c.globalAlpha = 1; c.fillStyle = sh; c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
      const rocks = [];
      for (let k = 0; k < Math.round(H / t * 2.6); k++) {
        const depth = rr() * rr(), r = t * (0.3 + rr() * 0.35) * (1 - depth * 0.4), dx = -t * 0.2 + depth * t * 1.05;
        rocks.push({ x: left ? dx : W - dx, y: rr() * (H + t) - t / 2, r, depth });
      }
      rocks.sort((a, b) => a.y - b.y);
      for (const q of rocks) {
        const a = 0.9 - q.depth * 0.5;
        c.globalAlpha = a; c.fillStyle = ['#0D1318', '#111920', '#151E26'][Math.floor(rr() * 3)];
        c.beginPath(); // a jagged rock
        for (let j = 0; j < 6; j++) { const ang = j / 6 * Math.PI * 2 + rr() * 0.4, rad = q.r * (0.75 + rr() * 0.35); const px = q.x + Math.cos(ang) * rad, py = q.y + Math.sin(ang) * rad * 0.8; j ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.closePath(); c.fill();
        if (!snow) continue;
        c.globalAlpha = a * 0.45; c.fillStyle = '#C8D7E2'; // snow cap
        c.beginPath(); c.ellipse(q.x - q.r * 0.1, q.y - q.r * 0.45, q.r * 0.55, q.r * 0.2, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // a few snowflakes
    c.fillStyle = '#DCE8F0';
    if (snow) for (let k = 0; k < 120; k++) { c.globalAlpha = 0.08 + rr() * 0.14; c.beginPath(); c.arc(rr() * W, rr() * H, 0.6 + rr() * 0.9, 0, Math.PI * 2); c.fill(); }
  }
  const BACKGROUNDS = { forest: [1234567, paintForest], cavern: [7654321, paintCavern], ice: [4242421, paintIce], darkwoods: [4242421, (c, rr, t) => paintIce(c, rr, t, false)] };
  // ---------- terrain: a map's ground height, water, walls, shallow water and bushes (Game.TERRAIN) ----------
  // Painted once per map, board size and side onto a canvas of its own, then copied onto the board every frame.
  // Height is light and shade: higher ground lighter, lower darker, slopes lit from the top left, as Game.groundHeight
  // has it (ramps where raised ground meets walkable ground). A tile with a form (line, corner, diagonal, edge wall)
  // is drawn as that line.
  const TERRAIN_LOOK = { '~': { fill: '#1C5873', line: '#4FA9C9' }, s: { fill: '#2B7A93', line: '#7CC3D8' }, '#': { fill: '#2C3A44', line: '#55707F' }, b: { fill: '#24502A', line: '#4C8A4F' } };
  let terBg = null;
  function terrainLayer(v) {
    const key = v.map.id + ':' + W + 'x' + H + ':' + me;
    if (terBg && terBg.key === key) return terBg.cv;
    const dpr = Math.min(2, window.devicePixelRatio || 1), t = tilePx(), C = Game.COLS, R = Game.ROWS, T = Game.TILE, step = Game.TERRAIN.step;
    const oc = document.createElement('canvas'); oc.width = Math.round(W * dpr); oc.height = Math.round(H * dpr);
    const c = oc.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // a model point (in tiles from the board's top left) on this screen, and its height
    const sx = (X) => (me === 1 ? C - X : X) * t, sy = (Y) => (me === 1 ? R - Y : Y) * t;
    const hAt = (X, Y) => Game.groundHeight(v, (X - C / 2) * T, (R / 2 - Y) * T) / step;
    // ground height: n samples a tile, each lighter or darker by its level and its slope, drawn as a small picture
    // stretched over the board (so it blends smoothly)
    const n = 4, d = 1 / n, hc = document.createElement('canvas'); hc.width = C * n; hc.height = R * n;
    const hg = hc.getContext('2d'), img = hg.createImageData(C * n, R * n);
    for (let j = 0; j < R * n; j++) for (let i = 0; i < C * n; i++) {
      const X = (i + 0.5) * d, Y = (j + 0.5) * d, h = hAt(X, Y);
      const lit = (hAt(X - d, Y - d) - hAt(X + d, Y + d)) * (me === 1 ? -1 : 1); // the slope, facing the light (top left on screen)
      const k = Math.max(-0.4, Math.min(0.4, (h > 0 ? 0.075 * h : 0.1 * h) + lit * 0.45)); // lighter or darker
      const q = ((me === 1 ? R * n - 1 - j : j) * C * n + (me === 1 ? C * n - 1 - i : i)) * 4;
      if (k > 0) { img.data[q] = 242; img.data[q + 1] = 230; img.data[q + 2] = 196; } // (black otherwise)
      img.data[q + 3] = Math.round(Math.abs(k) * 255);
    }
    hg.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(hc, 0, 0, W, H);
    // a faint rim along the edges of raised and lowered ground
    c.globalAlpha = 0.35; c.lineWidth = 1;
    for (let row = 0; row < R; row++) for (let col = 0; col < C; col++) {
      const h = Game.terrainTile(v, col, row).h;
      if (!h) continue;
      for (const [dc, dr, ax, ay, bx, by] of [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]]) {
        const o = Game.terrainTile(v, col + dc, row + dr);
        if (col + dc < 0 || col + dc >= C || row + dr < 0 || row + dr >= R || o.h === h || o.ch === '~' || o.ch === '#') continue;
        c.strokeStyle = h > o.h ? '#F7EBCB' : '#000000';
        c.beginPath(); c.moveTo(sx(col + ax), sy(row + ay)); c.lineTo(sx(col + bx), sy(row + by)); c.stroke();
      }
    }
    // water, walls, shallow water and bushes
    let sd = 99; const rr = () => { sd = (sd * 1103515245 + 12345) % 2147483648; return sd / 2147483648; };
    for (let row = 0; row < R; row++) for (let col = 0; col < C; col++) {
      const tl = Game.terrainTile(v, col, row), look = TERRAIN_LOOK[tl.ch];
      if (!look) continue;
      const x = Math.min(sx(col), sx(col + 1)), y = Math.min(sy(row), sy(row + 1)), path = Game.SHAPE_PATH[tl.shape];
      if (path) { // a form: a thick line through the tile (turned round with the board for side 1)
        const pts = path.map(([u, w]) => [sx(col + u), sy(row + w)]), wide = '▔▕▁▏'.includes(tl.shape) ? 0.2 : 0.34;
        c.lineCap = 'round'; c.lineJoin = 'round';
        c.beginPath(); pts.forEach(([px, py], k) => k ? c.lineTo(px, py) : c.moveTo(px, py));
        c.globalAlpha = 0.95; c.strokeStyle = look.fill; c.lineWidth = t * wide; c.stroke();
        c.globalAlpha = 0.6; c.strokeStyle = look.line; c.lineWidth = Math.max(1, t * 0.04); c.stroke();
        continue;
      }
      const same = (dc, dr) => { const o = Game.terrainTile(v, col + dc, row + dr); return col + dc < 0 || col + dc >= C || row + dr < 0 || row + dr >= R || (o.ch === tl.ch && o.shape === '.'); };
      c.globalAlpha = tl.ch === 'b' ? 0.85 : 0.95; c.fillStyle = look.fill; c.fillRect(x, y, t, t);
      if (tl.ch === '~' || tl.ch === 's') { // ripples
        c.strokeStyle = '#BFE6F2'; c.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const px = x + t * (0.15 + rr() * 0.6), py = y + t * (0.2 + rr() * 0.65), w = t * (0.12 + rr() * 0.15);
          c.globalAlpha = 0.22; c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + w / 2, py - t * 0.05, px + w, py); c.stroke();
        }
      }
      if (tl.ch === '#') { c.globalAlpha = 0.5; c.fillStyle = '#6D8796'; c.fillRect(x + t * 0.08, y + t * 0.08, t * 0.84, t * 0.18); } // a lit top
      if (tl.ch === 'b') for (let k = 0; k < 5; k++) { // leafy clumps
        c.globalAlpha = 0.55; c.fillStyle = k % 2 ? '#3A7A3E' : '#2F6533';
        c.beginPath(); c.arc(x + t * (0.2 + rr() * 0.6), y + t * (0.2 + rr() * 0.6), t * (0.14 + rr() * 0.08), 0, Math.PI * 2); c.fill();
      }
      // its shore or edge: a light line where it meets other ground
      c.globalAlpha = 0.7; c.strokeStyle = look.line; c.lineWidth = Math.max(1, t * 0.05);
      for (const [dc, dr, ax, ay, bx, by] of [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]]) {
        if (same(dc, dr)) continue;
        c.beginPath(); c.moveTo(sx(col + ax), sy(row + ay)); c.lineTo(sx(col + bx), sy(row + by)); c.stroke();
      }
    }
    c.globalAlpha = 1;
    terBg = { key, cv: oc };
    return oc;
  }
  // the map objective's zone (the Bridge): a dashed gold line round it; in a fight, in the colour of whoever holds it
  // (solid once it is won)
  function drawObjective(v) {
    const t = tilePx(), set = new Set(Game.objectiveTiles(v).map(q => q.col + ',' + q.row));
    const o = phase === 'battle' && bt && bt.objective ? bt.objective() : null, who = o ? (o.won >= 0 ? o.won : o.lead) : -1;
    ctx.strokeStyle = who >= 0 ? teamCol(who) : css('--gold'); ctx.globalAlpha = 0.9; ctx.lineWidth = Math.max(1.5, t * 0.05);
    if (!(o && o.won >= 0)) ctx.setLineDash([t * 0.16, t * 0.1]);
    ctx.beginPath();
    for (const k of set) {
      const [col, row] = k.split(',').map(Number), x = scol(col) * t, y = srow(row) * t;
      for (const [dc, dr, ax, ay, bx, by] of [[0, -1, 0, 0, 1, 0], [1, 0, 1, 0, 1, 1], [0, 1, 0, 1, 1, 1], [-1, 0, 0, 0, 0, 1]]) {
        if (set.has((col + dc) + ',' + (row + dr))) continue;
        const f = me === 1 ? -1 : 1, ox = f === 1 ? 0 : 1, oy = f === 1 ? 0 : 1; // the board is turned round for side 1
        ctx.moveTo(x + Math.abs(ox - ax) * t, y + Math.abs(oy - ay) * t); ctx.lineTo(x + Math.abs(ox - bx) * t, y + Math.abs(oy - by) * t);
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
    // in a fight, how long it has been held, as a bar along its near end
    if (o && o.won < 0 && o.lead >= 0) {
      const xs = [...set].map(k => scol(+k.split(',')[0]) * t), ys = [...set].map(k => srow(+k.split(',')[1]) * t);
      const x0 = Math.min(...xs), x1 = Math.max(...xs) + t, y1 = Math.max(...ys) + t;
      ctx.fillStyle = teamCol(o.lead); ctx.fillRect(x0, y1 + 2, (x1 - x0) * Math.min(1, o.hold / o.secs), Math.max(3, t * 0.08));
    }
    ctx.globalAlpha = 1;
  }
  // ---------- 2v2 artifacts (docs/MPB-2V2.md) ----------
  // While deploying, from the board state: m.artifacts = { round, list: [{ id, col, row, card }] } in the round they stand
  // in. In a fight, from the battle: bt.artifacts() = [{ x, y, r, cap, pts: [a, b], rate, locked, won }] (Engine
  // opts.artifacts). Each: a glowing orb on its spot and a dashed ring as wide as its circle; in a fight a round meter
  // round the orb: your team's bar (--you, blue) climbs the left half from the bottom, theirs (--foe, red) the right
  // half, each to the top at the cap (both phones see their own team in blue, as for everything else on the board);
  // locked: the ring and meter in the winner's colour (white for nobody) and a small lock over the orb.
  const ART_COL = '#CDB8FF';
  const artR = () => (typeof Engine !== 'undefined' && Engine.ARTIFACT ? Engine.ARTIFACT.r : 9);
  function artifactsShown() {
    if (bt && bt.artifacts && (phase === 'battle' || phase === 'result' || phase === 'end')) return bt.artifacts();
    const a = m && m.artifacts;
    if (!a || a.round !== m.round || !Array.isArray(a.list)) return [];
    return a.list.map(q => { const w = Game.tileToWorld(q.col, q.row); return { x: w.x, y: w.y, r: artR(), cap: 0, pts: null, locked: false, won: -1 }; });
  }
  function drawArtifacts() {
    const t = tilePx(), now = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
    for (const a of artifactsShown()) {
      const x = PX(a.x), y = PY(a.y), col = a.locked ? (a.won >= 0 ? teamCol(a.won) : '#F4F1E6') : ART_COL;
      ctx.strokeStyle = col; ctx.globalAlpha = a.locked ? 0.7 : 0.55; ctx.lineWidth = Math.max(1.5, t * 0.04);
      if (!a.locked) ctx.setLineDash([t * 0.18, t * 0.12]);
      ctx.beginPath(); ctx.arc(x, y, a.r * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.globalAlpha = 0.06; ctx.fill();
      // the orb: a soft halo and a bright core
      const pr = t * 0.26 * (1 + 0.06 * Math.sin(now * 3 + a.x));
      const grd = ctx.createRadialGradient(x, y, 0, x, y, pr * 2.2);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.35, col); grd.addColorStop(1, 'rgba(205,184,255,0)');
      ctx.globalAlpha = a.locked ? 0.6 : 0.95; ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, pr * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, pr * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function artifactMeters() {
    const t = tilePx(), R = t * 0.42, lw = Math.max(3, t * 0.09);
    for (const a of artifactsShown()) {
      if (!a.pts) continue;
      const x = PX(a.x), y = PY(a.y), share = (sd) => Math.max(0, Math.min(1, a.pts[sd] / a.cap)), B = Math.PI / 2;
      ctx.lineWidth = lw; ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(8,12,14,0.75)'; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
      if (a.locked) { ctx.strokeStyle = a.won >= 0 ? teamCol(a.won) : '#F4F1E6'; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke(); }
      else {
        const mine = share(me), theirs = share(foe());
        if (mine > 0) { ctx.strokeStyle = teamCol(me); ctx.beginPath(); ctx.arc(x, y, R, B, B + mine * Math.PI); ctx.stroke(); } // up the left from the bottom
        if (theirs > 0) { ctx.strokeStyle = teamCol(foe()); ctx.beginPath(); ctx.arc(x, y, R, B - theirs * Math.PI, B); ctx.stroke(); } // up the right
        ctx.strokeStyle = 'rgba(244,241,230,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - R - lw * 0.7); ctx.lineTo(x, y - R + lw * 0.7); ctx.stroke(); // the cap, at the top
      }
      if (a.locked) { // a small padlock over the orb
        const s = Math.max(5, t * 0.13), lx = x, ly = y - R - s * 1.2;
        ctx.fillStyle = a.won >= 0 ? teamCol(a.won) : '#F4F1E6'; ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = Math.max(1.5, s * 0.28);
        ctx.beginPath(); ctx.arc(lx, ly - s * 0.25, s * 0.5, Math.PI, 0); ctx.stroke();
        ctx.fillRect(lx - s * 0.75, ly - s * 0.25, s * 1.5, s * 1.1);
        ctx.fillStyle = 'rgba(8,12,14,0.85)'; ctx.fillRect(lx - s * 0.1, ly + s * 0.1, s * 0.2, s * 0.4);
      }
    }
  }
  const ICE_COL = '#BFE3F5';
  // the storm band (a faint frost) and this round's hail tiles (animated during the fight)
  function drawStorm(v) {
    const t = tilePx(), rows = Game.stormRows(v);
    const y0 = Math.min(...rows.map(srow)) * t;
    ctx.fillStyle = ICE_COL; ctx.globalAlpha = 0.05; ctx.fillRect(0, y0, W, rows.length * t);
    ctx.strokeStyle = ICE_COL; ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.setLineDash([2, 5]);
    ctx.strokeRect(1, y0 + 1, W - 2, rows.length * t - 2); ctx.setLineDash([]);
    const time = phase === 'battle' && bt ? bt.time() : 0;
    for (const h of Game.hailTiles(v)) {
      const x = scol(h.col) * t, y = srow(h.row) * t;
      ctx.fillStyle = ICE_COL; ctx.globalAlpha = 0.16; ctx.fillRect(x, y, t, t);
      ctx.strokeStyle = ICE_COL; ctx.globalAlpha = 0.5; ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
      // hailstones: falling streaks during the fight, resting pellets while deploying
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, t, t); ctx.clip();
      for (let k = 0; k < 6; k++) {
        const fx = ((k * 0.37 + h.col * 0.13) % 1), sp = 0.9 + (k % 3) * 0.25;
        const fy = time ? (time * sp + k * 0.21 + h.row * 0.07) % 1 : ((k * 0.53 + h.row * 0.29) % 1);
        const px = x + fx * t, py = y + fy * t;
        ctx.globalAlpha = 0.7;
        if (time) { ctx.strokeStyle = '#EAF6FF'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(px + t * 0.06, py - t * 0.16); ctx.lineTo(px, py); ctx.stroke(); }
        ctx.fillStyle = '#EAF6FF'; ctx.beginPath(); ctx.arc(px, py, Math.max(1, t * 0.035), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // the altar of ice: a cluster of pale ice shards on a frosted plinth, in the middle of the board
  function drawAltar() {
    const x = W / 2, y = H / 2, s = tilePx();
    const glow = ctx.createRadialGradient(x, y, 0, x, y, s * 1.1);
    glow.addColorStop(0, 'rgba(191,227,245,0.35)'); glow.addColorStop(1, 'rgba(191,227,245,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, s * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5E7C8E'; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.28, s * 0.42, s * 0.14, 0, 0, Math.PI * 2); ctx.fill();
    const shard = (dx, h, w, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + dx - w, y + s * 0.26); ctx.lineTo(x + dx, y + s * 0.26 - h); ctx.lineTo(x + dx + w, y + s * 0.26); ctx.closePath(); ctx.fill(); };
    ctx.globalAlpha = 0.95;
    shard(-s * 0.2, s * 0.45, s * 0.1, '#9CCBE3'); shard(s * 0.2, s * 0.5, s * 0.1, '#9CCBE3');
    shard(0, s * 0.75, s * 0.14, '#D8F0FB');
    ctx.strokeStyle = '#FFFFFF'; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.26 - s * 0.75); ctx.lineTo(x - s * 0.04, y + s * 0.1); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // ice walls around a tower: one arc per side, fading as it takes hits. walls = [north, east, south, west] (world)
  function drawWalls(wx, wy, walls) {
    const t = tilePx();
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    walls.forEach((n, k) => {
      if (!(n > 0)) return;
      const cx = PX(wx + dirs[k][0] * Game.TILE * 0.5), cy = PY(wy + dirs[k][1] * Game.TILE * 0.5);
      const horiz = Math.abs(PX(wx + dirs[k][0]) - PX(wx)) < 1e-6; // a wall facing up/down on screen lies flat
      ctx.globalAlpha = 0.35 + 0.55 * n / Game.ICE.wallHits; ctx.fillStyle = '#CFEAF7'; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1;
      const L = t * 0.8, D = t * 0.12;
      if (horiz) { ctx.fillRect(cx - L / 2, cy - D / 2, L, D); ctx.strokeRect(cx - L / 2, cy - D / 2, L, D); }
      else { ctx.fillRect(cx - D / 2, cy - L / 2, D, L); ctx.strokeRect(cx - D / 2, cy - L / 2, D, L); }
    });
    ctx.globalAlpha = 1;
  }
  // what this screen may show of the opponent (see Game.charShown)
  const deploying = () => phase === 'deploy';
  const altarShown = (v, b) => Game.altarShown(v, me, deploying(), b);
  const shroomShown = (v, col, row) => Game.shroomShown(v, me, deploying(), col, row);
  const myRemovalNow = (col, row) => Game.removingShroom(m, me, deploying(), col, row);
  const towerVisible = (side) => !!(m && m.towers && m.towers[side]);
  const charVisible = (side) => Game.charShown(m, me, deploying(), side);
  const towerTypeVisible = (side) => Game.towerTypeShown(m, me, deploying(), side);
  const elfOwnShown = (v, sd) => Game.elfOwnShown(v, me, deploying(), sd);
  // who the flag shows ahead in the bribe-off: while deploying, this round's bribes (either player's) don't count
  // yet, as the opponent's stay hidden until the fight; from the fight on, every bribe counts
  const bribeLeadShown = (v) => Game.bribeLeader(v, deploying());
  const drawKeep = (x, y, s, side, hpr, kind, g, crest) => Art.keep(g || ctx, x, y, s, teamCol(side), hpr, kind, crest);
  function drawShroomTile(tl) {
    const t = tilePx(), x = scol(tl.col) * t, y = srow(tl.row) * t, col = SHROOM_COL[tl.type];
    ctx.fillStyle = col; ctx.globalAlpha = 0.13; ctx.fillRect(x, y, t, t);
    ctx.strokeStyle = col; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3);
    const cx = x + t / 2, cy = y + t * 0.62, sz = t * 0.34;
    const glow = ctx.createRadialGradient(cx, cy - sz * 0.4, 0, cx, cy - sz * 0.4, sz * 1.4);
    glow.addColorStop(0, col); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.22; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy - sz * 0.4, sz * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#CFC3D6'; ctx.fillRect(cx - sz * 0.12, cy - sz * 0.5, sz * 0.24, sz * 0.7);
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(cx, cy - sz * 0.5, sz * 0.62, sz * 0.4, 0, Math.PI, 0); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // plain: only the land itself (the map, mushrooms, the storm), without zones, grid or tile markers
  function drawBoard(plain = false) {
    const t = tilePx();
    const Z = Game.ZONE, mine = (Game.ROWS - Z) * t;
    const v = phase === 'battle' && battlePre ? battlePre : m; // during a fight: the board as it was when the fight began, not the next round's
    const mp = Game.mapOf(v);
    const lk = opts.look ? opts.look(v) : null, bgId = lk ? lk.bg : mp && mp.id, own = bgId && BACKGROUNDS[bgId];
    if (own) ctx.drawImage(mapBackground(bgId), 0, 0, W, H);
    else if (!(opts.ground && lk && lk.floor && opts.ground(ctx, W, H, t, lk.floor))) { ctx.fillStyle = css('--board'); ctx.fillRect(0, 0, W, H); }
    const lit = !own && !!opts.ground; // the 3D board's meadow: darker grid lines, stronger zone tints
    if (mp && mp.terrain) ctx.drawImage(terrainLayer(v), 0, 0, W, H);
    if (mp && mp.objective) drawObjective(v);
    if (!plain) {
      ctx.globalAlpha = lit ? opts.zoneA : 0.08;
      ctx.fillStyle = css('--foe'); ctx.fillRect(0, 0, W, t * Z);
      ctx.fillStyle = css('--you'); ctx.fillRect(0, mine, W, t * Z);
      if (v) for (const side of [0, 1]) { // flank tiles inside the other zone: reserved from the start, usable from round 3
        ctx.fillStyle = side === me ? css('--you') : css('--foe'); ctx.globalAlpha = Game.flankOpen(v) ? 0.22 : 0.12;
        for (const { col, row } of Game.flankTiles(side)) ctx.fillRect(scol(col) * t, srow(row) * t, t, t);
      }
    }
    ctx.globalAlpha = 1;
    if (Game.isIce(v)) { drawStorm(v); if (phase === 'deploy' && Game.altarRound(v)) drawAltar(); } // the altar only stands while deploying
    if (mp && mp.shrooms) for (const tl of v.map.tiles || []) {
      if (shroomShown(v, tl.col, tl.row)) drawShroomTile(tl);
      else if (!plain && myRemovalNow(tl.col, tl.row)) { // removed by you this round: a faint dashed outline until the fight
        const t = tilePx(), x = scol(tl.col) * t, y = srow(tl.row) * t;
        ctx.strokeStyle = SHROOM_COL[tl.type]; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.strokeRect(x + 2.5, y + 2.5, t - 5, t - 5); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    }
    if (v && v.dev) devFloor(v, plain);
    if (v && v.mpb) drawMpbFloor(v); // 2v2 buildings on the floor (the Oak's moss)
    if (v && !plain && phase === 'deploy') aimFloor(v);
    if (plain) return;
    if (v && v.buff) for (const side of [0, 1]) { // Zoe's buff tiles: a gold tile with a star
      if (!charVisible(side)) continue;
      for (const b of v.buff[side] || []) {
        const x = scol(b.col) * t, y = srow(b.row) * t;
        ctx.fillStyle = css('--gold'); ctx.globalAlpha = 0.16; ctx.fillRect(x, y, t, t);
        ctx.globalAlpha = 0.75; ctx.font = `${Math.round(t * 0.42)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('★', x + t / 2, y + t / 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = lit ? opts.grid : 'rgba(200, 230, 225, 0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < Game.COLS; i++) { ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, H); ctx.stroke(); }
    for (let i = 1; i < Game.ROWS; i++) { ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(W, i * t); ctx.stroke(); }
    ctx.setLineDash([5, 6]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = css('--foe'); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(0, t * Z); ctx.lineTo(W, t * Z); ctx.stroke();
    ctx.strokeStyle = css('--you');
    ctx.beginPath(); ctx.moveTo(0, mine); ctx.lineTo(W, mine); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // ---------- Factions devtest: spells, arrows, the tower's tile, where things may go (on the floor, so the 3D board
  // gets them too), and buildings ----------
  const ZONE_COL = { burn: '#E07A4F', mend: '#7FCB8A', mud: '#9C8456', haste: '#E6D27A' };
  function devFloor(v, plain) {
    const t = tilePx(), deploying = phase === 'deploy';
    for (const c of Game.activeCasts(v)) {
      if (!Game.devShown(v, me, deploying, c.side, c.round)) continue;
      const sp = Game.devSpell(c.id) || {}, team = teamCol(c.side);
      if (sp.kind === 'zone') for (const tl of Game.castTiles(c)) {
        const x = scol(tl.col) * t, y = srow(tl.row) * t;
        ctx.fillStyle = ZONE_COL[sp.effect] || '#C9B79C'; ctx.globalAlpha = 0.3; ctx.fillRect(x, y, t, t);
        ctx.globalAlpha = 0.7; ctx.strokeStyle = team; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 1.5, y + 1.5, t - 3, t - 3); ctx.setLineDash([]);
      }
      if (sp.kind === 'strike') { // where it will land: a dashed ring of its radius and a cross
        const w = Game.tileToWorld(c.col, c.row), x = PX(w.x), y = PY(w.y), r = (+sp.radius || 6) * S;
        ctx.strokeStyle = '#E8A15A'; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = team; ctx.beginPath(); ctx.moveTo(x - t * 0.25, y); ctx.lineTo(x + t * 0.25, y); ctx.moveTo(x, y - t * 0.25); ctx.lineTo(x, y + t * 0.25); ctx.stroke();
      }
      if (sp.kind === 'wall' && deploying) drawWallBlock(PX(Game.tileToWorld(c.col, c.row).x), PY(Game.tileToWorld(c.col, c.row).y), t, c.side, 1);
    }
    ctx.globalAlpha = 1;
    // the tower's tile before the tower stands (rounds 1 and 2)
    if (v.towers) for (const side of [0, 1]) if (v.towers[side] && !Game.towerUp(v, side)) {
      const x = scol(v.towers[side].col) * t, y = srow(v.towers[side].row) * t;
      ctx.strokeStyle = teamCol(side); ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.strokeRect(x + 4, y + 4, t - 8, t - 8); ctx.setLineDash([]);
      ctx.fillStyle = teamCol(side); ctx.font = `600 ${Math.max(8, Math.round(t * 0.24))}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('R' + Game.TOWER_PICK_ROUND, x + t / 2, y + t / 2); ctx.globalAlpha = 1;
    }
    if (plain || !deploying) return;
    // your arrows, and the one being drawn
    for (const sq of v.armies[me]) if (sq.guide && !(dev && dev.guideId === sq.id)) drawArrow(v, sq, sq.guide, 0.75);
    if (dev && dev.guideId != null && dev.guide) { const sq = v.armies[me].find(q => q.id === dev.guideId); if (sq) drawArrow(v, sq, dev.guide, 1); }
    if (!dev || !editable) return;
    if (dev.bPlacing != null) { // where the building may go
      const b = Game.lessersOf(v, me).find(x => x.key === dev.bPlacing), d = b && Game.devBuilding(b.id);
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
      if (b) for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) if (Game.lesserSpotOk(v, me, d, c, row, b.key)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
    }
    if (dev.castMode) { // where the spell may go
      const sp = Game.devSpell(dev.castMode);
      ctx.strokeStyle = '#E8A15A'; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) if (Game.castSpotOk(v, me, sp, c, row)) ctx.strokeRect(scol(c) * t + 4, srow(row) * t + 4, t - 8, t - 8);
    }
    ctx.globalAlpha = 1;
  }
  // an older squad being moved (dragged, or picked with Move): (col, row) -> null where its move would be refused, 'dim'
  // where only the paid move gets there though a free one is left (March order's reach, Game.MARCH), else true; null
  // (no squad being moved, or one that moves for free): every tile as before (2026-11-07)
  function moveKinds() {
    const id = drag && drag.moved && drag.id != null ? drag.id : moving, sq = id != null && m.armies[me].find(q => q.id === id);
    if (!sq || sq.round === m.round || Game.freeMover(m, me, sq) || Game.freeOut(m, me, sq)) return null;
    const left = sq.luckMove === m.round || Game.freeMovesLeft(m, me) > 0;
    return (c, r) => { const k = Game.moveKind(m, me, sq, c, r); return k === 'free' ? true : k === 'paid' ? (left ? 'dim' : true) : null; };
  }
  // melee squads' direction arrows (Game.AIM), yours only: each squad's, and while one is being set (aim: { id, end })
  // how far it may go (a dashed ring of AIM.maxTiles tiles; on a flank a dashed square, Game.aimCap) and the arrow to the
  // tile under the finger, cut down as it will be
  function aimFloor(v) {
    const draft = aim && v.armies[me].find(q => q.id === aim.id);
    for (const sq of v.armies[me]) if (sq.aim && sq !== draft && Game.canAim(v, me, sq)) drawArrow(v, sq, [Game.aimEnd(v, sq)], 0.75);
    if (duo) { // 2v2: your teammate's, in their colour, thinner (checked as on their own board: their squads on your side)
      const tv = { ...v, armies: v.armies.slice() }; tv.armies[me] = Game.teamArmy(v, me);
      for (const sq of tv.armies[me]) if (sq.aim && Game.canAim(tv, me, sq)) drawArrow(tv, sq, [Game.aimEnd(tv, sq)], 0.7, duo.ring(me, 1 - duo.lane), true);
    }
    if (!draft) return;
    const t = tilePx(), cx = (scol(draft.col) + 0.5) * t, cy = (srow(draft.row) + 0.5) * t;
    ctx.strokeStyle = css('--you'); ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
    const n = Game.aimCap(v, draft, me); // a flank squad (2026-11-07): the square of tiles it may reach
    ctx.beginPath(); if (n) ctx.rect(cx - (n + 0.5) * t, cy - (n + 0.5) * t, (2 * n + 1) * t, (2 * n + 1) * t); else ctx.arc(cx, cy, Game.AIM.maxTiles * t, 0, Math.PI * 2);
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    const end = aim.end ? Game.aimTo(v, draft, aim.end.col, aim.end.row) : Game.aimEnd(v, draft);
    if (end) drawArrow(v, draft, [end], 1);
  }
  // a squad's arrow: from its tile through its points, with a head at the end, and the squad's speed written along
  // its longest leg
  // col, thin (2v2): a teammate's arrow, in their colour, thinner with shorter dashes
  function drawArrow(v, sq, pts, a, col, thin) {
    const t = tilePx(), at = (p) => [(scol(p.col) + 0.5) * t, (srow(p.row) + 0.5) * t];
    const list = [sq, ...pts].map(at).filter((p, i, l) => !i || p[0] !== l[i - 1][0] || p[1] !== l[i - 1][1]);
    if (list.length < 2) return;
    const c = col || css('--you');
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.globalAlpha = a; ctx.lineWidth = thin ? Math.max(1.2, t * 0.04) : Math.max(2, t * 0.08); ctx.lineJoin = 'round'; ctx.setLineDash(thin ? [t * 0.09, t * 0.11] : [t * 0.18, t * 0.12]);
    ctx.beginPath(); ctx.moveTo(...list[0]); for (const p of list.slice(1)) ctx.lineTo(...p); ctx.stroke(); ctx.setLineDash([]);
    const [x2, y2] = list[list.length - 1], [x1, y1] = list[list.length - 2], ang = Math.atan2(y2 - y1, x2 - x1), h = t * 0.32;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(ang - 0.5), y2 - h * Math.sin(ang - 0.5)); ctx.lineTo(x2 - h * Math.cos(ang + 0.5), y2 - h * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
    const u = thin ? units[sq.unit] : Game.unitFor(v, me, sq.unit, sq); // a teammate's skills are theirs: their base speed
    if (u && u.speed > 0) {
      let k = 1, best = 0;
      for (let i = 1; i < list.length; i++) { const d = Math.hypot(list[i][0] - list[i - 1][0], list[i][1] - list[i - 1][1]); if (d > best) { best = d; k = i; } }
      const [ax, ay] = list[k - 1], [bx, by] = list[k];
      let rot = Math.atan2(by - ay, bx - ax);
      if (rot > Math.PI / 2 || rot < -Math.PI / 2) rot += Math.PI; // never upside down
      const txt = `${Math.round(u.speed * 10) / 10} m/s`, fs = Math.max(10, Math.round(t * 0.3));
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2); ctx.rotate(rot); ctx.translate(0, -t * 0.24); // just beside the line
      ctx.font = `600 ${fs}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = a; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(11,15,17,0.85)'; ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = c; ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // a lesser building: a small house in its faction's colour with a roof in its side's colour (hpr: health left in a fight)
  function drawLesser(x, y, t, side, u, hpr, fresh, dim) {
    const s = t * 0.62, c = teamCol(side);
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.fillStyle = u.color || '#B7AE9C'; ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - s / 2, y - s * 0.2, s, s * 0.62); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x - s * 0.62, y - s * 0.18); ctx.lineTo(x, y - s * 0.62); ctx.lineTo(x + s * 0.62, y - s * 0.18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css('--bg'); ctx.fillRect(x - s * 0.1, y + s * 0.12, s * 0.2, s * 0.3);
    if (hpr != null) { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, t * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke(); }
    if (fresh) { ctx.strokeStyle = c; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(x - t / 2 + 1.5, y - t / 2 + 1.5, t - 3, t - 3); ctx.setLineDash([]); }
    if (t >= 26 && u.name) { ctx.font = `500 ${Math.max(8, Math.round(t * 0.24))}px "IBM Plex Mono", monospace`; ctx.fillStyle = css('--ink'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.globalAlpha = dim ? 0.35 : 0.85; ctx.fillText(tag(u), x, y + t / 2 - 1); }
    ctx.globalAlpha = 1;
  }
  // the treasuries (Test Grid): faint in round 1, before they are built
  function drawTreasuries() {
    const t = tilePx(), u = Game.treasuryUnit();
    for (const side of [me, foe()]) { const ts = Game.treasurySpot(m, side); if (ts) drawLesser((scol(ts.col) + 0.5) * t, (srow(ts.row) + 0.5) * t, t, side, u, null, false, !Game.treasuryUp(m)); }
  }
  // a defensive wall (the bastion's): a block of stone filling its tile, edged in its side's colour
  // a defensive wall along a tile's edge, centred on (x, y): lying across the screen, or up it (upright)
  function drawStoneWall(x, y, t, side, hpr, fresh, upright) {
    const L = t + 2, h = Math.max(4, t * Game.BWALL.thick / Game.TILE), w = upright ? h : L, hh = upright ? L : h;
    ctx.globalAlpha = 0.55 + 0.45 * hpr;
    ctx.fillStyle = '#8E8676'; ctx.fillRect(x - w / 2, y - hh / 2, w, hh);
    ctx.strokeStyle = 'rgba(40, 36, 30, 0.55)'; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); if (upright) { ctx.moveTo(x - w / 2, y - hh / 2 + k * hh / 4); ctx.lineTo(x + w / 2, y - hh / 2 + k * hh / 4); } else { ctx.moveTo(x - w / 2 + k * w / 4, y - hh / 2); ctx.lineTo(x - w / 2 + k * w / 4, y + hh / 2); } ctx.stroke(); } // the blocks
    ctx.strokeStyle = teamCol(side); ctx.lineWidth = 2; ctx.setLineDash(fresh ? [3, 3] : []); ctx.strokeRect(x - w / 2, y - hh / 2, w, hh); ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  // a wall's edge on the screen: the middle of it and whether it runs up the screen
  function wallSpot(side, bw, t) {
    const e = Game.edgeOf(side, bw), [dc, dr] = Game.EDGES[e], k = me === 1 ? -1 : 1;
    return { x: (scol(bw.col) + 0.5 + dc * k / 2) * t, y: (srow(bw.row) + 0.5 + dr * k / 2) * t, upright: e === 'e' || e === 'w' };
  }
  // the bastions' walls while deploying (an opponent's new one only from the fight on)
  function drawBwalls() {
    const t = tilePx();
    for (const side of [me, foe()]) for (const bw of Game.bwallsOf(m, side)) if (Game.bwallShown(m, me, true, side, bw)) { const p = wallSpot(side, bw, t); drawStoneWall(p.x, p.y, t, side, 1, side === me && bw.round === m.round, p.upright); }
  }
  // a wall (spell): a row of stakes
  function drawWallBlock(x, y, t, side, hpr) {
    const s = t * 0.8;
    ctx.fillStyle = '#9C7E58'; ctx.strokeStyle = teamCol(side); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5 + 0.5 * hpr;
    for (let k = 0; k < 4; k++) { const sx = x - s / 2 + k * s / 4; ctx.beginPath(); ctx.moveTo(sx + 1, y + s * 0.3); ctx.lineTo(sx + 1, y - s * 0.2); ctx.lineTo(sx + s / 8, y - s * 0.38); ctx.lineTo(sx + s / 4 - 1, y - s * 0.2); ctx.lineTo(sx + s / 4 - 1, y + s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  // the buildings this screen may see while deploying (an opponent's new one only from the fight on)
  function drawLessers() {
    const t = tilePx();
    for (const side of [me, foe()]) for (const b of Game.placedLessers(m, side)) {
      if (!Game.devShown(m, me, phase === 'deploy', side, b.round)) continue;
      const at = drag && drag.bkey === b.key && drag.moved && side === me ? drag.over : b;
      drawLesser((scol(at.col) + 0.5) * t, (srow(at.row) + 0.5) * t, t, side, Game.lesserUnit(m, side, b), null, side === me && b.round === m.round);
    }
  }

  // 2v2 (duo): an outline circle in the colour of the squad's player (Art.DUO_RING), under it. Its lane: a fight's
  // squads carry it, on this phone's board the other pair's (m.team, other) are the other lane
  function ownerRing(x, y, R, side, sq, other) {
    const lane = sq.lane === 0 || sq.lane === 1 ? sq.lane : other ? 1 - duo.lane : duo.lane;
    ctx.globalAlpha = 0.95; ctx.strokeStyle = duo.ring(side, lane); ctx.lineWidth = Math.max(1.5, tilePx() * 0.055);
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // other: a squad of the other pair of players on a 2v2 board (m.team): no level-up badge; on a 2v2 board every squad
  // has an outline circle in its player's colour (ownerRing)
  function drawSquad(sq, side, fresh, other) {
    const u = Game.glutOf(sq) > 0 ? Engine.glutUnit(units[sq.unit], Game.glutOf(sq)) : units[sq.unit]; // the Obelisk grows with its Glut
    if (u.building) { // a building bought in the shop (the Altar of Build): drawn in the middle of its block
      const n = Game.footprint(m, sq.unit), w = Game.recordWorld({ col: sq.col, row: sq.row, size: n }), t = tilePx();
      if (fresh) { // a dashed outline round its whole block
        const cs = [sq.col, sq.col + n - 1].map(scol), rs = [sq.row, sq.row + n - 1].map(srow);
        ctx.strokeStyle = teamCol(side); ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeRect(Math.min(...cs) * t + 1.5, Math.min(...rs) * t + 1.5, n * t - 3, n * t - 3); ctx.setLineDash([]);
      }
      if (duo) ownerRing(PX(w.x), PY(w.y), n * t * 0.47, side, sq, other);
      drawBuilding(u.building, PX(w.x), PY(w.y), t, side, u.color, { built: !!sq.built, progress: sq.progress || 0, level: sq.level });
      if (side === me && !other && phase === 'deploy' && Game.isReady(m, sq)) {
        const br = Math.max(5, t * 0.17), bx = PX(w.x) + t * 0.75, by = PY(w.y) - t * 0.75;
        ctx.fillStyle = css('--gold'); ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = css('--bg'); ctx.lineWidth = Math.max(1.5, br * 0.3);
        ctx.beginPath(); ctx.moveTo(bx - br * 0.5, by); ctx.lineTo(bx + br * 0.5, by); ctx.moveTo(bx, by - br * 0.5); ctx.lineTo(bx, by + br * 0.5); ctx.stroke();
      }
      return;
    }
    const w = Game.tileToWorld(sq.col, sq.row);
    const bodies = Engine.buildSquad(u, side, w.x, w.y, sq.id, Game.TILE);
    const col = teamCol(side);
    const t = tilePx(), c = scol(sq.col), r0 = srow(sq.row);
    if (fresh) {
      ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.strokeRect(c * t + 1.5, r0 * t + 1.5, t - 3, t - 3); ctx.setLineDash([]);
    }
    const r = radius(u);
    if (duo) ownerRing((c + 0.5) * t, (r0 + 0.5) * t, t * 0.46, side, sq, other); // 2v2: whose it is, under the bodies
    // an awakened or evolved squad (the opponent's awakening from this round stays hidden): a gold ring round each body, the Leafblade suit's blades
    const awake = Game.shownAwake(m, sq, side === me || phase !== 'deploy'), mech = awake && Game.unitFor(m, side, sq.unit, sq).mech;
    for (const b of bodies) {
      Shapes.body(ctx, u.shape, PX(b.x), PY(b.y), r, upOf(side), u.color, col, 0.95);
      if (mech) bladeMark(PX(b.x), PY(b.y), r, 0);
      if (awake) { ctx.globalAlpha = 0.9; ctx.strokeStyle = css('--gold'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    if (side === me && !other && phase === 'deploy' && Game.isReady(m, sq)) { // ready to level up: gold plus badge
      const br = Math.max(5, t * 0.17), bx = (c + 1) * t - br - 2, by = r0 * t + br + 2;
      ctx.fillStyle = css('--gold'); ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = css('--bg'); ctx.lineWidth = Math.max(1.5, br * 0.3);
      ctx.beginPath(); ctx.moveTo(bx - br * 0.5, by); ctx.lineTo(bx + br * 0.5, by); ctx.moveTo(bx, by - br * 0.5); ctx.lineTo(bx, by + br * 0.5); ctx.stroke();
    }
    if (Game.charmOf(sq) > 0) { // Matteo's charisma: a pink pip per stack up the left edge, a top hat for a Gentleman
      const pr = Math.max(1.5, t * 0.05);
      ctx.fillStyle = CHARM_COL;
      for (let k = 0; k < Game.charmOf(sq); k++) { ctx.beginPath(); ctx.arc(c * t + pr + 2, (r0 + 1) * t - pr - 3 - k * (pr * 2.6), pr, 0, Math.PI * 2); ctx.fill(); }
      if (Game.isGentleman(sq)) drawHat((c + 0.5) * t, r0 * t + t * 0.2, t * 0.22);
    }
    if (Game.glutOf(sq) > 0) glutMark((c + 0.5) * t, (r0 + 0.5) * t, r + 5, Game.glutOf(sq), (u.glut || {}).max || 1); // the Obelisk's Glut
    if (sq.level > 0) {
      ctx.fillStyle = css('--gold');
      const pr = Math.max(2, t * 0.07);
      for (let k = 0; k < sq.level; k++) {
        ctx.beginPath(); ctx.arc(c * t + pr + 3 + k * (pr * 2.6), r0 * t + pr + 3, pr, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (t >= 26) {
      ctx.font = `500 ${Math.max(8, Math.round(t * 0.26))}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = css('--ink'); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.globalAlpha = 0.85; ctx.fillText(tag(u), (c + 0.5) * t, (r0 + 1) * t - 1); ctx.globalAlpha = 1;
    }
  }

  // the Leafblade suit: two long leaf blades held out from the body, turned by a (radians)
  function bladeMark(x, y, r, a) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#7BE05A'; ctx.strokeStyle = '#1F5E1A'; ctx.lineWidth = 1;
    for (const o of [0, Math.PI]) {
      const c = Math.cos(a + o), s = Math.sin(a + o), L = r * 2.1, w = r * 0.32;
      ctx.beginPath(); ctx.moveTo(x + c * r * 0.6, y + s * r * 0.6);
      ctx.quadraticCurveTo(x + c * (r + L * 0.5) - s * w, y + s * (r + L * 0.5) + c * w, x + c * (r + L), y + s * (r + L));
      ctx.quadraticCurveTo(x + c * (r + L * 0.5) + s * w, y + s * (r + L * 0.5) - c * w, x + c * r * 0.6, y + s * r * 0.6);
      ctx.fill(); ctx.stroke();
    }
  }
  // bleeding: a red drop by the body and a pip per stack under it; at full stacks it throbs
  function bleedMark(x, y, r, n) {
    const dr = Math.max(2, r * 0.32), bx = x + r * 0.95, by = y + r * 0.6;
    ctx.fillStyle = BLEED_COL; ctx.globalAlpha = n >= Engine.BLEED.max ? 0.55 + 0.45 * Math.abs(Math.sin(bt.time() * 8)) : 1;
    ctx.beginPath(); ctx.moveTo(bx, by - dr * 1.8); ctx.quadraticCurveTo(bx + dr, by - dr * 0.5, bx + dr, by); ctx.arc(bx, by, dr, 0, Math.PI); ctx.quadraticCurveTo(bx - dr, by - dr * 0.5, bx, by - dr * 1.8); ctx.fill();
    const pr = Math.max(1.2, r * 0.14);
    for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.arc(x + (k - (n - 1) / 2) * pr * 2.6, y + r * 1.3, pr, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  // Frost: an ice-blue diamond per stack over the body
  function frostMark(x, y, r, n) {
    const pr = Math.max(1.6, r * 0.2);
    ctx.fillStyle = FROST_COL; ctx.strokeStyle = '#1F4A66'; ctx.lineWidth = 0.8;
    for (let k = 0; k < n; k++) { const px = x + (k - (n - 1) / 2) * pr * 2.4, py = y - r * 1.35; ctx.beginPath(); ctx.moveTo(px, py - pr); ctx.lineTo(px + pr * 0.7, py); ctx.lineTo(px, py + pr); ctx.lineTo(px - pr * 0.7, py); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  // frozen solid (Deepfreeze): a block of ice round the body
  function iceBlock(x, y, r) {
    ctx.fillStyle = 'rgba(190,235,255,0.45)'; ctx.strokeStyle = '#E8FAFF'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - r * 1.15, y - r * 0.9); ctx.lineTo(x - r * 0.3, y - r * 1.3); ctx.lineTo(x + r * 1.2, y - r * 1.0); ctx.lineTo(x + r * 1.05, y + r * 1.1); ctx.lineTo(x - r * 1.2, y + r * 1.15); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.6); ctx.lineTo(x + r * 0.1, y - r * 0.2); ctx.stroke();
  }
  // Glut (the Obelisk): a violet ring that fills up to its most stacks, solid and glowing once full
  function glutMark(x, y, rr, n, max) {
    const full = n >= max;
    ctx.strokeStyle = GLUT_COL; ctx.lineWidth = full ? 2.5 : 2; ctx.globalAlpha = full ? 0.7 + 0.3 * Math.abs(Math.sin((bt ? bt.time() : 0) * 3)) : 0.9;
    ctx.beginPath(); ctx.arc(x, y, rr, Math.PI / 2, Math.PI / 2 + Math.PI * 2 * Math.min(1, n / max)); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // the Gentleman's top hat (brim centred on x, y; s = its width)
  function drawHat(x, y, s) {
    ctx.fillStyle = '#16161C'; ctx.strokeStyle = '#EDEFF2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x - s / 2, y - s * 0.12, s, s * 0.12); ctx.rect(x - s * 0.3, y - s * 0.75, s * 0.6, s * 0.65); ctx.fill(); ctx.stroke();
    ctx.fillStyle = CHARM_COL; ctx.fillRect(x - s * 0.3, y - s * 0.3, s * 0.6, s * 0.12);
  }
  // the Mecha Tower's drone: a little quadcopter in the team colour, rotors spinning (t: tile size in px)
  function drawDrone(b, t) {
    const x = PX(b.x), y = PY(b.y), c = teamCol(b.side), s = t * 0.16, spin = (bt ? bt.time() : 0) * 30;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#2B2F33'; ctx.lineWidth = Math.max(1, s * 0.25);
    ctx.beginPath(); ctx.moveTo(-s * 1.4, 0); ctx.lineTo(s * 1.4, 0); ctx.moveTo(0, -s * 1.4); ctx.lineTo(0, s * 1.4); ctx.stroke();
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#C9D3D6';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.beginPath(); ctx.ellipse(dx * s * 1.4, dy * s * 1.4, s * 0.6, s * 0.6 * Math.abs(Math.sin(spin + dx + dy * 2)), 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillRect(-s * 0.55, -s * 0.55, s * 1.1, s * 1.1);
    ctx.restore();
  }
  // A small picture of a match's board for the map picker: the board at the start of a match, with both towers
  // (and the elf tower). Drawn with the board's own drawing code, by pointing it at a small canvas for a moment.
  function thumb(match, tw = 96) { // tw: the picture's width in px (the map picker's 96; look previews are bigger)
    const th = tw * Game.ROWS / Game.COLS, dpr = 2;
    const oc = document.createElement('canvas'); oc.width = tw * dpr; oc.height = th * dpr;
    const g = oc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const keep = { ctx, W, H, S, m, me, phase, mapBg, terBg };
    try {
      ctx = g; W = tw; H = th; S = W / (Game.COLS * Game.TILE); me = 0; phase = 'start'; mapBg = null; terBg = null;
      m = match;
      drawBoard();
      const t = tilePx();
      if (m) {
        for (const side of [0, 1]) { const p = m.towers[side]; drawKeep((scol(p.col) + 0.5) * t, (srow(p.row) + 0.5) * t, t * 1.6, side, null, 'keep', g); }
        drawElfTower(m, false);
        if (Game.treasuryOn(m)) { // the treasuries (Standard / Test Grid and the maps built on it), as at the start of a match
          const u = Game.treasuryUnit();
          for (const side of [0, 1]) { const ts = Game.treasurySpot(m, side); if (ts) drawLesser((scol(ts.col) + 0.5) * t, (srow(ts.row) + 0.5) * t, t * 1.3, side, u, null, false, false); }
          ctx.globalAlpha = 1;
        }
      } else { // Random: a question mark on the plain board
        g.fillStyle = css('--gold'); g.font = `700 ${Math.round(tw * 0.5)}px "Chakra Petch", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('?', tw / 2, th / 2);
      }
      return oc.toDataURL();
    } finally { ({ ctx, W, H, S, m, me, phase, mapBg, terBg } = keep); }
  }
  function drawTowerTile(side) {
    const tw = m.towers[side], t = tilePx();
    drawKeep((scol(tw.col) + 0.5) * t, (srow(tw.row) + 0.5) * t, t, side, null, towerTypeVisible(side) ? Game.towerType(m, side).id : 'outpost', null, charVisible(side) ? Game.charOf(m, side) : null);
  }
  // the neutral elf tower: a slim pale spire with a leaf-green roof. range = show its reach as a faint ring.
  // Players' own elf towers are drawn too (an opponent's new one only from the fight on).
  function drawElfTower(v, range) {
    const e = Game.elfSpot(v); if (!e) return;
    const x = PX(e.x), y = PY(e.y);
    if (range) {
      ctx.strokeStyle = ELF_COL; ctx.globalAlpha = 0.22; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(x, y, Game.ELF_TOWER.range * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // the flag on the roof: the coat of arms of whoever is ahead in the bribe-off, edged in their colour; plain white while it's level
    const lead = bribeLeadShown(v), lc = lead < 0 ? '#F4F1E6' : teamCol(lead), t = tilePx();
    // whose side the elves are on, at a glance: a ring in that side's colour (dashed white while level) and a label under it
    ctx.strokeStyle = lc; ctx.lineWidth = Math.max(2, t * 0.07); ctx.globalAlpha = 0.95; if (lead < 0) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(x, y + t * 0.3, t * 0.55, t * 0.22, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    drawSpire(x, y, t * 1.25, lc, Game.elfPowered(v), lead < 0 ? null : armsShown(v, lead));
    ctx.font = `600 ${Math.max(8, Math.round(t * 0.26))}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,12,14,0.9)'; ctx.fillStyle = lc;
    const lab = lead < 0 ? 'LEVEL' : lead === me ? 'ALLY' : 'ENEMY';
    ctx.strokeText(lab, x, y + t * 0.56); ctx.fillText(lab, x, y + t * 0.56);
    for (const sd of [me, foe()]) {
      const own = Game.elfOwnOf(v, sd);
      if (!own || !elfOwnShown(v, sd)) continue;
      const w = Game.tileToWorld(own.col, own.row);
      drawSpire(PX(w.x), PY(w.y), tilePx() * 1.05, teamCol(sd), Game.elfPowered(v), armsShown(v, sd));
    }
  }
  // a player's coat of arms where this screen may show it (null while their character is hidden)
  const armsShown = (v, side) => charVisible(side) ? Game.charOf(v, side) : null;
  // one elf spire at (x, y), size s, its flag in flagCol. strong (after round 5): a golden glow and a gilded roof.
  // arms: a character's coat of arms, flown on a flag edged in flagCol instead of the plain pennant
  function drawSpire(x, y, s, flagCol, strong, arms) {
    if (strong) {
      const gl = ctx.createRadialGradient(x, y - s * 0.1, 0, x, y - s * 0.1, s * 0.75);
      gl.addColorStop(0, 'rgba(255, 214, 90, 0.5)'); gl.addColorStop(1, 'rgba(255, 214, 90, 0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y - s * 0.1, s * 0.75, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.26, s * 0.22, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const w = s * 0.2, top = y - s * 0.12, base = y + s * 0.26;
    ctx.fillStyle = '#CFC6A8'; ctx.strokeStyle = strong ? '#8A6A12' : '#3F5A35'; ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath(); ctx.moveTo(x - w / 2 - s * 0.03, base); ctx.lineTo(x - w / 2, top); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w / 2 + s * 0.03, base); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = strong ? '#E8B931' : '#5E9A4E';
    ctx.beginPath(); ctx.moveTo(x - w * 0.85, top + s * 0.02); ctx.lineTo(x, top - s * 0.3); ctx.lineTo(x + w * 0.85, top + s * 0.02); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = strong ? '#FFE27A' : ELF_COL; ctx.fillRect(x - s * 0.025, top + s * 0.08, s * 0.05, s * 0.09); // a lit window
    const py = top - s * 0.3;
    ctx.strokeStyle = '#3F5A35'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py - s * 0.28); ctx.stroke();
    if (arms) { Art.armsFlag(ctx, arms, x, py - s * 0.28, Math.max(10, s * 0.3), flagCol); return; }
    ctx.fillStyle = flagCol; ctx.strokeStyle = 'rgba(8,12,14,0.8)'; // a big pennant: whose side the elves are on
    ctx.beginPath(); ctx.moveTo(x, py - s * 0.28); ctx.lineTo(x + s * 0.32, py - s * 0.2); ctx.lineTo(x, py - s * 0.12); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // a building (the Mechites' Factory) at (x, y), s = tile size in px: a brick workshop with a sawtooth roof, a chimney
  // and a cog on its front. Not built yet: a faint scaffold with a gold arc for how far along it is. o: { built,
  // progress, level, hpr (health ring in fights), time (fight time: smoke rises from a built one) }
  const smokeCol = '#8E8A86';
  // kind: the building's kind (factory, altar); o.awake (Core Awoken): it walks, on tracks or spider legs
  function drawBuilding(kind, x, y, s, side, color, o) {
    if (o.awake) { // tracks under the factory, four legs under the altar
      ctx.strokeStyle = '#2B2F33'; ctx.fillStyle = '#2B2F33'; ctx.lineWidth = Math.max(1.5, s * 0.06);
      if (kind === 'altar') for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const sw = Math.sin((o.time || 0) * 6 + dx * 2 + dy) * s * 0.05; ctx.beginPath(); ctx.moveTo(x + dx * s * 0.3, y + dy * s * 0.3); ctx.lineTo(x + dx * s * 0.62 + sw, y + dy * s * 0.4); ctx.lineTo(x + dx * s * 0.7 + sw, y + dy * s * 0.7); ctx.stroke(); }
      else { ctx.fillRect(x - s * 0.44, y + s * 0.12, s * 0.88, s * 0.14); ctx.fillRect(x - s * 0.44, y - s * 0.42, s * 0.88, s * 0.1); }
    }
    if (kind === 'altar') return drawAltarOfBuild(x, y, s, side, color, o);
    return drawFactory(x, y, s, side, color, o);
  }
  // the Altar of Build where four tiles meet: a stone ring with four pillars, and the Cog Spire in its middle
  function drawAltarOfBuild(x, y, s, side, color, o) {
    const R = s * 0.62, team = teamCol(side);
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + R * 0.15, R * 1.05, R * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = o.built ? 1 : 0.5;
    ctx.fillStyle = color; ctx.strokeStyle = team; ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5F574C'; ctx.beginPath(); ctx.arc(x, y, R * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#D6B26A'; ctx.strokeStyle = '#3A3330'; ctx.lineWidth = 1;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(x + dx * R * 0.62, y + dy * R * 0.62, R * 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } // pillars
    const turn = (o.time || 0) * 0.8, cr = R * 0.38; // the Cog Spire: a turning cog with a spire on top
    ctx.fillStyle = '#C9A24A';
    ctx.beginPath(); for (let k = 0; k < 20; k++) { const a = turn + k * Math.PI / 10, r = k % 2 ? cr : cr * 1.25; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8FE3FF'; ctx.beginPath(); ctx.moveTo(x, y - cr * 1.5); ctx.lineTo(x + cr * 0.35, y + cr * 0.2); ctx.lineTo(x - cr * 0.35, y + cr * 0.2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    if (!o.built) {
      ctx.strokeStyle = '#C8A46A'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(x, y, R * 1.08, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = css('--gold'); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, R * 1.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, o.progress || 0))); ctx.stroke();
    }
    if (o.hpr != null) { ctx.strokeStyle = team; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R * 1.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, o.hpr)); ctx.stroke(); }
    if (o.level > 0) { ctx.fillStyle = css('--gold'); const pr = Math.max(2, s * 0.07); for (let k = 0; k < o.level; k++) { ctx.beginPath(); ctx.arc(x - R + pr + k * pr * 2.6, y - R - pr, pr, 0, Math.PI * 2); ctx.fill(); } }
  }
  // o.ruined (2026-11-07): destroyed and out of action this round (the 2v2 Factory resting, a Cog Builder's being
  // rebuilt): greyed, the cog stopped, no smoke, the shared badge (restBadge); a rebuild keeps its gold arc
  function drawFactory(x, y, s, side, color, o) {
    const w = s * 0.74, h = s * 0.42, x0 = x - w / 2, y0 = y - h * 0.25, team = teamCol(side), ruined = !!o.ruined;
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y0 + h + s * 0.02, w * 0.55, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = o.built || ruined ? 1 : 0.5;
    ctx.fillStyle = '#3A3330'; ctx.fillRect(x0 + w * 0.7, y0 - h * 0.85, w * 0.13, h * 0.85); // chimney
    ctx.fillStyle = ruined ? REST_GREY : color; ctx.strokeStyle = team; ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = ruined ? '#3E3934' : '#5B4A3A'; // sawtooth roof
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x0 + k * w / 3, y0); ctx.lineTo(x0 + (k + 1) * w / 3, y0 - h * 0.38); ctx.lineTo(x0 + (k + 1) * w / 3, y0); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    const cr = h * 0.27, cx = x0 + w * 0.3, cy = y0 + h * 0.5, turn = ruined ? 0 : (o.time || 0) * 1.5; // the cog turns while it works
    ctx.fillStyle = ruined ? '#7A7268' : '#D6B26A';
    ctx.beginPath(); for (let k = 0; k < 16; k++) { const a = turn + k * Math.PI / 8, r = k % 2 ? cr : cr * 1.3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = ruined ? REST_GREY : color; ctx.beginPath(); ctx.arc(cx, cy, cr * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#231E1B'; ctx.fillRect(x0 + w * 0.58, y0 + h * 0.35, w * 0.22, h * 0.65); // door
    ctx.globalAlpha = 1;
    if (!o.built) { // scaffold poles (a new site, not a ruin) and how far along it is
      ctx.strokeStyle = '#C8A46A'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
      if (!ruined) ctx.strokeRect(x0 - s * 0.05, y0 - h * 0.45, w + s * 0.1, h * 1.45);
      ctx.setLineDash([]);
      ctx.strokeStyle = css('--gold'); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, s * 0.46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, o.progress || 0))); ctx.stroke();
    } else if (o.time != null && !ruined) puffs(x0 + w * 0.765, y0 - h * 0.85, s * 0.07, o.time, x * 0.37);
    if (o.hpr != null) { ctx.strokeStyle = team; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, o.hpr)); ctx.stroke(); }
    if (o.level > 0) { ctx.fillStyle = css('--gold'); const pr = Math.max(2, s * 0.07); for (let k = 0; k < o.level; k++) { ctx.beginPath(); ctx.arc(x - s / 2 + pr + 3 + k * pr * 2.6, y - s / 2 + pr + 3, pr, 0, Math.PI * 2); ctx.fill(); } }
    if (ruined && !o.noBadge) restBadge(x, y, s);
  }
  // ---------- out of action this round (2026-11-07): one look for every building that does nothing this round ----------
  // (Mpb.resting: the 2v2 Factory being rebuilt, a shut Coal mine; Game.buildingFell: a Cog Builder's Factory being
  // rebuilt), while deploying: greyed, lights out and nothing turning or smoking (as the Jail's dark lantern), and this
  // small badge in the tile's bottom-left corner: a dark disc ringed in the foe colour, a stopped grey cog struck
  // through. render3d.js draws the same: the 'ruin' look and its 'rest' icon.
  const REST_GREY = '#5E5852';
  function restBadge(x, y, t) {
    const r = Math.max(5, t * 0.15), bx = x - t / 2 + r + 2, by = y + t / 2 - r - 2;
    ctx.fillStyle = '#2B2F33'; ctx.strokeStyle = css('--foe'); ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#A8A29A'; ctx.beginPath(); for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, rr = k % 2 ? r * 0.42 : r * 0.58; ctx.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2B2F33'; ctx.beginPath(); ctx.arc(bx, by, r * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = css('--foe'); ctx.lineWidth = Math.max(1.5, r * 0.2); ctx.beginPath(); ctx.moveTo(bx - r * 0.6, by + r * 0.6); ctx.lineTo(bx + r * 0.6, by - r * 0.6); ctx.stroke();
  }
  // ---------- 2v2 buildings (src/mpb.js): one drawing per kind, a plain one for the rest ----------
  // MPB_DRAW[kind](x, y, t, side, o): a building at screen (x, y), t = tile px; o: { hpr (health left in a fight, or
  // null), time, part (a part's tile: 'exit'...), fresh }. MPB_BODY[look](x, y, r, side, u, o): a walking body of a
  // building (the Coin Golem), drawn in place of its plain shape. B groups add their kind in its own region.
  const MPB_DRAW = {
    // ===== vault (2D) =====
    // a squat iron strongroom on a stone plinth: rivets, a band in the team colour, a round brass door with its wheel,
    // and a stack of coins at its side
    vault(x, y, t, side, o) {
      const s = t * 0.78, c = teamCol(side), w = s * 0.86, h = s * 0.62, x0 = x - w / 2, y0 = y - h * 0.48;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + h * 0.56, w * 0.6, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#6E6A64'; ctx.fillRect(x0 - s * 0.05, y0 + h * 0.86, w + s * 0.1, h * 0.2); // plinth
      ctx.fillStyle = '#4C5258'; ctx.strokeStyle = '#2B2F33'; ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath(); ctx.rect(x0, y0, w, h * 0.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.fillRect(x0, y0 + h * 0.08, w, h * 0.1); // the team's band
      ctx.fillStyle = '#9AA1A8'; for (const [fx, fy] of [[0.08, 0.3], [0.92, 0.3], [0.08, 0.8], [0.92, 0.8]]) { ctx.beginPath(); ctx.arc(x0 + w * fx, y0 + h * fy, Math.max(1, s * 0.025), 0, Math.PI * 2); ctx.fill(); } // rivets
      const dr = h * 0.3, dx = x - w * 0.08, dy = y0 + h * 0.52, turn = (o.time || 0) * 0.6;
      ctx.fillStyle = '#C9A24A'; ctx.strokeStyle = '#7A5A1E'; ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#5B4210'; ctx.lineWidth = Math.max(1, s * 0.03);
      for (let k = 0; k < 3; k++) { const a = turn + k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(dx + Math.cos(a) * dr * 0.75, dy + Math.sin(a) * dr * 0.75); ctx.lineTo(dx - Math.cos(a) * dr * 0.75, dy - Math.sin(a) * dr * 0.75); ctx.stroke(); } // the wheel
      ctx.fillStyle = '#E6B84A'; ctx.beginPath(); ctx.arc(dx, dy, dr * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8A6A22'; ctx.lineWidth = 1; ctx.fillStyle = '#E6B84A';
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x + w * 0.33, y0 + h * (0.82 - k * 0.12), s * 0.09, s * 0.035, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } // coins
    },
    // ===== treeKojja (2D) =====
    // a lopsided leafy crown on a short trunk with a little plank hut wedged in it: a roof in the team colour, a dark
    // lookout slit, a rope ladder down the trunk and a bird sitting on the roof's tip
    treeKojja(x, y, t, side, o) {
      const s = t * 0.82, c = teamCol(side), sway = Math.sin((o.time || 0) * 1.3 + x * 0.05) * s * 0.012;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.4, s * 0.42, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#6B4A2B'; ctx.fillRect(x - s * 0.07, y + s * 0.02, s * 0.14, s * 0.38); // trunk
      ctx.strokeStyle = '#C9B48A'; ctx.lineWidth = Math.max(1, s * 0.02); // rope ladder
      for (const dx of [-0.03, 0.03]) { ctx.beginPath(); ctx.moveTo(x + s * (0.1 + dx), y + s * 0.02); ctx.lineTo(x + s * (0.1 + dx), y + s * 0.36); ctx.stroke(); }
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x + s * 0.07, y + s * (0.08 + k * 0.08)); ctx.lineTo(x + s * 0.13, y + s * (0.08 + k * 0.08)); ctx.stroke(); }
      for (const [dx, dy, r, col] of [[-0.24, -0.02, 0.2, '#56763A'], [0.22, 0.0, 0.19, '#5F8040'], [0.0, -0.2, 0.24, '#6B8E3D'], [-0.12, 0.08, 0.16, '#7C9C4A'], [0.14, -0.08, 0.17, '#86A657']]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + s * dx + sway, y + s * dy, s * r, 0, Math.PI * 2); ctx.fill(); } // the crown, leaf clumps
      const hx = x + sway, hy = y - s * 0.12, hw = s * 0.34, hh = s * 0.2; // the hut
      ctx.fillStyle = '#9C7A54'; ctx.strokeStyle = '#5B3F24'; ctx.lineWidth = Math.max(1, s * 0.02);
      ctx.beginPath(); ctx.rect(hx - hw / 2, hy - hh / 2, hw, hh); ctx.fill(); ctx.stroke();
      ctx.beginPath(); for (let k = 1; k < 3; k++) { ctx.moveTo(hx - hw / 2, hy - hh / 2 + hh * k / 3); ctx.lineTo(hx + hw / 2, hy - hh / 2 + hh * k / 3); } ctx.stroke(); // planks
      ctx.fillStyle = '#2B2F33'; ctx.fillRect(hx - hw * 0.28, hy - hh * 0.12, hw * 0.56, hh * 0.22); // the lookout slit
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(hx - hw * 0.62, hy - hh / 2); ctx.lineTo(hx + hw * 0.62, hy - hh / 2); ctx.lineTo(hx, hy - hh * 1.55); ctx.closePath(); ctx.fill(); // roof
      ctx.fillStyle = '#3A3026'; ctx.beginPath(); ctx.arc(hx + s * 0.02, hy - hh * 1.62, Math.max(1.2, s * 0.035), 0, Math.PI * 2); ctx.fill(); // the bird on top
      ctx.fillStyle = '#E8A04A'; ctx.beginPath(); ctx.moveTo(hx + s * 0.05, hy - hh * 1.64); ctx.lineTo(hx + s * 0.085, hy - hh * 1.6); ctx.lineTo(hx + s * 0.05, hy - hh * 1.56); ctx.fill();
    },
    // ===== fieldHospital (2D) =====
    // a canvas ridge tent seen from the front: a pale gable with its flaps tied open (a dark doorway), the roof's long
    // side behind it, a white disc with a soft green cross over the door, a pennant in the team colour on the ridge
    // pole, and its world detail: a line of bandages hung out to dry beside it
    fieldHospital(x, y, t, side, o) {
      const s = t * 0.82, c = teamCol(side), dx = s * 0.16, dy = -s * 0.14, by = y + s * 0.3, ay = y - s * 0.36, hw = s * 0.42;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x + dx * 0.5, by + s * 0.04, s * 0.56, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineJoin = 'round'; ctx.strokeStyle = '#8E8670'; ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.fillStyle = '#C9C0A6'; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x + dx, ay + dy); ctx.lineTo(x + hw + dx, by + dy); ctx.lineTo(x + hw, by); ctx.closePath(); ctx.fill(); ctx.stroke(); // the roof's long side
      ctx.fillStyle = '#EDE7D6'; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x + hw, by); ctx.lineTo(x - hw, by); ctx.closePath(); ctx.fill(); ctx.stroke(); // the front gable
      ctx.fillStyle = '#4A4236'; ctx.beginPath(); ctx.moveTo(x, y - s * 0.02); ctx.lineTo(x + s * 0.17, by); ctx.lineTo(x - s * 0.17, by); ctx.closePath(); ctx.fill(); // the doorway
      ctx.fillStyle = '#DCD3BC'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, y - s * 0.02); ctx.lineTo(x + sd * s * 0.25, by - s * 0.02); ctx.lineTo(x + sd * s * 0.12, by); ctx.closePath(); ctx.fill(); } // its flaps, tied back
      const cx = x, cy = y - s * 0.16, cr = s * 0.11;
      ctx.fillStyle = '#FAF7EE'; ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6FB07E'; ctx.fillRect(cx - cr * 0.22, cy - cr * 0.7, cr * 0.44, cr * 1.4); ctx.fillRect(cx - cr * 0.7, cy - cr * 0.22, cr * 1.4, cr * 0.44); // a soft green cross
      ctx.fillStyle = c; ctx.fillRect(x - hw, by - s * 0.05, hw * 2, s * 0.05); // the team's hem
      ctx.strokeStyle = '#6B5A44'; ctx.lineWidth = Math.max(1, s * 0.025); ctx.beginPath(); ctx.moveTo(x + dx, ay + dy); ctx.lineTo(x + dx, ay + dy - s * 0.2); ctx.stroke(); // the ridge pole
      const wave = Math.sin((o.time || 0) * 3 + x * 0.1) * s * 0.02;
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + dx, ay + dy - s * 0.2); ctx.lineTo(x + dx + s * 0.18, ay + dy - s * 0.16 + wave); ctx.lineTo(x + dx, ay + dy - s * 0.11); ctx.closePath(); ctx.fill();
      // the bandages drying on a line to the left
      const lx0 = x - hw - s * 0.06, lx1 = x - s * 0.2, ly = y - s * 0.02;
      ctx.strokeStyle = '#8E8670'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx0, by); ctx.lineTo(lx0, ly - s * 0.04); ctx.moveTo(lx0, ly - s * 0.03); ctx.quadraticCurveTo((lx0 + lx1) / 2, ly + s * 0.04, lx1, ly - s * 0.08); ctx.stroke();
      ctx.fillStyle = '#FAF7EE'; for (const k of [0.3, 0.62]) { const bx = lx0 + (lx1 - lx0) * k; ctx.fillRect(bx - s * 0.025, ly, s * 0.05, s * 0.13); }
    },
    // ===== coalMine (2D) =====
    // the entrance: a rocky mound with a timber-framed adit (a black arch under a lintel in the team colour), rails
    // running out of it and a little cart heaped with coal; a lantern hangs by the door
    // (shut, o.resting: greyed, the adit boarded up, the lantern out, the shared badge)
    coalMine(x, y, t, side, o) {
      const s = t * 0.8, c = o.resting ? REST_GREY : teamCol(side);
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.36, s * 0.52, s * 0.11, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = o.resting ? '#4E4843' : '#6B625A'; ctx.strokeStyle = '#3A342F'; ctx.lineWidth = Math.max(1, s * 0.03); // the mound
      ctx.beginPath(); ctx.moveTo(x - s * 0.5, y + s * 0.34); ctx.quadraticCurveTo(x - s * 0.46, y - s * 0.4, x, y - s * 0.44); ctx.quadraticCurveTo(x + s * 0.46, y - s * 0.4, x + s * 0.5, y + s * 0.34); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#857A6E'; for (const [fx, fy, fr] of [[-0.3, -0.12, 0.07], [0.28, -0.2, 0.06], [0.34, 0.1, 0.05], [-0.36, 0.14, 0.05]]) { ctx.beginPath(); ctx.arc(x + s * fx, y + s * fy, s * fr, 0, Math.PI * 2); ctx.fill(); } // stones
      ctx.fillStyle = '#121212'; ctx.beginPath(); ctx.moveTo(x - s * 0.2, y + s * 0.3); ctx.lineTo(x - s * 0.2, y - s * 0.08); ctx.quadraticCurveTo(x, y - s * 0.26, x + s * 0.2, y - s * 0.08); ctx.lineTo(x + s * 0.2, y + s * 0.3); ctx.closePath(); ctx.fill(); // the dark adit
      ctx.fillStyle = '#8A5A32'; ctx.fillRect(x - s * 0.26, y - s * 0.14, s * 0.07, s * 0.46); ctx.fillRect(x + s * 0.19, y - s * 0.14, s * 0.07, s * 0.46); // timber posts
      ctx.fillStyle = c; ctx.fillRect(x - s * 0.3, y - s * 0.22, s * 0.6, s * 0.09); // the lintel, in the team colour
      ctx.strokeStyle = '#9AA1A8'; ctx.lineWidth = Math.max(1, s * 0.025); // rails
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * s * 0.08, y + s * 0.3); ctx.lineTo(x + sd * s * 0.14, y + s * 0.5); ctx.stroke(); }
      ctx.fillStyle = '#55595E'; ctx.fillRect(x + s * 0.02, y + s * 0.24, s * 0.26, s * 0.13); // the cart
      ctx.fillStyle = '#1E1C1B'; for (const [fx, fy] of [[0.08, 0.23], [0.15, 0.21], [0.22, 0.23], [0.12, 0.18]]) { ctx.beginPath(); ctx.arc(x + s * fx, y + s * fy, s * 0.045, 0, Math.PI * 2); ctx.fill(); } // its coal
      ctx.fillStyle = '#2B2F33'; for (const fx of [0.07, 0.23]) { ctx.beginPath(); ctx.arc(x + s * fx, y + s * 0.38, s * 0.03, 0, Math.PI * 2); ctx.fill(); }
      if (o.resting) { // shut: planks nailed across the adit, the lantern out
        ctx.fillStyle = '#7A6A58'; ctx.strokeStyle = '#3A2E22'; ctx.lineWidth = 1;
        for (const [fy, a] of [[-0.02, 0.18], [0.14, -0.15]]) { ctx.save(); ctx.translate(x, y + s * fy); ctx.rotate(a); ctx.fillRect(-s * 0.24, -s * 0.035, s * 0.48, s * 0.07); ctx.strokeRect(-s * 0.24, -s * 0.035, s * 0.48, s * 0.07); ctx.restore(); }
        ctx.fillStyle = '#6E6A64'; ctx.beginPath(); ctx.arc(x - s * 0.32, y - s * 0.02, s * 0.035, 0, Math.PI * 2); ctx.fill();
        restBadge(x, y, t);
        return;
      }
      const glow = 0.75 + 0.25 * Math.sin((o.time || 0) * 3 + x); // the lantern
      ctx.fillStyle = '#FFD27A'; ctx.globalAlpha = 0.35 * glow; ctx.beginPath(); ctx.arc(x - s * 0.32, y - s * 0.02, s * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x - s * 0.32, y - s * 0.02, s * 0.035, 0, Math.PI * 2); ctx.fill();
    },
    // the exit: a round shaft ringed with planks under a small winch frame with a pennant in the team colour; while
    // deploying, a dashed square round the 8 tiles nobody may deploy on (where the squads come up)
    'coalMine:exit'(x, y, t, side, o) {
      const s = t * 0.95, c = teamCol(side);
      if (!o.fight) { ctx.strokeStyle = c; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.strokeRect(x - t * 1.5 + 2, y - t * 1.5 + 2, t * 3 - 4, t * 3 - 4); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#8A5A32'; ctx.strokeStyle = '#4E3218'; ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.08, s * 0.36, s * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // the plank rim
      ctx.strokeStyle = '#6B4A2A'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * s * 0.24, y + s * 0.08 + Math.sin(a) * s * 0.19); ctx.lineTo(x + Math.cos(a) * s * 0.36, y + s * 0.08 + Math.sin(a) * s * 0.28); ctx.stroke(); }
      ctx.fillStyle = '#0E0D0C'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.08, s * 0.24, s * 0.18, 0, 0, Math.PI * 2); ctx.fill(); // the shaft
      ctx.strokeStyle = '#6B4A2A'; ctx.lineWidth = Math.max(1.5, s * 0.05); // the winch frame
      ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.14); ctx.lineTo(x, y - s * 0.38); ctx.lineTo(x + s * 0.3, y + s * 0.14); ctx.stroke();
      ctx.strokeStyle = '#C8B89A'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - s * 0.36); ctx.lineTo(x, y + s * 0.04); ctx.stroke(); // the rope
      ctx.fillStyle = '#55595E'; ctx.beginPath(); ctx.arc(x, y - s * 0.36, s * 0.06, 0, Math.PI * 2); ctx.fill(); // its wheel
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x, y - s * 0.38); ctx.lineTo(x + s * 0.24, y - s * 0.32); ctx.lineTo(x, y - s * 0.24); ctx.closePath(); ctx.fill(); // the pennant
    },
    // ===== scorch (2D) =====
    // a squat stone brazier with a team-coloured band; a grumpy Ember Imp sits in its glowing coals, horns and
    // scowl showing over the rim, licked by soft amber flames
    scorch(x, y, t, side, o) { scorchShape(x, y, t * 0.78, side, o.time || 0, false); },
    // ===== oak (2D) =====
    // an old broad oak: a gnarled trunk on spreading roots with a calm sleeping face in its bark (eyes shut, a small
    // smile), a ribbon in the team colour round it, a wide lumpy crown of three dusty greens with acorns, its world
    // detail (a rope swing from a low branch) and, in a fight, pale motes of Restoration drifting up
    oak(x, y, t, side, o) {
      const s = t * 0.92, c = teamCol(side), ty = y + s * 0.36;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, ty, s * 0.5, s * 0.12, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#5E4329'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * s * 0.08, y + s * 0.16); ctx.quadraticCurveTo(x + sd * s * 0.2, ty - s * 0.02, x + sd * s * 0.32, ty + s * 0.02); ctx.lineTo(x + sd * s * 0.1, ty); ctx.closePath(); ctx.fill(); } // roots
      ctx.fillStyle = '#7A5A36'; ctx.strokeStyle = '#4B3420'; ctx.lineWidth = Math.max(1, s * 0.025);
      ctx.beginPath(); ctx.moveTo(x - s * 0.13, ty); ctx.quadraticCurveTo(x - s * 0.09, y + s * 0.05, x - s * 0.12, y - s * 0.08); ctx.lineTo(x + s * 0.12, y - s * 0.08); ctx.quadraticCurveTo(x + s * 0.09, y + s * 0.05, x + s * 0.13, ty); ctx.closePath(); ctx.fill(); ctx.stroke(); // the trunk
      // the swing: two ropes from the left branch and a plank (drawn before the crown, which hides the knots)
      ctx.strokeStyle = '#B79A6E'; ctx.lineWidth = 1; const sx = x - s * 0.3, sw = Math.sin((o.time || 0) * 1.4 + x) * s * 0.02;
      ctx.beginPath(); ctx.moveTo(sx - s * 0.05, y - s * 0.12); ctx.lineTo(sx - s * 0.05 + sw, y + s * 0.18); ctx.moveTo(sx + s * 0.05, y - s * 0.12); ctx.lineTo(sx + s * 0.05 + sw, y + s * 0.18); ctx.stroke();
      ctx.fillStyle = '#8A5A32'; ctx.fillRect(sx - s * 0.08 + sw, y + s * 0.17, s * 0.16, s * 0.035);
      for (const [fx, fy, r, col] of [[-0.24, -0.2, 0.25, '#5C7A42'], [0.24, -0.22, 0.24, '#5C7A42'], [0, -0.36, 0.28, '#6E8B4E'], [-0.12, -0.18, 0.22, '#87A35E'], [0.13, -0.3, 0.2, '#87A35E']]) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + fx * s, y + fy * s, r * s, 0, Math.PI * 2); ctx.fill(); // the crown
      }
      ctx.fillStyle = '#8C6239'; for (const [fx, fy] of [[-0.3, -0.12], [0.2, -0.1], [0.05, -0.44], [0.32, -0.3]]) { ctx.beginPath(); ctx.ellipse(x + fx * s, y + fy * s, s * 0.025, s * 0.032, 0, 0, Math.PI * 2); ctx.fill(); } // acorns
      ctx.fillStyle = c; ctx.fillRect(x - s * 0.125, y + s * 0.16, s * 0.25, s * 0.05); // the team's ribbon
      if (t >= 22) { // its face: eyes shut, a small smile
        ctx.strokeStyle = '#3A2616'; ctx.lineWidth = Math.max(1, s * 0.02);
        for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sd * s * 0.045, y + s * 0.01, s * 0.028, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x, y + s * 0.07, s * 0.035, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
      }
      if (o.hpr != null && o.hpr > 0) { // Restoration at work: motes drifting up
        ctx.fillStyle = '#CFEAB8';
        for (let k = 0; k < 4; k++) { const p = (((o.time || 0) * 0.45 + k / 4) % 1 + 1) % 1; ctx.globalAlpha = 0.7 * (1 - p); ctx.beginPath(); ctx.arc(x + Math.sin(k * 2.1 + p * 4) * s * 0.35, y - s * 0.1 - p * s * 0.55, Math.max(1, s * 0.03), 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    },
    // ===== factory (2D) =====
    // the Cog Builder's Factory as drawn for a Cog Builder (always built, its cog turning), under the team's tall
    // swallow-tailed banner on a pole at its side with a white cog on it: the team's, not one player's
    factory(x, y, t, side, o) {
      const s = t * 0.92, c = o.resting ? REST_GREY : teamCol(side); // (resting: being rebuilt this round, drawFactory's ruined look)
      drawFactory(x + s * 0.06, y, s, side, '#B07A3C', { built: true, time: o.time, level: 0, ruined: !!o.resting, noBadge: true });
      const px = x - s * 0.38, top = y - s * 0.56, bh = s * 0.36, bw = s * 0.34;
      ctx.strokeStyle = '#2B2F33'; ctx.lineWidth = Math.max(1.5, s * 0.035);
      ctx.beginPath(); ctx.moveTo(px, y + s * 0.22); ctx.lineTo(px, top - s * 0.05); ctx.stroke(); // the pole
      const wave = Math.sin((o.time || 0) * 3 + x * 0.1) * s * 0.015;
      ctx.fillStyle = c; ctx.strokeStyle = '#1D1A18'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px + bw, top + wave); ctx.lineTo(px + bw * 0.72, top + bh * 0.5); ctx.lineTo(px + bw, top + bh + wave); ctx.lineTo(px, top + bh); ctx.closePath(); ctx.fill(); ctx.stroke();
      const cx = px + bw * 0.38, cy = top + bh * 0.5, cr = bh * 0.2; // a small white cog on it
      ctx.fillStyle = '#F4EFE3'; ctx.beginPath(); for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, r = k % 2 ? cr : cr * 1.35; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, cr * 0.45, 0, Math.PI * 2); ctx.fill();
      if (o.resting) restBadge(x, y, t);
    },
    // ===== magicLake (2D) =====
    // a pond filling its tile: soft blue water with a pale shimmer, slow ripples, a lily pad and reeds at its edge, a
    // thin bank in the team colour. Waterspirits: two small pale spirits bob on it; Water elemental: a swirl in its middle
    magicLake(x, y, t, side, o) {
      const s = t * 0.96, c = teamCol(side), tm = o.time || 0, rec = o.rec, sk = (id) => !!(rec && rec.skills && rec.skills[id] && rec.skills[id].n > 0);
      const r = s * 0.14;
      ctx.fillStyle = '#2F6F99'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - s / 2, y - s / 2, s, s, r) : ctx.rect(x - s / 2, y - s / 2, s, s); ctx.fill();
      const g = ctx.createRadialGradient(x - s * 0.15, y - s * 0.18, s * 0.05, x, y, s * 0.6); g.addColorStop(0, 'rgba(170,220,240,0.55)'); g.addColorStop(1, 'rgba(62,143,196,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - s / 2, y - s / 2, s, s, r) : ctx.rect(x - s / 2, y - s / 2, s, s); ctx.fill();
      ctx.strokeStyle = '#D6EEF7'; ctx.lineWidth = 1;
      for (let k = 0; k < 2; k++) { const p = ((tm * 0.35 + k * 0.5) % 1); ctx.globalAlpha = 0.45 * (1 - p); ctx.beginPath(); ctx.ellipse(x + s * 0.08, y + s * 0.06, s * (0.08 + p * 0.26), s * (0.05 + p * 0.17), 0, 0, Math.PI * 2); ctx.stroke(); } // ripples
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6E9E5A'; ctx.beginPath(); ctx.arc(x - s * 0.24, y + s * 0.22, s * 0.1, 0.5, Math.PI * 2 + 0.1); ctx.lineTo(x - s * 0.24, y + s * 0.22); ctx.fill(); // a lily pad
      ctx.fillStyle = '#F2C6D6'; ctx.beginPath(); ctx.arc(x - s * 0.22, y + s * 0.2, s * 0.03, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7A8F4A'; ctx.lineWidth = Math.max(1, s * 0.025); for (const fx of [0.3, 0.36, 0.41]) { ctx.beginPath(); ctx.moveTo(x + s * fx, y - s * 0.4); ctx.lineTo(x + s * (fx - 0.03), y - s * 0.18); ctx.stroke(); } // reeds
      ctx.strokeStyle = c; ctx.globalAlpha = 0.7; ctx.lineWidth = Math.max(1, t * 0.04); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2, r) : ctx.rect(x - s / 2 + 1, y - s / 2 + 1, s - 2, s - 2); ctx.stroke(); ctx.globalAlpha = 1;
      if (sk('spirits')) for (let k = 0; k < 2; k++) { // two little water spirits
        const sx = x + s * (k ? 0.18 : -0.12), sy = y + s * (k ? -0.12 : -0.02) + Math.sin(tm * 2 + k * 2) * s * 0.03;
        ctx.fillStyle = '#E8F7FC'; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(sx, sy, s * 0.07, Math.PI, 0); ctx.lineTo(sx + s * 0.07, sy + s * 0.07); ctx.lineTo(sx - s * 0.07, sy + s * 0.07); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2F6F99'; ctx.globalAlpha = 1; for (const e of [-1, 1]) { ctx.beginPath(); ctx.arc(sx + e * s * 0.025, sy, Math.max(0.8, s * 0.012), 0, Math.PI * 2); ctx.fill(); }
      }
      if (sk('elemental')) { // a swirl: the elemental waiting under it
        ctx.strokeStyle = '#BFE6F2'; ctx.lineWidth = Math.max(1.2, s * 0.03); ctx.globalAlpha = 0.85;
        ctx.beginPath(); for (let k = 0; k <= 24; k++) { const a = tm * 1.5 + k * 0.45, d = s * 0.02 + k * s * 0.009; const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * 0.8; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); ctx.globalAlpha = 1;
      }
    },
    // ===== jail (2D) =====
    // a stern grey stone lock-up: a heavy plinth, a barred window with the jailed squads' shapes peering out between the
    // bars, a team band, a squat lamp turret on top (Skywatch) with its amber lantern, and a ring of keys by the door.
    // In a fight its light lies soft on every tile it watches (deploying: drawMpbs' lit tiles)
    jail(x, y, t, side, o) {
      const s = t * 0.8, c = teamCol(side), w = s * 0.84, h = s * 0.6, x0 = x - w / 2, y0 = y - h * 0.4, lw = Math.max(1, s * 0.03);
      const rec = mpbRecAt('jail', side, x, y, t), up = !rec || Mpb.litTiles(m, side, rec).length > 0;
      if (o.hpr != null && rec && up) { // the Skywatch light in a fight
        const L = Mpb.JAIL.light, g = ctx.createRadialGradient(x, y, t * 0.5, x, y, t * (L + 0.6));
        g.addColorStop(0, 'rgba(255,226,160,0.20)'); g.addColorStop(1, 'rgba(255,226,160,0.05)');
        ctx.fillStyle = g; ctx.fillRect(x - t * (L + 0.5), y - t * (L + 0.5), t * (2 * L + 1), t * (2 * L + 1));
      }
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + h * 0.66, w * 0.62, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#4E4A45'; ctx.fillRect(x0 - s * 0.05, y0 + h * 0.9, w + s * 0.1, h * 0.18); // plinth
      ctx.fillStyle = '#7C7F86'; ctx.strokeStyle = '#3A3C41'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.rect(x0, y0, w, h * 0.92); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#686B72'; ctx.lineWidth = 1; // stone courses
      for (const fy of [0.3, 0.56]) { ctx.beginPath(); ctx.moveTo(x0, y0 + h * fy); ctx.lineTo(x0 + w, y0 + h * fy); ctx.stroke(); }
      ctx.fillStyle = c; ctx.fillRect(x0, y0 - h * 0.02, w, h * 0.1); // the team's band along the roof edge
      for (let k = 0; k < 4; k++) { ctx.fillStyle = '#6A6D74'; ctx.fillRect(x0 + k * w / 3.5, y0 - h * 0.16, w / 7, h * 0.14); } // crenels
      const wx0 = x - w * 0.36, wy0 = y0 + h * 0.2, ww = w * 0.5, wh = h * 0.5; // the barred window
      ctx.fillStyle = '#1F2023'; ctx.fillRect(wx0, wy0, ww, wh);
      const cells = rec ? ((rec.data && rec.data.cells) || []) : [];
      cells.slice(0, 2).forEach((cl, k) => { const u = units[cl.ui]; if (!u) return; ctx.fillStyle = u.color; Shapes.draw(ctx, u.shape, wx0 + ww * (0.28 + k * 0.44), wy0 + wh * 0.55, Math.min(ww * 0.2, wh * 0.36), 1); });
      ctx.strokeStyle = '#B8BCC2'; ctx.lineWidth = Math.max(1, s * 0.035);
      for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(wx0 + ww * k / 5, wy0); ctx.lineTo(wx0 + ww * k / 5, wy0 + wh); ctx.stroke(); }
      ctx.strokeRect(wx0, wy0, ww, wh);
      ctx.fillStyle = '#3A3C41'; ctx.fillRect(x + w * 0.2, y0 + h * 0.36, w * 0.22, h * 0.56); // the iron door
      ctx.strokeStyle = '#C9A24A'; ctx.lineWidth = Math.max(1, s * 0.025); // keys on a ring by the door
      ctx.beginPath(); ctx.arc(x + w * 0.31, y0 + h * 0.24, s * 0.05, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w * 0.31, y0 + h * 0.3); ctx.lineTo(x + w * 0.3, y0 + h * 0.44); ctx.stroke();
      ctx.fillStyle = '#5A5D63'; ctx.fillRect(x - s * 0.09, y0 - h * 0.46, s * 0.18, h * 0.32); // the lamp turret
      ctx.fillStyle = up ? '#FFE2A0' : '#6E6A64'; ctx.beginPath(); ctx.arc(x, y0 - h * 0.5, s * 0.1, 0, Math.PI * 2); ctx.fill(); // its lantern (dark the round after it fell)
      if (up) { ctx.globalAlpha = 0.35; ctx.fillStyle = '#FFE2A0'; ctx.beginPath(); ctx.arc(x, y0 - h * 0.5, s * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    },
    // ===== school (2D) =====
    // a little brick-red schoolhouse: a pitched slate roof, a bell turret with its brass bell, a team band under the eaves,
    // a chalkboard door and a round window where the squad inside looks out; an apple on the step
    school(x, y, t, side, o) {
      const s = t * 0.8, c = teamCol(side), w = s * 0.78, h = s * 0.5, x0 = x - w / 2, y0 = y - h * 0.18, lw = Math.max(1, s * 0.03);
      const rec = mpbRecAt('school', side, x, y, t), p = rec && rec.data ? rec.data.pupil : null;
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + h * 0.9, w * 0.62, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#A8443A'; ctx.strokeStyle = '#5E241E'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#8E3830'; ctx.lineWidth = 1; // brick courses
      for (const fy of [0.33, 0.66]) { ctx.beginPath(); ctx.moveTo(x0, y0 + h * fy); ctx.lineTo(x0 + w, y0 + h * fy); ctx.stroke(); }
      ctx.fillStyle = c; ctx.fillRect(x0 - s * 0.02, y0 - h * 0.08, w + s * 0.04, h * 0.12); // the team's band under the eaves
      ctx.fillStyle = '#56606A'; ctx.strokeStyle = '#2E3439'; ctx.lineWidth = lw; // the slate roof
      ctx.beginPath(); ctx.moveTo(x0 - s * 0.08, y0 - h * 0.06); ctx.lineTo(x, y0 - h * 0.86); ctx.lineTo(x0 + w + s * 0.08, y0 - h * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#EDE3CC'; ctx.fillRect(x - s * 0.07, y0 - h * 1.12, s * 0.14, h * 0.32); // the bell turret
      ctx.fillStyle = '#56606A'; ctx.beginPath(); ctx.moveTo(x - s * 0.1, y0 - h * 1.1); ctx.lineTo(x, y0 - h * 1.36); ctx.lineTo(x + s * 0.1, y0 - h * 1.1); ctx.closePath(); ctx.fill();
      const sw = Math.sin((o.time || 0) * 2.2) * s * 0.012; // the bell swings a little
      ctx.fillStyle = '#C9A24A'; ctx.beginPath(); ctx.arc(x + sw, y0 - h * 0.92, s * 0.045, Math.PI, 0); ctx.lineTo(x + sw + s * 0.055, y0 - h * 0.86); ctx.lineTo(x + sw - s * 0.055, y0 - h * 0.86); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#2F4A3A'; ctx.strokeStyle = '#7A5A36'; ctx.lineWidth = Math.max(1, s * 0.025); // the chalkboard door
      ctx.fillRect(x + w * 0.08, y0 + h * 0.36, w * 0.28, h * 0.64); ctx.strokeRect(x + w * 0.08, y0 + h * 0.36, w * 0.28, h * 0.64);
      ctx.strokeStyle = '#EDE3CC'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + w * 0.13, y0 + h * 0.55); ctx.lineTo(x + w * 0.3, y0 + h * 0.5); ctx.stroke(); // a chalk line
      const rx = x - w * 0.22, ry = y0 + h * 0.48, rr = Math.min(w * 0.17, h * 0.32); // the round window
      ctx.fillStyle = p ? '#FFE9A8' : '#2B2F33'; ctx.strokeStyle = '#EDE3CC'; ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const u = p && units[p.ui];
      if (u) { ctx.fillStyle = u.color; Shapes.draw(ctx, u.shape, rx, ry, rr * 0.62, 1); }
      if (p && p.learn) { ctx.fillStyle = '#FFE9A8'; ctx.font = `600 ${Math.max(7, Math.round(t * 0.2))}px "IBM Plex Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✎', x + w * 0.22, y0 + h * 0.18); } // learning a skill
      ctx.fillStyle = '#C4473A'; ctx.beginPath(); ctx.arc(x + w * 0.45, y0 + h * 0.98, s * 0.045, 0, Math.PI * 2); ctx.fill(); // an apple on the step
      ctx.fillStyle = '#5E8C3A'; ctx.fillRect(x + w * 0.45, y0 + h * 0.98 - s * 0.075, s * 0.015, s * 0.035);
    },
    // ===== shadowDen (2D) =====
    // a crooked hideout of dark violet stone under a steep slate roof with a band in the team colour, a pale mask with
    // glowing violet eyes over its black doorway, two crossed daggers on the wall and a violet lantern
    shadowDen(x, y, t, side, o) {
      const s = t * 0.8, c = teamCol(side), w = s * 0.8, h = s * 0.46, x0 = x - w / 2, y0 = y - h * 0.1;
      const glow = 0.65 + 0.35 * Math.sin((o.time || 0) * 2.4 + x * 0.05);
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y0 + h + s * 0.03, w * 0.6, s * 0.08, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#3B3350'; ctx.strokeStyle = '#7C6BAA'; ctx.lineWidth = Math.max(1, s * 0.03); // (a pale violet edge: it reads on dark boards)
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0 - h * 0.06); ctx.lineTo(x0 + w * 0.98, y0 + h); ctx.lineTo(x0 + w * 0.02, y0 + h); ctx.closePath(); ctx.fill(); ctx.stroke(); // the walls, a little askew
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x0 - s * 0.04, y0 + h * 0.02); ctx.lineTo(x0 + w + s * 0.04, y0 - h * 0.05); ctx.lineTo(x0 + w + s * 0.04, y0 + h * 0.14); ctx.lineTo(x0 - s * 0.04, y0 + h * 0.2); ctx.closePath(); ctx.fill(); // the team's band
      ctx.fillStyle = '#231E2E'; ctx.beginPath(); ctx.moveTo(x0 - s * 0.08, y0 + h * 0.04); ctx.lineTo(x + w * 0.06, y0 - h * 1.05); ctx.lineTo(x0 + w + s * 0.08, y0 - h * 0.04); ctx.closePath(); ctx.fill(); ctx.stroke(); // the roof
      ctx.fillStyle = '#0B0910'; ctx.beginPath(); ctx.moveTo(x - w * 0.13, y0 + h); ctx.lineTo(x - w * 0.13, y0 + h * 0.5); ctx.quadraticCurveTo(x, y0 + h * 0.28, x + w * 0.13, y0 + h * 0.5); ctx.lineTo(x + w * 0.13, y0 + h); ctx.closePath(); ctx.fill(); // the doorway
      const mx = x, my = y0 - h * 0.38, mr = s * 0.11; // the mask on the gable
      ctx.fillStyle = '#E9E3CF'; ctx.beginPath(); ctx.moveTo(mx - mr, my - mr * 0.5); ctx.quadraticCurveTo(mx, my - mr * 1.1, mx + mr, my - mr * 0.5); ctx.quadraticCurveTo(mx + mr * 0.8, my + mr * 0.9, mx, my + mr * 1.05); ctx.quadraticCurveTo(mx - mr * 0.8, my + mr * 0.9, mx - mr, my - mr * 0.5); ctx.fill();
      ctx.fillStyle = '#B79CFF'; ctx.globalAlpha = glow;
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(mx + sd * mr * 0.42, my - mr * 0.05, mr * 0.26, mr * 0.12, sd * 0.35, 0, Math.PI * 2); ctx.fill(); } // its eyes
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#C9CED6'; ctx.lineWidth = Math.max(1.2, s * 0.035); // crossed daggers
      const dx = x0 + w * 0.24, dy = y0 + h * 0.6, dl = s * 0.13;
      ctx.beginPath(); ctx.moveTo(dx - dl, dy - dl); ctx.lineTo(dx + dl, dy + dl); ctx.moveTo(dx + dl, dy - dl); ctx.lineTo(dx - dl, dy + dl); ctx.stroke();
      ctx.fillStyle = '#5B4A3A'; for (const sd of [-1, 1]) ctx.fillRect(dx + sd * dl * 0.75 - s * 0.025, dy + dl * 0.6, s * 0.05, s * 0.05);
      const lx = x0 + w * 0.84, ly = y0 + h * 0.55; // a lantern with a violet flame
      ctx.fillStyle = '#B79CFF'; ctx.globalAlpha = 0.25 * glow; ctx.beginPath(); ctx.arc(lx, ly, s * 0.13, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#2B2F33'; ctx.fillRect(lx - s * 0.04, ly - s * 0.06, s * 0.08, s * 0.11);
      ctx.fillStyle = '#B79CFF'; ctx.globalAlpha = glow; ctx.fillRect(lx - s * 0.025, ly - s * 0.04, s * 0.05, s * 0.07); ctx.globalAlpha = 1;
    },
  };
  const MPB_BODY = {
    // ===== golem (2D) =====
    // the Coin Golem: a hulk built of stacked coins (bronze, silver or gold by the gold spent), fists of coin piles,
    // glowing eyes; ringed in its team's colour
    golem(x, y, r, side, u, o) {
      const met = u.color || '#B87333', dark = u.mpbSkin === 'gold' ? '#9A7418' : u.mpbSkin === 'silver' ? '#7D848C' : '#6E3F1C', c = teamCol(side);
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, r * 0.08);
      for (const sd of [-1, 1]) { ctx.fillStyle = met; ctx.beginPath(); ctx.arc(x + sd * r * 0.82, y + r * 0.1, r * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } // fists
      for (let k = 0; k < 4; k++) { ctx.fillStyle = k % 2 ? dark : met; ctx.beginPath(); ctx.ellipse(x, y + r * (0.55 - k * 0.32), r * (0.62 - Math.abs(k - 1.5) * 0.06), r * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } // the stacked coins
      ctx.fillStyle = '#FFE9A8'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sd * r * 0.2, y - r * 0.42, Math.max(1, r * 0.08), 0, Math.PI * 2); ctx.fill(); } // eyes
      ctx.fillStyle = '#2B2F33'; ctx.fillRect(x - r * 0.16, y - r * 0.78, r * 0.32, Math.max(1, r * 0.07)); // the coin slot on its head
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    },
    // ===== shadowDen: Shadowhands (2D) =====
    // a Shadowhand (u.mpb 'shadowDen'): a hooded cloak in violet with a pale mask, two glowing eyes and a dagger,
    // pointing the way its side faces; ringed in its team's colour
    shadowDen(x, y, r, side, u, o) {
      const c = teamCol(side), up = -upOf(side), col = u.color || '#8E7CC3'; // (up: the hood's point toward where its side faces)
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.fillStyle = col; ctx.strokeStyle = '#17131F'; ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath(); ctx.moveTo(x, y + up * r * 0.95); ctx.quadraticCurveTo(x + r * 0.95, y + up * r * 0.1, x + r * 0.7, y - up * r * 0.8); ctx.lineTo(x - r * 0.7, y - up * r * 0.8); ctx.quadraticCurveTo(x - r * 0.95, y + up * r * 0.1, x, y + up * r * 0.95); ctx.fill(); ctx.stroke(); // the hooded cloak
      ctx.fillStyle = '#E9E3CF'; ctx.beginPath(); ctx.ellipse(x, y + up * r * 0.25, r * 0.36, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); // the mask
      ctx.fillStyle = '#5A2D91'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sd * r * 0.15, y + up * r * 0.27, r * 0.09, r * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = '#C9CED6'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.moveTo(x + r * 0.55, y - up * r * 0.2); ctx.lineTo(x + r * 0.95, y + up * r * 0.55); ctx.stroke(); // the dagger
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.beginPath(); ctx.arc(x, y, r * 1.08, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    },
    // ===== magicLake (2D walker) =====
    // the Water Elemental a lake tile becomes: a tall drop of water with a curling crest, calm eyes, a ripple at its foot
    magicLake(x, y, r, side, u, o) {
      const c = teamCol(side), tm = o.time || 0;
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.strokeStyle = '#D6EEF7'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y + r * 0.75, r * (0.8 + 0.1 * Math.sin(tm * 3)), r * 0.25, 0, 0, Math.PI * 2); ctx.stroke(); // the ripple
      ctx.fillStyle = '#5FA8D3'; ctx.strokeStyle = '#2F6F99'; ctx.lineWidth = Math.max(1, r * 0.1);
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.05); ctx.bezierCurveTo(x + r * 0.95, y - r * 0.1, x + r * 0.8, y + r * 0.8, x, y + r * 0.8); ctx.bezierCurveTo(x - r * 0.8, y + r * 0.8, x - r * 0.95, y - r * 0.1, x, y - r * 1.05); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#E8F7FC'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.55, r * 0.28, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); // its crest
      ctx.fillStyle = '#16384F'; for (const e of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + e * r * 0.25, y + r * 0.05, r * 0.08, r * 0.05, 0, 0, Math.PI * 2); ctx.fill(); } // calm half-shut eyes
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, r * 0.12); ctx.beginPath(); ctx.arc(x, y, r * 1.12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    },
    // ===== scorch (2D walker) =====
    // a Scorch turret with Legs: the brazier on two stubby iron legs
    scorch(x, y, r, side, u, o) { ctx.globalAlpha = o.alpha == null ? 1 : o.alpha; scorchShape(x, y, r * 2.4, side, o.time || 0, true); ctx.globalAlpha = 1; },
  };
  // ===== scorch (2D, shared) =====
  // the Scorch turret: s = its size in px; legs: the walking one (Legs) on two stubby iron legs
  function scorchShape(x, y, s, side, time, legs) {
    const c = teamCol(side), fl = Math.sin(time * 9 + x * 0.3) * 0.5 + 0.5;
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.42, s * 0.4, s * 0.09, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    if (legs) { ctx.fillStyle = '#3B3F44'; for (const sd of [-1, 1]) { ctx.fillRect(x + sd * s * 0.2 - s * 0.06, y + s * 0.18, s * 0.12, s * 0.24); ctx.fillRect(x + sd * s * 0.2 - s * 0.1, y + s * 0.38, s * 0.2, s * 0.06); } }
    ctx.fillStyle = '#7A746C'; ctx.strokeStyle = '#4E4A45'; ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.beginPath(); ctx.moveTo(x - s * 0.36, y - s * 0.02); ctx.lineTo(x + s * 0.36, y - s * 0.02); ctx.lineTo(x + s * 0.26, y + s * 0.3); ctx.lineTo(x - s * 0.26, y + s * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); // the bowl
    ctx.fillStyle = c; ctx.fillRect(x - s * 0.33, y + s * 0.06, s * 0.66, s * 0.07); // the team's band
    ctx.globalAlpha = 0.55 + 0.3 * fl; ctx.fillStyle = '#FFC98A'; ctx.beginPath(); ctx.ellipse(x, y - s * 0.03, s * 0.34, s * 0.08, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; // glowing coals
    ctx.fillStyle = '#E8834A'; ctx.beginPath(); ctx.arc(x, y - s * 0.14, s * 0.15, Math.PI, 0); ctx.fill(); // the imp's head over the rim
    ctx.fillStyle = '#B5552A'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * s * 0.1, y - s * 0.22); ctx.lineTo(x + sd * s * 0.17, y - s * 0.36); ctx.lineTo(x + sd * s * 0.04, y - s * 0.26); ctx.fill(); } // horns
    ctx.strokeStyle = '#3A2018'; ctx.lineWidth = Math.max(1, s * 0.025); // a scowl: slanted brows over little eyes
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + sd * s * 0.1, y - s * 0.22); ctx.lineTo(x + sd * s * 0.03, y - s * 0.19); ctx.stroke(); }
    ctx.fillStyle = '#FFE9A8'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sd * s * 0.06, y - s * 0.16, Math.max(0.8, s * 0.02), 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.7; ctx.fillStyle = '#FFB36B'; // soft flames round it
    for (const [dx, h] of [[-0.25, 0.16], [0.24, 0.2], [-0.12, 0.1], [0.13, 0.12]]) { const hh = s * h * (0.75 + 0.25 * Math.sin(time * 7 + dx * 20)); ctx.beginPath(); ctx.moveTo(x + s * dx - s * 0.05, y - s * 0.03); ctx.quadraticCurveTo(x + s * dx, y - s * 0.03 - hh * 1.4, x + s * dx + s * 0.05, y - s * 0.03); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  // any kind without a drawing of its own: a block in the kind's colour with a roof band in the team colour and its
  // initials (a part, such as a mine's exit: a small marker in the kind's colour)
  function drawMpbPlain(kind, x, y, t, side, o) {
    const K = (typeof Mpb !== 'undefined' && Mpb.kindOf(kind)) || { name: '?', color: '#B7AE9C' }, s = t * 0.7, c = teamCol(side);
    if (o.part) { ctx.fillStyle = K.color; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); return; }
    ctx.fillStyle = K.color; ctx.strokeStyle = c; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(x - s / 2, y - s * 0.32, s, s * 0.72); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.fillRect(x - s / 2, y - s * 0.42, s, s * 0.14);
    if (t >= 22) { ctx.font = `600 ${Math.max(8, Math.round(t * 0.26))}px "IBM Plex Mono", monospace`; ctx.fillStyle = '#F4EFE3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(K.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase(), x, y + s * 0.05); }
  }
  // what a building lays on the floor (both boards; the 3D board's floor too): MPB_FLOOR[kind](v, side, rec, t)
  const MPB_FLOOR = {
    // ===== oak (floor) =====
    // Sticky moss: every tile within Mpb.OAK.moss of the Oak, mossy green with tufts, the patch edged in the team colour
    oak(v, side, rec, t) {
      const tiles = Mpb.oakMossTiles(v, rec);
      if (!tiles.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const tl of tiles) {
        const x = scol(tl.col) * t, y = srow(tl.row) * t;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + t); y1 = Math.max(y1, y + t);
        ctx.fillStyle = '#6F8F45'; ctx.globalAlpha = 0.26; ctx.fillRect(x, y, t, t);
        ctx.fillStyle = '#9DBB6A'; ctx.globalAlpha = 0.55;
        for (let k = 0; k < 3; k++) { const h = ((tl.col * 7 + tl.row * 13 + k * 5) % 11) / 11, j = ((tl.col * 3 + tl.row * 5 + k * 7) % 9) / 9; ctx.beginPath(); ctx.ellipse(x + t * (0.15 + 0.7 * h), y + t * (0.15 + 0.7 * j), t * 0.09, t * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 0.6; ctx.strokeStyle = teamCol(side); ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    },
  };
  function drawMpbFloor(v) {
    if (typeof Mpb === 'undefined' || !Mpb.on(v)) return;
    const t = tilePx();
    for (const side of [0, 1]) for (const rec of Mpb.recs(v, side)) if (MPB_FLOOR[rec.kind]) MPB_FLOOR[rec.kind](v, side, rec, t);
  }
  // (a part: MPB_DRAW['<kind>:<part>'] when it has one)
  function drawMpb(kind, x, y, t, side, o) {
    const own = o.part ? MPB_DRAW[kind + ':' + o.part] : MPB_DRAW[kind];
    (own || ((a, b, c2, d, e, f) => drawMpbPlain(kind, a, b, c2, d, e, f)))(x, y, t, side, o);
    if (o.hpr != null) { ctx.strokeStyle = teamCol(side); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, t * 0.52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, o.hpr)); ctx.stroke(); }
    if (o.fresh) { ctx.strokeStyle = teamCol(side); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.strokeRect(x - t / 2 + 1.5, y - t / 2 + 1.5, t - 3, t - 3); ctx.setLineDash([]); }
  }
  // the building of kind drawn at screen (x, y) (MPB_DRAW looks up its record by where it is drawn), or null
  function mpbRecAt(kind, side, x, y, t) {
    if (typeof Mpb === 'undefined' || !Mpb.on(m)) return null;
    return Mpb.recs(m, side).find(r => r.kind === kind && Math.abs((scol(r.col) + 0.5) * t - x) < 1 && Math.abs((srow(r.row) + 0.5) * t - y) < 1) || null;
  }
  // both teams' buildings on the board while deploying (and after a fight)
  function drawMpbs() {
    if (typeof Mpb === 'undefined' || !Mpb.on(m)) return;
    const t = tilePx();
    // tiles a building lights up (Mpb.litTiles: the Jail's Skywatch), soft, under the buildings
    ctx.fillStyle = 'rgba(255,226,160,0.16)';
    for (const side of [me, foe()]) for (const rec of Mpb.recs(m, side)) for (const tl of Mpb.litTiles(m, side, rec)) ctx.fillRect(scol(tl.col) * t + 1, srow(tl.row) * t + 1, t - 2, t - 2);
    for (const side of [me, foe()]) for (const rec of Mpb.recs(m, side)) for (const tl of Mpb.tilesOf(rec)) {
      drawMpb(rec.kind, (scol(tl.col) + 0.5) * t, (srow(tl.row) + 0.5) * t, t, side, { part: tl.part || null, fresh: phase === 'deploy' && rec.round === m.round && rec.round > 1, time: performance.now() / 1000, rec,
        resting: phase === 'deploy' && !tl.part && Mpb.resting(m, side, rec) }); // (out of action this round: the shared look, deploying only)
    }
  }
  // in a fight: the tiles of buildings that are no fight body (a mine's exit, a lake's water: parts, and kinds with no
  // health), from the board as the fight began
  function drawMpbGround(v) {
    if (typeof Mpb === 'undefined' || !v || !Mpb.on(v)) return;
    const t = tilePx();
    for (const side of [me, foe()]) for (const rec of Mpb.recs(v, side)) for (const tl of Mpb.tilesOf(rec)) {
      if (!tl.part && (Mpb.kindOf(rec.kind) || {}).hp > 0) continue;
      drawMpb(rec.kind, (scol(tl.col) + 0.5) * t, (srow(tl.row) + 0.5) * t, t, side, { part: tl.part || null, time: bt ? bt.time() : 0, rec, fight: true });
    }
  }
  // grey smoke puffs rising from (x, y): Mechite constructs and buildings rattle and smoke
  function puffs(x, y, r, time, seed) {
    ctx.fillStyle = smokeCol;
    for (let k = 0; k < 3; k++) {
      const p = ((time * 0.8 + k / 3 + seed) % 1 + 1) % 1; // seed may be negative (it comes from a position)
      ctx.globalAlpha = 0.45 * (1 - p);
      ctx.beginPath(); ctx.arc(x + Math.sin((p + k) * 5) * r * 0.8, y - p * r * 6, r * (0.6 + p * 1.2), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // the buildings on the board while deploying (an opponent's new one only from the fight on). 2v2: the other lane's
  // too (m.team.buildings: your teammate's, and the other opponent's from the round after it was placed; 2026-11-07).
  // One destroyed and being rebuilt has the out-of-action look while deploying (drawFactory's ruined).
  function drawBuildings() {
    const t = tilePx();
    for (const side of [me, foe()]) for (const b of Game.teamBuildings(m, side)) {
      if (!Game.teamBuildingShown(m, me, deploying(), side, b)) continue;
      const info = Game.buildingInfo(b.id) || {};
      drawBuilding(b.id, (scol(b.col) + 0.5) * t, (srow(b.row) + 0.5) * t, t, side, info.color || '#B07A3C', { built: b.built, progress: b.progress, level: b.level, ruined: deploying() && Game.buildingFell(b) });
    }
    for (const side of [me, foe()]) for (const b of Game.buildingsOf(m, side)) {
      if (!Game.buildingShown(m, me, deploying(), side, b)) continue;
      const info = Game.buildingInfo(b.id) || {};
      drawBuilding(b.id, (scol(b.col) + 0.5) * t, (srow(b.row) + 0.5) * t, t, side, info.color || '#B07A3C', { built: b.built, progress: b.progress, level: b.level, ruined: deploying() && Game.buildingFell(b) });
      if (side === me && deploying() && Game.buildingReady(b)) { // ready to level up: the gold plus badge, as on a squad
        const br = Math.max(5, t * 0.17), bx = (scol(b.col) + 1) * t - br - 2, by = srow(b.row) * t + br + 2;
        ctx.fillStyle = css('--gold'); ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = css('--bg'); ctx.lineWidth = Math.max(1.5, br * 0.3);
        ctx.beginPath(); ctx.moveTo(bx - br * 0.5, by); ctx.lineTo(bx + br * 0.5, by); ctx.moveTo(bx, by - br * 0.5); ctx.lineTo(bx, by + br * 0.5); ctx.stroke();
      }
    }
  }

  function drawDeploy() {
    drawBoard();
    drawArtifacts(); // 2v2: this round's artifacts (under the squads)
    const t = tilePx();
    if (placingBuilding && editable) { // where the building may go: any free tile of your zone
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) if (Game.buildingSpotOk(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (placingWall && editable) { // where a wall may go: any free edge of a tile on your half of the board
      ctx.strokeStyle = teamCol(me); ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) for (const e of ['n', 'w', 's', 'e']) if (Game.bwallSpotOk(m, me, c, row, e)) {
        const p = wallSpot(me, { col: c, row, edge: e }, t), hl = t / 2 - 4;
        ctx.beginPath(); if (p.upright) { ctx.moveTo(p.x, p.y - hl); ctx.lineTo(p.x, p.y + hl); } else { ctx.moveTo(p.x - hl, p.y); ctx.lineTo(p.x + hl, p.y); } ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (placingElf && editable) { // where the elf tower may go: any free tile of your zone
      ctx.strokeStyle = ELF_COL; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
      for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) if (Game.elfOwnSpotOk(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      ctx.globalAlpha = 1;
    }
    if (placingTower && editable) { // where the tower may go: the sides of your zone, not the middle columns
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      for (const row of Game.zoneRows(me)) for (let c = 0; c < Game.COLS; c++) {
        if (Game.towerColOk(c) && !Game.reserved(me, c, row) && !Game.occupied(m, me, c, row)) ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6);
      }
      ctx.globalAlpha = 1;
    }
    if ((selected !== null || (drag && drag.moved) || moving != null) && phase === 'deploy') {
      ctx.strokeStyle = css('--you'); ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
      const pu = placingUnit, mk = moveKinds();
      for (let row = 0; row < Game.ROWS; row++) for (let c = 0; c < Game.COLS; c++) {
        const k = mk ? mk(c, row) : true;
        if (k !== null && Game.canPlaceAt(m, me, c, row, pu, selected === null) && Game.spotFree(m, me, c, row, pu)) { ctx.globalAlpha = k === 'dim' ? 0.1 : 0.25; ctx.strokeRect(scol(c) * t + 3, srow(row) * t + 3, t - 6, t - 6); }
      }
      // your carriers with room for this unit
      ctx.strokeStyle = css('--gold'); ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5;
      if (pu != null) for (const sq of m.armies[me].concat(Game.teamArmy(m, me))) if (Game.boardable(m, me, sq.col, sq.row, pu) && !(drag && drag.id === sq.id)) ctx.strokeRect(scol(sq.col) * t + 2, srow(sq.row) * t + 2, t - 4, t - 4); // 2v2: your teammate's carriers too
      ctx.globalAlpha = 1;
    }
    if (hoverTile && (selected !== null || moving != null) && Game.canPlaceAt(m, me, hoverTile.col, hoverTile.row, placingUnit, selected === null) && (Game.spotFree(m, me, hoverTile.col, hoverTile.row, placingUnit) || (placingUnit != null && Game.boardable(m, me, hoverTile.col, hoverTile.row, placingUnit)))) {
      ctx.fillStyle = css('--you'); ctx.globalAlpha = 0.18;
      for (const [c, r] of Game.blockOf(m, placingUnit, hoverTile.col, hoverTile.row)) ctx.fillRect(scol(c) * t, srow(r) * t, t, t); // a building's whole block
      ctx.globalAlpha = 1;
    }
    // the opponent's squads from this round stay hidden until the fight
    // a squad they moved this round still shows on its old tile
    // and one they sold this round still shows until the fight
    for (const sq of phase === 'deploy' ? Game.foeSeen(m, foe()) : m.armies[foe()].filter(q => !Game.hiddenFromFoe(m, q))) {
      if (Game.mpbHeld(sq)) continue; // 2v2: in a Jail or a School (that building shows it)
      const p = phase === 'deploy' ? Game.seenAt(m, sq) : sq;
      const look = Game.shownUnit(m, me, foe(), sq.unit); // a disguised unit shows as what it pretends to be
      drawSquad(phase === 'deploy' ? { ...sq, unit: look, col: p.col, row: p.row, level: Game.seenLevel(m, sq) } : { ...sq, unit: look }, foe(), false); // a level-up bought this round stays hidden
    }
    // what rides inside a carrier: a small disc with its shape, bottom left of the tile (only its team sees it), ringed in
    // its player's colour in 2v2 (yours in your teammate's horse, theirs in yours)
    const riderBadge = (at, rider) => {
      if (!rider) return;
      const ru = units[rider.unit], br = Math.max(6, t * 0.2), bx = scol(at.col) * t + br + 2, by = (srow(at.row) + 1) * t - br - 2;
      ctx.fillStyle = css('--bg'); ctx.strokeStyle = duo ? duo.ring(me, m.armies[me].includes(rider) ? duo.lane : 1 - duo.lane) : teamCol(me); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = ru.color; Shapes.draw(ctx, ru.shape, bx, by, br * 0.55, 1);
    };
    for (const sq of m.armies[me]) {
      if (phase === 'deploy' && sq.from && sq.movedRound === m.round) { // where your moved squad came from
        ctx.strokeStyle = css('--muted'); ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
        ctx.strokeRect(scol(sq.from.col) * t + 4, srow(sq.from.row) * t + 4, t - 8, t - 8); ctx.setLineDash([]);
      }
      if (Game.isRider(sq) || Game.mpbHeld(sq)) continue; // drawn as a badge on its carrier (2v2: in a Jail or a School, on that building)
      const at = drag && drag.moved && drag.id === sq.id ? { ...sq, col: drag.over.col, row: drag.over.row } : sq;
      drawSquad(at, me, (sq.round === m.round || sq.movedRound === m.round) && phase === 'deploy');
      riderBadge(at, Game.riderOf(m, me, sq));
      if (moving === sq.id && phase === 'deploy') {
        ctx.strokeStyle = css('--gold'); ctx.lineWidth = 2;
        ctx.strokeRect(scol(sq.col) * t + 1, srow(sq.row) * t + 1, t - 2, t - 2);
      }
    }
    // 2v2: the other pair of players on this board (m.team): your teammate's squads, and the other opponent's as you may see them
    for (const side of [me, foe()]) for (const sq of Game.teamArmy(m, side)) if (!Game.isRider(sq) && !Game.mpbHeld(sq)) { drawSquad(sq, side, false, true); if (side === me) riderBadge(sq, Game.riderOf(m, me, sq)); }
    for (const side of [me, foe()]) if (towerVisible(side) && Game.towerUp(m, side)) drawTowerTile(side);
    if (Game.isDev(m)) drawLessers();
    if (Game.treasuryOn(m)) drawTreasuries();
    if (phase === 'deploy') drawBwalls();
    drawBuildings();
    drawMpbs(); // 2v2 buildings (src/mpb.js)
    // Overwatch: a squad standing in one of its side's buildings is drawn over the building (theirs as far as you can see it)
    for (const side of [me, foe()]) for (const sq of side !== me && phase === 'deploy' ? Game.foeSeen(m, side) : m.armies[side]) {
      if (Game.isRider(sq) || (side !== me && Game.hiddenFromFoe(m, sq))) continue;
      const p = side === me ? (drag && drag.moved && drag.id === sq.id ? drag.over : sq) : phase === 'deploy' ? Game.seenAt(m, sq) : sq;
      if (!Game.garrisonAt(m, side, p.col, p.row)) continue;
      drawSquad({ ...sq, col: p.col, row: p.row, ...(side !== me ? { unit: Game.shownUnit(m, me, side, sq.unit), level: Game.seenLevel(m, sq) } : {}) }, side, side === me && phase === 'deploy' && (sq.round === m.round || sq.movedRound === m.round));
    }
    // (the squad tapped last shows its range as a dotted ring drawn by the page over the board: boardMarks)
    drawElfTower(m, true);
    if (Game.isIce(m)) for (const side of [me, foe()]) {
      // Snowgres on their tiles in no man's land (an opponent's new one shows up at the fight)
      const buys = (m.altar || []).filter(b => b.side === side && b.type === 'snowgre');
      Game.snowgres(m, side).forEach((sg, k) => {
        if (!altarShown(m, buys[k])) return;
        const u = Game.snowgreUnit(m, sg.strength), w = Game.tileToWorld(sg.col, sg.row);
        Shapes.body(ctx, 'square', PX(w.x), PY(w.y), radius(u), upOf(side), u.color, teamCol(side), 0.95);
      });
      const wb = (m.altar || []).find(b => b.side === side && b.type === 'walls' && b.round === m.round);
      if (wb && altarShown(m, wb) && m.towers && m.towers[side]) { const w = Game.tileToWorld(m.towers[side].col, m.towers[side].row); drawWalls(w.x, w.y, [1, 1, 1, 1].map(() => Game.ICE.wallHits)); }
    }
  }

  function drawBattle() {
    drawBoard();
    drawMpbGround(battlePre || m); // 2v2: a mine's exit, lake water
    const muted = css('--muted'), gold = css('--gold');
    for (const e of fx) {
      const a = 1 - e.age / e.life;
      if (e.kind === 'flame') { // fire cone, drawn under the bodies
        const cx = PX(e.x1), cy = PY(e.y1), ex = PX(e.x2), ey = PY(e.y2);
        const ang = Math.atan2(ey - cy, ex - cx), half = e.half * Math.PI / 180, rr = Math.hypot(ex - cx, ey - cy);
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        if (e.slam) { grd.addColorStop(0, 'rgba(205,175,120,0.65)'); grd.addColorStop(0.6, 'rgba(140,105,60,0.4)'); grd.addColorStop(1, 'rgba(90,70,40,0.05)'); } // a ground slam: dust and rock
        else if (e.spin) { grd.addColorStop(0, 'rgba(170,240,120,0.55)'); grd.addColorStop(0.7, 'rgba(90,200,70,0.35)'); grd.addColorStop(1, 'rgba(40,140,40,0.05)'); } // spinning leaf blades
        else { grd.addColorStop(0, 'rgba(255,210,90,0.6)'); grd.addColorStop(0.6, 'rgba(255,120,40,0.35)'); grd.addColorStop(1, 'rgba(255,70,20,0.05)'); }
        ctx.fillStyle = grd; ctx.globalAlpha = 0.4 + 0.6 * a;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rr, ang - half, ang + half); ctx.closePath(); ctx.fill();
      }
      if (e.kind === 'roar') { // Berserkers: a ring that sweeps out to the roar's reach
        ctx.strokeStyle = teamCol(e.side); ctx.globalAlpha = 0.7 * a; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(PX(e.x), PY(e.y), e.r * S * (0.25 + 0.75 * e.age / e.life), 0, Math.PI * 2); ctx.stroke();
      }
      if (e.kind === 'death') {
        ctx.strokeStyle = teamCol(e.side); ctx.globalAlpha = 0.5 * a; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(PX(e.x), PY(e.y), radius(e.u) * (1 + e.age / e.life), 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // Pool shaper's pools: water on the ground, ringed in their side's colour
    for (const q of bt.pools ? bt.pools() : []) {
      ctx.fillStyle = POOL_COL; ctx.globalAlpha = 0.22 + 0.05 * Math.sin(bt.time() * 2 + q.x);
      ctx.beginPath(); ctx.arc(PX(q.x), PY(q.y), q.r * S, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = teamCol(q.side); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Snow storm (Frost Wizard): flurries whirling round it out to the storm's reach
    for (const b of bt.bodies) {
      if (!b.alive || !b.u.storm) continue;
      const R = b.u.storm.radius * S, x = PX(b.x), y = PY(b.y), t0 = bt.time();
      ctx.fillStyle = 'rgba(200,236,255,0.10)'; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = teamCol(b.side); ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#F2FBFF';
      for (let k = 0; k < 14; k++) { const a = t0 * (0.9 + (k % 3) * 0.35) + k * 2.4, d = R * (0.25 + 0.72 * ((k * 0.37) % 1)); ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(1, S * 0.35), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // Summon hellfiend: a swirling portal in front of each squad for its first seconds
    for (const pt of bt.portals ? bt.portals() : []) {
      const pr = tilePx() * 0.42, a0 = bt.time() * 5;
      ctx.fillStyle = 'rgba(120,20,30,0.45)'; ctx.beginPath(); ctx.ellipse(PX(pt.x), PY(pt.y), pr, pr * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#FF6A3D'; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(PX(pt.x), PY(pt.y), pr * (1 - k * 0.25), pr * 0.7 * (1 - k * 0.25), 0, a0 + k * 2, a0 + k * 2 + 3.6); ctx.stroke(); }
    }
    // 2v2: the portal where a tower fell (it takes the team that took it to its own tower), and a flash at both ends
    // when a body goes through (src/duo.js, Engine opts.portal)
    for (const pt of bt.gates ? bt.gates() : []) {
      const pr = tilePx() * 0.55, a0 = bt.time() * 3, x = PX(pt.x), y = PY(pt.y);
      ctx.fillStyle = 'rgba(60,40,150,0.5)'; ctx.beginPath(); ctx.ellipse(x, y, pr, pr * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = teamCol(pt.side); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x, y, pr * (1 - k * 0.25), pr * 0.75 * (1 - k * 0.25), 0, a0 + k * 2, a0 + k * 2 + 3.6); ctx.stroke(); }
    }
    for (const fx of bt.gateFx ? bt.gateFx() : []) {
      const age = bt.time() - fx.t;
      if (age < 0 || age > 0.6) continue;
      ctx.strokeStyle = '#B9A8FF'; ctx.globalAlpha = 1 - age / 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PX(fx.x), PY(fx.y), tilePx() * (0.2 + age), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 2v2 Coal mine: a puff of coal dust where a squad comes up the mine
    for (const e of bt.mineFx ? bt.mineFx() : []) {
      const age = bt.time() - e.t;
      if (age < 0 || age > 0.9) continue;
      ctx.fillStyle = '#4A4440'; ctx.globalAlpha = 0.55 * (1 - age / 0.9);
      for (let k = 0; k < 5; k++) { const a = k * 1.26 + e.x; ctx.beginPath(); ctx.arc(PX(e.x) + Math.cos(a) * tilePx() * 0.3 * (0.4 + age), PY(e.y) + Math.sin(a) * tilePx() * 0.22 * (0.4 + age), tilePx() * (0.08 + 0.1 * age), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    drawArtifacts(); // 2v2: the artifacts (their meters go over the bodies, below)
    // Drop paratroopers (sniper tower): until they land, a shadow on each landing spot that darkens as they come,
    // inside a dashed ring in the dropping side's colour as wide as the landing hit
    for (const d of bt.drops ? bt.drops() : []) {
      const k = d.t > 0 ? 1 - d.left / d.t : 1;
      for (const s of d.spots) {
        const x = PX(s.x), y = PY(s.y);
        ctx.fillStyle = '#000'; ctx.globalAlpha = 0.12 + 0.3 * k;
        ctx.beginPath(); ctx.ellipse(x, y, Math.max(2, d.r * S * (0.3 + 0.35 * k)), Math.max(1.5, d.r * S * (0.22 + 0.26 * k)), 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = teamCol(d.side); ctx.globalAlpha = 0.5 + 0.4 * k; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(x, y, d.r * S, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    // Grasping roots: a gnarled line from each Ent to the enemy it drags
    for (const b of bt.bodies) {
      const v = b.rootTgt;
      if (!b.alive || !v || !v.alive) continue;
      ctx.strokeStyle = '#6B4A2A'; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
      const x1 = PX(b.x), y1 = PY(b.y), x2 = PX(v.x), y2 = PY(v.y), mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
      ctx.strokeStyle = '#3FA34D'; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const b of bt.bodies) {
      if (b.alive || b.boarded || b.removed) continue; // a rider still inside its carrier isn't a corpse, nor a watchtower taken down
      ctx.fillStyle = muted; ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), Math.max(1.5, radius(b.u) * 0.45), 0, Math.PI * 2); ctx.fill();
    }
    for (const b of bt.bodies) {
      if (!b.alive || !b.u.structure) continue;
      const hpr = b.hp / b.u.hp, t = tilePx();
      if (b.u.kind === 'wall') { if (b.u.barrier) drawStoneWall(PX(b.x), PY(b.y), t, b.side, hpr, false, (b.u.barrierY || 0) > b.u.barrier); else drawWallBlock(PX(b.x), PY(b.y), t, b.side, hpr); continue; }
      if (b.u.mpb) { drawMpb(b.u.mpb, PX(b.x), PY(b.y), t, b.side, { hpr, time: bt.time(), part: b.u.mpbPart || null }); continue; } // a 2v2 building
      if (b.u.lesser) { drawLesser(PX(b.x), PY(b.y), t, b.side, b.u, hpr, false); continue; }
      if (b.u.awake) { ctx.fillStyle = '#2B2F33'; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.beginPath(); ctx.arc(PX(b.x) + dx * t * 0.36, PY(b.y) + dy * t * 0.3, t * 0.12, 0, Math.PI * 2); ctx.fill(); } } // Core Awoken: the Mecha Tower on wheels
      drawKeep(PX(b.x), PY(b.y), t, b.side, hpr, b.u.kind, null, Game.charOf(battlePre || m, b.side));
      ctx.strokeStyle = teamCol(b.side); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), t * 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke();
      if (b.walls) drawWalls(b.x, b.y, b.walls);
    }
    drawElfTower(battlePre || m, false);
    for (const b of bt.bodies) { // buildings (the Factory): a site with its progress, or a workshop that smokes and makes its unit
      if (!b.alive || !b.u.building) continue;
      const info = Game.buildingInfo(b.u.building) || {}, t = tilePx();
      drawBuilding(b.u.building, PX(b.x), PY(b.y), t, b.side, info.color || b.u.color, { built: !b.site || b.site.work >= b.site.need, progress: b.site ? b.site.work / b.site.need : 1, level: b.level, hpr: b.hp / b.u.hp, time: bt.time(), awake: b.u.awake });
      if (b.produce && !b.produced && b.prodT != null) { ctx.strokeStyle = css('--gold'); ctx.lineWidth = 2.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), t * 0.38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.prodT / b.produce.time)); ctx.stroke(); ctx.setLineDash([]); }
    }
    // the Mecha Tower's mines: a small dark disc ringed in the team colour (the opponent's fainter)
    for (const mn of bt.mines ? bt.mines() : []) {
      const r = Math.max(2, tilePx() * 0.09);
      ctx.fillStyle = '#2B2F33'; ctx.beginPath(); ctx.arc(PX(mn.x), PY(mn.y), r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = teamCol(mn.side); ctx.globalAlpha = mn.side === me ? 0.9 : 0.5; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(PX(mn.x), PY(mn.y), r + 1.5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // a linked squad: a faint line joins its bodies (they share one health pool)
    for (const b of bt.bodies) {
      if (!b.alive || !b.link || b.hidden) continue;
      const nx = b.link[(b.link.indexOf(b) + 1) % b.link.length];
      if (nx === b || !nx.alive) continue;
      ctx.strokeStyle = teamCol(b.side); ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(PX(b.x), PY(b.y)); ctx.lineTo(PX(nx.x), PY(nx.y)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const b of bt.bodies) {
      if (!b.alive || b.u.structure || b.u.aloft || b.u.building || b.mineT > 0) continue; // (2v2: down a Coal mine, not seen)
      const c = teamCol(b.side), r = radius(b.u), hpr = b.hp / b.u.hp;
      if (b.hidden) { // stealthed: a dashed ghost while hidden (fainter for the enemy's)
        ctx.globalAlpha = b.side === me ? 0.6 : 0.3; ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
        Shapes.outline(ctx, b.u.shape, PX(b.x), PY(b.y), r, upOf(b.side));
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        continue;
      }
      // what Mechites build rattles as it goes (the Mechites themselves move smoothly)
      const rattle = b.u.construct ? Math.sin(bt.time() * 47 + b.x * 3.1) * r * 0.08 : 0;
      const lk = b.mask && b.side !== me && !b.revealed ? b.mask : b.u; // a disguise, until its first attack (devtest)
      if (duo && (b.lane === 0 || b.lane === 1)) { ctx.globalAlpha = 0.9; ctx.strokeStyle = duo.ring(b.side, b.lane); ctx.lineWidth = Math.max(1.5, r * 0.22); ctx.beginPath(); ctx.arc(PX(b.x) + rattle, PY(b.y), r + Math.max(2, r * 0.35), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; } // 2v2: its player's colour
      if (b.u.mpb && MPB_BODY[b.u.mpb]) MPB_BODY[b.u.mpb](PX(b.x), PY(b.y), r, b.side, b.u, { alpha: 0.35 + 0.65 * hpr, time: bt.time() }); // a 2v2 building's walker (the Coin Golem)
      else Shapes.body(ctx, lk.shape, PX(b.x) + rattle, PY(b.y), r, upOf(b.side), lk.color, c, (0.35 + 0.65 * hpr) * (b.delay > 0 ? 0.45 : 1));
      if (b.u.mech) bladeMark(PX(b.x) + rattle, PY(b.y), r, bt.time() * (b.lastAtk > bt.time() - 0.4 ? 14 : 1.5) + b.x); // the Leafblade suit: its blades spin as it strikes
      if (b.u.unfolded) { ctx.fillStyle = 'rgba(30,24,20,0.75)'; for (const o of [-1, 1]) ctx.fillRect(PX(b.x) + o * r * 0.45 - r * 0.15, PY(b.y) + r * 0.75, r * 0.3, r * 0.45); } // an unfolded roller: two stumpy legs
      if (b.u.roll > 0) { // a roller: a seam across the ball turns as it rolls
        const a = (b.moved || 0) / Math.max(0.3, r / S);
        ctx.strokeStyle = 'rgba(30,24,20,0.75)'; ctx.lineWidth = Math.max(1, r * 0.18);
        ctx.beginPath(); ctx.moveTo(PX(b.x) + Math.cos(a) * r * 0.85, PY(b.y) + Math.sin(a) * r * 0.85); ctx.lineTo(PX(b.x) - Math.cos(a) * r * 0.85, PY(b.y) - Math.sin(a) * r * 0.85); ctx.stroke();
      }
      if (b.u.bot === 'repair') { ctx.fillStyle = '#6FD08C'; ctx.fillRect(PX(b.x) - r * 0.45, PY(b.y) - r * 0.12, r * 0.9, r * 0.24); ctx.fillRect(PX(b.x) - r * 0.12, PY(b.y) - r * 0.45, r * 0.24, r * 0.9); } // a repairbot: a green cross
      if (b.u.bot === 'mine' && b.plant && b.plant.spots.length) { ctx.fillStyle = '#2B2F33'; ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r * 0.4, 0, Math.PI * 2); ctx.fill(); } // a minebot still carrying mines
      if (b.u.construct) puffs(PX(b.x) + r * 0.4, PY(b.y) - r * 0.8, Math.max(1.2, r * 0.22), bt.time(), b.x * 0.13 + b.y * 0.07);
      if (b.u.awake) { ctx.fillStyle = '#2B2F33'; for (const o of [-1, 1]) { ctx.beginPath(); ctx.arc(PX(b.x) + o * r * 0.8, PY(b.y) + r * 0.8, Math.max(1.5, r * 0.35), 0, Math.PI * 2); ctx.fill(); } } // Core Awoken: wheels
      if (b.delay > 0) { // flank squads arrive a few seconds late: a shrinking ring shows the wait
        ctx.strokeStyle = css('--gold'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.delay / Game.FLANK.delay); ctx.stroke();
      }
      if (b.poison && b.poison.length) { ctx.fillStyle = '#6FD08C'; ctx.beginPath(); ctx.arc(PX(b.x) + r * 0.9, PY(b.y) - r * 0.9, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill(); }
      if (b.slowT > 0) { ctx.fillStyle = '#9BD0FF'; ctx.beginPath(); ctx.arc(PX(b.x) - r * 0.9, PY(b.y) - r * 0.9, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill(); } // slowed
      if (b.bleed && b.bleed.n > 0) bleedMark(PX(b.x), PY(b.y), r, b.bleed.n);
      if (b.frost && b.frost.n > 0) frostMark(PX(b.x), PY(b.y), r, b.frost.n);
      if (b.frozenT > 0) iceBlock(PX(b.x), PY(b.y), r);
      if (b.u.glut && b.glutN > 0) glutMark(PX(b.x), PY(b.y), r + 5, b.glutN, b.u.glut.max);
      if (b.burn) { ctx.fillStyle = '#FF7A1A'; ctx.globalAlpha = 0.6 + 0.4 * Math.abs(Math.sin(bt.time() * 9 + b.x)); ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y) - r * 1.05, Math.max(2, r * 0.3), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } // burning
      if (b.inside && b.inside.alive) { ctx.strokeStyle = css('--gold'); ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); } // Overwatch: safe in its building
      if (b.dashing || b.charging) { // a dash or a Bullhead charge: speed lines behind it
        ctx.strokeStyle = c; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5;
        const hx = (b.hx || 0) * flip(), hy = -(b.hy || 0) * flip();
        for (const o of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(PX(b.x) - hx * r * 1.2 + hy * r * o, PY(b.y) - hy * r * 1.2 - hx * r * o); ctx.lineTo(PX(b.x) - hx * r * 3 + hy * r * o, PY(b.y) - hy * r * 3 - hx * r * o); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      if (b.forgeT > 0 && b.forgeFull > 0) { // forging a titanium spear: a steel ring fills
        ctx.strokeStyle = '#C9D1D9'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]);
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.forgeT / b.forgeFull)); ctx.stroke(); ctx.setLineDash([]);
      }
      if (b.stunT > 0) { // stunned after a charge: three dots circling over its head
        ctx.fillStyle = '#FFD23F';
        for (let k = 0; k < 3; k++) { const a = bt.time() * 6 + k * 2.094; ctx.beginPath(); ctx.arc(PX(b.x) + Math.cos(a) * r * 0.8, PY(b.y) - r * 1.2 + Math.sin(a) * r * 0.3, Math.max(1.5, r * 0.2), 0, Math.PI * 2); ctx.fill(); }
      }
      if (hpr < 1) { // every unit once it's hurt
        ctx.strokeStyle = c; ctx.lineWidth = b.u.hp >= 500 ? 1.5 : 1;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 2.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpr); ctx.stroke();
      }
      if (b.windTarget && b.u.windUp > 0) {
        ctx.strokeStyle = c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.windT / b.u.windUp)); ctx.stroke();
      }
      if (b.buildT > 0 && b.buildFull > 0) { // a builder at work: a gold ring fills as it builds
        ctx.strokeStyle = gold; ctx.lineWidth = 2.5; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - b.buildT / b.buildFull)); ctx.stroke(); ctx.setLineDash([]);
      }
      const ch = bt.charm ? bt.charm(b.side, b.squad) : 0;
      if (ch >= Engine.CHARM_MAX) drawHat(PX(b.x), PY(b.y) - r * 0.8, Math.max(6, r * 1.3)); // a Gentleman
      else if (ch > 0) { ctx.fillStyle = CHARM_COL; ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y) - r * 1.1, Math.max(1.5, r * 0.25), 0, Math.PI * 2); ctx.fill(); }
      if (b.convert) { // won over by a Gentleman: a pink ring
        ctx.strokeStyle = CHARM_COL; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (b.level > 0) {
        ctx.strokeStyle = gold; ctx.lineWidth = Math.min(2.5, 0.8 + b.level * 0.5);
        Shapes.outline(ctx, b.u.shape, PX(b.x), PY(b.y), r + 3.5, upOf(b.side));
      }
      if (b.shroom) { // purple mushroom buff: faint purple spores drifting up, looping
        ctx.fillStyle = SHROOM_COL.purple;
        for (let k = 0; k < 2; k++) {
          const s0 = (b.squad * 0.29 + b.x * 0.11 + k * 0.5) % 1, p = (bt.time() * 0.6 + s0) % 1;
          ctx.globalAlpha = 0.5 * Math.sin(p * Math.PI);
          ctx.beginPath(); ctx.arc(PX(b.x) + (k ? 1 : -1) * r * (0.3 + 0.3 * Math.sin((p + s0) * 6)), PY(b.y) - r * (0.4 + 1.6 * p), Math.max(1.2, r * 0.16), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (b.fast) { // yellow mushroom: a short speed streak behind the body
        ctx.strokeStyle = SHROOM_COL.yellow; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
        const hx = (b.hx || 0) * flip(), hy = -(b.hy || 0) * flip();
        for (const o of [-0.4, 0.4]) { ctx.beginPath(); ctx.moveTo(PX(b.x) - hx * r * 1.2 + hy * r * o, PY(b.y) - hy * r * 1.2 - hx * r * o); ctx.lineTo(PX(b.x) - hx * r * 2.2 + hy * r * o, PY(b.y) - hy * r * 2.2 - hx * r * o); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      if (b.zoe) { // Zoe buff: two faint stars drifting up from the body, looping
        ctx.fillStyle = gold; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(7, Math.round(r * 0.7))}px sans-serif`;
        for (let k = 0; k < 2; k++) {
          const s = (b.squad * 0.37 + b.x * 0.13 + k * 0.5) % 1, p = (bt.time() * 0.7 + s) % 1;
          ctx.globalAlpha = 0.55 * Math.sin(p * Math.PI);
          ctx.fillText('★', PX(b.x) + (k ? 1 : -1) * r * (0.35 + 0.25 * Math.sin((p + s) * 6)), PY(b.y) - r * (0.4 + 1.8 * p));
        }
        ctx.globalAlpha = 1;
      }
    }
    for (const b of bt.bodies) if (b.alive && b.u.aloft) drawDrone(b, tilePx()); // drones fly over everything
    for (const e of fx) {
      const a = 1 - e.age / e.life;
      if (e.kind === 'heal') {
        ctx.strokeStyle = '#6FD08C'; ctx.globalAlpha = 0.8 * a; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(PX(e.x2), PY(e.y2)); ctx.stroke(); ctx.setLineDash([]);
        if (e.splash > 0) { ctx.globalAlpha = 0.5 * a; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(PX(e.x2), PY(e.y2), e.splash * S, 0, Math.PI * 2); ctx.stroke(); } // the elves' splash heal
      }
      if (e.kind === 'frost') { // a frost beam, held on its target: a cold glow in the team colour round a pale core
        const ab = Art.beamAlpha(e);
        for (const [col, lw, al] of [[teamCol(e.side), 5, 0.3], [FROST_COL, 2.4, 0.85], ['#FFFFFF', 1, 0.9]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.globalAlpha = al * ab; ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(PX(e.x2), PY(e.y2)); ctx.stroke(); }
      }
      if (e.kind === 'freeze') { // frozen solid: shards of ice burst out
        ctx.strokeStyle = '#E8FAFF'; ctx.globalAlpha = a; ctx.lineWidth = 1.5;
        const x = PX(e.x), y = PY(e.y), d = tilePx() * (0.2 + 0.35 * (1 - a));
        for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3 + 0.3; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * d * 0.4, y + Math.sin(an) * d * 0.4); ctx.lineTo(x + Math.cos(an) * d, y + Math.sin(an) * d); ctx.stroke(); }
      }
      if (e.kind === 'eat') { // eaten by the Obelisk: a violet wisp drawn from the fallen body into it
        const p = 1 - a, x = PX(e.x1) + (PX(e.x2) - PX(e.x1)) * p, y = PY(e.y1) + (PY(e.y2) - PY(e.y1)) * p;
        ctx.strokeStyle = GLUT_COL; ctx.globalAlpha = 0.8 * a; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = GLUT_COL; ctx.beginPath(); ctx.arc(x, y, Math.max(2, tilePx() * 0.08), 0, Math.PI * 2); ctx.fill();
      }
      if (e.kind === 'bolt') { // lightning: a jagged white-blue line with a glow in the team colour
        const x1 = PX(e.x1), y1 = PY(e.y1), x2 = PX(e.x2), y2 = PY(e.y2), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, n = Math.max(3, Math.round(L / 8));
        const pts = [[x1, y1]];
        for (let k = 1; k < n; k++) { const o = (Math.sin((e.seed * 97 + k) * 12.9898) * 43758.5453 % 1) * Math.min(6, L * 0.12); pts.push([x1 + dx * k / n - dy / L * o, y1 + dy * k / n + dx / L * o]); }
        pts.push([x2, y2]);
        for (const [col, lw, al] of [[teamCol(e.side), 4, 0.35], ['#E8F1FF', 1.5, 0.95]]) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.globalAlpha = al * a; ctx.beginPath(); pts.forEach(([px, py], k) => k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.stroke();
        }
      }
      if (e.kind === 'shot') {
        ctx.strokeStyle = teamCol(e.side); ctx.globalAlpha = 0.7 * a; ctx.lineWidth = Math.max(e.charged ? 3 : 1, 1 + (e.spin - 1) * 1.5); // spun-up beams get thicker
        ctx.beginPath(); ctx.moveTo(PX(e.x1), PY(e.y1)); ctx.lineTo(PX(e.x2), PY(e.y2)); ctx.stroke();
        if (e.splash > 0) { ctx.globalAlpha = 0.4 * a; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(PX(e.x2), PY(e.y2), e.splash * S, 0, Math.PI * 2); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
    for (const p of bt.projectiles()) {
      if (p.spear || p.owner.u.shape === 'spear') { // a thrown spear (Truespear, a titanium spear): shaft and head along its flight, in the unit's colour
        const L = Math.max(12, 3 * S), dx = p.dirX * flip(), dy = -p.dirY * flip(), hx = PX(p.x), hy = PY(p.y), tx = hx - dx * L, ty = hy - dy * L;
        ctx.strokeStyle = teamCol(p.owner.side); ctx.lineWidth = 3.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.strokeStyle = p.owner.u.color; ctx.lineWidth = 1.5; ctx.stroke();
        const hl = L * 0.32, hw = L * 0.14;
        ctx.fillStyle = p.owner.u.color; ctx.strokeStyle = teamCol(p.owner.side); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(hx + dx * hl * 0.6, hy + dy * hl * 0.6); ctx.lineTo(hx - dx * hl * 0.4 - dy * hw, hy - dy * hl * 0.4 + dx * hw); ctx.lineTo(hx - dx * hl * 0.4 + dy * hw, hy - dy * hl * 0.4 - dx * hw); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.lineCap = 'butt';
        continue;
      }
      const dx = p.dirX * flip(), dy = -p.dirY * flip(), x = PX(p.x), y = PY(p.y);
      if (p.missile) { // a Leafblade missile: a dark body with a flame behind it
        ctx.strokeStyle = '#FF9A3D'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - dx * 4, y - dy * 4); ctx.lineTo(x - dx * 10, y - dy * 10); ctx.stroke();
        ctx.strokeStyle = '#2B2F33'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - dx * 4, y - dy * 4); ctx.lineTo(x + dx * 4, y + dy * 4); ctx.stroke();
        ctx.fillStyle = teamCol(p.owner.side); ctx.beginPath(); ctx.arc(x + dx * 4, y + dy * 4, 2, 0, Math.PI * 2); ctx.fill();
        continue;
      }
      if (p.owner.u.name === 'Leaf Wizard') { // a sharp leaf along its flight, in the team colour's edge
        ctx.fillStyle = '#7BE05A'; ctx.strokeStyle = teamCol(p.owner.side); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x + dx * 5, y + dy * 5); ctx.quadraticCurveTo(x - dy * 3, y + dx * 3, x - dx * 5, y - dy * 5); ctx.quadraticCurveTo(x + dy * 3, y - dx * 3, x + dx * 5, y + dy * 5); ctx.fill(); ctx.stroke();
        continue;
      }
      ctx.fillStyle = teamCol(p.owner.side);
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
    }
    artifactMeters(); // 2v2: each artifact's points
    // a fallen tower cripples its army for a few seconds
    // (a 2v2 fight: per board, bt.crippled(side, lane); the longest of the two shows)
    const cripOf = (sd) => Math.max(bt.crippled(sd, 0), bt.crippled(sd, 1) || 0);
    const crip = [me, foe()].filter(sd => cripOf(sd) > 0);
    crip.forEach((sd, k) => {
      const txt = sd === me ? `Your tower fell · crippled ${Math.ceil(cripOf(sd))} s` : `${mode === 'claude' ? 'Claude’s' : 'Enemy'} tower fell · crippled ${Math.ceil(cripOf(sd))} s`;
      ctx.font = `600 ${Math.max(11, Math.round(W * 0.035))}px "IBM Plex Mono", monospace`;
      const tw = ctx.measureText(txt).width + 16, th = Math.max(20, W * 0.06), x = (W - tw) / 2, y = H * (sd === me ? 0.62 : 0.32) + k * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x, y, tw, th);
      ctx.fillStyle = teamCol(sd); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, W / 2, y + th / 2);
    });
    drawGold();
  }
  // Gold over a treasury that was destroyed in this fight (fx kind 'gold'): what the raider takes in gold with a plus,
  // what the owner loses in red with a minus. It rises from the treasury and fades.
  function drawGold() {
    const t = tilePx();
    for (const e of fx) {
      if (e.kind !== 'gold') continue;
      const p = Math.max(0, Math.min(1, e.age / e.life));
      ctx.globalAlpha = Math.min(1, (1 - p) * 3);
      ctx.font = `700 ${Math.max(12, Math.round(t * 0.5))}px "IBM Plex Mono", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const x = PX(e.x), y = PY(e.y) - t * (0.55 + 1.3 * Math.min(1, p * 1.5));
      ctx.lineWidth = Math.max(2, t * 0.09); ctx.strokeStyle = 'rgba(8,12,14,0.9)';
      ctx.strokeText(e.text, x, y);
      ctx.fillStyle = e.mine ? css('--foe') : css('--gold');
      ctx.fillText(e.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
  function draw() {
    pull();
    if (m) Game.useGrid(m);
    if (win && m) { // a window on the wide board: draw the whole board, moved and scaled into the canvas
      const cw = W, ch = H, s0 = S;
      S = cw / (win.cols * Game.TILE);
      const bw = Game.COLS * Game.TILE * S, bh = Game.ROWS * Game.TILE * S;
      ctx.save(); ctx.fillStyle = css('--board'); ctx.fillRect(0, 0, cw, ch);
      ctx.translate(-win.x * Game.TILE * S, Math.max(0, (ch - bh) / 2));
      W = bw; H = bh;
      try { drawInner(); } finally { ctx.restore(); W = cw; H = ch; S = s0; }
      return;
    }
    drawInner();
  }
  function drawInner() {
    if (!m) { drawBoard(); return; }
    if (bt && phase === 'battle' && battleCam) { // the battle cam, zoomed in around its focus
      const fx0 = PX(battleCam.x), fy0 = PY(battleCam.y);
      ctx.save(); ctx.translate(fx0, fy0); ctx.scale(battleCam.zoom, battleCam.zoom); ctx.translate(-fx0, -fy0);
      drawBattle();
      ctx.restore();
    } else if (bt && (phase === 'battle' || phase === 'result' || phase === 'end')) drawBattle();
    else drawDeploy();
  }

  // the tile under a point on the screen, in model coordinates (the flip is its own inverse)
  function tileAt(clientX, clientY) {
    pull();
    if (m) Game.useGrid(m); // the board as drawn (a 2v2 picture is wider than the match in play)
    const r = cv.getBoundingClientRect();
    let x = (clientX - r.left) / r.width * Game.COLS, y = (clientY - r.top) / r.height * Game.ROWS;
    if (win) { // the window on the wide board (see draw)
      const t = r.width / win.cols, oy = Math.max(0, (r.height - Game.ROWS * t) / 2);
      x = (clientX - r.left) / t + win.x; y = (clientY - r.top - oy) / t;
    }
    const c = Math.floor(x), rw = Math.floor(y);
    if (c < 0 || rw < 0 || c >= Game.COLS || rw >= Game.ROWS) return null;
    const fx = x - c, fy = y - rw; // where in the tile (for a wall's edge), in model terms
    return { col: scol(c), row: srow(rw), fx: me === 1 ? 1 - fx : fx, fy: me === 1 ? 1 - fy : fy };
  }

  function floor(plain = false) { pull(); drawBoard(plain); }

  return { size, draw, tileAt, thumb, floor };
};
