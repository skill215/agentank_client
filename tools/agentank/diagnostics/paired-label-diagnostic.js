'use strict';
const assert=require('node:assert/strict');
const D=require('./semantic-performance-design');
const {physicalHash}=require('./transition-ranking-diagnostic');
const {SCALAR:S,ARRAY:A}=require('../../../engine-v2/src/state/fast-state');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
function seedFor(caseId,index){return parseInt(D.hash(`BP411_LABEL_VALIDATION:${caseId}:${index}`).slice(0,8),16);}
function signP(deltas, direction=1){
 const signs=deltas.filter(x=>x!==0).map(x=>Math.sign(x)*direction),n=signs.length,k=signs.filter(x=>x>0).length;
 if(!n)return 1;
 let term=2**(-n),p=0;
 for(let i=0;i<=n;i++){if(i>=k)p+=term;term*= (n-i)/(i+1);}
 return Math.min(1,p);
}
function assess(deltas, direction=1){
 assert.equal(deltas.length,32);
 const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
 const effect=mean(deltas),halves=[mean(deltas.slice(0,16)),mean(deltas.slice(16))],p=signP(deltas,direction);
 return {effect,halves,p,discordant:deltas.filter(x=>x!==0).length,positive:deltas.filter(x=>x>0).length,negative:deltas.filter(x=>x<0).length,ties:deltas.filter(x=>x===0).length,stableDirection:effect*direction>=.10&&p<=.0125&&halves.every(x=>x*direction>0)};
}
async function runJob(job,{root,readFrozen}){
 const cohort=JSON.parse(readFrozen(job.cohortFile)),dataset=JSON.parse(readFrozen(job.datasetFile));
 const item=cohort.find(x=>x.case===job.case),frozen=dataset.cases.find(x=>x.case===job.case);
 const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 assert.equal(arena.productionTreeSha256(root),job.productionTree);
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const enemy=V3DiagnosticBot.prototype.decide;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const event=await require('./strategic-event-simulator').load(root);assert.deepEqual(event.identity,job.simulatorIdentity);
 const frozenAction=frozen.root.rows.find(r=>r.action===job.action&&r.hardAllowed&&r.finalAllowed);assert.ok(frozenAction);
 let forced=0,observedHash=null,simulator,firstStep;
 const decide=Bot.prototype.decide;
 Bot.prototype.decide=function(context){
  if(!this.bp411){this.bp411=true;const e=this.engine,emit=e.emit.bind(e);
   e.emit=(me,action)=>{
    if(e.adapter.state.arrays[A.SCALAR][S.FRAME]!==frozen.root.frame)return emit(me,action);
    assert.equal(action,frozen.root.selectedAction,'PRE_FORCE_SELECTION_DRIFT');
    observedHash=physicalHash(e.adapter.state);assert.equal(observedHash,frozen.root.state.physicalSha256,'ROOT_STATE_DRIFT');
    const row=Array.from(e.ourActions).slice(0,e.ourCount).findIndex((a,i)=>a===job.action&&e.ourArguments[i]===frozenAction.argument&&e.hardStatus[i]===0&&e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,i,e.ourCount));
    assert.ok(row>=0,'FORCE_NOT_ALLOWED');e.lastSelectedRow=row;e.basePolicy.intent.commitSelection(job.action);forced++;
    return emit(me,job.action);
   };
  }
  return decide.call(this,context);
 };
 const module=event.wrap({eventFrom:frozen.root.frame,eventSeed:job.eventSeed},sim=>{
  simulator=sim;const step=sim.step.bind(sim);
  sim.step=(actions,decisions)=>{
   if(sim.frame!==frozen.root.frame)return step(actions,decisions);
   const before=sim.experimentEvents.length,result=step(actions,decisions);
   firstStep={actions,events:result,random:sim.experimentEvents.slice(before)};return result;
  };
 });
 const row=await arena.play(module,item.scene,item.seat,false);
 assert.equal(forced,1);assert.ok(firstStep);assert.ok(prefixMatches(item.reference,row,frozen.root.frame,job.action),'PREFIX_DRIFT');
 const signature=D.hash(D.signature(row));
 if(job.calibration){const old=JSON.parse(readFrozen(job.calibrationFile)).find(x=>x.case===job.case&&x.action===job.action);assert.ok(old);assert.equal(signature,old.signature,'OLD_SEED_REPLAY_DRIFT');}
 const healthy=[row.candidate,row.control].every(x=>!x.errorCount&&!x.timeoutCount)&&!row.candidateEngine.rootRestoreFailures&&!row.candidateEngine.hotAllocations;
 assert.ok(healthy,'EXECUTION_HEALTH');assert.equal(arena.productionTreeSha256(root),job.productionTree);
 return {games:1,integrityPassed:true,safetyPassed:true,case:job.case,action:job.action,index:job.index,eventSeed:job.eventSeed,calibration:Boolean(job.calibration),rootFrame:frozen.root.frame,rootHash:observedHash,forced,signature,score:row.analysisOutcome==='V2_WIN'?1:row.analysisOutcome==='DRAW'?.5:0,death:Number(row.counts.crashes[item.seat]>0),opponentFirstAction:Buffer.from(row.control.compactActionStream,'base64')[frozen.root.frame],firstStep,randomEvents:simulator.experimentEvents,row,scope:'One-action intervention with production continuation. Historical conditional label validation; execution health is not tactical safety.'};
}
module.exports={seedFor,signP,assess,runJob};
