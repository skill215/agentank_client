'use strict';
// One bounded batch per invocation. Reviews, reservations and failures are durable.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const {govern} = require('./experiment-governor');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = value => hash(JSON.stringify(value));
const positive = n => Number.isFinite(n) && n > 0;
const integer = n => Number.isSafeInteger(n) && n >= 0;

function atomic(file, value) {
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function save(dir, s, type, data = {}) {
  const event = {seq:s.events.length, type, data, previous:s.events.at(-1)?.hash || null};
  s.events.push({...event, hash:digest(event)});
  const {seal, ...body} = s;
  s.seal = digest(body);
  atomic(path.join(dir, 'state.json'), s);
}
function load(dir) {
  const s = read(path.join(dir, 'state.json'));
  const {seal, ...body} = s;
  assert.equal(digest(body), seal, 'STATE_INTEGRITY');
  let previous = null;
  for (const [i, e] of s.events.entries()) {
    const {hash:h, ...v} = e;
    assert.equal(e.seq, i); assert.equal(e.previous, previous); assert.equal(digest(v), h);
    previous = h;
  }
  return s;
}
function validate(p) {
  assert.equal(p.version, 1, 'PLAN_VERSION');
  for (const k of ['question','metric','minimumEffect','evaluationRule','stopRule','independentUnit'])
    assert.ok(typeof p.objective?.[k] === 'string' && p.objective[k].trim(), 'OBJECTIVE_' + k);
  const s = p.governor;
  assert.ok(s && ['REGRESSION','SCREENING','CONFIRMATION'].includes(s.phase), 'EXECUTABLE_PHASE_REQUIRED');
  assert.ok(integer(s.budget.rounds) && s.budget.rounds > 0 && s.budget.rounds <= 100, 'ROUND_CAP');
  assert.ok(integer(s.budget.games) && s.budget.games > 0 && positive(s.budget.seconds), 'HARD_BUDGETS');
  assert.ok(Array.isArray(p.candidates) && Array.isArray(p.batches) && Array.isArray(p.inputs));
  const names = new Set();
  for (const c of p.candidates) {
    assert.ok(c.id && !names.has(c.id), 'CANDIDATE_ID'); names.add(c.id);
    for (const k of ['mechanism','falsifier','evidence']) assert.ok(typeof c[k] === 'string' && c[k].trim(), 'CANDIDATE_' + k);
    assert.ok(p.inputs.some(i => i.path === c.evidence), 'MECHANISM_EVIDENCE_NOT_PINNED');
  }
  assert.deepEqual([...names].sort(), [...(s.active || [])].sort(), 'CANDIDATE_REGISTRY_MISMATCH');
  if (s.phase === 'CONFIRMATION') assert.deepEqual(s.active, s.frozenCandidates, 'CONFIRMATION_SHORTLIST_DRIFT');
  const ids = new Set();
  let rounds = 0;
  for (const b of p.batches) {
    assert.ok(b.id && !ids.has(b.id), 'BATCH_ID'); ids.add(b.id);
    assert.ok(['optimization','measurement'].includes(b.kind), 'BATCH_KIND');
    assert.ok(Array.isArray(b.rounds) && b.rounds.length > 0 && b.rounds.length <= 10, 'BATCH_ROUND_CAP');
    if (b.kind === 'optimization') rounds += b.rounds.length;
    for (const r of b.rounds) {
      assert.ok(r.id && !ids.has(r.id), 'ROUND_ID'); ids.add(r.id);
      assert.ok(Array.isArray(r.jobs) && r.jobs.length, 'EMPTY_ROUND');
      for (const j of r.jobs) {
        assert.match(j.id, /^[a-zA-Z0-9_-]+$/); assert.ok(!ids.has(j.id), 'JOB_ID'); ids.add(j.id);
        assert.ok(j.candidate === null || names.has(j.candidate), 'UNKNOWN_CANDIDATE');
        assert.ok(['candidate','control','warmup','preflight','measurement'].includes(j.kind), 'JOB_KIND');
        assert.ok(typeof j.independentUnit === 'string' && j.independentUnit && positive(j.timeoutSeconds), 'JOB_COST_AND_UNIT_REQUIRED');
        assert.ok(j.payload && typeof j.payload === 'object', 'JOB_PAYLOAD');
      }
      if (b.kind === 'optimization') assert.ok(r.jobs.some(j => j.kind === 'candidate' && j.candidate !== null), 'REFERENCE_ONLY_ROUND');
    }
  }
  assert.ok(rounds <= s.budget.rounds, 'PROJECT_ROUND_CAP');
  assert.ok(p.batches.filter(b => b.kind === 'measurement').length <= 1, 'MEASUREMENT_CAP');
}
function verify(dir, s) {
  const p = read(path.join(dir, 'protocol.json'));
  assert.equal(digest(p), s.protocolHash, 'PROTOCOL_DRIFT');
  for (const input of p.pinnedInputs) assert.equal(hash(fs.readFileSync(input.path)), input.sha256, 'INPUT_DRIFT:' + input.path);
  return p;
}
function init(planFile, dir) {
  const started=performance.now();
  const source = read(planFile); validate(source);
  const root = path.resolve(source.root || process.cwd());
  const adapter = path.resolve(root, source.adapter);
  const paths = [__filename, path.join(__dirname,'experiment-governor.js'), path.join(__dirname,'experiment-worker.js'), adapter];
  const collect = directory => {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())collect(file);
      else if(entry.isFile())paths.push(file);
    }
  };
  const codeRoots=[...(source.codeRoots || [])];
  if(adapter===path.join(__dirname,'experiment-native-adapter.js')){
    codeRoots.push('engine-v2/src','engine-v3/src','tools/agentank');
    codeRoots.push(require('../simulation/paired-arena').simulatorDirectory(root));
    for(const name of ['package.json','package-lock.json'])if(fs.existsSync(path.join(root,name)))paths.push(path.join(root,name));
  }
  for(const directory of new Set(codeRoots))collect(path.resolve(root,directory));
  const inputs = source.inputs.map(i => {
    const file = path.resolve(root, i.path), sha256 = hash(fs.readFileSync(file));
    assert.equal(sha256, i.sha256, 'DECLARED_INPUT_DRIFT:' + file); return {path:file, sha256};
  });
  const pinnedInputs = [...new Map([...inputs, ...paths.map(file => ({path:file,sha256:hash(fs.readFileSync(file))}))].map(i => [i.path, i])).values()];
  const p = {...source,root,adapter,pinnedInputs};
  // Never reset a run. A new directory establishes a new immutable experiment.
  fs.mkdirSync(dir); fs.mkdirSync(path.join(dir,'jobs'));
  atomic(path.join(dir,'protocol.json'), p);
  const s = {version:1,protocolHash:digest(p),budget:p.governor.budget,status:'READY',batch:0,active:[...(p.governor.active || [])],retired:[],used:{rounds:0,games:0,seconds:(performance.now()-started)/1000},measurementBatchesUsed:0,jobs:[],roundIds:[],events:[]};
  save(dir,s,'INIT'); return status(dir);
}
async function locked(dir, action) {
  const file = path.join(dir,'.lock');
  const fd = fs.openSync(file,'wx');
  fs.writeFileSync(fd, JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
  try { return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
function effectiveBatch(p,s) {
  const b = p.batches[s.batch]; if (!b) return null;
  const rounds = b.rounds.map(r => ({...r,jobs:r.jobs.filter(j => j.candidate === null || s.active.includes(j.candidate))}))
    .filter(r => b.kind === 'measurement' || r.jobs.some(j => j.kind === 'candidate' && j.candidate !== null));
  return {...b,rounds};
}
function decision(p,s,b) {
  const jobs = b?.rounds.flatMap(r => r.jobs) || [];
  const input = {...p.governor,active:s.active,retired:s.retired,used:s.used,
    measurementBatchesUsed:s.measurementBatchesUsed,pendingMeasurement:b?.kind === 'measurement',
    nextBatchCost:{rounds:b?.rounds.length || 1,games:jobs.length,seconds:jobs.reduce((n,j)=>n+j.timeoutSeconds,0)}};
  // Repeated seats/seeds and warmups cannot inflate the frozen map count.
  const formalUnits = new Set(p.batches.flatMap(x=>x.rounds.flatMap(r=>r.jobs))
    .filter(j=>j.kind==='candidate'&&s.active.includes(j.candidate)).map(j=>j.independentUnit)).size;
  if(input.samplePlan)input.samplePlan={...input.samplePlan,availableIndependentUnits:Math.min(input.samplePlan.availableIndependentUnits,formalUnits)};
  if (input.phase === 'CONFIRMATION') {
    input.confirmationComplete = false;
    // Reserve all remaining fixed confirmation jobs, including warmups/controls.
    const remaining = p.batches.slice(s.batch).flatMap(x => x.rounds.flatMap(r => r.jobs));
    if (s.used.games + remaining.length > input.budget.games || s.used.seconds + remaining.reduce((n,j)=>n+j.timeoutSeconds,0) > input.budget.seconds)
      return {action:'STOP_INSUFFICIENT_CONFIRMATION_BUDGET',dispatchOptimizationBatch:false};
  }
  return govern(input);
}
function stop(dir,s,reason,detail) {
  s.status = reason; s.reason = detail || reason; save(dir,s,'STOP',{reason,detail}); return status(dir);
}
function execute(p,dir,job,timeoutSeconds) {
  return new Promise(resolve => {
    const request = path.join(dir,'jobs',job.id+'.request.json'), resultFile = path.join(dir,'jobs',job.id+'.result.json');
    atomic(request,{root:p.root,adapter:p.adapter,inputs:p.pinnedInputs,payload:job.payload,resultFile});
    const child = spawn(process.execPath,[path.join(__dirname,'experiment-worker.js'),request],{cwd:p.root,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let output='', error=null, timedOut=false;
    const kill = () => {try {if (process.platform!=='win32') process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch {}};
    const timer = setTimeout(()=>{timedOut=true;kill();},Math.max(1,Math.floor(timeoutSeconds*1000)));
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{
      output += chunk.toString(); if (output.length > 1024*1024) {error='WORKER_OUTPUT_LIMIT';output=output.slice(0,1024*1024);kill();}
    });
    child.on('error',e=>{error=e.message;});
    child.on('close',code=>{
      clearTimeout(timer);fs.writeFileSync(path.join(dir,'jobs',job.id+'.log'),output);
      if (timedOut || error || code !== 0) return resolve({failure:timedOut?'TIMEOUT':error || 'WORKER_EXIT_'+code});
      try {resolve({result:read(resultFile),resultHash:hash(fs.readFileSync(resultFile))});}
      catch(e) {resolve({failure:'INVALID_RESULT:'+e.message});}
    });
  });
}
async function run(dir) {
  dir=path.resolve(dir);
  return locked(dir,async()=>{
    const start=performance.now(), s=load(dir), previousSeconds=s.used.seconds;
    const charge=()=>{s.used.seconds=previousSeconds+(performance.now()-start)/1000;};
    if (s.status !== 'READY' && s.status !== 'RUNNING') return status(dir);
    let p; try {p=verify(dir,s);} catch(e) {charge();return stop(dir,s,'STOP_INTEGRITY',e.message);}
    if (s.status === 'RUNNING') {
      // A killed parent cannot report elapsed work. Charge unresolved leases at
      // their full reserved time instead of restoring an artificially free budget.
      charge();s.used.seconds+=s.jobs.filter(j=>j.status==='RESERVED').reduce((n,j)=>n+j.reservedSeconds,0);
      return stop(dir,s,'STOP_INTERRUPTED','Previous run did not finish; reserved jobs will not be replayed automatically.');
    }
    const b=effectiveBatch(p,s);
    if (!b) {charge();return stop(dir,s,s.active.length?'COMPLETE':'STOP_NO_CANDIDATES','No further frozen batch can be dispatched.');}
    charge();const gate=decision(p,s,b); save(dir,s,'GATE',gate);
    const measurement = gate.action === 'BOUNDED_MEASUREMENT_ONLY';
    if (!gate.dispatchOptimizationBatch && !measurement) {charge();return stop(dir,s,gate.action,gate.reason);}
    if (!b.rounds.length || (b.kind==='measurement' && !measurement)) {charge();return stop(dir,s,'STOP_INVALID_BATCH');}
    s.status='RUNNING';if(measurement)s.measurementBatchesUsed++;
    save(dir,s,'BATCH_START',{id:b.id,kind:b.kind,active:s.active});
    for (const round of b.rounds) for (const job of round.jobs) {
      charge();
      try {verify(dir,s);} catch(e) {charge();return stop(dir,s,'STOP_INTEGRITY',e.message);}
      charge();
      const newRound=!measurement&&!s.roundIds.includes(round.id);
      if(s.used.games>=p.governor.budget.games || s.used.seconds>=p.governor.budget.seconds || (newRound&&s.used.rounds>=p.governor.budget.rounds)) return stop(dir,s,'STOP_BUDGET');
      assert.ok(!s.jobs.some(j=>j.id===job.id),'JOB_ALREADY_RESERVED');
      if(newRound){s.roundIds.push(round.id);s.used.rounds++;}
      s.used.games++; // Attempts, including failed jobs, consume game budget before dispatch.
      const reservedSeconds=Math.min(job.timeoutSeconds,p.governor.budget.seconds-s.used.seconds);
      const entry={id:job.id,batch:b.id,round:round.id,candidate:job.candidate,kind:job.kind,independentUnit:job.independentUnit,reservedSeconds,status:'RESERVED'};
      s.jobs.push(entry);save(dir,s,'JOB_RESERVED',{id:job.id});
      const work=await execute(p,dir,job,reservedSeconds);
      charge();Object.assign(entry,work,{status:work.failure?'FAILED':'COMPLETED'});
      save(dir,s,'JOB_FINISHED',{id:job.id,status:entry.status,resultHash:work.resultHash || null});
      if(work.failure)return stop(dir,s,'STOP_WORKER_FAILURE',work.failure);
      const v=work.result;
      if(v.games!==1 || v.integrityPassed!==true || v.safetyPassed!==true) return stop(dir,s,'STOP_INVALID_OR_UNSAFE','Worker must attest exactly one game and explicit passing checks.');
      if(s.used.seconds>p.governor.budget.seconds)return stop(dir,s,'STOP_BUDGET');
    }
    try {verify(dir,s);} catch(e) {charge();return stop(dir,s,'STOP_INTEGRITY',e.message);}
    charge();s.status='NEEDS_REVIEW';s.batchDigest=digest(s.jobs.filter(j=>j.batch===b.id));
    save(dir,s,'BATCH_COMPLETE',{batch:b.id,batchDigest:s.batchDigest});
    return status(dir);
  });
}
async function review(dir,file) {
  dir=path.resolve(dir);
  return locked(dir,async()=>{
    const started=performance.now();
    const s=load(dir),p=verify(dir,s),r=read(file);
    assert.equal(s.status,'NEEDS_REVIEW','REVIEW_NOT_DUE');
    assert.equal(r.batchDigest,s.batchDigest,'STALE_REVIEW');
    assert.ok(['retain','retire','improve','rollback','stop'].includes(r.decision),'REVIEW_DECISION');
    assert.ok(typeof r.reason==='string'&&r.reason.trim(),'REVIEW_REASON');
    assert.ok(Number.isFinite(r.analysisSeconds)&&r.analysisSeconds>=0,'REVIEW_ANALYSIS_COST_REQUIRED');
    assert.ok(Array.isArray(r.evidence)&&r.evidence.length,'REVIEW_EVIDENCE');
    for(const e of r.evidence)assert.equal(hash(fs.readFileSync(path.resolve(p.root,e.path))),e.sha256,'REVIEW_EVIDENCE_DRIFT');
    // Verify every result; no edits to unfavorable observations between run and review.
    for(const j of s.jobs)if(j.resultHash)assert.equal(hash(fs.readFileSync(path.join(dir,'jobs',j.id+'.result.json'))),j.resultHash,'RESULT_DRIFT');
    if(p.governor.phase==='CONFIRMATION')assert.ok(['retain','stop','rollback'].includes(r.decision),'CONFIRMATION_ADAPTATION');
    if(r.decision==='retire'){
      assert.ok(Array.isArray(r.retire)&&r.retire.length&&new Set(r.retire).size===r.retire.length);
      assert.ok(r.retire.every(id=>s.active.includes(id)),'UNKNOWN_RETIRED_CANDIDATE');
      s.retired.push(...r.retire);s.active=s.active.filter(id=>!r.retire.includes(id));
    }
    s.batch++;delete s.batchDigest;
    if(['stop','improve','rollback'].includes(r.decision))s.status='STOP_'+r.decision.toUpperCase();
    else if(!s.active.length)s.status='STOP_NO_CANDIDATES';
    else s.status=s.batch>=p.batches.length?'COMPLETE':'READY';
    s.used.seconds+=r.analysisSeconds+(performance.now()-started)/1000;
    save(dir,s,'REVIEW',r);return status(dir);
  });
}
function status(dir) {
  const s=load(dir);
  return {status:s.status,reason:s.reason,active:s.active,retired:s.retired,used:s.used,budget:s.budget,
    completedGames:s.jobs.filter(j=>j.status==='COMPLETED').length,failedGames:s.jobs.filter(j=>j.status==='FAILED').length,
    independentUnits:new Set(s.jobs.filter(j=>j.status==='COMPLETED').map(j=>j.independentUnit)).size,
    formalIndependentUnits:new Set(s.jobs.filter(j=>j.status==='COMPLETED'&&j.kind==='candidate').map(j=>j.independentUnit)).size,
    completedBatches:s.events.filter(e=>e.type==='BATCH_COMPLETE').length,reviews:s.events.filter(e=>e.type==='REVIEW').length,
    batchDigest:s.batchDigest,productionAdoption:false};
}
async function main(args) {
  const [command,...rest]=args;
  if(command==='init'&&rest.length===2)return init(rest[0],path.resolve(rest[1]));
  if(command==='run'&&rest.length===1)return run(rest[0]);
  if(command==='review'&&rest.length===2)return review(rest[0],rest[1]);
  if(command==='status'&&rest.length===1)return status(rest[0]);
  throw Error('Usage: experiment-runner.js init PLAN RUN_DIR | run RUN_DIR | review RUN_DIR REVIEW | status RUN_DIR');
}
if(require.main===module)main(process.argv.slice(2)).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={init,run,review,status,validate,load};
