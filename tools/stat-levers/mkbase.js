// out/baseline.json: the baseline per opponent set = phase A's 3-body, 14 m shape at its neutral power
const fs = require('fs'), path = require('path');
const A = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/phaseA.json'), 'utf8'));
const out = {};
for (const set of ['all', 'early']) { const a = A[`${set}:b3:r14`]; if (a) out[set] = { ...a.unit }; }
fs.writeFileSync(path.join(__dirname, 'out/baseline.json'), JSON.stringify(out, null, 1)); console.log(out);
