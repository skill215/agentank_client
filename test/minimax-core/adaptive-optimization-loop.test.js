'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const D=require('../../tools/agentank/diagnostics/adaptive-optimization-design');
const {TERMINAL}=require('../../engine-v2/src/abi/fast-codes');
test('finite catalogue compiles independently and exact terminal has no path-score leakage',()=>{
 const built=D.compile(process.cwd());assert.equal(Object.keys(built.methods).length,12);
 for(const name of Object.keys(D.SPECS).filter(k=>D.SPECS[k].terminal)){
  const p=built.methods[name],s=Object.create(p);s.leaf=()=>17;
  assert.equal(s.terminalUtility({},TERMINAL.WIN0,0,-1000000),100000);
  assert.equal(s.terminalUtility({},TERMINAL.WIN1,0,1000000),-100000);
  assert.equal(s.terminalUtility({},TERMINAL.DRAW,0,1000000),0);
 }
});
test('root-only chance keeps deeper fallback; worst and expectation share enumeration but different backups',()=>{
 const src=fs.readFileSync('engine-v2/src/base-policy-specialized/policy-search.js','utf8');
 assert.match(D.transform(src,'root-chance'),/if \(top > 1 && ownChance > 1\)/);
 assert.match(D.transform(src,'chance-worst'),/if \(true\) \{\n      this.lastNominalValue = worstOwnNominal; return worstOwn;/);
 assert.match(D.transform(src,'chance'),/if \(false && ownChance > 1\)/);
 assert.equal(D.transform(src,'baseline'),src);assert.equal(D.transform(src,'R29'),src);
});
const summary=(a,b,extra={})=>({original:{maps:64,mean:a,lo:a-.03,deltaPoints:a*128,deathDelta:0,doubleLossDelta:0,nodeRatio:1,transitionRatio:1,semanticChanges:30,...extra},event:{maps:64,mean:b,lo:b-.03,deltaPoints:b*128,deathDelta:0,doubleLossDelta:0,nodeRatio:1,transitionRatio:1,semanticChanges:30,...extra}});
test('retirement and local support use both RNG environments and actual transition cost',()=>{
 assert.equal(D.evidence(summary(.1,.1),2).status,'LOCAL_SUPPORTED');
 assert.equal(D.evidence(summary(.1,-.1),2).status,'RNG_CONFLICT');
 assert.equal(D.evidence(summary(-.1,-.1),1).retire,false);
 assert.equal(D.evidence(summary(-.1,-.1),2).retire,true);
 assert.equal(D.evidence(summary(.1,.1,{transitionRatio:2.1}),2).status,'COST_REJECTED');
 assert.equal(D.evidence(summary(0,0,{semanticChanges:0}),2).status,'INACTIVE');
});
test('process changes prioritize robust hypothesis on RNG conflict and never refill retired modes',()=>{
 const pool={chance:{status:'RNG_CONFLICT'},terminal:{status:'INACTIVE'}};
 const n=D.chooseNext(1,['chance','terminal'],pool,['terminal'],['chance','terminal'],{chance:.1,terminal:.2},[]);
 assert.equal(n.action,'RETIRE_AND_REALLOCATE');assert.deepEqual(n.active,['chance','chance-worst']);
});
test('confirmation freezes selection even when later discovery ranking reverses',()=>{
 const n=D.chooseNext(7,['chance','aligned'],{},[],['chance','aligned'],{chance:.2,aligned:.1},[]);
 assert.deepEqual(n.frozen,['chance','aligned']);
 const m=D.chooseNext(8,['chance','aligned'],{},[],['chance','aligned'],{chance:-.2,aligned:.8},[],n.frozen);
 assert.deepEqual(m.active,n.frozen);assert.equal(m.action,'KEEP_FROZEN_CONFIRMATION');
});
test('empty remaining portfolio becomes a reference audit rather than resurrecting retired candidate',()=>{
 const n=D.chooseNext(7,['terminal'],{},['terminal'],['terminal'],{terminal:-1},[]);
 assert.deepEqual(n.active,[]);assert.deepEqual(n.frozen,[]);
});
test('comparisons pair round and environment, count double losses, preserve map clusters',()=>{
 const row=(round,seat,mode,outcome)=>({matchUrlId:'a',scenarioFingerprint:'x',candidateSeat:seat,analysisOutcome:outcome,terminalCategory:'SINGLE_CRASH',job:{round,env:'original',mode},audit:{nodes:10,transitions:20},candidate:{compactActionStream:'a',compactArguments:[]},control:{compactActionStream:'b',compactArguments:[]}});
 const base=[row(1,0,'baseline','V1_WIN'),row(1,1,'baseline','V1_WIN')],other=[row(1,0,'chance','V2_WIN'),row(1,1,'chance','DRAW')];
 const r=D.compare(base,other);assert.equal(r.deltaPoints,1.5);assert.equal(r.doubleLossDelta,-1);assert.equal(r.maps,1);assert.equal(r.deathDelta,-2);
 assert.throws(()=>D.compare(base,[row(2,0,'chance','V2_WIN'),row(2,1,'chance','DRAW')]));
});
