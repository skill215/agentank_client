'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {effect}=require('../../tools/agentank/diagnostics/geometric-factorial');
test('factorial effects pair by scenario and seat rather than input order',()=>{
 const row=(seat,outcome)=>({matchUrlId:'a',candidateSeat:seat,analysisOutcome:outcome});
 const a=[row(0,'V1_WIN'),row(1,'V2_WIN')],b=[row(1,'DRAW'),row(0,'V2_WIN')];
 const x=effect(a,b,[{id:'a'}]);assert.equal(x.gainPercentagePoints,25);assert.deepEqual(x.deltas,[1]);assert.equal(x.transitions['V1_WIN->V2_WIN'],1);assert.equal(x.transitions['V2_WIN->DRAW'],1);
 assert.throws(()=>effect(a,[b[0],b[0]],[{id:'a'}]));
});
