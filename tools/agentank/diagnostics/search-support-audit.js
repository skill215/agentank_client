'use strict';
const {FAST_STATUS,HARD_STATUS}=require('../../../engine-v2/src/abi/fast-codes');
const {FAST_UNSUPPORTED_REASON,JOINT_RELOCATION_DETAIL}=require('../../../engine-v2/src/fast/kernel');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {classifyJointGeometry}=require('./joint-movement-rule-oracle');
function jointDetail(kernel){
 const a=kernel.state.arrays;
 const effect=seat=>['TANK_FROZEN_UNTIL','TANK_STUN_UNTIL','TANK_POISON_UNTIL','TANK_BOOST_UNTIL']
  .reduce((mask,key,index)=>mask|((kernel.active(a[ARRAY[key]][seat])?1:0)<<index),0);
 return {FIRST_FAST_START_CELL0:kernel.frameStartCell0,FIRST_FAST_START_CELL1:kernel.frameStartCell1,
  FIRST_FAST_PREPARED_TARGET0:kernel.preparedTarget0,FIRST_FAST_PREPARED_TARGET1:kernel.preparedTarget1,
  FIRST_FAST_EFFECT_MASK0:effect(0),FIRST_FAST_EFFECT_MASK1:effect(1)};
}
const name=(values,value)=>Object.keys(values).find(k=>values[k]===value)||String(value);
class SearchSupportAudit {
 constructor(search,thin){this.search=search;this.thin=thin;this.kernel=search.diagnosticKernel;this.hard=search.diagnosticHard;
  this.apply=this.applyFrame.bind(this);this.classify=this.classifyApplied.bind(this);this.active=false;}
 begin(){if(this.active)throw Error('AUDIT_REENTRY');this.active=true;this.counts={};this.witnesses=[];this.geometryCounts={};
  this.originalApply=this.kernel.applyFrame;this.originalClassify=this.hard.classifyApplied;
  this.kernel.applyFrame=this.apply;this.hard.classifyApplied=this.classify;}
 record(reason,a=null,detail=null){const key=`${this.thin.depth}:${reason}`;this.counts[key]=(this.counts[key]||0)+1;
  if(detail){const geometry=classifyJointGeometry(detail);this.geometryCounts[geometry]=(this.geometryCounts[geometry]||0)+1;}
  if(this.witnesses.length<2&&!this.witnesses.some(w=>w.reason===reason)){
   const state=this.kernel.state,arrays=state.arrays;
   this.witnesses.push({depth:this.thin.depth,reason,frame:arrays[ARRAY.SCALAR][SCALAR.FRAME],
    cells:Array.from(arrays[ARRAY.TANK_CELL]),directions:Array.from(arrays[ARRAY.TANK_DIR]),actions:a,
    ...(detail?{joint:detail,geometry:classifyJointGeometry(detail)}:{})});
  }}
 applyFrame(a,b,c,d,e,f){const status=this.originalApply.call(this.kernel,a,b,c,d,e,f);
  if(status!==FAST_STATUS.APPLIED&&status!==FAST_STATUS.APPLIED_TERMINAL)this.record(
   `FAST/${name(FAST_STATUS,status)}/${name(FAST_UNSUPPORTED_REASON,this.kernel.failureReason)}/${name(JOINT_RELOCATION_DETAIL,this.kernel.failureDetail)}`,[a,b,c,d,e,f],
   this.kernel.failureReason===FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION?jointDetail(this.kernel):null);
  return status;}
 classifyApplied(){const status=this.originalClassify.call(this.hard);
  if(status===HARD_STATUS.INCOMPLETE){const h=this.hard.hazard;this.record(
   `HARD/viable=${this.hard.lastViable}/complete=${h.complete}/narrow=${h.narrowProofComplete}`);}
  return status;}
 end(){if(!this.active)return;this.kernel.applyFrame=this.originalApply;this.hard.classifyApplied=this.originalClassify;this.active=false;}
}
function summarizeSupport(rows){const summarize=list=>{
 const groups={},geometryGroups={},unexplained=[];
 for(const r of list){const found=new Set();for(const [key,count] of Object.entries(r.support?.counts||{})){
  const reason=key.slice(key.indexOf(':')+1),group=groups[reason]||(groups[reason]={roots:0,events:0});group.events+=count;found.add(reason);}
  for(const reason of found)groups[reason].roots++;
  for(const [geometry,events] of Object.entries(r.support?.geometryCounts||{})){
   const g=geometryGroups[geometry]||(geometryGroups[geometry]={roots:0,events:0});g.roots++;g.events+=events;}
  if(!found.size)unexplained.push({id:r.id,seat:r.seat,frame:r.frame});
 }return {roots:list.length,groups,geometryGroups,unexplained};};
 return {allIncomplete:summarize(rows.filter(r=>r.stop===2)),noCompletedLayer:summarize(rows.filter(r=>r.depth===0))};
}
module.exports={SearchSupportAudit,summarizeSupport,jointDetail};
