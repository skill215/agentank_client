'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {predictNextLayer,auditRecord}=require('../../tools/agentank/diagnostics/layer-admission-shadow');
function record(attempts){return {id:'a',seat:0,frame:1,measurements:[{protocol:'DEPTH_3',batches:[{on:[{
 used:attempts.reduce((s,a)=>s+a.work,0),completedDepth:attempts.filter(a=>a.status==='COMPLETED').at(-1)?.depth||0,attempts}]}]}]};}
const layer=(depth,work,status='COMPLETED')=>({depth,work,status});
test('prediction uses only completed work and fits exact remaining boundary',()=>{
 assert.equal(predictNextLayer(10,100,1000).admit,true);assert.equal(predictNextLayer(10,100,999).admit,false);
 assert.equal(predictNextLayer(0,100,0).reason,'NO_GROWTH_HISTORY');
 assert.throws(()=>predictNextLayer(-1,1,1));assert.throws(()=>predictNextLayer(1,Number.MAX_SAFE_INTEGER,1));
});
test('future outcome cannot change admission; false negatives remain visible',()=>{
 const a=auditRecord(record([layer(1,10),layer(2,200),layer(3,3886,'BUDGET_INTERRUPTED')]));
 const b=auditRecord(record([layer(1,10),layer(2,200),layer(3,3000)]));
 assert.deepEqual(a.decisions,b.decisions);assert.equal(a.retainedDepth,2);assert.equal(b.retainedDepth,2);
 assert.equal(b.denied.observedStatus,'COMPLETED');
});
test('underestimated cost still interrupts and support failures are not budget diagnoses',()=>{
 const a=auditRecord(record([layer(1,18),layer(2,261),layer(3,3817,'BUDGET_INTERRUPTED')]));
 assert.equal(a.denied,null);assert.equal(a.keptWasted,3817);
 const b=auditRecord(record([layer(1,12),layer(2,137,'INCOMPLETE_SUPPORT')]));
 assert.equal(b.retainedDepth,1);assert.equal(b.denied,null);assert.equal(b.keptWasted,137);
});
