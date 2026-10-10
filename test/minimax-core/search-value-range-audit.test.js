'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runCase}=require('../../tools/agentank/diagnostics/search-value-range-audit');
test('production MIN preserves scores above its uncomputed-slot sentinel',()=>{
 assert.equal(runCase('worstReply',[100000,100000]).value,100000);
 assert.equal(runCase('worstReply',[100000,100000],2000,true).value,100000);
});
test('production MAX returns a real losing child rather than its initial sentinel',()=>{
 assert.equal(runCase('policyValue',[-100000,-60000]).value,-60000);
 assert.equal(runCase('policyValue',[-100000,-60000],2000,true).value,-60000);
});
test('scalar sentinel experiment matches independent pure/robust reducers on legal terminal magnitudes',()=>{
 const pool=[-100000,-60000,-32000,0,32000,60000,100000];
 for(const a of pool)for(const b of pool)for(const blend of [0,2000,10000]){
  const worst=Math.min(a,b),mean=Math.trunc((a+b)/2);
  for(const mode of [false,true]){
   assert.equal(runCase('worstReply',[a,b],blend,mode).value,worst+Math.trunc((mean-worst)*blend/10000));
   assert.equal(runCase('policyValue',[a,b],blend,mode).value,Math.max(a,b));
  }
 }
});
test('ordinary values and empty-domain fallback unchanged by scalar experiment',()=>{
 for(const method of ['worstReply','policyValue'])for(const values of [[],[-100,200],[0,0]])
  assert.deepEqual(runCase(method,values),runCase(method,values,2000,true));
});
