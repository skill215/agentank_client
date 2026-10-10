'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reflect}=require('../../tools/agentank/diagnostics/early-turn-value-audit');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {NativeBasePolicyLeafEvaluator:Leaf}=require('../../engine-v2/src/base-policy-specialized/policy-leaf');
test('horizontal reflection is an involution preserving entity identity and status',()=>{
 const s=new FastState(9,7);s.arrays[ARRAY.TANK_CELL].set([10,48]);s.arrays[ARRAY.TANK_DIR].set([1,3]);s.arrays[ARRAY.TANK_STARS].set([2,1]);
 s.arrays[ARRAY.PROJECTILE_ACTIVE][0]=1;s.arrays[ARRAY.PROJECTILE_CELL][0]=22;s.arrays[ARRAY.PROJECTILE_DIR][0]=1;s.arrays[ARRAY.PROJECTILE_ID][0]=99;
 s.arrays[ARRAY.BOMB_ACTIVE][0]=1;s.arrays[ARRAY.BOMB_CELL][0]=31;s.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]=17;
 const m=reflect(s),again=reflect(m);for(let i=0;i<s.arrays.length;i++)assert.deepEqual(again.arrays[i],s.arrays[i]);
 assert.equal(m.arrays[ARRAY.TANK_CELL][0],16);assert.equal(m.arrays[ARRAY.TANK_DIR][0],3);assert.equal(m.arrays[ARRAY.PROJECTILE_ID][0],99);m.arrays[ARRAY.TANK_STARS][0]=9;assert.equal(s.arrays[ARRAY.TANK_STARS][0],2);
});
test('leaf geometric components preserve horizontal symmetry across facing combinations',()=>{
 const s=new FastState(9,7);s.arrays[ARRAY.TANK_CELL].set([20,24]);s.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]=40;
 for(let own=0;own<4;own++)for(let enemy=0;enemy<4;enemy++){
  s.arrays[ARRAY.TANK_DIR].set([own,enemy]);const a=new Leaf(),b=new Leaf(),m=reflect(s);a.beginRoot(s);b.beginRoot(m);
  assert.equal(a.evaluate(s),b.evaluate(m));assert.deepEqual(a.lastComponents,b.lastComponents);
 }
});
