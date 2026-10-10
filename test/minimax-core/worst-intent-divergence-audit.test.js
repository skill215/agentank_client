'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify,verifyPrefix}=require('../../tools/agentank/diagnostics/worst-intent-divergence-audit');
test('audit separates raw dominance from intent and exact-block semantics',()=>{
 const r=classify({current:1,alternative:3,rows:[{action:1,worst:619,expected:1395,backed:871,blend:871,block:11},{action:3,worst:537,expected:725,backed:748,blend:598,block:9}]});
 assert.equal(r.currentDominatesAlternative,true);assert.equal(r.deltaWorst,-82);assert.equal(r.deltaAdjustedWorst,68);
 assert.deepEqual(r.alternativeBlocks,['BUDGET','DEPTH_LEAF']);assert.equal(r.actionClass,'MOVEMENT_OR_ORIENTATION');
});
test('audit refuses unrelated trajectories and frame associations',()=>{
 const m=(own,enemy)=>({candidate:{compactActionStream:Buffer.from(own).toString('base64')},control:{compactActionStream:Buffer.from(enemy).toString('base64')}});
 const a=m([1,4],[2,2]),b=m([1,1],[2,3]),r={frame:1,current:4,alternative:1};assert.equal(verifyPrefix(a,b,r),1);
 assert.throws(()=>verifyPrefix(a,m([1,1],[3,3]),r),/OPPONENT_PREFIX/);
 assert.throws(()=>verifyPrefix(a,b,{...r,frame:0}),/ROOT_FRAME_ASSOCIATION/);
});
