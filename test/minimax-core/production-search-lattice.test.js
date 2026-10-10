'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicySearch}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {FastState,ARRAY}=require('../../engine-v2/src/state/fast-state');
const {FastKernel}=require('../../engine-v2/src/fast/kernel');
test('production search enables four bounded lattice entries without layer copies',()=>{
 const state=new FastState(19,15),search=new NativeBasePolicySearch();
 search.bindIsolatedHard({state,kernel:new FastKernel(state)});const h=search.diagnosticHazard;
 assert.equal(h.reverseLatticeEntries,4);assert.equal(h.reverseLatticeIncludesOwnProjectiles,1);
 assert.equal(h.reverseLatticeLayerCacheEnabled,0);
 assert.equal(h.reverseLatticeGrid.byteLength+h.reverseLatticeValid.byteLength+h.reverseLatticeHashLo.byteLength+h.reverseLatticeHashHi.byteLength,4596);
 h.computeReverseSignature(0);const before=[h.reverseSignatureLo,h.reverseSignatureHi];
 state.arrays[ARRAY.PROJECTILE_ACTIVE][0]=1;state.arrays[ARRAY.PROJECTILE_OWNER][0]=0;
 state.arrays[ARRAY.PROJECTILE_CELL][0]=20;state.arrays[ARRAY.PROJECTILE_DIR][0]=1;
 h.computeReverseSignature(0);assert.notDeepEqual([h.reverseSignatureLo,h.reverseSignatureHi],before);
 assert.deepEqual([h.reverseSignatureLo,h.reverseSignatureHi],[h.hazardSignatureLo,h.hazardSignatureHi]);
});
