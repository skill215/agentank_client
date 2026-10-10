'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const M=require('./strategic-improvement-model');
// Experimental substitutions are isolated to workers; production files remain frozen.
if(!isMainThread && ['aligned','R29'].includes(workerData.mode)) {
  const Module=require('node:module');
  const file=path.join(workerData.root,'engine-v2/src/base-policy-specialized',workerData.mode==='aligned'?'policy-search.js':'path-utility.js');
  const source=workerData.mode==='aligned'?M.alignedSearchSource(fs.readFileSync(file,'utf8')):
    fs.readFileSync(path.join(workerData.root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds/build/R29/path-utility.js'),'utf8');
  const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(source,file);mod.loaded=true;require.cache[file]=mod;
}
const read=f=>JSON.parse(fs.readFileSync(f));
const readRows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
const digest=f=>M.hash(fs.readFileSync(f));
const save=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const key=r=>r.matchUrlId+':'+r.candidateSeat;
function healthy(r) {
  for(const side of [r.candidate,r.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}
  assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);
}
function compare(base,rows) {
  const index=new Map(base.map(r=>[key(r),r]));
  const records=rows.map(r=>{const b=index.get(key(r));assert.ok(b);assert.equal(b.scenarioFingerprint,r.scenarioFingerprint);
    return {map:r.matchUrlId,delta:M.score(r)-M.score(b),deathDelta:singleDeath(r)-singleDeath(b)};});
  const ci=M.interval(records);const nodes=rows.reduce((n,r)=>n+r.audit.nodes,0),baselineNodes=base.reduce((n,r)=>n+r.audit.nodes,0);
  const doubles=rs=>{const g=new Map();for(const r of rs){const a=g.get(r.matchUrlId)||[];a.push(r);g.set(r.matchUrlId,a);}return [...g.values()].filter(a=>a.length===2&&a.every(r=>M.score(r)===0)).length;};
  return {...ci,deltaPoints:records.reduce((n,r)=>n+r.delta,0),deathDelta:records.reduce((n,r)=>n+r.deathDelta,0),doubleLossDelta:doubles(rows)-doubles(base),
    nodeRatio:nodes/Math.max(1,baselineNodes),interventions:rows.reduce((n,r)=>n+r.audit.interventions,0),
    alteredMatches:rows.filter(r=>r.audit.interventions>0).length,baselinePoints:base.reduce((n,r)=>n+M.score(r),0),candidatePoints:rows.reduce((n,r)=>n+M.score(r),0),
    candidateSingleDeaths:rows.reduce((n,r)=>n+singleDeath(r),0),baselineSingleDeaths:base.reduce((n,r)=>n+singleDeath(r),0),
    interpretation:'Descriptive map-cluster bootstrap; no correction for selecting a winner among multiple arms'};
}
function singleDeath(r){return Number(r.analysisOutcome==='V1_WIN'&&r.terminalCategory==='SINGLE_CRASH');}

async function workerRun() {
  const {root,scenarioFile,jobs,mode,modelFile}=workerData;
  const scenes=new Map(JSON.parse(z.gunzipSync(fs.readFileSync(scenarioFile))).map(s=>[s.matchUrlId,s]));
  const {play,NativeBasePolicyDiagnosticBot:Bot}=require('./native-base-policy-standalone-arena');
  const {V3DiagnosticBot}=require('../../../engine-v3/src');
  const {withClock}=require('./deterministic-v1-clock');
  const event=await require('./strategic-event-simulator').load(root);
  const model=modelFile?read(modelFile):null;
  const decide=Bot.prototype.decide,enemyDecide=V3DiagnosticBot.prototype.decide,capture=Bot.prototype.captureRoot;
  let job,audit,snapshots,simulator;
  V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemyDecide.call(this,c));};
  Bot.prototype.decide=function(...args){
    if(!this.strategicInstalled){this.strategicInstalled=true;const e=this.engine,emit=e.emit.bind(e);
      const terminal=e.basePolicy.policySearch.terminalUtility.bind(e.basePolicy.policySearch);
      e.basePolicy.policySearch.terminalUtility=(...a)=>{audit.terminalCalls++;return terminal(...a);};
      const chance=e.basePolicy.policySearch.v1OwnChance.bind(e.basePolicy.policySearch);
      e.basePolicy.policySearch.v1OwnChance=(...a)=>{audit.ownChanceCollapsed++;return chance(...a);};
      e.emit=(me,action)=>{
        this.strategicSnapshot=null;
        if(this.searchEvidenceCurrent){const s=M.snapshot(e,action);this.strategicSnapshot=s;
          if(mode==='gated'||mode==='ungated') {
            const proposal=M.choose(s,model,mode==='gated');
            if(proposal){const r=proposal.row;
              assert.ok(r.allowed);assert.equal(e.hardStatus[r.row],0);
              assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,r.row,e.ourCount));
              e.lastSelectedRow=r.row;e.basePolicy.intent.commitSelection(r.action);audit.interventions++;
              return emit(me,r.action);
            }
          }
        }
        return emit(me,action);
      };
    }
    return decide.apply(this,args);
  };
  Bot.prototype.captureRoot=function(context){
    const search=this.engine.basePolicy.policySearch;
    if(this.searchEvidenceCurrent){audit.nodes+=search.nodes;audit.searchRoots++;audit.budgetLeaves+=search.lastBudgetLeafCount;}
    const s=this.strategicSnapshot;
    if(s){audit.ownStunnedRoots+=Number(s.ownStunned);audit.enemyStunnedRoots+=Number(s.enemyStunned);
      if(job.capture && M.alternatives(s).length)snapshots.push(s);}
  };
  try {for(const item of jobs){job=item.job;snapshots=[];simulator=null;
    audit={nodes:0,searchRoots:0,budgetLeaves:0,terminalCalls:0,ownChanceCollapsed:0,ownStunnedRoots:0,enemyStunnedRoots:0,interventions:0};
    const mod=event.wrap(job,x=>{simulator=x;});
    const row=await play(mod,scenes.get(job.id),job.seat,true,null,true,true,'current',false,false,1,'off',job.frame??-1,job.action??-1);
    healthy(row);delete row.candidateEngine.rootFrames;delete row.control.actionFrames;
    row.audit=audit;row.job=job;row.snapshots=snapshots;row.events=job.keepEvents?simulator.experimentEvents:[];
    row.deathWithinFour=job.frame===undefined?null:Boolean(simulator.players[job.seat].crashed && simulator.frame<=job.frame+4);
    parentPort.postMessage({index:item.index,row});
  }}finally{Bot.prototype.decide=decide;Bot.prototype.captureRoot=capture;V3DiagnosticBot.prototype.decide=enemyDecide;}
}

const ROUND_PLAN=[
 ['R111','基线与旧 R29 等价复现','冻结生产和旧方法身份；诊断挂钩不改变轨迹'],
 ['R112','事件随机数与模型契约','验证同根同事件配对、无效干预等价、眩晕概率和终局语义'],
 ['R113','训练集成对反事实','生产基线续跑；每根最多两个备选、四组后缀随机事件'],
 ['R114','独立校准与冻结模型','固定岭回归；两档建议各至少八张地图、校准下界大于 1pp 且单死不增加'],
 ['R115','隔离地图单步检验','评估预测、四帧风险标签和单步可执行规则，不以事后最优当收益'],
 ['R116','生产随机数下重复干预','基线、受约束建议、无约束消融和旧 R29 同地图同种子比较'],
 ['R117','随机与终局对齐原型','同时枚举己方随机分支、终局精确计分，保持节点预算'],
 ['R118','新种子压力复核','所有冻结方法使用同一组新初始种子，不再拟合'],
 ['R119','事件随机数敏感性','所有冻结方法用事件配对随机数检查结论是否依赖 RNG 调用次序'],
 ['R120','第二隔离地图确认','更换地图和种子验证全部冻结方法，记录成本并结束本批']
];
async function run(root,out) {
  assert.ok(!fs.existsSync(out),'NEW_OUTPUT_DIRECTORY_REQUIRED');
  const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
  const {semantic}=require('./efficient-tuning-campaign');
  const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
  const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
  const {PROTOCOL}=require('./deterministic-v1-clock');
  const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
  const bm=read(path.join(base,'manifest.json')),tree=productionTreeSha256(root);assert.equal(tree,bm.tree);
  assert.equal(process.version,bm.node);assert.equal(resolveFrozenV1(root).sha256,bm.v1);assert.equal(PROTOCOL,bm.clock);
  const event=await require('./strategic-event-simulator').load(root);
  const {eventAdapterSha256,...adapter}=event.identity;assert.deepEqual(adapter,bm.adapter);
  assert.equal(digest(require.resolve('./native-base-policy-standalone-arena')),bm.hostSha256);
  const all=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz'))));
  const allRows=readRows(path.join(base,'matches.ndjson.gz')),baselineIndex=new Map(allRows.map(r=>[key(r),r]));
  const priorScenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp394-multiseed-ten-rounds/scenarios.json.gz'))));
  const excluded=new Set(priorScenes.map(s=>M.hash(JSON.stringify(s.map))));
  const prev=read(path.join(root,'artifacts/native-causal-audit/bp398-selective-risk-ten-rounds/manifest.json'));
  const previousIds=new Set([...(prev.frozen?.development||prev.development||[]),...(prev.frozen?.validation||prev.validation||[])]);
  for(const s of all)if(previousIds.has(s.matchUrlId))excluded.add(M.hash(JSON.stringify(s.map)));
  const pool=all.slice().sort((a,b)=>M.hash('strategic399:'+a.matchUrlId).localeCompare(M.hash('strategic399:'+b.matchUrlId)));
  const selected=[];for(const s of pool){const h=M.hash(JSON.stringify(s.map));if(excluded.has(h))continue;excluded.add(h);selected.push(s);if(selected.length===96)break;}
  assert.equal(selected.length,96);
  const splits={train:selected.slice(0,32),calibration:selected.slice(32,48),test:selected.slice(48,72),confirmation:selected.slice(72,96)};
  fs.mkdirSync(out,{recursive:true});const scenarioFile=path.join(out,'scenarios.json.gz');fs.writeFileSync(scenarioFile,z.gzipSync(JSON.stringify(selected)));
  const sourcePaths=['strategic-improvement-campaign.js','strategic-improvement-model.js','strategic-event-simulator.js'].map(f=>'tools/agentank/diagnostics/'+f);
  sourcePaths.push('test/minimax-core/strategic-improvement.test.js');
  const sources=Object.fromEntries(sourcePaths.map(f=>[f,digest(path.join(root,f))]));
  const legacyPath='artifacts/native-causal-audit/bp392-portable-path-ten-rounds/build/R29/path-utility.js';
  const portable=read(path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds/manifest.json'));
  assert.equal(digest(path.join(root,legacyPath)),portable.buildHashes.R29['path-utility.js']);sources[legacyPath]=digest(path.join(root,legacyPath));
  save(path.join(out,'protocol.json'),{version:'STRATEGIC_IMPROVEMENT_BP399_V1',rounds:ROUND_PLAN,primary:'local win=1 draw=.5 loss=0',
    splits:Object.fromEntries(Object.entries(splits).map(([k,v])=>[k,v.map(s=>s.matchUrlId)])),
    selection:'Hash-ranked unique terrain; independent of outcomes; excludes BP394 terrain and prior BP398 dev/validation when available',
    blind:false,blindReason:'Historical map corpus previously analyzed; this batch uses isolated training/calibration/test terrain, not platform blind evidence',
    labels:{rootsPerSeat:1,alternatives:2,suffixSeeds:4,continuation:'unchanged production policy',rootSelection:'closest eligible root to hash-chosen target frame 8/24/48/80',shortHorizon:4},
    model:{lambda:1,minimumPredictedAdvantage:.05,bins:[.05,.25],support:'training feature range ±.05; at least 24 training maps',
      calibration:'two fixed bins; >=8 maps; map bootstrap lower 1.25th percentile > .01; single-death delta <=0',
      caveat:'Bin-level empirical check, not per-state confidence guarantee'},
    finalGate:'positive point gain and map CI lower>0 on original RNG new-seed test and confirmation, no extra single deaths or seat-pair double losses, search node ratio<=2; no deployment in this diagnostic batch',
    limits:{maximumGames:3200,workers:4,maximumMechanismCandidates:3,noRetuning:true,noAdditionalSeedsAfterResults:true},
    caveats:['single fixed opponent V1','bomb-only platform calibration','synthetic event randomness preserves local probabilities, does not establish platform correctness','four suffix seeds are a bounded pilot, not precise conditional probabilities']});
  save(path.join(out,'manifest.json'),{tree,adapter,eventAdapterSha256,node:process.version,v1:bm.v1,clock:PROTOCOL,hostSha256:bm.hostSha256,sources,
    baselineHash:digest(path.join(base,'matches.ndjson.gz')),protocolHash:digest(path.join(out,'protocol.json')),scenarioHash:digest(scenarioFile),productionChanges:false});
  for(const f of sourcePaths){const p=path.join(out,'sources',f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,f),p);}
  const started=Date.now(),stages=[],rounds=[];let games=0;
  const log=x=>console.log(JSON.stringify(x));
  async function stage(name,jobs,mode='baseline',modelFile=null) {
    assert.ok(games+jobs.length<=3200,'CAMPAIGN_BUDGET');const dir=path.join(out,name);fs.mkdirSync(dir);save(path.join(dir,'jobs.json'),jobs);
    const rows=new Array(jobs.length),threads=[],start=Date.now();let done=0;
    log({stage:name,status:'START',games:jobs.length,mode});
    try{await Promise.all(Array.from({length:Math.min(4,jobs.length)},(_,i)=>new Promise((resolve,reject)=>{
      const entries=jobs.map((job,index)=>({job,index})).filter(e=>e.index%4===i);
      const w=new Worker(__filename,{workerData:{root,scenarioFile,jobs:entries,mode,modelFile}});threads.push(w);
      w.on('message',({index,row})=>{try{assert.ok(!rows[index]);healthy(row);assert.deepEqual(row.job,jobs[index]);
        rows[index]=row;done++;games++;fs.appendFileSync(path.join(dir,'checkpoint.ndjson'),JSON.stringify({index,sha256:M.hash(JSON.stringify(row)),row})+'\n');
        if(done%64===0||done===jobs.length)log({stage:name,done,total:jobs.length});}catch(e){reject(e);}});
      w.on('error',reject);w.on('exit',c=>c?reject(Error('WORKER_EXIT_'+c)):resolve());
    })));
    assert.equal(done,jobs.length);assert.equal(productionTreeSha256(root),tree);
    fs.writeFileSync(path.join(dir,'matches.ndjson.gz'),z.gzipSync(rows.map(JSON.stringify).join('\n')+'\n'));
    const execution={name,games:done,seconds:(Date.now()-start)/1000,mode,matchesHash:digest(path.join(dir,'matches.ndjson.gz'))};
    save(path.join(dir,'execution.json'),execution);stages.push(execution);return rows;
    }catch(e){await Promise.allSettled(threads.map(w=>w.terminate()));save(path.join(dir,'failure.json'),{error:e.stack,completed:done});throw e;}
  }
  const jobsFor=(scenes,extras={})=>scenes.flatMap(s=>[0,1].map(seat=>({id:s.matchUrlId,seat,...extras})));
  function finish(id,result){const r={id,name:ROUND_PLAN.find(r=>r[0]===id)[1],...result};rounds.push(r);save(path.join(out,id+'.json'),r);log({round:id,status:r.status});}
  const pre=await stage('R111-production',jobsFor(selected.slice(0,8),{capture:true}));
  for(const r of pre)assert.deepEqual(semantic(r),semantic(baselineIndex.get(key(r))),'PRODUCTION_HOOK_DRIFT');
  const legacy=await stage('R111-R29',jobsFor(selected.slice(0,8)),'R29');
  const oldIndex=new Map(readRows(path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds/R42-portable-full/matches.ndjson.gz')).map(r=>[key(r),r]));
  for(const r of legacy)assert.deepEqual(semantic(r),semantic(oldIndex.get(key(r))),'R29_REPLICA_DRIFT');
  finish('R111',{status:'PASS',productionGames:pre.length,legacyGames:legacy.length,exactActionAndOutcomeEquivalence:true,
    exposure:pre.reduce((a,r)=>{for(const k of Object.keys(a))a[k]+=r.audit[k];return a;},{terminalCalls:0,ownChanceCollapsed:0,ownStunnedRoots:0})});
  function rootFor(r) {
    const target=[8,24,48,80][parseInt(M.hash('root:'+key(r)).slice(0,2),16)%4];
    return r.snapshots.slice().sort((a,b)=>Math.abs(a.frame-target)-Math.abs(b.frame-target)||a.frame-b.frame)[0];
  }
  const pairingRoots=pre.map(r=>({row:r,s:rootFor(r)})).filter(r=>r.s).slice(0,8);
  const pairJobs=pairingRoots.flatMap(({row:r,s})=>[0,1,2].map(rep=>({id:r.matchUrlId,seat:r.candidateSeat,frame:s.frame,action:rep===2?-1:s.baselineAction,
    eventFrom:s.frame,eventSeed:399112,keepEvents:true,rep})));
  const pairRows=await stage('R112-pairing',pairJobs);
  for(let i=0;i<pairRows.length;i+=3){assert.deepEqual(semantic(pairRows[i]),semantic(pairRows[i+1]));assert.deepEqual(semantic(pairRows[i]),semantic(pairRows[i+2]));assert.deepEqual(pairRows[i].events,pairRows[i+1].events);assert.deepEqual(pairRows[i].events,pairRows[i+2].events);
    const root=pairingRoots[i/3];assert.ok(prefixMatches(root.row,pairRows[i],root.s.frame,root.s.baselineAction));assert.equal(pairRows[i].candidateEngine.forceApplied,1);}
  const probePlayer={crashed:false,effects:{debuff:{type:'stun',expiresAt:10}}};let reversed=0;
  for(let i=0;i<4096;i++){const rng=()=>require('./strategic-event-simulator').eventUniform(i,0,'stun',0);reversed+=Number(event.normalized(probePlayer,{type:'go'},0,rng).type==='back');}
  assert.ok(reversed>1843&&reversed<2253);
  finish('R112',{status:'PASS_LOCAL_CONTRACT_ONLY',pairedRuns:pairRows.length,stunTrials:4096,reversed,
    disclaimer:'Local 50/50 contract only; platform stun probability remains uncalibrated. Event adapter uses original RNG before branch frame.'});
  async function labels(name,scenes) {
    const captures=await stage(name+'-capture',jobsFor(scenes,{capture:true}));
    for(const r of captures)assert.deepEqual(semantic(r),semantic(baselineIndex.get(key(r))),'CAPTURE_DRIFT');
    const roots=captures.map(row=>({row,s:rootFor(row)})).filter(r=>r.s),jobs=[];
    roots.forEach(({row:r,s},ri)=>{for(let seed=0;seed<4;seed++)for(const action of [s.baselineAction,...M.alternatives(s).map(a=>a.action)])
      jobs.push({id:r.matchUrlId,seat:r.candidateSeat,frame:s.frame,action,rootIndex:ri,suffix:seed,eventFrom:s.frame,eventSeed:parseInt(M.hash('suffix:'+name+':'+r.matchUrlId+':'+seed).slice(0,8),16),keepEvents:true});});
    const played=await stage(name+'-branches',jobs);
    const records=roots.map(({row:r,s})=>({map:r.matchUrlId,seat:r.candidateSeat,snapshot:s,labels:[]}));
    for(let ri=0;ri<roots.length;ri++){
      const {row:original,s}=roots[ri],branches=played.filter(r=>r.job.rootIndex===ri);
      const baseline=branches.filter(r=>r.job.action===s.baselineAction);
      for(const r of branches){assert.equal(r.candidateEngine.forceApplied,1);assert.ok(prefixMatches(original,r,s.frame,r.job.action),'BRANCH_PREFIX_DRIFT');
        const b=baseline.find(b=>b.job.suffix===r.job.suffix);assert.ok(b);
        // Both agents select their simultaneous commands before same-frame RNG.
        assert.equal(Buffer.from(r.control.compactActionStream,'base64')[s.frame],Buffer.from(b.control.compactActionStream,'base64')[s.frame]);
        const events=new Map(b.events.map(e=>[`${e.frame}:${e.family}:${e.actor}`,e.value]));
        for(const e of r.events){const v=events.get(`${e.frame}:${e.family}:${e.actor}`);if(v!==undefined)assert.equal(e.value,v);}
      }
      for(const action of [s.baselineAction,...M.alternatives(s).map(a=>a.action)]){
        const arm=branches.filter(r=>r.job.action===action);assert.equal(arm.length,4);
        records[ri].labels.push({action,points:arm.reduce((n,r)=>n+M.score(r),0)/4,
          delta:arm.reduce((n,r)=>n+M.score(r)-M.score(baseline.find(b=>b.job.suffix===r.job.suffix)),0)/4,
          deathDelta:arm.reduce((n,r)=>n+singleDeath(r)-singleDeath(baseline.find(b=>b.job.suffix===r.job.suffix)),0)/4,
          fourFrameDeaths:arm.reduce((n,r)=>n+Number(r.deathWithinFour),0),
          perSuffix:arm.map(r=>({suffix:r.job.suffix,points:M.score(r),death:singleDeath(r),fourFrameDeath:r.deathWithinFour}))});
      }
    }
    save(path.join(out,name+'-labels.json'),records);return {records,captures:captures.length,roots:roots.length,branches:played.length,unavailable:captures.length-roots.length};
  }
  const training=await labels('R113',splits.train);
  const examples=training.records.flatMap(r=>M.alternatives(r.snapshot).map(a=>({map:r.map,x:M.features(r.snapshot,a),delta:r.labels.find(l=>l.action===a.action).delta})));
  const model=M.fit(examples);save(path.join(out,'training-model.json'),model);
  finish('R113',{status:'COMPLETE',...withoutRecords(training),examples:examples.length,trainingMaps:model.maps});
  const calibration=await labels('R114',splits.calibration);M.calibrate(model,calibration.records);
  const modelFile=path.join(out,'frozen-model.json');save(modelFile,model);
  finish('R114',{status:model.acceptedBins.length?'CALIBRATED_BINS_FOUND':'NO_SUPPORTED_INTERVENTION_BIN',...withoutRecords(calibration),calibration:model.calibration,acceptedBins:model.acceptedBins,modelHash:digest(modelFile)});
  const held=await labels('R115',splits.test);
  const singleStep={};for(const mode of ['gated','ungated']){
    const effects=held.records.map(r=>{const c=M.choose(r.snapshot,model,mode==='gated'),l=c?r.labels.find(l=>l.action===c.row.action):null;return {map:r.map,delta:l?.delta||0,changed:!!c};});
    singleStep[mode]={...M.interval(effects),interventions:effects.filter(e=>e.changed).length};
  }
  const riskBuckets=Array.from({length:5},(_,i)=>({range:[i/5,(i+1)/5],roots:0,expected:0,observed:0,trials:0}));let sse=0,nullSse=0,n=0;
  for(const r of held.records)for(const l of r.labels){const row=r.snapshot.rows.find(x=>x.action===l.action);const p=Math.min(1,row.future/10000),b=riskBuckets[Math.min(4,Math.floor(p*5))];
    b.roots++;b.expected+=p*4;b.observed+=l.fourFrameDeaths;b.trials+=4;
    for(const x of l.perSuffix){sse+=(p-Number(x.fourFrameDeath))**2;nullSse+=Number(x.fourFrameDeath);n++;}}
  const predictionErrors=held.records.flatMap(r=>M.alternatives(r.snapshot).map(a=>{const y=r.labels.find(l=>l.action===a.action).delta,p=M.predict(model,M.features(r.snapshot,a));return {error:(p-y)**2,null:y*y};}));
  finish('R115',{status:'COMPLETE',...withoutRecords(held),singleStep,riskBuckets,
    rawFutureScoreBrierAgainstAnyFourFrameDeath:sse/Math.max(1,n),alwaysZeroBrier:nullSse/Math.max(1,n),
    riskLabelCaveat:'Forecast is a conservative model score; label is any own death within four frames under baseline continuation, not specifically future-fire death. This checks compatibility, not source-specific probability calibration.',
    advantageMSE:predictionErrors.reduce((n,r)=>n+r.error,0)/predictionErrors.length,zeroAdvantageMSE:predictionErrors.reduce((n,r)=>n+r.null,0)/predictionErrors.length});
  async function arms(name,scenes,settings,modes=['baseline','gated','ungated','aligned','R29']){
    const results={};for(const mode of modes){const jobs=jobsFor(scenes).map(j=>({...j,...settings(j)}));results[mode]=await stage(name+'-'+mode,jobs,mode,['gated','ungated'].includes(mode)?modelFile:null);}
    return results;
  }
  const r116=await arms('R116',splits.test,()=>({}),['baseline','gated','ungated','R29']);
  for(const r of r116.baseline)assert.deepEqual(semantic(r),semantic(baselineIndex.get(key(r))));
  finish('R116',{status:'COMPLETE',comparisons:Object.fromEntries(['gated','ungated','R29'].map(k=>[k,compare(r116.baseline,r116[k])]))});
  const aligned=await stage('R117-aligned',jobsFor(splits.test),'aligned');
  finish('R117',{status:'COMPLETE',comparison:compare(r116.baseline,aligned),ownChanceCollapsed:aligned.reduce((n,r)=>n+r.audit.ownChanceCollapsed,0),terminalCalls:aligned.reduce((n,r)=>n+r.audit.terminalCalls,0),limitation:'Alignment to the local simulator only; enumeration changes work allocation at the same search budget.'});
  const seeded=j=>({seed:parseInt(M.hash('newseed399:'+j.id).slice(0,8),16)});
  const r118=await arms('R118',splits.test,seeded);
  finish('R118',{status:'COMPLETE',comparisons:Object.fromEntries(['gated','ungated','aligned','R29'].map(k=>[k,compare(r118.baseline,r118[k])]))});
  const r119=await arms('R119',splits.test,j=>({eventFrom:0,eventSeed:parseInt(M.hash('event399:'+j.id).slice(0,8),16)}));
  finish('R119',{status:'COMPLETE_SENSITIVITY_ONLY',comparisons:Object.fromEntries(['gated','ungated','aligned','R29'].map(k=>[k,compare(r119.baseline,r119[k])]))});
  const r120=await arms('R120',splits.confirmation,seeded);
  finish('R120',{status:'COMPLETE',comparisons:Object.fromEntries(['gated','ungated','aligned','R29'].map(k=>[k,compare(r120.baseline,r120[k])])),
    versusOldR29:Object.fromEntries(['gated','ungated','aligned'].map(k=>[k,compare(r120.R29,r120[k])]))});
  assert.equal(rounds.length,10);assert.equal(productionTreeSha256(root),tree);assert.equal(digest(modelFile),rounds[3].modelHash);
  for(const [f,h]of Object.entries(sources))assert.equal(digest(path.join(root,f)),h);
  const summary={status:'TEN_ROUNDS_COMPLETE',rounds,stages,executedGames:games,seconds:(Date.now()-started)/1000,
    productionUnchanged:true,modelFrozenBeforeTest:true,errors:0,timeouts:0,rootRestoreFailures:0,
    recommendation:'Evaluate qualification from R118 and R120 jointly; do not adopt on discovery or single-step hindsight gains.'};
  save(path.join(out,'rounds.json'),summary);log({status:summary.status,games,seconds:summary.seconds});
}
function withoutRecords(x){const {records,...rest}=x;return rest;}
if(!isMainThread)workerRun().catch(e=>{throw e;});
else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={compare,ROUND_PLAN};
