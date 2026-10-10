'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../../tools/agentank/diagnostics/focused-extension-design');
const S=require('../../tools/agentank/diagnostics/focused-extension-scenarios');
const x=(extra={})=>({maps:80,mean:.05,lo:.01,hi:.09,deathDelta:0,doubleLossDelta:0,nodeRatio:1.1,transitionRatio:1.1,semanticChanges:20,deltaPoints:8,...extra});
test('practical gain, work cap and futility constrain local promotion',()=>{
 assert.equal(D.evidence({original:x(),event:x()},3,'quiescence').strong,true);
 assert.equal(D.evidence({original:x({mean:.01}),event:x()},3,'quiescence').strong,false);
 assert.equal(D.evidence({original:x({transitionRatio:1.26}),event:x()},3,'quiescence').status,'COST_REJECTED');
 assert.equal(D.evidence({original:x({mean:0,lo:-.1,hi:.01}),event:x({mean:0,lo:-.1,hi:.01})},4,'quiescence').status,'PRACTICAL_GAIN_FUTILITY');
});
test('strong synthetic results cannot compensate for weak historical confirmation',()=>{
 const good={original:x(),event:x()};assert.equal(D.domainSupport({historical:good,synthetic:good}),true);
 assert.equal(D.domainSupport({historical:{original:x({mean:-.01,lo:-.05}),event:x()},synthetic:good}),false);
 assert.equal(D.domainSupport({historical:good,synthetic:{original:x({maps:23}),event:x()}}),false);
});
test('combined candidate retains both the path change and bounded extension without double counting leaves',()=>{
 const s={pathUtility:{},leafEvaluator:{evaluate:()=>7,projectileThreat:()=>0}},engine={basePolicy:{policySearch:s}},audit={leafCalls:0,leafExecutions:0};
 D.compile(process.cwd()).install(engine,'R29-quiescence',{},audit,false);
 assert.equal(typeof s.pathUtility.scoreTransition,'function');assert.equal(typeof s.policyValue,'function');assert.equal(typeof s.eventInstabilityMask,'function');
 assert.equal(s.leafEvaluator.evaluate({}),7);assert.equal(audit.leafCalls,1);assert.equal(audit.leafExecutions,1);
});
test('retirement adds only the preregistered urgent-threat fallback and never resurrects a candidate',()=>{
 const a=D.chooseNext(2,['quiescence','bomb-quiescence'],{},['bomb-quiescence'],['quiescence','bomb-quiescence'],{},[],null,{});
 assert.deepEqual(a.active,['quiescence','urgent-quiescence']);
 const b=D.chooseNext(3,a.active,{},['bomb-quiescence','quiescence','urgent-quiescence'],['quiescence','bomb-quiescence','urgent-quiescence'],{},[],null,{});assert.deepEqual(b.active,[]);
});
test('procedural terrain is deterministic, connected at starts and supplies reachable stars',()=>{
 const hashes=new Set();for(let i=0;i<30;i++){const s=S.generate(i);assert.deepEqual(s,S.generate(i));assert.equal(s.origin,'synthetic');assert.equal(s.map.length,19);assert.equal(s.map[0].length,15);
  const reachable=new Set(S.reachable(s.map,s.starts[0].position).map(p=>p.join(',')));assert.ok(reachable.has(s.starts[1].position.join(',')));
  for(const star of s.stars)assert.ok(reachable.has(star.position.join(',')));hashes.add(s.mapHash);
 }assert.equal(hashes.size,30);
});
test('cohort selection keeps all 60 historical maps out of discovery and all terrains unique',()=>{
 const {selected,remainingHistorical}=S.select(process.cwd());assert.equal(selected.length,300);assert.equal(remainingHistorical,14);
 assert.ok(selected.slice(0,210).every(s=>s.origin==='synthetic'));assert.equal(new Set(selected.map(s=>D.hash(JSON.stringify(s.map)))).size,300);
 for(let i=210;i<300;i+=3)assert.deepEqual(selected.slice(i,i+3).map(s=>s.origin),['historical','historical','synthetic']);
});
