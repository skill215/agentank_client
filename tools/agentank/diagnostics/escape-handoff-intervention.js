'use strict';
const assert=require('node:assert/strict');
const base=require('./paired-label-diagnostic');
const D=require('./semantic-performance-design');
const {fastView,simView,physicalHash}=require('./transition-ranking-diagnostic');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {actionCode}=require('./bomb-event-diagnostic');
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
function snapshot(object,limit){
 return Object.fromEntries(Object.entries(object).flatMap(([k,v])=>ArrayBuffer.isView(v)?[[k,Array.from(v).slice(0,limit)]]:v===null||['number','string','boolean'].includes(typeof v)?[[k,v]]:[]));
}
function eventSurvival(trace,endFrame,seat){
 assert.ok(trace.length);const last=trace.at(-1);
 assert.ok(last.frame===endFrame||last.result,'EVENT_WINDOW_INCOMPLETE');
 return !last.after.tanks[0].crashed;
}
async function runJob(job,context){
 const previous=JSON.parse(context.readFrozen(job.previousFile));
 assert.equal(previous.action,4);assert.equal(previous.eventSeed,job.eventSeed);
 const target=previous.eventTrace.find(t=>t.frame===job.interventionFrame);assert.ok(target);
 const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 const original=Bot.prototype.decide;let intervention=null,simulator,trace=[],knownBomb;
 Bot.prototype.decide=function(c){
  if(!this.bp413){this.bp413=true;const e=this.engine,emit=e.emit.bind(e);
   e.emit=(me,action)=>{
    const frame=e.adapter.state.arrays[A.SCALAR][S.FRAME];
    if(frame!==job.interventionFrame)return emit(me,action);
    assert.equal(intervention,null,'REPEATED_INTERVENTION');assert.equal(action,2,'BASELINE_ACTION_DRIFT');assert.equal(e.lastControlMode,1,'HANDOFF_MODE_DRIFT');
    const view=fastView(e.adapter.state);assert.deepEqual(view,target.view,'INTERVENTION_STATE_DRIFT');
    const count=e.ourCount,rows=Array.from(e.ourActions).slice(0,count).map((a,i)=>({row:i,action:a,argument:e.ourArguments[i],hard:e.hardStatus[i],finalAllowed:Boolean(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,i,count))}));
    const selected=rows.find(r=>r.action===job.interventionAction);assert.ok(selected&&selected.hard===0&&selected.finalAllowed,'INTERVENTION_NOT_ALLOWED');
    intervention={frame,originalAction:action,action:job.interventionAction,row:selected.row,physicalHash:physicalHash(e.adapter.state),view,rows,state:{width:e.adapter.state.width,height:e.adapter.state.height,arrays:e.adapter.state.arrays.map(a=>Array.from(a))},controlMode:e.lastControlMode,incumbent:e.lastIncumbentRow,proposal:e.lastProposalRow,escape:snapshot(e.escapeObligation,count),risk:snapshot(e.riskController.outcome,count),bands:snapshot(e.strategyBands,count),arbiter:snapshot(e.strategicArbiter,count),selector:snapshot(e.strategySelector,count),tacticalValue:Array.from(e.tacticalValue).slice(0,count)};
    e.lastSelectedRow=selected.row;
    // Emission-only intervention: retain the already completed selector update.
    // Do not introduce an extra intent commit in COMMITTED_ESCAPE mode.
    return emit(me,job.interventionAction);
   };
  }
  return original.call(this,c);
 };
 const eventModule=require('./strategic-event-simulator'),load=eventModule.load;
 eventModule.load=async root=>{
  const event=await load(root),wrap=event.wrap;
  event.wrap=(rng,observe)=>wrap(rng,sim=>{
   observe(sim);simulator=sim;const step=sim.step.bind(sim);
   sim.step=(actions,decisions)=>{
    const frame=sim.frame;if(frame<job.interventionFrame||frame>job.endFrame)return step(actions,decisions);
    if(frame===job.interventionFrame){knownBomb=sim.bombs.find(b=>b.ownerIndex===0&&!b.exploded&&b.explodesAt===job.endFrame);assert.ok(knownBomb);knownBomb={...knownBomb,position:knownBomb.position.slice()};}
    const commanded=JSON.parse(JSON.stringify(actions)),before=simView(sim,0),events=step(actions,decisions);
    trace.push({frame,commanded,actionCodes:commanded.map(actionCode),before,after:simView(sim,0,frame+1),events,result:sim.result,knownBombExploded:events.some(e=>e.type==='bomb'&&e.action==='exploded'&&e.objectId===knownBomb.objectId)});
    assert.ok(trace.length<=job.endFrame-job.interventionFrame+1,'TRACE_CAP');return events;
   };
  });return event;
 };
 assert.equal(job.case,3,'ONLY_FROZEN_CASE_3_SUPPORTED');
 const result=await base.runJob(job,context);
 assert.ok(intervention);assert.ok(prefixMatches(previous.row,result.row,job.interventionFrame,job.interventionAction),'PREFIX_104_DRIFT');
 if(job.interventionAction===2)assert.equal(result.signature,previous.signature,'CONTROL_REPLAY_DRIFT');
 const survived=eventSurvival(trace,job.endFrame,0);
 return {...result,intervention,knownBomb,eventTrace:trace,eventSurvived:survived,eventReached:trace.at(-1).frame===job.endFrame,eventEndedEarly:trace.at(-1).frame<job.endFrame,eventBombExploded:trace.some(t=>t.knownBombExploded),nonGameWork:{extraSimulatedSteps:0,traceFrames:trace.length},scope:'One emission-only allowed action at frame 104; root FIRE and seed held fixed. Later production selector and intent behavior unmodified. Reused historical state, not a deployable candidate.'};
}
module.exports={snapshot,eventSurvival,runJob};
