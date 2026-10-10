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
const { fingerprintObject } = require('../core/hash');
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

function select(scenes, tag, count, excluded = new Set()) {
  const result = [], seen = new Set(excluded);
  for (const s of scenes.slice().sort((a,b) => hash(tag+':'+a.matchUrlId).localeCompare(hash(tag+':'+b.matchUrlId)))) {
    const h = jsonHash(s.map); if (seen.has(h)) continue;
    seen.add(h); result.push(s); if (result.length === count) break;
  }
  assert.equal(result.length, count, 'COHORT_UNDERFLOW'); return result;
}
function transformScenario(original, kind) {
  assert.ok(['rotate90','mirror-x','star-early'].includes(kind));
  const s = structuredClone(original), w = s.map.length, h = s.map[0].length;
  const point = ([x,y]) => kind === 'rotate90' ? [h-1-y,x] : [w-1-x,y];
  if (kind !== 'star-early') {
    const map = Array.from({length: kind === 'rotate90' ? h : w}, () => Array(kind === 'rotate90' ? w : h));
    for (let x=0;x<w;x++) for(let y=0;y<h;y++) { const [nx,ny]=point([x,y]);map[nx][ny]=s.map[x][y]; }
    s.map=map; const directions = kind === 'rotate90' ? {up:'right',right:'down',down:'left',left:'up'} : {up:'up',right:'left',down:'down',left:'right'};
    s.starts=s.starts.map(t=>({...t, position:point(t.position), direction:directions[t.direction]}));
    assert.ok(s.starts.every(t=>t.direction)); s.stars=s.stars.map(t=>({...t,position:point(t.position)}));
  } else s.stars=s.stars.map(t=>({...t,frame:t.frame===0?0:Math.max(1,Math.floor(t.frame/2))}));
  s.parentMatchUrlId=original.matchUrlId; s.parentFingerprint=original.fingerprint;
  s.matchUrlId='bp392-'+kind+'-'+original.matchUrlId; s.scenarioKind='SYNTHETIC_PRESSURE_'+kind;
  s.mapHash=jsonHash(s.map); delete s.originalResult; delete s.originalFrames;
  s.fingerprint='';s.fingerprint=fingerprintObject(s); return s;
}
function validateRow(row, job, fingerprint) {
  assert.equal(row.matchUrlId, job.id); assert.equal(row.candidateSeat, job.seat);
  assert.equal(row.scenarioFingerprint, fingerprint); assert.equal(row.variant.mode, job.mode); assert.equal(row.variant.lane, job.lane);
  for (const side of [row.candidate, row.control]) { assert.equal(side.errorCount, 0); assert.equal(side.timeoutCount, 0); }
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
  const { root, scenarioFile, jobFile, pending, workerIndex, workers, mode, vmCode } = workerData;
  const scenes = new Map(JSON.parse(z.gunzipSync(fs.readFileSync(scenarioFile))).map(s => [s.matchUrlId,s]));
  const jobs=readJSON(jobFile), {module:sim}=await loadBombPhaseAdapter(root);
  const v1=V3DiagnosticBot.prototype.decide, capture=Bot.prototype.captureRoot;
  let audit;
  V3DiagnosticBot.prototype.decide=function(c){ return withClock(this.controller.runtime.sandbox,()=>v1.call(this,c)); };
  Bot.prototype.captureRoot=function(){ const s=this.engine.basePolicy.policySearch,reason=this.searchEntry;
    audit.reasons[reason]=(audit.reasons[reason]||0)+1;audit.lastReason=reason;
    if(this.searchEvidenceCurrent){audit.searchRoots++;audit.nodes+=s.nodes;audit.budgetLeaves+=s.lastBudgetLeafCount;}
  };
  const code=vmCode?fs.readFileSync(vmCode,'utf8'):null;
  try { for(let n=workerIndex;n<pending.length;n+=workers){
    const i=pending[n],job=jobs[i];audit={reasons:{},searchRoots:0,nodes:0,budgetLeaves:0,lastReason:null};
    const row=await play(sim,scenes.get(job.id),job.seat,!code,code);
    delete row.candidateEngine.rootFrames;delete row.control.actionFrames;
    row.audit=code?null:audit;row.variant={mode,lane:job.lane};
    if(code){ row.candidateEngine.rootRestoreFailures=null;row.candidateEngine.hotAllocations=null; }
    validateRow(row,job,scenes.get(job.id).fingerprint);parentPort.postMessage({index:i,row});
  }} finally {V3DiagnosticBot.prototype.decide=v1;Bot.prototype.captureRoot=capture;}
}
async function prepare(root,out) {
  fs.mkdirSync(out,{recursive:true});
  const {build}=require('../build/portable-path-candidates');
  const manifests={};
  for(const mode of ['baseline','R15','R29']){
    const dir=path.join(out,'build',mode),evidence=path.join(dir,'build.json');fs.mkdirSync(dir,{recursive:true});
    if(!fs.existsSync(evidence)){
      const result=await build(root,mode), hashes={};
      for(const [name,value] of [['path-utility.js',result.moduleSource],['source.js',result.source],['minified.js',result.minified]]){
        saveBytes(path.join(dir,name),value);hashes[name]=hash(value);
      }
      saveJSON(evidence,{...result.evidence,hashes});
    }
    manifests[mode]=readJSON(evidence);
    for(const [file,sha] of Object.entries(manifests[mode].hashes))assert.equal(hash(fs.readFileSync(path.join(dir,file))),sha);
  }
  return manifests;
}
async function runStep(root,out) {
  const started=Date.now(), log=x=>console.log(JSON.stringify(x));
  const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
  const bm=readJSON(path.join(base,'manifest.json'));
  const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz'))));
  const baselineRows=readRows(path.join(base,'matches.ndjson.gz'));
  const refs={baseline:baselineRows,R15:readRows(path.join(root,'artifacts/native-causal-audit/bp389-ranking-ten-rounds-v2/R15-full/matches.ndjson.gz')),
    R29:readRows(path.join(root,'artifacts/native-causal-audit/bp390-path-component-ten-rounds/R29-full/matches.ndjson.gz'))};
  const tree=productionTreeSha256(root),adapter=(await loadBombPhaseAdapter(root)).identity;
  assert.equal(tree,bm.tree);assert.deepEqual(adapter,bm.adapter);assert.equal(process.version,bm.node);
  assert.equal(resolveFrozenV1(root).sha256,bm.v1);assert.equal(PROTOCOL,bm.clock);
  const hostHash=hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena')));assert.equal(hostHash,bm.hostSha256);
  const builds=await prepare(root,out);
  const equivalence=select(historical,'bp392-equivalence-v1',192).map(s=>s.matchUrlId);
  const pressure={},excluded=new Set();
  for(const kind of ['rotate90','mirror-x','star-early']){
    const selected=select(kind==='star-early'?historical.filter(s=>s.stars.some(t=>t.frame>1)):historical,'bp392-'+kind+'-v1',64,excluded);
    selected.forEach(s=>excluded.add(jsonHash(s.map)));pressure[kind]=selected.map(s=>transformScenario(s,kind));
  }
  const scenarios=[...historical,...Object.values(pressure).flat()];
  const fingerprints=new Map(scenarios.map(s=>[s.matchUrlId,s.fingerprint]));
  const sourceFiles=['tools/agentank/diagnostics/portable-path-campaign.js','tools/agentank/build/portable-path-candidates.js',
    'docs/implementation/portable-path-protocol-bp392.md','test/minimax-core/portable-path-campaign.test.js',
    'tools/agentank/diagnostics/efficient-tuning-campaign.js','tools/agentank/diagnostics/deterministic-v1-clock.js',
    'tools/agentank/build/imp6-builder.js','tools/agentank/build/native-base-policy-upload-builder.js'];
  const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
  saveJSON(path.join(out,'manifest.json'),{schema:1,tree,adapter,node:process.version,v1:bm.v1,clock:PROTOCOL,hostHash,sourceHashes,
    buildHashes:Object.fromEntries(Object.entries(builds).map(([k,v])=>[k,v.hashes])),equivalence,
    pressure:Object.fromEntries(Object.entries(pressure).map(([k,v])=>[k,v.map(s=>({id:s.matchUrlId,parent:s.parentMatchUrlId,fingerprint:s.fingerprint}))])),
    historicalCount:historical.length,newHistoricalMaps:0,referenceHashes:Object.fromEntries(Object.entries(refs).map(([k,v])=>[k,jsonHash(v)]))});
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

  const jobs=(ids,mode,lane='native')=>ids.flatMap(id=>[0,1].map(seat=>({id,seat,mode,lane})));
  const subset=(rows,ids)=>{const index=new Map(rows.map(r=>[key(r),r]));return ids.flatMap(id=>[0,1].map(seat=>index.get(id+':'+seat)));};
  const equal=(rows,reference,work)=>{const index=new Map(reference.map(r=>[key(r),r]));for(const r of rows){
    const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b),'ACTION_OUTCOME_DRIFT:'+key(r));
    assert.equal(r.result.reason,b.result.reason,'TERMINAL_REASON_DRIFT');if(work)assert.deepEqual(r.audit,b.audit,'WORK_DRIFT:'+key(r));
  }return {games:rows.length,semanticEquivalent:true,workEquivalent:work?true:null};};
  const pre=await stage('baseline-vm-preflight',jobs(equivalence.slice(0,64),'baseline','vm'));
  if(!pre)return log({status:'CONTINUE',nextStage});
  saveJSON(path.join(out,'preflight.json'),equal(pre,refs.baseline,false));
  const rounds=[],ports={};
  for(const [id,mode] of [['R41','R15'],['R42','R29']]){
    const rows=await stage(id+'-portable-full',jobs(historical.map(s=>s.matchUrlId),mode));
    if(!rows)return log({status:'CONTINUE',nextStage});
    const round={id,candidate:mode,type:'NATIVE_PORT_EQUIVALENCE',...equal(rows,refs[mode],true),status:'EQUIVALENT',performance:compare(baselineRows,rows)};
    ports[mode]=rows;saveJSON(path.join(out,id+'.json'),round);rounds.push(round);
  }
  for(const [id,mode] of [['R43','R15'],['R44','R29']]){
    const rows=await stage(id+'-minified',jobs(equivalence,mode,'vm'));
    if(!rows)return log({status:'CONTINUE',nextStage});
    const round={id,candidate:mode,type:'MINIFIED_EQUIVALENCE',...equal(rows,subset(ports[mode],equivalence),false),status:'EQUIVALENT'};
    saveJSON(path.join(out,id+'.json'),round);rounds.push(round);
  }
  let roundNo=45;
  for(const [kind,scenes] of Object.entries(pressure)){
    const ids=scenes.map(s=>s.matchUrlId),baseRows=await stage(kind+'-baseline',jobs(ids,'baseline'));
    if(!baseRows)return log({status:'CONTINUE',nextStage});
    for(const mode of ['R15','R29']){
      const id='R'+roundNo++,rows=await stage(id+'-'+kind,jobs(ids,mode));
      if(!rows)return log({status:'CONTINUE',nextStage});
      const performance=compare(baseRows,rows),round={id,candidate:mode,type:'SYNTHETIC_PRESSURE',kind,performance,
        status:passes(performance,'development')?'PRESSURE_PASS':'PRESSURE_REJECTED'};
      const existed=fs.existsSync(path.join(out,id+'.json'));saveJSON(path.join(out,id+'.json'),round);rounds.push(round);
      if(!existed)log({round:id,status:round.status,deltaPoints:performance.deltaPoints});
    }
  }
  assert.equal(rounds.length,10);assert.equal(productionTreeSha256(root),tree);
  for(const [file,sha] of Object.entries(sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,file))),sha);
  const result={status:'TEN_ROUNDS_COMPLETE',rounds,stages:stageTotals,productionUnchanged:true,
    executedGames:stageTotals.reduce((n,s)=>n+s.executedGames,0),reusedGames:0,
    stageSeconds:stageTotals.reduce((n,s)=>n+s.lastInvocationSeconds,0)};
  saveJSON(path.join(out,'rounds.json'),result);log({status:result.status,executedGames:result.executedGames});
}
if(!isMainThread)workerRun().catch(e=>{throw e;});
else if(require.main===module)runStep(process.cwd(),path.resolve(process.argv[2])).catch(e=>{
  console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter data URL]'));process.exitCode=1;
});
module.exports={select,transformScenario,loadCheckpoint,jsonHash,runStep};
