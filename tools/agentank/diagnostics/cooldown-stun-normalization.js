'use strict';
const {ACTION,SKILL,NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
// Terminal-physical-value equivalence only. Failure event streams are different.
function normalizeCooldownStun(action,skill,readyFrame,frame,cooldownKnown){
 if(action!==ACTION.CAST_STUN||skill!==SKILL.STUN||cooldownKnown!==true||
   !Number.isSafeInteger(frame)||frame<0||!Number.isSafeInteger(readyFrame)||
   readyFrame===NONE_FRAME||readyFrame<=frame)return action;
 return ACTION.NONE;
}
module.exports={normalizeCooldownStun};
