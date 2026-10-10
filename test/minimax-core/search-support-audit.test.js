'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeSupport,jointDetail}=require('../../tools/agentank/diagnostics/search-support-audit');
const {classifyJointGeometry}=require('../../tools/agentank/diagnostics/joint-movement-rule-oracle');
const {ARRAY}=require('../../engine-v2/src/state/fast-state');
const {NONE_CELL,NONE_FRAME}=require('../../engine-v2/src/abi/fast-codes');
test('joint geometry uses prepared targets, not partially moved tank cells; absent effects stay absent',()=>{
 const arrays=[];for(const key of ['TANK_FROZEN_UNTIL','TANK_STUN_UNTIL','TANK_POISON_UNTIL','TANK_BOOST_UNTIL'])arrays[ARRAY[key]]=new Uint16Array([NONE_FRAME,NONE_FRAME]);
 const k={state:{arrays},frameStartCell0:10,frameStartCell1:12,preparedTarget0:11,preparedTarget1:11,
  active:v=>v!==NONE_FRAME&&v>4};
 assert.equal(classifyJointGeometry(jointDetail(k)),'SAME_TARGET');
 k.preparedTarget0=12;k.preparedTarget1=10;
 assert.equal(classifyJointGeometry(jointDetail(k)),'DIRECT_SWAP');
 k.preparedTarget1=NONE_CELL;
 assert.equal(classifyJointGeometry(jointDetail(k)),'OTHER_PARTIAL_PREPARATION');
 arrays[ARRAY.TANK_STUN_UNTIL][1]=8;
 assert.equal(classifyJointGeometry(jointDetail(k)),'STUN_AFFECTED_PARTIAL_PREPARATION');
});
test('support summary counts overlapping reasons without counting depths as separate roots',()=>{
 const r=summarizeSupport([{id:'a',seat:0,frame:1,depth:0,stop:2,support:{counts:{'1:FAST/A':2,'2:FAST/A':3,'1:HARD/B':1}}},
 {id:'b',seat:0,frame:2,depth:1,stop:2,support:{counts:{}}}]);
 assert.deepEqual(r.allIncomplete.groups['FAST/A'],{roots:1,events:5});
 assert.equal(r.allIncomplete.roots,2);assert.equal(r.allIncomplete.unexplained.length,1);
 assert.equal(r.noCompletedLayer.roots,1);assert.equal(r.noCompletedLayer.groups['HARD/B'].roots,1);
});
test('geometry counts keep roots separate from repeated failure events',()=>{
 const r=summarizeSupport([{depth:0,stop:2,support:{counts:{'1:FAST/A':5},
  geometryCounts:{SAME_TARGET:3,STUN_AFFECTED_PARTIAL_PREPARATION:2}}}]);
 assert.deepEqual(r.noCompletedLayer.geometryGroups.SAME_TARGET,{roots:1,events:3});
 assert.deepEqual(r.noCompletedLayer.geometryGroups.STUN_AFFECTED_PARTIAL_PREPARATION,{roots:1,events:2});
 assert.equal(r.noCompletedLayer.roots,1);
});
