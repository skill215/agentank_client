'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ACTION}=require('../../engine-v2/src/abi/fast-codes');
const {allowedActions,firstDifference,prefixMatches,jobKey}=require('../../tools/agentank/diagnostics/persistent-death-design');
const row=(a,b=a,args=[])=>({candidate:{compactActionStream:Buffer.from(a).toString('base64'),compactArguments:args},control:{compactActionStream:Buffer.from(b).toString('base64'),compactArguments:[]}});
test('counterfactual legal domain intersects Hard and finalGate and excludes parameterized actions',()=>{
 assert.deepEqual(allowedActions({candidates:[{action:1,hard:0,finalAllowed:true},{action:1,hard:0,finalAllowed:true},{action:2,hard:1,finalAllowed:true},{action:3,hard:0,finalAllowed:false},{action:ACTION.NONE,hard:0,finalAllowed:true},{action:ACTION.CAST_TELEPORT,hard:0,finalAllowed:true}]}),[1]);
});
test('counterfactual prefix rejects opponent and argument drift and missing intervention',()=>{
 const a=row([1,2,3]);assert.equal(prefixMatches(a,row([1,4,3],[1,2,3]),1,4),true);
 assert.equal(prefixMatches(a,row([1,4,3],[2,2,3]),1,4),false);
 assert.equal(prefixMatches(a,row([1,4,3],[1,2,3],[[0,2,4]]),1,4),false);
 assert.equal(prefixMatches(a,row([1]),1,4),false);
});
test('first difference accounts for action arguments and does not invent a root after terminal',()=>{
 assert.equal(firstDifference(row([1,2]),row([1,3])),1);
 assert.equal(firstDifference(row([1,2]),row([1,2],[1,2],[[0,3,4]])),0);
 assert.equal(firstDifference(row([1]),row([1,2])),null);
});
test('branch identity keeps modes, seats, frames and actions separate',()=>{
 const a={id:'s',seat:0,mode:'R15',frame:3,action:1};
 assert.equal(new Set([a,{...a,seat:1},{...a,mode:'R29'},{...a,frame:4},{...a,action:2}].map(jobKey)).size,5);
});
test('ten-round plan uses fixed offsets, all-seed first roots, regression-only tails and deduplicated branches',()=>{
 const {createPlan}=require('../../tools/agentank/diagnostics/persistent-death-design');
 const cells=['R15','R29'].map(mode=>({id:'s',seat:0,mode,seed:1,parent:'p'}));
 const make=(mode,baseline=false)=>({...row(Array.from({length:15},(_,i)=>i===3&&!baseline?2:1)),
   matchUrlId:'s',candidateSeat:0,variant:{mode},analysisOutcome:baseline?'DRAW':'V1_WIN',terminalCategory:baseline?'FRAME_LIMIT_EQUAL_STARS':'SINGLE_CRASH',result:{reason:'test'},
   roots:Array.from({length:15},(_,i)=>({frame:i,selectedAction:i===3?2:1,candidates:[1,2].map(action=>({action,hard:0,finalAllowed:true}))}))});
 const rs=cells.map(c=>make(c.mode)),plan=createPlan(cells,rs,[make('baseline',true)],rs);
 assert.equal(plan.rounds.length,10);assert.deepEqual(plan.rounds.slice(4).map(r=>r.cases[0].index),[12,12,9,9,5,5]);
 assert.equal(plan.rounds[0].cases[0].wanted,1);
 assert.equal(new Set(plan.branchJobs.map(jobKey)).size,plan.branchJobs.length);
 assert.equal(plan.branchJobs.length,8); // restore-first and oracle-first share a branch
 const controls=rs.map(r=>({...r,analysisOutcome:'DRAW',terminalCategory:'FRAME_LIMIT_EQUAL_STARS'}));
 const p=createPlan(cells,controls,[make('baseline',true)],controls);
 assert.equal(p.rounds[0].cases.length,1);assert.equal(p.rounds[4].cases.length,0);
});
