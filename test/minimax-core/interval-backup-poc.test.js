'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {interval:I,extrema,expectation,robust,pureMatrix,verify}=require('../../tools/agentank/diagnostics/interval-backup-poc');
test('exhaustive interval matrices contain every completion and never certify a wrong pure action',()=>{
 const r=verify();assert.equal(r.matrices,1296);assert.ok(r.completions>r.matrices);assert.ok(r.strictCertificates>0);
});
test('unknown branches can be irrelevant without being deleted or turned into exact leaves',()=>{
 const r=pureMatrix([[I(3),I(4)],[I(-10,10),I(1)]]);
 assert.equal(r.winner,0);assert.deepEqual(r.rows[1],I(-10,1));
 assert.equal(pureMatrix([[I(3),I(4)],[I(-10,10),I(8)]]).winner,-1);
});
test('chance and contamination outward rounding encloses all integer completions including negatives',()=>{
 for(let lo=-3;lo<=3;lo++)for(let hi=lo;hi<=3;hi++)for(const eps of [0,1,5000,9999,10000]){
  const children=[I(lo,hi),I(-2,2)],weights=[1,3],r=robust(children,weights,eps);
  for(let a=lo;a<=hi;a++)for(let b=-2;b<=2;b++){
   const exact=(eps*Math.min(a,b)+(10000-eps)*(a+3*b)/4)/10000;
   assert.ok(r.lo<=exact&&exact<=r.hi);
  }
 }
 assert.deepEqual(expectation([I(-1),I(0)],[1,1]),I(-1,0));
});
test('quantifier order and simultaneous mixed play cannot be substituted silently',()=>{
 const m=[[I(1),I(-1)],[I(-1),I(1)]];
 assert.deepEqual(pureMatrix(m).value,I(-1)); // mixed equilibrium is zero, NOT -1
 assert.deepEqual(extrema([extrema([m[0][0],m[1][0]],'max'),extrema([m[0][1],m[1][1]],'max')],'min'),I(1));
 assert.equal(pureMatrix(m).winner,-1);
});
test('empty support and unsafe sums reject instead of manufacturing exact bounds',()=>{
 assert.throws(()=>extrema([],'min'));assert.throws(()=>expectation([I(1)],[0]));
 assert.throws(()=>expectation([I(Number.MAX_SAFE_INTEGER)],[2]));assert.throws(()=>I(2,1));
});
