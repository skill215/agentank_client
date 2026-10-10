'use strict';
// Exactly one native/VM replay; no hidden warmups, retries or child processes.
const assert=require('node:assert/strict');
async function runJob(job,{root,readFrozen}){
 const arena=require('./native-base-policy-standalone-arena'),D=require('./semantic-performance-design');
 assert.equal(arena.productionTreeSha256(root),job.productionTree,'PRODUCTION_DRIFT');
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const enemy=V3DiagnosticBot.prototype.decide;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const scenes=JSON.parse(readFrozen(job.scenariosFile));
 const scenario=scenes.find(s=>s.matchUrlId===job.scenarioId);assert.ok(scenario,'SCENARIO_NOT_FOUND');
 assert.ok(job.seat===0||job.seat===1,'SEAT');
 const code=job.codeFile?readFrozen(job.codeFile).toString():null;
 const event=await require('./strategic-event-simulator').load(root);
 assert.ok(job.simulatorIdentity,'SIMULATOR_IDENTITY_REQUIRED');
 assert.deepEqual(event.identity,job.simulatorIdentity,'SIMULATOR_DRIFT');
 const row=await arena.play(event.wrap(job.rng||{},()=>{}),scenario,job.seat,false,code);
 const signature=D.hash(D.signature(row));
 const healthy=[row.candidate,row.control].every(s=>s.errorCount===0&&s.timeoutCount===0);
 const equivalent=!job.expectedSignature||signature===job.expectedSignature;
 return {games:1,safetyPassed:healthy,integrityPassed:equivalent&&arena.productionTreeSha256(root)===job.productionTree,
  safetyScope:'Execution health only; not a proof of tactical safety or population death-rate non-inferiority.',
  metrics:{score:row.analysisOutcome==='V2_WIN'?1:row.analysisOutcome==='DRAW'?.5:0,decisionMicros:row.candidate.totalRuntimeMicros},signature,row};
}
module.exports={runJob};
