"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {FastKernel,FAST_UNSUPPORTED_REASON,JOINT_RELOCATION_DETAIL}=require('../../engine-v2/src/fast/kernel');
const {HazardKernel}=require('../../engine-v2/src/fast/hazard');
const {ACTION,CHANCE,FAST_STATUS,TERRAIN}=require('../../engine-v2/src/abi/fast-codes');
function arena(cells,dirs,frame){const s=new FastState(19,15);s.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN,0,s.cells);
  s.arrays[ARRAY.TANK_CELL].set(cells);s.arrays[ARRAY.TANK_DIR].set(dirs);s.arrays[ARRAY.SCALAR][SCALAR.FRAME]=frame;return s;}
function rejectRestores(s,detail,chance0=CHANCE.NORMAL){s.initializeHash();const before=s.arrays.map(a=>Array.from(a));
  const hash=[s.hashLo,s.hashHi],kernel=new FastKernel(s,{stationaryOccupiedBlock:true});
  assert.equal(kernel.applyFrame(ACTION.GO,0,ACTION.GO,0,chance0,CHANCE.NORMAL),FAST_STATUS.UNSUPPORTED_RULE);
  assert.equal(kernel.failureReason,FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION);
  assert.equal(kernel.failureDetail,detail);
  assert.deepEqual(s.arrays.map(a=>Array.from(a)),before);assert.deepEqual([s.hashLo,s.hashHi],hash);
}
test('BP293 same-target GO/GO remains explicit unsupported and restores physical state',()=>{
  rejectRestores(arena([47,65],[3,0],60),JOINT_RELOCATION_DETAIL.OCCUPIED_AFTER_EARLIER_MOVE);
});
test('stun-affected vacating is not silently promoted to confirmed plain movement',()=>{
  const s=arena([146,147],[3,0],76);s.arrays[ARRAY.TANK_STUN_UNTIL].fill(80);
  rejectRestores(s,JOINT_RELOCATION_DETAIL.VACATE_NOT_STRICTLY_SUPPORTED,1);
});
test('hostile projectile hitting dirt makes negative narrow viability unknown, not death',()=>{
  const s=arena([127,70],[0,0],35),a=s.arrays;
  a[ARRAY.PROJECTILE_ACTIVE][0]=1;a[ARRAY.PROJECTILE_OWNER][0]=1;
  a[ARRAY.PROJECTILE_CELL][0]=s.cell(2,2);a[ARRAY.PROJECTILE_DIR][0]=1;
  a[ARRAY.TERRAIN][s.cell(4,2)]=TERRAIN.DIRT;s.initializeHash();
  const hazard=new HazardKernel(s);assert.equal(hazard.rebuild(0),1);
  assert.equal(hazard.narrowProofComplete,0);
  assert.equal(hazard.finalizeReverseResult(0,0),-1);
  assert.equal(hazard.finalizeReverseResult(1,0),1);
});
