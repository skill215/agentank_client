'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {uint32,withExplicitSeed,controlledScenario}=require('../../tools/agentank/diagnostics/explicit-simulation-seed');
test('explicit seed changes only constructor seed, preserves simulator API and input options',()=>{
  class Sim { constructor(options){this.options=options;} run(){return this.options.seed;} }
  const observations=[],module={AgenTankSimulator:Sim,marker:42};
  const options={seed:999,map:[[1]],maxFrames:128,starProvider:()=>0};
  const wrapped=withExplicitSeed(module,123,x=>observations.push(x));const simulator=new wrapped.AgenTankSimulator(options);
  assert.ok(simulator instanceof Sim);assert.equal(simulator.run(),123);assert.equal(wrapped.marker,42);
  assert.equal(options.seed,999);assert.equal(simulator.options.map,options.map);assert.equal(simulator.options.starProvider,options.starProvider);
  assert.deepEqual(observations,[{hostDerivedSeed:999,effectiveSeed:123}]);
  assert.equal(new (withExplicitSeed(module,0,()=>{}).AgenTankSimulator)(options).run(),0);
});
test('invalid explicit seeds fail before construction',()=>{
  for(const seed of [-1,1.5,NaN,Infinity,0x100000000,'42',null])assert.throws(()=>uint32(seed),/INVALID/);
  assert.equal(uint32(0xffffffff),0xffffffff);
});
test('controlled scenario identity binds physical source, parent and seed without mutating inputs',()=>{
  const parent={matchUrlId:'p',fingerprint:'parent',map:[[1]],starts:[],stars:[],originalResult:{winner:0}};
  const physical={...parent,fingerprint:'physical',map:[[2]]};
  const a=controlledScenario(physical,parent,'rotate',31),b=controlledScenario(physical,parent,'rotate',32);
  assert.notEqual(a.fingerprint,b.fingerprint);assert.equal(a.parentFingerprint,'parent');assert.equal(a.physicalSourceFingerprint,'physical');
  assert.equal(a.simulationSeed,31);assert.deepEqual(a.map,physical.map);assert.equal(a.originalResult,undefined);
  assert.equal(physical.fingerprint,'physical');assert.equal(parent.fingerprint,'parent');assert.deepEqual(a,controlledScenario(physical,parent,'rotate',31));
});
