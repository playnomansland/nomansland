#!/usr/bin/env node
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const Engine = require('../src/engine.js');
const Game = require('../src/game.js');
const roster = require('../src/default-roster.json');
function arg(name) { const i=process.argv.indexOf('--'+name); return i>=0?process.argv[i+1]:null; }
const nameA=arg('a'), nameB=arg('b');
if(!nameA||!nameB) throw new Error('Usage: node tools/forensic-profile.js --a "Unit A" --b "Unit B"');
const skill=id=>roster.skills.find(s=>s.id===id)||null;
const units=roster.units.map(u=>({...u,cost:u.cost/100,skillDefs:Engine.SLOTS.map(k=>(u.skills||[])[k]?skill(u.skills[k]):null)}));
const byName=new Map(units.map(u=>[u.name,u]));
const a=byName.get(nameA),b=byName.get(nameB);
if(!a||!b) throw new Error('Unknown matchup unit: '+(!a?nameA:nameB));
const settings={...Game.SETTINGS,...roster.settings,bounds:{x0:-36,x1:36,y0:-48,y1:48}};
let steps=0;
const profileCounters={validTargetsCalls:0,validTargetsBodiesScanned:0,validTargetsCandidates:0,byCaller:{}};
const started=performance.now();
// Same battle entry point used by Engine.matrix. Sparse progress callbacks avoid per-step profiler overhead.
const result=Engine.battle(a,b,settings,{progressEvery:100,profileCounters,onProgress:p=>{steps=p.steps;}});
const elapsedMs=performance.now()-started;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
process.stdout.write(JSON.stringify({
 matchup:nameA+' vs '+nameB,commit:process.env.GITHUB_SHA||null,
 runtime:{node:process.version,platform:process.platform,arch:process.arch},
 settings:{dt:settings.dt,timeCap:settings.timeCap,budget:settings.budget},
 fingerprints:{engine:hash('src/engine.js'),game:hash('src/game.js'),roster:hash('src/default-roster.json')},
 execution:{steps,simulationSeconds:result.time,elapsedMs:Number(elapsedMs.toFixed(3)),msPerStep:steps?Number((elapsedMs/steps).toFixed(3)):null,winner:result.winner,timeout:result.timeout,survivors:result.survivors,finalBodies:result.counts},
 targetingProfile:{...profileCounters,scansPerStep:steps?Number((profileCounters.validTargetsBodiesScanned/steps).toFixed(2)):null,candidatesPerCall:profileCounters.validTargetsCalls?Number((profileCounters.validTargetsCandidates/profileCounters.validTargetsCalls).toFixed(2)):null,byCaller:Object.fromEntries(Object.entries(profileCounters.byCaller).map(([caller,c])=>[caller,{...c,scansPerCall:c.calls?Number((c.bodiesScanned/c.calls).toFixed(2)):null,candidatesPerCall:c.calls?Number((c.candidates/c.calls).toFixed(2)):null}]))}
},null,2)+'\n');
