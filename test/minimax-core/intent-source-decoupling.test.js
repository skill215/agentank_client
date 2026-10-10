'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {refreshOnMissingSource}=require('../../tools/agentank/diagnostics/intent-source-decoupling');
test('missing source refreshes planning but preserves absence of action authority',()=>{
 const engine={},calls=[],owner={intent:{prepare(e,n){calls.push([e,n]);}}};
 assert.equal(refreshOnMissingSource(owner,engine,3,null),null);assert.deepEqual(calls,[[engine,3]]);
 const source={rootScore:new Int32Array([1])};assert.equal(refreshOnMissingSource(owner,engine,3,source),source);assert.equal(calls.length,1);
 assert.equal(refreshOnMissingSource({},engine,3,null),null);
});
