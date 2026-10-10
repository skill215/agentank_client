'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {FixedSnapshot}=require('./search-transaction-workspace');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {firstDifference}=require('./reducer-repair-active');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {loadCohort}=require('./v2-native-initiative-arena'),{loadSimulator}=require('../simulation/paired-arena');
const {percentile}=require('./lattice-search-benchmark');
function group(records){const out={};for(const r of records){const key=r.before+'->'+r.after,g=out[key]||(out[key]={count:0,noLayer:0,depth1:0,depth2:0,depth3:0,fireRemoved:0,fireAdded:0});g.count++;g.noLayer+=r.layered.depth===0;g['depth'+r.layered.depth]=(g['depth'+r.layered.depth]||0)+(r.layered.depth>0?1:0);g.fireRemoved+=r.oldAction===4&&r.newAction!==4;g.fireAdded+=r.oldAction!==4&&r.newAction===4;}return out;}
function bench(search,engine,count,eligibility,prepare){
 search.bindIsolatedHard(engine.adapter.bundle);const state=engine.adapter.state,objects=[search,search.diagnosticKernel,search.diagnosticHard,search.leafEvaluator,search.pathUtility,state],snaps=objects.map(o=>new FixedSnapshot(o));snaps.forEach((s,i)=>s.capture(objects[i]));
 const physical=state.arrays.map(a=>a.slice()),oldH=search.diagnosticHazard,oldHH=search.diagnosticHard.hazard;
 const hazards=Array.from({length:3},()=>new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true}));
 const executors=Array.from({length:3},()=>new ThinLayerExecutor(search,search.diagnosticKernel,state));
 const restore=()=>{snaps.forEach((s,i)=>s.restore(objects[i]));search.diagnosticHazard=oldH;search.diagnosticHard.hazard=oldHH;for(let i=0;i<physical.length;i++)assert.deepEqual(state.arrays[i],physical[i],'BENCH_ROOT_RESTORE');};
 const fingerprint=[],samples=[],values=[];
 const execute=(mode,batch,repeat)=>{restore();search.diagnosticHazard=hazards[mode];search.diagnosticHard.hazard=hazards[mode];let work=0,ok,depth,schedule;
  const kernel=search.diagnosticKernel,apply=kernel.applyFrame,own=Object.hasOwn(kernel,'applyFrame');
  const start=performance.now();
  try{if(mode===0){kernel.applyFrame=function(...a){work++;return apply.apply(this,a);};ok=prepare.call(search,engine,count,eligibility);depth=search.currentDepth;}
   else{schedule=executors[mode].run(engine,count,eligibility,prepare,128,mode===1?1:3);work=schedule.used;depth=schedule.completedDepth;ok=depth>0;}
   const ms=performance.now()-start,fp=JSON.stringify({ok,depth,scores:Array.from(search.rootScore),mask:Array.from(search.rootDomainMask),cells:Array.from(search.rootCellScore)});
   if(fingerprint[mode])assert.equal(fp,fingerprint[mode],'BENCH_SEMANTIC_DRIFT');else fingerprint[mode]=fp;
   if(!values[mode])values[mode]={mode:['CURRENT','DEPTH1','LAYERED128'][mode],ok:Boolean(ok),depth,scores:Array.from(search.rootScore),nominal:Array.from(search.rootNominalScore),mask:Array.from(search.rootDomainMask)};
   if(batch>=0)samples.push({mode:['CURRENT','DEPTH1','LAYERED128'][mode],batch,repeat,ms,work,depth,ok:Boolean(ok)});
  }finally{if(own)kernel.applyFrame=apply;else delete kernel.applyFrame;restore();}
 };
 try{for(let n=0;n<3;n++)for(let mode=0;mode<3;mode++)execute(mode,-1,n);
  for(let b=0;b<5;b++)for(let n=0;n<2;n++)for(let j=0;j<3;j++)execute((j+b+n)%3,b,n);
 }finally{restore();}
 return {samples,values};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const load=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n+'/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const before=load('bp317-reducer-active-verified'),after=load('bp333-layered-budget-active');assert.equal(tree,JSON.parse(fs.readFileSync(path.join(base,'bp333-layered-budget-active/overview.json'))).tree);
 const targets=after.filter(m=>before.find(x=>x.matchUrlId===m.matchUrlId&&x.candidateSeat===m.candidateSeat).analysisOutcome!==m.analysisOutcome).map(m=>{const b=before.find(x=>x.matchUrlId===m.matchUrlId&&x.candidateSeat===m.candidateSeat),frame=firstDifference(b.candidate.compactActionStream,m.candidate.compactActionStream);assert.ok(frame>=0);return {id:m.matchUrlId,seat:m.candidateSeat,frame,b,m};});assert.equal(targets.length,15);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const prepare=S.prototype.prepare,select=O.prototype.selectOverride,executors=new WeakMap(),records=[],benchmark=[];let target,mode,seen,decision,scheduling;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:targets.map(t=>({id:t.id,seat:t.seat,frame:t.frame})),games:30,protocol:'15 old/new trajectory reconstructions; benchmark at common first divergence; 3 warmups and 5x2 interleaved measurements per mode',modes:['CURRENT','DEPTH1','LAYERED128'],limit:128},null,2));
 try{S.prototype.prepare=function(engine,count,eligibility){const frame=engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  if(mode==='CURRENT'){if(frame===target.frame){benchmark.push({id:target.id,seat:target.seat,frame,...bench(this,engine,count,eligibility,prepare)});seen++;}
   const ok=prepare.call(this,engine,count,eligibility);if(frame===target.frame)scheduling={depth:this.currentDepth,complete:Boolean(ok),budgetLeaves:this.lastBudgetLeafCount,fastIncomplete:this.lastFastIncompleteCount};return ok;}
  this.bindIsolatedHard(engine.adapter.bundle);let e=executors.get(this);if(!e){e=new ThinLayerExecutor(this,this.diagnosticKernel,engine.adapter.state);executors.set(this,e);}const s=e.run(engine,count,eligibility,prepare,128,3);
  if(frame===target.frame){seen++;scheduling={depth:s.completedDepth,complete:s.completedDepth>0,used:s.used,stop:s.status[s.count-1]||0};}return s.completedDepth>0?1:0;
 };
 O.prototype.selectOverride=function(engine,selected,incumbent){const frame=engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME],result=select.call(this,engine,selected,incumbent);
  if(frame===target.frame){decision={incumbent,proposal:result?result.action:incumbent,hasOverride:result!==null};
   if(mode==='CURRENT'){const b=benchmark.at(-1),s=this.policySearch;for(const v of b.values){let best=-1,bv=-Infinity,bn=-Infinity;
    for(let row=0;row<engine.ourCount;row++)if(this.allowedRow[row]&&v.mask[row]){const bonus=this.backedValue[row]-s.rootScore[row],value=v.scores[row]+bonus,nominal=v.nominal[row]+bonus;
     if(this.better(engine,row,best,value,bv,nominal,bn)){best=row;bv=value;bn=nominal;}}
    v.ownerProposal=v.ok&&best>=0?engine.ourActions[best]:incumbent;}
    assert.equal(b.values[0].ownerProposal,decision.proposal,'BENCH_OWNER_RECONSTRUCTION');}
  }return result;};
 for(target of targets){const entry={id:target.id,seat:target.seat,frame:target.frame,before:target.b.analysisOutcome,after:target.m.analysisOutcome,beforeCategory:target.b.terminalCategory,afterCategory:target.m.terminalCategory};
  for(mode of ['CURRENT','LAYERED']){seen=0;decision=null;scheduling=null;const m=await play(module,scenarios.find(s=>s.matchUrlId===target.id),target.seat,false),expected=mode==='CURRENT'?target.b:target.m;
   for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,expected[side].compactActionStream,'REPLAY_ACTION_DRIFT');assert.deepEqual(m[side].compactArguments,expected[side].compactArguments);}
   assert.equal(m.analysisOutcome,expected.analysisOutcome);assert.deepEqual(m.counts,expected.counts);assert.ok(prefixMatches(target.b,m,target.frame,Buffer.from(expected.candidate.compactActionStream,'base64')[target.frame]));assert.equal(seen,1,'TARGET_SEARCH_MISSING');assert.ok(decision&&scheduling);
   assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
   entry[mode==='CURRENT'?'current':'layered']={...scheduling,...decision};entry[mode==='CURRENT'?'oldAction':'newAction']=Buffer.from(m.candidate.compactActionStream,'base64')[target.frame];}
  records.push(entry);console.error(`[flip-audit] ${records.length}/15`);
 }}finally{S.prototype.prepare=prepare;O.prototype.selectOverride=select;}
 assert.equal(productionTreeSha256(root),tree);
 const costs={};for(const name of ['CURRENT','DEPTH1','LAYERED128']){const list=benchmark.flatMap(r=>r.samples.filter(s=>s.mode===name));costs[name]={samples:list.length,totalMs:list.reduce((n,s)=>n+s.ms,0),p95Ms:percentile(list.map(s=>s.ms),.95),work:list.reduce((n,s)=>n+s.work,0),depths:list.reduce((o,s)=>(o[s.depth]=(o[s.depth]||0)+1,o),{}),batches:Array.from({length:5},(_,b)=>{const x=list.filter(s=>s.batch===b);return {batch:b,totalMs:x.reduce((n,s)=>n+s.ms,0),p95Ms:percentile(x.map(s=>s.ms),.95)};})};}
 const comparison=benchmark.map(r=>({id:r.id,seat:r.seat,frame:r.frame,current:r.values[0].ownerProposal,depth1:r.values[1].ownerProposal,layered:r.values[2].ownerProposal,layeredDepth:r.values[2].depth,depth1MatchesLayered:r.values[1].ownerProposal===r.values[2].ownerProposal}));
 const overview={tree,groups:group(records),records,costs,comparison,checks:{replays:30,fullActionDrift:0,rootRestoreFailures:0,errors:0,timeouts:0},notes:['First divergence labels are mechanism classification, not one-action causal proof','Benchmark sample is selected outcome-flip roots, not all game states','Times include executor restoration but exclude external isolation snapshot; not platform runtime']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'benchmark.ndjson.gz'),zlib.gzipSync(benchmark.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify({groups:overview.groups,costs},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={group};
