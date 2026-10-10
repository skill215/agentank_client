'use strict';
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {SKILL,NONE_FRAME,TERMINAL}=require('../../../engine-v2/src/abi/fast-codes');
// Narrow root-domain check, NOT a completeness certificate for hidden worlds.
// Projectile capacity and converging-resource kernel support remain separate.
function inspectTerminalEntry(state,visible,gapMask,fireGenerated,hardAllowed){
 const a=state.arrays,f=a[A.SCALAR][S.FRAME];
 if(!visible)return 'ENEMY_HIDDEN';
 if(!Number.isInteger(gapMask)||gapMask<0||(gapMask&~8192)!==0)return 'OTHER_INFORMATION_GAP';
 if(!fireGenerated||!hardAllowed)return 'FIRE_NOT_ALLOWED';
 if(a[A.SCALAR][S.TERMINAL_CODE]!==TERMINAL.NONE||a[A.TANK_CRASH][0]||a[A.TANK_CRASH][1])return 'NOT_LIVE_ROOT';
 if(a[A.TANK_SKILL][0]!==SKILL.STUN||a[A.TANK_SKILL][1]!==SKILL.STUN)return 'OUTSIDE_STUN_DOMAIN';
 for(let seat=0;seat<2;seat++){
  if(a[A.TANK_CELL][seat]>=state.cells||a[A.TANK_DIR][seat]>3)return 'INVALID_POSE';
  for(const id of EFFECTS){const until=a[id][seat];if(until!==NONE_FRAME&&until>f)return 'OUTSIDE_EFFECT_DOMAIN';}
 }
 const lock=a[A.TANK_FIRE_LOCK][0];if(lock!==NONE_FRAME&&lock>f)return 'OWN_FIRE_LOCK';
 for(let i=0;i<a[A.BOMB_ACTIVE].length;i++)if(a[A.BOMB_ACTIVE][i])return 'ACTIVE_BOMB_OUTSIDE_DOMAIN';
 for(let i=0;i<a[A.PROJECTILE_ACTIVE].length;i++)if(a[A.PROJECTILE_ACTIVE][i]&&a[A.PROJECTILE_OWNER][i]===0)return 'OWN_PROJECTILE_BLOCKS_FIRE';
 return 'CONDITIONAL_ENTRY_SUPPORTED';
}
const EFFECTS=Object.freeze([A.TANK_FROZEN_UNTIL,A.TANK_POISON_UNTIL,A.TANK_BOOST_UNTIL,A.TANK_OVERLOAD_UNTIL,A.TANK_CLOAK_UNTIL,A.TANK_SHIELD_UNTIL]);
module.exports={inspectTerminalEntry};
