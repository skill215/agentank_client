'use strict';
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {TERRAIN,NONE_FRAME,DX,DY}=require('../../../engine-v2/src/abi/fast-codes');
const {RULE}=require('../../../engine-v2/src/generated/fast-config');

// Called after actions/star collection, before projectile advancement.
// Conditional lemma only: assumes action-before-projectile, no bullet-bullet
// cancellation, no resurrection, no fresh blockers and end-of-phase settlement.
function inspectBallisticWitness(state){
 const a=state.arrays,frame=a[ARRAY.SCALAR][SCALAR.FRAME];
 if(a[ARRAY.TANK_STARS][0]<=a[ARRAY.TANK_STARS][1])return 'NONPOSITIVE_SETTLEMENT_MARGIN';
 for(let i=0;i<a[ARRAY.BOMB_ACTIVE].length;i++)if(a[ARRAY.BOMB_ACTIVE][i]&&a[ARRAY.BOMB_EXPLODE][i]<=frame)return 'DUE_BOMB';
 if(a[ARRAY.TANK_CRASH][1])return 'ENEMY_ALREADY_DEAD';
 if(a[ARRAY.TANK_SHIELD_UNTIL][1]!==NONE_FRAME&&a[ARRAY.TANK_SHIELD_UNTIL][1]>frame&&a[ARRAY.TANK_SHIELD_HITS][1]>0)return 'ENEMY_SHIELD';
 const target=a[ARRAY.TANK_CELL][1],own=a[ARRAY.TANK_CELL][0];
 for(let i=0;i<a[ARRAY.PROJECTILE_ACTIVE].length;i++){
  if(!a[ARRAY.PROJECTILE_ACTIVE][i]||a[ARRAY.PROJECTILE_OWNER][i]!==0||a[ARRAY.PROJECTILE_CREATED][i]!==frame)continue;
  const direction=a[ARRAY.PROJECTILE_DIR][i];let cell=a[ARRAY.PROJECTILE_CELL][i];
  for(let step=0;step<RULE.PROJECTILE_STEPS;step++){
   const x=state.x(cell)+DX[direction],y=state.y(cell)+DY[direction];
   if(x<0||x>=state.width||y<0||y>=state.height)break;
   cell=state.cell(x,y);if(a[ARRAY.TERRAIN][cell]===TERRAIN.WALL||a[ARRAY.TERRAIN][cell]===TERRAIN.DIRT)break;
   if(cell===target)return 'FRESH_SHOT_CLEAR_HIT';
   if(cell===own&&!a[ARRAY.TANK_CRASH][0])break;
  }
 }
 return 'NO_GUARANTEED_FRESH_SHOT';
}
function witnessSupports(witness){return witness==='FRESH_SHOT_CLEAR_HIT'||witness==='ENEMY_ALREADY_DEAD';}
module.exports={inspectBallisticWitness,witnessSupports};
