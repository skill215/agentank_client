'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const prior=require('./adaptive-optimization-design');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const SPECS=Object.freeze({baseline:{track:'reference'},R29:{track:'reference'},
 'leaf-cache':{track:'efficiency',hypothesis:'Avoid repeated exact-state raw leaf evaluation within a root; preserve decisions.'},
 quiescence:{track:'quality',hypothesis:'Extend unstable projectile or imminent bomb leaves by at most one ply within existing caps.'},
 'cell-budget':{track:'quality',hypothesis:'Distribute the existing root budget evenly across own/enemy action pairs.'},
 'bomb-quiescence':{track:'quality',hypothesis:'If broad quiescence fails, restrict the extension to imminent bomb blast leaves.'}});
function replace(s,a,b){assert.equal(s.split(a).length,2,'SOURCE_PATCH_DRIFT');return s.replace(a,b);}
function transform(src,mode){assert.ok(SPECS[mode]);
 if(mode.includes('quiescence')){src=replace(src,'"off" !== EVENT_QUIESCENCE.OFF','"projectile-bomb" !== EVENT_QUIESCENCE.OFF');src=replace(src,'extraPly < 3 && top < 4','extraPly < 1 && top < 4');}
 if(mode==='cell-budget'){assert.equal(src.split('"row-shared" === "cell-equal"').length,4);src=src.replaceAll('"row-shared" === "cell-equal"','true');}
 return src;
}
function installCache(leaf,audit,shadow=false){
 const raw=leaf.evaluate.bind(leaf),begin=leaf.beginRoot.bind(leaf);let entries=null,next=0;
 leaf.beginRoot=function(state){
  if(!entries){const words=state.arrays.reduce((n,a)=>n+a.length,0);entries=Array.from({length:16},()=>({valid:false,data:new Uint32Array(words),components:new Int32Array(6)}));audit.cacheBytes+=16*(words*4+24);}
  for(const e of entries)e.valid=false;next=0;return begin(state);
 };
 leaf.evaluate=function(state){audit.leafCalls++;
  let hit=null;for(const e of entries||[]){if(!e.valid||e.lo!==state.hashLo||e.hi!==state.hashHi||e.width!==state.width||e.height!==state.height)continue;
   let i=0,equal=true;outer:for(const a of state.arrays)for(const x of a){audit.cacheComparedWords++;if(e.data[i++]!==(x>>>0)){equal=false;break outer;}}
   if(equal){hit=e;break;}
  }
  if(hit){audit.cacheHits++;if(shadow){const v=raw(state);assert.equal(v,hit.value,'CACHE_SCALAR_DRIFT');assert.deepEqual(Array.from(leaf.lastComponents),Array.from(hit.components),'CACHE_COMPONENT_DRIFT');audit.shadowChecks++;}
   leaf.lastComponents.set(hit.components);return hit.value;}
  audit.leafExecutions++;const value=raw(state);if(entries){const e=entries[next++%entries.length];e.valid=true;e.lo=state.hashLo;e.hi=state.hashHi;e.width=state.width;e.height=state.height;e.value=value;
   let i=0;for(const a of state.arrays)for(const x of a)e.data[i++]=x>>>0;e.components.set(leaf.lastComponents);}
  return value;
 };
}
function instability(search,state,bombOnly){
 const a=state.arrays,leaf=search.leafEvaluator,f=a[ARRAY.SCALAR][SCALAR.FRAME];let mask=0;
 if(!bombOnly&&(leaf.projectileThreat(state,0)>0||leaf.projectileThreat(state,1)>0))mask|=1;
 for(let i=0;i<a[ARRAY.BOMB_ACTIVE].length;i++)if(a[ARRAY.BOMB_ACTIVE][i]&&a[ARRAY.BOMB_EXPLODE][i]<=f+1&&
  (leaf.bombHits(state,a[ARRAY.BOMB_CELL][i],a[ARRAY.TANK_CELL][0])||leaf.bombHits(state,a[ARRAY.BOMB_CELL][i],a[ARRAY.TANK_CELL][1])))mask|=2;
 return mask;
}
function compile(root){const Module=require('node:module'),file=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js'),src=fs.readFileSync(file,'utf8'),methods={};
 for(const mode of Object.keys(SPECS)){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(transform(src,mode),file);methods[mode]=m.exports.NativeBasePolicySearch.prototype;}
 const old=prior.compile(root);
 return {methods,install(engine,mode,bot,audit,shadow=false){assert.ok(SPECS[mode]);const s=engine.basePolicy.policySearch,leaf=s.leafEvaluator;
  if(mode==='R29')old.install(engine,mode);
  if(mode==='cell-budget'){s.prepare=function(...args){const result=methods[mode].prepare.apply(s,args);bot.searchEvidenceCurrent=Boolean(result);bot.searchEntry=result?'SEARCH_PREPARED':'PREPARE_FAILED';return result;};}
  if(mode.includes('quiescence')){s.policyValue=methods[mode].policyValue;s.eventInstabilityMask=state=>instability(s,state,mode==='bomb-quiescence');}
  if(mode==='leaf-cache')installCache(leaf,audit,shadow);else{const raw=leaf.evaluate.bind(leaf);leaf.evaluate=function(state){audit.leafCalls++;audit.leafExecutions++;return raw(state);};}
 }};
}
function compare(base,rows,tail=.025,reps=2000){const x=prior.compare(base,rows,tail,reps),sum=(rs,k)=>rs.reduce((n,r)=>n+(r.audit[k]||0),0);
 return {...x,leafCalls:sum(rows,'leafCalls'),leafExecutions:sum(rows,'leafExecutions'),cacheHits:sum(rows,'cacheHits'),cacheBytes:sum(rows,'cacheBytes'),
  leafExecutionRatio:sum(rows,'leafExecutions')/Math.max(1,sum(base,'leafExecutions')),decisionMsRatio:sum(rows,'decisionMs')/Math.max(.001,sum(base,'decisionMs')),
  decisionMs:sum(rows,'decisionMs'),quiescenceExtensions:sum(rows,'quiescenceExtensions')};}
function evaluateModes(rows,modes,role='validation',strict=false){const output={};for(const mode of modes){output[mode]={};for(const env of ['original','event']){
 const candidate=rows.filter(r=>r.job.mode===mode&&r.job.env===env&&(role==='all'||r.job.role===role)),ks=new Set(candidate.map(prior.key));
 output[mode][env]=compare(rows.filter(r=>r.job.mode==='baseline'&&ks.has(prior.key(r))),candidate,strict?.05/60:.025,strict?6000:2000);
 }}return output;}
function evidence(summary,batches,mode){const e=prior.evidence(summary,batches);if(mode!=='leaf-cache')return e;
 const v=Object.values(summary),drift=v.some(x=>x.semanticChanges),savings=v.every(x=>x.leafExecutionRatio<=.95),measuredSlow=v.some(x=>x.decisionMsRatio>1.25),enough=e.minMaps>=24&&batches>=2;
 // Parallel arena timings are exploratory; only a separate serial benchmark can qualify speed.
 return {...e,strong:false,retire:drift||(enough&&(!savings||measuredSlow)),status:drift?'CACHE_SEMANTIC_REJECTED':enough&&measuredSlow?'CACHE_OVERHEAD_REJECTED':enough&&!savings?'CACHE_SAVINGS_REJECTED':savings?'EFFICIENCY_BENCHMARK_REQUIRED':'EFFICIENCY_UNCERTAIN',efficiencyTrack:true};}
function support(history,mode){const rs=history.filter(r=>r.job.mode===mode&&r.job.role==='discovery');return {maps:new Set(rs.map(r=>r.matchUrlId)).size,batches:new Set(rs.map(r=>r.job.batch)).size};}
function duplicates(history,modes){const out=[];for(let j=1;j<modes.length;j++)for(let i=0;i<j;i++){
 const a=modes[i],b=modes[j];if(SPECS[a].track!==SPECS[b].track)continue;
 const left=new Map(history.filter(r=>r.job.mode===a&&r.job.role==='discovery').map(r=>[prior.key(r),r]));
 const right=history.filter(r=>r.job.mode===b&&r.job.role==='discovery'&&left.has(prior.key(r)));
 if(new Set(right.map(r=>r.matchUrlId)).size<12)continue;
 if(right.every(r=>signature(r)===signature(left.get(prior.key(r))))){const lc=right.reduce((n,r)=>n+left.get(prior.key(r)).audit.transitions,0),rc=right.reduce((n,r)=>n+r.audit.transitions,0);out.push({keep:lc<=rc?a:b,retire:lc<=rc?b:a,maps:new Set(right.map(r=>r.matchUrlId)).size});}
 }return out;}
function signature(r){return JSON.stringify([r.candidate.compactActionStream,r.candidate.compactArguments,r.control.compactActionStream,r.control.compactArguments,r.counts,r.analysisOutcome,r.terminalCategory]);}
function chooseNext(batch,active,pool,retired,seen,discovery,qualified,frozen=null,supports={}){
 const eligible=m=>!retired.includes(m)&&(supports[m]?.maps||0)>=24&&(supports[m]?.batches||0)>=2;
 if(batch>=7){const pick=frozen||active.filter(eligible).sort((a,b)=>discovery[b]-discovery[a]).slice(0,2);return {active:pick,frozen:pick,phase:'CONFIRMATION',action:batch===7?'FREEZE_SUPPORTED_CONFIRMATION':'KEEP_FROZEN_CONFIRMATION'};}
 const next=active.filter(m=>!retired.includes(m));
 if(next.length<3&&retired.includes('quiescence')&&!seen.includes('bomb-quiescence'))next.push('bomb-quiescence');
 return {active:next,frozen:null,phase:next.length?'DISCOVERY':'REFERENCE_AUDIT',action:!next.length?'PIVOT_TO_REFERENCE_MODEL_AUDIT':active.some(m=>retired.includes(m))?'RETIRE_AND_REALLOCATE':active.some(m=>!eligible(m))?'BUILD_MINIMUM_SUPPORT':'RETAIN_AND_REPLICATE'};
}
module.exports={...prior,SPECS,compile,transform,installCache,instability,compare,evaluateModes,evidence,support,duplicates,signature,chooseNext};
