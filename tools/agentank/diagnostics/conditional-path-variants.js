'use strict';
const assert=require('node:assert/strict');
const {ACTION,NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {transform}=require('./path-component-variants');
const CONDITIONS=['after-stun','stunned','turning','repeated-turn','behind-stars'];
const SPECS=Object.freeze(CONDITIONS.flatMap(condition=>['R15','R29'].map(parent=>({parent,condition,mode:parent+':'+condition}))).map((s,i)=>({...s,id:'R'+(81+i)})));
function conditionMatches(condition,engine){
 const a=engine.adapter.state.arrays;
 if(condition==='after-stun')return engine.lastAction===ACTION.CAST_STUN;
 if(condition==='stunned'){const until=a[ARRAY.TANK_STUN_UNTIL][0];return until!==NONE_FRAME&&until>a[ARRAY.SCALAR][SCALAR.FRAME];}
 if(condition==='turning')return engine.turnStreak>=1;
 if(condition==='repeated-turn')return engine.turnStreak>=2;
 if(condition==='behind-stars')return a[ARRAY.TANK_STARS][0]<a[ARRAY.TANK_STARS][1];
 if(condition==='never')return false;
 throw Error('UNKNOWN_CONDITION:'+condition);
}
function install(engine,mode){
 const spec=SPECS.find(s=>s.mode===mode)||(['noop','R15','R29'].includes(mode)?{parent:mode,condition:'never'}:null);assert.ok(spec,'UNKNOWN_VARIANT');
 const stats={mode,prepareCalls:0,restoredRoots:0,calls:0,changedValues:0,parentDiffValues:0};
 const search=engine.basePolicy.policySearch,utility=search.pathUtility,prepare=search.prepare;
 let restore=false;
 search.prepare=function(...args){restore=conditionMatches(spec.condition,engine);stats.prepareCalls++;stats.restoredRoots+=Number(restore);return prepare.apply(this,args);};
 for(const method of ['scoreTransition','scoreAppliedTransition']){
  const original=utility[method];assert.equal(typeof original,'function');
  utility[method]=function(...args){
   const before=original.apply(this,args);
   const parent=transform(spec.parent==='R15'?'reference-half':spec.parent==='R29'?'turn-streak-extra-zero':'noop',before,args[1],args[3],args[4],method==='scoreAppliedTransition');
   const after=restore?before:parent;
   stats.calls++;stats.changedValues+=Number(after!==before);stats.parentDiffValues+=Number(after!==parent);return after;
  };
 }
 return stats;
}
module.exports={SPECS,CONDITIONS,conditionMatches,install};
