'use strict';
const assert=require('node:assert/strict');
const {propose}=require('./escape-progress-candidate');
const {physicalHash}=require('./transition-ranking-diagnostic');
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const D=require('./semantic-performance-design');
async function runJob(job,{root,readFrozen}){
 const arena=require('./native-base-policy-standalone-arena');assert.equal(arena.productionTreeSha256(root),job.productionTree);
 const scene=JSON.parse(readFrozen(job.scenesFile)).find(x=>x.id===job.sceneId);assert.ok(scene);
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');const enemy=V3DiagnosticBot.prototype.decide;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const Bot=arena.NativeBasePolicyDiagnosticBot,decide=Bot.prototype.decide,decisions=[];let frames=0;
 Bot.prototype.decide=function(c){frames++;if(!this.freshInstalled){this.freshInstalled=true;const e=this.engine,select=e.strategicArbiter.selectEscape.bind(e.strategicArbiter);
  e.strategicArbiter.selectEscape=(controller,mask,envelope)=>{const incumbent=select(controller,mask,envelope),before=physicalHash(e.adapter.state),p=propose(e,controller,incumbent,mask,envelope);assert.equal(physicalHash(e.adapter.state),before);
   if(p.row!==incumbent){assert.equal(e.hardStatus[p.row],0);assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,p.row,e.ourCount));}
   decisions.push({frame:e.adapter.state.arrays[A.SCALAR][S.FRAME],incumbent,originalAction:e.ourActions[incumbent]??null,proposedAction:e.ourActions[p.row]??null,applied:job.enabled&&p.row!==incumbent,...p});return job.enabled?p.row:incumbent;
  };}return decide.call(this,c);
 };
 const event=await require('./strategic-event-simulator').load(root);assert.deepEqual(event.identity,job.simulatorIdentity);let sim,replay;
 const wrapped=event.wrap({seed:job.eventSeed,eventFrom:0,eventSeed:job.eventSeed},s=>sim=s),Base=wrapped.AgenTankSimulator;
 const module={...wrapped,AgenTankSimulator:class extends Base{constructor(options){super({...options,star:scene.star,starProvider:undefined});}run(...args){replay=super.run(...args);return replay;}}};
 const row=await arena.play(module,scene,job.seat,false);
 assert.ok([row.candidate,row.control].every(x=>!x.errorCount&&!x.timeoutCount),'BOT_HEALTH');assert.equal(row.candidateEngine.rootRestoreFailures,0);assert.equal(row.candidateEngine.hotAllocations,0);assert.equal(arena.productionTreeSha256(root),job.productionTree);
 assert.ok(replay?.replayData?.replay?.records?.length,'REPLAY_MISSING');
 return {games:1,integrityPassed:true,safetyPassed:true,sceneId:scene.id,mapHash:scene.mapHash,seat:job.seat,enabled:job.enabled,eventSeed:job.eventSeed,signature:D.hash(D.signature(row)),score:row.analysisOutcome==='V2_WIN'?1:row.analysisOutcome==='DRAW'?.5:0,death:Number(row.counts.crashes[job.seat]>0),frames,decisions,changes:decisions.filter(x=>x.applied).length,opportunities:decisions.filter(x=>x.row!==x.incumbent).length,row,replay,randomEvents:sim.experimentEvents,scope:'New local generated-map games, natural star RNG, no forced actions. Frozen candidate vs same opponent and event seed. Simulator is not platform truth.'};
}
module.exports={runJob};
