'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ResponseSupportLedger}=require('../../tools/agentank/diagnostics/response-support-ledger');
const {audit}=require('../../tools/agentank/diagnostics/response-support-audit');
test('policy-pruned generated responses remain residual regardless of weight or outcome',()=>{
 const a=new Uint8Array([0,1,4,5,8]),m=new Uint8Array([0,1,0,0,0]),s=new ResponseSupportLedger();
 const before=[...a,...m];assert.equal(s.update(a,m,5,true),s);
 assert.equal(s.searchedMask,2);assert.equal(s.residualMask,1+16+32+256);assert.equal(s.complete,0);
 assert.deepEqual([...a,...m],before);
});
test('support resets every root and never assumes generator completeness or empty-domain safety',()=>{
 const s=new ResponseSupportLedger();s.update([1],[0],1,true);s.update([1],[1],1,false);assert.equal(s.residualMask,0);assert.equal(s.complete,0);
 s.update([1],[1],1,true);assert.equal(s.complete,1);s.update([],[],0,true);assert.equal(s.complete,0);
 assert.throws(()=>s.update([24],[1],1,true));assert.equal(s.complete,0);
});
test('a searched duplicate does not erase an unproven omitted representative',()=>{
 const s=new ResponseSupportLedger().update([4,4],[1,0],2,true);assert.equal(s.residualMask,16);assert.equal(s.complete,0);
});
test('offline ledger accounts for omitted real labels without rerunning transitions',()=>{
 const r=audit([{id:'x',seat:0,frame:1,actual:5,columns:[{action:1,allowed:1,weight:100},{action:5,allowed:0,weight:0}]}]);
 assert.equal(r.summary.observedOmittedCoveredByResidual,1);assert.equal(r.summary.extraSearchNodes,0);
 assert.equal(r.records[0].supportComplete,0);
});
