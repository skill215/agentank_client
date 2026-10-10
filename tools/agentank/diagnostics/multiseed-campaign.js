'use strict';
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
// Load the compiled module before loading any engine consumer. This is source
// substitution at module initialization, not a method wrapper on a live engine.
if (!isMainThread && workerData.mode !== 'baseline' && !workerData.vmCode) {
  const Module = require('node:module');
  const file = path.join(workerData.root, 'engine-v2/src/base-policy-specialized/path-utility.js');
  const candidate = new Module(file, module); candidate.filename = file;
  candidate.paths = Module._nodeModulePaths(path.dirname(file));
  candidate._compile(fs.readFileSync(workerData.moduleFile, 'utf8'), file);
  candidate.loaded = true; require.cache[file] = candidate;
}
const { play, NativeBasePolicyDiagnosticBot: Bot, productionTreeSha256 } = require('./native-base-policy-standalone-arena');
const { V3DiagnosticBot } = require('../../../engine-v3/src');
const { resolveFrozenV1 } = require('../../../engine-v3/src/legacy/default-source');
const { withClock, PROTOCOL } = require('./deterministic-v1-clock');
const { loadBombPhaseAdapter } = require('../simulation/bomb-phase-adapter');
const { withExplicitSeed } = require('./explicit-simulation-seed');
const { seedFor } = require('./v1-v3-arena');
const { createDesign } = require('./multiseed-design');
const { ARRAY } = require('../../../engine-v2/src/state/fast-state');
const { compare, passes, semantic } = isMainThread ? require('./efficient-tuning-campaign') : {};
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const jsonHash = v => hash(JSON.stringify(v));
const key = r => r.matchUrlId + ':' + r.candidateSeat;
const readJSON = f => JSON.parse(fs.readFileSync(f));
const readRows = f => z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
function saveBytes(f, bytes) {
  if (fs.existsSync(f)) { assert.deepEqual(fs.readFileSync(f), Buffer.from(bytes), 'IMMUTABLE_DRIFT:' + f); return; }
  const temp = f + '.tmp-' + process.pid;
  fs.writeFileSync(temp, bytes, { flag: 'wx' }); fs.renameSync(temp, f);
}
function saveJSON(f, value) { saveBytes(f, JSON.stringify(value, null, 2)); }

function validateRow(row, job, fingerprint) {
  assert.equal(row.matchUrlId, job.id); assert.equal(row.candidateSeat, job.seat);
  assert.equal(row.scenarioFingerprint, fingerprint); assert.equal(row.variant.mode, job.mode); assert.equal(row.variant.lane, job.lane);
  for (const side of [row.candidate, row.control]) { assert.equal(side.errorCount, 0); assert.equal(side.timeoutCount, 0); }
  assert.equal(row.seedControl.requestedSeed, job.seed); assert.equal(row.seedControl.effectiveSeed, job.seed);
  if (job.lane !== 'vm') { assert.equal(row.candidateEngine.rootRestoreFailures, 0); assert.equal(row.candidateEngine.hotAllocations, 0); }
}
function loadCheckpoint(file, jobs, fingerprints) {
  const records = new Map(); if (!fs.existsSync(file)) return { records, truncatedBytes: 0 };
  const bytes = fs.readFileSync(file), end = bytes.lastIndexOf(10) + 1;
  const complete = bytes.subarray(0, end).toString();
  for (const line of complete.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line); assert.ok(Number.isInteger(entry.index) && entry.index >= 0 && entry.index < jobs.length);
    assert.ok(!records.has(entry.index), 'DUPLICATE_CHECKPOINT_INDEX'); assert.equal(jsonHash(entry.row), entry.sha256);
    validateRow(entry.row, jobs[entry.index], fingerprints.get(jobs[entry.index].id)); records.set(entry.index, entry.row);
  }
  // Caller journals and removes only a non-newline-terminated fragment after all complete rows validate.
  return { records, truncatedBytes: bytes.length - end, validBytes: end };
}


async function workerRun() {
  const {root,scenarioFile,jobFile,pending,workerIndex,workers,mode}=workerData;
  const scenes=new Map(JSON.parse(z.gunzipSync(fs.readFileSync(scenarioFile))).map(s=>[s.matchUrlId,s]));
  const jobs=readJSON(jobFile),{module:sim}=await loadBombPhaseAdapter(root);
  const v1=V3DiagnosticBot.prototype.decide,capture=Bot.prototype.captureRoot;let audit,roots;
  V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>v1.call(this,c));};
  Bot.prototype.captureRoot=function(context){const e=this.engine,s=e.basePolicy.policySearch,reason=this.searchEntry;
    audit.reasons[reason]=(audit.reasons[reason]||0)+1;audit.lastReason=reason;
    if(this.searchEvidenceCurrent){audit.searchRoots++;audit.nodes+=s.nodes;audit.budgetLeaves+=s.lastBudgetLeafCount;}
    const a=e.adapter.state.arrays;
    roots.push({frame:context.game.frames,reason,previousAction:this.previousAction,turnStreak:e.turnStreak,
      selectedAction:e.lastAction,ownStars:a[ARRAY.TANK_STARS][0],enemyStars:a[ARRAY.TANK_STARS][1],nodes:this.searchEvidenceCurrent?s.nodes:0});
  };
  try {for(let n=workerIndex;n<pending.length;n+=workers){
    const i=pending[n],job=jobs[i];audit={reasons:{},searchRoots:0,nodes:0,budgetLeaves:0,lastReason:null};roots=[];
    let observed=null,calls=0;
    const controlled=withExplicitSeed(sim,job.seed,value=>{observed=value;calls++;});
    const row=await play(controlled,scenes.get(job.id),job.seat,true);
    assert.equal(calls,1);assert.equal(observed.hostDerivedSeed,seedFor(scenes.get(job.id)));
    delete row.candidateEngine.rootFrames;delete row.control.actionFrames;
    row.audit=audit;row.compactRoots=roots;row.variant={mode,lane:'native'};
    row.seedControl={requestedSeed:job.seed,...observed};
    validateRow(row,job,scenes.get(job.id).fingerprint);parentPort.postMessage({index:i,row});
  }}finally{V3DiagnosticBot.prototype.decide=v1;Bot.prototype.captureRoot=capture;}
}

async function runStep(root,out){
  const log=x=>console.log(JSON.stringify(x));
  const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
  const portable=path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds');
  const prior=path.join(root,'artifacts/native-causal-audit/bp393-seed-factor-ten-rounds');
  const bm=readJSON(path.join(base,'manifest.json')),pm=readJSON(path.join(prior,'manifest.json')),buildManifest=readJSON(path.join(portable,'manifest.json'));
  const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz'))));
  const priorScenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(prior,'scenarios.json.gz'))));
  const design=createDesign(historical,priorScenes,pm.cells);
  const originalFiles={baseline:path.join(base,'matches.ndjson.gz'),R15:path.join(portable,'R41-portable-full/matches.ndjson.gz'),R29:path.join(portable,'R42-portable-full/matches.ndjson.gz')};
  const replicaNames={baseline:'seed-replica-baseline',R15:'R59-seed-replica',R29:'R60-seed-replica'};
  const references={};for(const mode of ['baseline','R15','R29'])references[mode]=[...readRows(originalFiles[mode]),...readRows(path.join(prior,replicaNames[mode],'matches.ndjson.gz'))];
  const tree=productionTreeSha256(root),adapter=(await loadBombPhaseAdapter(root)).identity;
  assert.equal(tree,bm.tree);assert.deepEqual(adapter,bm.adapter);assert.equal(process.version,bm.node);assert.equal(resolveFrozenV1(root).sha256,bm.v1);assert.equal(PROTOCOL,bm.clock);
  const hostHash=hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena')));assert.equal(hostHash,bm.hostSha256);
  const indexHash=hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json')));assert.equal(indexHash,pm.indexHash,'LOCAL_INDEX_CHANGED_REVIEW_NEW_MAPS');
  fs.mkdirSync(out,{recursive:true});const moduleHashes={};
  for(const mode of ['baseline','R15','R29']){
    const bytes=fs.readFileSync(path.join(portable,'build',mode,'path-utility.js'));assert.equal(hash(bytes),buildManifest.buildHashes[mode]['path-utility.js']);moduleHashes[mode]=hash(bytes);
    const dir=path.join(out,'build',mode);fs.mkdirSync(dir,{recursive:true});saveBytes(path.join(dir,'path-utility.js'),bytes);
  }
  const scenarios=[...design.preflight,...Object.values(design.conditions).flat()];assert.equal(new Set(scenarios.map(s=>s.matchUrlId)).size,scenarios.length);
  const fingerprints=new Map(scenarios.map(s=>[s.matchUrlId,s.fingerprint]));
  const sourceFiles=['tools/agentank/diagnostics/multiseed-campaign.js','tools/agentank/diagnostics/multiseed-design.js','tools/agentank/diagnostics/explicit-simulation-seed.js',
    'docs/implementation/multiseed-protocol-bp394.md','test/minimax-core/multiseed-design.test.js',
    'tools/agentank/diagnostics/efficient-tuning-campaign.js','tools/agentank/diagnostics/deterministic-v1-clock.js','tools/agentank/diagnostics/v1-v3-arena.js'];
  const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
  saveJSON(path.join(out,'manifest.json'),{schema:1,tree,adapter,node:process.version,v1:bm.v1,clock:PROTOCOL,hostHash,sourceHashes,moduleHashes,indexHash,
    priorManifestSha256:hash(fs.readFileSync(path.join(prior,'manifest.json'))),referenceHashes:Object.fromEntries(Object.entries(references).map(([k,v])=>[k,jsonHash(v)])),
    groups:pm.groups,cells:pm.cells,preflight:design.preflight.map(s=>s.matchUrlId),
    conditions:Object.fromEntries(Object.entries(design.conditions).map(([k,v])=>[k,v.map(s=>({id:s.matchUrlId,parent:s.parentMatchUrlId,seed:s.simulationSeed,fingerprint:s.fingerprint}))]))});
  const scenarioFile=path.join(out,'scenarios.json.gz');saveBytes(scenarioFile,z.gzipSync(JSON.stringify(scenarios)));
  for(const f of sourceFiles){const dest=path.join(out,'sources',f);fs.mkdirSync(path.dirname(dest),{recursive:true});saveBytes(dest,fs.readFileSync(path.join(root,f)));}
  let advanced = false, nextStage = null;
  const stageTotals = [];
  const identity = jsonHash(readJSON(path.join(out, 'manifest.json')));
  async function stage(name, jobs, reuse = []) {
    const dir = path.join(out, name), saved = path.join(dir, 'matches.ndjson.gz'), executionFile = path.join(dir, 'execution.json');
    if (!fs.existsSync(executionFile) && advanced) { nextStage = name; return null; }
    fs.mkdirSync(dir, { recursive: true }); saveJSON(path.join(dir, 'jobs.json'), jobs);
    saveJSON(path.join(dir, 'identity.json'), { campaign: identity, jobsSha256: jsonHash(jobs) });
    if (fs.existsSync(executionFile)) {
      const execution = readJSON(executionFile), rows = readRows(saved);
      assert.equal(hash(fs.readFileSync(saved)), execution.matchesSha256); assert.equal(rows.length, jobs.length);
      rows.forEach((r, i) => validateRow(r, jobs[i], fingerprints.get(jobs[i].id))); stageTotals.push({ name, ...execution }); return rows;
    }
    advanced = true;
    const checkpointFile = path.join(dir, 'checkpoint.ndjson');
    const checkpoint = loadCheckpoint(checkpointFile, jobs, fingerprints), records = checkpoint.records;
    if (checkpoint.truncatedBytes) {
      fs.appendFileSync(path.join(out, 'recovery.ndjson'), JSON.stringify({ stage: name, truncatedBytes: checkpoint.truncatedBytes, validRows: records.size }) + '\n');
      fs.truncateSync(checkpointFile, checkpoint.validBytes);
    }
    const reused = new Map(reuse.map(r => [key(r), r]));
    const reusedIndices = jobs.map((j, i) => reused.has(j.id + ':' + j.seat) ? i : -1).filter(i => i >= 0);
    const append = (i, row) => {
      validateRow(row, jobs[i], fingerprints.get(jobs[i].id)); assert.ok(!records.has(i));
      fs.appendFileSync(checkpointFile, JSON.stringify({ index: i, sha256: jsonHash(row), row }) + '\n'); records.set(i, row);
    };
    for (const i of reusedIndices) { const row = reused.get(jobs[i].id + ':' + jobs[i].seat);
      if (records.has(i)) assert.deepEqual(records.get(i), row); else append(i, row); }
    const pending = jobs.map((_, i) => i).filter(i => !records.has(i)), threads = [], stageStart = Date.now();
    log({ stage: name, status: 'START', games: jobs.length, checkpointed: records.size, pending: pending.length, reused: reusedIndices.length });
    try {
      const workers = Math.min(4, pending.length);
      await Promise.all(Array.from({ length: workers }, (_, workerIndex) => new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: { root, scenarioFile, jobFile: path.join(dir, 'jobs.json'), pending, workerIndex, workers, mode: jobs[0].mode, moduleFile: path.join(out,'build',jobs[0].mode,'path-utility.js'), vmCode: jobs[0].lane === 'vm' ? path.join(out,'build',jobs[0].mode,'minified.js') : null } });
        threads.push(worker); worker.on('message', ({ index, row }) => { try { append(index, row);
          if (records.size % 32 === 0 || records.size === jobs.length) log({ stage: name, done: records.size, total: jobs.length });
        } catch (e) { reject(e); } }); worker.on('error', reject); worker.on('exit', code => code ? reject(Error('WORKER_EXIT_' + code)) : resolve());
      })));
      assert.equal(records.size, jobs.length); assert.equal(productionTreeSha256(root), tree);
      const rows = jobs.map((_, i) => records.get(i));
      saveBytes(saved, z.gzipSync(rows.map(JSON.stringify).join('\n') + '\n'));
      const execution = { games: rows.length, executedGames: rows.length - reusedIndices.length, reusedGames: reusedIndices.length,
        lastInvocationNewGames: pending.length, lastInvocationSeconds: (Date.now() - stageStart) / 1000, errors: 0, timeouts: 0, restore: jobs[0].lane === 'vm' ? null : 0, hotAllocations: jobs[0].lane === 'vm' ? null : 0,
        matchesSha256: hash(fs.readFileSync(saved)) };
      saveJSON(executionFile, execution); stageTotals.push({ name, ...execution }); return rows;
    } catch (e) { await Promise.allSettled(threads.map(t => t.terminate())); throw e; }
  }


  const jobs=(scenes,mode)=>scenes.flatMap(s=>[0,1].map(seat=>({id:s.matchUrlId,seat,mode,lane:'native',seed:s.simulationSeed??seedFor(s)})));
  const preflight=[];
  for(const mode of ['baseline','R15','R29']){
    const rows=await stage('seed-preflight-'+mode,jobs(design.preflight,mode));
    if(!rows)return log({status:'CONTINUE',nextStage});
    const index=new Map(references[mode].map(r=>[key(r),r]));
    for(const r of rows){const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b),'SEED_WRAPPER_DRIFT');assert.equal(r.result.reason,b.result.reason);assert.deepEqual(r.audit,b.audit,'SEED_WORK_DRIFT');}
    preflight.push({mode,games:rows.length,equivalent:true});
  }
  saveJSON(path.join(out,'preflight.json'),preflight);
  const rounds=[];let roundNumber=61;
  for(const [condition,scenes] of Object.entries(design.conditions)){
    const before=await stage(condition+'-baseline',jobs(scenes,'baseline'));
    if(!before)return log({status:'CONTINUE',nextStage});
    for(const mode of ['R15','R29']){
      const id='R'+roundNumber++,after=await stage(id+'-'+condition,jobs(scenes,mode));
      if(!after)return log({status:'CONTINUE',nextStage});
      const performance=compare(before,after),round={id,candidate:mode,condition,games:after.length,performance,
        status:passes(performance,'development')?'PRESSURE_PASS':'PRESSURE_REJECTED'};
      const existed=fs.existsSync(path.join(out,id+'.json'));saveJSON(path.join(out,id+'.json'),round);rounds.push(round);
      if(!existed)log({round:id,status:round.status,deltaPoints:performance.deltaPoints});
    }
  }
  assert.equal(rounds.length,10);assert.equal(productionTreeSha256(root),tree);
  for(const [f,sha]of Object.entries(sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,f))),sha);
  const result={status:'TEN_ROUNDS_COMPLETE',rounds,stages:stageTotals,productionUnchanged:true,
    executedGames:stageTotals.reduce((n,s)=>n+s.executedGames,0),reusedGames:0,stageSeconds:stageTotals.reduce((n,s)=>n+s.lastInvocationSeconds,0)};
  assert.equal(result.executedGames,5856);saveJSON(path.join(out,'rounds.json'),result);log({status:result.status,executedGames:result.executedGames});
}
if(!isMainThread)workerRun().catch(e=>{throw e;});
else if(require.main===module)runStep(process.cwd(),path.resolve(process.argv[2])).catch(e=>{
  console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter data URL]'));process.exitCode=1;
});
module.exports={createDesign,validateRow,loadCheckpoint,jsonHash,runStep};
