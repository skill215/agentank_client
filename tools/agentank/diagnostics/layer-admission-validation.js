'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {prepareLayered}=require('./native-complete-layer-poc');
const {snapshot,restore}=require('./lattice-search-benchmark');
const {auditRecord,summarize}=require('./layer-admission-shadow');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function selectTargets(matches,excludedIds,count=16){
 const excludedFingerprints=new Set(matches.filter(m=>excludedIds.has(m.matchUrlId)).map(m=>m.scenarioFingerprint));
 const pool=matches.filter(m=>!excludedIds.has(m.matchUrlId)&&!excludedFingerprints.has(m.scenarioFingerprint))
  .flatMap(m=>(m.candidateEngine.rootFrames||[]).filter(r=>r.searchEvidenceCurrent).map(r=>({
   id:m.matchUrlId,scenarioFingerprint:m.scenarioFingerprint,seat:m.candidateSeat,frame:r.frame,
   rank:hash(`bp305-independent-layer-cost-v1:${m.scenarioFingerprint}:${m.candidateSeat}:${r.frame}`)})))
  .sort((a,b)=>a.rank.localeCompare(b.rank));
 const seen=new Set(),result=[];for(const row of pool){if(seen.has(row.scenarioFingerprint))continue;
  seen.add(row.scenarioFingerprint);result.push(row);if(result.length===count)break;}
 if(result.length!==count)throw Error('INSUFFICIENT_DISJOINT_SCENARIOS');return result;
}
function measureShadow(search,engine,count,eligibility,prepare){
 search.bindIsolatedHard(engine.adapter.bundle);const state=engine.adapter.state;
 const objects=[search,search.diagnosticKernel,search.diagnosticHard,search.leafEvaluator,search.pathUtility,state],saved=objects.map(snapshot);
 const old=search.diagnosticHazard,oldHard=search.diagnosticHard.hazard;
 search.diagnosticHazard=new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,
  reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true});search.diagnosticHard.hazard=search.diagnosticHazard;
 try{const r=prepareLayered(search,engine,count,eligibility,prepare,4096,3);
  return {used:r.used,completedDepth:r.completedDepth,attempts:r.attempts.map(a=>({depth:a.depth,work:a.work,status:a.status}))};
 }finally{for(let i=0;i<objects.length;i++)restore(objects[i],saved[i]);search.diagnosticHazard=old;search.diagnosticHard.hazard=oldHard;}
}
async function run(root,directory){
 if(fs.existsSync(directory))throw Error('OUTPUT_EXISTS');
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,'artifacts/native-causal-audit',name)));
 const origin=read('bp280-root-oracle36.json'),development=read('bp303-depth-calibration.json'),baseline=read('bp302-production-lattice-final.json');
 const tree=productionTreeSha256(root);assert.equal(tree,baseline.productionTreeSha256);
 const matches=zlib.gunzipSync(fs.readFileSync(path.join(origin.input.directory,'matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const excluded=new Set([...origin.records.map(r=>r.matchUrlId),...development.records.map(r=>r.id)]);
 const targets=selectTargets(matches,excluded),predictorPath=path.join(__dirname,'layer-admission-shadow.js'),predictorHash=hash(fs.readFileSync(predictorPath));
 fs.mkdirSync(directory,{recursive:true});
 const manifest={productionTreeSha256:tree,predictorHash,budget:4096,depthCap:3,targets,excludedIds:[...excluded].sort(),
  selection:'fixed SHA rank, one root per scenario, no outcome or cost selection',
  preregisteredGate:'lostCompletedDepth=0 AND avoidedWork>0; no tuning/retry on these targets'};
 fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare,records=[];
 try{for(const target of targets){let measured;
  proto.prepare=function(engine,count,eligibility){if(!measured&&engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]===target.frame)
   measured=measureShadow(this,engine,count,eligibility,prepare);
   return prepare.call(this,engine,count,eligibility);};
  const match=await play(module,scenarios.find(s=>s.matchUrlId===target.id),target.seat,false);
  assert.ok(measured,'TARGET_NOT_REACHED');const before=matches.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat);
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,before[side].compactActionStream,'SHADOW_ACTION_DRIFT');
  assert.equal(match.analysisOutcome,before.analysisOutcome);
  const audit=auditRecord({...target,measurements:[{protocol:'DEPTH_3',batches:[{on:[measured]}]}]});
  records.push({...audit,measured});console.error(`[admission-validation] ${records.length}/${targets.length}`);
 }}finally{proto.prepare=prepare;}
 assert.equal(productionTreeSha256(root),tree);assert.equal(hash(fs.readFileSync(predictorPath)),predictorHash);
 const summary=summarize(records),report={productionTreeSha256:tree,predictorHash,summary,records,
  status:summary.lostCompletedDepth===0&&summary.avoidedWork>0?'SHADOW_GATE_PASS':'SHADOW_GATE_REJECTED',
  productionModified:false,shadowActionDrift:0,warning:'Disjoint from cost-development scenarios, but drawn from previously used historical gameplay cohort; not a pristine win-rate holdout.'};
 fs.writeFileSync(path.join(directory,'overview.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,summary},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={selectTargets};
