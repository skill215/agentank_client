'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectileSets}=require('../../tools/agentank/diagnostics/multi-projectile-terminal-audit');
const {loadSimulator}=require('../../tools/agentank/simulation/paired-arena');
const {command}=require('../../tools/agentank/diagnostics/terminal-risk-simulator-oracle');
const {crashOutcome}=require('../../tools/agentank/diagnostics/terminal-risk-semantics-audit');
test('multi-projectile census fixes pair denominator and bounded larger sets',()=>{
 const pool=Array.from({length:24},(_,i)=>i),sets=projectileSets(pool);assert.equal(sets.length,300);assert.equal(sets.filter(s=>s.length===2).length,276);for(const size of [4,8,16])assert.equal(sets.filter(s=>s.length===size).length,8);for(const s of sets)assert.equal(new Set(s).size,s.length);assert.deepEqual(projectileSets(pool),sets);
});
test('terminal invariance depends on action-before-projectile phase, not merely star lead',async()=>{
 const {module}=await loadSimulator(process.cwd());
 const make=()=>{const s=new module.AgenTankSimulator({map:Array.from({length:5},()=>Array(5).fill('.')),tanks:[{position:[2,2],direction:'right',stars:1},{position:[3,2],direction:'left',stars:0}],skills:['stun','stun'],starLimit:false,seed:1});s.bullets.push({objectId:'hidden',ownerIndex:1,ownerObjectId:s.players[1].objectId,position:[1,2],direction:'right',crashed:false});return s;};
 const normal=make();normal.step([command(4),command(0)]);assert.equal(crashOutcome(normal.players[0].crashed,normal.players[1].crashed,1,0),'WIN');
 // Deliberate rule mutation, not a claim about platform behavior.
 const early=make();early.moveBullets([]);early.step([command(4),command(0)]);assert.equal(crashOutcome(early.players[0].crashed,early.players[1].crashed,1,0),'LOSS');
});
