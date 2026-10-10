'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {classifyBranch,referenceBranch}=require('../../tools/agentank/diagnostics/deep-branch-diagnostic');
test('deep branch attributes inherited mismatches and unresolved scope separately',()=>{
 const b={status:1,beforeDifferences:[],differences:[{field:'position'}]};
 assert.equal(classifyBranch(b,null),'FIRST_DIVERGENCE');
 assert.equal(classifyBranch(b,{firstDivergence:0}),'INHERITED_DIVERGENCE');
 assert.equal(classifyBranch({...b,scopeUnknown:true},null),'REFERENCE_SCOPE_UNRESOLVED');
 assert.equal(classifyBranch({...b,status:3},null),'MODEL_UNSUPPORTED');
});
test('reference clone absent star is comparable until a spawn is actually requested',()=>{
 const sim={frame:3,star:null,players:[{effects:{}},{effects:{}}],clone(options){return {...this,...options};}};
 let r=referenceBranch(sim,0,[0,0,0,0,0,0],function(){this.frame++;return [];});
 assert.equal(r.scopeUnknown,false);assert.equal(sim.frame,3);
 r=referenceBranch(sim,0,[0,0,0,0,0,0],function(){this.starProvider();return [];});
 assert.equal(r.spawnCalls,1);assert.equal(r.scopeUnknown,true);
});
test('reference chance mapping follows actual seats and reports unexpected RNG',()=>{
 const sim={frame:3,players:[{effects:{debuff:{type:'stun',expiresAt:9}}},{effects:{debuff:{type:'stun',expiresAt:9}}}],clone(options){return {...this,...options};}};
 const r=referenceBranch(sim,1,[1,0,1,0,1,0],function(){return [this.rng(),this.rng()];});
 assert.deepEqual(r.events,[.25,.75]);assert.equal(r.scopeUnknown,false);
 const unexpected=referenceBranch({...sim,players:[{effects:{}},{effects:{}}]},0,[0,0,0,0,0,0],function(){this.rng();return [];});
 assert.equal(unexpected.scopeUnknown,true);
});
