'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inside}=require('../../tools/agentank/diagnostics/worst-intent-window');
test('diagnostic windows use half-open frame bounds, not override counts',()=>{
 assert.equal(inside(20,21,4),false);assert.equal(inside(21,21,4),true);
 assert.equal(inside(24,21,4),true);assert.equal(inside(25,21,4),false);
 assert.equal(inside(22,21,1),false);assert.equal(inside(127,21,128),true);
});
