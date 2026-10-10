"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {NativeBasePolicyLeafEvaluator}=require('../../engine-v2/src/base-policy-specialized/policy-leaf');
const {ProjectileFeatureCache}=require('../../tools/agentank/diagnostics/projectile-feature-cache');
function setup(){const state=new FastState(9,9);state.arrays[ARRAY.TANK_CELL].set([20,24]);state.arrays[ARRAY.TANK_DIR].set([1,3]);
  const leaf=new NativeBasePolicyLeafEvaluator();leaf.beginRoot(state);return {state,leaf,cache:new ProjectileFeatureCache(state,1)};}
test('forced hash collision cannot return stale feature across dependencies',()=>{
  const {state,leaf,cache}=setup(),compute=leaf.projectileThreat;
  const read=()=>cache.evaluate(state,0,compute,leaf,true);
  read();read();assert.equal(cache.hits,1);
  for(const field of [ARRAY.TANK_CELL,ARRAY.TANK_DIR,ARRAY.TANK_BOOST_UNTIL,ARRAY.PROJECTILE_ACTIVE,
    ARRAY.PROJECTILE_OWNER,ARRAY.PROJECTILE_CELL,ARRAY.PROJECTILE_DIR]){
    const before=cache.misses;state.arrays[field][0]^=1;read();assert.equal(cache.misses,before+1);state.arrays[field][0]^=1;read();}
  let before=cache.misses;state.arrays[ARRAY.TERRAIN][40]=1;read();assert.equal(cache.misses,before+1);
  before=cache.misses;state.arrays[ARRAY.SCALAR][SCALAR.FRAME]++;read();assert.equal(cache.misses,before+1);
});
test('owner and dimensions are part of exact feature identity',()=>{
  const {state,leaf,cache}=setup();const compute=leaf.projectileThreat;
  cache.evaluate(state,0,compute,leaf);cache.evaluate(state,1,compute,leaf);assert.equal(cache.misses,2);
  const other=new FastState(3,27);other.arrays[ARRAY.TANK_CELL].set([3,12]);leaf.beginRoot(other);
  cache.evaluate(other,1,compute,leaf,true);assert.equal(cache.misses,3);
});
