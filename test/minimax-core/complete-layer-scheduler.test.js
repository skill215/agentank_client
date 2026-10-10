"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {completeLayers}=require('../../tools/agentank/diagnostics/complete-layer-scheduler');
test('matrix layer commitment is order invariant for every interruption boundary',()=>{
 const orders=[[0,1,2,3,4,5],[5,4,3,2,1,0],[2,3,4,5,0,1]];
 for(let budget=0;budget<=90;budget++){
  const outcomes=orders.map(order=>completeLayers(budget,3,(depth,spend)=>{
   const matrix=new Int32Array(6);
   for(const cell of order){for(let n=0;n<depth*(1+cell%3);n++)spend();matrix[cell]=depth*100+cell;}
   return {complete:true,value:Array.from(matrix)};
  }));
  for(const o of outcomes){assert.ok(o.used<=budget);assert.equal(o.completedDepth,outcomes[0].completedDepth);assert.deepEqual(o.committed,outcomes[0].committed);}
 }
});
test('incomplete deeper layer cannot overwrite last completed matrix',()=>{
  const r=completeLayers(5,3,(depth,spend)=>{for(let i=0;i<depth*2;i++)spend();return {complete:true,value:[depth,depth]};});
  assert.equal(r.used,5);assert.equal(r.completedDepth,1);assert.deepEqual(r.committed,[1,1]);
  assert.equal(r.attempts[1].status,'BUDGET_INTERRUPTED');
});
test('zero and first-layer-short budget produce no publishable value',()=>{
  for(const limit of [0,1]){const r=completeLayers(limit,2,(_depth,spend)=>{spend();spend();return {complete:true,value:123};});
    assert.equal(r.used,limit);assert.equal(r.completedDepth,0);assert.equal(r.committed,null);}
});
test('exact boundary commits a full layer and next attempt cannot consume extra work',()=>{
  const r=completeLayers(4,2,(depth,spend)=>{for(let i=0;i<4;i++)spend();return {complete:true,value:depth};});
  assert.equal(r.used,4);assert.equal(r.committed,1);assert.equal(r.attempts[1].work,0);
});
test('physical incomplete layer is not published even with remaining budget',()=>{
  const r=completeLayers(100,3,(depth,spend)=>{spend();return {complete:depth===1,value:depth};});
  assert.equal(r.completedDepth,1);assert.equal(r.used,2);assert.equal(r.committed,1);
  assert.equal(r.attempts[1].status,'INCOMPLETE_SUPPORT');
});
test('support failure evidence survives fallback independently from budget interruption',()=>{
  const evidence={fastIncomplete:1,hardIncomplete:0};
  const r=completeLayers(10,1,spare=>({complete:false,evidence}));
  assert.deepEqual(r.attempts[0].evidence,evidence);
  assert.equal(r.used,0);assert.equal(r.completedDepth,0);
});
test('cost sample is deterministic, outcome-stratified and unique per match seat',()=>{
  const {sampleRoots}=require('../../tools/agentank/diagnostics/native-complete-layer-poc');
  const matches=['V2_WIN','DRAW','V1_WIN'].flatMap((outcome,o)=>Array.from({length:4},(_,i)=>({
    analysisOutcome:outcome,matchUrlId:`m${o}-${i}`,scenarioFingerprint:`s${o}-${i}`,candidateSeat:i%2,
    candidateEngine:{rootFrames:[{frame:9,searchEvidenceCurrent:true},{frame:12,searchEvidenceCurrent:true},
      {frame:13,searchEvidenceCurrent:false}]}})));
  const a=sampleRoots(matches,2),b=sampleRoots([...matches].reverse(),2);
  assert.deepEqual(a,b);assert.equal(a.length,6);
  assert.equal(new Set(a.map(r=>`${r.matchUrlId}:${r.candidateSeat}`)).size,6);
  for(const outcome of ['V2_WIN','DRAW','V1_WIN'])assert.equal(a.filter(r=>r.baselineOutcome===outcome).length,2);
});
test('non-budget exceptions propagate and cleanup executes during budget interruption',()=>{
  assert.throws(()=>completeLayers(10,1,()=>{throw Error('real-error');}),/real-error/);
  let cleaned=0;
  completeLayers(1,1,(_depth,spend)=>{try{spend();spend();}finally{cleaned++;}});
  assert.equal(cleaned,1);
});
test('admission rejects before evaluation and preserves the committed value',()=>{
 const calls=[],inputs=[];
 const r=completeLayers(100,3,(depth,spend)=>{calls.push(depth);for(let i=0;i<depth*2;i++)spend();
  return {complete:true,value:`matrix-${depth}`};},(previous,last,remaining)=>{
   inputs.push([previous,last,remaining]);return previous===0;});
 assert.deepEqual(calls,[1,2]);assert.deepEqual(inputs,[[0,0,100],[0,2,98],[2,4,94]]);
 assert.equal(r.committed,'matrix-2');assert.equal(r.completedDepth,2);assert.equal(r.used,6);
 assert.deepEqual(r.attempts.at(-1),{depth:3,work:0,status:'ADMISSION_REJECTED'});
});
test('permissive admission exactly preserves old scheduler behavior',()=>{
 const evaluate=(depth,spend)=>{for(let i=0;i<depth;i++)spend();return {complete:true,value:depth};};
 assert.deepEqual(completeLayers(5,3,evaluate,()=>true),completeLayers(5,3,evaluate));
});
