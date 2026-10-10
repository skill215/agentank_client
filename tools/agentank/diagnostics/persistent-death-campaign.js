'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
if(!isMainThread){
  const Module=require('node:module'),file=path.join(workerData.root,'engine-v2/src/base-policy-specialized/path-utility.js');
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(workerData.moduleFile,'utf8'),file);m.loaded=true;require.cache[file]=m;
}
const {play,NativeBasePolicyDiagnosticBot:Bot,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {V3DiagnosticBot}=require('../../../engine-v3/src');
const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
const {withClock,PROTOCOL}=require('./deterministic-v1-clock');
const {loadBombPhaseAdapter}=require('../simulation/bomb-phase-adapter');
const {withExplicitSeed}=require('./explicit-simulation-seed');
const {seedFor}=require('./v1-v3-arena');
const {key,jobKey,semantic,createPlan,prefixMatches,stream}=require('./persistent-death-design');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),jh=v=>hash(JSON.stringify(v));
const read=f=>JSON.parse(fs.readFileSync(f));
const readRows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
function save(f,b){fs.mkdirSync(path.dirname(f),{recursive:true});if(fs.existsSync(f))return assert.deepEqual(fs.readFileSync(f),Buffer.from(b),'IMMUTABLE_DRIFT:'+f);const t=f+'.tmp-'+process.pid;fs.writeFileSync(t,b,{flag:'wx'});fs.renameSync(t,f);}
const saveJSON=(f,v)=>save(f,JSON.stringify(v,null,2));
function validateRow(r,j,s){
 assert.equal(r.matchUrlId,j.id);assert.equal(r.candidateSeat,j.seat);assert.equal(r.scenarioFingerprint,s.fingerprint);
 assert.deepEqual(r.job,j);assert.equal(r.variant.mode,j.mode);assert.equal(r.seedControl.requestedSeed,j.seed);assert.equal(r.seedControl.effectiveSeed,j.seed);assert.equal(r.seedControl.hostDerivedSeed,seedFor(s));
 for(const side of [r.candidate,r.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}
 assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);
 assert.equal(r.roots.length,r.candidate.decisionCount);assert.equal(r.roots.length,stream(r).length);
 r.roots.forEach((x,i)=>assert.equal(x.frame,i));
}
function loadCheckpoint(file,jobs,scenes){
 const records=new Map();if(!fs.existsSync(file))return {records,truncatedBytes:0};
 const bytes=fs.readFileSync(file),end=bytes.lastIndexOf(10)+1;
 for(const line of bytes.subarray(0,end).toString().split('\n').filter(Boolean)){
  const e=JSON.parse(line);assert.ok(Number.isInteger(e.index)&&e.index>=0&&e.index<jobs.length);assert.ok(!records.has(e.index));assert.equal(jh(e.row),e.sha256);
  validateRow(e.row,jobs[e.index],scenes.get(jobs[e.index].id));records.set(e.index,e.row);
 }
 return {records,truncatedBytes:bytes.length-end,validBytes:end};
}
function input(root){
 const dir=path.join(root,'artifacts/native-causal-audit/bp394-multiseed-ten-rounds');
 const analysis=read(path.join(dir,'multiseed-analysis.json')),scenarios=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(dir,'scenarios.json.gz'))));
 const sceneIndex=new Map(scenarios.map(s=>[s.matchUrlId,s])),cells=[],original=[],baselines=[],referenceFiles=['manifest.json','scenarios.json.gz','multiseed-analysis.json'];
 for(let n=1;n<=5;n++){
  const condition='seed-'+String(n).padStart(2,'0'),bfile=condition+'-baseline/matches.ndjson.gz';referenceFiles.push(bfile);
  const b=new Map(readRows(path.join(dir,bfile)).map(r=>[`${r.matchUrlId}:${r.candidateSeat}`,r]));
  for(const [i,mode]of ['R15','R29'].entries()){
   const f=`R${59+2*n+i}-${condition}/matches.ndjson.gz`;referenceFiles.push(f);
   const rs=new Map(readRows(path.join(dir,f)).map(r=>[`${r.matchUrlId}:${r.candidateSeat}`,r]));
   for(const c of analysis.candidates.find(c=>c.candidate===mode).persistentDeathRegressions){
    const id=`bp394-${condition}-${c.parent}`,s=sceneIndex.get(id),k=`${id}:${c.seat}`;assert.ok(s);
    cells.push({id,seat:c.seat,mode,parent:c.parent,condition,seed:s.simulationSeed});original.push(rs.get(k));baselines.push(b.get(k));
   }
  }
 }
 assert.equal(cells.length,75);assert.equal(new Set(cells.map(c=>c.parent+':'+c.seat)).size,14);
 const ids=new Set(cells.map(c=>c.id));return {cells,original,baselines,scenarios:scenarios.filter(s=>ids.has(s.matchUrlId)),referenceHashes:Object.fromEntries(referenceFiles.map(f=>[f,hash(fs.readFileSync(path.join(dir,f)))]))};
}
async function workerRun(){
 const {root,out,jobs,pending,index,workers}=workerData;
 const scenes=new Map(JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz')))).map(s=>[s.matchUrlId,s]));
 const {module:sim}=await loadBombPhaseAdapter(root);const v1=V3DiagnosticBot.prototype.decide,capture=Bot.prototype.captureRoot;let audit,roots;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>v1.call(this,c));};
 Bot.prototype.captureRoot=function(context,action){
  const e=this.engine,s=e.basePolicy.policySearch,reason=this.searchEntry;
  audit.reasons[reason]=(audit.reasons[reason]||0)+1;audit.lastReason=reason;
  if(this.searchEvidenceCurrent){audit.searchRoots++;audit.nodes+=s.nodes;audit.budgetLeaves+=s.lastBudgetLeafCount;}
  capture.call(this,context,action);const r=this.rootFrames.pop();
  roots.push({frame:r.frame,reason,selectedAction:e.lastAction,previousAction:this.previousAction,turnStreak:e.turnStreak,
    state:{ownCell:r.ownCell,ownDirection:r.ownDirection,enemyCell:r.enemyCell,enemyDirection:r.enemyDirection,ownStars:r.ownStars,enemyStars:r.enemyStars,starCell:r.starCell},
    nodes:this.searchEvidenceCurrent?s.nodes:0,
    candidates:Array.from({length:e.ourCount},(_,row)=>({row,action:e.ourActions[row],hard:e.hardStatus[row],
      finalAllowed:!!e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,row,e.ourCount),
      acceptable:r.candidates.find(c=>c.row===row)?.acceptable??null,dominated:r.candidates.find(c=>c.row===row)?.dominated??null}))});
 };
 try{for(let n=index;n<pending.length;n+=workers){
  const i=pending[n],j=jobs[i];audit={reasons:{},searchRoots:0,nodes:0,budgetLeaves:0,lastReason:null};roots=[];let observed,calls=0;
  const simSeed=withExplicitSeed(sim,j.seed,o=>{observed=o;calls++;});
  const r=await play(simSeed,scenes.get(j.id),j.seat,true,null,true,true,'current',false,false,1,'off',j.frame??-1,j.action??-1);
  assert.equal(calls,1);delete r.candidateEngine.rootFrames;delete r.control.actionFrames;
  r.audit=audit;r.roots=roots;r.variant={mode:j.mode,lane:'native'};r.job=j;r.seedControl={requestedSeed:j.seed,...observed};
  validateRow(r,j,scenes.get(j.id));parentPort.postMessage({index:i,row:r});
 }}finally{V3DiagnosticBot.prototype.decide=v1;Bot.prototype.captureRoot=capture;}
}
function validateBranch(source,row,j,noop=false){
 assert.equal(row.candidateEngine.forceFrameSeen,1);assert.equal(row.candidateEngine.forceApplied,1);
 assert.equal(row.candidateEngine.forceOriginalAction,source.roots[j.frame].selectedAction);
 assert.ok(prefixMatches(source,row,j.frame,j.action),'PREFIX_DRIFT');
 assert.equal(stream(source,'control')[j.frame],stream(row,'control')[j.frame],'SAME_FRAME_CONTROL_DRIFT');
 assert.deepEqual(source.control.compactArguments.filter(x=>x[0]<=j.frame),row.control.compactArguments.filter(x=>x[0]<=j.frame));
 assert.deepEqual(source.roots.slice(0,j.frame),row.roots.slice(0,j.frame));
 assert.deepEqual(source.roots[j.frame].state,row.roots[j.frame].state,'INTERVENTION_STATE_DRIFT');
 if(noop){assert.deepEqual(semantic(source),semantic(row),'NOOP_SEMANTIC_DRIFT');assert.deepEqual(source.audit,row.audit,'NOOP_WORK_DRIFT');}
}
async function run(root,out){
 const d=input(root),base=read(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/manifest.json'));
 const prior=read(path.join(root,'artifacts/native-causal-audit/bp394-multiseed-ten-rounds/manifest.json'));
 const tree=productionTreeSha256(root),adapter=(await loadBombPhaseAdapter(root)).identity;
 assert.equal(tree,base.tree);assert.deepEqual(adapter,base.adapter);assert.equal(process.version,base.node);assert.equal(resolveFrozenV1(root).sha256,base.v1);assert.equal(PROTOCOL,base.clock);
 assert.equal(hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena'))),base.hostSha256);
 const indexHash=hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json')));assert.equal(indexHash,prior.indexHash);
 const sourceFiles=['tools/agentank/diagnostics/persistent-death-campaign.js','tools/agentank/diagnostics/persistent-death-design.js','tools/agentank/diagnostics/persistent-death-report.js','docs/implementation/persistent-death-protocol-bp395.md','test/minimax-core/persistent-death-design.test.js','tools/agentank/diagnostics/explicit-simulation-seed.js','tools/agentank/diagnostics/deterministic-v1-clock.js'];
 const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))])),moduleHashes={};
 for(const mode of ['R15','R29']){const b=fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds/build',mode,'path-utility.js'));assert.equal(hash(b),prior.moduleHashes[mode]);moduleHashes[mode]=hash(b);save(path.join(out,'build',mode,'path-utility.js'),b);}
 saveJSON(path.join(out,'manifest.json'),{schema:1,tree,adapter,node:process.version,v1:base.v1,clock:PROTOCOL,hostHash:base.hostSha256,indexHash,sourceHashes,moduleHashes,referenceHashes:d.referenceHashes,cells:d.cells});
 for(const f of sourceFiles)save(path.join(out,'sources',f),fs.readFileSync(path.join(root,f)));
 save(path.join(out,'scenarios.json.gz'),z.gzipSync(JSON.stringify(d.scenarios)));
 const scenes=new Map(d.scenarios.map(s=>[s.matchUrlId,s])),stages=[],identity=jh(read(path.join(out,'manifest.json')));
 async function stage(name,jobs){
  const dir=path.join(out,name);saveJSON(path.join(dir,'jobs.json'),jobs);saveJSON(path.join(dir,'identity.json'),{manifest:identity,jobsHash:jh(jobs)});
  const cp=path.join(dir,'checkpoint.ndjson'),checkpoint=loadCheckpoint(cp,jobs,scenes),records=checkpoint.records;
  if(checkpoint.truncatedBytes){fs.appendFileSync(path.join(out,'recovery.ndjson'),JSON.stringify({name,bytes:checkpoint.truncatedBytes,rows:records.size})+'\n');fs.truncateSync(cp,checkpoint.validBytes);}
  const pending=jobs.map((_,i)=>i).filter(i=>!records.has(i));const started=Date.now();
  console.log(JSON.stringify({stage:name,games:jobs.length,pending:pending.length}));
  const threads=[],workers=Math.min(4,pending.length);
  try{await Promise.all(Array.from({length:workers},(_,index)=>new Promise((resolve,reject)=>{
   const w=new Worker(__filename,{workerData:{root,out,jobs,pending,index,workers,moduleFile:path.join(out,'build',jobs[0].mode,'path-utility.js')}});threads.push(w);
   w.on('message',e=>{try{assert.ok(!records.has(e.index));validateRow(e.row,jobs[e.index],scenes.get(jobs[e.index].id));fs.appendFileSync(cp,JSON.stringify({index:e.index,sha256:jh(e.row),row:e.row})+'\n');records.set(e.index,e.row);if(records.size%32===0||records.size===jobs.length)console.log(JSON.stringify({stage:name,done:records.size,total:jobs.length}));}catch(error){reject(error);}});
   w.on('error',reject);w.on('exit',code=>code?reject(Error('WORKER_EXIT_'+code)):resolve());
  })));}catch(e){await Promise.allSettled(threads.map(t=>t.terminate()));throw e;}
  assert.equal(records.size,jobs.length);const rows=jobs.map((_,i)=>records.get(i));
  const file=path.join(dir,'matches.ndjson.gz');save(file,z.gzipSync(rows.map(JSON.stringify).join('\n')+'\n'));
  const ef=path.join(dir,'execution.json');if(!fs.existsSync(ef))saveJSON(ef,{games:jobs.length,seconds:(Date.now()-started)/1000,matchesHash:hash(fs.readFileSync(file)),errors:0,timeouts:0,restore:0,hotAllocations:0});
  const e=read(ef);assert.equal(e.matchesHash,hash(fs.readFileSync(file)));assert.equal(e.games,rows.length);stages.push({name,...e});return rows;
 }
 const original=new Map(d.original.map(r=>[key(r),r])),replays=[];
 for(const mode of ['R15','R29']){
  const rows=await stage('replay-'+mode,d.cells.filter(c=>c.mode===mode));
  for(const r of rows){const b=original.get(key(r));assert.deepEqual(semantic(r),semantic(b),'REPLAY_DRIFT');assert.deepEqual(r.audit,b.audit,'WORK_DRIFT');}
  replays.push(...rows);
 }
 const plan=createPlan(d.cells,d.original,d.baselines,replays);saveJSON(path.join(out,'plan.json'),plan);
 const replayIndex=new Map(replays.map(r=>[key(r),r]));
 for(const mode of ['R15','R29']){
  const jobs=plan.noopJobs.filter(j=>j.mode===mode),rows=await stage('noop-'+mode,jobs);
  rows.forEach((r,i)=>validateBranch(replayIndex.get(key(r)),r,jobs[i],true));
 }
 saveJSON(path.join(out,'preflight.json'),{replays:replays.length,noops:plan.noopJobs.length,equivalent:true});
 for(const mode of ['R15','R29']){
  const jobs=plan.branchJobs.filter(j=>j.mode===mode),rows=await stage('branches-'+mode,jobs);
  rows.forEach((r,i)=>validateBranch(replayIndex.get(key(r)),r,jobs[i]));
 }
 assert.equal(productionTreeSha256(root),tree);
 saveJSON(path.join(out,'execution.json'),{status:'TEN_ROUNDS_EXECUTED',stages,executedGames:stages.reduce((n,s)=>n+s.games,0),seconds:stages.reduce((n,s)=>n+s.seconds,0),productionUnchanged:true});
 console.log(JSON.stringify({status:'TEN_ROUNDS_EXECUTED',games:stages.reduce((n,s)=>n+s.games,0)}));
}
if(!isMainThread)workerRun().catch(e=>{throw e;});else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={input,read,readRows,hash,jh,save,saveJSON,loadCheckpoint,validateRow,validateBranch,run};
