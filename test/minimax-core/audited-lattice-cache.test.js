'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {HazardKernel}=require('../../engine-v2/src/fast/hazard');
const {TERRAIN,NONE_FRAME}=require('../../engine-v2/src/abi/fast-codes');
const {AuditedLatticeHazard}=require('../../tools/agentank/diagnostics/audited-lattice-cache');
function fixture(){
 const state=new FastState(7,7),a=state.arrays,t=a[ARRAY.TERRAIN];t.fill(TERRAIN.WALL);
 for(const [x,y] of [[3,3],[4,3],[4,4]])t[state.cell(x,y)]=TERRAIN.OPEN;
 a[ARRAY.TANK_BOOST_UNTIL].fill(NONE_FRAME);a[ARRAY.TANK_SKILL_READY].fill(NONE_FRAME);
 a[ARRAY.TANK_CELL][0]=state.cell(3,3);a[ARRAY.TANK_DIR][0]=1;
 a[ARRAY.BOMB_ACTIVE][0]=1;a[ARRAY.BOMB_CELL][0]=state.cell(3,3);a[ARRAY.BOMB_EXPLODE][0]=3;
 state.initializeHash();return state;
}
test('same-version branch terrain invalidates production and audited lattices',()=>{
 const s=fixture(),legacy=new HazardKernel(s,{reverseLatticeCacheEntries:4}),safe=new AuditedLatticeHazard(s,4,true);
 assert.equal(legacy.reverseViable(),1);assert.equal(safe.reverseViable(),1);
 const version=s.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION];
 s.arrays[ARRAY.TERRAIN][s.cell(4,4)]=TERRAIN.DIRT;s.initializeHash();
 assert.equal(s.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION],version);
 assert.equal(new HazardKernel(s).reverseViable(),0);
 assert.equal(legacy.reverseViable(),0,'production must reject the formerly stale viable result');
 assert.equal(safe.reverseViable(),0);
 s.arrays[ARRAY.TERRAIN][s.cell(4,4)]=TERRAIN.OPEN;s.initializeHash();assert.equal(safe.reverseViable(),1);
});
test('pose sharing preserves oracle and own-projectile changes refresh horizon',()=>{
 const s=fixture(),h=new AuditedLatticeHazard(s,4,true),a=s.arrays;
 for(const cell of [s.cell(3,3),s.cell(4,3),s.cell(4,4)])for(let dir=0;dir<4;dir++){
   a[ARRAY.TANK_CELL][0]=cell;a[ARRAY.TANK_DIR][0]=dir;s.initializeHash();h.reverseViable();
 }
 assert.ok(h.reverseLatticeHitCount>0);
 a[ARRAY.PROJECTILE_ACTIVE][0]=1;a[ARRAY.PROJECTILE_OWNER][0]=0;
 a[ARRAY.PROJECTILE_CELL][0]=s.cell(3,3);a[ARRAY.PROJECTILE_DIR][0]=1;s.initializeHash();h.reverseViable();
 assert.equal(h.verifiedQueries,13);
});
test('same-version topology also invalidates hazard rebuild even without lattice caching',()=>{
 const s=new FastState(9,9),a=s.arrays,t=a[ARRAY.TERRAIN];t.fill(TERRAIN.OPEN);
 a[ARRAY.BOMB_ACTIVE][0]=1;a[ARRAY.BOMB_CELL][0]=s.cell(4,4);a[ARRAY.BOMB_EXPLODE][0]=2;
 const blocker=s.cell(5,4),other=s.cell(1,1),target=s.cell(6,4);
 t[blocker]=TERRAIN.DIRT;s.initializeHash();
 const legacy=new HazardKernel(s),safe=new AuditedLatticeHazard(s);
 legacy.rebuild();safe.rebuild();const tick=safe.horizonTick;
 assert.equal(legacy.isLethal(tick,target),false);
 // Two sibling branches each destroyed one of the original dirt cells.
 t[blocker]=TERRAIN.OPEN;t[other]=TERRAIN.DIRT;s.initializeHash();
 legacy.rebuild();safe.rebuild();const fresh=new HazardKernel(s);fresh.rebuild();
 assert.equal(fresh.isLethal(tick,target),true);
 assert.equal(legacy.isLethal(tick,target),true,'production must rebuild despite unchanged version');
 assert.equal(safe.isLethal(tick,target),true);
});
