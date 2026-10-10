'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rank}=require('../../tools/agentank/diagnostics/uniform-weight-shadow');
const {NativeBasePolicyActionOwner}=require('../../engine-v2/src/base-policy-specialized/action-owner');
test('shadow owner ranking preserves membership, intent adjustment and production tie rules',()=>{
 const owner=new NativeBasePolicyActionOwner(),engine={ourActions:[1,4,2]};
 owner.allowedRow.set([1,1,0]);const scores=[100,200,100000],adj=[150,0,0];
 assert.equal(rank(owner,engine,scores,scores,adj,3),0);
 assert.equal(rank(owner,engine,[100,300,100000],[100,300,100000],adj,3),1);
 assert.equal(rank(owner,engine,[10,10,999],[10,10,999],[0,0,0],3),0);
 assert.deepEqual(scores,[100,200,100000]);assert.deepEqual(adj,[150,0,0]);
});
