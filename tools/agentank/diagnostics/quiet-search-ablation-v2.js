'use strict';
const assert=require('node:assert/strict'),{fastView}=require('./transition-ranking-diagnostic');
function eligible(v,mode,visible,line){return mode===2&&visible&&!line&&v.tanks.every(t=>t.position&&!t.crashed)&&Math.abs(v.tanks[0].position[0]-v.tanks[1].position[0])+Math.abs(v.tanks[0].position[1]-v.tanks[1].position[1])>=7&&!v.projectiles.length&&!v.bombs.length&&!Object.values(v.tanks[0].effects).some(n=>n>0);}
async function runJob(job,ctx){const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,old=Bot.prototype.decide,skips=[];let frame;
 Bot.prototype.decide=function(c){frame=c.game.frames;if(!this.quietInstalled){this.quietInstalled=true;const e=this.engine,original=e.basePolicy.selectOverride.bind(e.basePolicy);
  e.basePolicy.selectOverride=(engine,row,action)=>{const v=fastView(e.adapter.state),s=e.adapter.state,p=v.tanks.map(t=>t.position);if(!eligible(v,e.lastControlMode,!!e.adapter.enemyVisible,p.every(Boolean)&&e.clearLine(s.cell(...p[0]),s.cell(...p[1]))))return original(engine,row,action);
   if(row<0||e.hardStatus[row]!==0||!e.riskController.outcome.acceptable[row]||!e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,row,e.ourCount))return original(engine,row,action);
   const mode=e.lastControlMode;skips.push({frame,action,distance:Math.abs(p[0][0]-p[1][0])+Math.abs(p[0][1]-p[1][1])});
   // Exercise the existing navigation early return, including observation updates.
   // Restore root mode even on error; do not patch physical state or emitted action.
   e.lastControlMode=3;try{return original(engine,row,action);}finally{e.lastControlMode=mode;}
  };}return old.call(this,c);};
 const r=await require('./fresh-game-escape-adapter').runJob({...job,enabled:false},ctx);
 if(job.preflight){const b=JSON.parse(ctx.readFrozen(job.previousFile));assert.ok(skips.length,'NO_ELIGIBLE_FRAME');assert.notEqual(r.signature,b.signature,'NO_BEHAVIOR_TRIGGER');}
 return {...r,quietSkips:skips,candidateId:'quiet-search-off-v1'};
}
module.exports={eligible,runJob};
