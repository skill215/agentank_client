'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDesign,clusterInterval,support}=require('../../tools/agentank/diagnostics/multiseed-design');
test('new seed design is deterministic, preserves physical inputs and excludes each old seed',()=>{
  const h=Array.from({length:192},(_,i)=>({matchUrlId:'p'+i,fingerprint:'fp'+i,map:[[i]],starts:[],stars:[]}));
  const cells=h.map((s,i)=>({parentId:s.matchUrlId,oldSeed:i,newSeed:i+200,replicaSeed:i+400}));
  const prior=h.map(s=>({...s,condition:'seed-replica',parentMatchUrlId:s.matchUrlId}));const d=createDesign(h,prior,cells);
  assert.deepEqual(d,createDesign(h,prior,cells));assert.equal(d.preflight.length,16);assert.equal(Object.keys(d.conditions).length,5);
  for(const [i,p]of h.entries()){const seeds=Object.values(d.conditions).map(ss=>{const s=ss[i];assert.deepEqual(s.map,p.map);assert.equal(s.parentFingerprint,p.fingerprint);assert.notEqual(s.fingerprint,p.fingerprint);return s.simulationSeed;});
    assert.equal(new Set([...seeds,cells[i].oldSeed,cells[i].newSeed,cells[i].replicaSeed]).size,8);}
  assert.equal(h[0].condition,undefined);assert.throws(()=>createDesign(h,prior,cells.slice(1)));
});
test('bootstrap denominator retains every seed and both seats within a parent map',()=>{
  const p=clusterInterval([10,10],10);assert.equal(p.games,20);assert.equal(p.mapGroups,2);assert.deepEqual(p.descriptive95PercentInterval,[100,100]);
  assert.equal(clusterInterval([-1,1],10).deltaPoints,0);assert.throws(()=>clusterInterval([],10));
});
test('multi-seed support requires four complete gates and never hides a safety or interval failure',()=>{
  const p={deltaPoints:20,baseline:{singleCrashLosses:10,doubleLosses:8},candidate:{singleCrashLosses:9,doubleLosses:7}};
  const rounds=Array.from({length:5},()=>({status:'PRESSURE_PASS',performance:{nodeRatio:1}})),u={descriptive95PercentInterval:[1,4]};
  assert.equal(support(p,u,rounds).status,'MULTI_SEED_SUPPORT');rounds[0].status='PRESSURE_REJECTED';assert.equal(support(p,u,rounds).status,'MULTI_SEED_SUPPORT');
  rounds[1].status='PRESSURE_REJECTED';assert.ok(support(p,u,rounds).reasons.includes('FEWER_THAN_FOUR_SEED_PASSES'));
  assert.ok(support(p,{descriptive95PercentInterval:[0,4]},rounds).reasons.includes('INTERVAL_NOT_POSITIVE'));
  assert.ok(support({...p,candidate:{singleCrashLosses:11,doubleLosses:7}},u,rounds).reasons.includes('DEATH_INCREASE'));
});
