'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict'),Module=require('node:module');
const D=require('./semantic-performance-design'),M=require('./strategic-improvement-model');
const read=f=>JSON.parse(fs.readFileSync(f));
function save(f,x){fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n',{flag:'wx'});}
function budgetSource(s){const needle='Math.max(12, Math.trunc(128 /';assert.equal(s.split(needle).length,2);return s.replace(needle,'Math.max(12, Math.trunc(this.diagnosticRootBudget /');}
function classify(r){const allowed=r.rows.filter(x=>x.hardAllowed&&x.finalAllowed);if(allowed.length<2)return 'NO_ALTERNATIVE_WITHIN_HARD_AND_FINAL';if(!r.searchActive)return r.resourceOwned?'RESOURCE_OWNED':'SEARCH_NOT_ENTERED:'+r.searchEntry;return r.budgetLeaves>0?'SEARCH_WITH_BUDGET_LEAVES':'SEARCH_WITHOUT_BUDGET_LEAVES';}
function chooseCrossfit(actions,selectionScores,baseline){return actions.slice().sort((a,b)=>selectionScores[b]-selectionScores[a]||Number(b===baseline)-Number(a===baseline)||a-b)[0];}
async function run(root,out){
 fs.mkdirSync(out,{recursive:true});const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state'),{ACTION}=require('../../../engine-v2/src/abi/fast-codes');
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock'),{prefixMatches}=require('./native-base-policy-root-action-counterfactual');
 const event=await require('./strategic-event-simulator').load(root),tree=arena.productionTreeSha256(root);
 const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated'),scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz'))));
 const sceneMap=new Map(scenes.map(s=>[s.matchUrlId,s]));
 const refs=z.gunzipSync(fs.readFileSync(path.join(base,'matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse),seen=new Set(),selected=[];
 const specs=[['bomb-loss',4,r=>r.analysisOutcome==='V1_WIN'&&r.counts.v2CrashCause==='BOMB'],['projectile-or-collision-loss',4,r=>r.analysisOutcome==='V1_WIN'&&r.counts.v2CrashCause==='PROJECTILE_OR_COLLISION'],['star-loss',4,r=>r.analysisOutcome==='V1_WIN'&&r.terminalCategory==='FRAME_LIMIT_STARS'],['draw-control',2,r=>r.analysisOutcome==='DRAW'],['win-control',2,r=>r.analysisOutcome==='V2_WIN']];
 for(const [stratum,n,pred]of specs){let count=0;for(const r of refs.filter(pred).sort((a,b)=>D.hash('bp407:'+a.matchUrlId+':'+a.candidateSeat).localeCompare(D.hash('bp407:'+b.matchUrlId+':'+b.candidateSeat)))){const terrain=D.hash(JSON.stringify(sceneMap.get(r.matchUrlId).map));if(seen.has(terrain))continue;seen.add(terrain);selected.push({stratum,reference:r,scene:sceneMap.get(r.matchUrlId)});if(++count===n)break;}assert.equal(count,n);}
 const file=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js'),mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(budgetSource(fs.readFileSync(file,'utf8')),file);const prepared=mod.exports.NativeBasePolicySearch.prototype.prepare;
 const protocol={version:'BP407_BOTTLENECK_DIAGNOSIS_V1',productionTree:tree,sourceSha256:D.hash(fs.readFileSync(__filename)),cases:16,strata:specs.map(([name,count])=>({name,count})),
  stateSelection:'One fixed baseline state closest to six frames before crash; frame 64 for frame-limit results. No selection by observed intervention gain. Distinct terrain per case.',
  nominalBudgets:[64,128,256,512],budgetRepeats:2,budgetScope:'Change row budget only at the captured decision; all other decisions use production. These are nominal search targets, not hard total-node or wall-clock caps.',
  counterfactual:'All distinct actions allowed by both physical Hard and finalGate at the chosen state, excluding teleport/none. Owner exclusions are recorded, not enforced in this diagnostic. Only one action is overridden.',
  suffixSeeds:8,selectionSeeds:[0,1,2,3],validationSeeds:[4,5,6,7],maximumGames:1100,
  comparison:'Exact baseline prefixes and physical state excluding TANK_RUNTIME; event-keyed suffix starts at intervention. Baseline continuation after one intervention. Actual original RNG run retained separately.',
  limits:'Outcome-stratified reused historical cases, not population win-rate evidence. Crossfit chosen actions are diagnostic hindsight references, not deployable policies. Budget timings are exploratory, not CPU-matched performance claims.'};
 save(path.join(out,'protocol.json'),protocol);save(path.join(out,'cohort.json'),selected.map((x,i)=>({case:i,stratum:x.stratum,id:x.reference.matchUrlId,seat:x.reference.candidateSeat,scene:x.scene,reference:x.reference})));
 let job,audit,traces,simulator,gameCount=0;
 const enemy=V3DiagnosticBot.prototype.decide;V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const decide=Bot.prototype.decide;
 Bot.prototype.decide=function(context){
  if(!this.bp407){this.bp407=true;const e=this.engine,s=e.basePolicy.policySearch,old=s.prepare.bind(s),emit=e.emit.bind(e);
   s.prepare=(...args)=>{const frame=e.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];if(job.budget&&frame===job.frame){s.diagnosticRootBudget=job.budget;const result=prepared.apply(s,args);this.searchEvidenceCurrent=Boolean(result);this.searchEntry=result?'SEARCH_PREPARED':'PREPARE_FAILED';return result;}return old(...args);};
   e.emit=(me,action)=>{const frame=e.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];if(job.action!==undefined&&frame===job.frame){audit.forceSeen++;const row=Array.from(e.ourActions).slice(0,e.ourCount).findIndex((a,i)=>a===job.action&&e.ourArguments[i]===(job.argument||0)&&e.hardStatus[i]===0&&e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,i,e.ourCount));assert.ok(row>=0,'FORCE_NOT_ALLOWED');e.lastSelectedRow=row;e.basePolicy.intent.commitSelection(job.action);audit.forceApplied++;return emit(me,job.action);}return emit(me,action);};
  }
  const result=decide.call(this,context);if(traces.length&&traces[traces.length-1].frame===context.game.frames)traces[traces.length-1].decisionMs=result.runtimeMs;return result;
 };
 Bot.prototype.captureRoot=function(context){const e=this.engine,s=e.basePolicy.policySearch,a=e.adapter.state.arrays,f=a[ARRAY.SCALAR][SCALAR.FRAME],active=this.searchEvidenceCurrent;
  audit.frames++;if(active)audit.searchFrames++;const rows=[];
  for(let row=0;row<e.ourCount;row++)rows.push({row,action:e.ourActions[row],argument:e.ourArguments[row],hardAllowed:e.hardStatus[row]===0,finalAllowed:Boolean(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,row,e.ourCount)),ownerAllowed:active?Boolean(e.basePolicy.owner.allowedRow[row]):null,membership:active?e.basePolicy.owner.membership[row]:null,value:active&&e.basePolicy.owner.membership[row]===5?e.basePolicy.owner.backedValue[row]:null,futureRisk:e.riskController.outcome.futureFireFatalMass[row],immediateRisk:e.riskController.outcome.immediateFatalMass[row]});
  const selected=e.lastSelectedRow,inc=e.lastIncumbentRow,action=selected>=0?e.ourActions[selected]:ACTION.NONE;
  const arrays=a.map(x=>Array.from(x)),physical=arrays.map((x,i)=>i===ARRAY.TANK_RUNTIME?[0,0]:x);
  if(job.capture||f===job.frame)traces.push({frame:f,rows,selected,selectedAction:action,incumbent:inc,proposal:e.lastProposalRow,searchActive:active,searchEntry:this.searchEntry,resourceOwned:inc>=0&&e.ourActions[inc]>=ACTION.CAST_SHIELD&&e.ourActions[inc]<=ACTION.CAST_BOOST&&e.ourActions[inc]!==ACTION.CAST_POISON,depth:active?s.currentDepth:0,nodes:active?s.nodes:0,budgetLeaves:active?s.lastBudgetLeafCount:0,
   state:{width:e.adapter.state.width,height:e.adapter.state.height,arrays,physicalSha256:D.hash(JSON.stringify(physical))},context:JSON.parse(JSON.stringify(context)),controlMode:e.lastControlMode});
 };
 async function play(item,j){job=j;audit={frames:0,searchFrames:0,forceSeen:0,forceApplied:0};traces=[];simulator=null;
  assert.ok(++gameCount<=protocol.maximumGames,'DIAGNOSTIC_GAME_BUDGET');const r=await arena.play(event.wrap(j,x=>simulator=x),item.scene,item.reference.candidateSeat,true);
  for(const side of [r.candidate,r.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);
  delete r.candidateEngine.rootFrames;delete r.control.actionFrames;return {job:j,row:r,audit,traces,score:M.score(r),death:Number(r.counts.crashes[item.reference.candidateSeat]>0)};
 }
 function checkpoint(stage,value){const file=path.join(out,stage+'.ndjson'),payload=JSON.stringify(value);fs.appendFileSync(file,JSON.stringify({sha256:D.hash(payload),payload})+'\n');}
 const cases=[];
 for(let i=0;i<selected.length;i++){
  const item=selected[i],r=await play(item,{case:i,capture:true});assert.equal(D.signature(r.row),D.signature(item.reference),'BASELINE_REPLAY_DRIFT');
  const crash=item.reference.terminalCategory.includes('CRASH'),target=crash?Math.max(0,item.reference.frames-7):64;
  const chosen=r.traces.slice().sort((a,b)=>Math.abs(a.frame-target)-Math.abs(b.frame-target)||a.frame-b.frame)[0];assert.ok(chosen);chosen.classification=classify(chosen);
  const traceSummary=r.traces.map(t=>({frame:t.frame,classification:classify(t),searchActive:t.searchActive,incumbent:t.incumbent,proposal:t.proposal,selected:t.selected,finalAllowed:t.rows.filter(x=>x.hardAllowed&&x.finalAllowed).length,ownerAllowed:t.searchActive?t.rows.filter(x=>x.ownerAllowed).length:null}));
  const record={case:i,stratum:item.stratum,id:item.reference.matchUrlId,seat:item.reference.candidateSeat,baseline:r.row,audit:r.audit,root:chosen,traceSummary};cases.push(record);checkpoint('baseline',record);
 }
 save(path.join(out,'failure-state-dataset.json'),{cases,classificationCounts:cases.reduce((a,r)=>(a[r.root.classification]=(a[r.root.classification]||0)+1,a),{}),reproduction:'Replay cohort.scene with deterministic V1 clock and original bomb-calibrated RNG; inspect root.frame. Serialized observable context and FastState arrays are included.'});
 console.log(JSON.stringify({stage:'failure-states',cases:cases.length,frames:cases.reduce((n,c)=>n+c.audit.frames,0)}));
 const budgetRows=[];
 for(const c of cases){const item=selected[c.case];for(const budget of protocol.nominalBudgets)for(let rep=0;rep<2;rep++){
  const result=await play(item,{case:c.case,frame:c.root.frame,budget,rep});const rootResult=result.traces.find(r=>r.frame===c.root.frame);assert.ok(rootResult);assert.equal(rootResult.state.physicalSha256,c.root.state.physicalSha256,'BUDGET_ROOT_STATE_DRIFT');assert.ok(prefixMatches(c.baseline,result.row,c.root.frame,rootResult.selectedAction));
  if(budget===128)assert.equal(D.signature(result.row),D.signature(c.baseline),'BUDGET_128_CONTROL_DRIFT');
  const compact={case:c.case,budget,rep,root:rootResult,...result};delete compact.traces;budgetRows.push(compact);checkpoint('budget',compact);
 }console.log(JSON.stringify({stage:'budget-ladder',cases:c.case+1,games:gameCount}));}
 for(const c of cases)for(const b of protocol.nominalBudgets){const r=budgetRows.filter(x=>x.case===c.case&&x.budget===b);assert.equal(r[0].root.selectedAction,r[1].root.selectedAction);assert.equal(D.signature(r[0].row),D.signature(r[1].row));}
 const branches=[];
 for(const c of cases){const actions=[...new Map(c.root.rows.filter(r=>r.hardAllowed&&r.finalAllowed&&r.action!==ACTION.NONE&&r.action!==ACTION.CAST_TELEPORT).map(r=>[r.action,r])).values()];assert.ok(actions.some(r=>r.action===c.root.selectedAction));
  for(let suffix=0;suffix<8;suffix++)for(const action of actions){const eventSeed=parseInt(D.hash('BP407_SUFFIX:'+c.case+':'+suffix).slice(0,8),16);
   const result=await play(selected[c.case],{case:c.case,frame:c.root.frame,action:action.action,argument:action.argument,suffix,eventFrom:c.root.frame,eventSeed});
   assert.equal(result.audit.forceApplied,1);assert.ok(prefixMatches(c.baseline,result.row,c.root.frame,action.action),'COUNTERFACTUAL_PREFIX_DRIFT');const rt=result.traces.find(r=>r.frame===c.root.frame);assert.equal(rt.state.physicalSha256,c.root.state.physicalSha256,'COUNTERFACTUAL_ROOT_DRIFT');
   const compact={case:c.case,action:action.action,ownerAllowed:action.ownerAllowed,modelValue:action.value,suffix,...result};delete compact.traces;branches.push(compact);checkpoint('counterfactual',compact);
  }console.log(JSON.stringify({stage:'counterfactual',cases:c.case+1,games:gameCount}));
 }
 const rootResults=[];
 for(const c of cases){const rs=branches.filter(r=>r.case===c.case),actions=[...new Set(rs.map(r=>r.action))],means=(action,phase)=>{const selected=rs.filter(r=>r.action===action&&(phase==='selection'?r.suffix<4:r.suffix>=4));return selected.reduce((n,r)=>n+r.score,0)/selected.length;};
  const selectionScores=Object.fromEntries(actions.map(a=>[a,means(a,'selection')])),baseline=c.root.selectedAction,chosen=chooseCrossfit(actions,selectionScores,baseline),heldoutDelta=means(chosen,'validation')-means(baseline,'validation');
  const budgets=Object.fromEntries(protocol.nominalBudgets.map(b=>{const xs=budgetRows.filter(r=>r.case===c.case&&r.budget===b),action=xs[0].root.selectedAction;return [b,{action,searchActive:xs[0].root.searchActive,nodes:xs[0].root.nodes,budgetLeaves:xs[0].root.budgetLeaves,decisionMs:xs.map(r=>r.root.decisionMs),originalOutcomeScore:xs[0].score,validationDelta:actions.includes(action)?means(action,'validation')-means(baseline,'validation'):null}];}));
  rootResults.push({case:c.case,stratum:c.stratum,id:c.id,rootClass:c.root.classification,baselineAction:baseline,actions:actions.map(action=>({action,selectionMean:means(action,'selection'),validationMean:means(action,'validation'),ownerAllowed:c.root.rows.find(r=>r.action===action).ownerAllowed,modelValue:c.root.rows.find(r=>r.action===action).value})),selectionChosenAction:chosen,heldoutDelta,chosenOwnerAllowed:c.root.rows.find(r=>r.action===chosen).ownerAllowed,budgets});
 }
 const paired=(f)=>M.interval(rootResults.map(r=>({map:r.id,delta:f(r)})));
 const summary={status:'BOUNDED_DIAGNOSIS_COMPLETE',games:gameCount,cases:16,baselineGames:16,budgetGames:128,counterfactualGames:branches.length,exactBaselineReproductions:16,physicalRootAndPrefixChecks:budgetRows.length+branches.length,
  stateClasses:cases.reduce((a,c)=>(a[c.root.classification]=(a[c.root.classification]||0)+1,a),{}),decisionPath:{frames:cases.reduce((n,c)=>n+c.audit.frames,0),searchFrames:cases.reduce((n,c)=>n+c.audit.searchFrames,0),proposalFrames:cases.reduce((n,c)=>n+c.traceSummary.filter(r=>r.proposal>=0).length,0)},
  rootResults,crossfitDiagnosticDelta:paired(r=>r.heldoutDelta),budgetValidationDeltas:Object.fromEntries(protocol.nominalBudgets.map(b=>[b,paired(r=>r.budgets[b].validationDelta??0)])),
  recoveredSignals:rootResults.filter(r=>r.heldoutDelta>0).map(r=>({case:r.case,stratum:r.stratum,delta:r.heldoutDelta,ownerAllowed:r.chosenOwnerAllowed})),
  productionUnchanged:true,platformHeadroomProven:false,limitations:protocol.limits,
  unresolved:['Model error versus value-ranking error remains unresolved without a separately validated transition oracle.','Four validation suffixes per state have low precision; no per-state safety or population gain claim.','Wall time here is measured for diagnosis only; no real-time budget policy or equal-CPU efficacy claim.']};
 assert.equal(arena.productionTreeSha256(root),tree);assert.equal(D.hash(fs.readFileSync(__filename)),protocol.sourceSha256);save(path.join(out,'summary.json'),summary);console.log(JSON.stringify({...summary,rootResults:undefined}));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={budgetSource,classify,chooseCrossfit};
