'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bestRow,summary}=require('../../tools/agentank/diagnostics/thin-whole-game-shadow');
test('raw ranking obeys domain and stable row but is not a final action selector',()=>{
 assert.equal(bestRow([100,10,10],[0,1,1],3),1);assert.equal(bestRow([1],[0],1),-1);
});
test('whole-game summary preserves search-root denominator and per-match tail cost',()=>{
 const rows=[{depth:0,stop:2,currentMs:1,shadowMs:3,matrixChanged:false,rawArgmaxChanged:false},
  {depth:2,stop:4,currentMs:2,shadowMs:7,matrixChanged:true,rawArgmaxChanged:true}];
 const r=summary(rows,[{shadowMs:10}]);assert.equal(r.searchRoots,2);assert.equal(r.shadow.totalMs,10);
 assert.equal(r.changedMatrices,1);assert.equal(r.changedRawArgmax,1);assert.equal(r.maxMatchShadowMs,10);
 assert.deepEqual(r.depths,{'0':1,'2':1});
});
