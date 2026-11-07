// ===== 3D board scenery: the land around the board (trees, bushes, rocks) and small dressing on it (grass, flowers) =====
// Scenery3D(THREE, scene, opts) loads models/scenery.bin (built by tools/scenery/build-scenery.js from the Quaternius
// Stylized Nature MegaKit, CC0) or, in a build that inlined it, window.PB_SCENERY (base64), and lays the models out once
// per map and side: instanced, one mesh per model part, so the whole scenery costs a few dozen draw calls.
// Purely visual: nothing here touches the game, and it is placed with its own seeded random numbers, so both players
// see the same land (each from their own side: the world always has your side toward +z).
// opts.onReady(): the models have loaded (the page draws a frame). opts.url: where scenery.bin is. opts.renderer: the
// WebGLRenderer, for baking the impostors.
// Keeping it cheap (a phone draws the whole scenery for well under 200 000 triangles): only trees and bushes near the
// board are real models (they cast real shadows onto it); everything further out is an impostor, a flat card facing
// the camera with a picture of that model, baked when a map first needs it, from three heights (8°, 40° and straight down) and
// blended by the angle the camera sees it from, with a soft round shadow on the ground under it.
// Calls: update(v, groundY, BW, BD, T): lay out the scenery for this view's map and side (cheap when nothing changed);
// biome(v) -> the look for this map { sky, land } (colours); shadows(on); dispose().
// The floor itself (meadow or sand under the zones) is painted by Scenery3D.floor below, through the 2D renderer's ground hook.
const Scenery3D = (THREE, scene, opts = {}) => {
  // ---------- looks per map: the colour of the sky and the land around the board, what grows there ----------
  // trees: which tree models; tint: a colour every model is multiplied by (1 = as painted); grow: how much of the
  // space round the board gets something (0 to 1); dress: small plants on the board itself.
  const BIOMES = {
    meadow: { sky: '#A3B6B4', land: '#64764D', tint: [1, 1, 1], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_3'], grow: 1.2, dress: 1 },
    forest: { sky: '#1D2B22', land: '#16271B', tint: [0.55, 0.68, 0.58], trees: ['CommonTree_1', 'CommonTree_2', 'CommonTree_4', 'Pine_1', 'Pine_2', 'Pine_3', 'TwistedTree_1'], grow: 1.25, dress: 0 },
    ice: { sky: '#26323A', land: '#1C2830', tint: [0.62, 0.72, 0.82], low: 'rocks', trees: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_5', 'DeadTree_1', 'DeadTree_3'], grow: 0.8, dress: 0 },
    cavern: { sky: '#120E17', land: '#17121D', tint: [0.42, 0.36, 0.5], low: 'rocks', trees: [], grow: 0.7, dress: 0 },
    // desert sand, palms and sun-bleached rocks; an oasis off the board (ponds), purely for looks
    desert: { sky: '#CBBE9F', land: '#A99063', tint: [1.04, 1, 0.94], low: 'desert', trees: ['PalmTree_1', 'PalmTree_2', 'PalmTree_3', 'PalmTree_4', 'DeadTree_1'], grow: 0.5, dress: 0.7, ponds: true,
      tints: [[/^Grass_Wispy|^Grass_Common_Short/, [1.3, 1.08, 0.55]], [/^Plant_7/, [1.15, 1, 0.62]], [/^DeadTree/, [1.15, 1.02, 0.85]]] },
  };
  // autumn: maples and birches in red and gold, red bushes, golden grass, fallen leaves on the floor
  BIOMES.autumn = { sky: '#B5AA95', land: '#5C5B39', tint: [1, 0.97, 0.92], low: 'autumn', trees: ['MapleTree_1', 'MapleTree_2', 'MapleTree_4', 'MapleTree_5', 'BirchTree_1', 'BirchTree_4', 'BirchTree_5', 'Pine_1'], grow: 1.2, dress: 1,
    tints: [[/^Grass/, [1.2, 1.02, 0.6]], [/^Fern|^Plant_1/, [1.25, 0.95, 0.5]], [/^Clover/, [1.15, 1, 0.6]]] };
  BIOMES.frost = { ...BIOMES.ice }; // Darkwoods: Frozen Peak's look without the snow (the Test Grid's own look)
  BIOMES.ice.snow = 0.75; // snow on everything that faces up, drifts round the board and falling snow
  // Looks added 2026-11-07. light: the scene's lights for this look (render3d; default the day sun) as hemi [sky,
  // ground, intensity], sun [colour, intensity], pos (the sun's position); fall: what drifts through the air (FALL
  // below); farLight: the far impostors' brightness, so they match the real models under a darker light; squash: models
  // drawn lower than tall ([pattern, height factor]); cabin: the cozy cabin off the board's far end.
  // Ashlands: a burnt forest. Charred pines and dead trees, bare rocks, embers rising through smoky air.
  BIOMES.ash = { sky: '#4E4642', land: '#2E2A27', tint: [0.62, 0.58, 0.55], low: 'ash', trees: ['DeadTree_1', 'DeadTree_3', 'DeadTree_1', 'Pine_2', 'Pine_3'], grow: 0.85, dress: 0.5,
    tints: [[/^Pine/, [0.3, 0.27, 0.25]], [/^Grass/, [1.05, 0.9, 0.7]], [/^DeadTree/, [0.7, 0.64, 0.6]]],
    light: { hemi: ['#D2C1B2', '#2A2220', 1.35], sun: ['#FFCDA6', 1.8] }, fall: 'embers', farLight: 0.9 };
  // Moonlit Snow: Frozen Peak at night, blue moonlight, falling snow and a cabin with warm windows at the far end
  BIOMES.moonlit = { ...BIOMES.ice, sky: '#070A12', land: '#5A6880', low: 'moonlit', tint: [0.6, 0.68, 0.85], trees: ['Pine_1', 'Pine_2', 'Pine_3', 'Pine_5', 'Pine_1', 'DeadTree_3'], grow: 0.85,
    light: { hemi: ['#9DB2E0', '#1A2030', 1.05], sun: ['#C4D2F5', 1.35], pos: [30, 58, 18] }, drift: '#9AA9C2', farLight: 0.62, cabin: true,
    shade: [0.92, 0.5, 18], night: [0.42, 0.56, 1.0, 0.26], deep: [0.95, 14, 50], deepSnow: 1.1 };
  // Savanna: golden hour on dry grass, lone flat-topped trees like acacias, a low warm sun with long shadows
  BIOMES.savanna = { sky: '#DDB27C', land: '#8F7C43', tint: [1.06, 0.98, 0.82], low: 'savanna', trees: ['CommonTree_3', 'CommonTree_5', 'DeadTree_1', 'CommonTree_3'], grow: 0.42, dress: 0.8,
    squash: [[/^CommonTree/, 0.5]], tints: [[/^CommonTree/, [1.0, 0.92, 0.6]], [/^Grass/, [1.35, 1.1, 0.55]], [/^Bush/, [1.1, 0.95, 0.55]], [/^DeadTree/, [1.1, 0.95, 0.78]]],
    light: { hemi: ['#FFE0B8', '#3A2E1E', 1.35], sun: ['#FFCF94', 2.5], pos: [-52, 40, 22] } };
  // a look (Scenery3D.LOOKS, below) -> its biome
  const biomeOf = (look) => BIOMES[(Scenery3D.LOOKS[look] || Scenery3D.LOOKS.meadow).biome] || BIOMES.meadow;
  const biome = (v) => biomeOf(Scenery3D.lookOf(v && (v.battlePre || v.m)));

  // ---------- shade: a look can darken everything round the board, more the further out (Moonlit Snow), while the board
  // itself keeps its light. shade = [how dark at most (0 to 1), from how far outside the board (m), fully by (m)]. ----------
  // night (biome .night = [r, g, b, brightness]): how the unlit snow is seen in the dark. Low light shifts what the eye
  // sees toward blue-green (the Purkinje shift): colours wash out, reds go dark first, and shadows sink into blue
  // rather than black. So far from the light a colour becomes its night brightness (weighted toward green and blue)
  // times a blue tint, with a faint blue floor. The cabin's warm light (uWarm: x, z, radius) is kept out of it.
  const shadeU = { uShade: { value: new THREE.Vector3(0, 1, 2) }, uHalf: { value: new THREE.Vector2(40, 50) }, uNight: { value: new THREE.Vector4(0, 0, 0, 0) }, uWarm: { value: new THREE.Vector3(0, 0, 0) }, uDeep: { value: new THREE.Vector3(0, 1, 2) } };
  const SHADE_GLSL = `uniform vec3 uShade; uniform vec2 uHalf; uniform vec4 uNight; uniform vec3 uWarm; uniform vec3 uDeep;
float pbDeep(vec2 xz) { return uDeep.x * smoothstep(uDeep.y, uDeep.z, length(max(abs(xz) - uHalf, 0.0))); }
float pbK(vec2 xz) { float k = uShade.x * smoothstep(uShade.y, uShade.z, length(max(abs(xz) - uHalf, 0.0)));
  if (uWarm.z > 0.0) k *= smoothstep(uWarm.z * 0.55, uWarm.z, length(xz - uWarm.xy)); return k; }
float pbShade(vec2 xz) { return 1.0 - pbK(xz); }
vec3 pbNight(vec3 c, vec2 xz) { float k = pbK(xz); if (k <= 0.0) return c;
  vec3 dark = uNight.w > 0.0 ? dot(c, vec3(0.08, 0.55, 0.37)) * uNight.rgb * uNight.w + uNight.rgb * 0.018 : vec3(0.0);
  c = mix(c, dark, k);
  // deep darkness (biome .deep = [strength, from m, full at m]): further out still, the woods sink into near-black
  if (uDeep.x > 0.0) { float d = length(max(abs(xz) - uHalf, 0.0)), q = uDeep.x * smoothstep(uDeep.y, uDeep.z, d);
    if (uWarm.z > 0.0) q *= smoothstep(uWarm.z * 0.55, uWarm.z, length(xz - uWarm.xy));
    c = mix(c, uNight.rgb * 0.012, q); }
  return c; }
`;
  // a lit material (scenery, drifts): darkened after lighting, by where each fragment stands
  function shadeLit(sh) {
    Object.assign(sh.uniforms, shadeU);
    sh.vertexShader = 'varying vec2 vShadeXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vShadeXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
      #else
        vShadeXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
      #endif`);
    sh.fragmentShader = SHADE_GLSL + 'varying vec2 vShadeXZ;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = pbNight(outgoingLight, vShadeXZ);\n#include <opaque_fragment>');
  }

  // ---------- loading ----------
  const FOLIAGE = /Leaves|Leaf|Grass|Flowers/;
  const snowU = { value: 0 };
  let lib = null; // name -> { h, r, parts: [{ geo, mat }] }
  const mats = [];
  const meshes = [];
  async function load() {
    let buf;
    if (window.PB_SCENERY) { const s = atob(window.PB_SCENERY); buf = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i); buf = buf.buffer; }
    else buf = await (await fetch(opts.url || 'models/scenery.bin')).arrayBuffer();
    const dv = new DataView(buf);
    if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'PBSC') throw new Error('scenery.bin: not a scenery file');
    const hl = dv.getUint32(4, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
    const base = 8 + hl + ((4 - ((8 + hl) % 4)) % 4);
    const texs = await Promise.all(head.tex.map(async (t) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(buf, base + t.off, t.len)], { type: 'image/webp' }));
      const tx = new THREE.Texture(bmp); tx.colorSpace = THREE.SRGBColorSpace; tx.flipY = false; tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.anisotropy = 4; tx.needsUpdate = true;
      const mat = new THREE.MeshLambertMaterial({ map: tx, side: THREE.DoubleSide, alphaTest: t.alpha ? 0.45 : 0 });
      // leaves and blades are lit the same on both faces (three.js turns a back face's normal around, which leaves it black)
      // and every colour is pulled a quarter of the way to grey: dusty, as the art direction asks
      const leafy = FOLIAGE.test(t.name);
      // snow (Frozen Peak): surfaces that face up turn white, by how much snowU says
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uSnow = snowU;
        sh.vertexShader = 'varying float vUpN;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          #ifdef USE_INSTANCING
            vUpN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;
          #else
            vUpN = normalize(mat3(modelMatrix) * objectNormal).y;
          #endif`);
        sh.fragmentShader = 'uniform float uSnow;\nvarying float vUpN;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.25);\n  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), uSnow * smoothstep(0.3, 0.75, vUpN));');
        shadeLit(sh);
        if (leafy) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
      };
      mat.customProgramCacheKey = () => leafy ? 'pb-leaf' : 'pb-scenery';
      mats.push(mat); return mat;
    }));
    lib = {};
    for (const [name, md] of Object.entries(head.models)) {
      lib[name] = { h: md.h, r: md.r, parts: md.parts.map((p) => {
        const geo = new THREE.BufferGeometry();
        const qp = new Int16Array(buf, base + p.pos, p.n * 3), pos = new Float32Array(p.n * 3);
        for (let i = 0; i < pos.length; i++) { const d = i % 3; pos[i] = p.plo[d] + (qp[i] + 32767) / 65534 * (p.phi[d] - p.plo[d]); }
        const qu = new Uint16Array(buf, base + p.uv, p.n * 2), uv = new Float32Array(p.n * 2);
        for (let i = 0; i < uv.length; i++) { const d = i % 2; uv[i] = p.ulo[d] + qu[i] / 65535 * (p.uhi[d] - p.ulo[d]); }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const nrm = new Int8Array(buf, base + p.nrm, p.n * 4).slice();
        if (FOLIAGE.test(head.tex[p.tex].name)) for (let i = 0; i < nrm.length; i += 4) { // leaves and blades: normals bent up, so their backs aren't black
          const x = nrm[i] * 0.35, y = nrm[i + 1] * 0.35 + 127, z = nrm[i + 2] * 0.35, l = Math.hypot(x, y, z) / 127;
          nrm[i] = x / l; nrm[i + 1] = y / l; nrm[i + 2] = z / l;
        }
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 4, true));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, base + p.idx, p.ni).slice(), 1));
        geo.computeBoundingSphere();
        return { geo, mat: texs[p.tex] };
      }) };
    }
  }
  // snow piles (Moonlit Snow): soft lumpy mounds made here, used like any scenery model (SnowPile_1 to _3)
  function addSnowPiles() {
    const mat = new THREE.MeshLambertMaterial({ color: '#E4EAF3', flatShading: true });
    mat.onBeforeCompile = shadeLit; mat.customProgramCacheKey = () => 'pb-snowpile'; mats.push(mat);
    [[1.25, 0.85, 0.5, 0], [0.9, 1.1, 0.62, 1.7], [1.5, 0.75, 0.4, 3.1]].forEach(([sx, sz, sy, ph], i) => {
      const geo = new THREE.IcosahedronGeometry(1, 2), pos = geo.attributes.position, v = new THREE.Vector3();
      let lo = Infinity;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k);
        // a bumpy outline, the same for a corner shared by several faces (so the surface stays closed), then flattened
        const f = 1 + 0.16 * Math.sin(3 * v.x + ph) * Math.sin(2.7 * v.z + 0.4 + ph) + 0.08 * Math.sin(5 * v.y + ph * 2);
        v.multiplyScalar(f); v.y = Math.max(v.y, -0.15);
        v.set(v.x * sx, v.y * sy, v.z * sz); pos.setXYZ(k, v.x, v.y, v.z); lo = Math.min(lo, v.y);
      }
      geo.translate(0, -lo - 0.05, 0); geo.computeVertexNormals(); geo.computeBoundingSphere();
      geo.computeBoundingBox();
      lib['SnowPile_' + (i + 1)] = { h: geo.boundingBox.max.y, r: Math.max(sx, sz), parts: [{ geo, mat }] };
    });
  }
  const ready = load().then(() => { addSnowPiles(); if (opts.renderer) setupImpostors(); key = ''; opts.onReady && opts.onReady(); }).catch((e) => console.warn('No Mans Land: no 3D scenery', e));

  // ---------- impostors: pictures of the far trees and bushes, baked into one atlas ----------
  const ELEV = [8, 40, 90], ICELL = 256, IGRID = 8; // views per model, cell size in pixels, cells per atlas row
  // only the models this map shows far out are baked (again when the map changes), so the atlas stays small
  let atlas = null, atlasKey = '', impIndex = null, impMat = null, impGeo = null, blobMat = null, blobGeo = null;
  const impostorable = (n) => lib[n] && (lib[n].h > 2.5 || /^Bush/.test(n));
  function bake(names) {
    const renderer = opts.renderer;
    if (!impMat || names.join() + snowU.value === atlasKey) return;
    atlasKey = names.join() + snowU.value; if (atlas) atlas.dispose();
    impIndex = {};
    if (!names.length) { atlas = null; return; }
    const rows = Math.ceil(names.length * ELEV.length / IGRID);
    atlas = new THREE.WebGLRenderTarget(IGRID * ICELL, rows * ICELL, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const bs = new THREE.Scene();
    bs.add(new THREE.HemisphereLight('#cfe3ff', '#20262a', 1.6));
    const lamp = new THREE.DirectionalLight('#fff3dc', 2.0); bs.add(lamp); bs.add(lamp.target);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevCol = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
    names.forEach((name, mi) => {
      const md = lib[name], rad = Math.max(md.r, 0.3);
      const S = 1.06 * Math.max(md.h, 2 * rad, md.h * Math.cos(0.7) + 2 * rad * Math.sin(0.7)); // the picture's side (m)
      impIndex[name] = { i: mi, S };
      const group = new THREE.Group(); for (const p of md.parts) group.add(new THREE.Mesh(p.geo, p.mat)); bs.add(group);
      ELEV.forEach((e, vi) => {
        const c = mi * ELEV.length + vi, a = e * Math.PI / 180;
        Object.assign(cam, { left: -S / 2, right: S / 2, top: S / 2, bottom: -S / 2 }); cam.updateProjectionMatrix();
        cam.up.set(0, e === 90 ? 0 : 1, e === 90 ? -1 : 0);
        cam.position.set(0, md.h / 2 + Math.sin(a) * 150, Math.cos(a) * 150); cam.lookAt(0, md.h / 2, 0);
        lamp.position.set(-40, 80, 60); // light from up front-left, as the board's sun
        atlas.viewport.set((c % IGRID) * ICELL, Math.floor(c / IGRID) * ICELL, ICELL, ICELL); atlas.scissor.copy(atlas.viewport); atlas.scissorTest = true;
        renderer.setRenderTarget(atlas); renderer.clear(); renderer.render(bs, cam);
      });
      bs.remove(group);
    });
    renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto; renderer.setClearColor(prevCol, prevA);
    impMat.uniforms.uAtlas.value = atlas.texture; impMat.uniforms.uGrid.value.set(IGRID, rows);
  }
  function setupImpostors() {
    impGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    impMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAtlas: { value: null }, uGrid: { value: new THREE.Vector2(IGRID, 1) } }]), ...shadeU },
      fog: true,
      vertexShader: `
        attribute vec3 iPos; attribute float iSize; attribute float iModel; attribute vec3 iTint; attribute float iFlip; attribute float iSy;
        uniform vec2 uGrid;
        varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying vec3 vTint; varying vec2 vShadeXZ;
        #include <fog_pars_vertex>
        vec2 cellUv(float c, vec2 uv) { return (vec2(mod(c, uGrid.x), floor(c / uGrid.x)) + uv) / uGrid; }
        void main() {
          vec3 toCam = normalize(cameraPosition - iPos);
          float elev = degrees(asin(clamp(toCam.y, -1.0, 1.0)));
          float i0 = elev < 40.0 ? 0.0 : 1.0;
          vMix = elev < 40.0 ? clamp((elev - 8.0) / 32.0, 0.0, 1.0) : clamp((elev - 40.0) / 50.0, 0.0, 1.0);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 wp = iPos + (right * position.x + up * position.y * iSy) * iSize;
          vec2 uv = vec2(position.x * iFlip + 0.5, position.y + 0.5);
          float c0 = iModel * 3.0 + i0;
          vUv0 = cellUv(c0, uv); vUv1 = cellUv(c0 + 1.0, uv); vTint = iTint; vShadeXZ = iPos.xz;
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uAtlas;
        varying vec2 vUv0; varying vec2 vUv1; varying float vMix; varying vec3 vTint; varying vec2 vShadeXZ;
        ${SHADE_GLSL}
        #include <fog_pars_fragment>
        void main() {
          vec4 c = mix(texture2D(uAtlas, vUv0), texture2D(uAtlas, vUv1), vMix);
          if (c.a < 0.4) discard;
          gl_FragColor = vec4(pbNight(c.rgb / c.a * vTint, vShadeXZ), 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    // a soft round shadow, for the ground under an impostor
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const g = sc.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), color: '#1A2414', transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  // the impostors and their shadows for one layout: list of [name, x, y, z, s, colour [r, g, b], flip, height factor]
  function impostors(list) {
    const n = list.length; if (!n || !impMat) return;
    const geo = impGeo.clone(); geo.instanceCount = n;
    const P = new Float32Array(n * 3), Z = new Float32Array(n), M = new Float32Array(n), C = new Float32Array(n * 3), F = new Float32Array(n), SY = new Float32Array(n);
    const blobs = new THREE.InstancedMesh(blobGeo, blobMat, n);
    list.forEach(([name, x, y, z, s, col, flip, sy = 1], i) => {
      const md = lib[name], im = impIndex[name];
      P.set([x, y + md.h * s * sy / 2, z], i * 3); Z[i] = im.S * s; M[i] = im.i; F[i] = flip; SY[i] = sy;
      C.set(col, i * 3);
      const b = Math.max(1.5, md.r * s * 1.6);
      blobs.setMatrixAt(i, tmpM.compose(tmpP.set(x + b * 0.15, y + 0.02, z + b * 0.1), tmpQ.identity(), tmpS.set(b, 1, b)));
    });
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(P, 3)); geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(Z, 1));
    geo.setAttribute('iModel', new THREE.InstancedBufferAttribute(M, 1)); geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(C, 3));
    geo.setAttribute('iFlip', new THREE.InstancedBufferAttribute(F, 1)); geo.setAttribute('iSy', new THREE.InstancedBufferAttribute(SY, 1));
    const mesh = new THREE.Mesh(geo, impMat); mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.name = 'impostors'; mesh.count = n;
    blobs.instanceMatrix.needsUpdate = true; blobs.computeBoundingSphere(); blobs.raycast = () => {}; blobs.name = 'blobs';
    scene.add(mesh, blobs); meshes.push(mesh, blobs);
  }

  // ---------- layout ----------
  let key = null, castShadows = true;
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  function clear() { for (const m of meshes) { scene.remove(m); if (m.isInstancedMesh) m.dispose(); else if (m.name !== 'pond') m.geometry.dispose(); } meshes.length = 0; }
  // what goes where. Each pick is [model, weight]; scale is [lo, hi].
  const LOW = [['Bush_Common_Flowers', 1.2], ['Fern_1', 2.5], ['Rock_Medium_1', 0.6], ['Rock_Medium_2', 0.6], ['Rock_Medium_3', 0.6], ['Plant_1_Big', 1.5], ['Grass_Wispy_Short', 1], ['Grass_Common_Tall', 3]];
  const TUFT = [['Grass_Common_Short', 7], ['Grass_Wispy_Short', 1], ['Grass_Common_Tall', 2], ['Clover_1', 2], ['Flower_3_Group', 1], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Mushroom_Common', 0.5]];
  const DRESS = [['Grass_Common_Short', 7], ['Grass_Wispy_Short', 1], ['Clover_1', 1], ['Flower_3_Group', 1], ['Pebble_Round_1', 1.5], ['Pebble_Round_2', 1.5], ['Pebble_Square_2', 1]];
  const PEBBLES = [['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Pebble_Square_2', 1], ['Mushroom_Common', 0.3]];
  const ROCKS = [['Rock_Medium_1', 1], ['Rock_Medium_2', 1], ['Rock_Medium_3', 1], ['Pebble_Square_2', 0.5]];
  const AUTUMN = {
    low: [['Bush_Common', 2.5], ['Bush_Common_Flowers', 0.5], ['Fern_1', 1.5], ['Rock_Medium_1', 0.6], ['Rock_Medium_2', 0.6], ['Rock_Medium_3', 0.6], ['Plant_1_Big', 1], ['Grass_Common_Tall', 2.5]],
    tuft: [['Grass_Common_Short', 6], ['Grass_Common_Tall', 2], ['Clover_1', 1], ['Mushroom_Common', 1.5], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1]],
    dress: [['Grass_Common_Short', 6], ['Clover_1', 1], ['Mushroom_Common', 1], ['Pebble_Round_1', 1.5], ['Pebble_Round_2', 1.5], ['Pebble_Square_2', 1]],
    rocks: ROCKS,
  };
  // the desert's lists (low things, tufts, the board's dressing, boulders)
  const DESERT = {
    low: [['DesertRock_1', 1], ['DesertRock_2', 1], ['DesertRock_3', 1], ['Grass_Wispy_Short', 3], ['PalmTree_5', 1]],
    tuft: [['Grass_Wispy_Short', 3], ['Grass_Common_Short', 2], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1], ['Pebble_Square_2', 1]],
    dress: [['Pebble_Round_1', 2], ['Pebble_Round_2', 2], ['Pebble_Square_2', 2], ['Grass_Wispy_Short', 1.5]],
    rocks: [['DesertRock_1', 1], ['DesertRock_2', 1], ['DesertRock_3', 1]],
  };
  // Ashlands' lists: rocks and pebbles, a little dry grass
  const ASH = {
    low: [['Rock_Medium_1', 1], ['Rock_Medium_2', 1], ['Rock_Medium_3', 1], ['Grass_Wispy_Short', 1.5], ['Pebble_Square_2', 1]],
    tuft: [['Pebble_Round_1', 2], ['Pebble_Round_2', 2], ['Pebble_Square_2', 1.5], ['Grass_Wispy_Short', 1]],
    dress: [['Pebble_Round_1', 2], ['Pebble_Round_2', 2], ['Pebble_Square_2', 1.5], ['Grass_Wispy_Short', 0.6]],
    rocks: ROCKS,
  };
  // Savanna's lists: tall golden grass everywhere, a few bushes and rocks
  // Moonlit Snow's lists: snow piles in place of most of the rocks
  const SNOWY = {
    low: [['SnowPile_1', 2], ['SnowPile_2', 2], ['SnowPile_3', 2], ['Rock_Medium_1', 0.4], ['Rock_Medium_2', 0.4]],
    tuft: [['SnowPile_1', 1.5], ['SnowPile_2', 1.5], ['SnowPile_3', 1.5], ['Pebble_Round_1', 0.4], ['Pebble_Square_2', 0.3]],
    dress: DRESS,
    rocks: [['SnowPile_1', 1], ['SnowPile_2', 1], ['SnowPile_3', 1], ['Rock_Medium_1', 0.25], ['Rock_Medium_3', 0.25]],
  };
  const SAVANNA = {
    low: [['Grass_Common_Tall', 5], ['Grass_Wispy_Short', 2], ['Bush_Common', 1], ['DesertRock_1', 0.4], ['DesertRock_2', 0.4]],
    tuft: [['Grass_Common_Tall', 4], ['Grass_Wispy_Short', 3], ['Grass_Common_Short', 2], ['Pebble_Round_1', 0.5]],
    dress: [['Grass_Wispy_Short', 3], ['Grass_Common_Short', 3], ['Pebble_Round_1', 1], ['Pebble_Round_2', 1]],
    rocks: [['DesertRock_1', 1], ['DesertRock_2', 1], ['DesertRock_3', 1]],
  };
  // the oasis's water (off the board): water, a shallow rim and wet sand round it
  const pondMats = [new THREE.MeshLambertMaterial({ color: '#8C7650' }), new THREE.MeshLambertMaterial({ color: '#86AE9E' }), new THREE.MeshStandardMaterial({ color: '#4E8C8E', roughness: 0.2, metalness: 0 })];
  const pondGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  // snow drifts: soft low mounds
  const driftGeo = new THREE.IcosahedronGeometry(1, 1), driftMat = new THREE.MeshLambertMaterial({ color: '#B4C1CA' });
  driftMat.onBeforeCompile = shadeLit; driftMat.customProgramCacheKey = () => 'pb-drift';
  // the deep snow sheet (Moonlit Snow): vertex colours for crests and hollows, the look's tint as its colour
  const snowGroundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  snowGroundMat.onBeforeCompile = shadeLit; snowGroundMat.customProgramCacheKey = () => 'pb-deepsnow';
  // smooth value noise, 0 to 1, the same everywhere for the same spot
  const hash2 = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // the land's own shade: a dark veil over the ground round the board (the page's land plane is one flat colour)
  const veilMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: true, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shadeU },
    vertexShader: `varying vec2 vShadeXZ;
      #include <fog_pars_vertex>
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vShadeXZ = w.xz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `${SHADE_GLSL} varying vec2 vShadeXZ;
      #include <fog_pars_fragment>
      void main() { float a = max(1.0 - pbShade(vShadeXZ), pbDeep(vShadeXZ));
        #ifdef USE_FOG
          a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
        gl_FragColor = vec4(uNight.rgb * 0.05, a); }` });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), veilMat);
  veil.position.y = -0.035; veil.raycast = () => {}; veil.visible = false; veil.renderOrder = -1; scene.add(veil);
  // falling snow: points drifting down through a box round the board, moved in the shader (tick(dt) moves the clock)
  const FLAKES = 1600, snowTime = { value: 0 };
  const flakeGeo = new THREE.BufferGeometry(); {
    const P = new Float32Array(FLAKES * 3), S = new Float32Array(FLAKES);
    for (let i = 0; i < FLAKES; i++) { P.set([(Math.random() * 2 - 1) * 70, Math.random() * 45, -95 + Math.random() * 160], i * 3); S[i] = Math.random(); }
    flakeGeo.setAttribute('position', new THREE.BufferAttribute(P, 3)); flakeGeo.setAttribute('aSeed', new THREE.BufferAttribute(S, 1));
    flakeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, -15), 130);
  }
  // the same points carry falling snow or rising embers (Ashlands): dir 1 falls, -1 rises; keep: the share of the
  // points shown; flick: how much each one flickers; sway: how far it drifts sideways
  const FALL = {
    snow: { col: [0.93, 0.96, 1.0], dir: 1, spd: 1, keep: 1, size: 1, flick: 0, sway: 1 },
    embers: { col: [1.0, 0.58, 0.26], dir: -1, spd: 0.75, keep: 0.5, size: 1.2, flick: 0.8, sway: 1.8 },
  };
  const fallU = { uCol: { value: new THREE.Vector3() }, uDir: { value: 1 }, uSpd: { value: 1 }, uKeep: { value: 1 }, uSize: { value: 1 }, uFlick: { value: 0 }, uSway: { value: 1 } };
  const flakeMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: snowTime, uPx: { value: 1 }, ...fallU, ...shadeU },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPx; uniform float uDir; uniform float uSpd; uniform float uKeep; uniform float uSize; uniform float uFlick; uniform float uSway; varying float vA;
      ${SHADE_GLSL}
      void main() { vec3 p = position; p.y = mod(p.y - uDir * uTime * uSpd * (1.6 + aSeed * 1.6), 45.0); p.x += sin(uTime * 0.7 + aSeed * 40.0) * 1.3 * uSway; p.z += cos(uTime * 0.5 + aSeed * 30.0) * 0.8 * uSway;
        vec4 mv = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSeed > uKeep ? 0.0 : uPx * uSize * (0.35 + aSeed * 0.35) * 300.0 / max(1.0, -mv.z);
        vA = (0.55 + aSeed * 0.35) * (1.0 - uFlick * (0.5 + 0.5 * sin(uTime * (3.0 + aSeed * 4.0) + aSeed * 60.0))) * (uDir < 0.0 ? smoothstep(45.0, 20.0, p.y) : 1.0) * (0.35 + 0.65 * pbShade(p.xz)) * (1.0 - 0.85 * pbDeep(p.xz)); }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(uCol, vA * smoothstep(0.5, 0.2, d)); }` });
  const flakes = new THREE.Points(flakeGeo, flakeMat); flakes.visible = false; flakes.raycast = () => {}; scene.add(flakes);
  function showFall(kind) {
    const f = FALL[kind]; flakes.visible = !!f; if (!f) return;
    fallU.uCol.value.set(...f.col); fallU.uDir.value = f.dir; fallU.uSpd.value = f.spd; fallU.uKeep.value = f.keep; fallU.uSize.value = f.size; fallU.uFlick.value = f.flick; fallU.uSway.value = f.sway;
    flakeMat.blending = kind === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending; flakeMat.needsUpdate = true;
  }

  // ---------- the cabin (Moonlit Snow): log walls, a snowy roof, a stone chimney with smoke, warm lit windows whose
  // light spills on the snow. Built once from simple shapes, moved and shown per layout (never disposed with it). ----------
  const cabin = new THREE.Group(); cabin.visible = false; scene.add(cabin);
  const cabinLight = new THREE.PointLight('#FFAE5C', 0, 34, 2); // intensity 0 when hidden, so no look switch recompiles shaders
  scene.add(cabinLight);
  const smoke = [];
  {
    const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; };
    // logs: horizontal bands with dark gaps and a lighter top edge
    const logTex = cv(64, 64, (g, w, h) => { for (let i = 0; i < 4; i++) { const y = i * 16; g.fillStyle = i % 2 ? '#6B4A33' : '#73513A'; g.fillRect(0, y, w, 16); g.fillStyle = '#8A6447'; g.fillRect(0, y + 2, w, 3); g.fillStyle = '#3A281D'; g.fillRect(0, y + 14, w, 2); } });
    logTex.wrapS = logTex.wrapT = THREE.RepeatWrapping; logTex.repeat.set(2, 1.6);
    const glowTex = cv(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const puffTex = cv(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
    const M = {
      log: new THREE.MeshLambertMaterial({ map: logTex, color: '#B9A595', side: THREE.DoubleSide }),
      roof: new THREE.MeshLambertMaterial({ color: '#3B2C24' }),
      snow: new THREE.MeshLambertMaterial({ color: '#DDE5F0' }),
      stone: new THREE.MeshLambertMaterial({ color: '#6A6E75' }),
      dark: new THREE.MeshLambertMaterial({ color: '#2E2018' }),
      win: new THREE.MeshBasicMaterial({ color: '#FFC56E' }), // unlit: it glows whatever the moon does
      spill: new THREE.MeshBasicMaterial({ map: glowTex, color: '#FF9F4A', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    const add = (geo, mat, x, y, z, ry = 0, rz = 0, parent = cabin) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.raycast = () => {}; parent.add(m); return m; };
    const W = 7, D = 5.4, H = 3, R = 2.3, a = Math.atan2(R, W / 2), Ls = Math.hypot(W / 2, R) + 0.7;
    add(new THREE.BoxGeometry(W, H, D), M.log, 0, H / 2, 0);
    const tri = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, R)]);
    for (const z of [D / 2 + 0.005, -D / 2 - 0.005]) add(new THREE.ShapeGeometry(tri), M.log, 0, H, z);
    for (const sd of [1, -1]) { // the two roof slopes, each wood under a thick layer of snow
      const p = new THREE.Group(); p.position.set(sd * W / 4, H + R / 2 + 0.05, 0); p.rotation.z = -sd * a; cabin.add(p);
      add(new THREE.BoxGeometry(Ls, 0.28, D + 1.1), M.roof, 0, 0.14, 0, 0, 0, p);
      add(new THREE.BoxGeometry(Ls + 0.1, 0.3, D + 1.2), M.snow, 0, 0.42, 0, 0, 0, p);
    }
    add(new THREE.BoxGeometry(0.95, R + 1.2, 0.95), M.stone, -W * 0.27, H + (R + 1.2) / 2, -0.6);
    add(new THREE.BoxGeometry(1.15, 0.22, 1.15), M.snow, -W * 0.27, H + R + 1.3, -0.6);
    add(new THREE.BoxGeometry(1.15, 2.1, 0.12), M.dark, 0, 1.05, D / 2 + 0.06); // the door
    add(new THREE.BoxGeometry(2.4, 0.18, 1.3), M.snow, 0, 0.09, D / 2 + 0.75);   // snow on the doorstep
    // a lit window: the glowing pane, a dark cross and a sill
    const win = (x, y, z, ry, w = 1.2, h = 0.95) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; cabin.add(g);
      add(new THREE.PlaneGeometry(w, h), M.win, 0, 0, 0.02, 0, 0, g);
      add(new THREE.BoxGeometry(w + 0.2, 0.09, 0.08), M.dark, 0, 0, 0.05, 0, 0, g);
      add(new THREE.BoxGeometry(0.09, h + 0.2, 0.08), M.dark, 0, 0, 0.05, 0, 0, g);
      for (const yy of [h / 2 + 0.06, -h / 2 - 0.06]) add(new THREE.BoxGeometry(w + 0.3, 0.12, 0.16), yy > 0 ? M.dark : M.snow, 0, yy, 0.06, 0, 0, g);
    };
    win(-2.2, 1.65, D / 2 + 0.01, 0); win(2.2, 1.65, D / 2 + 0.01, 0); win(0, H + 0.85, D / 2 + 0.02, 0, 0.7, 0.6);
    win(W / 2 + 0.01, 1.65, 0.6, Math.PI / 2); win(-W / 2 - 0.01, 1.65, 0.9, -Math.PI / 2);
    // the warm light on the snow: soft glows under the windows and in front of the door
    const spill = (x, z, sx, sz) => { const m = add(new THREE.PlaneGeometry(1, 1), M.spill, x, 0.06, z); m.rotation.x = -Math.PI / 2; m.scale.set(sx, sz, 1); m.renderOrder = 2; };
    spill(0, D / 2 + 3.2, 11, 6.5); spill(W / 2 + 2.6, 0.6, 5, 4.5); spill(-W / 2 - 2.6, 0.9, 5, 4.5);
    // firewood stacked by the wall
    const logG = new THREE.CylinderGeometry(0.17, 0.17, 1.6, 7).rotateZ(Math.PI / 2);
    [[0, 0.17], [0.36, 0.17], [0.72, 0.17], [0.18, 0.47], [0.54, 0.47], [0.36, 0.77]].forEach(([zz, y]) => add(logG, M.roof, W / 2 + 0.45, y, -1.6 + zz, Math.PI / 2));
    // chimney smoke: a few soft puffs rising and fading (moved in tick)
    for (let i = 0; i < 6; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#8C95A3', transparent: true, depthWrite: false, opacity: 0 })); s.raycast = () => {}; cabin.add(s); smoke.push(s); }
    smoke.top = new THREE.Vector3(-W * 0.27, H + R + 1.5, -0.6);
    cabin.userData.dispose = () => { cabin.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== logTex) o.material.map.dispose(); o.material.dispose(); } }); logTex.dispose(); for (const m of Object.values(M)) m.dispose(); };
  }
  // where the cabin stands in this layout (null: not shown); nothing else is placed within its clearing
  let cabinAt = null;
  function showCabin(at) {
    cabinAt = at; cabin.visible = !!at; cabinLight.intensity = at ? 110 : 0;
    if (!at) return;
    cabin.position.set(at.x, 0, at.z); cabin.rotation.y = at.ang; cabin.scale.setScalar(at.s);
    cabinLight.position.set(at.x + Math.sin(at.ang) * 4.5 * at.s, 2.4 * at.s, at.z + Math.cos(at.ang) * 4.5 * at.s);
  }
  // the clock for the falling snow, embers and chimney smoke (the page calls it every frame it draws); px: the renderer's pixels per CSS pixel
  let smokeT = 0;
  function tick(dt, px = 1) {
    if (flakes.visible) { snowTime.value += dt; flakeMat.uniforms.uPx.value = px; }
    if (cabin.visible) {
      smokeT += dt;
      smoke.forEach((s, i) => { const ph = (smokeT * 0.12 + i / smoke.length) % 1; s.position.set(smoke.top.x + ph * 1.8, smoke.top.y + ph * 7, smoke.top.z - ph * 0.6); s.scale.setScalar(0.9 + ph * 3); s.material.opacity = 0.42 * Math.sin(ph * Math.PI) * (1 - ph * 0.4); });
    }
  }
  function update(v, groundY, BW, BD, T) {
    if (!lib || !v || !v.m) return;
    const src = v.battlePre || v.m, mp = Game.mapOf(src), id = (mp && mp.id) || 'standard', look = Scenery3D.lookOf(src);
    const k = [id, look, v.me, Game.COLS, Game.ROWS, castShadows].join('|');
    if (k === key) return;
    key = k; clear();
    const bi = biomeOf(look), hF = v.me === 1 ? -1 : 1;
    // seeded per map, not per side: both players get the same land, each seeing it from their own end
    let sd = 0; for (const ch of id) sd = (sd * 31 + ch.charCodeAt(0)) % 2147483647; sd = sd || 7;
    const rr = () => { sd = (sd * 16807) % 2147483647; return (sd - 1) / 2147483646; };
    const pickOf = (list) => { let s = 0; for (const [, w] of list) s += w; let x = rr() * s; for (const [n, w] of list) { if ((x -= w) <= 0) return n; } return list[0][0]; };
    const hw = BW / 2, hd = BD / 2;
    // model (+ '~' when far out: no shadow, an impostor if it has one; bushes from 6 m) -> [[x, y, z, ang, s, shade]]
    const placed = new Map();
    // ponds (the desert's oasis): nothing else grows in the water
    const ponds = bi.ponds ? [{ x: hw * 0.2, z: -hd - 25, rx: 24, rz: 12 }, { x: -hw - 17, z: -hd * 0.25, rx: 9, rz: 16 }] : [];
    // the cabin (Moonlit Snow): off the far end, a little right of the middle, turned toward the board; its clearing stays open
    const cab = bi.cabin ? { x: hw * 0.32, z: -hd - 15, ang: -0.22, r: 11, s: 1.4 } : null;
    const inPond = (x, z, k = 1.12) => ponds.some((p) => ((x - p.x) / p.rx) ** 2 + ((z - p.z) / p.rz) ** 2 < k * k) || (cab && Math.hypot(x - cab.x, z - cab.z) < cab.r);
    const tintFor = (name) => { const t = (bi.tints || []).find(([re]) => re.test(name)); return t ? t[1] : [1, 1, 1]; };
    const squashOf = (name) => { const t = (bi.squash || []).find(([re]) => re.test(name)); return t ? t[1] : 1; };
    const put = (name, x, z, s, y = 0, wet = false) => {
      if (!lib[name] || (!wet && inPond(x, z))) return;
      const d = outside(x, z), k = name + (d > 16 || (d > 6 && /^Bush/.test(name)) ? '~' : ''), sh = 0.85 + rr() * 0.3, t = tintFor(name);
      y += groundH(x, z) * 0.7; // on deep snow (Moonlit Snow) things stand a little sunk in
      (placed.get(k) || placed.set(k, []).get(k)).push([x, y, z, rr() * Math.PI * 2, s, [bi.tint[0] * t[0] * sh, bi.tint[1] * t[1] * sh, bi.tint[2] * t[2] * sh], squashOf(name)]);
    };
    const L = { desert: DESERT, autumn: AUTUMN, ash: ASH, savanna: SAVANNA, moonlit: SNOWY, rocks: { low: ROCKS, tuft: PEBBLES, rocks: ROCKS, dress: DRESS } }[bi.low] || { low: LOW, tuft: TUFT, rocks: ROCKS, dress: DRESS };
    const low = () => pickOf(L.low), tuft = () => pickOf(L.tuft);
    const outside = (x, z) => Math.max(Math.abs(x) - hw, Math.abs(z) - hd, 0) > 0 ? Math.hypot(Math.max(0, Math.abs(x) - hw), Math.max(0, Math.abs(z) - hd)) : 0;
    // deep snow (biome .deepSnow): the height of the snow at a spot, 0 on the board, rising over its first metres
    // outside into long wind-blown drifts, flattened round the cabin so its door and light stay clear
    const groundH = bi.deepSnow ? (x, z) => {
      const d = outside(x, z); if (d <= 0) return 0;
      let h = 0.25 + 0.9 * vnoise(x * 0.035 + 3.1, z * 0.11 - 1.7) + 0.35 * vnoise(x * 0.12 - 5.3, z * 0.09 + 2.2) + 0.12 * vnoise(x * 0.4, z * 0.4);
      h *= bi.deepSnow * smoothstep(0.3, 7, d);
      if (cab) h *= 0.15 + 0.85 * smoothstep(cab.r * 1.05, cab.r * 1.5, Math.hypot(x - cab.x, z - cab.z));
      return h;
    } : () => 0;
    // 1. the edge: a frame of bushes, rocks and tall grass hugging the board, so its edge doesn't end in a hard line
    for (let s = 0; s < 2 * (BW + BD); s += 2.6) {
      if (rr() > 0.8 * bi.grow) continue;
      let x, z; const off = 0.8 + rr() * 2.8;
      if (s < BW) { x = -hw + s; z = -hd - off; } else if (s < BW + BD) { x = hw + off; z = -hd + (s - BW); }
      else if (s < 2 * BW + BD) { x = hw - (s - BW - BD); z = hd + off; } else { x = -hw - off; z = hd - (s - 2 * BW - BD); }
      const near = z > hd; // your end: keep it low so it never hides your own squads from the angled view
      put(low(), x, z, (near ? 0.8 : 1) * (1 + rr() * 0.8));
    }
    // 2. the land around: trees thicken with distance; your end gets only low things (the angled view looks over it)
    const CELL = 8; // a tree at most every 8 m (near the board a real model of about 4000 triangles, further out an impostor)
    for (let gx = -hw - 50; gx < hw + 50; gx += CELL) for (let gz = -hd - 70; gz < hd + 40; gz += CELL) {
      const x = gx + rr() * CELL, z = gz + rr() * CELL, d = outside(x, z);
      if (d < 4) continue;
      const nearBoard = d < 16; // real models here: keep them fewer
      const behindMe = z > hd - 4 && Math.abs(x) < hw + 14;
      if (behindMe) { if (d < 22 && rr() < 0.35 * bi.grow) put(low(), x, z, 0.9 + rr() * 0.8); continue; }
      const p = Math.min(1, (d - 3) / 10) * (nearBoard ? 0.55 : 0.85) * bi.grow;
      if (rr() > p) { if (d < 16 && rr() < 0.6) put(low(), x, z, 0.9 + rr() * 0.9); continue; }
      if (!bi.trees.length || rr() < 0.12) { put(pickOf(L.rocks), x, z, 1.6 + rr() * 2.2); continue; } // a boulder now and then
      let tree = bi.trees[Math.floor(rr() * bi.trees.length)];
      if (nearBoard && /^Twisted/.test(tree)) tree = bi.trees[0]; // the big twisted trees (9000 triangles) only stand far out, as impostors
      put(tree, x, z, 1.6 + rr() * 0.9);
      if (nearBoard && rr() < 0.5) put(low(), x + (rr() - 0.5) * 4, z + (rr() - 0.5) * 4, 0.9 + rr() * 0.6); // undergrowth
    }
    // 3. grass round the board's edge, out in the open land
    for (let n = 0; n < 220 * bi.grow; n++) {
      const x = (rr() * 2 - 1) * (hw + 24), z = (rr() * 2 - 1) * (hd + 24), d = outside(x, z);
      if (d > 0.3 && d < 14) put(tuft(), x, z, 1.1 + rr() * 0.9);
    }
    // 4. on the board: a light dressing of small plants (not on walls or water), low enough to stay out of the way
    if (bi.dress) {
      const n = Math.round(Game.COLS * Game.ROWS * 1.2 * bi.dress);
      for (let i = 0; i < n; i++) {
        const x = (rr() - 0.5) * BW, z = (rr() - 0.5) * BD;
        const c = Math.floor((x + hw) / T), r = Math.floor((z + hd) / T);
        const col = hF === 1 ? c : Game.COLS - 1 - c, row = hF === 1 ? r : Game.ROWS - 1 - r;
        const tl = mp && mp.terrain ? Game.terrainTile(src, col, row) : null;
        if (tl && '#~s'.includes(tl.ch)) continue;
        put(pickOf(L.dress), x, z, 0.55 + rr() * 0.45, groundY(x, z));
      }
    }
    // 5. the oasis: water with a shallow rim and wet sand, reeds at the edge, palms round it
    for (const p of ponds) {
      [1.14, 1.04, 1].forEach((k, i) => { const m = new THREE.Mesh(pondGeo, pondMats[i]); m.scale.set(p.rx * k, 1, p.rz * k); m.position.set(p.x, 0.02 + i * 0.015, p.z); m.raycast = () => {}; m.name = 'pond'; scene.add(m); meshes.push(m); });
      const per = 2 * Math.PI * Math.sqrt((p.rx * p.rx + p.rz * p.rz) / 2);
      for (let s = 0; s < per; s += 1.4) { const a = s / per * Math.PI * 2 + rr() * 0.1, k = 0.96 + rr() * 0.12; put(rr() < 0.75 ? 'Grass_Common_Tall' : 'Grass_Wispy_Short', p.x + Math.cos(a) * p.rx * k, p.z + Math.sin(a) * p.rz * k, 1.2 + rr() * 0.9, 0, true); }
      for (let s = 0; s < per; s += 5.5) { const a = s / per * Math.PI * 2 + rr() * 0.3, k = 1.2 + rr() * 0.45; put(bi.trees[Math.floor(rr() * 4)], p.x + Math.cos(a) * p.rx * k, p.z + Math.sin(a) * p.rz * k, 1.5 + rr() * 0.9, 0, true); }
      for (let n = 0; n < 6; n++) { const a = rr() * Math.PI * 2, k = 1.15 + rr() * 0.3; put(pickOf(L.rocks), p.x + Math.cos(a) * p.rx * k, p.z + Math.sin(a) * p.rz * k, 0.8 + rr() * 1.4, 0, true); }
    }
    // 6. snow drifts round the board (Frozen Peak; deep snow has its own drifts in the sheet)
    if (bi.snow && !bi.deepSnow) {
      const dr = new THREE.InstancedMesh(driftGeo, driftMat, 120); let n = 0;
      for (let k = 0; k < 600 && n < 120; k++) {
        const x = (rr() * 2 - 1) * (hw + 45), z = -hd - 60 + rr() * (BD + 95), d = outside(x, z);
        if (d < 0.6 || d > 40 || rr() > 1.2 - d / 40) continue;
        if (cab && Math.hypot(x - cab.x, z - cab.z) < cab.r - 2) continue;
        const w = 2 + rr() * 4.5;
        dr.setMatrixAt(n++, tmpM.compose(tmpP.set(x, -0.1, z), tmpQ.setFromAxisAngle(upY, rr() * 6.3), tmpS.set(w * 1.4, 0.35 + rr() * 0.6, w * (0.35 + rr() * 0.35))));
      }
      dr.count = n; dr.instanceMatrix.needsUpdate = true; driftMat.color.set(bi.drift || '#B4C1CA'); dr.computeBoundingSphere(); dr.raycast = () => {}; dr.receiveShadow = true; dr.name = 'drifts';
      scene.add(dr); meshes.push(dr);
    }    // 7. the deep snow itself: a big rolling sheet over the land, whiter on the crests and bluer in the hollows
    if (bi.deepSnow) {
      const g = new THREE.PlaneGeometry(BW + 260, BD + 260, 150, 170).rotateX(-Math.PI / 2), pos = g.attributes.position, col = new Float32Array(pos.count * 3);
      const hi = new THREE.Color('#D8E1EE'), lo = new THREE.Color('#93A7C4'), c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), z = pos.getZ(k), h = groundH(x, z);
        pos.setY(k, outside(x, z) > 0 ? h : -0.2);
        c.copy(lo).lerp(hi, Math.min(1, 0.35 + h / (1.4 * bi.deepSnow))); col.set([c.r, c.g, c.b], k * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
      const sheet = new THREE.Mesh(g, snowGroundMat); sheet.position.y = -0.03; sheet.receiveShadow = true; sheet.raycast = () => {}; sheet.name = 'deep snow';
      snowGroundMat.color.setRGB(...bi.tint);
      scene.add(sheet); meshes.push(sheet);
    }

    // far trees and bushes: impostors
    shadeU.uHalf.value.set(hw, hd); shadeU.uShade.value.set(...(bi.shade || [0, 1, 2])); veil.visible = !!bi.shade;
    shadeU.uNight.value.set(...(bi.night || [0, 0, 0, 0])); shadeU.uDeep.value.set(...(bi.deep || [0, 1, 2])); shadeU.uWarm.value.set(cab ? cab.x : 0, cab ? cab.z : 0, cab ? cab.r * 1.5 : 0);
    snowU.value = bi.snow || 0; showFall(bi.fall || (bi.snow ? 'snow' : null)); showCabin(cab);
    bake([...new Set([...placed.keys()].filter((k) => k.endsWith('~')).map((k) => k.slice(0, -1)).filter(impostorable))].sort());
    const far = [];
    for (const [k, list] of [...placed]) {
      const name = k.replace('~', '');
      if (!k.endsWith('~') || !impIndex || !impIndex[name]) continue;
      const fl = bi.farLight || 1;
      for (const [x, y, z, ang, s, col, sy] of list) far.push([name, x, y, z, s, col.map((c) => c * fl), ang < Math.PI ? 1 : -1, sy]);
      placed.delete(k);
    }
    impostors(far);
    // the rest: one mesh per model part, holding every placement of that model
    for (const [k, list] of placed) {
      const md = lib[k.replace('~', '')], tall = md.h > 3 && !k.endsWith('~');
      for (const part of md.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        list.forEach(([x, y, z, ang, s, col, sy], i) => {
          tmpP.set(x, y, z); tmpQ.setFromAxisAngle(upY, ang); tmpS.set(s, s * (0.95 + (ang % 1) * 0.15) * sy, s);
          im.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
          im.setColorAt(i, tmpC.setRGB(col[0], col[1], col[2]));
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = castShadows && tall; im.receiveShadow = false;
        im.computeBoundingSphere(); im.raycast = () => {}; // scenery never takes a touch
        im.name = k; scene.add(im); meshes.push(im);
      }
    }
  }
  function shadows(on) { if (on !== castShadows) { castShadows = on; key = ''; } }
  function dispose() { clear(); scene.remove(flakes, cabin, cabinLight, veil); veil.geometry.dispose(); veilMat.dispose(); snowGroundMat.dispose(); cabin.userData.dispose(); cabinLight.dispose(); flakeGeo.dispose(); flakeMat.dispose(); driftGeo.dispose(); driftMat.dispose(); pondGeo.dispose(); for (const m of pondMats) m.dispose(); if (atlas) atlas.dispose(); if (impMat) { impMat.dispose(); impGeo.dispose(); blobMat.map.dispose(); blobMat.dispose(); blobGeo.dispose(); } for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); } if (lib) for (const md of Object.values(lib)) for (const p of md.parts) p.geo.dispose(); }
  return { _lib: () => lib, _meshes: () => meshes, update, biome, shadows, dispose, ready, tick, snowing: () => flakes.visible, count: () => meshes.reduce((s, m) => s + m.count, 0) };
};

// The painted floors and the looks live in src/floors.js (loaded with the main page, before this file)
Scenery3D.FLOORS = Floors.FLOORS;
Scenery3D.LOOKS = Floors.LOOKS;
Scenery3D.MAP_LOOK = Game.MAP_LOOK; // each map's own look (in game.js, so the page's music can follow it without the 3D code)
Scenery3D.lookOf = Floors.lookOf;
Scenery3D.floor = Floors.floor;

