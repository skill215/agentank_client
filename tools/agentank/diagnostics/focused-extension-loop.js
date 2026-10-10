'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const D=require('./focused-extension-design');
const read=f=>JSON.parse(fs.readFileSync(f));
const rows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=f=>D.hash(fs.readFileSync(f));
function save(f,x){const bytes=JSON.stringify(x,null,2)+'\n';if(fs.existsSync(f)){assert.equal(fs.readFileSync(f,'utf8'),bytes,'FROZEN_ARTIFACT_DRIFT:'+f);return;}fs.writeFileSync(f,bytes,{flag:'wx'});}
function healthy(r){for(const s of [r.candidate,r.control]){assert.equal(s.errorCount,0);assert.equal(s.timeoutCount,0);}assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);}
async function worker(){
 const root=workerData.root,scenes=new Map(JSON.parse(z.gunzipSync(fs.readFileSync(workerData.scenarioFile))).map(s=>[s.matchUrlId,s]));
 const {play,NativeBasePolicyDiagnosticBot:Bot}=require('./native-base-policy-standalone-arena');
 const {V3DiagnosticBot}=require('../../../engine-v3/src');const {withClock}=require('./deterministic-v1-clock');
 const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');const {NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
 const variants=D.compile(root),event=await require('./strategic-event-simulator').load(root);
 const original=Bot.prototype.decide,enemy=V3DiagnosticBot.prototype.decide;let job,audit;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 Bot.prototype.decide=function(...args){if(!this.loopInstalled){this.loopInstalled=true;const engine=this.engine,search=engine.basePolicy.policySearch;
  variants.install(engine,job.mode,this,audit,job.role==='preflight');
  const bind=search.bindIsolatedHard.bind(search),counted=new WeakSet();search.bindIsolatedHard=(...a)=>{const result=bind(...a),kernel=search.diagnosticKernel;
   if(kernel&&!counted.has(kernel)){counted.add(kernel);const apply=kernel.applyFrame.bind(kernel);kernel.applyFrame=(...args)=>{audit.transitions++;return apply(...args);};}return result;};
  const terminal=search.terminalUtility.bind(search);search.terminalUtility=(...a)=>{audit.terminalCalls++;return terminal(...a);};
  const chance=search.v1OwnChance.bind(search);search.v1OwnChance=(...a)=>{audit.chanceCollapsed++;return chance(...a);};
 }const begin=process.hrtime.bigint();try{return original.apply(this,args);}finally{audit.decisionMs+=Number(process.hrtime.bigint()-begin)/1e6;}};
 Bot.prototype.captureRoot=function(){const e=this.engine,s=e.basePolicy.policySearch;
  if(this.searchEvidenceCurrent){audit.nodes+=s.nodes;const ext=Array.from(s.eventQuiescenceExpansionByPly).reduce((n,x)=>n+x,0);audit.quiescenceExtensions+=ext-(this.lastExtensionCount||0);this.lastExtensionCount=ext;audit.searchRoots++;audit.budgetLeaves+=s.lastBudgetLeafCount;
   const a=e.adapter.state.arrays,f=a[ARRAY.SCALAR][SCALAR.FRAME];audit.ownStunnedRoots+=Number(a[ARRAY.TANK_STUN_UNTIL][0]!==NONE_FRAME&&a[ARRAY.TANK_STUN_UNTIL][0]>f);
   const row=e.lastProposalRow;if(row>=0){assert.equal(e.hardStatus[row],0);assert.equal(e.basePolicy.owner.allowedRow[row],1);audit.ownerChecks++;}
  }
  if(e.lastSelectedRow>=0){assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,e.lastSelectedRow,e.ourCount));audit.finalGateChecks++;}
 };
 parentPort.on('message',async message=>{try{for(const {index,job:j} of message.jobs){job=j;
  audit={leafCalls:0,leafExecutions:0,cacheHits:0,cacheBytes:0,cacheComparedWords:0,shadowChecks:0,decisionMs:0,quiescenceExtensions:0,nodes:0,transitions:0,searchRoots:0,budgetLeaves:0,terminalCalls:0,chanceCollapsed:0,ownStunnedRoots:0,ownerChecks:0,finalGateChecks:0};
  const sim=event.wrap(job,()=>{});const r=await play(sim,scenes.get(job.id),job.seat,true);
  healthy(r);delete r.candidateEngine.rootFrames;delete r.control.actionFrames;r.audit=audit;r.job=job;
  parentPort.postMessage({type:'row',index,row:r});
 }parentPort.postMessage({type:'done'});}catch(e){parentPort.postMessage({type:'error',error:String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]')});}});
 parentPort.postMessage({type:'ready'});
}
function stateInitial(){return {active:['quiescence','bomb-quiescence','R29-quiescence'],phase:'DISCOVERY',retired:[],seen:['quiescence','bomb-quiescence','R29-quiescence'],frozen:null,champion:'baseline'};}
async function run(root,out){
 const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
 const {semantic}=require('./efficient-tuning-campaign');const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
 const {PROTOCOL}=require('./deterministic-v1-clock');const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
 const bm=read(path.join(base,'manifest.json')),tree=productionTreeSha256(root);assert.equal(tree,bm.tree);assert.equal(process.version,bm.node);
 assert.equal(resolveFrozenV1(root).sha256,bm.v1);assert.equal(PROTOCOL,bm.clock);assert.equal(sha(require.resolve('./native-base-policy-standalone-arena')),bm.hostSha256);
 const event=await require('./strategic-event-simulator').load(root),{eventAdapterSha256,...adapter}=event.identity;assert.deepEqual(adapter,bm.adapter);
 const sourceFiles=['tools/agentank/diagnostics/focused-extension-design.js','tools/agentank/diagnostics/focused-extension-loop.js','tools/agentank/diagnostics/focused-extension-audit.py','test/minimax-core/focused-extension-loop.test.js',
  'tools/agentank/diagnostics/focused-extension-scenarios.js','tools/agentank/diagnostics/continuous-improvement-design.js','tools/agentank/diagnostics/adaptive-optimization-design.js','tools/agentank/diagnostics/strategic-improvement-model.js','tools/agentank/diagnostics/strategic-event-simulator.js','tools/agentank/diagnostics/deterministic-v1-clock.js',
  'tools/agentank/diagnostics/native-base-policy-standalone-arena.js','artifacts/native-causal-audit/bp392-portable-path-ten-rounds/build/R29/path-utility.js'];
 const sourceHashes=Object.fromEntries(sourceFiles.map(f=>[f,sha(path.join(root,f))]));
 const {all,selected,remainingHistorical}=require('./focused-extension-scenarios').select(root);
 const priorRows=['R221','R222'].flatMap(dir=>rows(path.join(root,'artifacts/native-causal-audit/bp401-continuous-hundred-rounds',dir,'matches.ndjson.gz')));
 const preIds=[...new Set(priorRows.map(r=>r.matchUrlId))].slice(0,4),preScenes=all.filter(s=>preIds.includes(s.matchUrlId));
 fs.mkdirSync(out,{recursive:true});const scenarioFile=path.join(out,'scenarios.json.gz');
 const scenarioBytes=z.gzipSync(JSON.stringify([...selected,...preScenes]));
 if(fs.existsSync(scenarioFile))assert.deepEqual(fs.readFileSync(scenarioFile),scenarioBytes);else fs.writeFileSync(scenarioFile,scenarioBytes);
 save(path.join(out,'protocol.json'),{version:'FOCUSED_EXTENSION_100_ROUNDS_V3',rounds:100,batches:10,roundNumbers:[321,420],roundDefinition:'Three terrain-isolated maps × both seats × original/event-keyed RNG; matched production, R29 and up to three structural candidates.',
  baseObjective:'Local win=1 draw=.5 loss=0; no raw-runtime tie-break',
  batchMaps:Array.from({length:10},(_,i)=>selected.slice(i*30,i*30+30).map(s=>s.matchUrlId)),
  sampleIsolation:'240 deterministic synthetic terrains plus 60 unused historical terrains. R321-R390 use 210 synthetic maps; R391-R420 each use 2 historical + 1 synthetic. All terrains unique and excluded from prior cohorts. Synthetic pressure tests are not new platform evidence.',
  catalogue:D.SPECS,initialState:stateInitial(),dataOrigins:{synthetic:240,historical:60,remainingHistorical},
  adaptation:{initialDiscoveryRounds:4,focusedDiscoveryRounds:4,confirmationDiscoveryRounds:0,
    evaluateEvery:10,maximumActive:3,freezeFinalShortlistAfterBatch:7,finalConfirmationBatches:[8,9,10],
    actions:['BUILD_MINIMUM_SUPPORT','RETAIN_AND_REPLICATE','RETIRE_AND_REALLOCATE','ROLLBACK_DIAGNOSTIC_CHAMPION','PIVOT_TO_REFERENCE_MODEL_AUDIT','FREEZE_SUPPORTED_CONFIRMATION','KEEP_FROZEN_CONFIRMATION'],
    ranking:'Minimum 24 discovery terrains across 2 batches before final selection; rank by worst-environment discovery lower bound. Validation informs retirement only.',minimumDiscoveryMaps:24,minimumDiscoveryBatches:2,behaviorDeduplication:'Exact action/argument/count/outcome signature on >=12 common discovery terrains; quality candidates only; retain fewer transitions.',efficiencyTrack:'No efficiency-only candidates in this protocol; prior full-state cache remains retired.',minimumPracticalMeanGain:.02,maximumWorkRatio:1.25,domainConfirmation:'Require positive adjusted lower bound, mean gain>=.02 and no safety regression in each data-origin/RNG stratum; at least 24 maps in each stratum.',
    retirement:'Transition/node ratio>1.25; no changes on >=24 validation maps; replicated negative both RNGs; or both adjusted upper bounds<.02 after >=72 validation maps.',
    confirmation:'No new candidate, threshold, map or seed after batch 7; unfavorable blocks remain in fixed-size final confirmation.',
    localSupport:'At least 48 validation maps per environment; adjusted descriptive bootstrap lower>0 in both RNG environments; no extra single deaths or paired double losses; node and transition ratios<=1.25; mean gain>=.02. Final qualification additionally requires separate historical/synthetic support.',
    multiplicity:'One-sided tail .05/120 for up to 10 batch looks × 3 active candidates × 2 RNG environments × 2 data origins; 6000 deterministic map bootstrap replicates. Approximate descriptive bounds, not formal platform guarantees.'},
  budget:{maximumGames:6024,workers:4,batchSize:10,stopAfterRound:420,maximumStructuralCandidates:4},
  oldLearningPrototype:'Retired based on BP399; no retraining or gate relaxation.',priorRetiredFamilies:['chance/terminal combinations from BP400','risk advantage learner from BP399','full-state cache and cell-equal budgets from BP401'],workflowSummary:['Freeze hypothesis, mechanism, baseline and budget','Run paired seats and RNG environments on new terrain','Audit checkpoints, score reconstruction and source hashes','Every 10 rounds evaluate quality, safety, cost, support and duplicates','Retain, improve allocation, retire, rollback or pivot from recorded evidence','After 70 rounds freeze supported shortlist; complete fixed 30-round confirmation','Keep production frozen; record failures and reserve new evidence for the next protocol'],
  productionPolicy:'Frozen throughout; diagnostic champion only. No automatic deployment.',
  limitations:['One V1 opponent, two stun skills, 128 frames','Bomb phase calibrated; other platform model deviations remain','Event-keyed RNG changes coupling, not proof of platform probability','Maps/seeds are never policy features','Ten-batch adaptation does not establish superiority over equal-budget optimization workflows']});
 const manifest={tree,node:process.version,v1:bm.v1,clock:PROTOCOL,adapter,eventAdapterSha256,sourceHashes,scenarioHash:sha(scenarioFile),protocolHash:sha(path.join(out,'protocol.json')),prior401Integrity:sha(path.join(root,'artifacts/native-causal-audit/bp401-continuous-hundred-rounds/integrity.json'))};
 save(path.join(out,'manifest.json'),manifest);for(const f of sourceFiles){const p=path.join(out,'sources',f);fs.mkdirSync(path.dirname(p),{recursive:true});if(fs.existsSync(p))assert.equal(sha(p),sourceHashes[f]);else fs.copyFileSync(path.join(root,f),p);}
 const pool=[];for(let i=0;i<4;i++)pool.push(await new Promise((resolve,reject)=>{const w=new Worker(__filename,{workerData:{root,scenarioFile}});w.once('error',reject);w.once('message',m=>m.type==='ready'?resolve(w):reject(Error('WORKER_NOT_READY')));}));
 const started=Date.now(),executions=[];let newGames=0;
 const log=x=>console.log(JSON.stringify(x));
 async function stage(name,jobs){
  const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});save(path.join(dir,'jobs.json'),jobs);
  const doneFile=path.join(dir,'execution.json');
  if(fs.existsSync(doneFile)){const e=read(doneFile),rs=rows(path.join(dir,'matches.ndjson.gz'));assert.equal(sha(path.join(dir,'matches.ndjson.gz')),e.sha256);assert.equal(rs.length,jobs.length);rs.forEach((r,i)=>assert.deepEqual(r.job,jobs[i]));executions.push(e);return rs;}
  const checkpoint=path.join(dir,'checkpoint.ndjson'),rs=new Array(jobs.length);let cached=0;
  if(fs.existsSync(checkpoint)){const raw=fs.readFileSync(checkpoint);assert.ok(!raw.length||raw[raw.length-1]===10,'PARTIAL_CHECKPOINT_REQUIRES_AUDIT');for(const line of raw.toString().trim().split('\n').filter(Boolean)){const e=JSON.parse(line);assert.equal(D.hash(JSON.stringify(e.row)),e.sha256);assert.deepEqual(e.row.job,jobs[e.index]);assert.ok(!rs[e.index]);rs[e.index]=e.row;cached++;}}
  const pending=jobs.map((job,index)=>({job,index})).filter(x=>!rs[x.index]),begin=Date.now();let count=cached;
  log({stage:name,status:'START',games:jobs.length,cached});
  await Promise.all(pool.map((w,workerIndex)=>new Promise((resolve,reject)=>{
   const error=e=>{clean();reject(e);},exit=c=>error(Error('WORKER_EXIT_'+c));
   const clean=()=>{w.off('message',message);w.off('error',error);w.off('exit',exit);};
   const message=m=>{try{if(m.type==='error')throw Error(m.error);if(m.type==='done'){clean();resolve();return;}assert.equal(m.type,'row');
     const {index,row}=m;assert.ok(!rs[index]);assert.deepEqual(row.job,jobs[index]);healthy(row);rs[index]=row;count++;newGames++;
     fs.appendFileSync(checkpoint,JSON.stringify({index,sha256:D.hash(JSON.stringify(row)),row})+'\n');
   }catch(e){error(e);}};
   w.on('message',message);w.once('error',error);w.once('exit',exit);w.postMessage({jobs:pending.filter((_,i)=>i%4===workerIndex)});
  })));
  assert.equal(count,jobs.length);assert.equal(productionTreeSha256(root),tree);
  fs.writeFileSync(path.join(dir,'matches.ndjson.gz'),z.gzipSync(rs.map(JSON.stringify).join('\n')+'\n'));
  const e={name,games:rs.length,newGames:pending.length,cachedAtExecution:cached,seconds:(Date.now()-begin)/1000,sha256:sha(path.join(dir,'matches.ndjson.gz'))};save(doneFile,e);executions.push(e);log({stage:name,status:'COMPLETE',games:rs.length});return rs;
 }
 try{
  const preJobs=['baseline','R29','quiescence'].flatMap(mode=>preIds.flatMap(id=>[0,1].map(seat=>({id,seat,mode,role:'preflight',env:'original',seed:parseInt(D.hash('loop401-seed:'+id).slice(0,8),16)}))));
  const pre=await stage('preflight',preJobs);
  for(const mode of ['baseline','R29','quiescence']){
   const ref=new Map(priorRows.filter(r=>r.job.mode===mode&&r.job.env==='original').map(r=>[r.matchUrlId+':'+r.candidateSeat,r]));
   for(const r of pre.filter(r=>r.job.mode===mode))assert.deepEqual(semantic(r),semantic(ref.get(r.matchUrlId+':'+r.candidateSeat)),'INSTANCE_VARIANT_REPLICA_DRIFT');}
  save(path.join(out,'preflight.json'),{games:24,exactEquivalence:true,production:true,R29:true,quiescence:true});
  let state=stateInitial();const history=[],evaluations=[];
  for(let batch=1;batch<=10;batch++){
   const discoveryRounds=state.phase==='CONFIRMATION'?0:state.phase==='REFERENCE_AUDIT'?0:4;
   const modes=['baseline','R29',...state.active];assert.equal(new Set(modes).size,modes.length);
   const plan={batch,rounds:[321+(batch-1)*10,330+(batch-1)*10],phase:state.phase,discoveryRounds,modes,stateBefore:structuredClone(state),
    maps:selected.slice((batch-1)*30,batch*30).map(s=>s.matchUrlId),priorEvaluationHash:batch>1?sha(path.join(out,`batch-${batch-1}-evaluation.json`)):null};
   save(path.join(out,`batch-${batch}-plan.json`),plan);const batchRows=[];
   for(let offset=0;offset<10;offset++){
    const number=321+(batch-1)*10+offset,role=offset<discoveryRounds?'discovery':'validation',scenes=selected.slice((number-321)*3,(number-320)*3);
    const jobs=modes.flatMap(mode=>['original','event'].flatMap(env=>scenes.flatMap(s=>[0,1].map(seat=>{
      const seed=parseInt(D.hash('loop402-seed:'+s.matchUrlId).slice(0,8),16);
      return {id:s.matchUrlId,seat,round:number,batch,mode,env,role,origin:s.origin,seed,...(env==='event'?{eventFrom:0,eventSeed:seed}:{})};
    }))));
    const played=await stage('R'+number,jobs);history.push(...played);batchRows.push(...played);
    const stats=D.evaluateModes(played,state.active.concat('R29'),'all');save(path.join(out,'R'+number+'.json'),{round:number,batch,role,completed:true,games:played.length,comparisons:stats});
   }
   const seen=[...new Set(state.seen.concat(state.active))],allSummaries=D.evaluateModes(history,seen,'validation',true),poolEvidence={},discovery={},supports={};
   const development=D.evaluateModes(history,seen,'discovery');
   for(const mode of seen){const batches=new Set(history.filter(r=>r.job.mode===mode&&r.job.role==='validation').map(r=>r.job.batch)).size;
     poolEvidence[mode]=D.evidence(allSummaries[mode],batches,mode);discovery[mode]=Math.min(development[mode].original.lo,development[mode].event.lo);supports[mode]=D.support(history,mode);}
   const duplicates=D.duplicates(history,state.active);const retired=[...new Set([...state.retired,...seen.filter(m=>poolEvidence[m].retire),...duplicates.map(x=>x.retire)])],qualified=state.active.filter(m=>poolEvidence[m].strong&&!retired.includes(m));
   let champion=state.champion,rollback=false;
   const batchValidation=D.evaluateModes(batchRows,state.active.concat('R29'),'validation');
   if(champion!=='baseline'&&batchValidation[champion]&&Object.values(batchValidation[champion]).some(s=>s.mean<-.02||s.deathDelta>0||s.doubleLossDelta>0)){
     champion='baseline';rollback=true;
   }else if(qualified.length)champion=qualified.sort((x,y)=>discovery[y]-discovery[x])[0];
   const next=D.chooseNext(batch,state.active,poolEvidence,retired,seen,discovery,qualified,state.frozen,supports);
   const evaluation={batch,completedRounds:batch*10,completedGames:executions.reduce((n,e)=>n+e.games,0),
    active:state.active,phase:state.phase,batchValidation,cumulativeValidation:allSummaries,evidence:poolEvidence,discoveryRank:discovery,discoverySupport:supports,behaviorDuplicates:duplicates,
    retired,qualifiedDiagnostic:qualified,diagnosticChampion:champion,productionChampion:'baseline',
    decision:rollback?'ROLLBACK_DIAGNOSTIC_CHAMPION':next.action,nextPhase:next.phase,nextActive:next.active,
    rationale:rollback?'Fresh validation regressed; revert local champion to production baseline.':next.action==='IMPROVE_ROBUSTNESS_TEST'?'Opposite signs across RNG environments; prioritize explicit worst-branch or root-only uncertainty hypotheses.':
      next.action==='RETIRE_AND_REALLOCATE'?'Retire weak, costly or duplicate mechanisms; activate the single predeclared urgent-threat extension if a slot opens.':
      next.phase==='CONFIRMATION'?'Freeze shortlist and finish fixed independent confirmation, including unfavorable blocks.':'Accumulate minimum independent support before selection; preserve separate quality and efficiency criteria.',
    cost:{batchGames:batchRows.length,batchSeconds:executions.filter(e=>/^R/.test(e.name)&&Number(e.name.slice(1))>=plan.rounds[0]&&Number(e.name.slice(1))<=plan.rounds[1]).reduce((n,e)=>n+e.seconds,0),activeCandidates:state.active.length},
    stateAfter:{active:next.active,phase:next.phase,retired,seen:[...new Set(seen.concat(next.active))],frozen:next.frozen,champion},
    methodAssessment:{retained:['paired baselines','terrain isolation','source freezing','event RNG sensitivity','finite budget','map-level uncertainty'],
      changed:next.action,minimumSupportEnforced:true,exactBehaviorDeduplication:true,separateEfficiencyTrack:true,separateDataOrigins:true,minimumPracticalGain:.02,qualificationIsLocalOnly:true,equalBudgetWorkflowSuperiorityProven:false}};
   save(path.join(out,`batch-${batch}-evaluation.json`),evaluation);
   require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/focused-extension-audit.py'),out,'--batch',String(batch)],{stdio:'pipe',maxBuffer:1024*1024});
   evaluations.push(evaluation);state=evaluation.stateAfter;
   log({batch,completedRounds:batch*10,decision:evaluation.decision,nextActive:state.active,retired,champion,qualified});
  }
  assert.equal(history.length,executions.filter(e=>e.name!=='preflight').reduce((n,e)=>n+e.games,0));assert.ok(executions.reduce((n,e)=>n+e.games,0)<=6024);
  assert.equal(productionTreeSha256(root),tree);for(const [f,h]of Object.entries(sourceHashes))assert.equal(sha(path.join(root,f)),h);
  const finalModes=evaluations[6].nextActive;const confirmation=history.filter(r=>r.job.batch>=8);
  const finalComparisons=D.evaluateModes(confirmation,finalModes.concat('R29'),'validation',true);
  const finalByOrigin=Object.fromEntries(['historical','synthetic'].map(origin=>[origin,D.evaluateModes(confirmation.filter(r=>r.job.origin===origin),finalModes.concat('R29'),'validation',true)]));
  const finalQualified=finalModes.filter(m=>D.evidence(finalComparisons[m],3,m).strong&&D.domainSupport(Object.fromEntries(Object.entries(finalByOrigin).map(([origin,data])=>[origin,data[m]]))));
  const result={status:'ONE_HUNDRED_ROUNDS_COMPLETE',rounds:100,batches:10,roundNumbers:[321,420],executedGames:executions.reduce((n,e)=>n+e.games,0),
    stageSeconds:executions.reduce((n,e)=>n+e.seconds,0),thisRunSeconds:(Date.now()-started)/1000,thisRunNewGames:newGames,
    evaluations,finalModes,finalComparisons,finalByOrigin,finalQualifiedDiagnostic:finalQualified,productionUnchanged:true,productionAdoption:false,
    finalDecision:finalQualified.length?'RETAIN_FOR_EXTERNAL_MODEL_VALIDATION':'KEEP_PRODUCTION_AND_END_THIS_CAMPAIGN'};
  save(path.join(out,'summary.json'),result);
  require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/focused-extension-audit.py'),out],{stdio:'pipe',maxBuffer:1024*1024});
  log({status:result.status,games:result.executedGames,finalModes,finalQualified,decision:result.finalDecision});
 }finally{await Promise.allSettled(pool.map(w=>w.terminate()));}
}
if(!isMainThread)worker().catch(e=>{throw e;});else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={stateInitial,healthy};
