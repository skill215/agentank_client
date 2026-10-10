'use strict';
const assert=require('node:assert/strict');
const previous=require('./continuous-improvement-design');
const SPECS=Object.freeze({baseline:{track:'reference'},R29:{track:'reference'},
 quiescence:{track:'quality',hypothesis:'Replicate the previously promising one-ply instability extension on new terrain.'},
 'bomb-quiescence':{track:'quality',hypothesis:'Limit extension to imminent bombs, avoiding remote projectile horizon work.'},
 'R29-quiescence':{track:'quality',hypothesis:'Combine path streak repair with the same bounded extension; compare against both parents.'},
 'urgent-quiescence':{track:'quality',hypothesis:'If a first mechanism retires, extend imminent bombs and projectile escape slack <=1 only.'}});
function compile(root){const built=previous.compile(root),pathOnly=require('./adaptive-optimization-design').compile(root);
 return {install(engine,mode,bot,audit,shadow){assert.ok(SPECS[mode]);built.install(engine,mode==='R29-quiescence'||mode==='urgent-quiescence'?'quiescence':mode,bot,audit,shadow);
  if(mode==='R29-quiescence')pathOnly.install(engine,'R29');
  if(mode==='urgent-quiescence'){const s=engine.basePolicy.policySearch;s.eventInstabilityMask=state=>previous.instability(s,state,true)|
   ((s.leafEvaluator.projectileThreat(state,0)>=10000||s.leafEvaluator.projectileThreat(state,1)>=10000)?1:0);}
 }};
}
function evaluateModes(rows,modes,role='validation',strict=false){const output={};for(const mode of modes){output[mode]={};for(const env of ['original','event']){
 const candidate=rows.filter(r=>r.job.mode===mode&&r.job.env===env&&(role==='all'||r.job.role===role)),keys=new Set(candidate.map(previous.key));
 output[mode][env]=previous.compare(rows.filter(r=>r.job.mode==='baseline'&&keys.has(previous.key(r))),candidate,strict?.05/120:.025,strict?6000:2000);
 }}return output;}
function evidence(summary,batches,mode){const e=previous.evidence(summary,batches,mode),v=Object.values(summary),cost=v.some(x=>x.transitionRatio>1.25||x.nodeRatio>1.25);
 const futile=e.minMaps>=72&&v.every(x=>x.hi<.02),strong=e.strong&&!cost&&v.every(x=>x.mean>=.02);
 return {...e,strong,retire:e.retire||cost||futile,status:cost?'COST_REJECTED':futile?'PRACTICAL_GAIN_FUTILITY':strong?'LOCAL_SUPPORTED':e.strong?'BELOW_PRACTICAL_GAIN':e.status};}
function domainSupport(summary){return Object.values(summary).every(envs=>Object.values(envs).every(x=>x.maps>=24&&x.mean>=.02&&x.lo>0&&x.deathDelta<=0&&x.doubleLossDelta<=0&&x.nodeRatio<=1.25&&x.transitionRatio<=1.25));}
function duplicates(history,modes){const out=[];for(let j=1;j<modes.length;j++)for(let i=0;i<j;i++){
 const a=modes[i],b=modes[j],left=new Map(history.filter(r=>r.job.mode===a&&r.job.role==='discovery').map(r=>[previous.key(r),r]));
 const right=history.filter(r=>r.job.mode===b&&r.job.role==='discovery'&&left.has(previous.key(r)));const maps=new Set(right.map(r=>r.matchUrlId)).size;
 if(maps>=12&&right.every(r=>previous.signature(r)===previous.signature(left.get(previous.key(r))))){const lc=right.reduce((n,r)=>n+left.get(previous.key(r)).audit.transitions,0),rc=right.reduce((n,r)=>n+r.audit.transitions,0);out.push({keep:lc<=rc?a:b,retire:lc<=rc?b:a,maps});}
 }return out;}
function chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen=null,supports={}){
 if(batch>=7)return previous.chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen,supports);
 const eligible=m=>(supports[m]?.maps||0)>=24&&(supports[m]?.batches||0)>=2,next=active.filter(m=>!retired.includes(m));
 if(next.length<3&&!seen.includes('urgent-quiescence'))next.push('urgent-quiescence');
 return {active:next,frozen:null,phase:next.length?'DISCOVERY':'REFERENCE_AUDIT',action:!next.length?'PIVOT_TO_REFERENCE_MODEL_AUDIT':active.some(m=>retired.includes(m))?'RETIRE_AND_REALLOCATE':active.some(m=>!eligible(m))?'BUILD_MINIMUM_SUPPORT':'RETAIN_AND_REPLICATE'};
}
module.exports={...previous,SPECS,compile,evaluateModes,evidence,domainSupport,duplicates,chooseNext};
