'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadSimulator}=require('../../tools/agentank/simulation/paired-arena');
const {importPhysicalState,ARRAY}=require('../../engine-v2/src/state/fast-state');
const {FastKernel}=require('../../engine-v2/src/fast/kernel');
test('pinned simulator resolves due bomb before GO can escape the blast',async()=>{
 const {module}=await loadSimulator(process.cwd());const map=Array.from({length:7},()=>Array(7).fill('.'));
 const sim=new module.AgenTankSimulator({map,tanks:[{position:[3,2],direction:'down'},{position:[6,6],direction:'left'}],skills:['stun','stun'],maxFrames:128,starLimit:false,seed:1});
 sim.frame=10;sim.bombs.push({objectId:'due',ownerIndex:0,ownerObjectId:sim.players[0].objectId,position:[2,2],createdAt:0,explodesAt:10,exploded:false});
 const events=sim.step([{type:'go'},null]);assert.equal(sim.players[0].crashed,true);assert.deepEqual(sim.players[0].position,[3,2]);assert.ok(events.some(e=>e.type==='bomb'&&e.action==='exploded'));
});
// DD1 rule-calibration-report §7 rejects the external simulator bomb phase.
// Do not change production to match that lower-authority simulator.
test('platform-calibrated FastKernel allows moving off blast before end-of-frame bomb',()=>{
 const {state}=importPhysicalState({platformFrame:10,map:{width:7,height:7,terrainColumnMajor:Array.from({length:7},()=>Array(7).fill('.'))},tanks:[{seat:0,cell:[3,2],direction:'down',skillId:'stun'},{seat:1,cell:[6,6],direction:'left',skillId:'stun'}],bombs:[{ownerSeat:0,cell:[2,2],placedFrame:0,explodeFrame:10}]});
 new FastKernel(state).applyFrame(1);assert.equal(state.arrays[ARRAY.TANK_CRASH][0],0);
});
