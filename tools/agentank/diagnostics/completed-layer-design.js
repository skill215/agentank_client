'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const previous=require('./focused-extension-design');
const SPECS=Object.freeze({baseline:{track:'reference'},R29:{track:'reference'},
 'one-ply-control':{track:'preflight-control'},'rollback-control':{track:'preflight-control'},
 'completed-layer':{track:'quality',hypothesis:'Commit only whole completed root matrices; discard budget-interrupted deeper iterations under a cumulative 128-node target.'},
 'R29-completed-layer':{track:'quality',hypothesis:'Only after the complete-layer parent has supported positive means, test the old path repair on top.'}});
function replace(s,a,b){assert.equal(s.split(a).length,2,'SOURCE_PATCH_DRIFT');return s.replace(a,b);}
function transform(s){
 s=replace(s,'if (depth <= 0 && 0) {','if (depth <= 0 && this.enforceLayerBudget) {');
 s=replace(s,'if (0) {\n          this.iterationBudgetInterrupted = 1;','if (this.enforceLayerBudget) {\n          this.iterationBudgetInterrupted = 1;');
 assert.equal(s.split('if (0 && this.iterationBudgetInterrupted)').length,7);
 s=s.replaceAll('if (0 && this.iterationBudgetInterrupted)','if (this.enforceLayerBudget && this.iterationBudgetInterrupted)');
 s=replace(s,'this.perRootBudget = 0 ? Math.max(1, 128) :','this.perRootBudget = 1 ? Math.max(1, this.layerBudget) :');
 s=replace(s,'if (0) this.nodes = 0;','if (true) this.nodes = 0;');
 s=replace(s,'if (!0) this.nodes = 0;','if (false) this.nodes = 0;');
 s=replace(s,'if (!0)\n        runNodes +=','if (false)\n        runNodes +=');
 s=replace(s,'if (0) runNodes = this.nodes;','if (true) runNodes = this.nodes;');return s;
}
function snapshotter(search,audit){
 const arrays=Object.entries(search).filter(([,v])=>ArrayBuffer.isView(v)&&typeof v.set==='function').map(([key,v])=>({key,saved:new v.constructor(v.length)}));
 const numbers=Object.keys(search).filter(k=>typeof search[k]==='number'),values=new Float64Array(numbers.length);
 const bytes=arrays.reduce((n,e)=>n+e.saved.byteLength,0)+values.byteLength;audit.snapshotAllocatedBytes+=bytes;
 return {save(){for(const e of arrays)e.saved.set(search[e.key]);for(let i=0;i<numbers.length;i++)values[i]=search[numbers[i]];audit.snapshotCopiedBytes+=bytes;},
 restore(){for(const e of arrays)search[e.key].set(e.saved);for(let i=0;i<numbers.length;i++)search[numbers[i]]=values[i];audit.snapshotCopiedBytes+=bytes;}};
}
function installIterations(search,prepare,bot,audit,forceRollback=false){
 search.layerBudget=128;search.layerDepth=1;search.enforceLayerBudget=false;
 search.scheduledDepth=()=>search.layerDepth;let checkpoint=null;
 search.prepare=function(...args){
  search.layerDepth=1;search.layerBudget=Number.MAX_SAFE_INTEGER;search.enforceLayerBudget=false;
  const result=prepare.apply(search,args);if(!result){bot.searchEvidenceCurrent=false;bot.searchEntry='PREPARE_FAILED';return result;}
  let spent=search.nodes,committed=1;if(!checkpoint)checkpoint=snapshotter(search,audit);checkpoint.save();audit.completedRoots++;
  for(let depth=2;depth<=3&&spent<128;depth++){
   search.layerDepth=depth;search.layerBudget=128-spent;search.enforceLayerBudget=true;audit.layerAttempts++;
   const ready=prepare.apply(search,args),cost=search.nodes;spent+=cost;audit.discardedBudgetLeaves+=search.lastBudgetLeafCount;
   if(!ready||search.iterationBudgetInterrupted||search.lastFastIncompleteCount||search.lastHardIncompleteCount||forceRollback){checkpoint.restore();audit.layerRollbacks++;break;}
   committed=depth;checkpoint.save();audit.layerCommits++;
  }
  search.nodes=spent;search.currentDepth=committed;search.enforceLayerBudget=false;
  audit.committedDepthSum+=committed;audit.workOverTargetRoots+=Number(spent>128);
  bot.searchEvidenceCurrent=true;bot.searchEntry='SEARCH_PREPARED';return 1;
 };
}
function compile(root){const Module=require('node:module'),file=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js'),m=new Module(file,module);
 m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(transform(fs.readFileSync(file,'utf8')),file);const methods=m.exports.NativeBasePolicySearch.prototype;
 const base=require('./continuous-improvement-design').compile(root);
 return {methods,install(engine,mode,bot,audit,shadow){assert.ok(SPECS[mode]);base.install(engine,mode==='R29'||mode==='R29-completed-layer'?'R29':'baseline',bot,audit,shadow);const s=engine.basePolicy.policySearch;
  if(mode==='one-ply-control')s.scheduledDepth=()=>1;
  if(mode.includes('completed-layer')||mode==='rollback-control'){
   s.transitionValue=methods.transitionValue;s.worstReply=methods.worstReply;s.policyValue=methods.policyValue;
   installIterations(s,methods.prepare,bot,audit,mode==='rollback-control');
  }
 }};
}
function chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen=null,supports={}){
 if(batch>=7)return previous.chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen,supports);
 const next=active.filter(m=>!retired.includes(m)),p='completed-layer';
 if(next.length<2&&next.includes(p)&&(supports[p]?.maps||0)>=24&&(supports[p]?.batches||0)>=2&&pool[p]?.worstMean>0&&!seen.includes('R29-completed-layer'))next.push('R29-completed-layer');
 return {active:next,frozen:null,phase:next.length?'DISCOVERY':'REFERENCE_AUDIT',action:!next.length?'PIVOT_TO_REFERENCE_MODEL_AUDIT':active.some(m=>retired.includes(m))?'RETIRE_AND_REALLOCATE':active.some(m=>(supports[m]?.maps||0)<24)?'BUILD_MINIMUM_SUPPORT':'RETAIN_AND_REPLICATE'};
}
function verifyControl(rows){const ref=new Map(rows.filter(r=>r.job.mode==='one-ply-control').map(r=>[previous.key(r),r]));let checked=0;
 for(const r of rows.filter(r=>r.job.mode==='rollback-control')){assert.ok(ref.has(previous.key(r)));assert.equal(previous.signature(r),previous.signature(ref.get(previous.key(r))),'LAYER_ROLLBACK_BEHAVIOR_DRIFT');checked++;}return checked;
}
module.exports={...previous,SPECS,compile,transform,snapshotter,installIterations,chooseNext,verifyControl};
