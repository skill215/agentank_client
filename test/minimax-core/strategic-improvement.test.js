'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../../tools/agentank/diagnostics/strategic-improvement-model');
const {eventUniform,load}=require('../../tools/agentank/diagnostics/strategic-event-simulator');
const {TERMINAL,ARRAY}=require('../../engine-v2/src/abi/fast-codes');
test('paired event randomness is independent of branch call order and includes actor and frame',()=>{
  const before=eventUniform(12,24,'stun',0);for(let i=0;i<20;i++)eventUniform(99,i,'star',-1);
  assert.equal(eventUniform(12,24,'stun',0),before);assert.notEqual(eventUniform(12,24,'stun',1),before);
  assert.notEqual(eventUniform(12,25,'stun',0),before);assert.ok(before>=0&&before<1);
});
test('local stun randomness handles both extremes and inactive sentinel state',async()=>{
  const sim=await load(process.cwd());const active={crashed:false,effects:{debuff:{type:'stun',expiresAt:10}}};
  assert.equal(sim.normalized(active,{type:'go'},1,()=>0).type,'go');
  assert.equal(sim.normalized(active,{type:'go'},1,()=>.999).type,'back');
  assert.equal(sim.normalized(active,{type:'turn',side:'left'},1,()=>.999).side,'right');
  assert.equal(sim.normalized(active,{type:'go'},10,()=>.999).type,'go');
});
test('aligned terminal contract uses winner codes and ignores heuristic/path artifacts',()=>{
  const file=path.resolve('engine-v2/src/base-policy-specialized/policy-search.js');
  const Module=require('node:module'),mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
  mod._compile(M.alignedSearchSource(fs.readFileSync(file,'utf8')),file);
  const search=Object.create(mod.exports.NativeBasePolicySearch.prototype);search.leaf=()=>123;
  assert.equal(search.terminalUtility({},TERMINAL.WIN0,0,-999999),100000);
  assert.equal(search.terminalUtility({},TERMINAL.WIN1,0,999999),-100000);
  assert.equal(search.terminalUtility({},TERMINAL.DRAW,0,999999),0);
  assert.equal(search.terminalUtility({},TERMINAL.NONE,0,999999),123);
});
const s={frame:24,baselineAction:2,stars:0,ownStunned:false,enemyStunned:false,turnStreak:1,rows:[
  {row:0,action:2,allowed:true,value:100,horizon:100,future:100,immediate:0},
  {row:1,action:1,allowed:true,value:99,horizon:0,future:0,immediate:0},
  {row:2,action:4,allowed:false,value:1000,horizon:0,future:0,immediate:0}]};
test('proposals preserve domain and feature vectors cannot read IDs or future labels',()=>{
  assert.deepEqual(M.alternatives(s).map(r=>r.action),[1]);
  const a=s.rows[1],x=M.features(s,a),other={...s,seed:999,matchUrlId:'secret',futureOutcome:'win'};
  assert.deepEqual(M.features(other,a),x);assert.equal(x.length,16);
});
test('insufficient evidence keeps baseline while ungated ablation can intervene',()=>{
  const x=M.features(s,s.rows[1]);const examples=Array.from({length:24},(_,i)=>({map:String(i),x,delta:.5}));
  const model=M.fit(examples);assert.ok(M.choose(s,model,false));assert.equal(M.choose(s,model,true),null);
  const records=Array.from({length:7},(_,i)=>({map:String(i),snapshot:s,labels:[{action:1,delta:.5,deathDelta:0}]}));
  M.calibrate(model,records);assert.deepEqual(model.acceptedBins,[]);
});
test('calibration accepts supported replicated positive effects and rejects added deaths',()=>{
  const x=M.features(s,s.rows[1]);const model=M.fit(Array.from({length:24},(_,i)=>({map:String(i),x,delta:.5})));
  const records=Array.from({length:10},(_,i)=>({map:String(i),snapshot:s,labels:[{action:1,delta:.5,deathDelta:0}]}));
  M.calibrate(model,records);assert.ok(M.choose(s,model,true));
  for(const r of records)r.labels[0].deathDelta=1;
  M.calibrate(model,records);assert.equal(M.choose(s,model,true),null);
});
test('bootstrap preserves map grouping instead of treating suffixes as independent maps',()=>{
  const r=M.interval([{map:'a',delta:1},{map:'a',delta:1},{map:'b',delta:-1},{map:'b',delta:-1}]);
  assert.equal(r.n,4);assert.equal(r.maps,2);assert.equal(r.mean,0);assert.equal(r.lo,-1);assert.equal(r.hi,1);
});
