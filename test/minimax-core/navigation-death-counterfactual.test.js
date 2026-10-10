'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classifyBranch}=require('../../tools/agentank/diagnostics/navigation-death-counterfactual');
const base={frames:40},m=(frames,crashes,outcome='V1_WIN')=>({frames,candidateSeat:0,counts:{crashes},analysisOutcome:outcome});
test('death counterfactual separates deadline survival from eventual recovery',()=>{
 const later=classifyBranch(base,m(41,[1,0]),true);assert.equal(later.survivedOriginalDeadline,true);assert.equal(later.analysisRecovered,false);
 assert.equal(classifyBranch(base,m(40,[1,0]),true).survivedOriginalDeadline,false);
 assert.equal(classifyBranch(base,m(40,[0,1],'V2_WIN'),true).survivedOriginalDeadline,true);
 const trade=classifyBranch(base,m(40,[1,1],'DRAW'),true);assert.equal(trade.survivedOriginalDeadline,false);assert.equal(trade.analysisRecovered,true);
});
test('blocked intervention never becomes an escape witness',()=>{const r=classifyBranch(base,m(128,[0,0],'V2_WIN'),false);assert.equal(r.status,'FINAL_GATE_BLOCKED');assert.equal(r.survivedOriginalDeadline,false);assert.equal(r.analysisRecovered,false);});
