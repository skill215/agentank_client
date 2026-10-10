'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../../tools/agentank/diagnostics/completed-layer-design'),S=require('../../tools/agentank/diagnostics/completed-layer-scenarios');
const counters=()=>({snapshotAllocatedBytes:0,snapshotCopiedBytes:0,completedRoots:0,layerAttempts:0,discardedBudgetLeaves:0,layerRollbacks:0,layerCommits:0,committedDepthSum:0,workOverTargetRoots:0});
function mock(force=false){const s={nodes:0,currentDepth:0,rootScore:new Int32Array(2),lastBudgetLeafCount:0,lastFastIncompleteCount:0,lastHardIncompleteCount:0,iterationBudgetInterrupted:0,scalar:7},audit=counters(),bot={};
 const prepare=function(){this.currentDepth=this.layerDepth;this.rootScore.fill(this.layerDepth*10);this.scalar=this.layerDepth;this.nodes=this.layerDepth===1?5:this.layerDepth===2?30:this.layerBudget;this.iterationBudgetInterrupted=this.layerDepth===3?1:0;this.lastBudgetLeafCount=this.iterationBudgetInterrupted;return 1;};
 D.installIterations(s,prepare,bot,audit,force);return {s,audit,bot};}
test('interrupted third layer restores the complete second matrix while accounting attempted work',()=>{
 const {s,audit,bot}=mock();assert.equal(s.prepare(),1);assert.deepEqual(Array.from(s.rootScore),[20,20]);assert.equal(s.scalar,2);assert.equal(s.currentDepth,2);assert.equal(s.nodes,128);
 assert.equal(audit.layerCommits,1);assert.equal(audit.layerRollbacks,1);assert.equal(audit.discardedBudgetLeaves,1);assert.equal(bot.searchEvidenceCurrent,true);
});
test('forced rollback discards a complete deeper layer and preserves shallow state',()=>{
 const {s,audit}=mock(true);s.prepare();assert.deepEqual(Array.from(s.rootScore),[10,10]);assert.equal(s.currentDepth,1);assert.equal(s.scalar,1);assert.equal(audit.layerCommits,0);assert.equal(s.nodes,35);
 const bytes=audit.snapshotAllocatedBytes;s.prepare();assert.equal(audit.snapshotAllocatedBytes,bytes);
});
test('a completed shallow matrix exhausting target prevents any deeper attempt',()=>{
 const s={nodes:0,currentDepth:0,rootScore:new Int32Array(1)},audit=counters(),bot={};let calls=0;
 D.installIterations(s,function(){calls++;this.nodes=129;this.currentDepth=1;this.rootScore[0]=77;return 1;},bot,audit);
 s.prepare();assert.equal(calls,1);assert.equal(audit.layerAttempts,0);assert.equal(audit.workOverTargetRoots,1);assert.equal(s.rootScore[0],77);
});
test('compiled budget guards do not alter production prototype',()=>{
 const C=require('../../engine-v2/src/base-policy-specialized/policy-search').NativeBasePolicySearch;const before=C.prototype.policyValue.toString(),built=D.compile(process.cwd());
 assert.notEqual(built.methods.policyValue.toString(),before);assert.equal(C.prototype.policyValue.toString(),before);
});
test('R29 combination requires parent support and both-environment positive means',()=>{
 const args=[2,['completed-layer'],{'completed-layer':{worstMean:.01}},[],['completed-layer'],{},[],null,{'completed-layer':{maps:24,batches:2}}];
 assert.deepEqual(D.chooseNext(...args).active,['completed-layer','R29-completed-layer']);args[2]['completed-layer'].worstMean=0;assert.deepEqual(D.chooseNext(...args).active,['completed-layer']);
});
test('last historical reserve is isolated and remains confined to confirmation',()=>{
 const {selected,remainingHistorical}=S.select(process.cwd());assert.equal(selected.length,300);assert.equal(remainingHistorical,0);assert.equal(selected.filter(s=>s.origin==='historical').length,24);
 assert.equal(new Set(selected.map(s=>D.hash(JSON.stringify(s.map)))).size,300);assert.ok(selected.slice(0,210).every(s=>s.origin==='synthetic'));
 for(let i=210;i<300;i+=3)assert.deepEqual(selected.slice(i,i+3).map(s=>s.origin),i<282?['historical','synthetic','synthetic']:['synthetic','synthetic','synthetic']);
});
