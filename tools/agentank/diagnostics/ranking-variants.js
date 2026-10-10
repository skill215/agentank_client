'use strict';
// Diagnostic instance-local interventions; production files are never patched.
const assert=require('node:assert/strict');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const SPECS=Object.freeze([
 {id:'R11',mode:'worst-only',hypothesis:'Expected response blending can hide losing replies; use the existing worst response only.'},
 {id:'R12',mode:'blend-half',hypothesis:'Halve the current expected-response coefficient to test a smaller pessimism adjustment.'},
 {id:'R13',mode:'blend-double',hypothesis:'Double the expected-response coefficient, capped at 5000 basis points, to test excessive pessimism.'},
 {id:'R14',mode:'uniform-opponent',hypothesis:'Uniform opponent weights can avoid miscalibrated history weights while retaining the current blend.'},
 {id:'R15',mode:'path-half',hypothesis:'Halve accumulated transition rewards to test whether they overwhelm reached-state value.'},
 {id:'R16',mode:'path-zero',hypothesis:'Remove transition rewards to measure their independent contribution.'},
 {id:'R17',mode:'intent-zero',hypothesis:'Remove final action intent bonus without changing intent membership or commit behavior.'},
 {id:'R18',mode:'attack-half',hypothesis:'Halve the leaf attack component before the original total clamp.'},
 {id:'R19',mode:'projectile-double',hypothesis:'Double the leaf projectile/bomb-pressure component before the original total clamp.'},
 {id:'R20',mode:'late-trailing-star-route',hypothesis:'Double the leaf star-route component only at simulated frame >=96 when behind in stars.'}
]);
function blend(worst,sum,count,bp){if(!count||!bp)return worst;return worst+Math.trunc((Math.trunc(sum/count)-worst)*bp/10000);}
function leafValue(components,index,scale){let total=0;for(let i=0;i<components.length;i++)total+=i===index?Math.trunc(components[i]*scale):components[i];return Math.max(-25000,Math.min(25000,total));}
function install(engine,mode='noop'){
 assert.ok(mode==='noop'||SPECS.some(s=>s.mode===mode),'UNKNOWN_RANKING_VARIANT');
 const stats={mode,calls:0,changedValues:0};const s=engine.basePolicy.policySearch,owner=engine.basePolicy.owner,leaf=s.leafEvaluator;
 function wrap(object,name,change){const original=object[name];assert.equal(typeof original,'function');object[name]=function(...args){const before=original.apply(this,args),after=change.call(this,before,args);stats.calls++;stats.changedValues+=Number(before!==after);return after;};}
 if(['worst-only','blend-half','blend-double'].includes(mode))wrap(s,'blended',function(before,[worst,sum,count]){const bp=mode==='worst-only'?0:mode==='blend-half'?Math.trunc(this.currentBlendBasisPoints/2):Math.min(5000,this.currentBlendBasisPoints*2);return blend(worst,sum,count,bp);});
 if(mode==='uniform-opponent')wrap(s,'opponentWeight',()=>1);
 if(mode==='path-half'||mode==='path-zero')for(const name of ['scoreTransition','scoreAppliedTransition'])wrap(s.pathUtility,name,before=>mode==='path-zero'?0:Math.trunc(before/2));
 if(mode==='intent-zero')wrap(owner,'intentAdjustment',()=>0);
 if(['attack-half','projectile-double','late-trailing-star-route'].includes(mode))wrap(leaf,'evaluate',function(before,[state]){if(mode==='late-trailing-star-route'){const a=state.arrays;if(a[ARRAY.SCALAR][SCALAR.FRAME]<96||a[ARRAY.TANK_STARS][0]>=a[ARRAY.TANK_STARS][1])return before;return leafValue(this.lastComponents,1,2);}return leafValue(this.lastComponents,mode==='attack-half'?3:2,mode==='attack-half'?.5:2);});
 return stats;
}
module.exports={SPECS,install,blend,leafValue};
