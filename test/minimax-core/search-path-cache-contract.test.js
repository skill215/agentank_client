"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicyRoot}=require('../../engine-v2/src/base-policy-specialized/native-root');
const {rowSummary}=require('../../tools/agentank/diagnostics/native-search-value-audit');
test('identical physical state does not identify a path-dependent search value',()=>{
  const search=new NativeBasePolicyRoot().policySearch;
  search.leafEvaluator={evaluate:()=>42};
  const engine={adapter:{state:{hashLo:123,hashHi:456}}};
  assert.equal(search.leaf(engine,0,0),42);
  assert.equal(search.leaf(engine,150,0),192);
  assert.deepEqual([engine.adapter.state.hashLo,engine.adapter.state.hashHi],[123,456]);
});
test('BP294 completed layer matrices reproduce depth-dependent action ranking',()=>{
  const cells=values=>values.map((value,i)=>({value,weight:[20800,3000,7000][i]}));
  const go2=rowSummary(cells([-856,-866,-850]),2959).backed;
  const right2=rowSummary(cells([3787,-1385,-1366]),2959).backed+150;
  const go3=rowSummary(cells([115,-866,-850]),2959).backed;
  const right3=rowSummary(cells([758,-1407,-1393]),2959).backed+150;
  assert.equal(go2,-863);assert.equal(right2,-201);
  assert.equal(go3,-669);assert.equal(right3,-824);
  assert.ok(right2>go2);assert.ok(go3>right3);
});
