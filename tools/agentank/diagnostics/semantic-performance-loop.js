'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const D=require('./semantic-performance-design');
const read=f=>JSON.parse(fs.readFileSync(f)),sha=f=>D.hash(fs.readFileSync(f));
function save(f,x){const s=JSON.stringify(x,null,2)+'\n';if(fs.existsSync(f))assert.equal(fs.readFileSync(f,'utf8'),s,'IMMUTABLE_ARTIFACT_DRIFT:'+f);else fs.writeFileSync(f,s,{flag:'wx'});}
async function run(root,out){
 const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const tree=arena.productionTreeSha256(root),expected=read(path.join(root,'artifacts/native-causal-audit/bp404-completed-layer-hundred-rounds/summary.json'));
 assert.equal(expected.productionUnchanged,true);assert.equal(tree,'285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120');
 assert.equal(process.version,'v24.16.0');const event=await require('./strategic-event-simulator').load(root),classes=D.compile(root);
 const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/scenarios.json.gz'))));
 const prior=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp404-completed-layer-hundred-rounds/scenarios.json.gz'))));
 const seen=new Set(),unique=xs=>xs.filter(s=>{const h=D.hash(JSON.stringify(s.map));if(seen.has(h))return false;seen.add(h);return true;});
 const hist=unique(historical),synth=unique(prior.filter(s=>s.origin==='synthetic'));let hi=0,si=0;
 const scenes=Array.from({length:100},(_,i)=>i%3===0?{...hist[hi++],origin:'historical-reuse'}:{...synth[si++],origin:'synthetic-reuse'});
 const preScenes=[hist[34],synth[66],hist[35],synth[67]];assert.ok(preScenes.every(Boolean));
 fs.mkdirSync(out,{recursive:true});fs.mkdirSync(path.join(out,'sources'),{recursive:true});
 const files=['semantic-performance-design.js','semantic-performance-loop.js','semantic-performance-audit.py','strategic-event-simulator.js','deterministic-v1-clock.js','native-base-policy-standalone-arena.js','continuous-improvement-design.js','strategic-improvement-model.js'].map(f=>'tools/agentank/diagnostics/'+f).concat('test/minimax-core/semantic-performance-loop.test.js');
 const sourceHashes=Object.fromEntries(files.map(f=>[f,sha(path.join(root,f))]));
 for(const file of files){const dest=path.join(out,'sources',path.basename(file));if(!fs.existsSync(dest))fs.copyFileSync(path.join(root,file),dest);assert.equal(sha(dest),sourceHashes[file]);}
 const protocol={version:'BP405_SERIAL_SEMANTIC_PERFORMANCE_V1',rounds:100,roundNumbers:[621,720],batchSize:10,discoveryRounds:70,confirmationRounds:30,
  roundDefinition:'One fixed reused terrain/seat/RNG seed, two serial complete-game repetitions per active mode in rotating palindromic order; measure candidate decision time only.',
  sourceHashes,productionTree:tree,node:process.version,adapter:event.identity,scenarios:scenes.map(s=>({id:s.matchUrlId,origin:s.origin,terrain:D.hash(JSON.stringify(s.map))})),
  catalogue:{'bulk-terrain':'TypedArray.set for exact live terrain prefix; temporary subarray view allocations permitted and disclosed.','direct-bfs':'Hoist geometry check and terrain lookup out of star BFS neighbor loop; preserve geometry fallback and wall/dirt blocking.'},
  evaluationRules:'At 20 rounds retire if lower ratio CI > 1.05; at 40 retire if ratio >= .99 and lower CI > .95. Freeze lowest-ratio remaining candidate at 70. No family resurrection or parameter retuning. Empty active list means reference noise audit.',
  qualification:'Fixed last 30 rounds: geometric ratio <= .95, 95% bootstrap upper <1, round-ratio p95 <=1.10, both origin and RNG strata n>=6 with ratio<1, full-game exact semantics, and baseline repeat geometric ratio within [0.95,1.05].',
  bootstrap:'2000 deterministic round-level paired log-ratio resamples; exploratory/local intervals, not platform/general-workload guarantees.',
  limits:'All maps reused from prior research. No new independent win-rate evidence. Local Node serial timing, no platform budget certification. Production defaults, Hard and finalGate unchanged.',
  preflight:'8 cases x baseline and both variants, scalar and all six leaf components shadow-checked; discarded timing. 9 additional unshadowed warmup games.'};
 save(path.join(out,'protocol.json'),protocol);save(path.join(out,'scenarios.json'),{formal:scenes,preflight:preScenes});
 const original=Bot.prototype.decide,enemy=V3DiagnosticBot.prototype.decide;let current,audit;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 Bot.prototype.decide=function(...args){
  if(!this.bp405Installed){this.bp405Installed=true;const s=this.engine.basePolicy.policySearch;
   if(current.mode!=='baseline')s.leafEvaluator=new classes[current.mode]();
   if(current.shadow){const leaf=s.leafEvaluator,reference=new classes.baseline(),begin=leaf.beginRoot.bind(leaf),evaluate=leaf.evaluate.bind(leaf),build=leaf.buildStarField.bind(leaf);
    leaf.beginRoot=function(state){audit.rootCalls++;reference.beginRoot(state);return begin(state);};
    leaf.buildStarField=function(...a){audit.fieldBuilds++;return build(...a);};
    leaf.evaluate=function(state){const value=evaluate(state),components=Array.from(leaf.lastComponents),other=reference.evaluate(state);assert.equal(value,other,'LEAF_VALUE_DRIFT');assert.deepEqual(components,Array.from(reference.lastComponents),'LEAF_COMPONENT_DRIFT');audit.shadowLeaves++;return value;};
   }
  }
  const begin=process.hrtime.bigint();try{return original.apply(this,args);}finally{audit.decisionTimesMs.push(Number(process.hrtime.bigint()-begin)/1e6);}
 };
 Bot.prototype.captureRoot=function(){const e=this.engine;if(this.searchEvidenceCurrent){const row=e.lastProposalRow;if(row>=0){assert.equal(e.hardStatus[row],0);assert.equal(e.basePolicy.owner.allowedRow[row],1);audit.ownerChecks++;}}
  if(e.lastSelectedRow>=0){assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,e.lastSelectedRow,e.ourCount));audit.finalGateChecks++;}};
 function intact(){assert.equal(arena.productionTreeSha256(root),tree);for(const [f,h]of Object.entries(sourceHashes))assert.equal(sha(path.join(root,f)),h);}
 async function game(scene,job){current=job;audit={decisionTimesMs:[],shadowLeaves:0,rootCalls:0,fieldBuilds:0,ownerChecks:0,finalGateChecks:0};
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
 let preflight=[];for(let i=0;i<8;i++){const seed=405000+i;preflight.push(...await stage('preflight-'+i,preScenes[i%4],['baseline',...D.MODES].map(mode=>({mode,seed,seat:Math.floor(i/4),shadow:mode!=='baseline',...(i%2?{eventFrom:0,eventSeed:seed}:{})}))));}
 // Warmup is repeated on resume, but never enters formal statistics.
 for(let i=0;i<3;i++)for(const mode of ['baseline',...D.MODES])await game(preScenes[i],{mode,seed:405900+i,seat:i%2,shadow:false});
 save(path.join(out,'preflight.json'),{games:preflight.length,pairedCases:8,shadowLeaves:preflight.reduce((n,r)=>n+r.audit.shadowLeaves,0),rootCalls:preflight.reduce((n,r)=>n+r.audit.rootCalls,0),fieldBuilds:preflight.reduce((n,r)=>n+r.audit.fieldBuilds,0),exact:true,warmupGamesPerInvocation:9});
 let active=[...D.MODES],history=[],evaluations=[],allGames=24;
 for(let batch=1;batch<=10;batch++){
  intact();save(path.join(out,`batch-${batch}-plan.json`),{batch,active,phase:batch<=7?'DISCOVERY':'LOCKED_CONFIRMATION',priorEvaluationHash:batch===1?null:sha(path.join(out,`batch-${batch-1}-evaluation.json`))});
  for(let k=0;k<10;k++){
   const i=(batch-1)*10+k,round=621+i,scene=scenes[i],seed=parseInt(D.hash('BP405:'+scene.matchUrlId).slice(0,8),16),env=i%2?'event':'original';
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
  require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/semantic-performance-audit.py'),out,'--batch',String(batch)],{stdio:'pipe'});
  console.log(JSON.stringify({batch,rounds:batch*10,active,decision:next.decision,evidence}));
 }
 intact();const confirmation=history.slice(70),noise=D.stats(confirmation.map(r=>r.baselineRepeatRatio)),final=Object.fromEntries(active.map(m=>[m,D.qualify(confirmation,m)]));
 for(const v of Object.values(final)){v.baselineRepeatNoiseAcceptable=noise.ratio>=.95&&noise.ratio<=1.05;v.qualified=v.qualified&&v.baselineRepeatNoiseAcceptable;}
 const summary={status:'ONE_HUNDRED_ROUNDS_COMPLETE',rounds:100,roundNumbers:[621,720],batches:10,formalGames:history.reduce((n,r)=>n+r.games,0),preflightGames:24,warmupGamesPerInvocation:9,totalPersistedGames:allGames,
  candidateComparisonRounds:history.filter(r=>Object.keys(r.ratios).length).length,referenceOnlyRounds:history.filter(r=>!Object.keys(r.ratios).length).length,exactBehavior:true,preflight:read(path.join(out,'preflight.json')),evaluations,final,confirmationBaselineNoise:noise,
  qualifiedDiagnostic:Object.keys(final).filter(m=>final[m].qualified),productionTree:tree,productionUnchanged:true,productionAdoption:false,
  conclusion:Object.values(final).some(v=>v.qualified)?'LOCAL_SPEED_CANDIDATE_RETAINED_REQUIRES_TARGET_RUNTIME_VALIDATION':'NO_QUALIFIED_SPEEDUP_KEEP_PRODUCTION',
  nextWorkflow:'Stop these finite implementation families if unqualified. Obtain representative decision traces and profile actual leaf/search cost before the next performance hypothesis. Seek genuinely new platform data before renewed win-rate tuning.',
  limitations:protocol.limits};
 save(path.join(out,'summary.json'),summary);require('node:child_process').execFileSync('python3',[path.join(root,'tools/agentank/diagnostics/semantic-performance-audit.py'),out],{stdio:'inherit'});console.log(JSON.stringify(summary));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={run};
