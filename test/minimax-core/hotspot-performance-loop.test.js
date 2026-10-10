'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../../tools/agentank/diagnostics/hotspot-performance-design');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {HazardKernel}=require('../../engine-v2/src/fast/hazard');
const {TERRAIN,NONE_FRAME,SKILL}=require('../../engine-v2/src/abi/fast-codes');
const M=D.compile(process.cwd());
function fixture(seed){const s=new FastState(seed%2?9:19,seed%2?9:15),a=s.arrays;
 a[ARRAY.TERRAIN].fill(TERRAIN.OPEN);for(let c=0;c<s.cells;c++)if((c*17+seed*13)%19<3)a[ARRAY.TERRAIN][c]=c%2?TERRAIN.WALL:TERRAIN.DIRT;
 for(let seat=0;seat<2;seat++){a[ARRAY.TANK_CELL][seat]=seat?s.cells-12:10;a[ARRAY.TANK_DIR][seat]=(seed+seat)%4;}
 a[ARRAY.TANK_BOOST_UNTIL].fill(NONE_FRAME);a[ARRAY.TANK_SHIELD_UNTIL].fill(NONE_FRAME);a[ARRAY.TANK_SKILL_READY].fill(NONE_FRAME);
 if(seed%5===0){a[ARRAY.TANK_SKILL][0]=SKILL.TELEPORT;a[ARRAY.TANK_SKILL_READY][0]=0;}
 if(seed%7===0){a[ARRAY.TANK_SHIELD_HITS][0]=1;a[ARRAY.TANK_SHIELD_UNTIL][0]=10;}
 for(let slot=0;slot<seed%4;slot++){a[ARRAY.BOMB_ACTIVE][slot]=1;a[ARRAY.BOMB_CELL][slot]=(10+slot*3)%s.cells;a[ARRAY.BOMB_EXPLODE][slot]=(seed+slot)%4;}
 for(let slot=0;slot<seed%3;slot++){a[ARRAY.PROJECTILE_ACTIVE][slot]=1;a[ARRAY.PROJECTILE_CELL][slot]=(12+slot*5)%s.cells;a[ARRAY.PROJECTILE_DIR][slot]=(seed+slot)%4;a[ARRAY.PROJECTILE_OWNER][slot]=slot%2;}
 s.initializeHash();return s;}
test('hotspot variants preserve return, all lattice layers, cache metadata and scratch across apply/undo branches',()=>{
 for(const mode of D.MODES)for(let seed=0;seed<24;seed++)for(const cached of [false,true]){
  const s=fixture(seed),h=new HazardKernel(s,cached?{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeLayerCache:true}:{});
  const check=()=>{for(let seat=0;seat<2;seat++){const oracle=D.cloneHazard(h);assert.equal(M[mode].call(h,seat),M.baseline.call(oracle,seat));D.verifyHazard(h,oracle);}};
  check();check();for(const cell of [11,22]){const mark=s.beginTransition();s.write(ARRAY.TERRAIN,cell,TERRAIN.OPEN);s.write(ARRAY.SCALAR,SCALAR.TERRAIN_VERSION,1);check();s.undoTo(mark);check();}
 }
});
test('lazy forward removes target work when hold or turning already supplies viability',()=>{
 const s=fixture(0);s.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);s.arrays[ARRAY.BOMB_ACTIVE][0]=1;s.arrays[ARRAY.BOMB_CELL][0]=40;s.arrays[ARRAY.BOMB_EXPLODE][0]=3;s.initializeHash();
 const counts={};for(const mode of ['baseline',...D.MODES]){const h=new HazardKernel(s);const target=h.target;let count=0;h.target=function(...a){count++;return target.apply(this,a);};M[mode].call(h,0);counts[mode]=count;}
 assert.ok(counts['lazy-forward']<counts.baseline/2);assert.equal(counts['lazy-parity'],counts['lazy-forward']);
});
test('hotspot shadow validator rejects lattice or proof-state corruption',()=>{
 const h=new HazardKernel(fixture(3)),o=D.cloneHazard(h);h.viableA[3]=1;assert.throws(()=>D.verifyHazard(h,o),/HAZARD_STATE_DRIFT/);
});
