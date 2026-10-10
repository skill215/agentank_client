'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {FastState,ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {ACTION,FAST_STATUS,NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot:B}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function crashOutcome(own,enemy,ownStars,enemyStars){if(!own&&!enemy)return 'NONTERMINAL_OR_OTHER';if(own&&enemy)return ownStars>enemyStars?'WIN':ownStars<enemyStars?'LOSS':'DRAW';return enemy?'WIN':'LOSS';}
function auditRoot(e,root){
 const original=e.adapter.state,s=e.basePolicy.policySearch;s.bindIsolatedHard(e.adapter.bundle);
 const clone=new FastState(original.width,original.height);for(let i=0;i<original.arrays.length;i++)clone.arrays[i].set(original.arrays[i]);clone.initializeHash();
 const Kernel=s.diagnosticKernel.constructor,kernel=new Kernel(clone),cells=[],enemy=[];
 for(let i=0;i<e.enemyCount;i++)enemy.push({action:e.enemyActions[i],argument:e.enemyArguments[i],generated:true});
 if(!enemy.some(c=>c.action===ACTION.NONE))enemy.push({action:ACTION.NONE,argument:NONE_CELL,generated:false});
 const ownRows=root.candidates.filter(c=>c.action===ACTION.FIRE||c.row===root.selected);
 for(const row of ownRows)for(const response of enemy)for(let c0=0;c0<s.chanceAlternatives(original,0,row.action);c0++)for(let c1=0;c1<s.chanceAlternatives(original,1,response.action);c1++){
  const before=clone.arrays.map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64'));
  const mark=clone.deltaUsed*1024+clone.eventUsed,status=kernel.applyFrame(row.action,e.ourArguments[row.row],response.action,response.argument,c0,c1),a=clone.arrays,applied=status===FAST_STATUS.APPLIED||status===FAST_STATUS.APPLIED_TERMINAL;
  const ownCrash=a[ARRAY.TANK_CRASH][0],enemyCrash=a[ARRAY.TANK_CRASH][1],ownStars=a[ARRAY.TANK_STARS][0],enemyStars=a[ARRAY.TANK_STARS][1],terminal=a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
  const result=applied?crashOutcome(ownCrash,enemyCrash,ownStars,enemyStars):'INCOMPLETE';
  cells.push({ownAction:row.action,enemyAction:response.action,enemyGenerated:response.generated,chance0:c0,chance1:c1,status,result,ownCrash,enemyCrash,ownStars,enemyStars,terminal,searchTerminalValue:applied&&(ownCrash||enemyCrash)?s.terminalUtility({adapter:{state:clone}},terminal,1,0):null});
  clone.undoTo(mark);for(let i=0;i<clone.arrays.length;i++)assert.equal(Buffer.from(clone.arrays[i].buffer,clone.arrays[i].byteOffset,clone.arrays[i].byteLength).toString('base64'),before[i],'CLONE_RESTORE');
 }
 return {frame:root.frame,selected:root.emittedAction,ownStars:root.ownStars,enemyStars:root.enemyStars,rows:ownRows,cells,scope:'Generated enemy domain plus NONE; supported stun chance alternatives; one joint frame; nonterminal not solved; no strict proof'};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),load=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n))).toString().trim().split('\n').map(JSON.parse),prior=load('bp351-navigation-death-counterfactual/matches.ndjson.gz'),matches=load('bp349-navigation-family-external/matches.ndjson.gz'),manifest=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const targets=prior.filter(r=>r.branches.some(b=>b.action===ACTION.FIRE&&b.analysisRecovered&&!b.survivedOriginalDeadline));assert.equal(targets.length,7);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:targets.map(t=>({id:t.id,seat:t.seat,frame:t.frame})),runnerSha256:hash(fs.readFileSync(__filename)),inputSha256:hash(fs.readFileSync(path.join(base,'bp351-navigation-death-counterfactual/matches.ndjson.gz')))},null,2));
 const {scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root),{module}=await loadSimulator(root),select=E.prototype.selectIncumbent,capture=B.prototype.captureRoot,work=new WeakMap(),records=[];let target,record;
 try{E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
 B.prototype.captureRoot=function(context,action){capture.call(this,context,action);if(context.game.frames===target.frame)record=auditRoot(this.engine,this.rootFrames.at(-1));};
 for(target of targets){record=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),old=matches.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat&&m.mode==='NAVIGATION_FAMILY');assert.equal(scenario.fingerprint,old.scenarioFingerprint);const m=await play(module,scenario,target.seat,true);assert.ok(record);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,old[side].compactActionStream);assert.deepEqual(m[side].compactArguments,old[side].compactArguments);}assert.deepEqual(m.counts,old.counts);assert.equal(m.analysisOutcome,old.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);records.push({id:target.id,seat:target.seat,...record});}
 }finally{E.prototype.selectIncumbent=select;B.prototype.captureRoot=capture;}
 const resultCounts={},fireCounts={};for(const r of records)for(const c of r.cells){resultCounts[c.result]=(resultCounts[c.result]||0)+1;if(c.ownAction===ACTION.FIRE)fireCounts[c.result]=(fireCounts[c.result]||0)+1;}
 const overview={tree,roots:records.length,cells:records.reduce((n,r)=>n+r.cells.length,0),resultCounts,fireCounts,fireResponses:records.map(r=>({id:r.id,cells:r.cells.filter(c=>c.ownAction===ACTION.FIRE&&c.enemyAction===ACTION.FIRE)})),strictProof:false,checks:{actionDrift:0,eventCountDrift:0,restore:0,errors:0,timeouts:0},productionAdoption:false};assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={crashOutcome};
