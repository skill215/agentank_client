'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {command,chanceCount}=require('../../tools/agentank/diagnostics/terminal-risk-simulator-oracle');
const {crashOutcome}=require('../../tools/agentank/diagnostics/terminal-risk-semantics-audit');
const {loadSimulator}=require('../../tools/agentank/simulation/paired-arena');
test('simulator oracle uses primitive actions and explicit stun expiration',()=>{
 const p={effects:{debuff:{type:'stun',expiresAt:10}}};for(const a of [1,2,3]){assert.equal(chanceCount(p,9,a),2);assert.equal(chanceCount(p,10,a),1);}for(const a of [0,4,5,8])assert.equal(chanceCount(p,9,a),1);
 assert.equal(command(0),null);assert.deepEqual(command(2),{type:'turn',side:'left'});assert.deepEqual(command(3),{type:'turn',side:'right'});assert.throws(()=>command(12),/UNSUPPORTED/);
});
test('independent simulator mutual-fire terminal is win/draw/loss by stars, not own death alone',async()=>{
 const {module}=await loadSimulator(process.cwd());
 for(const [stars0,stars1,want]of [[2,1,'WIN'],[1,1,'DRAW'],[0,1,'LOSS']]){
  const sim=new module.AgenTankSimulator({map:Array.from({length:5},()=>Array(5).fill('.')),tanks:[{position:[1,2],direction:'right',stars:stars0},{position:[2,2],direction:'left',stars:stars1}],skills:['stun','stun'],seed:1,starLimit:false,maxFrames:128});
  sim.step([command(4),command(4)]);const [a,b]=sim.players;assert.equal(a.crashed,true);assert.equal(b.crashed,true);assert.equal(crashOutcome(a.crashed,b.crashed,a.stars,b.stars),want);
 }
});
