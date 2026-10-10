'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicyActionOwner}=require('../../engine-v2/src/base-policy-specialized/action-owner');
const {ROOT_CONTROL_MODE}=require('../../engine-v2/src/runtime/root-control-mode');
const {ARRAY}=require('../../engine-v2/src/state/fast-state');
const {NONE_CELL}=require('../../engine-v2/src/abi/fast-codes');
const {routeDistance,firstDifference}=require('../../tools/agentank/diagnostics/admission-navigation-audit');
test('diagnostic reproduces existing source-to-intent coupling without asserting it is desirable',()=>{
 const events=[],stop=new Error('INTENT_REACHED'),owner=new NativeBasePolicyActionOwner({intent:{observeContext(){events.push('context');},prepare(){events.push('intent');throw stop;}},policySearch:{observeRoot(){events.push('root');}},opponentHistory:{observe(){events.push('history');}}});
 const engine={adapter:{enemyVisible:true},lastControlMode:ROOT_CONTROL_MODE.TACTICAL_CONTACT,ourCount:1,ourActions:new Uint8Array([1])};
 owner.source=()=>{events.push('source');return null;};assert.equal(owner.selectOverride(engine,0,1),null);assert.deepEqual(events,['history','context','root','source']);
 events.length=0;owner.source=()=>{events.push('source');return {};};assert.throws(()=>owner.selectOverride(engine,0,1),e=>e===stop);assert.deepEqual(events,['history','context','root','source','intent']);
});
test('diagnostic route metric respects static obstacles and unknown targets',()=>{
 const state={width:3,height:2,cells:6,arrays:[]};state.arrays[ARRAY.TERRAIN]=new Uint8Array([0,1,0,0,0,0]);assert.equal(routeDistance(state,0,2),4);assert.equal(routeDistance(state,0,NONE_CELL),null);state.arrays[ARRAY.TERRAIN][3]=2;assert.equal(routeDistance(state,0,2),null);
 assert.equal(firstDifference(Buffer.from([1,2]).toString('base64'),Buffer.from([1,3]).toString('base64')),1);
});
