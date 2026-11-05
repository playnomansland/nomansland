// Model Forge · Skin · Spiders · "Gold"
// From the Forge model "Gold spiders", Gen 7·B “Wide Splayed Stance”. Saved 2026-11-05.
// Not built into the game. To use it, paste the entry below into BUILD in src/models3d.js (see models/README.md).

    // Gold spiders (Spiders): made in Model Forge, Gen 7·B “Wide Splayed Stance”
    // own colours: none (game palette only)
    'spider:gold': () => [
      P(ball(0.9), 'tint', [0, 0.95, 0.35], [0, 0, 0], [1, 0.95, 1.15]), // abdomen
      P(new THREE.OctahedronGeometry(0.6, 0), 'team', [0, 1.65, 0.35], [0, 0, 0], [0.9, 1.1, 1.7]), // gem
      P(ball(0.55), GOLD, [0, 0.85, -0.5]), // thorax
      P(ball(0.4), GOLD, [0, 0.75, -0.95]), // head
      ...[-1, 1].map(sd => P(cone(0.14, 0.55, 5), BONE, [sd * 0.17, 0.45, -1.3], [3.78, sd * 0, sd * 0])), // fang (pair)
      ...[-1, 1].map(sd => P(box(0.9, 0.2, 0.2), GOLD, [sd * 0.7, 1.1, -0.75], [0, sd * 0.7, sd * 0.4])), // thigh_front (pair)
      ...[-1, 1].map(sd => P(box(0.9, 0.2, 0.2), GOLD, [sd * 0.9, 1.1, -0.2], [0, sd * 0.25, sd * 0.4])), // thigh_mid_front (pair)
      ...[-1, 1].map(sd => P(box(0.9, 0.2, 0.2), GOLD, [sd * 0.9, 1.1, 0.6], [0, sd * -0.25, sd * 0.4])), // thigh_mid_back (pair)
      ...[-1, 1].map(sd => P(box(0.8, 0.2, 0.2), GOLD, [sd * 0.7, 1.1, 1.05], [0, sd * -0.7, sd * 0.4])), // thigh_back (pair)
      ...[-1, 1].map(sd => P(box(0.2, 1.3, 0.2), GOLD, [sd * 1.2, 0.65, -1], [0, sd * 0, sd * 0.2])), // shin_front (pair)
      ...[-1, 1].map(sd => P(box(0.2, 1.3, 0.2), GOLD, [sd * 1.35, 0.65, -0.25], [0, sd * 0, sd * 0.2])), // shin_mid_front (pair)
      ...[-1, 1].map(sd => P(box(0.2, 1.3, 0.2), GOLD, [sd * 1.35, 0.65, 0.65], [0, sd * 0, sd * 0.2])), // shin_mid_back (pair)
      ...[-1, 1].map(sd => P(box(0.2, 1.3, 0.2), GOLD, [sd * 1.2, 0.65, 1.2], [0, sd * 0, sd * 0.2])), // shin_back (pair)
    ],

/* FORGE_SPEC
{"type":"skin","unit":"Spiders","name":"Gold","key":"spider:gold","forge":{"model":"Gold spiders","variant":"Gen 7·B “Wide Splayed Stance”","project":"y337buavla","node":"g29r4jlg06"},"saved":"2026-11-05","parts":[{"c":"tint","d":[0.9],"k":[1,0.95,1.15],"n":"abdomen","p":[0,0.95,0.35],"s":"ball"},{"c":"team","d":[0.6],"k":[0.9,1.1,1.7],"n":"gem","on":"abdomen","p":[0,1.65,0.35],"s":"octa"},{"c":"GOLD","d":[0.55],"n":"thorax","on":"abdomen","p":[0,0.85,-0.5],"s":"ball"},{"c":"GOLD","d":[0.4],"n":"head","on":"thorax","p":[0,0.75,-0.95],"s":"ball"},{"c":"BONE","d":[0.14,0.55,5],"m":true,"n":"fang","on":"head","p":[0.17,0.45,-1.3],"r":[3.78,0,0],"s":"cone"},{"c":"GOLD","d":[0.9,0.2,0.2],"m":true,"n":"thigh_front","on":"thorax","p":[0.7,1.1,-0.75],"r":[0,0.7,0.4],"s":"box"},{"c":"GOLD","d":[0.9,0.2,0.2],"m":true,"n":"thigh_mid_front","on":"abdomen","p":[0.9,1.1,-0.2],"r":[0,0.25,0.4],"s":"box"},{"c":"GOLD","d":[0.9,0.2,0.2],"m":true,"n":"thigh_mid_back","on":"abdomen","p":[0.9,1.1,0.6],"r":[0,-0.25,0.4],"s":"box"},{"c":"GOLD","d":[0.8,0.2,0.2],"m":true,"n":"thigh_back","on":"abdomen","p":[0.7,1.1,1.05],"r":[0,-0.7,0.4],"s":"box"},{"c":"GOLD","d":[0.2,1.3,0.2],"m":true,"n":"shin_front","on":"thigh_front","p":[1.2,0.65,-1],"r":[0,0,0.2],"s":"box"},{"c":"GOLD","d":[0.2,1.3,0.2],"m":true,"n":"shin_mid_front","on":"thigh_mid_front","p":[1.35,0.65,-0.25],"r":[0,0,0.2],"s":"box"},{"c":"GOLD","d":[0.2,1.3,0.2],"m":true,"n":"shin_mid_back","on":"thigh_mid_back","p":[1.35,0.65,0.65],"r":[0,0,0.2],"s":"box"},{"c":"GOLD","d":[0.2,1.3,0.2],"m":true,"n":"shin_back","on":"thigh_back","p":[1.2,0.65,1.2],"r":[0,0,0.2],"s":"box"}]}
*/
