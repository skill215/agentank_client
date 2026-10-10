'use strict';
// Environment-only comparison against BP383's immutable scenario list.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {Worker, isMainThread, parentPort, workerData} = require('node:worker_threads');
const {play, productionTreeSha256, NativeBasePolicyDiagnosticBot: Bot} = require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds} = require('../simulation/historical-scenarios');
const {loadSimulator} = require('../simulation/paired-arena');
const {loadBombPhaseAdapter} = require('../simulation/bomb-phase-adapter');
const {V3DiagnosticBot} = require('../../../engine-v3/src');
const {resolveFrozenV1} = require('../../../engine-v3/src/legacy/default-source');
const {withClock, PROTOCOL} = require('./deterministic-v1-clock');
const {summarize} = require('./global-current-baseline');
const {analyze} = require('./global-baseline-report');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const key = r => `${r.matchUrlId}:${r.candidateSeat}`;
const readRows = file => zlib.gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map(JSON.parse);
const noBomb = r => r.counts.bombs.every(n => n === 0);
function semanticProjection(row) {
  // Wall-clock runtime and runtime-only raw winners are not analytical outcomes.
  // Match the persisted NDJSON representation (undefined fields are omitted).
  const copy = JSON.parse(JSON.stringify(row));
  delete copy.result;
  for (const obj of [copy.candidate, copy.control, copy.candidateEngine])
    for (const k of Object.keys(obj || {})) if (/runtime/i.test(k)) delete obj[k];
  return copy;
}
function transitions(before, after) {
  const old = new Map(before.map(r => [key(r),r])), result = {};
  for (const r of after) {
    const b = old.get(key(r)); assert.ok(b, 'MISSING_BASELINE_ROW');
    assert.equal(r.scenarioFingerprint,b.scenarioFingerprint);
    const name = `${b.analysisOutcome}->${r.analysisOutcome}`;
    result[name] = (result[name] || 0) + 1;
  }
  return result;
}
function comparison(before, after) {
  const old = new Map(before.map(r => [key(r),r]));
  assert.equal(old.size,before.length); assert.equal(new Set(after.map(key)).size,after.length);
  assert.equal(before.length,after.length);
  const controls = after.filter(r => noBomb(old.get(key(r))) && noBomb(r));
  const controlDifferences = controls.filter(r => JSON.stringify(semanticProjection(r)) !== JSON.stringify(semanticProjection(old.get(key(r))))).map(key);
  const bombRelated = after.filter(r => !noBomb(r) || !noBomb(old.get(key(r))));
  const changed = after.filter(r => r.analysisOutcome !== old.get(key(r)).analysisOutcome).map(r => ({
    id:r.matchUrlId,seat:r.candidateSeat,before:old.get(key(r)).analysisOutcome,after:r.analysisOutcome,
    oldTerminal:old.get(key(r)).terminalCategory,newTerminal:r.terminalCategory,
    oldBombs:old.get(key(r)).counts.bombs,newBombs:r.counts.bombs,
    oldCrashFrameBombLabel:old.get(key(r)).counts.v2CrashCause === 'BOMB'
  }));
  return {baseline:summarize(before),adapted:summarize(after),transitions:transitions(before,after),
    baselineAnalysis:analyze(before),adaptedAnalysis:analyze(after),
    noBombControl:{games:controls.length,semanticDifferenceCount:controlDifferences.length,differences:controlDifferences},
    bombRelated:{games:bombRelated.length,transitions:transitions(before,bombRelated)},changed,
    bombLabelCaveat:'BOMB means an explosion occurred on the candidate crash frame; it is not a verified cause of death.'};
}
function auditedPlay() {
  const originalDecide = V3DiagnosticBot.prototype.decide;
  const originalCapture = Bot.prototype.captureRoot;
  let audit;
  V3DiagnosticBot.prototype.decide = function(context) {
    return withClock(this.controller.runtime.sandbox,()=>originalDecide.call(this,context));
  };
  Bot.prototype.captureRoot = function() {
    const search=this.engine.basePolicy.policySearch,reason=this.searchEntry;
    audit.reasons[reason]=(audit.reasons[reason]||0)+1; audit.lastReason=reason;
    if(this.searchEvidenceCurrent){audit.searchRoots++;audit.nodes+=search.nodes;audit.budgetLeaves+=search.lastBudgetLeafCount;}
  };
  return {async play(module,scenario,seat) {
    audit={reasons:{},searchRoots:0,nodes:0,budgetLeaves:0,lastReason:null};
    const match=await play(module,scenario,seat,true);
    delete match.candidateEngine.rootFrames;delete match.control.actionFrames;
    for(const side of [match.candidate,match.control]){
      assert.equal(side.errorCount,0,'BOT_ERROR');assert.equal(side.timeoutCount,0,'BOT_TIMEOUT');
    }
    assert.equal(match.candidateEngine.rootRestoreFailures,0,'ROOT_RESTORE_FAILURE');
    return {...match,audit};
  },restore(){V3DiagnosticBot.prototype.decide=originalDecide;Bot.prototype.captureRoot=originalCapture;}};
}
async function workerRun() {
  const {root,scenarioFile,workerIndex,workers}=workerData;
  const scenarios=JSON.parse(zlib.gunzipSync(fs.readFileSync(scenarioFile)));
  const {module}=await loadBombPhaseAdapter(root),audit=auditedPlay();
  try {
    for(let i=workerIndex;i<scenarios.length;i+=workers)
      for(const seat of [0,1])parentPort.postMessage({index:i*2+seat,row:await audit.play(module,scenarios[i],seat)});
  } finally {audit.restore();}
}
async function run(root,out,workers=4) {
  assert.ok(Number.isInteger(workers)&&workers>=1&&workers<=8);
  assert.ok(!fs.existsSync(out),'OUTPUT_ALREADY_EXISTS');
  const baselineDir=path.join(root,'artifacts/native-causal-audit/bp383-global-current-baseline');
  const manifestBytes=fs.readFileSync(path.join(baselineDir,'manifest.json'));
  const base=JSON.parse(manifestBytes),baseline=readRows(path.join(baselineDir,'matches.ndjson.gz'));
  assert.equal(base.scenes.length,1243);assert.equal(base.games,2486);assert.equal(baseline.length,base.games);
  const tree=productionTreeSha256(root);assert.equal(tree,base.tree,'PRODUCTION_DRIFT');
  assert.equal(resolveFrozenV1(root).sha256,base.v1,'V1_DRIFT');assert.equal(PROTOCOL,base.clock);
  assert.equal(process.version,base.node,'NODE_VERSION_DRIFT');
  const hostFile=require.resolve('./native-base-policy-standalone-arena');
  assert.equal(hash(fs.readFileSync(hostFile)),base.hostSha256,'HOST_DRIFT');
  const {scenarios}=loadRollingV1ScenariosForIds(base.scenes.map(s=>s.id),root);
  for(let i=0;i<scenarios.length;i++)assert.equal(scenarios[i].fingerprint,base.scenes[i].fingerprint,'SCENARIO_DRIFT');
  const baselineMap=new Map(baseline.map(r=>[key(r),r]));assert.equal(baselineMap.size,base.games);
  for(const scenario of scenarios)for(const seat of [0,1])assert.equal(baselineMap.get(`${scenario.matchUrlId}:${seat}`)?.scenarioFingerprint,scenario.fingerprint);
  const {identity}=await loadBombPhaseAdapter(root);
  // Check that this host reproduces both seats before changing the environment.
  const {module:original}=await loadSimulator(root),auditor=auditedPlay(),preflight=[];
  const chosen=[scenarios[0],scenarios.find(s=>[0,1].every(seat=>noBomb(baselineMap.get(`${s.matchUrlId}:${seat}`))))];
  try {for(const scenario of chosen)for(const seat of [0,1]){
    const row=await auditor.play(original,scenario,seat);
    assert.deepEqual(semanticProjection(row),semanticProjection(baselineMap.get(key(row))),'BASELINE_REPRODUCTION_DRIFT');
    preflight.push({id:scenario.matchUrlId,seat,matched:true});
  }}finally{auditor.restore();}
  fs.mkdirSync(out,{recursive:true});
  const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2),{flag:'wx'});
  const scenarioFile=path.join(out,'scenarios.json.gz');
  const scenarioBytes=zlib.gzipSync(JSON.stringify(scenarios));fs.writeFileSync(scenarioFile,scenarioBytes,{flag:'wx'});
  write('manifest.json',{protocol:'BP386_ENVIRONMENT_ONLY_FROZEN_BP383',tree,v1:base.v1,clock:PROTOCOL,node:process.version,
    hostSha256:base.hostSha256,scriptSha256:hash(fs.readFileSync(__filename)),adapter:identity,workers,
    baselineManifestSha256:hash(manifestBytes),baselineMatchesSha256:hash(fs.readFileSync(path.join(baselineDir,'matches.ndjson.gz'))),
    scenariosSha256:hash(scenarioBytes),scenes:base.scenes,games:base.games,skills:base.skills,
    diagnosticCertificate:false,navigationFamilyOverride:false,productionChanges:false,preflight,
    rawEvidenceSha256:hash(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp385-platform-terminal-slices/slices.ndjson.gz')))});
  const records=new Array(base.games),threads=[],started=Date.now();let completed=0;
  function checkpoint(){
    const temp=path.join(out,'matches.ndjson.gz.tmp');
    fs.writeFileSync(temp,zlib.gzipSync(records.filter(Boolean).map(JSON.stringify).join('\n')+'\n'));
    fs.renameSync(temp,path.join(out,'matches.ndjson.gz'));
    const progress={done:completed,total:base.games,seconds:Math.round((Date.now()-started)/1000)};
    fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(progress));console.log(JSON.stringify(progress));
  }
  try {
    await Promise.all(Array.from({length:workers},(_,workerIndex)=>new Promise((resolve,reject)=>{
      const worker=new Worker(__filename,{workerData:{root,scenarioFile,workerIndex,workers}});threads.push(worker);
      worker.on('message',({index,row})=>{
        try{assert.ok(!records[index],'DUPLICATE_ROW');assert.equal(key(row),`${scenarios[Math.floor(index/2)].matchUrlId}:${index%2}`);
          records[index]=row;completed++;if(completed%32===0||completed===base.games)checkpoint();
        }catch(e){reject(e);}
      });
      worker.on('error',reject);worker.on('exit',code=>code===0?resolve():reject(Error(`WORKER_EXIT_${code}`)));
    })));
    assert.equal(completed,base.games);assert.equal(productionTreeSha256(root),tree);
    assert.equal(resolveFrozenV1(root).sha256,base.v1);
    assert.equal(hash(fs.readFileSync(hostFile)),base.hostSha256);
    assert.deepEqual((await loadBombPhaseAdapter(root)).identity,identity);
    const report=comparison(baseline,records);
    assert.equal(report.noBombControl.semanticDifferenceCount,0,'NO_BOMB_CONTROL_DRIFT');
    write('overview.json',{status:'COMPLETE_BOMB_PHASE_ONLY_NOT_FULL_PLATFORM_QUALIFICATION',productionUnchanged:true,
      error:0,timeout:0,restore:0,...report});
    console.log(JSON.stringify({status:'COMPLETE',baseline:report.baseline,adapted:report.adapted,transitions:report.transitions,noBombControl:report.noBombControl}));
  }catch(e){
    await Promise.allSettled(threads.map(t=>t.terminate()));checkpoint();
    write('failure.json',{error:e.stack,completed});throw e;
  }
}
if(!isMainThread)workerRun().catch(e=>{throw e;});
else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2]),Number(process.argv[3]||4)).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={comparison,semanticProjection,transitions};
