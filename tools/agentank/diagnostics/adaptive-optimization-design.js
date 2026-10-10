'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {hash,interval,score}=require('./strategic-improvement-model');
const SPECS=Object.freeze({
 baseline:{terminal:false,chance:'legacy',path:'baseline'},
 R29:{terminal:false,chance:'legacy',path:'R29'},
 terminal:{terminal:true,chance:'legacy',path:'baseline'},
 chance:{terminal:false,chance:'mean',path:'baseline'},
 aligned:{terminal:true,chance:'mean',path:'baseline'},
 'chance-worst':{terminal:false,chance:'worst',path:'baseline'},
 'aligned-worst':{terminal:true,chance:'worst',path:'baseline'},
 'root-chance':{terminal:false,chance:'root-mean',path:'baseline'},
 'root-aligned':{terminal:true,chance:'root-mean',path:'baseline'},
 'R29-terminal':{terminal:true,chance:'legacy',path:'R29'},
 'R29-chance':{terminal:false,chance:'mean',path:'R29'},
 'R29-aligned':{terminal:true,chance:'mean',path:'R29'}
});
function replace(source,from,to){assert.equal(source.split(from).length,2,'SOURCE_PATCH_DRIFT');return source.replace(from,to);}
function transform(source,mode){
 const s=SPECS[mode];assert.ok(s,'UNKNOWN_VARIANT');
 if(s.chance!=='legacy')source=replace(source,'if ("v1-deterministic" === "v1-deterministic" && ownChance > 1) {',
   s.chance==='root-mean'?'if (top > 1 && ownChance > 1) {':'if (false && ownChance > 1) {');
 if(s.chance==='worst')source=replace(source,'if ("v1-deterministic" === "worst") {','if (true) {');
 if(s.terminal){const a=source.indexOf('terminalUtility(engine, terminal, depth, pathScore, top = 0) {'),b=source.indexOf('\npairedLeaf(',a);assert.ok(a>0&&b>a);
   source=source.slice(0,a)+`terminalUtility(engine, terminal, depth, pathScore, top = 0) {
    return terminal === TERMINAL.WIN0 ? 100000 : terminal === TERMINAL.WIN1 ? -100000 : terminal === TERMINAL.DRAW ? 0 : this.leaf(engine,pathScore,top);
  }
`+source.slice(b);}
 return source;
}
function compile(root){
 const Module=require('node:module'),file=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js'),src=fs.readFileSync(file,'utf8');
 const methods={};for(const mode of Object.keys(SPECS)){
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(transform(src,mode),file);
  methods[mode]=m.exports.NativeBasePolicySearch.prototype;
 }
 const p=path.join(root,'engine-v2/src/base-policy-specialized/path-utility.js'),m=new Module(p,module);m.filename=p;m.paths=Module._nodeModulePaths(path.dirname(p));
 m._compile(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds/build/R29/path-utility.js'),'utf8'),p);
 const legacy=m.exports.NativeBasePolicyPathUtility.prototype;
 return {install(engine,mode){const search=engine.basePolicy.policySearch;assert.ok(methods[mode]);
   search.transitionValue=methods[mode].transitionValue;search.terminalUtility=methods[mode].terminalUtility;
   if(SPECS[mode].path==='R29')search.pathUtility.scoreTransition=legacy.scoreTransition;
 },methods};
}
const single=r=>Number(score(r)===0&&r.terminalCategory==='SINGLE_CRASH');
const key=r=>`${r.job.round||0}:${r.job.env||'original'}:${r.matchUrlId}:${r.candidateSeat}`;
function doubleLosses(rows){const maps=new Map();for(const r of rows){const k=`${r.job.round}:${r.job.env}:${r.matchUrlId}`,v=maps.get(k)||[];v.push(r);maps.set(k,v);}return [...maps.values()].filter(rs=>rs.length===2&&rs.every(r=>score(r)===0)).length;}
function compare(base,rows,tail=.025,reps=2000){
 const index=new Map(base.map(r=>[key(r),r]));assert.equal(index.size,base.length);assert.equal(base.length,rows.length);
 const records=rows.map(r=>{const b=index.get(key(r));assert.ok(b);assert.equal(r.scenarioFingerprint,b.scenarioFingerprint);return {map:r.matchUrlId,delta:score(r)-score(b)};});
 const ci=interval(records,tail,reps),sum=(rs,k)=>rs.reduce((n,r)=>n+r.audit[k],0);
 return {...ci,deltaPoints:records.reduce((n,r)=>n+r.delta,0),deathDelta:rows.reduce((n,r)=>n+single(r),0)-base.reduce((n,r)=>n+single(r),0),
  doubleLossDelta:doubleLosses(rows)-doubleLosses(base),nodeRatio:sum(rows,'nodes')/Math.max(1,sum(base,'nodes')),
  transitionRatio:sum(rows,'transitions')/Math.max(1,sum(base,'transitions')),
  semanticChanges:rows.filter(r=>{const b=index.get(key(r));return r.candidate.compactActionStream!==b.candidate.compactActionStream||r.control.compactActionStream!==b.control.compactActionStream||JSON.stringify(r.candidate.compactArguments)!==JSON.stringify(b.candidate.compactArguments)||JSON.stringify(r.control.compactArguments)!==JSON.stringify(b.control.compactArguments)||score(r)!==score(b);}).length,
  nodes:sum(rows,'nodes'),transitions:sum(rows,'transitions'),baselinePoints:base.reduce((n,r)=>n+score(r),0),candidatePoints:rows.reduce((n,r)=>n+score(r),0)};
}
function evaluateModes(rows,modes,role='validation',strict=false){
 const output={};for(const mode of modes){output[mode]={};for(const env of ['original','event']){
   const candidate=rows.filter(r=>r.job.mode===mode&&r.job.env===env&&(role==='all'||r.job.role===role));
   const ks=new Set(candidate.map(key)),base=rows.filter(r=>r.job.mode==='baseline'&&ks.has(key(r)));
   output[mode][env]=compare(base,candidate,strict?.05/60:.025,strict?6000:2000);
 }}return output;
}
function evidence(summary,batches){
 const a=summary.original,b=summary.event,minMaps=Math.min(a.maps,b.maps);
 const activity=a.semanticChanges+b.semanticChanges;
 const overCost=[a,b].some(x=>x.nodeRatio>2||x.transitionRatio>2);
 const rngConflict=a.mean*b.mean<0&&Math.abs(a.mean-b.mean)>=.04;
 const strong=minMaps>=48&&[a,b].every(x=>x.lo>0&&x.deathDelta<=0&&x.doubleLossDelta<=0)&&!overCost;
 const negative=batches>=2&&[a,b].every(x=>x.mean<0)&&a.deltaPoints+b.deltaPoints<=-4;
 const inactive=minMaps>=24&&activity===0;
 return {status:overCost?'COST_REJECTED':inactive?'INACTIVE':negative?'REPLICATED_NEGATIVE':strong?'LOCAL_SUPPORTED':rngConflict?'RNG_CONFLICT':
   [a,b].every(x=>x.mean>0)?'POSITIVE_UNCERTAIN':'INCONCLUSIVE',retire:overCost||inactive||negative,
   rngConflict,strong,activity,minMaps,worstMean:Math.min(a.mean,b.mean)};
}
function chooseNext(batch,active,pool,retired,seen,discovery,qualified,previousFrozen=null){
 if(batch>=7){
   const frozen=previousFrozen||active.filter(m=>!retired.includes(m)).sort((x,y)=>(discovery[y]??-Infinity)-(discovery[x]??-Infinity)).slice(0,2);
   // A fixed final confirmation cohort is evaluated even after an unfavorable
   // intermediate block; it is never refit or enlarged to chase significance.
   return {active:frozen,phase:'CONFIRMATION',frozen,
     action:batch===7?'FREEZE_FINAL_CONFIRMATION':'KEEP_FROZEN_CONFIRMATION'};
 }
 const ordered=active.filter(m=>!retired.includes(m)).sort((x,y)=>(discovery[y]??-Infinity)-(discovery[x]??-Infinity));
 const next=ordered.slice(0,2);
 const hasConflict=active.some(m=>pool[m]?.status==='RNG_CONFLICT');
 const ranking=hasConflict?['chance-worst','aligned-worst','root-chance','root-aligned','R29-chance','R29-aligned','R29-terminal']:
   ['R29-terminal','R29-chance','R29-aligned','root-chance','root-aligned','chance-worst','aligned-worst'];
 const fresh=ranking.find(m=>!seen.includes(m));if(fresh)next.push(fresh);
 if(next.length<2)for(const m of Object.keys(pool).filter(m=>!retired.includes(m)&&!next.includes(m)).sort((x,y)=>(discovery[y]??-Infinity)-(discovery[x]??-Infinity))){next.push(m);if(next.length>=2)break;}
 return {active:next,phase:batch>=3||qualified.length?'FOCUSED_VALIDATION':'DISCOVERY',frozen:null,
   action:!next.length?'PIVOT_TO_REFERENCE_MODEL_AUDIT':active.some(m=>retired.includes(m))?'RETIRE_AND_REALLOCATE':hasConflict?'IMPROVE_ROBUSTNESS_TEST':qualified.length?'RETAIN_AND_REPLICATE':'IMPROVE_ALLOCATION'};
}
module.exports={SPECS,hash,score,key,single,transform,compile,compare,evaluateModes,evidence,chooseNext};
