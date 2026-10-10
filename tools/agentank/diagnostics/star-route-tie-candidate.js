'use strict';
const {FIELDS,distances}=require('./fast-star-trace');
const {fastView}=require('./transition-ranking-diagnostic');
const TIED=[...FIELDS,'expectedValue','robustLower','tacticalValue'];
function scoresTied(left,right,probability,o,bands,terminalLeft,terminalRight){return terminalLeft===terminalRight&&TIED.every(k=>Number.isFinite(o[k]?.[left])&&o[k][left]===o[k][right])&&bands.planContinuity[left]===bands.planContinuity[right]&&(!o.searchEstimateEnabled||o.searchEstimate[left]===o.searchEstimate[right])&&probability[left]===probability[right];}
function install(e,log){const arb=e.strategicArbiter,original=arb.neutralBetter.bind(arb);let cache=null;
 arb.neutralBetter=(left,right,probability,o,bands,globalMode)=>{
  const baseline=original(left,right,probability,o,bands,globalMode);
  if(e.lastControlMode!==3||left<0||right<0||![left,right].every(r=>[1,2,3].includes(e.ourActions[r])&&e.hardStatus[r]===0&&o.acceptable[r]&&!o.dominated[r]))return baseline;
  if(!scoresTied(left,right,probability,o,bands,arb.terminalRank(bands,left,globalMode),arb.terminalRank(bands,right,globalMode)))return baseline;
  if(!cache){const s=e.adapter.state,view=fastView(s);cache={view,route:null};if(!Object.values(view.tanks[0].effects).some(x=>x>0))cache.route=distances(s);}
  if(!cache.route)return baseline;
  if(![left,right].every(r=>e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,r,e.ourCount)))return baseline;
  const route=r=>cache.route[e.projectedCell[r]*4+e.projectedDirection[r]],a=route(left),b=route(right);
  if(a<0||b<0||a===b)return baseline;
  const chosen=a<b;if(Boolean(baseline)!==chosen)log({left,right,leftAction:e.ourActions[left],rightAction:e.ourActions[right],leftSteps:a+1,rightSteps:b+1});return Number(chosen);
 };return ()=>{cache=null;};
}
async function runJob(job,ctx){const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,old=Bot.prototype.decide,changes=[];let frame=0;Bot.prototype.decide=function(c){frame=c.game.frames;if(!this.starTieReset)this.starTieReset=install(this.engine,x=>changes.push({frame,...x}));this.starTieReset();return old.call(this,c);};const result=await require('./fresh-game-escape-adapter').runJob({...job,enabled:false},ctx);return {...result,tieChanges:changes,candidateId:'star-route-tie-v1'};}
module.exports={scoresTied,install,runJob,TIED};
