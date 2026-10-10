'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {publishable,LIMIT,CAP}=require('../../tools/agentank/diagnostics/layered-budget-active');
test('fixed budget candidate never publishes stale or absent layer',()=>{assert.equal(LIMIT,128);assert.equal(CAP,3);assert.equal(publishable({completedDepth:0,committed:{stale:true}}),0);assert.equal(publishable({completedDepth:2,committed:null}),0);assert.equal(publishable({completedDepth:1,committed:{}}),1);});
