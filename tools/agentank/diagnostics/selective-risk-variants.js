'use strict';
const assert=require('node:assert/strict');
const {install:installPath}=require('./path-component-variants');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const RULES=['immediate-only','committed-only','horizon-only','fatal-mass-only','leading-only'];
const SPECS=Object.freeze(RULES.flatMap(condition=>['R15','R29'].map(parent=>({parent,condition,mode:parent+':'+condition}))).map((s,i)=>({...s,id:'R'+(101+i)})));
const FIELDS=['immediateFatalMass','committedChanceFatalMass','horizonFatalMass','unknownMass','earliestFatalFrame','escapeSlack','escapeSuccessorProof','escapeSuccessorExposed','escapeSuccessorSlack'];
function permitted(rule,e,left,right){
 const o=e.riskController.outcome;
 if(rule==='full-dominance')return true;
 if(rule==='immediate-only')return o.immediateFatalMass[left]<o.immediateFatalMass[right];
 if(rule==='committed-only')return o.committedChanceFatalMass[left]<o.committedChanceFatalMass[right];
 if(rule==='horizon-only')return o.horizonFatalMass[left]<o.horizonFatalMass[right];
 if(rule==='fatal-mass-only')return ['immediateFatalMass','committedChanceFatalMass','horizonFatalMass','unknownMass'].some(k=>o[k][left]<o[k][right]);
 if(rule==='leading-only'){const a=e.adapter.state.arrays;return a[ARRAY.TANK_STARS][0]>a[ARRAY.TANK_STARS][1];}
 return false;
}
function preference(rule,e,left,right){
 if(rule==='noop'||right<0)return null;
 if(e.riskController.strictlyDominates(left,right)&&permitted(rule,e,left,right))return 1;
 if(e.riskController.strictlyDominates(right,left)&&permitted(rule,e,right,left))return 0;
 return null;
}
function install(engine,mode,options={}){
 const audit=mode.startsWith('audit-');const parent=audit?mode.slice(6):mode;
 const spec=SPECS.find(s=>s.mode===mode)||(['noop','R15','R29'].includes(parent)?{parent,condition:audit?'full-dominance':'noop'}:null);assert.ok(spec,'UNKNOWN_SELECTIVE_RISK');
 installPath(engine,spec.parent==='R15'?'reference-half':spec.parent==='R29'?'turn-streak-extra-zero':'noop');
 const stats={mode,ownerCalls:0,comparisons:0,changedPreferences:0,bonusCalls:0,changedBonuses:0,mechanismChanges:0,eligiblePreferences:0,traceFrame:options.traceFrame??null,trace:[]};
 const owner=engine.basePolicy.owner,select=owner.selectOverride,better=owner.better;
 owner.selectOverride=function(...args){stats.ownerCalls++;return select.apply(this,args);};
 owner.better=function(e,row,best,value,bestValue,nominal,bestNominal){
  stats.comparisons++;const before=better.call(this,e,row,best,value,bestValue,nominal,bestNominal);
  const choice=preference(spec.condition,e,row,best),after=choice??before;
  stats.eligiblePreferences+=Number(choice!==null);
  if(!!before!==!!after){stats.changedPreferences++;stats.mechanismChanges++;}
  const a=e.adapter.state.arrays;
  if(stats.traceFrame!==null&&a[ARRAY.SCALAR][SCALAR.FRAME]===stats.traceFrame&&best>=0){
   const risk=e.riskController.outcome,values=i=>Object.fromEntries(FIELDS.map(k=>[k,risk[k]?.[i]??null]));
   stats.trace.push({row,best,action:e.ourActions[row],bestAction:e.ourActions[best],value,bestValue,nominal,bestNominal,
    before,after,ownStars:a[ARRAY.TANK_STARS][0],enemyStars:a[ARRAY.TANK_STARS][1],rowRisk:values(row),bestRisk:values(best),
    rowDominates:!!e.riskController.strictlyDominates(row,best),bestDominates:!!e.riskController.strictlyDominates(best,row)});
  }
  return after;
 };
 return stats;
}
module.exports={RULES,SPECS,FIELDS,permitted,preference,install};
