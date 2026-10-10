'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {classify}=require('../../tools/agentank/diagnostics/fresh-game-failure-audit');
test('alive star deficit is separate from death even with same star score',()=>{const s={outcome:'V1_WIN',ownDead:false,enemyDead:false,ownStars:0,enemyStars:2,reason:'frameLimit'};assert.equal(classify(s),'LOSS_ALIVE_STAR_DEFICIT');assert.equal(classify({...s,ownDead:true}),'LOSS_OWN_CRASHED');assert.equal(classify({...s,ownDead:true,enemyDead:true}),'LOSS_BOTH_CRASHED');});
test('survival or crash alone does not determine winner or prove a star-deficit loss',()=>{const s={ownDead:true,enemyDead:true,ownStars:2,enemyStars:0,reason:'crashed'};assert.equal(classify({...s,outcome:'V2_WIN'}),'WIN');assert.equal(classify({...s,outcome:'DRAW'}),'DRAW');assert.equal(classify({...s,outcome:'V1_WIN',ownDead:false}),'LOSS_OTHER');});
