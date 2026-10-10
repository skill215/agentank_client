'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY}=require('../../engine-v2/src/state/fast-state');
const {NativeBasePolicySearch}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {ThinLayerExecutor}=require('../../tools/agentank/diagnostics/thin-layer-executor');
function setup(){const state=new FastState(9,9),search=new NativeBasePolicySearch();state.initializeHash();
 const kernel={applyFrame(){state.write(ARRAY.TANK_CELL,0,state.arrays[ARRAY.TANK_CELL][0]+1);return 1;}};
 search.diagnosticKernel=kernel;search.scheduledDepth=()=>3;
 const engine={adapter:{state}},executor=new ThinLayerExecutor(search,kernel,state);
 const prepare=function(){const d=this.scheduledDepth();for(let i=0;i<d;i++)kernel.applyFrame(0,0,0,0,0,0);
  this.rootScore[0]=d;this.lastBudgetLeafCount=this.lastFastIncompleteCount=this.lastHardIncompleteCount=this.lastNoActionLeafCount=this.lastTopLeafCount=0;return 1;};
 return {state,search,kernel,engine,executor,prepare};}
test('thin executor preserves last completed matrix and root on budget and admission exits',()=>{
 const x=setup(),apply=x.kernel.applyFrame,scheduled=x.search.scheduledDepth,cell=x.search.rootCell;
 assert.equal(x.executor.run(x.engine,1,null,x.prepare,2,3).completedDepth,1);assert.equal(x.search.rootScore[0],1);
 assert.equal(x.state.arrays[ARRAY.TANK_CELL][0],0);assert.equal(x.kernel.applyFrame,apply);assert.equal(x.search.scheduledDepth,scheduled);assert.equal(x.search.rootCell,cell);
 const result=x.executor.run(x.engine,1,null,x.prepare,100,3,(previous)=>previous===0);
 assert.equal(result.completedDepth,2);assert.equal(x.search.rootScore[0],2);assert.equal(result.used,3);
});
test('unknown failure restores methods and baseline; repeated runs reuse result and wrappers',()=>{
 const x=setup(),apply=x.kernel.applyFrame,error=Error('failure'),evaluate=x.executor.evaluate;
 x.search.rootScore[0]=42;
 assert.throws(()=>x.executor.run(x.engine,1,null,function(){x.kernel.applyFrame();this.rootScore[0]=99;throw error;}),e=>e===error);
 assert.equal(x.search.rootScore[0],42);assert.equal(x.kernel.applyFrame,apply);assert.equal(x.executor.active,0);assert.equal(x.state.arrays[ARRAY.TANK_CELL][0],0);
 for(let i=0;i<5;i++)assert.equal(x.executor.run(x.engine,1,null,x.prepare),x.executor.scheduler);
 assert.equal(x.executor.evaluate,evaluate);
});
