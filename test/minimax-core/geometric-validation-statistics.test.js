'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pairedTest}=require('../../tools/agentank/diagnostics/geometric-contact-validation');
test('scenario randomization retains seat clustering and exact ties',()=>{
 assert.equal(pairedTest([0,0,0]).twoSidedP,1);
 assert.equal(pairedTest([2,-2]).twoSidedP,1);
 assert.equal(pairedTest([2,2,2,2,2,2]).twoSidedP,1/32);
 assert.equal(pairedTest([-2,-2,-2,-2,-2,-2]).twoSidedP,1/32);
 assert.equal(pairedTest([1,0]).observedHalfPoints,1);
});
