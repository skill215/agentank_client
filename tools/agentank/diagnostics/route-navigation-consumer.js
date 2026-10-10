'use strict';
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {ACTION,HARD_STATUS,NONE_CELL,NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const {PoseRouteField}=require('./pose-route-field');
const UNSUPPORTED_EFFECTS=Object.freeze([ARRAY.TANK_STUN_UNTIL,ARRAY.TANK_FROZEN_UNTIL,ARRAY.TANK_BOOST_UNTIL,ARRAY.TANK_POISON_UNTIL]);
// Experimental soft evidence only. No action selection, Hard or Risk mutation.
class RouteNavigationConsumer {
 constructor(maxCells,maxActions){this.field=new PoseRouteField(maxCells);this.progress=new Int16Array(maxActions);this.known=new Uint8Array(maxActions);this.count=0;this.enabled=false;}
 prepare(engine,count){
  if(count<0||count>this.known.length)throw RangeError('ROUTE_ACTION_CAPACITY');
  this.count=count;this.enabled=false;this.known.fill(0,0,count);this.progress.fill(0,0,count);
  const s=engine.adapter.state,a=s.arrays,f=a[ARRAY.SCALAR][SCALAR.FRAME],star=a[ARRAY.SCALAR][SCALAR.STAR_CELL];
  if(star===NONE_CELL||!engine.adapter.enemyVisible||engine.escapeObligation.committedEntityCount>0)return false;
  if(engine.manhattan(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1])<=9||engine.clearLine(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]))return false;
  for(const k of UNSUPPORTED_EFFECTS)if(a[k][0]!==NONE_FRAME&&a[k][0]>f)return false;
  if(!this.field.prepare(s,star))return false;this.enabled=true;
  for(let row=0;row<count;row++){const action=engine.ourActions[row];if(action!==ACTION.GO&&action!==ACTION.TURN_LEFT&&action!==ACTION.TURN_RIGHT)continue;
   if(engine.hardStatus[row]!==HARD_STATUS.ALLOW)continue;
   const p=this.field.progress(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_DIR][0],engine.projectedCell[row],engine.projectedDirection[row]);if(p===null)continue;this.known[row]=1;this.progress[row]=p;
  }return true;
 }
 score(engine,row,original){
  if(!this.known[row])return original;const a=engine.adapter.state.arrays,star=a[ARRAY.SCALAR][SCALAR.STAR_CELL];
  const prior=engine.ourActions[row]===ACTION.GO?(engine.manhattan(a[ARRAY.TANK_CELL][0],star)-engine.manhattan(engine.projectedCell[row],star))*1650:0;
  return original-prior+1650*this.progress[row];
 }
 contributes(row){return row>=0&&row<this.count&&this.known[row]&&this.progress[row]>0?1:0;}
 // Separate soft route evidence, deliberately not STAR_COLLECT or TERMINAL_REVERSAL.
 copyEvidence(progress,known){progress.set(this.progress);known.set(this.known);}
}
module.exports={RouteNavigationConsumer};
