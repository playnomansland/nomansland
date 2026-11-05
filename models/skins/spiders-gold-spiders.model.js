// Model Forge · Skin · Spiders · "Gold spiders"
// From the Forge model "Gold spiders", Gen 8·A “Scaled to 1.21 m”. Saved 2026-11-05.
// Not built into the game. To use it, paste the entry below into BUILD in src/models3d.js (see models/README.md).

    // Gold spiders (Spiders): made in Model Forge, Gen 8·A “Scaled to 1.21 m”
    // own colours: none (game palette only)
    'spiders:gold-spiders': () => [
      P(ball(0.472), 'tint', [0, 0.498, 0.183], [0, 0, 0], [1, 0.95, 1.15]), // abdomen
      P(new THREE.OctahedronGeometry(0.314, 0), 'team', [0, 0.865, 0.183], [0, 0, 0], [0.9, 1.1, 1.7]), // gem
      P(ball(0.288), GOLD, [0, 0.446, -0.262]), // thorax
      P(ball(0.21), GOLD, [0, 0.393, -0.498]), // head
      ...[-1, 1].map(sd => P(cone(0.073, 0.288, 5), BONE, [sd * 0.089, 0.236, -0.681], [3.78, sd * 0, sd * 0])), // fang (pair)
      ...[-1, 1].map(sd => P(box(0.472, 0.105, 0.105), GOLD, [sd * 0.367, 0.576, -0.393], [0, sd * 0.7, sd * 0.4])), // thigh_front (pair)
      ...[-1, 1].map(sd => P(box(0.472, 0.105, 0.105), GOLD, [sd * 0.472, 0.576, -0.105], [0, sd * 0.25, sd * 0.4])), // thigh_mid_front (pair)
      ...[-1, 1].map(sd => P(box(0.472, 0.105, 0.105), GOLD, [sd * 0.472, 0.576, 0.314], [0, sd * -0.25, sd * 0.4])), // thigh_mid_back (pair)
      ...[-1, 1].map(sd => P(box(0.419, 0.105, 0.105), GOLD, [sd * 0.367, 0.576, 0.55], [0, sd * -0.7, sd * 0.4])), // thigh_back (pair)
      ...[-1, 1].map(sd => P(box(0.105, 0.682, 0.105), GOLD, [sd * 0.629, 0.341, -0.524], [0, sd * 0, sd * 0.2])), // shin_front (pair)
      ...[-1, 1].map(sd => P(box(0.105, 0.682, 0.105), GOLD, [sd * 0.707, 0.341, -0.131], [0, sd * 0, sd * 0.2])), // shin_mid_front (pair)
      ...[-1, 1].map(sd => P(box(0.105, 0.682, 0.105), GOLD, [sd * 0.707, 0.341, 0.341], [0, sd * 0, sd * 0.2])), // shin_mid_back (pair)
      ...[-1, 1].map(sd => P(box(0.105, 0.682, 0.105), GOLD, [sd * 0.629, 0.341, 0.629], [0, sd * 0, sd * 0.2])), // shin_back (pair)
    ],

/* FORGE_SPEC
{"type":"skin","unit":"Spiders","name":"Gold spiders","key":"spiders:gold-spiders","forge":{"model":"Gold spiders","variant":"Gen 8·A “Scaled to 1.21 m”","project":"y337buavla","node":"sjs4268ajh"},"saved":"2026-11-05","parts":[{"n":"abdomen","s":"ball","d":[0.472],"c":"tint","p":[0,0.498,0.183],"k":[1,0.95,1.15]},{"n":"gem","s":"octa","d":[0.314],"c":"team","p":[0,0.865,0.183],"k":[0.9,1.1,1.7],"on":"abdomen"},{"n":"thorax","s":"ball","d":[0.288],"c":"GOLD","p":[0,0.446,-0.262],"on":"abdomen"},{"n":"head","s":"ball","d":[0.21],"c":"GOLD","p":[0,0.393,-0.498],"on":"thorax"},{"n":"fang","s":"cone","d":[0.073,0.288,5],"c":"BONE","p":[0.089,0.236,-0.681],"r":[3.78,0,0],"m":true,"on":"head"},{"n":"thigh_front","s":"box","d":[0.472,0.105,0.105],"c":"GOLD","p":[0.367,0.576,-0.393],"r":[0,0.7,0.4],"m":true,"on":"thorax"},{"n":"thigh_mid_front","s":"box","d":[0.472,0.105,0.105],"c":"GOLD","p":[0.472,0.576,-0.105],"r":[0,0.25,0.4],"m":true,"on":"abdomen"},{"n":"thigh_mid_back","s":"box","d":[0.472,0.105,0.105],"c":"GOLD","p":[0.472,0.576,0.314],"r":[0,-0.25,0.4],"m":true,"on":"abdomen"},{"n":"thigh_back","s":"box","d":[0.419,0.105,0.105],"c":"GOLD","p":[0.367,0.576,0.55],"r":[0,-0.7,0.4],"m":true,"on":"abdomen"},{"n":"shin_front","s":"box","d":[0.105,0.682,0.105],"c":"GOLD","p":[0.629,0.341,-0.524],"r":[0,0,0.2],"m":true,"on":"thigh_front"},{"n":"shin_mid_front","s":"box","d":[0.105,0.682,0.105],"c":"GOLD","p":[0.707,0.341,-0.131],"r":[0,0,0.2],"m":true,"on":"thigh_mid_front"},{"n":"shin_mid_back","s":"box","d":[0.105,0.682,0.105],"c":"GOLD","p":[0.707,0.341,0.341],"r":[0,0,0.2],"m":true,"on":"thigh_mid_back"},{"n":"shin_back","s":"box","d":[0.105,0.682,0.105],"c":"GOLD","p":[0.629,0.341,0.629],"r":[0,0,0.2],"m":true,"on":"thigh_back"}]}
*/
