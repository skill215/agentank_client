'use strict';
const assert=require('node:assert/strict');
const {install:installPath}=require('./path-component-variants');
const RULES=['risk-dominance-first','risk-acceptable-first','no-intent-bonus','no-nominal-tie','incumbent-score-tie'];
const SPECS=Object.freeze(RULES.flatMap(condition=>['R15','R29'].map(parent=>({parent,condition,mode:parent+':'+condition}))).map((s,i)=>({...s,id:'R'+(91+i)})));
function rank(rule,owner,original,e,row,best,value,bestValue,nominal,bestNominal,incumbent){
 if(best<0)return original.call(owner,e,row,best,value,bestValue,nominal,bestNominal);
 if(rule==='risk-dominance-first'){
  if(e.riskController.strictlyDominates(row,best))return 1;
  if(e.riskController.strictlyDominates(best,row))return 0;
 }
 if(rule==='risk-acceptable-first'){
  const a=!!e.riskController.outcome.acceptable[row],b=!!e.riskController.outcome.acceptable[best];
  if(a!==b)return Number(a);
 }
 if(rule==='no-nominal-tie')return original.call(owner,e,row,best,value,bestValue,value,bestValue);
 if(rule==='incumbent-score-tie'&&value===bestValue&&(row===incumbent||best===incumbent))return Number(row===incumbent);
 return original.call(owner,e,row,best,value,bestValue,nominal,bestNominal);
}
function install(engine,mode){
 const spec=SPECS.find(s=>s.mode===mode)||(['noop','R15','R29'].includes(mode)?{parent:mode,condition:'noop'}:null);assert.ok(spec,'UNKNOWN_OWNER_VARIANT');
 installPath(engine,spec.parent==='R15'?'reference-half':spec.parent==='R29'?'turn-streak-extra-zero':'noop');
 const stats={mode,ownerCalls:0,comparisons:0,changedPreferences:0,bonusCalls:0,changedBonuses:0,mechanismChanges:0};
 const owner=engine.basePolicy.owner,select=owner.selectOverride,better=owner.better,bonus=owner.intentAdjustment;let incumbent=-1;
 owner.selectOverride=function(e,selected,action){stats.ownerCalls++;incumbent=selected;return select.call(this,e,selected,action);};
 owner.better=function(e,row,best,value,bestValue,nominal,bestNominal){
  stats.comparisons++;const before=better.call(this,e,row,best,value,bestValue,nominal,bestNominal);
  const after=rank(spec.condition,this,better,e,row,best,value,bestValue,nominal,bestNominal,incumbent);
  if(!!before!==!!after){stats.changedPreferences++;stats.mechanismChanges++;}return after;
 };
 owner.intentAdjustment=function(row){stats.bonusCalls++;const before=bonus.call(this,row),after=spec.condition==='no-intent-bonus'?0:before;
  if(before!==after){stats.changedBonuses++;stats.mechanismChanges++;}return after;
 };
 return stats;
}
module.exports={RULES,SPECS,rank,install};
