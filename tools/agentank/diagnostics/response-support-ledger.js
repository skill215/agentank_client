'use strict';
// Diagnostic support accounting only: no probabilities, scores, Hard or ownership writes.
class ResponseSupportLedger {
 constructor(){this.generatedMask=0;this.searchedMask=0;this.residualMask=0;this.complete=0;this.generatorComplete=0;}
 update(actions,allowed,count,generatorComplete=false){
  this.generatedMask=0;this.searchedMask=0;this.residualMask=0;this.complete=0;this.generatorComplete=0;
  if(!Number.isSafeInteger(count)||count<0||count>actions.length||count>allowed.length)throw Error('INVALID_COUNT');
  for(let i=0;i<count;i++){
   const a=actions[i];if(!Number.isInteger(a)||a<0||a>=24)throw Error('UNSUPPORTED_ACTION_ENCODING');
   const bit=1<<a;this.generatedMask|=bit;if(allowed[i])this.searchedMask|=bit;else this.residualMask|=bit;
  }
  // Duplicate/parameterized columns may differ; one searched representative
  // does not certify that an omitted column is equivalent.
  this.generatorComplete=generatorComplete?1:0;
  this.complete=this.generatorComplete&&count>0&&!this.residualMask?1:0;
  return this;
 }
}
function reason(action){return action===0?'PASSIVE_NONE_FILTER':action===5?'PASSIVE_BOMB_FILTER':
 action===4?'FIRE_QUALIFICATION':action===8?'STUN_QUALIFICATION':action===1?'MOTION_QUALIFICATION_UNRESOLVED':'UNRESOLVED';}
module.exports={ResponseSupportLedger,reason};
