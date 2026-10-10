'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {metrics}=require('../../tools/agentank/diagnostics/opponent-root-calibration');
test('calibration separates missing support from normalized weight error',()=>{
 const columns=[{action:1,allowed:1,weight:3},{action:2,allowed:1,weight:1},{action:4,allowed:0,weight:1}];
 const r=metrics([1,4,8].map(actual=>({actual,columns})));
 assert.equal(r.covered,1);assert.equal(r.filteredOut,1);assert.equal(r.outsideGenerated,1);
 assert.equal(r.zeroProbability,2);assert.equal(r.coveredNll,-Math.log(.75));
 assert.equal(r.goBins[7].n,3);assert.equal(r.goBins[7].hits,1);
 assert.equal(r.brier,(.125+1.625+1.625)/3);
});
test('duplicate action columns aggregate and zero mass never fabricates probabilities',()=>{
 assert.equal(metrics([{actual:1,columns:[{action:1,allowed:1,weight:1},{action:1,allowed:1,weight:1}]}]).brier,0);
 const r=metrics([{actual:1,columns:[]}]);assert.equal(r.emptyDomain,1);assert.equal(r.brier,null);
});
