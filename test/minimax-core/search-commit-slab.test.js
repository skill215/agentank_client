'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicySearch}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {SearchCommitSlab,RESULT_ARRAYS}=require('../../tools/agentank/diagnostics/search-commit-slab');
test('commit slab restores matrix and flags without replacing buffers or scratch/history',()=>{
 const search=new NativeBasePolicySearch(),slab=new SearchCommitSlab(search),refs=RESULT_ARRAYS.map(k=>search[k]);
 search.rootScore[0]=-2147483648;search.rootNominalScore[1]=2147483647;
 search.currentDepth=2;search.lastValueExact=1;slab.capture(search);
 search.rootScore.fill(8);search.rootNominalScore.fill(9);search.currentDepth=3;search.lastValueExact=0;
 search.pathAction[0]=17;search.rootHistoryCursor=3;slab.restore(search);
 assert.equal(search.rootScore[0],-2147483648);assert.equal(search.rootNominalScore[1],2147483647);
 assert.equal(search.currentDepth,2);assert.equal(search.lastValueExact,1);assert.equal(search.pathAction[0],17);
 for(let i=0;i<refs.length;i++)assert.equal(search[RESULT_ARRAYS[i]],refs[i]);
});
test('uncaptured result cannot be published; repeated captures reuse fixed storage',()=>{
 const search=new NativeBasePolicySearch(),slab=new SearchCommitSlab(search),buffers=[...slab.buffers],scalars=slab.scalars;
 assert.throws(()=>slab.restore(search),/NO_COMMITTED/);
 for(let i=0;i<100;i++){search.rootScore[0]=i;slab.capture(search);search.rootScore[0]=-1;slab.restore(search);assert.equal(search.rootScore[0],i);}
 assert.equal(slab.scalars,scalars);for(let i=0;i<buffers.length;i++)assert.equal(slab.buffers[i],buffers[i]);
});
