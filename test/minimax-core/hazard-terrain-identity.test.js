'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {HazardKernel}=require('../../engine-v2/src/fast/hazard');
const {TERRAIN,NONE_FRAME}=require('../../engine-v2/src/abi/fast-codes');
function setup(){
 const state=new FastState(9,9),a=state.arrays;a[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
 a[ARRAY.TERRAIN][state.cell(5,4)]=TERRAIN.DIRT;a[ARRAY.TERRAIN][state.cell(1,1)]=TERRAIN.DIRT;
 a[ARRAY.TANK_CELL][0]=state.cell(4,4);a[ARRAY.TANK_DIR][0]=1;
 a[ARRAY.TANK_BOOST_UNTIL].fill(NONE_FRAME);a[ARRAY.TANK_SKILL_READY].fill(NONE_FRAME);
 a[ARRAY.BOMB_ACTIVE][0]=1;a[ARRAY.BOMB_CELL][0]=state.cell(4,4);a[ARRAY.BOMB_EXPLODE][0]=3;
 state.initializeHash();return state;
}
function check(state,hazard){
 const oracle=new HazardKernel(state,{hazardSignatureCache:false});
 assert.equal(hazard.reverseViable(),oracle.reverseViable());
 assert.equal(hazard.horizonTick,oracle.horizonTick);
 assert.deepEqual(hazard.lethal,oracle.lethal);assert.deepEqual(hazard.exposure,oracle.exposure);
}
test('apply/undo siblings with equal versions preserve hazard and lattice truth',()=>{
 const s=setup(),h=new HazardKernel(s,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeLayerCache:true});
 check(s,h);const hashes=[s.hashLo,s.hashHi];
 for(const cell of [s.cell(1,1),s.cell(5,4),s.cell(1,1)]){
   const mark=s.beginTransition();assert.equal(s.write(ARRAY.TERRAIN,cell,TERRAIN.OPEN),1);
   assert.equal(s.write(ARRAY.SCALAR,SCALAR.TERRAIN_VERSION,1),1);check(s,h);
   s.undoTo(mark);assert.deepEqual([s.hashLo,s.hashHi],hashes);check(s,h);
 }
 assert.equal(h.terrainIdentityInvalidations,7);
});
test('layer lookup cannot return stale layers before rebuild',()=>{
 const s=setup(),h=new HazardKernel(s,{reverseLatticeCacheEntries:4,reverseLatticeLayerCache:true});
 h.reverseViable();const layers=[0,1,2].map(()=>new Uint8Array(s.cells*4));
 assert.equal(h.loadReverseLatticeLayers(0,...layers),1);
 s.arrays[ARRAY.TERRAIN][s.cell(5,4)]=TERRAIN.OPEN;s.initializeHash();
 assert.equal(h.loadReverseLatticeLayers(0,...layers),0);
 check(s,h);assert.equal(h.loadReverseLatticeLayers(0,...layers),1);
});
test('same-size map reset at version zero invalidates cache; unchanged terrain preserves hits',()=>{
 const s=setup(),h=new HazardKernel(s,{reverseViabilityCacheEntries:16});check(s,h);
 const memory=h.terrainIdentity,before=h.terrainIdentityInvalidations;h.reverseViable();
 assert.equal(h.terrainIdentityInvalidations,before);assert.ok(h.reverseCacheHitCount>0);
 s.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);s.arrays[ARRAY.TERRAIN][s.cell(3,4)]=TERRAIN.WALL;
 s.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION]=0;s.initializeHash();check(s,h);
 assert.equal(h.terrainIdentityInvalidations,before+1);assert.equal(h.terrainIdentity,memory);
 assert.equal(h.hotAllocationCount,0);
});
