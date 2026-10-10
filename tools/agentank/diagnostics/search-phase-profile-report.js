'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
function report(profile,baseline){
  assert.equal(profile.baselineProductionTreeSha256||profile.productionTreeSha256,baseline.productionTreeSha256);
  assert.equal(profile.records.length,baseline.records.length);
  const groups={};
  for(let i=0;i<profile.records.length;i++){
    const record=profile.records[i],before=baseline.records[i];
    for(const key of ['id','seat','frame','mode','used','completedDepth','selected','outcome','rows','restoreFailures'])
      assert.deepEqual(record[key],before[key],`DRIFT:${i}:${key}`);
    if(!record.profile)continue;
    const group=groups[record.mode]??={roots:0,elapsedMs:0,phases:{}};
    group.roots++;group.elapsedMs+=record.profile.elapsedMs;
    for(const [key,row] of Object.entries(record.profile.phases)){
      const total=group.phases[key]??={calls:0,inclusiveMs:0,selfMs:0};
      for(const field of Object.keys(total))total[field]+=row[field];
    }
  }
  for(const group of Object.values(groups)){
    const selfTotal=Object.values(group.phases).reduce((s,r)=>s+r.selfMs,0);
    group.instrumentedSelfMs=selfTotal;
    group.ranking=Object.entries(group.phases).map(([phase,r])=>({phase,...r,
      shareOfInstrumentedSelf:r.selfMs/selfTotal})).sort((a,b)=>b.selfMs-a.selfMs);
    delete group.phases;
  }
  return {semanticDrift:0,groups,caveat:'Instrumented local timing; wrapper overhead included. Percentages partition measured phases, not total production runtime. Layered elapsed includes diagnostic bookkeeping.'};
}
if(require.main===module)console.log(JSON.stringify(report(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3]))),null,2));
module.exports={report};
