'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadSimulator} = require('../../tools/agentank/simulation/paired-arena');
const {loadBombPhaseAdapter, replaceOnce, VERSION} = require('../../tools/agentank/simulation/bomb-phase-adapter');
const root = process.cwd();
const adapted = loadBombPhaseAdapter(root);
function arena(module, tanks = [{position:[3,2],direction:'down'}, {position:[6,6],direction:'left'}]) {
  return new module.AgenTankSimulator({map:Array.from({length:7},()=>Array(7).fill('.')),
    tanks, skills:['shield','stun'], maxFrames:128, starLimit:false, seed:1});
}
function due(sim, position=[2,2]) {
  sim.frame=10;
  sim.bombs.push({objectId:'due',ownerIndex:0,ownerObjectId:sim.players[0].objectId,
    position,createdAt:0,explodesAt:10,exploded:false});
}
test('adapter refuses missing or ambiguous patch points',()=>{
  assert.equal(replaceOnce('abc','b','x'),'axc');
  assert.throws(()=>replaceOnce('abc','z','x'),/ADAPTER_PATCH_POINT_DRIFT/);
  assert.throws(()=>replaceOnce('bb','b','x'),/ADAPTER_PATCH_POINT_DRIFT/);
});
test('adapter is pinned, preserves vendor bytes and original class',async()=>{
  const original=await loadSimulator(root), file=path.join(original.directory,'src/engine.js');
  const before=fs.readFileSync(file);
  const {module,identity}=await adapted;
  assert.equal(identity.version,VERSION); assert.equal(identity.scope,'BOMB_PHASE_ONLY');
  assert.notEqual(module.AgenTankSimulator,original.module.AgenTankSimulator);
  assert.deepEqual(fs.readFileSync(file),before);
  const sim=arena(original.module);due(sim);sim.step([{type:'go'},null]);
  assert.equal(sim.players[0].crashed,true);
});
test('due bomb uses post-action pose: escape survives and entry dies',async()=>{
  const {module}=await adapted;
  const escape=arena(module);due(escape);const events=escape.step([{type:'go'},null]);
  assert.deepEqual(escape.players[0].position,[3,3]);assert.equal(escape.players[0].crashed,false);
  assert.ok(events.findIndex(e=>e.type==='tank'&&e.action==='go')<events.findIndex(e=>e.type==='bomb'));
  const entry=arena(module,[{position:[3,3],direction:'up'},{position:[6,6],direction:'left'}]);
  due(entry);entry.step([{type:'go'},null]);assert.deepEqual(entry.players[0].position,[3,2]);
  assert.equal(entry.players[0].crashed,true);
});
test('wait dies, same-frame shield absorbs due bomb and is consumed',async()=>{
  const {module}=await adapted;
  const wait=arena(module);due(wait);wait.step([null,null]);assert.equal(wait.players[0].crashed,true);
  const shield=arena(module);due(shield);shield.step([{type:'shield'},null]);
  assert.equal(shield.players[0].crashed,false);assert.equal(shield.players[0].effects.self,null);
});
test('projectile terminal still permits due bomb and recomputes mutual death',async()=>{
  const {module}=await adapted;
  const sim=arena(module,[{position:[0,0],direction:'right'},{position:[2,0],direction:'left'}]);
  due(sim,[0,1]); const events=sim.step([{type:'fire'},null]);
  assert.deepEqual(sim.players.map(p=>p.crashed),[true,true]);
  assert.equal(sim.result.winner,null);
  const bombAt=events.findIndex(e=>e.type==='bomb'&&e.action==='exploded');
  assert.ok(events.findIndex(e=>e.type==='tank'&&e.action==='crashed'&&e.index===1)<bombAt);
  assert.ok(events.findIndex(e=>e.type==='tank'&&e.action==='crashed'&&e.index===0)>bombAt);
});
test('ten-frame fuse and cloned simulator preserve adapted phase',async()=>{
  const {module}=await adapted;const sim=arena(module);
  sim.step([{type:'throwBomb'},null]);assert.equal(sim.bombs[0].explodesAt,10);
  while(sim.frame<10)assert.equal(sim.step([null,null]).some(e=>e.type==='bomb'&&e.action==='exploded'),false);
  const clone=sim.clone();assert.ok(clone instanceof module.AgenTankSimulator);
  sim.players[0].direction='right';clone.players[0].direction='right';
  assert.deepEqual(sim.step([null,null]),clone.step([null,null]));
  assert.equal(sim.players[0].crashed,true);assert.equal(clone.bombs.length,0);
});
test('no-bomb action and projectile trajectories remain identical',async()=>{
  const original=await loadSimulator(root),{module}=await adapted;
  for(let seed=1;seed<=8;seed++){
    const a=arena(original.module),b=arena(module);
    for(let frame=0;frame<24&&!a.result;frame++){
      const actions=[{type:frame%5===0?'fire':frame%3===0?'go':'turn',side:'left'},
        {type:(frame+seed)%7===0?'fire':'turn',side:'right'}];
      assert.deepEqual(a.step(structuredClone(actions)),b.step(structuredClone(actions)));
      assert.deepEqual(a.snapshotFor(0),b.snapshotFor(0));assert.deepEqual(a.result,b.result);
    }
  }
});
test('projectile destroys mud before bomb computes its blast',async()=>{
  const {module}=await adapted;
  const sim=arena(module,[{position:[0,1],direction:'right'},{position:[2,0],direction:'left'}]);
  sim.map[2][1]='m';due(sim,[2,2]);
  const events=sim.step([{type:'fire'},null]);
  const destroyed=events.findIndex(e=>e.type==='map'&&e.action==='destroyed');
  const exploded=events.findIndex(e=>e.type==='bomb'&&e.action==='exploded');
  assert.ok(destroyed>=0&&destroyed<exploded);
  assert.equal(sim.players[1].crashed,true);
  assert.equal(sim.players[0].crashed,false);
});
