'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../../tools/agentank/diagnostics/experiment-runner');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'experiment-runner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'evidence.json'),'{}');
 fs.writeFileSync(path.join(root,'adapter.js'),`exports.runJob=async function(p){if(p.hang)while(true){};if(p.crash)process.exit(7);return {games:p.games||1,integrityPassed:p.integrity!==false,safetyPassed:p.safe!==false,metrics:{score:.5}};};`);
 const job=(id,candidate='a',payload={})=>({id,candidate,kind:candidate?'candidate':'control',independentUnit:'map-1',timeoutSeconds:2,payload});
 const plan={version:1,root,adapter:'adapter.js',objective:{question:'Can a measured mechanism improve?',metric:'paired score',minimumEffect:'0.05',evaluationRule:'fixed evidence review',stopRule:'no candidates or insufficient evidence',independentUnit:'terrain'},
  governor:{track:'quality',phase:'SCREENING',budget:{rounds:100,games:100,seconds:60},active:['a'],mechanismEvidence:true,independentDataReady:true,samplePlan:{frozen:true,precisionAssessed:true,requiredIndependentUnits:1,availableIndependentUnits:1}},
  candidates:[{id:'a',mechanism:'observed mechanism',falsifier:'no effect',evidence:'evidence.json'}],inputs:[{path:'evidence.json',sha256:hash('{}')}],
  batches:[{id:'b1',kind:'optimization',rounds:[{id:'r1',jobs:[job('j1'),job('j2',null)]}]},{id:'b2',kind:'optimization',rounds:[{id:'r2',jobs:[job('j3')]}]}]};
 if(options.change)options.change(plan);
 const file=path.join(root,'plan.json'),dir=path.join(root,'run');fs.writeFileSync(file,JSON.stringify(plan));R.init(file,dir);
 const review=(decision='retain',extra={})=>{const s=R.status(dir),file=path.join(root,'review.json');fs.writeFileSync(file,JSON.stringify({batchDigest:s.batchDigest,decision,analysisSeconds:0,reason:'fixed batch evidence assessed',evidence:[{path:'evidence.json',sha256:hash('{}')}],...extra}));return R.review(dir,file);};
 return {root,dir,plan,review};
}
test('one batch executes then review blocks further jobs; repeats are idempotent',async t=>{
 const f=fixture(t);let s=await R.run(f.dir);assert.equal(s.status,'NEEDS_REVIEW');assert.equal(s.used.games,2);assert.equal(s.used.rounds,1);assert.equal(s.independentUnits,1);
 assert.deepEqual(await R.run(f.dir),s);await f.review();s=await R.run(f.dir);assert.equal(s.used.games,3);await f.review();assert.equal(R.status(f.dir).status,'COMPLETE');
});
test('retiring the last candidate stops without baseline filler',async t=>{
 const f=fixture(t);await R.run(f.dir);const s=await f.review('retire',{retire:['a']});assert.equal(s.status,'STOP_NO_CANDIDATES');assert.equal((await R.run(f.dir)).used.games,2);
});
test('zero candidates and missing data gate before any worker is launched',async t=>{
 for(const change of [p=>{p.governor.active=[];p.candidates=[];p.batches=[];},p=>{p.governor.independentDataReady=false;}]){
  const f=fixture(t,{change});const s=await R.run(f.dir);assert.equal(s.used.games,0);assert.ok(['STOP_NO_CANDIDATES','STOP_DATA_LIMIT'].includes(s.status));
 }
});
test('prospective budgets count controls and block the whole batch',async t=>{
 const f=fixture(t,{change:p=>{p.governor.budget.games=1;}});const s=await R.run(f.dir);assert.equal(s.status,'STOP_NEXT_BATCH_EXCEEDS_BUDGET');assert.equal(s.used.games,0);
});
test('worker timeout is enforced and failed attempt is never retried',async t=>{
 const f=fixture(t,{change:p=>{p.batches[0].rounds[0].jobs[0].payload={hang:true};p.batches[0].rounds[0].jobs[0].timeoutSeconds=.15;}});
 const s=await R.run(f.dir);assert.equal(s.status,'STOP_WORKER_FAILURE');assert.equal(s.reason,'TIMEOUT');assert.equal(s.used.games,1);assert.equal(s.failedGames,1);assert.ok(s.used.seconds>=.1);assert.equal((await R.run(f.dir)).used.games,1);
});
test('process exit, health failure and hidden game count stop later jobs',async t=>{
 for(const payload of [{crash:true},{safe:false},{integrity:false},{games:2}]){
  const f=fixture(t,{change:p=>{p.batches[0].rounds[0].jobs[0].payload=payload;}});const s=await R.run(f.dir);assert.ok(s.status.startsWith('STOP_'));assert.equal(s.used.games,1);
 }
});
test('protocol, pinned input and result drift prevent dispatch or review',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.root,'evidence.json'),'changed');assert.equal((await R.run(f.dir)).status,'STOP_INTEGRITY');
 const g=fixture(t);await R.run(g.dir);fs.writeFileSync(path.join(g.dir,'jobs/j1.result.json'),'{}');await assert.rejects(g.review(),/RESULT_DRIFT/);
 const h=fixture(t);const p=JSON.parse(fs.readFileSync(path.join(h.dir,'protocol.json')));p.governor.budget.games=1000;fs.writeFileSync(path.join(h.dir,'protocol.json'),JSON.stringify(p));assert.equal((await R.run(h.dir)).status,'STOP_INTEGRITY');
});
test('confirmation reserves the full schedule and rejects adaptive retirement',async t=>{
 const change=p=>{p.governor.phase='CONFIRMATION';p.governor.frozenCandidates=['a'];};
 const f=fixture(t,{change:p=>{change(p);p.governor.budget.games=2;}});assert.equal((await R.run(f.dir)).status,'STOP_INSUFFICIENT_CONFIRMATION_BUDGET');
 const g=fixture(t,{change});await R.run(g.dir);await assert.rejects(g.review('retire',{retire:['a']}),/CONFIRMATION_ADAPTATION/);await g.review();assert.equal((await R.run(g.dir)).status,'NEEDS_REVIEW');
});
test('measurement work is counted in games and time but not optimization rounds',async t=>{
 const f=fixture(t,{change:p=>{p.governor.active=[];p.candidates=[];p.batches=[{id:'measure',kind:'measurement',rounds:[{id:'m1',jobs:[{id:'mjob',candidate:null,kind:'measurement',independentUnit:'map-1',timeoutSeconds:2,payload:{}}]}]}];}});
 const s=await R.run(f.dir);assert.equal(s.status,'NEEDS_REVIEW');assert.equal(s.used.games,1);assert.equal(s.used.rounds,0);assert.ok(s.used.seconds>0);await f.review();assert.equal((await R.run(f.dir)).used.games,1);
});
test('batch size, evidence admission, duplicate IDs and reused run directories are rejected',t=>{
 const f=fixture(t);assert.throws(()=>R.init(path.join(f.root,'plan.json'),f.dir),/EEXIST/);
 const p=structuredClone(f.plan);p.batches[0].rounds=Array(11).fill(p.batches[0].rounds[0]);assert.throws(()=>R.validate(p),/BATCH_ROUND_CAP/);
 const q=structuredClone(f.plan);q.candidates[0].evidence='missing';assert.throws(()=>R.validate(q),/EVIDENCE_NOT_PINNED/);
 const r=structuredClone(f.plan);r.batches[1].rounds[0].jobs[0].id='j1';assert.throws(()=>R.validate(r),/JOB_ID/);
});
test('stale review and concurrent lock cannot launch another batch',async t=>{
 const f=fixture(t);await R.run(f.dir);await assert.rejects(f.review('retain',{batchDigest:'old'}),/STALE_REVIEW/);
 fs.writeFileSync(path.join(f.dir,'.lock'),'existing writer');await assert.rejects(R.run(f.dir),/EEXIST/);
});
test('an interrupted reservation is stopped rather than silently replayed',async t=>{
 const f=fixture(t);const file=path.join(f.dir,'state.json'),s=R.load(f.dir);s.status='RUNNING';s.used.games=1;
 const {seal,...body}=s;s.seal=hash(JSON.stringify(body));fs.writeFileSync(file,JSON.stringify(s));
 assert.equal((await R.run(f.dir)).status,'STOP_INTERRUPTED');assert.equal(R.status(f.dir).used.games,1);
});
test('duplicate maps cannot satisfy the precision plan by adding seats or seeds',async t=>{
 const f=fixture(t,{change:p=>{p.governor.samplePlan.requiredIndependentUnits=2;p.governor.samplePlan.availableIndependentUnits=100;}});
 assert.equal((await R.run(f.dir)).status,'STOP_PRECISION_LIMIT');assert.equal(R.status(f.dir).used.games,0);
});
test('improve and rollback end the protocol instead of retuning its confirmation',async t=>{
 for(const decision of ['improve','rollback']){const f=fixture(t);await R.run(f.dir);assert.equal((await f.review(decision)).status,'STOP_'+decision.toUpperCase());assert.equal((await R.run(f.dir)).used.games,2);}
});
test('all retired candidate jobs and their attached warmups are omitted from future batches',async t=>{
 const f=fixture(t,{change:p=>{
  p.candidates.push({...p.candidates[0],id:'b'});p.governor.active.push('b');
  p.batches[1].rounds[0].jobs.push({...p.batches[1].rounds[0].jobs[0],id:'jb',candidate:'b'});
 }});
 await R.run(f.dir);await f.review('retire',{retire:['a']});const s=await R.run(f.dir);assert.equal(s.used.games,3);assert.deepEqual(s.active,['b']);assert.ok(!R.load(f.dir).jobs.some(j=>j.id==='j3'));
});
test('external analysis cost is recorded and can exhaust the next batch budget',async t=>{
 const f=fixture(t);await R.run(f.dir);const s=await f.review('retain',{analysisSeconds:60});assert.ok(s.used.seconds>=60);assert.equal((await R.run(f.dir)).status,'STOP_BUDGET');
});
