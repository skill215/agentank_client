'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FastState,ARRAY:A,SCALAR:S}=require('../../engine-v2/src/state/fast-state');
const {NONE_CELL,NONE_FRAME}=require('../../engine-v2/src/abi/fast-codes');
const {fastView,simView,differences,cloneState,physicalHash,summarizeLeaves}=require('../../tools/agentank/diagnostics/transition-ranking-diagnostic');
test('canonical views align own-seat mapping, cooldowns and runtime-independent state',()=>{
 const s=new FastState(2,2);s.arrays[A.TERRAIN].set([0,1,2,3]);s.arrays[A.TANK_CELL].set([0,3]);s.arrays[A.TANK_DIR].set([0,2]);s.arrays[A.TANK_SKILL_READY].set([12,0]);s.arrays[A.TANK_STUN_UNTIL].set([NONE_FRAME,11]);s.arrays[A.SCALAR][S.FRAME]=10;s.arrays[A.SCALAR][S.STAR_CELL]=NONE_CELL;
 const player=(position,direction,skill,effect)=>({position,direction,crashed:false,stars:0,skillCooldownUntil:skill,effects:{self:null,debuff:effect}});
 const sim={frame:10,map:[['.','m'],['x','o']],players:[player([1,1],'down',0,{type:'stun',expiresAt:11}),player([0,0],'up',12,null)],bullets:[],bombs:[],star:null};
 assert.deepEqual(fastView(s),simView(sim,1));sim.players[0].effects.debuff.expiresAt=12;assert.equal(differences(fastView(s),simView(sim,1))[0].field,'tanks.1.effects.stun');
});
test('state cloning isolates mutation while physical hashes ignore runtime metadata',()=>{
 const s=new FastState(2,2);s.initializeHash();const frozen={width:2,height:2,arrays:s.arrays.map(x=>Array.from(x))},copy=cloneState(frozen);assert.equal(physicalHash(s),physicalHash(copy));copy.arrays[A.TANK_RUNTIME][0]=1234;assert.equal(physicalHash(s),physicalHash(copy));copy.arrays[A.TANK_CELL][0]=2;assert.notEqual(physicalHash(s),physicalHash(copy));assert.equal(s.arrays[A.TANK_CELL][0],0);
});
test('leaf summaries separate terminal utility from heuristic component averages',()=>{
 const r=summarizeLeaves([{kind:'terminal',value:100000},{kind:'heuristic',components:[900,1,2,3,4,-75],pathAdjustment:-240}]);assert.equal(r.terminalCount,1);assert.equal(r.heuristicCount,1);assert.equal(r.meanComponents['star-score'],900);assert.equal(r.meanPathAdjustment,-240);
});
