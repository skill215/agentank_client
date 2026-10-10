'use strict';
const {FIELDS,distances}=require('./fast-star-trace');const {fastView}=require('./transition-ranking-diagnostic');
const TIED=[...FIELDS,'expectedValue','tacticalValue','robustLower'];
function tied(o,l,r){return TIED.every(k=>Number.isFinite(o[k]?.[l])&&o[k][l]===o[k][r])&&(!o.searchEstimateEnabled||o.searchEstimate[l]===o.searchEstimate[r]);}
function install(e,log){const old=e.strategyBands.baseBetter.bind(e.strategyBands);let cache;
 e.strategyBands.baseBetter=(o,l,r)=>{const baseline=old(o,l,r);if(e.lastControlMode!==3||r<0||![l,r].every(i=>[1,2,3].includes(e.ourActions[i])&&e.hardStatus[i]===0&&o.acceptable[i]&&!o.dominated[i])||!tied(o,l,r))return baseline;
 if(cache===undefined){const v=fastView(e.adapter.state);cache=Object.values(v.tanks[0].effects).some(x=>x>0)?null:distances(e.adapter.state);}if(!cache)return baseline;
 if(![l,r].every(i=>e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,i,e.ourCount)))return baseline;
 const d=i=>cache[e.projectedCell[i]*4+e.projectedDirection[i]],dl=d(l),dr=d(r);if(dl<0||dr<0||dl===dr)return baseline;const result=Number(dl<dr);if(result!==Number(baseline))log({left:l,right:r,leftAction:e.ourActions[l],rightAction:e.ourActions[r],leftSteps:dl+1,rightSteps:dr+1});return result;
 };return ()=>cache=undefined;
}
async function runJob(job,ctx){const assert=require('node:assert/strict'),arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,old=Bot.prototype.decide,changes=[];let frame;
 Bot.prototype.decide=function(c){frame=c.game.frames;if(!this.anchorReset)this.anchorReset=install(this.engine,x=>changes.push({frame,...x}));this.anchorReset();return old.call(this,c);};
 const r=await require('./fresh-game-escape-adapter').runJob({...job,enabled:false},ctx);
 if(job.preflight){const baseline=JSON.parse(ctx.readFrozen(job.previousFile));assert.ok(changes.length>0,'NO_COMPARATOR_TRIGGER');assert.notEqual(r.signature,baseline.signature,'NO_BEHAVIOR_TRIGGER');assert.notEqual(Buffer.from(r.row.candidate.compactActionStream,'base64')[0],Buffer.from(baseline.row.candidate.compactActionStream,'base64')[0],'NO_FRAME_ZERO_CHANGE');}
 return {...r,anchorChanges:changes,candidateId:'star-anchor-route-v1'};
}
module.exports={tied,TIED,install,runJob};
