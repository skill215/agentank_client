'use strict';
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
// Synthetic children isolate the real production reducer, not a reimplementation.
function reducer(method,unbounded){
 const original=NativeBasePolicySearch.prototype[method];
 if(!unbounded)return original;
 return new Function('VALUE_MIN','VALUE_MAX','DEEP_WIDTH','EVENT_QUIESCENCE',
  `return function ${original.toString()}`)(-Infinity,Infinity,6,{OFF:'off'});
}
function runCase(kind,values,blend=2000,unbounded=false){
 let index=0;
 const context={nodes:0,perRootBudget:100,policyNodeDepthCount:new Uint32Array(5),
  deepEnemyActions:new Uint8Array(values.length),deepEnemyArguments:new Uint16Array(values.length),
  deepOurActions:new Uint8Array(values.length),deepOurArguments:new Uint16Array(values.length),
  currentBlendBasisPoints:blend,generate:()=>values.length,opponentWeight:()=>1,
  blended:NativeBasePolicySearch.prototype.blended,
  transitionValue(){const v=values[index++];this.lastNominalValue=v;return v;},
  worstReply(){const v=values[index++];this.lastNominalValue=v;return v;},
  pairedLeaf(){this.lastNominalValue=17;return 17;}};
 const fn=reducer(kind,unbounded),engine={adapter:{state:{}}};
 const value=kind==='worstReply'?fn.call(context,engine,0,0,1,0,0,0):fn.call(context,engine,1,0,0,0);
 return {value,nominal:context.lastNominalValue};
}
function audit(){
 const inputs=[['all-win','worstReply',[100000,100000],2000],
  ['all-loss','policyValue',[-100000,-60000],2000],
  ['positive-order','worstReply',[60000,100000],2000],
  ['negative-order','policyValue',[-60000,-100000],2000],
  ['ordinary-min','worstReply',[-100,200],2000],
  ['ordinary-max','policyValue',[-100,200],2000],
  ['empty-min','worstReply',[],2000],['empty-max','policyValue',[],2000]];
 return {scope:'real production reducers with synthetic children; no game-frequency or win-rate claim',
  productionModified:false,cases:inputs.map(([name,kind,values,blend])=>({name,kind,values,blend,
   current:runCase(kind,values,blend),scalarInfinityExperiment:runCase(kind,values,blend,true)}))};
}
if(require.main===module)console.log(JSON.stringify(audit(),null,2));
module.exports={runCase,audit};
