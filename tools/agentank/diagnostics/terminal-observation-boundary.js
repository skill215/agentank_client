'use strict';
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const DIR={up:0,right:1,down:2,left:3},TILE={'.':0,x:1,m:2,o:3};
// Diagnostic boundary audit. Never infer absence from a visibility-filtered set.
function inspectObservationBoundary(adapter,context){
 const reasons=[],s=adapter.state,a=s.arrays,g=context.game;
 const frame=a[A.SCALAR][S.FRAME];
 if(g?.frames!==frame)reasons.push('FRAME_MISMATCH');
 if(adapter.enemyCapabilitySupportComplete!==1||adapter.enemyCapabilityReason!==0)reasons.push('CAPABILITY_INCOMPLETE');
 if(adapter.tracker.complete!==1)reasons.push('TRACKER_INCOMPLETE');
 if(!Number.isInteger(adapter.informationGapMask)||adapter.informationGapMask<0||(adapter.informationGapMask&~8192)!==0)reasons.push('OTHER_INFORMATION_GAP');
 const cell=p=>Array.isArray(p)&&p.length===2&&Number.isInteger(p[0])&&Number.isInteger(p[1])&&p[0]>=0&&p[0]<s.width&&p[1]>=0&&p[1]<s.height?p[1]*s.width+p[0]:-1;
 for(const [seat,side]of [[0,context.me],[1,context.enemy]]){
  const status=side?.status;
  if(status?.bombActive!==false)reasons.push(`BOMB_ABSENCE_UNPROVED_${seat}`);
  if(status?.canActThisFrame!==true||status?.actionSpeed!==1||status?.fireLocked!==false)reasons.push(`ACTION_CAPABILITY_${seat}`);
  if(!side?.tank||cell(side.tank.position)!==a[A.TANK_CELL][seat]||DIR[side.tank.direction]!==a[A.TANK_DIR][seat]||side.tank.crashed===true)reasons.push(`POSE_MISMATCH_${seat}`);
  if(!Number.isSafeInteger(side?.stars)||side.stars<0||side.stars!==a[A.TANK_STARS][seat])reasons.push(`STARS_MISMATCH_${seat}`);
  if(side?.skill?.type!=='stun'||!Number.isSafeInteger(side.skill.remainingCooldownFrames)||side.skill.remainingCooldownFrames<0||frame+side.skill.remainingCooldownFrames!==a[A.TANK_SKILL_READY][seat])reasons.push(`SKILL_MISMATCH_${seat}`);
  if(!side?.effects||side.effects.self!==null||!(side.effects.debuff===null||side.effects.debuff?.type==='stun'))reasons.push(`EFFECT_DOMAIN_${seat}`);
 }
 if(!Array.isArray(g?.bombs)||g.bombs.length!==0)reasons.push('VISIBLE_BOMB_DOMAIN');
 if(!(context.me?.bullet===null||Array.isArray(context.me?.bullet)&&context.me.bullet.length===0))reasons.push('OWN_BULLET_PRESENT_OR_UNKNOWN');
 const star=g?.star===null?NONE_CELL:cell(g?.star);if(star<0||star!==a[A.SCALAR][S.STAR_CELL])reasons.push('STAR_MISMATCH');
 let mapOK=Array.isArray(g?.map)&&g.map.length===s.width;
 if(mapOK)for(let x=0;x<s.width;x++){if(!Array.isArray(g.map[x])||g.map[x].length!==s.height){mapOK=false;break;}for(let y=0;y<s.height;y++)if(TILE[g.map[x][y]]!==a[A.TERRAIN][y*s.width+x])mapOK=false;}
 if(!mapOK)reasons.push('TERRAIN_MISMATCH');
 return {status:reasons.length?'BLOCKED':'OBSERVATION_BOUNDARY_SUPPORTED',reasons,
  enemyCapabilitySupportComplete:adapter.enemyCapabilitySupportComplete,enemyCapabilityReason:adapter.enemyCapabilityReason,
  bombActive:[context.me?.status?.bombActive??null,context.enemy?.status?.bombActive??null],
  visibleBombCount:Array.isArray(g?.bombs)?g.bombs.length:null,informationGapMask:adapter.informationGapMask,
  authority:'OBSERVATION_ONLY_DIAGNOSTIC',strictProof:false};
}
module.exports={inspectObservationBoundary};
