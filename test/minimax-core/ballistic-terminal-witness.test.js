'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY:A,SCALAR:S}=require('../../engine-v2/src/state/fast-state');
const {TERRAIN}=require('../../engine-v2/src/abi/fast-codes');
const {inspectBallisticWitness:inspect,witnessSupports}=require('../../tools/agentank/diagnostics/ballistic-terminal-witness');
function make(){const s=new FastState(7,5),a=s.arrays;a[A.SCALAR][S.FRAME]=10;a[A.TANK_STARS][0]=1;a[A.TANK_CELL][0]=s.cell(1,2);a[A.TANK_CELL][1]=s.cell(3,2);a[A.PROJECTILE_ACTIVE][0]=1;a[A.PROJECTILE_OWNER][0]=0;a[A.PROJECTILE_CREATED][0]=10;a[A.PROJECTILE_CELL][0]=s.cell(1,2);a[A.PROJECTILE_DIR][0]=1;return s;}
test('ballistic witness requires emitted fresh shot and positive post-action margin',()=>{const s=make();assert.equal(inspect(s),'FRESH_SHOT_CLEAR_HIT');s.arrays[A.TANK_CRASH][0]=1;assert.equal(inspect(s),'FRESH_SHOT_CLEAR_HIT');s.arrays[A.TANK_STARS][1]=1;assert.equal(inspect(s),'NONPOSITIVE_SETTLEMENT_MARGIN');});
test('shield, deadline, missing shot, range, walls and dirt prevent ballistic witness',()=>{
 const cases=[s=>{s.arrays[A.TANK_SHIELD_UNTIL][1]=20;s.arrays[A.TANK_SHIELD_HITS][1]=2;},s=>{s.arrays[A.BOMB_ACTIVE][0]=1;s.arrays[A.BOMB_EXPLODE][0]=10;},s=>{s.arrays[A.PROJECTILE_CREATED][0]=9;},s=>{s.arrays[A.TANK_CELL][1]=s.cell(5,2);},s=>{s.arrays[A.TERRAIN][s.cell(2,2)]=TERRAIN.WALL;},s=>{s.arrays[A.TERRAIN][s.cell(2,2)]=TERRAIN.DIRT;}];for(const change of cases){const s=make();change(s);assert.equal(witnessSupports(inspect(s)),false);}
});
test('extra enemy projectiles do not change the geometric witness; no mutation',()=>{const s=make(),a=s.arrays;for(let i=1;i<16;i++){a[A.PROJECTILE_ACTIVE][i]=1;a[A.PROJECTILE_OWNER][i]=1;a[A.PROJECTILE_CELL][i]=s.cell(0,2);a[A.PROJECTILE_DIR][i]=1;}const before=a.map(x=>Array.from(x));assert.equal(inspect(s),'FRESH_SHOT_CLEAR_HIT');assert.deepEqual(a.map(x=>Array.from(x)),before);});
