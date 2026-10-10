'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {sampleRoots,prepareLayered}=require('./native-complete-layer-poc');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {AuditedLatticeHazard}=require('./audited-lattice-cache');
const {predictNextLayer}=require('./layer-admission-shadow');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function snapshot(object){return Object.entries(object).filter(([,v])=>ArrayBuffer.isView(v)||typeof v==='number'||typeof v==='boolean')
 .map(([key,value])=>({key,reference:value,value:ArrayBuffer.isView(value)?value.slice():value}));}
function restore(object,values){for(const item of values){if(ArrayBuffer.isView(item.value)){
 object[item.key]=item.reference;item.reference.set(item.value);}else object[item.key]=item.value;}}
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];}
function fingerprint(search,result){return JSON.stringify({result,
 arrays:['rootScore','rootNominalScore','rootCellScore','rootNominalCellScore','rootDomainMask','rootEnemyDomainMask','rowExactBlockMask'].map(k=>Array.from(search[k])),
 counters:['nodes','currentDepth','lastBudgetLeafCount','lastFastIncompleteCount','lastHardIncompleteCount','lastDepthLeafCount','lastTopLeafCount'].map(k=>search[k])});}
function benchmarkRoot(search,engine,count,eligibility,prepare,depthCalibration=false,onlineAdmission=false){
 search.bindIsolatedHard(engine.adapter.bundle);
 const state=engine.adapter.state,kernel=search.diagnosticKernel,hard=search.diagnosticHard;
 const originalHazard=search.diagnosticHazard,originalHardHazard=hard.hazard;
 const objects=[search,kernel,hard,search.leafEvaluator,search.pathUtility,state],saved=objects.map(snapshot);
 const stateArrays=state.arrays.map(a=>a.slice()),mark=state.deltaUsed*1024+state.eventUsed;
 const hazards=[onlineAdmission?new AuditedLatticeHazard(state,4):new HazardKernel(state,{reverseViabilityCacheEntries:16,hazardSignatureCache:true}),new AuditedLatticeHazard(state,4)];
 const hazardSaved=hazards.map(snapshot),records=[];
 const thinComparison=process.argv.includes('--thin-comparison');
 const thin=thinComparison?new ThinLayerExecutor(search,kernel,state):null;
 const admission=(previous,last,remaining)=>predictNextLayer(previous,last,remaining).admit;
 const reset=mode=>{state.undoTo(mark);for(let i=0;i<objects.length;i++)restore(objects[i],saved[i]);
   restore(hazards[mode],hazardSaved[mode]);search.diagnosticHazard=hazards[mode];hard.hazard=hazards[mode];};
 try{
  const modes=depthCalibration?[1]:[0,1];
  for(const protocol of onlineAdmission?['COMPLETE_LAYER_3']:depthCalibration?['CURRENT','DEPTH_1','DEPTH_2','DEPTH_3']:['CURRENT','COMPLETE_LAYER_3']){
   let expected;
   const one=mode=>{
    reset(mode);const start=performance.now();
    const cap=protocol==='CURRENT'?0:Number(protocol.slice(-1));
    let raw=thin&&mode===1?thin.run(engine,count,eligibility,prepare,4096,cap,admission):
     protocol==='CURRENT'?prepare.call(search,engine,count,eligibility):prepareLayered(search,engine,count,eligibility,prepare,4096,cap,
      onlineAdmission&&(mode===1||thinComparison)?admission:null);
    const ms=performance.now()-start;
    if(thin&&mode===1)raw=raw.diagnostic();
    const result=protocol==='CURRENT'?raw:{used:raw.used,completedDepth:raw.completedDepth,
      attempts:raw.attempts.map(a=>({depth:a.depth,work:a.work,status:a.status,evidence:a.evidence}))};
    const signature=fingerprint(search,onlineAdmission?{completedDepth:raw.completedDepth}:result);
    if(expected===undefined)expected=signature;else assert.equal(signature,expected,'CACHE_SEARCH_SEMANTIC_DRIFT');
    for(let i=0;i<stateArrays.length;i++)assert.deepEqual(state.arrays[i],stateArrays[i],'ROOT_RESTORE');
    assert.equal(state.hashLo,saved.at(-1).find(v=>v.key==='hashLo').value);
    assert.equal(state.hashHi,saved.at(-1).find(v=>v.key==='hashHi').value);
    const h=hazards[mode];return {ms,requestedCap:cap,completedDepth:cap?raw.completedDepth:null,
      used:cap?raw.used:null,attempts:cap?raw.attempts.map(a=>({depth:a.depth,work:a.work,status:a.status})):null,
      exactHits:h.reverseCacheHitCount,latticeHits:h.reverseLatticeHitCount,
      builds:h.reverseUncachedBuildCount+h.reverseLatticeBuildCount,
      buildNodes:h.reverseUncachedBuildNodeCount+h.reverseLatticeBuildNodeCount};
   };
   for(let warm=0;warm<3;warm++)for(const mode of modes)one(mode);
   const batches=[];
   for(let batch=0;batch<5;batch++){
    const samples=[[],[]];
    for(let repeat=0;repeat<3;repeat++)for(const mode of (batch+repeat)%2?[...modes].reverse():modes)samples[mode].push(one(mode));
    batches.push({batch,off:samples[0],on:samples[1]});
   }
   records.push({protocol,batches,semanticDrift:0,extraBytes:hazards[1].stats().extraBytes});
  }
 }finally{
   state.undoTo(mark);for(let i=0;i<objects.length;i++)restore(objects[i],saved[i]);
   search.diagnosticHazard=originalHazard;hard.hazard=originalHardHazard;
 }
 return records;
}
function summarize(records){const output={};for(const protocol of [...new Set(records.flatMap(r=>r.measurements.map(m=>m.protocol)))]){
 const roots=records.flatMap(r=>r.measurements).filter(r=>r.protocol===protocol),out={};
 for(const mode of ['off','on']){
  const samples=roots.flatMap(r=>r.batches.flatMap(b=>b[mode]));
  out[mode]={samples:samples.length,totalMs:samples.reduce((s,r)=>s+r.ms,0),p50Ms:percentile(samples.map(r=>r.ms),.5),p95Ms:percentile(samples.map(r=>r.ms),.95),
   buildNodes:samples.reduce((s,r)=>s+r.buildNodes,0),batches:Array.from({length:5},(_,b)=>{
    const list=roots.flatMap(r=>r.batches[b][mode]);return {totalMs:list.reduce((s,r)=>s+r.ms,0),p95Ms:percentile(list.map(r=>r.ms),.95)};})};
 }
 out.totalRatio=out.on.totalMs/out.off.totalMs;out.p95Ratio=out.on.p95Ms/out.off.p95Ms;output[protocol]=out;
}return output;}
function summarizeDepth(records){
 const output={};
 for(const protocol of ['CURRENT','DEPTH_1','DEPTH_2','DEPTH_3']){
  const roots=records.flatMap(r=>r.measurements).filter(m=>m.protocol===protocol);
  const samples=roots.flatMap(m=>m.batches.flatMap(b=>b.on)),counts={};
  let wasted=0,work=0;
  for(const m of roots){const r=m.batches[0].on[0],last=r.attempts?.at(-1);
   const status=protocol==='CURRENT'?'APPROXIMATE':r.completedDepth===r.requestedCap?'COMPLETED':
     last?.status==='COMPLETED'?'SCHEDULE_CAPPED':last?.status||'NO_LAYER';
   counts[status]=(counts[status]||0)+1;work+=r.used||0;
   wasted+=(r.attempts||[]).filter(a=>a.status!=='COMPLETED').reduce((s,a)=>s+a.work,0);
  }
  const completed=samples.filter(s=>s.requestedCap&&s.completedDepth===s.requestedCap);
  const timing=list=>list.length?{samples:list.length,p50Ms:percentile(list.map(s=>s.ms),.5),p95Ms:percentile(list.map(s=>s.ms),.95),totalMs:list.reduce((s,r)=>s+r.ms,0)}:null;
  output[protocol]={roots:roots.length,counts,allAttempts:timing(samples),completedRequestedCap:timing(completed),
    workPerCohort:protocol==='CURRENT'?null:work,discardedWorkPerCohort:protocol==='CURRENT'?null:wasted,
    batches:Array.from({length:5},(_,i)=>timing(roots.flatMap(r=>r.batches[i].on)))};
 }
 return output;
}
async function run(root,output,baselinePath='artifacts/native-causal-audit/bp300-terrain-identity.json',depthCalibration=false,onlineAdmission=false){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const baseline=JSON.parse(fs.readFileSync(path.resolve(root,baselinePath)));
 const tree=productionTreeSha256(root);assert.equal(tree,baseline.productionTreeSha256);
 const origin=JSON.parse(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp280-root-oracle36.json')));
 const matches=zlib.gunzipSync(fs.readFileSync(path.join(origin.input.directory,'matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const validation=onlineAdmission?JSON.parse(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp305-independent-admission/manifest.json'))):null;
 if(validation){assert.equal(validation.productionTreeSha256,tree);
  const crypto=require('node:crypto');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'layer-admission-shadow.js'))).digest('hex'),validation.predictorHash);}
 const targets=validation?validation.targets.map(t=>({matchUrlId:t.id,candidateSeat:t.seat,root:{frame:t.frame}})):sampleRoots(matches,6),scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare,records=[];
 try{for(const target of targets){let measurements;
  proto.prepare=function(engine,count,eligibility){
   if(engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]===target.root.frame&&!measurements)
    measurements=benchmarkRoot(this,engine,count,eligibility,prepare,depthCalibration,onlineAdmission);
   return prepare.call(this,engine,count,eligibility);
  };
  const match=await play(module,scenarios.find(s=>s.matchUrlId===target.matchUrlId),target.candidateSeat,false);
  const source=matches.find(m=>m.matchUrlId===target.matchUrlId&&m.candidateSeat===target.candidateSeat);
  assert.ok(measurements,'ROOT_NOT_REACHED');
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,source[side].compactActionStream,'ACTION_STREAM_DRIFT');
  assert.equal(match.analysisOutcome,source.analysisOutcome);
  records.push({id:target.matchUrlId,seat:target.candidateSeat,frame:target.root.frame,measurements});
  console.error(`[lattice-benchmark] ${records.length}/${targets.length}`);
 }}finally{proto.prepare=prepare;}
 assert.equal(productionTreeSha256(root),tree);
 const result={productionTreeSha256:tree,baselineEvidence:baselinePath,node:process.version,warmupsPerModePerRoot:3,batches:5,repeatsPerBatch:3,
  scope:'search.prepare at 18 real roots; complete-layer mode includes diagnostic scheduler overhead, not whole controller or platform runtime',
  reset:'identical search/leaf/path/state inputs; cold root-local hazard caches; reset and oracle comparisons outside timer',
  depthCalibration,onlineAdmission,thinComparison:process.argv.includes('--thin-comparison'),
  modeMeaning:process.argv.includes('--thin-comparison')?'off=rich diagnostic executor; on=thin executor; BOTH use admission and lattice':onlineAdmission?'off=admission disabled; on=admission enabled; BOTH use production lattice cache':'off/on=lattice cache',
  semanticDrift:0,actionStreamDrift:0,extraBytes:onlineAdmission?0:records[0].measurements[0].extraBytes,
  summary:depthCalibration?summarizeDepth(records):summarize(records),records};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2],process.argv[3],process.argv.includes('--depth-calibration'),process.argv.includes('--online-admission')).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={snapshot,restore,percentile,summarize,summarizeDepth,benchmarkRoot};
