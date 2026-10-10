'use strict';
// Pinned simulator domain only. These lemmas are not production certificates.
const DELTA=Object.freeze({up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]});
function inspectPhase(sim,seat,oldOwnIds){
 const own=sim.players[seat],enemy=sim.players[seat^1];
 if(own.stars<=enemy.stars)return 'NONPOSITIVE_MARGIN';
 if(enemy.crashed)return 'ENEMY_ALREADY_DEAD';
 if(enemy.effects.self?.type==='shield')return 'SHIELD_OUTSIDE_DOMAIN';
 if(sim.bombs.some(b=>!b.exploded&&b.explodesAt<=sim.frame))return 'DUE_BOMB';
 for(const b of sim.bullets){
  if(b.crashed||b.ownerIndex!==seat||oldOwnIds.has(b.objectId))continue;
  const delta=DELTA[b.direction];if(!delta)return 'INVALID_DIRECTION';
  let [x,y]=b.position;
  for(let n=0;n<2;n++){
   x+=delta[0];y+=delta[1];
   if(x<0||y<0||x>=sim.map.length||y>=sim.map[x].length)break;
   // Conservatively require an already clear ray: later dirt destruction can
   // only remove blockers, never introduce one. Do not rely on its occurrence.
   if(sim.map[x][y]==='x'||sim.map[x][y]==='m')break;
   if(x===enemy.position[0]&&y===enemy.position[1])return 'CLEAR_FRESH_SHOT';
   if(!own.crashed&&x===own.position[0]&&y===own.position[1])break;
  }
 }
 return 'NO_CLEAR_FRESH_SHOT';
}
function inspectEarlyTerminal(sim,seat){
 const own=sim.players[seat],enemy=sim.players[seat^1];
 return sim.result&&sim.result.winner===seat&&enemy.crashed&&own.stars>enemy.stars?
  'EARLY_TERMINAL_LEADING_WIN':'UNSUPPORTED_EARLY_EXIT';
}
module.exports={inspectPhase,inspectEarlyTerminal};
