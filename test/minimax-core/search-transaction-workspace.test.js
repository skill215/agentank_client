'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY}=require('../../engine-v2/src/state/fast-state');
const {FastKernel}=require('../../engine-v2/src/fast/kernel');
const {NativeBasePolicySearch}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {SearchTransactionWorkspace}=require('../../tools/agentank/diagnostics/search-transaction-workspace');
test('workspace reuses buffers across repeated undo and restores search baseline',()=>{
 const state=new FastState(9,9),kernel=new FastKernel(state),search=new NativeBasePolicySearch();state.initializeHash();
 const w=new SearchTransactionWorkspace(search,kernel,state),refs=[...w.stateArrays];search.rootScore[0]=123;
 for(let i=0;i<30;i++){w.begin();assert.throws(()=>w.begin(),/REENTRY/);state.beginTransition();state.write(ARRAY.TANK_CELL,0,10);
  search.rootScore[0]=999;w.rollback();w.restoreSearch();w.end();assert.equal(state.arrays[ARRAY.TANK_CELL][0],0);assert.equal(search.rootScore[0],123);}
 for(let i=0;i<refs.length;i++)assert.equal(refs[i],w.stateArrays[i]);
});
test('array corruption bypassing undo cannot masquerade as restored state',()=>{
 const state=new FastState(9,9),w=new SearchTransactionWorkspace(new NativeBasePolicySearch(),new FastKernel(state),state);
 w.begin();state.arrays[ARRAY.TERRAIN][2]=1;assert.throws(()=>w.rollback(),/ROOT_ARRAY_RESTORE/);w.end();
});
