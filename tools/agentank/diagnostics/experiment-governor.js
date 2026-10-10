'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
// Pure project-level decisions. A scheduler must consume this decision before
// dispatching another batch; an empty candidate list never becomes filler work.
function govern(s){
 assert.ok(['quality','performance'].includes(s.track),'TRACK_REQUIRED');
 assert.ok(['DIAGNOSIS','REGRESSION','SCREENING','CONFIRMATION','ACCEPTANCE'].includes(s.phase),'PHASE_REQUIRED');
 assert.ok(s.budget&&s.used,'BUDGET_REQUIRED');
 for(const key of ['rounds','games','seconds']){assert.ok(Number.isFinite(s.budget[key])&&s.budget[key]>0);assert.ok(Number.isFinite(s.used[key])&&s.used[key]>=0);}
 const decision=(action,reason,extra={})=>({action,reason,dispatchOptimizationBatch:false,productionAdoption:false,...extra});
 if(s.integrityFailure||s.safetyFailure)return decision('STOP_INVALID_OR_UNSAFE','Freeze evidence and investigate the failure; do not continue selection.');
 if(s.phase==='CONFIRMATION'&&s.confirmationComplete){
  assert.ok(s.frozenCandidates&&JSON.stringify(s.active||[])===JSON.stringify(s.frozenCandidates),'CONFIRMATION_SHORTLIST_DRIFT');
  return decision('EVALUATE_FROZEN_CONFIRMATION','Completed evidence must still be evaluated when the execution budget has been spent.');
 }
 if(['rounds','games','seconds'].some(k=>s.used[k]>=s.budget[k]))return decision('STOP_BUDGET','A project-level hard budget is exhausted.');
 if(s.phase==='DIAGNOSIS')return s.mechanismEvidence?decision('DESIGN_SCREENING','Define a falsifiable candidate and an adequate sample plan.'):decision('DIAGNOSE_ONLY','No candidate admission until a measured bottleneck or reproducible loss mechanism exists.');
 const validCost=cost=>cost&&['rounds','games','seconds'].every(k=>Number.isFinite(cost[k])&&cost[k]>0);
 const batchGuard=()=>{
  const cost=s.nextBatchCost;
  if(!validCost(cost)||cost.rounds>10)return decision('STOP_COST_PLAN_REQUIRED','Bound the next batch in rounds, games and wall time before dispatch.');
  if(['rounds','games','seconds'].some(k=>s.used[k]+cost[k]>s.budget[k]))return decision('STOP_NEXT_BATCH_EXCEEDS_BUDGET','The next batch does not fit the remaining project budget.');
  return null;
 };
 const dispatch=(action,reason)=>batchGuard()||decision(action,reason,{dispatchOptimizationBatch:true,maximumRounds:s.nextBatchCost.rounds});
 const active=s.active||[];
 if(!active.length){
  if(s.pendingMeasurement&&!(s.measurementBatchesUsed>=1))return batchGuard()||decision('BOUNDED_MEASUREMENT_ONLY','One explicitly scoped measurement block is allowed; no optimization round credit.',{maximumMeasurementBatches:1});
  return decision(s.pendingMeasurement?'STOP_MEASUREMENT_UNRESOLVED':'STOP_NO_CANDIDATES','No active hypothesis remains. Do not fill the remaining round budget with baseline games.');
 }
 assert.equal(new Set(active).size,active.length,'DUPLICATE_CANDIDATE');
 assert.ok(!active.some(x=>(s.retired||[]).includes(x)),'RETIRED_CANDIDATE_REINTRODUCED');
 if(s.phase==='ACCEPTANCE')return s.localQualified&&s.targetRuntimeQualified?decision('READY_FOR_RELEASE_REVIEW','Validation package is complete; this governor never publishes or changes production.'):decision('TARGET_RUNTIME_ACCEPTANCE_REQUIRED','Separate local sandbox compatibility from real target-runtime certification.');
 if(!s.mechanismEvidence)return decision('STOP_MISSING_MECHANISM','No diagnostic evidence supports this candidate family.');
 // OPT-P-002: explicitly bounded historical screening, never quality confirmation.
 if(s.phase==='REGRESSION'){
  assert.ok(s.track==='quality'&&s.localOnly===true&&s.processId==='OPT-P-002','LOCAL_REGRESSION_SCOPE');
  assert.ok(active.length===1&&s.budget.rounds===1&&s.budget.games<=8,'LOCAL_REGRESSION_CAP');
  return dispatch('RUN_LOCAL_REGRESSION','One local historical candidate screen; no independent quality or acceptance credit.');
 }
 if(s.track==='quality'&&!s.independentDataReady)return decision('STOP_DATA_LIMIT','Repeated historical/synthetic regression is not new independent quality evidence.');
 const plan=s.samplePlan;
 if(!plan||!plan.frozen||!plan.precisionAssessed||!Number.isFinite(plan.requiredIndependentUnits)||!(plan.requiredIndependentUnits>0)||!Number.isFinite(plan.availableIndependentUnits)||plan.availableIndependentUnits<plan.requiredIndependentUnits)return decision('STOP_PRECISION_LIMIT','The target effect and available independent units do not support the proposed experiment.');
 if(s.phase==='CONFIRMATION'){
  assert.ok(s.frozenCandidates&&JSON.stringify(active)===JSON.stringify(s.frozenCandidates),'CONFIRMATION_SHORTLIST_DRIFT');
  if(s.confirmationComplete)return decision('EVALUATE_FROZEN_CONFIRMATION','Evaluate every preregistered case with unchanged thresholds; no extra seeds to chase significance.');
  return dispatch('CONTINUE_FROZEN_CONFIRMATION','Keep the fixed shortlist and inputs, including unfavorable blocks.');
 }
 if(s.readyForConfirmation){
  if(!validCost(s.confirmationCost))return decision('STOP_COST_PLAN_REQUIRED','A finite positive cost is required for the whole confirmation.');
  if(['rounds','games','seconds'].some(k=>s.used[k]+s.confirmationCost[k]>s.budget[k]))return decision('STOP_INSUFFICIENT_CONFIRMATION_BUDGET','Reserve the whole fixed confirmation before admitting a finalist.');
  return decision('FREEZE_CONFIRMATION','Freeze candidates, data, costs and final analysis before running confirmation.');
 }
 return dispatch('RUN_SCREENING_BATCH','Run only admitted active hypotheses; reassess within ten rounds.');
}
if(require.main===module)process.stdout.write(JSON.stringify(govern(JSON.parse(fs.readFileSync(process.argv[2]))),null,2)+'\n');
module.exports={govern};
