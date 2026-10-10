'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {seedFor,signP,assess}=require('../../tools/agentank/diagnostics/paired-label-diagnostic');
test('paired sign tail excludes ties and has exact small-sample behavior',()=>{
 assert.equal(signP([0,0]),1);assert.equal(signP([1,1,0]),.25);assert.equal(signP([-1,-1],-1),.25);assert.equal(signP([-1,-1]),1);
});
test('stable label requires effect, corrected evidence and both fixed halves',()=>{
 assert.equal(assess(Array(32).fill(1)).stableDirection,true);
 assert.equal(assess([...Array(16).fill(1),...Array(16).fill(0)]).stableDirection,false);
 assert.equal(assess(Array(32).fill(-.5),-1).stableDirection,true);
 assert.equal(assess(Array(32).fill(.05)).stableDirection,false);
});
test('fresh label seeds are deterministic and unique across frozen cases',()=>{
 const seeds=[3,12,9,15].flatMap(c=>Array.from({length:32},(_,i)=>seedFor(c,i)));
 assert.equal(new Set(seeds).size,128);assert.equal(seedFor(3,0),seedFor(3,0));
});
