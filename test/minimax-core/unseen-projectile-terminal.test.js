'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadSimulator}=require('../../tools/agentank/simulation/paired-arena');
const {command}=require('../../tools/agentank/diagnostics/terminal-risk-simulator-oracle');
const {crashOutcome}=require('../../tools/agentank/diagnostics/terminal-risk-semantics-audit');
test('unseen incoming projectile preserves observation; leading mutual kill differs from losing or shielded cases',async()=>{
 const {module}=await loadSimulator(process.cwd());
 for(const [ownStars,enemyStars,shield,want]of [[1,0,false,'WIN'],[0,1,false,'LOSS'],[1,0,true,'LOSS']]){
  const sim=new module.AgenTankSimulator({map:Array.from({length:5},()=>Array(5).fill('.')),tanks:[{position:[2,2],direction:'right',stars:ownStars},{position:[3,2],direction:'left',stars:enemyStars}],skills:['stun','stun'],seed:1,starLimit:false});
  if(shield)sim.players[1].effects.self={type:'shield',expiresAt:100,hitsRemaining:2};
  const before=JSON.stringify(sim.snapshotFor(0)),copy=sim.clone();
  copy.bullets.push({objectId:'hidden',ownerIndex:1,ownerObjectId:copy.players[1].objectId,position:[1,2],direction:'right',crashed:false});
  assert.equal(JSON.stringify(copy.snapshotFor(0)),before);
  copy.step([command(4),command(0)]);
  const [a,b]=copy.players;assert.equal(a.crashed,true);assert.equal(crashOutcome(a.crashed,b.crashed,a.stars,b.stars),want);
  assert.equal(JSON.stringify(sim.snapshotFor(0)),before);
 }
});
