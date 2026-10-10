'use strict';
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME,DX,DY,TERRAIN}=require('../../../engine-v2/src/abi/fast-codes');
const {RULE}=require('../../../engine-v2/src/generated/fast-config');
const {inspectTerminalEntry}=require('./terminal-entry-premises');
const {inspectObservationBoundary}=require('./terminal-observation-boundary');
const {evaluateRestrictedTerminal}=require('./restricted-terminal-certificate');
// Necessary condition of the mandatory enemy-NONE witness. No action moves
// either tank before the ballistic phase. No projectile has advanced yet.
function noneWitnessPossible(s){
 const a=s.arrays,own=a[A.TANK_CELL][0],enemy=a[A.TANK_CELL][1],star=a[A.SCALAR][S.STAR_CELL],frame=a[A.SCALAR][S.FRAME];
 const active=v=>v!==NONE_FRAME&&v>frame;
 const ownStars=a[A.TANK_STARS][0]+(star===own&&!active(a[A.TANK_PICKUP_LOCK][0])?1:0);
 const enemyStars=a[A.TANK_STARS][1]+(star===enemy&&!active(a[A.TANK_PICKUP_LOCK][1])?1:0);
 if(ownStars<=enemyStars)return false;
 const direction=a[A.TANK_DIR][0];let x=s.x(own),y=s.y(own);
 for(let n=0;n<RULE.PROJECTILE_STEPS;n++){x+=DX[direction];y+=DY[direction];if(x<0||x>=s.width||y<0||y>=s.height)return false;const cell=y*s.width+x,tile=a[A.TERRAIN][cell];if(tile===TERRAIN.WALL||tile===TERRAIN.DIRT)return false;if(cell===enemy)return true;}
 return false;
}
function evaluatePrefiltered(engine,context,action,budget=64){
 if(action===4)return null; // Action equivalence, not certificate equivalence.
 let row=-1;for(let i=0;i<engine.ourCount;i++)if(engine.ourActions[i]===4)row=i;
 const d=engine.adapter;
 if(inspectTerminalEntry(d.state,!!d.enemyVisible,d.informationGapMask,row>=0,row>=0&&engine.hardStatus[row]===0)!=='CONDITIONAL_ENTRY_SUPPORTED')return null;
 if(!noneWitnessPossible(d.state))return null;
 if(inspectObservationBoundary(d,context).status!=='OBSERVATION_BOUNDARY_SUPPORTED')return null;
 return evaluateRestrictedTerminal(engine,context,budget);
}
module.exports={noneWitnessPossible,evaluatePrefiltered};
