// Renders a skin's menu picture (img/skins/<id>.png, 192x192, transparent) from its 3D model (src/models3d.js BUILD),
// with headless Chromium and vendor/three, lit like the 3D board. Shapes.SKINS pic points at the file.
// Run: node tools/skin-pic.js brute-omniper [out.png]   (any id from Shapes.SKINS; default out: img/skins/<id>.png)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const EXE = ['/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f => fs.existsSync(f));
const id = process.argv[2], out = process.argv[3] || path.join(ROOT, 'img/skins', id + '.png');
const shapes = fs.readFileSync(path.join(ROOT, 'src/shapes.js'), 'utf8');
const model = (shapes.match(new RegExp(`'${id}':\\s*\\{[^}]*model:\\s*'([^']+)'`)) || [])[1];
if (!model) { console.error('no skin with a model:', id); process.exit(1); }

const PAGE = `<!doctype html><html><body style="margin:0;background:transparent">
<script>${fs.readFileSync(path.join(ROOT, 'src/models3d.js'), 'utf8')}</script>
<script type="module">
import * as THREE from '/vendor/three.module.min.js';
const S = 192, r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
r.setSize(S, S); r.setClearColor(0, 0); r.outputColorSpace = THREE.SRGBColorSpace; document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#cfe3ff', '#20262a', 1.6));
const sun = new THREE.DirectionalLight('#fff3dc', 2.2); sun.position.set(-3, 6, -4); scene.add(sun);
const M = Models3D(THREE), p = M.parts(${JSON.stringify(model)});
const mats = { tint: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.75, metalness: 0.05, color: '#9AA8B8' }),
  team: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.6, metalness: 0.1, color: '#3B86D6' }),
  fixed: new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.1, vertexColors: true }) };
for (const k of ['tint', 'team', 'fixed']) if (p[k]) scene.add(new THREE.Mesh(p[k], mats[k]));
const h = M.height(${JSON.stringify(model)});
const cam = new THREE.PerspectiveCamera(29, 1, 0.1, 100);
cam.position.set(-2.4, h * 0.5 + 1.7, -6.6); cam.lookAt(0, h * 0.5, 0);
r.render(scene, cam);
window.done = r.domElement.toDataURL('image/png');
</script></body></html>`;

(async () => {
  const srv = http.createServer((q, s) => {
    if (q.url === '/') { s.setHeader('content-type', 'text/html'); return s.end(PAGE); }
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.statusCode = 404; return s.end(); }
    s.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); s.end(fs.readFileSync(f));
  }).listen(8764);
  const b = await chromium.launch({ executablePath: EXE, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const pg = await b.newPage();
    pg.on('pageerror', e => console.error('PAGE ERROR', e.message));
    await pg.goto('http://127.0.0.1:8764/');
    const url = await pg.waitForFunction(() => window.done, null, { timeout: 30000 }).then(h => h.jsonValue());
    fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', out);
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
