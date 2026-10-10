'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {snapshot,restore,percentile,summarize,summarizeDepth}=require('../../tools/agentank/diagnostics/lattice-search-benchmark');
test('benchmark restoration preserves original typed-array identity and scalar state',()=>{
 const array=new Uint8Array([1,2]),object={array,alias:array,n:3,flag:true},saved=snapshot(object);
 object.array=new Uint8Array([9,9]);object.alias[0]=7;object.n=4;object.flag=false;restore(object,saved);
 assert.equal(object.array,array);assert.equal(object.alias,array);assert.deepEqual([...array],[1,2]);assert.equal(object.n,3);assert.equal(object.flag,true);
});
test('depth calibration separates completed cost from interrupted and schedule-capped work',()=>{
 const make=(protocol,completedDepth,attempts)=>({protocol,batches:Array.from({length:5},()=>({on:[{
   ms:2,requestedCap:3,completedDepth,used:10,attempts}]}))});
 const result=summarizeDepth([{measurements:[
   make('DEPTH_3',3,[{depth:3,work:10,status:'COMPLETED'}]),
   make('DEPTH_3',2,[{depth:2,work:4,status:'COMPLETED'},{depth:3,work:6,status:'BUDGET_INTERRUPTED'}]),
   make('DEPTH_3',2,[{depth:2,work:10,status:'COMPLETED'}]),
   make('DEPTH_3',1,[{depth:2,work:10,status:'INCOMPLETE_SUPPORT'}])]}]).DEPTH_3;
 assert.deepEqual(result.counts,{COMPLETED:1,BUDGET_INTERRUPTED:1,SCHEDULE_CAPPED:1,INCOMPLETE_SUPPORT:1});
 assert.equal(result.completedRequestedCap.samples,5);assert.equal(result.allAttempts.samples,20);
 assert.equal(result.workPerCohort,40);assert.equal(result.discardedWorkPerCohort,16);
});
test('P95 uses nearest-rank observations rather than average of batches',()=>{
 assert.equal(percentile(Array.from({length:20},(_,i)=>i+1),.95),19);
 assert.equal(percentile([9,1,2],.5),2);
});
test('five batches retain denominators and sum work independently of time',()=>{
 const samples=ms=>Array.from({length:3},()=>({ms,buildNodes:4}));
 const records=[{measurements:['CURRENT','COMPLETE_LAYER_3'].map(protocol=>({protocol,
  batches:Array.from({length:5},(_,batch)=>({batch,off:samples(2),on:samples(1)}))}))}];
 const result=summarize(records).CURRENT;assert.equal(result.off.samples,15);assert.equal(result.on.totalMs,15);
 assert.equal(result.totalRatio,.5);assert.equal(result.p95Ratio,.5);assert.equal(result.off.buildNodes,60);
 assert.equal(result.on.batches.length,5);
});
