'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBasePolicyEngine}=require('../../engine-v2/src/runtime/native-base-policy-engine');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
const {routeDistance}=require('../../tools/agentank/diagnostics/admission-navigation-audit');
test('diagnostic counterexample: Manhattan progress penalizes a necessary obstacle detour',()=>{
 const state=new FastState(5,5),a=state.arrays;a[ARRAY.TERRAIN].fill(1);for(const c of [6,7,8,11,13])a[ARRAY.TERRAIN][c]=0;
 a[ARRAY.TANK_CELL][0]=11;a[ARRAY.TANK_CELL][1]=23;a[ARRAY.TANK_STARS].fill(0);a[ARRAY.TANK_SHIELD_HITS].fill(0);a[ARRAY.SCALAR][SCALAR.STAR_CELL]=13;a[ARRAY.SCALAR][SCALAR.FRAME]=10;
 const manhattan=(x,y)=>Math.abs(x%5-y%5)+Math.abs(Math.floor(x/5)-Math.floor(y/5));
 const engine={ourActions:[1,2,3],hardStatus:[0,0,0],projectedCell:[6,11,11],projectedDirection:[0,3,1],adapter:{state,enemyVisible:true,ownCanFire:1,ownBombReady:1,ownSkillReady:0},lastAction:2,goStallStreak:0,manhattan,countMobility:c=>c===6?3:2,directionTo:()=>-1};
 assert.equal(routeDistance(state,11,13),4);assert.equal(routeDistance(state,6,13),3);assert.equal(manhattan(6,13)-manhattan(11,13),1);
 const score=row=>NativeBasePolicyEngine.prototype.actionScore.call(engine,row);
 // Documents existing failure, not a desired future navigation contract.
 assert.equal(score(1)-score(0),760);assert.equal(score(1)-score(2),60);
});
