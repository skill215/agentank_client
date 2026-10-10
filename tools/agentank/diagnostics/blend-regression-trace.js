'use strict';
const assert=require('node:assert/strict');
async function runJob(job,ctx){const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,decide=Bot.prototype.decide,trace=require('./fast-star-trace').trace,frames=[];
 Bot.prototype.decide=function(c){const r=decide.call(this,c),s=this.engine.basePolicy.policySearch;frames.push({...trace(this.engine),blend:s.currentBlendBasisPoints,opponentObservations:s.oracleOpponentObservations,opponentMode:s.opponentMode});return r;};
 const r=await require('./opponent-skill-screen').runJob(job,ctx),previous=JSON.parse(ctx.readFrozen(job.previousFile));assert.equal(r.signature,previous.signature,'TRACE_REPLAY_DRIFT');return {...r,framesTrace:frames,traceExact:true};
}
module.exports={runJob};
