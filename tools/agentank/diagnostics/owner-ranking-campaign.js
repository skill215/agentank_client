'use strict';
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { play, NativeBasePolicyDiagnosticBot: Bot, productionTreeSha256 } = require('./native-base-policy-standalone-arena');
const { V3DiagnosticBot } = require('../../../engine-v3/src');
const { resolveFrozenV1 } = require('../../../engine-v3/src/legacy/default-source');
const { withClock, PROTOCOL } = require('./deterministic-v1-clock');
const { loadBombPhaseAdapter } = require('../simulation/bomb-phase-adapter');
const { SPECS, install } = require('./owner-ranking-variants');
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
function chooseCohorts(scenarios, evidenceParents, priorParents) {
  const byId=new Map(scenarios.map(s=>[s.matchUrlId,s]));
  const rank=(tag,s)=>hash(tag+':'+s.matchUrlId),used=new Set(),development=[];
  function add(s,list){const h=jsonHash(s.map);if(used.has(h))return;used.add(h);list.push(s.matchUrlId);}
  for(const id of [...new Set(evidenceParents)].sort())add(byId.get(id),development);
  for(const s of scenarios.slice().sort((a,b)=>rank('bp396-development-v1',a).localeCompare(rank('bp396-development-v1',b)))){if(development.length===64)break;add(s,development);}
  const excluded=new Set([...used,...priorParents.map(id=>jsonHash(byId.get(id).map))]);
  const validation=[];
  for(const s of scenarios.slice().sort((a,b)=>rank('bp396-validation-v1',a).localeCompare(rank('bp396-validation-v1',b)))){
    const h=jsonHash(s.map);if(excluded.has(h))continue;excluded.add(h);validation.push(s.matchUrlId);if(validation.length===128)break;
  }
  assert.equal(development.length,64);assert.equal(validation.length,128);return {development,validation};
}
function validateRow(row, job, fingerprint) {
  assert.equal(row.matchUrlId, job.id); assert.equal(row.candidateSeat, job.seat);
  assert.equal(row.scenarioFingerprint, fingerprint); assert.equal(row.variant.mode, job.mode);
  for (const side of [row.candidate, row.control]) { assert.equal(side.errorCount, 0); assert.equal(side.timeoutCount, 0); }
  assert.equal(row.candidateEngine.rootRestoreFailures, 0); assert.equal(row.candidateEngine.hotAllocations, 0);
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
  const { root, scenarioFile, jobFile, pending, workerIndex, workers } = workerData;
  const scenes = new Map(JSON.parse(z.gunzipSync(fs.readFileSync(scenarioFile))).map(s => [s.matchUrlId, s]));
  const jobs = readJSON(jobFile), { module } = await loadBombPhaseAdapter(root);
  const v1 = V3DiagnosticBot.prototype.decide, v2 = Bot.prototype.decide, capture = Bot.prototype.captureRoot;
  let job, audit, stats;
  V3DiagnosticBot.prototype.decide = function (c) { return withClock(this.controller.runtime.sandbox, () => v1.call(this, c)); };
  Bot.prototype.decide = function (...args) {
    if (!this.bp397Stats) { this.bp397Stats = install(this.engine, job.mode); stats = this.bp397Stats; }
    return v2.apply(this, args);
  };
  Bot.prototype.captureRoot = function () {
    const e=this.engine;
    if(this.searchEvidenceCurrent){
      if(e.lastProposalRow>=0){assert.equal(e.basePolicy.owner.allowedRow[e.lastProposalRow],1,'OWNER_ELIGIBILITY_BYPASS');assert.equal(e.hardStatus[e.lastProposalRow],0);stats.proposalsChecked=(stats.proposalsChecked||0)+1;}
      if(e.lastSelectedRow>=0){assert.equal(e.hardStatus[e.lastSelectedRow],0);assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,e.lastSelectedRow,e.ourCount),'FINAL_GATE_BYPASS');stats.finalChecks=(stats.finalChecks||0)+1;}
    }
    const s = e.basePolicy.policySearch, reason = this.searchEntry;
    audit.reasons[reason] = (audit.reasons[reason] || 0) + 1; audit.lastReason = reason;
    if (this.searchEvidenceCurrent) { audit.searchRoots++; audit.nodes += s.nodes; audit.budgetLeaves += s.lastBudgetLeafCount; }
  };
  try {
    for (let n = workerIndex; n < pending.length; n += workers) {
      const i = pending[n]; job = jobs[i]; stats = null;
      audit = { reasons: {}, searchRoots: 0, nodes: 0, budgetLeaves: 0, lastReason: null };
      const row = await play(module, scenes.get(job.id), job.seat, true);
      delete row.candidateEngine.rootFrames; delete row.control.actionFrames; row.audit = audit; row.variant = stats;
      validateRow(row, job, scenes.get(job.id).fingerprint); parentPort.postMessage({ index: i, row });
    }
  } finally { V3DiagnosticBot.prototype.decide = v1; Bot.prototype.decide = v2; Bot.prototype.captureRoot = capture; }
}
async function runStep(root, out) {
  const base = path.join(root, 'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
  const evidence=path.join(root,'artifacts/native-causal-audit/bp395-persistent-death-ten-rounds');
  const portable=path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds');
  const prior=path.join(root,'artifacts/native-causal-audit/bp394-multiseed-ten-rounds');
  const bm=readJSON(path.join(base,'manifest.json')),em=readJSON(path.join(evidence,'manifest.json')),pm=readJSON(path.join(prior,'manifest.json'));
  const parentRows={R15:readRows(path.join(portable,'R41-portable-full/matches.ndjson.gz')),R29:readRows(path.join(portable,'R42-portable-full/matches.ndjson.gz'))};
  const parentIndex=Object.fromEntries(Object.entries(parentRows).map(([k,v])=>[k,new Map(v.map(r=>[key(r),r]))]));
  const scenarios = JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base, 'scenarios.json.gz'))));
  const baselineRows = readRows(path.join(base, 'matches.ndjson.gz')), baselineIndex = new Map(baselineRows.map(r => [key(r), r]));
  const fingerprints = new Map(scenarios.map(s => [s.matchUrlId, s.fingerprint]));
  const tree = productionTreeSha256(root), adapter = (await loadBombPhaseAdapter(root)).identity;
  const hostHash = hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena')));
  assert.equal(tree, bm.tree); assert.deepEqual(adapter, bm.adapter); assert.equal(resolveFrozenV1(root).sha256, bm.v1);
  assert.equal(process.version, bm.node); assert.equal(PROTOCOL, bm.clock); assert.equal(hostHash, bm.hostSha256);
  const evidenceParents=em.cells.map(c=>c.parent),priorParents=pm.cells.map(c=>c.parentId);
  const {development,validation}=chooseCohorts(scenarios,evidenceParents,priorParents);
  const previousFile=path.join(root,'artifacts/native-causal-audit/bp396-conditional-path-ten-rounds/manifest.json'),previous=readJSON(previousFile);
  assert.deepEqual(development,previous.development);assert.deepEqual(validation,previous.validation);
  const sources=['tools/agentank/diagnostics/owner-ranking-campaign.js','tools/agentank/diagnostics/owner-ranking-variants.js',
    'tools/agentank/diagnostics/owner-ranking-report.js','tools/agentank/diagnostics/path-component-variants.js',
    'tools/agentank/diagnostics/efficient-tuning-campaign.js','tools/agentank/diagnostics/deterministic-v1-clock.js',
    'docs/implementation/owner-ranking-protocol-bp397.md','test/minimax-core/owner-ranking-variants.test.js'];
  const sourceHashes=Object.fromEntries(sources.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
  const indexHash=hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json')));assert.equal(indexHash,pm.indexHash);
  const referenceHashes={previousManifest:hash(fs.readFileSync(previousFile)),baseline:hash(fs.readFileSync(path.join(base,'matches.ndjson.gz'))),
    R15:hash(fs.readFileSync(path.join(portable,'R41-portable-full/matches.ndjson.gz'))),
    R29:hash(fs.readFileSync(path.join(portable,'R42-portable-full/matches.ndjson.gz'))),
    evidence:hash(fs.readFileSync(path.join(evidence,'rounds.json'))),evidenceManifest:hash(fs.readFileSync(path.join(evidence,'manifest.json'))),
    priorManifest:hash(fs.readFileSync(path.join(prior,'manifest.json')))};
  fs.mkdirSync(out,{recursive:true});
  saveJSON(path.join(out,'manifest.json'),{protocol:'BP397_OWNER_RANKING_V1',tree,adapter,hostHash,v1:bm.v1,node:process.version,clock:PROTOCOL,
    development,validation,evidenceParents:[...new Set(evidenceParents)].sort(),priorParents:[...new Set(priorParents)].sort(),sourceHashes,referenceHashes,indexHash,specs:SPECS,workers:4,nodeBudget:128});
  for(const f of sources){const dest=path.join(out,'sources',f);fs.mkdirSync(path.dirname(dest),{recursive:true});saveBytes(dest,fs.readFileSync(path.join(root,f)));}
  const scenarioFile=path.join(out,'scenarios.json.gz');saveBytes(scenarioFile,fs.readFileSync(path.join(base,'scenarios.json.gz')));
  const started = fs.statSync(path.join(out, 'manifest.json')).mtimeMs;
  const log = obj => console.log(JSON.stringify({ ...obj, seconds: Math.round((Date.now() - started) / 1000) }));
  if (fs.existsSync(path.join(out, 'rounds.json'))) { log({ status: 'ALREADY_COMPLETE' }); return; }
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
        const worker = new Worker(__filename, { workerData: { root, scenarioFile, jobFile: path.join(dir, 'jobs.json'), pending, workerIndex, workers } });
        threads.push(worker); worker.on('message', ({ index, row }) => { try { append(index, row);
          if (records.size % 32 === 0 || records.size === jobs.length) log({ stage: name, done: records.size, total: jobs.length });
        } catch (e) { reject(e); } }); worker.on('error', reject); worker.on('exit', code => code ? reject(Error('WORKER_EXIT_' + code)) : resolve());
      })));
      assert.equal(records.size, jobs.length); assert.equal(productionTreeSha256(root), tree);
      const rows = jobs.map((_, i) => records.get(i));
      saveBytes(saved, z.gzipSync(rows.map(JSON.stringify).join('\n') + '\n'));
      const execution = { games: rows.length, executedGames: rows.length - reusedIndices.length, reusedGames: reusedIndices.length,
        lastInvocationNewGames: pending.length, lastInvocationSeconds: (Date.now() - stageStart) / 1000, errors: 0, timeouts: 0, restore: 0,
        matchesSha256: hash(fs.readFileSync(saved)) };
      saveJSON(executionFile, execution); stageTotals.push({ name, ...execution }); return rows;
    } catch (e) { await Promise.allSettled(threads.map(t => t.terminate())); throw e; }
  }
  const jobs = (ids, mode) => ids.flatMap(id => [0, 1].map(seat => ({ id, seat, mode })));
  const baseFor = ids => ids.flatMap(id => [0, 1].map(seat => baselineIndex.get(id + ':' + seat)));
  const parentFor=(ids,mode)=>ids.flatMap(id=>[0,1].map(seat=>parentIndex[mode].get(id+':'+seat)));
  for(const mode of ['noop','R15','R29']){
    const rows=await stage('preflight-'+mode,jobs(development,mode));
    if(!rows)return log({status:'CONTINUE',nextStage});
    const index=mode==='noop'?baselineIndex:parentIndex[mode];
    for(const r of rows){const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b),'PREFLIGHT_DRIFT');assert.deepEqual(r.audit,b.audit,'WORK_DRIFT');assert.equal(r.result.reason,b.result.reason);}
  }
  saveJSON(path.join(out,'preflight.json'),{baseline:128,R15:128,R29:128,semanticEquivalent:true,workEquivalent:true});
  const activity=rows=>Object.fromEntries(['ownerCalls','comparisons','changedPreferences','bonusCalls','changedBonuses','mechanismChanges'].map(k=>[k,rows.reduce((n,r)=>n+r.variant[k],0)]));
  const rounds=[];
  for(const spec of SPECS){
    const dev=await stage(spec.id+'-development',jobs(development,spec.mode));
    if(!dev)return log({status:'CONTINUE',nextStage});
    const round={...spec,development:compare(baseFor(development),dev),developmentParent:compare(parentFor(development,spec.parent),dev),developmentActivity:activity(dev),status:'REJECTED_DEVELOPMENT'};
    if(passes(round.development,'development')&&passes(round.developmentParent,'development')&&round.developmentActivity.mechanismChanges>0){
      const val=await stage(spec.id+'-validation',jobs(validation,spec.mode));if(!val)return log({status:'CONTINUE',nextStage});
      round.validation=compare(baseFor(validation),val);round.validationParent=compare(parentFor(validation,spec.parent),val);round.validationActivity=activity(val);round.status='REJECTED_VALIDATION';
      if(passes(round.validation,'validation')&&passes(round.validationParent,'validation')){
        const full=await stage(spec.id+'-full',jobs(scenarios.map(s=>s.matchUrlId),spec.mode),[...dev,...val]);if(!full)return log({status:'CONTINUE',nextStage});
        round.full=compare(baselineRows,full);round.fullParent=compare(parentRows[spec.parent],full);round.fullActivity=activity(full);
        round.status=passes(round.full,'full')&&passes(round.fullParent,'full')?'QUALIFIED_DIAGNOSTIC_PENDING_PORTABILITY_AND_MULTISEED':'REJECTED_FULL';
      }
    }
    const existed=fs.existsSync(path.join(out,spec.id+'.json'));saveJSON(path.join(out,spec.id+'.json'),round);rounds.push(round);
    if(!existed)log({round:spec.id,status:round.status,developmentPoints:round.development.deltaPoints,parentPoints:round.developmentParent.deltaPoints,validationPoints:round.validation?.deltaPoints,fullPoints:round.full?.deltaPoints});
  }
  assert.equal(rounds.length, 10); assert.equal(productionTreeSha256(root), tree);
  for (const [file, sha] of Object.entries(sourceHashes)) assert.equal(hash(fs.readFileSync(path.join(root, file))), sha);
  const result = { status: 'TEN_ROUNDS_COMPLETE', rounds, stages: stageTotals, productionUnchanged: true,
    executedGames: stageTotals.reduce((n, s) => n + s.executedGames, 0), materializedRows: stageTotals.reduce((n, s) => n + s.games, 0),
    reusedGames: stageTotals.reduce((n, s) => n + s.reusedGames, 0), seconds: Math.round((Date.now() - started) / 1000),
    qualified: rounds.filter(r => r.status === 'QUALIFIED_DIAGNOSTIC_PENDING_PORTABILITY_AND_MULTISEED').map(r => r.id) };
  saveJSON(path.join(out, 'rounds.json'), result); log({ status: result.status, executedGames: result.executedGames, qualified: result.qualified });
}
if (!isMainThread) workerRun().catch(e => { throw e; });
else if (require.main === module) runStep(process.cwd(), path.resolve(process.argv[2])).catch(e => {
  console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '[adapter data URL]')); process.exitCode = 1;
});
module.exports = { chooseCohorts, loadCheckpoint, validateRow, jsonHash, runStep };
