'use strict';
function blend(value,variant){return variant==='reward'?Math.min(7000,value*2):variant==='risk'?0:value;}
async function runJob(job,ctx){const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,decide=Bot.prototype.decide,work={transitions:0,depthChanges:0,blendChanges:0,roots:0};
 Bot.prototype.decide=function(c){if(!this.multiInstalled){this.multiInstalled=true;const search=this.engine.basePolicy.policySearch,set=search.setOracleOpponentContext.bind(search),depth=search.scheduledDepth.bind(search),bind=search.bindIsolatedHard.bind(search),wrapped=new WeakSet();
 search.setOracleOpponentContext=x=>{set(x);const before=search.currentBlendBasisPoints;search.currentBlendBasisPoints=blend(before,job.variant);if(search.currentBlendBasisPoints!==before)work.blendChanges++;};
 search.scheduledDepth=e=>{work.roots++;const before=depth(e),after=job.variant==='cost'?Math.min(2,before):before;if(after!==before)work.depthChanges++;return after;};
 search.bindIsolatedHard=(...args)=>{const r=bind(...args),k=search.diagnosticKernel;if(k&&!wrapped.has(k)){wrapped.add(k);const apply=k.applyFrame.bind(k);k.applyFrame=(...xs)=>{work.transitions++;return apply(...xs);};}return r;};
 }return decide.call(this,c);};
 const r=await require('./fresh-game-escape-adapter').runJob({...job,enabled:false},ctx);if(job.variant==='baseline'){const b=JSON.parse(ctx.readFrozen(job.previousFile));require('node:assert/strict').equal(r.signature,b.signature,'BASELINE_DRIFT');}
 return {...r,variant:job.variant,work,scope:'Multiobjective local screen; transitions are a deterministic work proxy, not target-runtime performance.'};
}
module.exports={blend,runJob};
