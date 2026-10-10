'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../engine-v2/src/base-policy-specialized/policy-search');
function value(values,weights,blend){return S.prototype.blended.call({currentBlendBasisPoints:blend},Math.min(...values),values.reduce((s,v,i)=>s+v*weights[i],0),weights.reduce((s,w)=>s+w,0));}
test('BP318 I52 recorded response values explain ownership inversion without changing GO or Risk',()=>{
 const w=[16200,10000,11000];
 const go=value([10543,40,40],w,2700)+150;
 assert.equal(go,1424);assert.equal(value([12796,-103,-103],w,2700),1413);
 assert.equal(value([20362,-103,-103],w,2700),2303);
 assert.ok(-103<40); // higher blended score is NOT worst-response dominance
});
test('BP318 2oo terminal upside flips blended ordering while FIRE worst response stays weaker',()=>{
 const w=[41600,4000,7000,1000];
 const go=value([25000,15641,15641,25000],w,3216);
 const oldFire=value([42354,7062,25000,25000],w,3216)+150;
 const newFire=value([100000,7062,25000,25000],w,3216)+150;
 assert.equal(go,18033);assert.equal(oldFire,16881);assert.equal(newFire,31270);
 assert.ok(oldFire<go&&newFire>go);assert.ok(7062<15641);
});
