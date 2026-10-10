'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {FixedSnapshot}=require('./search-transaction-workspace');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {SEARCH_CAPACITY}=require('../../../engine-v2/src/generated/search-config');
const {aggregate,choose}=require('./root-value-separation');
const windowRun=require('./worst-intent-window').run;
const {prepareLayered}=require('./native-complete-layer-poc');
function reorder(order,mode){if(mode==='IDENTITY')return order.slice();if(mode==='REVERSE')return order.slice().reverse();if(mode==='ROTATE')return order.slice(1).concat(order[0]);throw Error('UNKNOWN_ORDER');}
async function run(root,output){
 const layered=process.argv.includes('--layered');
 const prepare=S.prototype.prepare,pending=new WeakMap(),records=[];let rootNumber=0;
 if(!process.argv.includes('--adjacent-audit'))process.argv.push('--adjacent-audit');
 try{S.prototype.prepare=function(engine,count,eligibility){
  pending.delete(this);const state=engine.adapter.state,frame=state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  if(![15,16,21,22,23].includes(frame))return prepare.call(this,engine,count,eligibility);
  this.bindIsolatedHard(engine.adapter.bundle);
  const objects=[this,this.diagnosticKernel,this.diagnosticHard,this.leafEvaluator,this.pathUtility,state],snapshots=objects.map(o=>new FixedSnapshot(o));
  snapshots.forEach((s,i)=>s.capture(objects[i]));const physical=state.arrays.map(a=>a.slice());
  const oldH=this.diagnosticHazard,oldHH=this.diagnosticHard.hazard,oldIndex=this.rootColumnIndex,ownIndex=Object.hasOwn(this,'rootColumnIndex');
  const order=Array.from({length:engine.enemyCount},(_,i)=>oldIndex.call(this,i,engine.enemyCount)),variants=[];
  const restore=()=>{snapshots.forEach((s,i)=>s.restore(objects[i]));for(let i=0;i<physical.length;i++)assert.deepEqual(state.arrays[i],physical[i],'PHYSICAL_RESTORE');
   this.diagnosticHazard=oldH;this.diagnosticHard.hazard=oldHH;if(ownIndex)this.rootColumnIndex=oldIndex;else delete this.rootColumnIndex;};
  let referenceWork=0;
  try{for(const mode of layered?['IDENTITY','LAYER_IDENTITY','LAYER_REVERSE','LAYER_ROTATE']:['IDENTITY','REVERSE','ROTATE']){
   const changed=reorder(order,mode.replace('LAYER_','')),hazard=new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true});
   this.diagnosticHazard=hazard;this.diagnosticHard.hazard=hazard;this.rootColumnIndex=step=>changed[step];
   let ok,schedule=null,work=0;const kernel=this.diagnosticKernel,apply=kernel.applyFrame,ownApply=Object.hasOwn(kernel,'applyFrame');
   if(mode.startsWith('LAYER_')){schedule=prepareLayered(this,engine,count,eligibility,prepare,referenceWork,3);ok=schedule.completedDepth>0;work=schedule.used;assert.ok(work<=referenceWork);}
   else {kernel.applyFrame=function(...args){work++;return apply.apply(this,args);};try{ok=prepare.call(this,engine,count,eligibility);}finally{if(ownApply)kernel.applyFrame=apply;else delete kernel.applyFrame;}referenceWork=work;}
   variants.push({mode,ok,work,schedule:schedule?{completedDepth:schedule.completedDepth,attempts:schedule.attempts.map(a=>({depth:a.depth,work:a.work,status:a.status,evidence:a.evidence?{fastIncomplete:a.evidence.fastIncomplete,hardIncomplete:a.evidence.hardIncomplete,depthLeaves:a.evidence.depthLeaves}:null}))}:null,order:changed,scores:Array.from(this.rootScore),nominal:Array.from(this.rootNominalScore),cells:Array.from(this.rootCellScore),mask:Array.from(this.rootDomainMask),enemyMask:Array.from(this.rootEnemyDomainMask),nodes:this.nodes});
   restore();
  }}finally{restore();}
  const ok=prepare.call(this,engine,count,eligibility),identity=variants[0];assert.equal(ok,identity.ok);
  assert.deepEqual(Array.from(this.rootCellScore),identity.cells,'IDENTITY_CELLS');assert.deepEqual(Array.from(this.rootScore),identity.scores,'IDENTITY_SCORE');
  for(const v of variants)if(v.ok){assert.deepEqual(v.mask,Array.from(this.rootDomainMask));assert.deepEqual(v.enemyMask,Array.from(this.rootEnemyDomainMask));}
  pending.set(this,variants);return ok;
 };
 await windowRun(root,output,({owner,engine,rows,current,alternative,frame,id,seat})=>{
  const variants=pending.get(owner.policySearch);if(!variants)return;pending.delete(owner.policySearch);
  const s=owner.policySearch,state=engine.adapter.state,record={id,seat,frame,current:current.action,worstIntent:alternative.action,variants:[]};
  for(const v of variants){if(!v.ok){record.variants.push({mode:v.mode,work:v.work,schedule:v.schedule,current:null,worstIntent:null,rows:[]});continue;}
   const rr=rows.map(r=>{const values=[],weights=[];for(let c=0;c<engine.enemyCount;c++)if(v.enemyMask[c]){values.push(v.cells[r.row*SEARCH_CAPACITY.MAX_ENEMY_POLICIES+c]);weights.push(s.opponentWeight(engine,state,engine.enemyActions[c]));}
   const bonus=r.backed-r.blend;return {...r,...aggregate(values,weights),blend:v.scores[r.row],backed:v.scores[r.row]+bonus,nominal:v.nominal[r.row]+bonus};});
   const better=(a,b)=>owner.better(engine,a.row,b.row,a.backed,b.backed,a.nominal,b.nominal);let best=rr[0];for(const r of rr.slice(1))if(better(r,best))best=r;
   const worst=choose(rr,better,true);record.variants.push({mode:v.mode,work:v.work,schedule:v.schedule,order:v.order.filter(c=>v.enemyMask[c]).map(c=>engine.enemyActions[c]),nodes:v.nodes,current:best.action,worstIntent:worst.action,rows:rr});
  }
  assert.equal(record.variants[0].current,current.action);assert.equal(record.variants[0].worstIntent,alternative.action);records.push(record);rootNumber++;
 });
 }finally{S.prototype.prepare=prepare;}
 const overview={layered,roots:rootNumber,comparisons:records.length*(layered?3:2),currentChanged:0,worstIntentChanged:0,valueChanged:0,noCompleteLayer:0,records,
  notes:['Root column order only; recursive response order unchanged','Fresh diagnostic hazard per repetition; original arrays restored; identity replay exact','Proposals only; actual full trajectory remains BP326','No ACTIVE win-rate or performance claim']};
 for(const r of records)for(const v of r.variants.slice(1)){if(v.current===null){overview.noCompleteLayer++;continue;}overview.currentChanged+=v.current!==r.current;overview.worstIntentChanged+=v.worstIntent!==r.worstIntent;overview.valueChanged+=v.rows.some((x,i)=>x.blend!==r.variants[0].rows[i].blend);}
 fs.writeFileSync(path.join(output,'column-order.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify({...overview,records:undefined},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={reorder};
