'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCooldownStun:n}=require('../../tools/agentank/diagnostics/cooldown-stun-normalization');
const {ACTION:A,SKILL:S,NONE_FRAME}=require('../../engine-v2/src/abi/fast-codes');
const {loadSimulator}=require('../../tools/agentank/simulation/paired-arena');
test('cooldown normalization is limited to known unready stun; readiness boundary and unknown stay unchanged',()=>{
 assert.equal(n(A.CAST_STUN,S.STUN,11,10,true),A.NONE);
 for(const [action,skill,ready,known]of [[A.CAST_STUN,S.STUN,10,true],[A.CAST_STUN,S.STUN,9,true],[A.CAST_STUN,S.STUN,11,false],[A.CAST_STUN,S.STUN,NONE_FRAME,true],[A.CAST_SHIELD,S.SHIELD,11,true],[A.CAST_STUN,S.SHIELD,11,true]])assert.equal(n(action,skill,ready,10,known),action);
});
test('independent simulator: cooldown stun and NONE have identical physical successors but different event traces',async()=>{
 const {module}=await loadSimulator(process.cwd());
 for(const seat of [0,1])for(const remaining of [1,2,32]){
  const base=new module.AgenTankSimulator({map:Array.from({length:7},()=>Array(7).fill('.')),tanks:[{position:[1,3],direction:'right'},{position:[5,3],direction:'left'}],skills:['stun','stun'],seed:1,starLimit:false});base.players[seat].skillCooldownUntil=remaining;
  const left=base.clone(),right=base.clone(),actions=[null,null];actions[seat]={type:'stun'};
  const events=left.step(actions),noneEvents=right.step([null,null]);
  assert.deepEqual(left.players,right.players);assert.deepEqual(left.bullets,right.bullets);assert.deepEqual(left.bombs,right.bombs);assert.deepEqual(left.map,right.map);assert.deepEqual(left.result,right.result);
  assert.ok(events.some(e=>e.type==='skill'&&e.action==='failed'&&e.reason==='cooldown'));assert.ok(!noneEvents.some(e=>e.type==='skill'));
 }
});
test('ready stun is not physically equivalent to NONE',async()=>{const {module}=await loadSimulator(process.cwd());const base=new module.AgenTankSimulator({map:Array.from({length:5},()=>Array(5).fill('.')),tanks:[{position:[1,2],direction:'right'},{position:[3,2],direction:'left'}],skills:['stun','stun'],seed:1,starLimit:false});const left=base.clone(),right=base.clone();left.step([{type:'stun'},null]);right.step([null,null]);assert.notDeepEqual(left.players,right.players);});
