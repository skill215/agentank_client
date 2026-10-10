'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {loadSimulator}=require('./paired-arena');
const VERSION='PLATFORM_CALIBRATED_BOMB_AFTER_PROJECTILES_V1';
const SOURCE_SHA='c1f9cde0b8124eae47ff1dce4bb1c4b63ea5b18b11713f3400b598f2173df2c7';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function replaceOnce(s,from,to){assert.equal(s.split(from).length,2,'ADAPTER_PATCH_POINT_DRIFT');return s.replace(from,to);}
async function loadBombPhaseAdapter(root){const {module:original,directory}=await loadSimulator(root),source=fs.readFileSync(path.join(directory,'src/engine.js'),'utf8');assert.equal(hash(source),SOURCE_SHA,'VENDOR_SOURCE_DRIFT');
 let patched=replaceOnce(source,'    this.expireEffects(frameEvents);\n    this.explodeDueBombs(frameEvents);','    this.expireEffects(frameEvents);');
 patched=replaceOnce(patched,'      this.moveBullets(frameEvents);\n      if (!this.result) {','      this.moveBullets(frameEvents);\n      this.explodeDueBombs(frameEvents);\n      if (!this.result) {');
 for(const name of ['constants.js','map.js'])patched=replaceOnce(patched,'from "./'+name+'"','from '+JSON.stringify(pathToFileURL(path.join(directory,'src',name)).href));
 const loaded=await import('data:text/javascript;base64,'+Buffer.from(patched).toString('base64'));
 return {module:{...original,AgenTankSimulator:loaded.AgenTankSimulator},identity:{version:VERSION,vendorSha256:SOURCE_SHA,adaptedSha256:hash(patched),adapterSha256:hash(fs.readFileSync(__filename)),authority:'DD4 rule-calibration-report §2.4 and platform raw frame evidence',scope:'BOMB_PHASE_ONLY',remainingDeviations:['same-frame early collision terminal','poison cadence/cooldown','stun probability','teleport probability/reveal boundary','callback queue details','runtime model']}};}
module.exports={loadBombPhaseAdapter,replaceOnce,VERSION};
