'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {FixedSnapshot}=require('./search-transaction-workspace');
const {SearchSupportAudit,summarizeSupport}=require('./search-support-audit');
const {predictNextLayer}=require('./layer-admission-shadow');
const {percentile}=require('./lattice-search-benchmark');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function bestRow(scores,mask,count){let best=-1;for(let i=0;i<count;i++)if(mask[i]&&(best<0||scores[i]>scores[best]))best=i;return best;}
function summary(rows,matches){const depths={},stops={};for(const r of rows){depths[r.depth]=(depths[r.depth]||0)+1;stops[r.stop]=(stops[r.stop]||0)+1;}
 const timing=key=>({totalMs:rows.reduce((s,r)=>s+r[key],0),p50Ms:percentile(rows.map(r=>r[key]),.5),p95Ms:percentile(rows.map(r=>r[key]),.95)});
 return {matches:matches.length,searchRoots:rows.length,depths,stops,current:timing('currentMs'),shadow:timing('shadowMs'),
  changedMatrices:rows.filter(r=>r.matrixChanged).length,changedRawArgmax:rows.filter(r=>r.rawArgmaxChanged).length,
  matchShadowP95Ms:percentile(matches.map(m=>m.shadowMs),.95),maxMatchShadowMs:Math.max(...matches.map(m=>m.shadowMs)),
  actionStreamDrift:0,outcomeDrift:0};}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const read=n=>JSON.parse(fs.readFileSync(path.join(root,'artifacts/native-causal-audit',n)));
 const manifest=read('bp305-independent-admission/manifest.json'),origin=read('bp280-root-oracle36.json'),tree=productionTreeSha256(root);
 const baselineAt=process.argv.indexOf('--reducer-baseline');let legacy=null,baselineSha256=null;
 if(baselineAt>=0){
  const file=path.resolve(process.argv[baselineAt+1]),bytes=fs.readFileSync(file),Module=require('node:module');
  baselineSha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const filename=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js');
  const mod=new Module(filename);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
  mod._compile(bytes.toString(),filename);legacy=mod.exports.NativeBasePolicySearch.prototype;
 }else assert.equal(tree,manifest.productionTreeSha256);
 const old=zlib.gunzipSync(fs.readFileSync(path.join(origin.input.directory,'matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare,contexts=new WeakMap();
 const reducerNames=['transitionValue','worstReply','policyValue'],fixedReducers=reducerNames.map(k=>proto[k]);
 const useReducers=fixed=>{if(legacy)for(let i=0;i<reducerNames.length;i++)proto[reducerNames[i]]=fixed?fixedReducers[i]:legacy[reducerNames[i]];};
 const rows=[],matches=[];let currentId='',seat=0;
 const admit=(a,b,c)=>predictNextLayer(a,b,c).admit;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({productionTreeSha256:tree,
  targets:manifest.targets.map(t=>t.id),seats:[0,1],budget:legacy?'unchanged production':4096,depthCap:3,shadowOnly:true,
  experiment:legacy?'REDUCER_REPAIR':'COMPLETE_LAYERS',baselineSha256},null,2));
 useReducers(false);
 try{proto.prepare=function(engine,count,eligibility){
  this.bindIsolatedHard(engine.adapter.bundle);const state=engine.adapter.state;let c=contexts.get(this);
  if(!c){const objects=[this,this.diagnosticKernel,this.diagnosticHard,this.leafEvaluator,this.pathUtility,state];
   c={objects,snapshots:objects.map(o=>new FixedSnapshot(o)),thin:new ThinLayerExecutor(this,this.diagnosticKernel,state),
    hazard:new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true})};
   if(process.argv.includes('--support-audit'))c.audit=new SearchSupportAudit(this,c.thin);contexts.set(this,c);}
  for(let i=0;i<c.objects.length;i++)c.snapshots[i].capture(c.objects[i]);
  const oldHazard=this.diagnosticHazard,oldHard=this.diagnosticHard.hazard;let shadowMs,depth,used,stop,scores,mask;
  try{this.diagnosticHazard=c.hazard;this.diagnosticHard.hazard=c.hazard;if(c.audit)c.audit.begin();
   useReducers(true);
   const start=performance.now(),r=legacy?(()=>{prepare.call(this,engine,count,eligibility);return {completedDepth:this.currentDepth,used:this.nodes,count:1,status:[1]};})():c.thin.run(engine,count,eligibility,prepare,4096,3,admit);shadowMs=performance.now()-start;
   depth=r.completedDepth;used=r.used;stop=r.count?r.status[r.count-1]:0;
   scores=this.rootScore.slice();mask=this.rootDomainMask.slice();
  }finally{useReducers(false);if(c.audit)c.audit.end();for(let i=0;i<c.objects.length;i++)c.snapshots[i].restore(c.objects[i]);this.diagnosticHazard=oldHazard;this.diagnosticHard.hazard=oldHard;}
  const start=performance.now(),ok=(legacy?legacy.prepare:prepare).call(this,engine,count,eligibility),currentMs=performance.now()-start;
  let matrixChanged=false;for(let i=0;i<count;i++)if(scores[i]!==this.rootScore[i]||mask[i]!==this.rootDomainMask[i])matrixChanged=true;
  rows.push({id:currentId,seat,frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],depth,used,stop,shadowMs,currentMs,
   matrixChanged:depth>0&&matrixChanged,rawArgmaxChanged:depth>0&&bestRow(scores,mask,count)!==bestRow(this.rootScore,this.rootDomainMask,count),
   ...(c.audit?{support:{counts:c.audit.counts,geometryCounts:c.audit.geometryCounts,witnesses:c.audit.witnesses}}:{})});
  return ok;
 };
 for(const t of manifest.targets)for(seat=0;seat<2;seat++){
  currentId=t.id;const first=rows.length,match=await play(module,scenarios.find(s=>s.matchUrlId===t.id),seat,false);
  const before=old.find(m=>m.matchUrlId===t.id&&m.candidateSeat===seat);
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,before[side].compactActionStream,'SHADOW_ACTION_DRIFT');
  assert.equal(match.analysisOutcome,before.analysisOutcome,'OUTCOME_DRIFT');
  const samples=rows.slice(first);matches.push({id:t.id,seat,outcome:match.analysisOutcome,frames:match.frames,roots:samples.length,
   shadowMs:samples.reduce((s,r)=>s+r.shadowMs,0),currentMs:samples.reduce((s,r)=>s+r.currentMs,0)});
  console.error(`[whole-game-shadow] ${matches.length}/32`);
 }
 }finally{proto.prepare=prepare;useReducers(true);}
 assert.equal(productionTreeSha256(root),tree);
 const overview={productionTreeSha256:tree,summary:summary(rows,matches),matches,
  support:process.argv.includes('--support-audit')?summarizeSupport(rows):null,
  warnings:['rawArgmax is not final action: excludes Risk/intent/ties','matrixChanged compares root value vector and domain, not every cell',
   'local diagnostic timings exclude observation/controller/restoration cost; not platform timeout evidence',
   'only roots where production calls prepare; does not measure non-search callbacks or active-policy trajectories']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));
 fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'));
 console.log(JSON.stringify(overview.summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={bestRow,summary};
