'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {report}=require('./search-phase-profile-report');
function summarize(verified,timed,baseline,previousTiming){
  assert.equal(verified.productionTreeSha256,baseline.productionTreeSha256);
  assert.equal(verified.records.length,baseline.records.length);
  for(let i=0;i<verified.records.length;i++)for(const key of
    ['id','seat','frame','mode','used','completedDepth','selected','outcome','rows','restoreFailures'])
    assert.deepEqual(verified.records[i][key],baseline.records[i][key],`VERIFY_DRIFT:${i}:${key}`);
  const after=report(timed,baseline),before=report(previousTiming,baseline),groups={};
  for(const mode of Object.keys(after.groups)){
    const totals={};const records=verified.records.filter(r=>r.mode===mode);
    for(const r of records)for(const key of ['exactHits','exactMisses','latticeHits','latticeMisses','builds','nodes','terrainInvalidations','verifiedQueries'])
      totals[key]=(totals[key]||0)+r.latticeCache[key];
    const a=before.groups[mode],b=after.groups[mode];
    groups[mode]={...totals,cacheCoveredFraction:(totals.exactHits+totals.latticeHits)/totals.verifiedQueries,
      beforeInstrumentedMs:a.elapsedMs,afterInstrumentedMs:b.elapsedMs,exploratoryTimeRatio:b.elapsedMs/a.elapsedMs};
  }
  return {semanticDrift:0,groups,extraBytesPerController:Math.max(...verified.records.map(r=>r.latticeCache.extraBytes)),
    limitations:['18 selected roots, not whole-game qualification','single instrumented batch, not warm five-batch P95',
      'initial timing run overlapped end of oracle run; do not claim production speedup','production unchanged; hash collision proof not established']};
}
if(require.main===module)console.log(JSON.stringify(summarize(...process.argv.slice(2).map(p=>JSON.parse(fs.readFileSync(p)))),null,2));
module.exports={summarize};
