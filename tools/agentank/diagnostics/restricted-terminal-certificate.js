'use strict';
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME,FAST_STATUS}=require('../../../engine-v2/src/abi/fast-codes');
const {evaluateShadow}=require('./single-frame-terminal-evidence');
const {inspectObservationBoundary}=require('./terminal-observation-boundary');
const ACTIONS=Object.freeze([0,1,2,3,4,5,8]);
// Consumes freshly computed evidence, never a serialized certificate supplied
// by a caller. Exported fold is for negative testing, not an authority API.
function foldRestricted(e,boundary,binding){
 const reasons=[];
 if(e.frame!==binding.frame||e.sourceHashLo!==binding.hashLo||e.sourceHashHi!==binding.hashHi||e.action!==4)reasons.push('ROOT_BINDING');
 if(e.entryPremise!=='CONDITIONAL_ENTRY_SUPPORTED')reasons.push('ENTRY');
 if(boundary.status!=='OBSERVATION_BOUNDARY_SUPPORTED'||boundary.reasons.length)reasons.push('OBSERVATION_BOUNDARY');
 if(e.conditions?.enemyVisible!==true||e.conditions?.symmetricStun!==true||e.conditions?.fireGenerated!==true||e.conditions?.hardAllowed!==true)reasons.push('ROOT_CONDITIONS');
 if(!Number.isInteger(e.informationGapMask)||e.informationGapMask<0||(e.informationGapMask&~8192)!==0)reasons.push('INFORMATION_DOMAIN');
 const expected=binding.enemyStunned?10:7,seen=new Set();let noneSupported=false;
 if(e.expected!==expected||e.seen!==expected||e.cells.length!==expected||e.wins!==expected||e.losses!==0||e.draws!==0||e.unresolved!==0)reasons.push('INCOMPLETE_OR_NONWIN');
 for(const c of e.cells){
  const maxChance=binding.enemyStunned&&c.enemyAction>=1&&c.enemyAction<=3?2:1;
  const key=`${c.enemyAction}:${c.chance1}`;
  if(!ACTIONS.includes(c.enemyAction)||c.chance0!==0||!Number.isInteger(c.chance1)||c.chance1<0||c.chance1>=maxChance||seen.has(key))reasons.push('RESPONSE_DOMAIN');
  seen.add(key);
  const normalized=c.enemyAction===8&&binding.enemyStunCooldown?0:c.enemyAction;
  if(c.normalizedEnemyAction!==normalized)reasons.push('RESPONSE_NORMALIZATION');
  // Early action-phase terminal is intentionally excluded until the two
  // kernels' phase relation is independently supported for that branch.
  const supported=c.result==='WIN'&&c.status===FAST_STATUS.APPLIED_TERMINAL&&c.enemyCrash===1&&c.ballisticWitness==='FRESH_SHOT_CLEAR_HIT';
  if(!supported)reasons.push('BALLISTIC_TERMINAL');
  if(c.enemyAction===0&&c.chance1===0&&supported)noneSupported=true;
 }
 if(!noneSupported)reasons.push('FIRE_SUPPRESSION_UNCOVERED');
 return {status:reasons.length?'BLOCKED':'SUPPORTED_LOCAL_CERTIFICATE',reasons:[...new Set(reasons)],
  frame:binding.frame,hashLo:binding.hashLo,hashHi:binding.hashHi,action:4,row:e.row,
  expected,seen:e.cells.length,authority:'PINNED_RULE_STUN_ONE_FRAME_DIAGNOSTIC',strictProof:false,actionOverride:false};
}
function evaluateRestrictedTerminal(engine,context,budget=64){
 const s=engine.adapter.state,a=s.arrays,frame=a[A.SCALAR][S.FRAME],until=a[A.TANK_STUN_UNTIL][1];
 const binding={frame,hashLo:s.hashLo,hashHi:s.hashHi,enemyStunned:until!==NONE_FRAME&&until>frame,
  enemyStunCooldown:a[A.TANK_SKILL_READY][1]!==NONE_FRAME&&a[A.TANK_SKILL_READY][1]>frame};
 const boundary=inspectObservationBoundary(engine.adapter,context);
 const evidence=evaluateShadow(engine,budget,true,true);
 if(s.hashLo!==binding.hashLo||s.hashHi!==binding.hashHi||a[A.SCALAR][S.FRAME]!==frame)throw Error('CERTIFICATE_ROOT_RESTORE');
 return foldRestricted(evidence,boundary,binding);
}
module.exports={evaluateRestrictedTerminal,foldRestricted};
