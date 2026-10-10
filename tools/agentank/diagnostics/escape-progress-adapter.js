'use strict';
const assert=require('node:assert/strict');
const base=require('./paired-label-diagnostic');
const {propose}=require('./escape-progress-candidate');
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {physicalHash,simView}=require('./transition-ranking-diagnostic');
async function runJob(job,context){
 const {NativeBasePolicyDiagnosticBot:Bot}=require('./native-base-policy-standalone-arena');
 const decide=Bot.prototype.decide,decisions=[],trace=[];let evaluations=0;
 Bot.prototype.decide=function(c){
  if(!this.escapeProgressInstalled){this.escapeProgressInstalled=true;const e=this.engine,select=e.strategicArbiter.selectEscape.bind(e.strategicArbiter);
   e.strategicArbiter.selectEscape=(controller,mask,envelope)=>{
    const incumbent=select(controller,mask,envelope),frame=e.adapter.state.arrays[A.SCALAR][S.FRAME];
    if(frame<job.enableFrom)return incumbent;
    const before=physicalHash(e.adapter.state),result=propose(e,controller,incumbent,mask,envelope);evaluations++;
    assert.equal(physicalHash(e.adapter.state),before,'CANDIDATE_MUTATED_STATE');
    if(result.row!==incumbent){assert.equal(e.hardStatus[result.row],0);assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,result.row,e.ourCount));}
    decisions.push({frame,incumbent,action:e.ourActions[incumbent]??null,proposedAction:e.ourActions[result.row]??null,applied:job.enabled&&result.row!==incumbent,...result});
    return job.enabled?result.row:incumbent;
   };
  }return decide.call(this,c);
 };
 const events=require('./strategic-event-simulator'),load=events.load;
 events.load=async root=>{const event=await load(root),wrap=event.wrap;event.wrap=(rng,observe)=>wrap(rng,sim=>{observe(sim);const step=sim.step.bind(sim);sim.step=(actions,ds)=>{const frame=sim.frame,result=step(actions,ds);if(frame>=job.enableFrom&&frame<=job.endFrame)trace.push({frame,after:simView(sim,0,frame+1),events:result,result:sim.result});return result;};});return event;};
 const result=await base.runJob(job,context);
 const previous=JSON.parse(context.readFrozen(job.previousFile));
 if(!job.enabled)assert.equal(result.signature,previous.signature,'CONTROL_REPLAY_DRIFT');
 const first=decisions.find(x=>x.frame===job.enableFrom);assert.ok(first,'HANDOFF_MISSING');
 assert.equal(first.action,2,'HANDOFF_BASELINE_DRIFT');
 const last=trace.at(-1);assert.ok(last&&(last.frame===job.endFrame||last.result),'EVENT_WINDOW');
 return {...result,decisions,evaluations,eventSurvived:!last.after.tanks[0].crashed,eventReached:last.frame===job.endFrame,trace,changes:decisions.filter(x=>x.applied).length,nonGameWork:{extraSimulatedSteps:0,staticSearchesUpperBound:evaluations*3},scope:'Implemented diagnostic tie-break integrated before normal selector commit. Same reused case and seeds; not independent qualification or production runtime benchmark.'};
}
module.exports={runJob};
