'use strict';
const STATUS=Object.freeze({COMPLETED:1,INCOMPLETE_SUPPORT:2,BUDGET_INTERRUPTED:3,ADMISSION_REJECTED:4});
const NAMES=['','COMPLETED','INCOMPLETE_SUPPORT','BUDGET_INTERRUPTED','ADMISSION_REJECTED'];
class FixedLayerScheduler {
 constructor(){
  this.work=new Uint32Array(4);this.status=new Uint8Array(4);this.evidence=new Array(4).fill(null);
  this.exhausted=Symbol('fixed-layer-budget');this.spend=this.consume.bind(this);
  this.execute=this.runDiagnostic.bind(this);this.active=0;this.used=0;this.limit=0;
  this.count=0;this.completedDepth=0;this.committed=null;
 }
 consume(){if(this.used>=this.limit)throw this.exhausted;this.used++;}
 run(limit,maximumDepth,evaluate,admit=null){
  if(this.active)throw Error('SCHEDULER_REENTRY');
  if(!Number.isSafeInteger(limit)||limit<0||limit>0xffffffff||!Number.isInteger(maximumDepth)||maximumDepth<0||maximumDepth>4)
   throw Error('INVALID_FIXED_BUDGET');
  this.active=1;this.used=0;this.limit=limit;this.count=0;this.completedDepth=0;this.committed=null;
  this.work.fill(0);this.status.fill(0);this.evidence.fill(null);let previous=0,last=0;
  try{for(let depth=1;depth<=maximumDepth;depth++){
   const index=depth-1;
   if(admit&&!admit(previous,last,limit-this.used)){this.status[index]=STATUS.ADMISSION_REJECTED;this.count=depth;break;}
   const before=this.used;
   try{const result=evaluate(depth,this.spend);this.work[index]=this.used-before;this.count=depth;
    this.evidence[index]=result?.evidence||null;
    if(!result?.complete){this.status[index]=STATUS.INCOMPLETE_SUPPORT;break;}
    this.status[index]=STATUS.COMPLETED;this.committed=result.value;this.completedDepth=depth;
    previous=last;last=this.work[index];
   }catch(error){if(error!==this.exhausted)throw error;
    this.work[index]=this.used-before;this.status[index]=STATUS.BUDGET_INTERRUPTED;this.count=depth;break;}
  }}finally{this.active=0;}
  return this;
 }
 // Allocating reporter is explicitly outside the fixed control core.
 diagnostic(){const attempts=[];for(let i=0;i<this.count;i++){
  const row={depth:i+1,work:this.work[i],status:NAMES[this.status[i]]};
  if(this.status[i]===STATUS.COMPLETED||this.status[i]===STATUS.INCOMPLETE_SUPPORT)row.evidence=this.evidence[i];
  attempts.push(row);
 }return {used:this.used,completedDepth:this.completedDepth,committed:this.committed,attempts};}
 runDiagnostic(limit,maximumDepth,evaluate,admit){this.run(limit,maximumDepth,evaluate,admit);return this.diagnostic();}
}
module.exports={FixedLayerScheduler,STATUS};
