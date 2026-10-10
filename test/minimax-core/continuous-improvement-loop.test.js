'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../../tools/agentank/diagnostics/continuous-improvement-design');
const {FastState,ARRAY,SCALAR}=require('../../engine-v2/src/state/fast-state');
function cacheFixture(){const state={width:2,height:2,hashLo:1,hashHi:2,arrays:[new Uint32Array([3,4])]};let roots=0;
 const leaf={lastComponents:new Int32Array(6),beginRoot(){roots++;},evaluate(s){const v=s.arrays[0][0]+roots;this.lastComponents.fill(v);return v;}};
 const audit={cacheBytes:0,leafCalls:0,leafExecutions:0,cacheHits:0,cacheComparedWords:0,shadowChecks:0};D.installCache(leaf,audit,true);leaf.beginRoot(state);return {state,leaf,audit};}
test('cache checks full state despite hash collision, restores components, and reuses undone state',()=>{
 const {state,leaf,audit}=cacheFixture();assert.equal(leaf.evaluate(state),4);state.arrays[0][0]=8;assert.equal(leaf.evaluate(state),9);
 state.arrays[0][0]=3;assert.equal(leaf.evaluate(state),4);assert.deepEqual(Array.from(leaf.lastComponents),[4,4,4,4,4,4]);
 assert.equal(audit.cacheHits,1);assert.equal(audit.shadowChecks,1);assert.equal(audit.leafExecutions,2);
});
test('root invalidation prevents stale leaf values and bounds allocation',()=>{
 const {state,leaf,audit}=cacheFixture();leaf.evaluate(state);const bytes=audit.cacheBytes;leaf.beginRoot(state);assert.equal(leaf.evaluate(state),5);assert.equal(audit.cacheHits,0);
 for(let i=0;i<40;i++){state.arrays[0][0]=i;leaf.evaluate(state);}assert.equal(audit.cacheBytes,bytes);assert.equal(audit.cacheHits,1);
});
test('instability only extends active projectiles or imminent bombs intersecting a tank',()=>{
 const state=new FastState(3,3),a=state.arrays;a[ARRAY.SCALAR][SCALAR.FRAME]=10;a[ARRAY.TANK_CELL][0]=0;a[ARRAY.TANK_CELL][1]=8;
 const s={leafEvaluator:{projectileThreat:()=>1,bombHits:(st,c,t)=>c===t}};assert.equal(D.instability(s,state,false),1);assert.equal(D.instability(s,state,true),0);
 a[ARRAY.BOMB_ACTIVE][0]=1;a[ARRAY.BOMB_CELL][0]=0;a[ARRAY.BOMB_EXPLODE][0]=12;assert.equal(D.instability(s,state,true),0);
 a[ARRAY.BOMB_EXPLODE][0]=11;assert.equal(D.instability(s,state,true),2);a[ARRAY.BOMB_CELL][0]=4;assert.equal(D.instability(s,state,true),0);
});
test('finite source variants compile while production methods remain unmodified',()=>{
 const before=require('../../engine-v2/src/base-policy-specialized/policy-search').NativeBasePolicySearch.prototype.policyValue;
 const c=D.compile(process.cwd());assert.equal(Object.keys(c.methods).length,6);assert.notEqual(c.methods.quiescence.policyValue.toString(),before.toString());
 assert.equal(c.methods.baseline.policyValue.toString(),before.toString());assert.equal(c.methods['cell-budget'].policyValue.toString(),before.toString());
});
test('final shortlist excludes a lucky new candidate without minimum independent support',()=>{
 const n=D.chooseNext(7,['quiescence','cell-budget'],{},[],[],{quiescence:1,'cell-budget':.1},[],null,{quiescence:{maps:12,batches:1},'cell-budget':{maps:24,batches:2}});
 assert.deepEqual(n.active,['cell-budget']);const frozen=D.chooseNext(8,n.active,{},['cell-budget'],[],{},[],n.frozen,{});assert.deepEqual(frozen.active,n.active);
});
test('retired broad quiescence triggers its bounded narrower hypothesis only once',()=>{
 const a=D.chooseNext(2,['quiescence'],{},['quiescence'],['quiescence'],{},[],null,{});assert.deepEqual(a.active,['bomb-quiescence']);
 const b=D.chooseNext(3,a.active,{},['quiescence','bomb-quiescence'],['quiescence','bomb-quiescence'],{},[],null,{});assert.deepEqual(b.active,[]);
});
test('efficiency candidate may preserve every action but cannot qualify from saved work alone',()=>{
 const x={maps:48,mean:0,lo:0,deltaPoints:0,deathDelta:0,doubleLossDelta:0,nodeRatio:1,transitionRatio:1,semanticChanges:0,leafExecutionRatio:.7,decisionMsRatio:1};
 const e=D.evidence({original:x,event:x},2,'leaf-cache');assert.equal(e.retire,false);assert.equal(e.strong,false);assert.equal(e.status,'EFFICIENCY_BENCHMARK_REQUIRED');
 assert.equal(D.evidence({original:{...x,decisionMsRatio:1.5},event:x},2,'leaf-cache').retire,true);
 assert.equal(D.evidence({original:{...x,semanticChanges:1},event:x},1,'leaf-cache').retire,true);
});
test('behavior dedup compares full paired actions, not equal scores',()=>{
 const rows=[];for(let i=0;i<12;i++)for(const mode of ['quiescence','cell-budget'])rows.push({job:{round:i,env:'original',role:'discovery',mode},matchUrlId:String(i),candidateSeat:0,audit:{transitions:mode==='quiescence'?2:1},candidate:{compactActionStream:'x',compactArguments:[]},control:{compactActionStream:'y',compactArguments:[]},counts:{stars:[0,0]},analysisOutcome:'DRAW'});
 assert.equal(D.duplicates(rows,['quiescence','cell-budget'])[0].retire,'quiescence');rows[1].candidate.compactActionStream='z';assert.deepEqual(D.duplicates(rows,['quiescence','cell-budget']),[]);
});
