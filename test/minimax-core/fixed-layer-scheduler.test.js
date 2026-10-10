'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FixedLayerScheduler}=require('../../tools/agentank/diagnostics/fixed-layer-scheduler');
const {completeLayers}=require('../../tools/agentank/diagnostics/complete-layer-scheduler');
test('fixed control matches allocating oracle across budgets, failures and admission',()=>{
 const fixed=new FixedLayerScheduler(),spend=fixed.spend,work=fixed.work,status=fixed.status;
 for(let budget=0;budget<=25;budget++)for(let fail=0;fail<=4;fail++)for(const deny of [false,true]){
  const evaluate=(depth,tick)=>{for(let i=0;i<depth*2;i++)tick();return {complete:depth!==fail,value:depth,evidence:depth};};
  const admit=deny?(previous)=>previous===0:null;
  assert.deepEqual(fixed.runDiagnostic(budget,4,evaluate,admit),completeLayers(budget,4,evaluate,admit));
 }
 assert.equal(fixed.spend,spend);assert.equal(fixed.work,work);assert.equal(fixed.status,status);
});
test('unknown errors propagate and the instance can be reused without stale results',()=>{
 const fixed=new FixedLayerScheduler(),error=Error('unknown');
 assert.throws(()=>fixed.run(10,2,()=>{throw error;}),e=>e===error);assert.equal(fixed.active,0);
 assert.throws(()=>fixed.run(10,2,()=>fixed.run(1,1,()=>null)),/REENTRY/);
 const r=fixed.run(0,1,(_d,spend)=>{spend();});assert.equal(r.completedDepth,0);assert.equal(r.committed,null);
 assert.equal(r.used,0);assert.equal(r.count,1);assert.equal(r.evidence[0],null);
});
