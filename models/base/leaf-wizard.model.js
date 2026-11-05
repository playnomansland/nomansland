// Model Forge · Base model · Leaf Wizard · "Leaf Wizard"
// From the Forge model "Leaf wizard2", Gen 12·B “Leaf Cape”. Saved 2026-11-05.
// Not built into the game. To use it, paste the entry below into BUILD in src/models3d.js (see models/README.md).

    // Leaf wizard2 (Lea): made in Model Forge, Gen 12·B “Leaf Cape”
    // own colours: #4FA85A
    'wizard:leaf': () => [
      P(box(0.65, 0.8, 0.5), 'tint', [0, 1.3, 0]), // torso
      ...[-1, 1].map(sd => P(cyl(0.2, 0.17, 0.95, 8), 'tint', [sd * 0.2, 0.47, 0])), // legs (pair)
      P(ball(0.3), SKIN, [0, 1.98, -0.02]), // head
      P(new THREE.SphereGeometry(0.32, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), WOOD, [0, 2.02, 0.04]), // hair
      P(cyl(0.42, 0.5, 0.25, 8), 'team', [0, 1.75, 0]), // scarf
      P(box(0.8, 0.16, 0.55), 'team', [0, 0.95, 0], [0, 0, 0.25]), // sash
      P(new THREE.OctahedronGeometry(0.85, 0), HEAL, [0, 1.4, 0.6], [0.5, 0, 0], [1, 0.4, 0.6]), // back leaf
      ...[-1, 1].map(sd => P(box(0.22, 0.5, 0.22), 'tint', [sd * 0.516, 1.444, -0.02], [0, sd * 0, sd * 0.9])), // upper arm (pair)
      ...[-1, 1].map(sd => P(box(0.2, 0.2, 0.5), 'tint', [sd * 0.72, 1.36, -0.29], [0.3, sd * 0, sd * 0])), // forearm (pair)
      P(cyl(0.05, 0.05, 2.2), WOOD, [0.72, 1.2, -0.5]), // staff
      P(new THREE.OctahedronGeometry(0.3, 0), HEAL, [0.72, 2.4, -0.5], [0, 0, 0], [1, 1.5, 0.5]), // staff leaf
      P(box(0.16, 0.14, 0.16), 'team', [0.72, 1.65, -0.5]), // staff wrap
      P(new THREE.OctahedronGeometry(0.25, 0), HEAL, [0, 2.3, -0.16], [0.6, 0, 0], [0.7, 1.4, 0.4]), // crown leaf front
      ...[-1, 1].map(sd => P(new THREE.OctahedronGeometry(0.25, 0), '#4FA85A', [sd * 0.22, 2.25, 0], [0, sd * 0, sd * -0.7], [0.7, 1.4, 0.4])), // crown leaf side (pair)
    ],

/* FORGE_SPEC
{"type":"base","unit":"Leaf Wizard","name":"Leaf Wizard","key":"wizard:leaf","forge":{"model":"Leaf wizard2","variant":"Gen 12·B “Leaf Cape”","project":"04shoty2vo","node":"funpctfl2i"},"saved":"2026-11-05","parts":[{"c":"tint","d":[0.65,0.8,0.5],"n":"torso","p":[0,1.3,0],"s":"box"},{"c":"tint","d":[0.2,0.17,0.95,8],"m":true,"n":"legs","on":"torso","p":[0.2,0.47,0],"s":"cyl"},{"c":"SKIN","d":[0.3],"n":"head","on":"torso","p":[0,1.98,-0.02],"s":"ball"},{"c":"WOOD","d":[0.32],"n":"hair","on":"head","p":[0,2.02,0.04],"s":"dome"},{"c":"team","d":[0.42,0.5,0.25,8],"n":"scarf","on":"torso","p":[0,1.75,0],"s":"cyl"},{"c":"team","d":[0.8,0.16,0.55],"n":"sash","on":"torso","p":[0,0.95,0],"r":[0,0,0.25],"s":"box"},{"c":"HEAL","d":[0.85],"k":[1,0.4,0.6],"n":"back leaf","on":"torso","p":[0,1.4,0.6],"r":[0.5,0,0],"s":"octa"},{"c":"tint","d":[0.22,0.5,0.22],"m":true,"n":"upper arm","on":"torso","p":[0.516,1.444,-0.02],"r":[0,0,0.9],"s":"box"},{"c":"tint","d":[0.2,0.2,0.5],"m":true,"n":"forearm","on":"upper arm","p":[0.72,1.36,-0.29],"r":[0.3,0,0],"s":"box"},{"c":"WOOD","d":[0.05,0.05,2.2,6],"n":"staff","on":"forearm","p":[0.72,1.2,-0.5],"s":"cyl"},{"c":"HEAL","d":[0.3],"k":[1,1.5,0.5],"n":"staff leaf","on":"staff","p":[0.72,2.4,-0.5],"s":"octa"},{"c":"team","d":[0.16,0.14,0.16],"n":"staff wrap","on":"staff","p":[0.72,1.65,-0.5],"s":"box"},{"c":"HEAL","d":[0.25],"k":[0.7,1.4,0.4],"n":"crown leaf front","on":"hair","p":[0,2.3,-0.16],"r":[0.6,0,0],"s":"octa"},{"c":"#4FA85A","d":[0.25],"k":[0.7,1.4,0.4],"m":true,"n":"crown leaf side","on":"hair","p":[0.22,2.25,0],"r":[0,0,-0.7],"s":"octa"}]}
*/
