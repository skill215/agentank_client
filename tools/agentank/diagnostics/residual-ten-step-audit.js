'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {FastState,ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {FAST_STATUS,TERMINAL,NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {withClock,PROTOCOL}=require('./deterministic-v1-clock');
const {normalizeCooldownStun}=require('./cooldown-stun-normalization');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot:B}=require('./native-base-policy-standalone-arena');
const {V3DiagnosticBot}=require('../../../engine-v3/src');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function matrix(engine){
 const src=engine.adapter.state,search=engine.basePolicy.policySearch;search.bindIsolatedHard(engine.adapter.bundle);
 const s=new FastState(src.width,src.height);for(let i=0;i<src.arrays.length;i++)s.arrays[i].set(src.arrays[i]);s.initializeHash();
 const k=new search.diagnosticKernel.constructor(s),rows=[];
 for(let row=0;row<engine.ourCount;row++){
  const action=engine.ourActions[row],r={row,action,win:0,loss:0,draw:0,live:0,incomplete:0,ownCrash:0,total:0,failures:{}};
  for(const enemy of [0,1,2,3,4,5,8])for(let c0=0;c0<search.chanceAlternatives(src,0,action);c0++)for(let c1=0;c1<search.chanceAlternatives(src,1,enemy);c1++){
   const normalized=normalizeCooldownStun(enemy,src.arrays[ARRAY.TANK_SKILL][1],src.arrays[ARRAY.TANK_SKILL_READY][1],src.arrays[ARRAY.SCALAR][SCALAR.FRAME],(engine.adapter.informationGapMask&~8192)===0);
   const mark=s.deltaUsed*1024+s.eventUsed,st=k.applyFrame(action,engine.ourArguments[row],normalized,NONE_CELL,c0,c1),t=s.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];r.total++;
   if(st!==FAST_STATUS.APPLIED&&st!==FAST_STATUS.APPLIED_TERMINAL){r.incomplete++;const key=enemy+':'+st+':'+k.failureReason;r.failures[key]=(r.failures[key]||0)+1;}
   else {r[t===TERMINAL.WIN0?'win':t===TERMINAL.WIN1?'loss':t===TERMINAL.DRAW?'draw':'live']++;r.ownCrash+=s.arrays[ARRAY.TANK_CRASH][0]?1:0;}
   s.undoTo(mark);
  }rows.push(r);
 }
 for(let i=0;i<src.arrays.length;i++)assert.deepEqual(s.arrays[i],src.arrays[i],'MATRIX_RESTORE');
 return {authority:'OBSERVED_STATE_ONE_FRAME_CONDITIONAL_NOT_PROOF',gap:engine.adapter.informationGapMask,rows};
}
function aggregate(roots){const out={roots:roots.length,owners:{},searchReasons:{},searchRoots:0,nodes:0,budgetLeaves:0,selectedHard:{},selectedRiskRejected:0,selectedDominated:0,eoSupport:{},fire:{generated:0,hardAllowed:0,acceptable:0,selected:0},conditional:{selectedHasLoss:0,hasZeroLossCompleteAlternative:0,alternativeHardRejected:0,alternativeRiskRejected:0,alternativeAllowed:0,incompleteRoots:0}};
 const inc=(o,k)=>o[k]=(o[k]||0)+1;
 for(const r of roots){inc(out.owners,r.selected<0?'NO_SELECTED_ROW':r.selected===r.proposal?'BASE_PROPOSAL':r.selected===r.incumbent?'INCUMBENT':'FINAL_OTHER');inc(out.searchReasons,r.searchEntryReason);inc(out.eoSupport,r.escapeSupport);if(r.searchEvidenceCurrent)out.searchRoots++;out.nodes+=r.basePolicyNodes;out.budgetLeaves+=r.basePolicyBudgetLeaves;
 const chosen=r.candidates.find(c=>c.row===r.selected);if(chosen){inc(out.selectedHard,chosen.hard);out.selectedRiskRejected+=!chosen.acceptable;out.selectedDominated+=!!chosen.dominated;}
 const fire=r.candidates.find(c=>c.action===4);if(fire){out.fire.generated++;out.fire.hardAllowed+=fire.hard===0;out.fire.acceptable+=!!fire.acceptable;out.fire.selected+=r.selected===fire.row;}
 const cells=r.counterfactual.rows,sel=cells.find(c=>c.row===r.selected);if(cells.some(c=>c.incomplete))out.conditional.incompleteRoots++;
 if(sel&&sel.loss>0){out.conditional.selectedHasLoss++;const alt=cells.filter(c=>c.row!==r.selected&&c.incomplete===0&&c.loss===0);if(alt.length){out.conditional.hasZeroLossCompleteAlternative++;for(const a of alt){const c=r.candidates.find(c=>c.row===a.row);if(!c)continue;out.conditional[c.hard!==0?'alternativeHardRejected':!c.acceptable?'alternativeRiskRejected':'alternativeAllowed']++;}}}
 }return out;}
async function run(root,output){assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),input=path.join(base,'bp370-deterministic-certificate-validation/matches.ndjson.gz'),bytes=fs.readFileSync(input),matches=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse),res=JSON.parse(fs.readFileSync(path.join(base,'bp371-residual-loss-analysis/overview.json')));
 const targets=res.lossCases.filter(r=>r.doubleLoss&&r.terminal==='SINGLE_CRASH'&&r.frames<=64);assert.equal(targets.length,13);const tree=productionTreeSha256(root);assert.equal(tree,'285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120');
 fs.mkdirSync(output,{recursive:true});const write=(n,v)=>fs.writeFileSync(path.join(output,n),JSON.stringify(v,null,2),{flag:'wx'});write('manifest.json',{tree,inputSha256:hash(bytes),scriptSha256:hash(fs.readFileSync(__filename)),clock:PROTOCOL,targets,productionChanges:false});
 const {module}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root),select=E.prototype.selectIncumbent,decide=B.prototype.decide,capture=B.prototype.captureRoot,v1=V3DiagnosticBot.prototype.decide,work=new WeakMap,roots=[],results=[];let target,cf;
 try{E.prototype.selectIncumbent=function(n){const row=select.call(this,n);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,n,row);};V3DiagnosticBot.prototype.decide=function(ctx){return withClock(this.controller.runtime.sandbox,()=>v1.call(this,ctx));};
 B.prototype.decide=function(ctx){const e=this.engine,emit=e.emit;cf=null;if(ctx.game.frames>=target.frames-4)e.emit=function(me,a){cf=matrix(e);return emit.call(e,me,a);};try{return decide.call(this,ctx);}finally{e.emit=emit;}};
 B.prototype.captureRoot=function(ctx,a){if(ctx.game.frames<target.frames-4)return;capture.call(this,ctx,a);const r=this.rootFrames[this.rootFrames.length-1];r.counterfactual=cf;r.id=target.id;r.seat=target.seat;roots.push(r);};
 for(target of targets){const prior=matches.find(m=>m.mode==='ACTIVE'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat),scenario=scenarios.find(s=>s.matchUrlId===target.id);assert.equal(scenario.fingerprint,prior.scenarioFingerprint);const m=await play(module,scenario,target.seat,true);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,prior[side].compactActionStream);assert.deepEqual(m[side].compactArguments,prior[side].compactArguments);}assert.deepEqual(m.counts,prior.counts);assert.equal(m.analysisOutcome,prior.analysisOutcome);assert.equal(m.frames,prior.frames);assert.equal(m.candidate.errorCount+m.candidate.timeoutCount+m.candidateEngine.rootRestoreFailures,0);results.push({id:target.id,seat:target.seat,frames:m.frames,outcome:m.analysisOutcome,exact:true});console.log('reproduced '+results.length+'/'+targets.length);}
 }finally{E.prototype.selectIncumbent=select;B.prototype.decide=decide;B.prototype.captureRoot=capture;V3DiagnosticBot.prototype.decide=v1;}
 assert.equal(roots.length,52);assert.equal(productionTreeSha256(root),tree);const summary=aggregate(roots);write('overview.json',{...summary,reproduced:results,steps:Array.from({length:10},(_,i)=>({step:i+1,status:'COMPLETED'})),limits:'One-frame observed-state counterfactuals are not full-information proofs or four-frame survival guarantees.'});fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(roots.map(JSON.stringify).join('\n')+'\n'),{flag:'wx'});console.log(JSON.stringify(summary,null,2));}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={aggregate};
