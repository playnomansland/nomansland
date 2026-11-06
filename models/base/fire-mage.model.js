// Model Forge · Base model · Fire Mage · "Fire Mage"
// From the Forge model "Fire mage2", Gen 8·A “Classic Ember”. Saved 2026-11-05.
// Not built into the game. To use it, paste the entry below into BUILD in src/models3d.js (see models/README.md).

    // Fire mage2 (Fire Mage): made in Model Forge, Gen 8·A “Classic Ember”
    // own colours: #4a2418, #2a120a, #7a2020
    'wizard:fire': () => [
      P(box(0.6, 0.9, 0.4), DARK, [0, 0.45, 0]), // legs
      P(cone(0.85, 1.2, 8), 'tint', [0, 0.95, 0]), // robe
      P(box(0.62, 0.7, 0.42), 'tint', [0, 1.65, 0]), // torso
      P(cyl(0.36, 0.4, 0.2, 8), 'team', [0, 1.32, 0]), // waist band
      P(ball(0.3), SKIN, [0, 2.2, -0.02]), // head
      P(new THREE.SphereGeometry(0.34, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#4a2418', [0, 2.26, 0.04]), // hair cap
      P(box(0.5, 1.6, 0.2), '#4a2418', [0, 1.55, 0.3]), // long hair
      ...[-1, 1].map(sd => P(cyl(0.1, 0.1, 0.9), SKIN, [sd * 0.45, 1.85, -0.45], [1.2, sd * 0, sd * 0.2])), // arm (pair)
      ...[-1, 1].map(sd => P(cone(0.34, 0.8), FIRE, [sd * 0.5, 2, -0.85])), // flame (pair)
      P(box(0.4, 0.06, 0.1), '#4a2418', [0, 2.3, -0.3]), // brow
      ...[-1, 1].map(sd => P(new THREE.OctahedronGeometry(0.06, 0), GLOW, [sd * 0.12, 2.22, -0.29], [0, sd * 0, sd * 0], [1.6, 0.8, 0.6])), // eye (pair)
      ...[-1, 1].map(sd => P(box(0.2, 0.06, 0.08), '#2a120a', [sd * 0.12, 2.3, -0.31], [0, sd * 0, sd * 0.45])), // angry brow (pair)
      P(box(0.16, 0.04, 0.06), '#7a2020', [0, 2.08, -0.29]), // scowl
      P(cyl(0.3, 0.38, 0.12, 8), 'team', [0, 1.98, 0]), // team collar
      ...[-1, 1].map(sd => P(new THREE.OctahedronGeometry(0.14, 0), EMBER, [sd * 0.5, 2.05, -0.85], [0, sd * 0, sd * 0], [1, 1.4, 1])), // flame core (pair)
    ],

/* FORGE_SPEC
{"type":"base","unit":"Fire Mage","name":"Fire Mage","key":"wizard:fire","forge":{"model":"Fire mage2","variant":"Gen 8·A “Classic Ember”","project":"eoiov2zp9u","node":"ic7xjsh4tm"},"saved":"2026-11-05","parts":[{"c":"DARK","d":[0.6,0.9,0.4],"n":"legs","p":[0,0.45,0],"s":"box"},{"c":"tint","d":[0.85,1.2,8],"n":"robe","on":"legs","p":[0,0.95,0],"s":"cone"},{"c":"tint","d":[0.62,0.7,0.42],"n":"torso","on":"robe","p":[0,1.65,0],"s":"box"},{"c":"team","d":[0.36,0.4,0.2,8],"n":"waist band","on":"torso","p":[0,1.32,0],"s":"cyl"},{"c":"SKIN","d":[0.3],"n":"head","on":"torso","p":[0,2.2,-0.02],"s":"ball"},{"c":"#4a2418","d":[0.34],"n":"hair cap","on":"head","p":[0,2.26,0.04],"s":"dome"},{"c":"#4a2418","d":[0.5,1.6,0.2],"n":"long hair","on":"head","p":[0,1.55,0.3],"s":"box"},{"c":"SKIN","d":[0.1,0.1,0.9,6],"m":true,"n":"arm","on":"torso","p":[0.45,1.85,-0.45],"r":[1.2,0,0.2],"s":"cyl"},{"c":"FIRE","d":[0.34,0.8,6],"m":true,"n":"flame","on":"arm","p":[0.5,2,-0.85],"s":"cone"},{"c":"#4a2418","d":[0.4,0.06,0.1],"n":"brow","on":"head","p":[0,2.3,-0.3],"s":"box"},{"c":"GLOW","d":[0.06],"k":[1.6,0.8,0.6],"m":true,"n":"eye","on":"head","p":[0.12,2.22,-0.29],"s":"octa"},{"c":"#2a120a","d":[0.2,0.06,0.08],"m":true,"n":"angry brow","on":"head","p":[0.12,2.3,-0.31],"r":[0,0,0.45],"s":"box"},{"c":"#7a2020","d":[0.16,0.04,0.06],"n":"scowl","on":"head","p":[0,2.08,-0.29],"s":"box"},{"c":"team","d":[0.3,0.38,0.12,8],"n":"team collar","on":"torso","p":[0,1.98,0],"s":"cyl"},{"c":"EMBER","d":[0.14],"k":[1,1.4,1],"m":true,"n":"flame core","on":"flame","p":[0.5,2.05,-0.85],"s":"octa"}]}
*/
