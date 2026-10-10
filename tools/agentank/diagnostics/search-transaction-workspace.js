'use strict';
class FixedSnapshot {
 constructor(object){
  this.arrayKeys=Object.keys(object).filter(k=>ArrayBuffer.isView(object[k]));
  this.arrays=this.arrayKeys.map(k=>new object[k].constructor(object[k].length));
  this.scalarKeys=Object.keys(object).filter(k=>typeof object[k]==='number'||typeof object[k]==='boolean');
  this.booleans=this.scalarKeys.map(k=>typeof object[k]==='boolean');this.scalars=new Float64Array(this.scalarKeys.length);
  this.bytes=this.arrays.reduce((s,a)=>s+a.byteLength,0)+this.scalars.byteLength;
 }
 capture(object){for(let i=0;i<this.arrayKeys.length;i++)this.arrays[i].set(object[this.arrayKeys[i]]);
  for(let i=0;i<this.scalarKeys.length;i++)this.scalars[i]=object[this.scalarKeys[i]];}
 restore(object){for(let i=0;i<this.arrayKeys.length;i++)object[this.arrayKeys[i]].set(this.arrays[i]);
  for(let i=0;i<this.scalarKeys.length;i++)object[this.scalarKeys[i]]=this.booleans[i]?Boolean(this.scalars[i]):this.scalars[i];}
}
const STATE_FIELDS=Object.freeze(['transitionDeltaBase','transitionEventBase','highWaterDelta','highWaterEvent']);
class SearchTransactionWorkspace {
 constructor(search,kernel,state){
  this.search=search;this.kernel=kernel;this.state=state;
  this.searchSnapshot=new FixedSnapshot(search);this.kernelSnapshot=new FixedSnapshot(kernel);
  this.stateArrays=state.arrays.map(a=>new a.constructor(a.length));this.metadata=new Float64Array(4);
  this.active=0;this.mark=0;this.hashLo=0;this.hashHi=0;
  this.bytes=this.searchSnapshot.bytes+this.kernelSnapshot.bytes+this.metadata.byteLength+this.stateArrays.reduce((s,a)=>s+a.byteLength,0);
 }
 begin(){if(this.active)throw Error('TRANSACTION_REENTRY');
  this.searchSnapshot.capture(this.search);this.kernelSnapshot.capture(this.kernel);
  for(let i=0;i<this.stateArrays.length;i++)this.stateArrays[i].set(this.state.arrays[i]);
  for(let i=0;i<STATE_FIELDS.length;i++)this.metadata[i]=this.state[STATE_FIELDS[i]];
  this.mark=this.state.deltaUsed*1024+this.state.eventUsed;this.hashLo=this.state.hashLo;this.hashHi=this.state.hashHi;this.active=1;
 }
 restoreSearch(){this.searchSnapshot.restore(this.search);}
 rollback(){
  if(!this.active)throw Error('NO_ACTIVE_TRANSACTION');
  this.state.undoTo(this.mark);for(let i=0;i<STATE_FIELDS.length;i++)this.state[STATE_FIELDS[i]]=this.metadata[i];
  this.kernelSnapshot.restore(this.kernel);
  if(this.state.hashLo!==this.hashLo||this.state.hashHi!==this.hashHi)throw Error('ROOT_HASH_RESTORE');
  for(let i=0;i<this.stateArrays.length;i++)for(let j=0;j<this.stateArrays[i].length;j++)
   if(this.state.arrays[i][j]!==this.stateArrays[i][j])throw Error('ROOT_ARRAY_RESTORE');
 }
 end(){this.active=0;}
}
module.exports={FixedSnapshot,SearchTransactionWorkspace};
