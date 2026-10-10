'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),z=require('node:zlib');
const D=require('../../tools/agentank/diagnostics/budget-order-design'),S=require('../../tools/agentank/diagnostics/budget-order-scenarios');
test('weight ordering is stable, complete, and puts excluded columns last',()=>{
 const search={rootColumnSequence:new Uint8Array([2,0,3,1]),rootEnemyDomainMask:[1,1,1,0],opponentWeight:(e,s,a)=>[10,30,30,100][a]};
 const engine={enemyCount:4,enemyActions:[0,1,2,3],adapter:{state:{}}},audit={orderMoves:0};D.reorder(search,engine,audit);
 assert.deepEqual(Array.from(search.rootColumnSequence),[2,1,0,3]);assert.equal(new Set(search.rootColumnSequence).size,4);assert.ok(audit.orderMoves>0);
});
test('uniform depth control changes depth and order without enabling extension',()=>{
 const search={pathUtility:{},leafEvaluator:{evaluate:()=>0},rootColumnSequence:new Uint8Array([0,1,2]),buildRootColumnSequence:()=>3};
 D.compile(process.cwd()).install({basePolicy:{policySearch:search}},'uniform-reverse',{}, {leafCalls:0,leafExecutions:0,orderRoots:0},false);
 assert.equal(search.scheduledDepth({}),1);search.buildRootColumnSequence({});assert.deepEqual(Array.from(search.rootColumnSequence),[2,1,0]);assert.equal(search.eventInstabilityMask,undefined);
});
test('combination requires a free slot, minimum independent support and positive means',()=>{
 const args=[2,['weight-order','uniform-depth'],{'weight-order':{worstMean:.01}},['uniform-depth'],['weight-order','uniform-depth'],{},[],null,{'weight-order':{maps:24,batches:2}}];
 assert.deepEqual(D.chooseNext(...args).active,['weight-order','R29-weight-order']);args[2]['weight-order'].worstMean=-.01;assert.deepEqual(D.chooseNext(...args).active,['weight-order']);
 args[2]['weight-order'].worstMean=.01;args[8]['weight-order'].maps=12;assert.deepEqual(D.chooseNext(...args).active,['weight-order']);
});
test('mechanism control rejects action drift even when match scores are equal',()=>{
 const a={job:{round:1,env:'original',mode:'uniform-depth'},matchUrlId:'a',candidateSeat:0,candidate:{compactActionStream:'x'},control:{compactActionStream:'y'},counts:{stars:[0,0]},analysisOutcome:'DRAW'};
 const b=structuredClone(a);b.job.mode='uniform-reverse';assert.equal(D.verifyControl([a,b]),1);b.candidate.compactActionStream='z';assert.throws(()=>D.verifyControl([a,b]),/SHALLOW_ORDER_INVARIANCE_FAILED/);
});
test('new local history and generated maps have provenance and do not reuse prior terrain',()=>{
 const selected=S.select(process.cwd());assert.equal(selected.newHistoricalFound,40);assert.equal(selected.remainingHistorical,24);assert.equal(selected.selected.length,300);assert.equal(selected.sourceFiles.length,31);
 const old=JSON.parse(z.gunzipSync(fs.readFileSync('artifacts/native-causal-audit/bp402-focused-extension-hundred-rounds/scenarios.json.gz'))),used=new Set(old.map(s=>D.hash(JSON.stringify(s.map))));
 assert.ok(selected.selected.every(s=>!used.has(D.hash(JSON.stringify(s.map)))));assert.equal(new Set(selected.selected.map(s=>D.hash(JSON.stringify(s.map)))).size,300);
 assert.ok(selected.selected.slice(0,210).every(s=>s.origin==='synthetic'));
 for(let i=210;i<300;i+=3){const group=selected.selected.slice(i,i+3);assert.deepEqual(group.map(s=>s.origin),['historical','synthetic','synthetic']);assert.equal(D.hash(fs.readFileSync(group[0].source.relativePath)),group[0].source.sha256);}
});
