'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {skipSearch}=require('../../tools/agentank/diagnostics/geometric-contact-admission');
test('remote stun admission preserves nearby and clear-line tactical contact',()=>{
 assert.equal(skipSearch(24,false,true),true);assert.equal(skipSearch(10,false,true),true);
 assert.equal(skipSearch(9,false,true),false);assert.equal(skipSearch(24,true,true),false);assert.equal(skipSearch(24,false,false),false);
});
