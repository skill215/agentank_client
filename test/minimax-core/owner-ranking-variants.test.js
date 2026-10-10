'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rank,SPECS}=require('../../tools/agentank/diagnostics/owner-ranking-variants');
const owner={},normal=(e,r,b,v,bv,n,bn)=>b<0||v>bv||v===bv&&n>bn?1:0;
const e={riskController:{outcome:{acceptable:[1,0]},strictlyDominates:(a,b)=>a===0&&b===1}};
test('owner ranking freezes ten independent hypotheses',()=>{assert.equal(SPECS.length,10);assert.equal(new Set(SPECS.map(x=>x.mode)).size,10);assert.equal(SPECS[0].id,'R91');assert.equal(SPECS.at(-1).id,'R100');});
test('dominance and strict acceptability precede score but initialize empty best safely',()=>{
 for(const rule of ['risk-dominance-first','risk-acceptable-first']){
  assert.equal(rank(rule,owner,normal,e,0,1,5,10,5,10,-1),1);
  assert.equal(rank(rule,owner,normal,e,1,0,10,5,10,5,-1),0);
  assert.equal(rank(rule,owner,normal,e,1,-1,5,10,5,10,-1),1);
 }
});
test('incumbent protection applies only on score ties and only to compared incumbent',()=>{
 const r=(row,best,v,bv,n,bn,inc)=>rank('incumbent-score-tie',owner,normal,e,row,best,v,bv,n,bn,inc);
 assert.equal(r(0,1,5,5,1,10,0),1);assert.equal(r(0,1,5,5,10,1,1),0);
 assert.equal(r(0,1,4,5,10,1,0),0);assert.equal(r(0,1,5,5,1,10,2),0);
});
test('nominal ablation preserves unequal main-score ordering',()=>{
 assert.equal(rank('no-nominal-tie',owner,normal,e,0,1,5,5,10,1,-1),0);
 assert.equal(rank('no-nominal-tie',owner,normal,e,0,1,6,5,0,100,-1),1);
});
test('bonus ablation changes scoring only and preserves owner eligibility structures',()=>{
 const {install}=require('../../tools/agentank/diagnostics/owner-ranking-variants');
 const allowed=new Uint8Array([1,0]),membership=new Uint8Array([5,2]);
 const o={allowedRow:allowed,membership,better:normal,intentAdjustment:r=>r===0?120:0,selectOverride(){return null;}};
 const engine={basePolicy:{owner:o,policySearch:{pathUtility:{scoreTransition:()=>-22,scoreAppliedTransition:()=>0}}}};
 const s=install(engine,'R15:no-intent-bonus');assert.equal(o.intentAdjustment(0),0);assert.equal(o.intentAdjustment(1),0);
 assert.equal(s.changedBonuses,1);assert.equal(s.mechanismChanges,1);assert.equal(o.allowedRow,allowed);assert.deepEqual([...membership],[5,2]);
 assert.equal(engine.basePolicy.policySearch.pathUtility.scoreTransition(null,2,0,1,0),-11);
});
