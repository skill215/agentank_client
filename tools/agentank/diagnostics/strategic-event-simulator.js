'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {loadSimulator}=require('../simulation/paired-arena');
const {replaceOnce,loadBombPhaseAdapter}=require('../simulation/bomb-phase-adapter');
const {hash}=require('./strategic-improvement-model');
function eventUniform(seed,frame,family,actor) {
  return parseInt(hash(`strategic-event-v1:${seed}:${frame}:${family}:${actor}`).slice(0,8),16)/4294967296;
}
async function load(root) {
  const original=await loadBombPhaseAdapter(root), {directory}=await loadSimulator(root);
  let s=fs.readFileSync(path.join(directory,'src/engine.js'),'utf8');
  assert.equal(hash(s),original.identity.vendorSha256);
  s=replaceOnce(s,'    this.expireEffects(frameEvents);\n    this.explodeDueBombs(frameEvents);','    this.expireEffects(frameEvents);');
  s=replaceOnce(s,'      this.moveBullets(frameEvents);\n      if (!this.result) {','      this.moveBullets(frameEvents);\n      this.explodeDueBombs(frameEvents);\n      if (!this.result) {');
  s=replaceOnce(s,'normalizedActionForPlayer(player, actions[index], this.frame, this.rng)',
    'normalizedActionForPlayer(player, actions[index], this.frame, () => this.experimentRandom("stun", index))');
  s=replaceOnce(s,'      return candidates[Math.floor(this.rng() * candidates.length)].slice();',
    '      return candidates[Math.floor(this.experimentRandom("teleport", actor.index) * candidates.length)].slice();');
  s=replaceOnce(s,'    return candidates[Math.floor(this.rng() * candidates.length)].slice();',
    '    return candidates[Math.floor(this.experimentRandom("star", -1) * candidates.length)].slice();');
  for(const name of ['constants.js','map.js'])s=replaceOnce(s,'from "./'+name+'"','from '+JSON.stringify(pathToFileURL(path.join(directory,'src',name)).href));
  s+='\nexport { normalizedActionForPlayer };\n';
  const imported=await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
  return {original:original.module,identity:{...original.identity,eventAdapterSha256:hash(s)},normalized:imported.normalizedActionForPlayer,
    wrap(job,observe) {
      const Base=imported.AgenTankSimulator;
      return {...original.module,AgenTankSimulator:class extends Base {
        constructor(options){super({...options,...(job.seed===undefined?{}:{seed:job.seed})});this.experimentEvents=[];observe(this);}
        experimentRandom(family,actor){
          if(job.eventFrom===undefined || this.frame<job.eventFrom)return this.rng();
          const value=eventUniform(job.eventSeed,this.frame,family,actor);
          this.experimentEvents.push({frame:this.frame,family,actor,value});return value;
        }
      }};
    }};
}
module.exports={eventUniform,load};
