'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicySearch:Configurable}=require('../../engine-v2/src/base-policy/policy-search');
const {SEARCH_CAPACITY}=require('../../engine-v2/src/generated/search-config');
// Extract the actual root reducer (including mask skips), not a duplicate formula.
const source=S.prototype.prepare.toString(),start=source.indexOf('let worst = VALUE_MAX;'),end=source.indexOf('const rowMask',start);
assert.ok(start>=0&&end>start);
const reduce=new Function('engine','state','SEARCH_CAPACITY',
 `const row=0,cellBudget=128;let rowNodes=0;const VALUE_MAX=32000;${source.slice(start,end)}`);
test('root reducer starts at first active response, including reversed order and zero nominal weight',()=>{
 for(const reverse of [false,true])for(const values of [[100000,60000],[-100000,-60000]]){
  const s={rootEnemyDomainMask:[0,1,1],rootCellScore:new Int32Array(32),rootNominalCellScore:new Int32Array(32),
   rootScore:new Int32Array(1),rootNominalScore:new Int32Array(1),currentBlendBasisPoints:0,
   rootColumnIndex:(step)=>reverse?2-step:step,opponentWeight:()=>0,
   rootCell(e,r,c){this.lastNominalValue=values[c-1];return values[c-1];},blended:S.prototype.blended};
  reduce.call(s,{enemyCount:3,enemyActions:[0,1,2]},null,SEARCH_CAPACITY);
  assert.equal(s.rootScore[0],Math.min(...values));assert.equal(s.rootNominalScore[0],Math.min(...values));
 }
});
test('configurable own-chance worst starts with first populated chance, not 32000',()=>{
 const text=Configurable.prototype.transitionValue.toString();
 const a=text.indexOf('if (ownCount) {'),b=text.indexOf('if (this.hardBudgetInterrupt',a);
 assert.ok(a>=0&&b>a);
 const step=new Function('ownSum','ownNominalSum','ownCount','count','prior',
  `let worstOwn=prior[0],worstOwnNominal=prior[1];${text.slice(a,b)}return [worstOwn,worstOwnNominal];`);
 let result=step(200000,180000,2,2,[32000,32000]);assert.deepEqual(result,[100000,90000]);
 result=step(120000,100000,2,4,result);assert.deepEqual(result,[60000,50000]);
 result=step(120000,80000,2,6,result);assert.deepEqual(result,[60000,40000]);
});
