'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const D=require('./hotspot-performance-design');
const read=f=>JSON.parse(fs.readFileSync(f)),sha=f=>D.hash(fs.readFileSync(f));
function save(f,x){const s=JSON.stringify(x,null,2)+'\n';if(fs.existsSync(f))assert.equal(fs.readFileSync(f,'utf8'),s,'IMMUTABLE_ARTIFACT_DRIFT:'+f);else fs.writeFileSync(f,s,{flag:'wx'});}
async function run(root,out){
 const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const tree=arena.productionTreeSha256(root),expected=read(path.join(root,'artifacts/native-causal-audit/bp405-semantic-performance-hundred-rounds/summary.json'));
 assert.equal(expected.productionUnchanged,true);assert.equal(tree,'285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120');
 assert.equal(process.version,'v24.16.0');const event=await require('./strategic-event-simulator').load(root),methods=D.compile(root);
 const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/scenarios.json.gz'))));
 const prior=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp404-completed-layer-hundred-rounds/scenarios.json.gz'))));
 const seen=new Set(),unique=xs=>xs.filter(s=>{const h=D.hash(JSON.stringify(s.map));if(seen.has(h))return false;seen.add(h);return true;});
 const hist=unique(historical),synth=unique(prior.filter(s=>s.origin==='synthetic'));let hi=400,si=80;
 const scenes=Array.from({length:100},(_,i)=>i%3===0?{...hist[hi++],origin:'historical-reuse'}:{...synth[si++],origin:'synthetic-reuse'});
 const preScenes=[hist[500],synth[150],hist[501],synth[151]];assert.ok(preScenes.every(Boolean));
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'sources'),{recursive:true});
 const files=['hotspot-performance-design.js','semantic-performance-design.js','hotspot-performance-profile.js','hotspot-performance-loop.js','hotspot-performance-audit.py','strategic-event-simulator.js','deterministic-v1-clock.js','native-base-policy-standalone-arena.js','continuous-improvement-design.js','strategic-improvement-model.js'].map(f=>'tools/agentank/diagnostics/'+f).concat('test/minimax-core/hotspot-performance-loop.test.js');
 const profile=read(path.join(out,'profile/profile-summary.json'));assert.equal(profile.productionTree,tree);assert.ok(profile.top[0].location.includes('reverseViable')&&profile.top[0].nativeSampleShare>.20);
 const sourceHashes=Object.fromEntries(files.map(f=>[f,sha(path.join(root,f))]));
 for(const file of files){const dest=path.join(out,'sources',path.basename(file));if(!fs.existsSync(dest))fs.copyFileSync(path.join(root,file),dest);assert.equal(sha(dest),sourceHashes[file]);}
 const protocol={version:'BP406_PROFILE_GUIDED_PERFORMANCE_V1',rounds:100,roundNumbers:[721,820],batchSize:10,discoveryRounds:70,confirmationRounds:30,
  roundDefinition:'One fixed reused terrain/seat/RNG seed, two serial complete-game repetitions per active mode in rotating palindromic order; measure candidate decision time only.',
  sourceHashes,productionTree:tree,node:process.version,adapter:event.identity,scenarios:scenes.map(s=>({id:s.matchUrlId,origin:s.origin,terrain:D.hash(JSON.stringify(s.map))})),
  catalogue:{'lazy-forward':'Skip pure forward-cell calculation after HOLD/turn already establishes viability.','lazy-parity':'Same lazy-forward mechanism plus direct four-pose copy on odd ticks, preserving the original terrain/lethal mask and all cached layers.'},
  admission:{profileSummarySha256:sha(path.join(out,'profile/profile-summary.json')),profileSha256:sha(path.join(out,'profile/baseline.cpuprofile')),nativeHotspotShare:profile.top[0].nativeSampleShare,pilotCases:4,pilotRule:'Admit only if four-case geometric time ratio <= .98 and all complete games are behavior-identical. Pilot maps are excluded from formal rounds; pilot timing is never pooled into confirmation.'},
  evaluationRules:'At 20 rounds retire if lower ratio CI > 1.05; at 40 retire if ratio >= .99 and lower CI > .95. Freeze lowest-ratio remaining candidate at 70. No family resurrection or parameter retuning. Empty active list means reference noise audit.',
  qualification:'Fixed last 30 rounds: geometric ratio <= .95, 95% bootstrap upper <1, round-ratio p95 <=1.10, both origin and RNG strata n>=6 with ratio<1, full-game exact semantics, and baseline repeat geometric ratio within [0.95,1.05].',
  bootstrap:'2000 deterministic round-level paired log-ratio resamples; exploratory/local intervals, not platform/general-workload guarantees.',
  limits:'All maps reused from prior research. No new independent win-rate evidence. Local Node serial timing, no platform budget certification. Production defaults, Hard and finalGate unchanged.',
  preflight:'8 cases x baseline and both variants. Every candidate reverseViable call shadow-checks the scalar and all hazard own fields against the original method on an exact pre-call clone; no shadow allocations in timed games. Nine additional warmup games; 24 pilot games.'};
 save(path.join(out,'protocol.json'),protocol);save(path.join(out,'scenarios.json'),{formal:scenes,preflight:preScenes});
 const original=Bot.prototype.decide,enemy=V3DiagnosticBot.prototype.decide;let current,audit;
 const {HazardKernel}=require('../../../engine-v2/src/fast/hazard'),originalReverse=HazardKernel.prototype.reverseViable;
 const shadowMethods=Object.fromEntries(D.MODES.map(mode=>[mode,function(...args){const oracle=D.cloneHazard(this);const value=methods[mode].apply(this,args),expected=originalReverse.apply(oracle,args);assert.equal(value,expected,'HAZARD_RESULT_DRIFT');D.verifyHazard(this,oracle);audit.shadowHazards++;return value;}]));
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 Bot.prototype.decide=function(...args){
  const begin=process.hrtime.bigint();try{return original.apply(this,args);}finally{audit.decisionTimesMs.push(Number(process.hrtime.bigint()-begin)/1e6);}
 };
 Bot.prototype.captureRoot=function(){const e=this.engine;if(this.searchEvidenceCurrent){const row=e.lastProposalRow;if(row>=0){assert.equal(e.hardStatus[row],0);assert.equal(e.basePolicy.owner.allowedRow[row],1);audit.ownerChecks++;}}
  if(e.lastSelectedRow>=0){assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,e.lastSelectedRow,e.ourCount));audit.finalGateChecks++;}};
 function intact(){assert.equal(arena.productionTreeSha256(root),tree);for(const [f,h]of Object.entries(sourceHashes))assert.equal(sha(path.join(root,f)),h);}
 async function game(scene,job){current=job;audit={decisionTimesMs:[],shadowHazards:0,ownerChecks:0,finalGateChecks:0};
  HazardKernel.prototype.reverseViable=job.mode==='baseline'?originalReverse:job.shadow?shadowMethods[job.mode]:methods[job.mode];
  const row=await arena.play(event.wrap(job,()=>{}),scene,job.seat,true);
  for(const side of [row.candidate,row.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}assert.equal(row.candidateEngine.rootRestoreFailures,0);assert.equal(row.candidateEngine.hotAllocations,0);
  delete row.candidateEngine.rootFrames;delete row.control.actionFrames;row.audit=audit;row.job=job;row.decisionMs=audit.decisionTimesMs.reduce((s,x)=>s+x,0);return row;
 }
 async function stage(name,scene,jobs){const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});save(path.join(dir,'jobs.json'),jobs);
  const checkpoint=path.join(dir,'checkpoint.ndjson'),rows=[];if(fs.existsSync(checkpoint))for(const line of fs.readFileSync(checkpoint,'utf8').trim().split('\n').filter(Boolean)){const e=JSON.parse(line);assert.equal(D.hash(e.payload),e.sha256);rows.push(JSON.parse(e.payload));}
  for(let i=0;i<rows.length;i++)assert.deepEqual(rows[i].job,jobs[i]);
  for(let i=rows.length;i<jobs.length;i++){const r=await game(scene,jobs[i]);rows.push(r);const payload=JSON.stringify(r);fs.appendFileSync(checkpoint,JSON.stringify({payload,sha256:D.hash(payload)})+'\n');}
  assert.equal(rows.length,jobs.length);for(const r of rows)assert.equal(D.signature(r),D.signature(rows[0]),'FULL_GAME_BEHAVIOR_DRIFT:'+name);
  return rows;
 }
 let preflight=[];for(let i=0;i<8;i++){const seed=406200+i;preflight.push(...await stage('preflight-'+i,preScenes[i%4],['baseline',...D.MODES].map(mode=>({mode,seed,seat:Math.floor(i/4),shadow:mode!=='baseline',...(i%2?{eventFrom:0,eventSeed:seed}:{})}))));}
 // Warmup is repeated on resume, but never enters formal statistics.
 for(let i=0;i<3;i++)for(const mode of ['baseline',...D.MODES])await game(preScenes[i],{mode,seed:406900+i,seat:i%2,shadow:false});
 save(path.join(out,'preflight.json'),{games:preflight.length,pairedCases:8,shadowHazards:preflight.reduce((n,r)=>n+r.audit.shadowHazards,0),exact:true,warmupGamesPerInvocation:9});
 const pilotScenes=[{...hist[502],origin:'historical-reuse'},{...synth[152],origin:'synthetic-reuse'},{...hist[503],origin:'historical-reuse'},{...synth[153],origin:'synthetic-reuse'}],pilot=[];
 save(path.join(out,'pilot-scenarios.json'),pilotScenes);
 for(let i=0;i<4;i++){const seed=406500+i,order=i%2?['lazy-parity','lazy-forward','baseline','baseline','lazy-forward','lazy-parity']:['baseline','lazy-forward','lazy-parity','lazy-parity','lazy-forward','baseline'];
  const rows=await stage('pilot-'+i,pilotScenes[i],order.map((mode,rep)=>({mode,rep,seed,seat:Math.floor(i/2),env:i%2?'event':'original',shadow:false,...(i%2?{eventFrom:0,eventSeed:seed}:{})})));
  const sum=mode=>rows.filter(r=>r.job.mode===mode).reduce((n,r)=>n+r.decisionMs,0);pilot.push(Object.fromEntries(D.MODES.map(m=>[m,sum(m)/sum('baseline')])));
 }
 const pilotEvidence=Object.fromEntries(D.MODES.map(m=>[m,D.stats(pilot.map(r=>r[m]))])),admitted=D.MODES.filter(m=>pilotEvidence[m].ratio<=.98);
 save(path.join(out,'admission.json'),{profileSummarySha256:protocol.admission.profileSummarySha256,pilotRatios:pilot,pilotEvidence,admitted,games:24,exact:true});
 console.log(JSON.stringify({phase:'ADMISSION',pilotEvidence,admitted}));
 let active=admitted,history=[],evaluations=[],allGames=48;
 for(let batch=1;batch<=10;batch++){
  intact();save(path.join(out,`batch-${batch}-plan.json`),{batch,active,phase:batch<=7?'DISCOVERY':'LOCKED_CONFIRMATION',priorEvaluationHash:batch===1?null:sha(path.join(out,`batch-${batch-1}-evaluation.json`))});
  for(let k=0;k<10;k++){
   const i=(batch-1)*10+k,round=721+i,scene=scenes[i],seed=parseInt(D.hash('BP406:'+scene.matchUrlId).slice(0,8),16),env=i%2?'event':'original';
   let order=['baseline',...active];const rotate=i%order.length;order=order.slice(rotate).concat(order.slice(0,rotate));order=order.concat(order.slice().reverse());
   const jobs=order.map((mode,rep)=>({round,batch,mode,rep,seed,seat:Math.floor(i/2)%2,env,origin:scene.origin,id:scene.matchUrlId,shadow:false,...(env==='event'?{eventFrom:0,eventSeed:seed}:{})}));
   const rows=await stage('R'+round,scene,jobs);allGames+=rows.length;
   const timing=Object.fromEntries(['baseline',...active].map(mode=>[mode,rows.filter(r=>r.job.mode===mode).map(r=>r.decisionMs)]));
   const avg=xs=>xs.reduce((n,x)=>n+x,0)/xs.length,ratios=Object.fromEntries(active.map(m=>[m,avg(timing[m])/avg(timing.baseline)]));
   const record={round,batch,id:scene.matchUrlId,env,origin:scene.origin,seat:jobs[0].seat,games:rows.length,exact:true,timing,ratios,baselineRepeatRatio:timing.baseline[1]/timing.baseline[0],semanticSha256:D.hash(D.signature(rows[0]))};
   save(path.join(out,'R'+round+'.json'),record);history.push(record);
  }
  const evidence=Object.fromEntries(active.map(m=>[m,D.stats(history.filter(r=>r.ratios[m]!==undefined).map(r=>r.ratios[m]))]));
  const next=batch<=7?D.choose(batch,active,evidence):{active,retired:[],decision:'COMPLETE_LOCKED_CONFIRMATION'};
  const evaluation={batch,completedRounds:batch*10,active,evidence,baselineNoise:D.stats(history.slice(-10).map(r=>r.baselineRepeatRatio)),...next,measuredModes:active};
  save(path.join(out,`batch-${batch}-evaluation.json`),evaluation);evaluations.push(evaluation);active=next.active;
  require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/hotspot-performance-audit.py'),out,'--batch',String(batch)],{stdio:'pipe'});
  console.log(JSON.stringify({batch,rounds:batch*10,active,decision:next.decision,evidence}));
 }
 intact();const confirmation=history.slice(70),noise=D.stats(confirmation.map(r=>r.baselineRepeatRatio)),final=Object.fromEntries(active.map(m=>[m,D.qualify(confirmation,m)]));
 for(const v of Object.values(final)){v.baselineRepeatNoiseAcceptable=noise.ratio>=.95&&noise.ratio<=1.05;v.qualified=v.qualified&&v.baselineRepeatNoiseAcceptable;}
 const summary={status:'ONE_HUNDRED_ROUNDS_COMPLETE',rounds:100,roundNumbers:[721,820],batches:10,formalGames:history.reduce((n,r)=>n+r.games,0),preflightGames:24,pilotGames:24,profileGames:32,profileWarmupGames:4,warmupGamesPerInvocation:9,totalPersistedGames:allGames,
  candidateComparisonRounds:history.filter(r=>Object.keys(r.ratios).length).length,referenceOnlyRounds:history.filter(r=>!Object.keys(r.ratios).length).length,exactBehavior:true,preflight:read(path.join(out,'preflight.json')),evaluations,final,confirmationBaselineNoise:noise,
  qualifiedDiagnostic:Object.keys(final).filter(m=>final[m].qualified),productionTree:tree,productionUnchanged:true,productionAdoption:false,
  conclusion:Object.values(final).some(v=>v.qualified)?'LOCAL_SPEED_CANDIDATE_RETAINED_REQUIRES_TARGET_RUNTIME_VALIDATION':'NO_QUALIFIED_SPEEDUP_KEEP_PRODUCTION',
  admission:read(path.join(out,'admission.json')),nextWorkflow:'Retain only supported hotspot implementations for target-runtime validation. Keep profile admission, small pilot and fixed confirmation; do not reopen retired micro-optimizations or infer win-rate gain from timing.',
  limitations:protocol.limits};
 HazardKernel.prototype.reverseViable=originalReverse;
 save(path.join(out,'summary.json'),summary);require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/hotspot-performance-audit.py'),out],{stdio:'inherit'});console.log(JSON.stringify(summary));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={run};
