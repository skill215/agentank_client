'use strict';
// Development result-commit storage. Scratch stacks/history are deliberately excluded.
const RESULT_ARRAYS=Object.freeze(['rootScore','rootNominalScore','rootCellScore','rootNominalCellScore',
 'rootTradeClass','rootDomainMask','rootEnemyDomainMask','rootColumnSequence','rootColumnUsed',
 'rowExactBlockMask','rowExactBlockMaskCount']);
class SearchCommitSlab {
 constructor(search){
  this.keys=RESULT_ARRAYS;this.buffers=this.keys.map(k=>{
   if(!ArrayBuffer.isView(search[k]))throw Error(`MISSING_COMMIT_FIELD:${k}`);
   return new search[k].constructor(search[k].length);});
  // Preserve diagnostic scalar counters as well as consumer-visible flags; no narrowing.
  this.scalarKeys=Object.keys(search).filter(k=>typeof search[k]==='number'||typeof search[k]==='boolean');
  this.scalarBoolean=this.scalarKeys.map(k=>typeof search[k]==='boolean');
  this.scalars=new Float64Array(this.scalarKeys.length);this.valid=0;this.captures=0;
  this.bytes=this.scalars.byteLength+this.buffers.reduce((s,b)=>s+b.byteLength,0);
 }
 capture(search){
  for(let i=0;i<this.keys.length;i++)this.buffers[i].set(search[this.keys[i]]);
  for(let i=0;i<this.scalarKeys.length;i++)this.scalars[i]=search[this.scalarKeys[i]];
  this.valid=1;this.captures++;
 }
 restore(search){
  if(!this.valid)throw Error('NO_COMMITTED_LAYER');
  for(let i=0;i<this.keys.length;i++)search[this.keys[i]].set(this.buffers[i]);
  for(let i=0;i<this.scalarKeys.length;i++)search[this.scalarKeys[i]]=this.scalarBoolean[i]?Boolean(this.scalars[i]):this.scalars[i];
 }
}
module.exports={SearchCommitSlab,RESULT_ARRAYS};
