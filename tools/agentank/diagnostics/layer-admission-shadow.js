'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
// A point estimate, NOT an upper bound or a safety certificate. No outcome input.
function predictNextLayer(previousWork,lastWork,remaining){
 for(const n of [previousWork,lastWork,remaining])if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_WORK');
 if(previousWork===0)return {admit:true,estimate:null,reason:'NO_GROWTH_HISTORY'};
 if(lastWork>Math.floor(Math.sqrt(Number.MAX_SAFE_INTEGER)))throw Error('WORK_OVERFLOW');
 const estimate=Math.ceil(lastWork*lastWork/previousWork);
 return {admit:estimate<=remaining,estimate,reason:estimate<=remaining?'ESTIMATED_FIT':'ESTIMATED_OVER_BUDGET'};
}
function auditRecord(record,limit=4096){
 const measurement=record.measurements.find(m=>m.protocol==='DEPTH_3');
 if(!measurement)throw Error('MISSING_DEPTH3');
 const sample=measurement.batches[0].on[0],attempts=sample.attempts;
 if(!attempts||attempts.reduce((s,a)=>s+a.work,0)!==sample.used)throw Error('WORK_RECONCILIATION');
 let used=0,completed=0,previous=0,last=0,denied=null;const decisions=[];
 for(let index=0;index<attempts.length;index++){
  const observed=attempts[index];
  // Only past completed work is passed to prediction. Labels used below are scoring only.
  const prediction=predictNextLayer(previous,last,Math.max(0,limit-used));
  decisions.push({depth:observed.depth,previousWork:previous,lastWork:last,remaining:limit-used,...prediction});
  if(!prediction.admit){denied={depth:observed.depth,observedStatus:observed.status,
    avoidedWork:attempts.slice(index).reduce((s,a)=>s+a.work,0)};break;}
  used+=observed.work;
  if(observed.status==='COMPLETED'){completed=observed.depth;previous=last;last=observed.work;}
  else break;
 }
 const originalWasted=attempts.filter(a=>a.status!=='COMPLETED').reduce((s,a)=>s+a.work,0);
 const keptWasted=denied?0:originalWasted;
 return {id:record.id,seat:record.seat,frame:record.frame,baselineDepth:sample.completedDepth,
   retainedDepth:completed,baselineWork:sample.used,retainedWork:used,originalWasted,keptWasted,
   lastObservedStatus:attempts.at(-1)?.status||null,denied,decisions};
}
function summarize(records){
 const sum=k=>records.reduce((s,r)=>s+r[k],0);
 return {roots:records.length,baselineWork:sum('baselineWork'),retainedWork:sum('retainedWork'),
  avoidedWork:sum('baselineWork')-sum('retainedWork'),baselineWasted:sum('originalWasted'),remainingWasted:sum('keptWasted'),
  deniedBudgetInterrupted:records.filter(r=>r.denied?.observedStatus==='BUDGET_INTERRUPTED').length,
  deniedSupportIncomplete:records.filter(r=>r.denied?.observedStatus==='INCOMPLETE_SUPPORT').length,
  falselyDeniedCompleted:records.filter(r=>r.denied?.observedStatus==='COMPLETED').length,
  lostCompletedDepth:records.filter(r=>r.retainedDepth<r.baselineDepth).length,
  admittedBudgetInterrupted:records.filter(r=>!r.denied&&r.lastObservedStatus==='BUDGET_INTERRUPTED').length};
}
function run(input,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const bytes=fs.readFileSync(input),source=JSON.parse(bytes);
 const records=source.records.map(r=>auditRecord(r));
 const result={source:input,inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
  productionTreeSha256:source.productionTreeSha256,rule:'ceil(lastCompletedWork^2 / previousCompletedWork) <= remainingApplyBudget',
  budget:4096,thresholdSweep:false,shadowOnly:true,summary:summarize(records),records,
  limitations:['Known 18-root development sample; not independent validation',
   'Point estimate can under/overestimate; no safe upper-bound claim',
   'Counterfactual saved apply work only; no wall-time or win-rate claim',
   'Only complete finite-depth layers retained; not terminal Proof',
   'No prediction at depth2 without two completed layers; no rule-support inference']};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary,null,2));
}
if(require.main===module)run(process.argv[2],process.argv[3]);
module.exports={predictNextLayer,auditRecord,summarize};
