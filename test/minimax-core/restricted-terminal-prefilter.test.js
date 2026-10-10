'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY:A,SCALAR:S}=require('../../engine-v2/src/state/fast-state');
const {noneWitnessPossible:possible,evaluatePrefiltered}=require('../../tools/agentank/diagnostics/restricted-terminal-prefilter');
function make(){const s=new FastState(7,5),a=s.arrays;a[A.SCALAR][S.FRAME]=10;a[A.TANK_CELL][0]=s.cell(1,2);a[A.TANK_CELL][1]=s.cell(3,2);a[A.TANK_DIR][0]=1;a[A.TANK_STARS][0]=1;return s;}
test('prefilter requires clear enemy-NONE ray within physical bullet horizon',()=>{const s=make(),a=s.arrays;assert.equal(possible(s),true);a[A.TANK_CELL][1]=s.cell(4,2);assert.equal(possible(s),false);a[A.TANK_CELL][1]=s.cell(3,2);for(const t of [1,2]){a[A.TERRAIN][s.cell(2,2)]=t;assert.equal(possible(s),false);}});
test('NONE margin accounts for same-frame star collection and pickup lock',()=>{const s=make(),a=s.arrays;a[A.TANK_STARS][0]=0;assert.equal(possible(s),false);a[A.SCALAR][S.STAR_CELL]=a[A.TANK_CELL][0];assert.equal(possible(s),true);a[A.TANK_PICKUP_LOCK][0]=11;assert.equal(possible(s),false);a[A.TANK_STARS][0]=1;a[A.SCALAR][S.STAR_CELL]=a[A.TANK_CELL][1];assert.equal(possible(s),false);});
test('already FIRE skips certificate computation, preserving action',()=>{assert.equal(evaluatePrefiltered(null,null,4),null);});
