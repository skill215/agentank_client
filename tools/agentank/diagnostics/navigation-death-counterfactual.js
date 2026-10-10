'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {ACTION}=require('../../../engine-v2/src/abi/fast-codes');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function classifyBranch(original,branch,applied){
 if(!applied)return {status:'FINAL_GATE_BLOCKED',survivedOriginalDeadline:false,analysisRecovered:false};
 const ownCrashed=Boolean(branch.counts.crashes[branch.candidateSeat]);
 return {status:'EXECUTED',survivedOriginalDeadline:branch.frames>original.frames||!ownCrashed,analysisRecovered:branch.analysisOutcome!=='V1_WIN',finalOwnCrashed:ownCrashed};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),input=path.join(base,'bp349-navigation-family-external'),manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'))),bytes=fs.readFileSync(path.join(input,'matches.ndjson.gz')),auditBytes=fs.readFileSync(path.join(base,'bp350-navigation-combat-audit/matches.ndjson.gz')),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const parse=b=>zlib.gunzipSync(b).toString().trim().split('\n').map(JSON.parse),source=parse(bytes).filter(r=>r.mode==='NAVIGATION_FAMILY'),targets=parse(auditBytes).filter(r=>r.from==='V2_WIN'&&r.to==='V1_WIN'&&r.arms.candidate.terminal==='SINGLE_CRASH');assert.equal(targets.length,37);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,sourceSha256:hash(bytes),auditSha256:hash(auditBytes),runnerSha256:hash(fs.readFileSync(__filename)),candidateSources:manifest.candidateSources,targets:targets.map(r=>({id:r.id,seat:r.seat,frame:r.arms.candidate.last.frame})),protocol:'One-action final-root interventions on 37 frozen single-crash regressions; candidate and V1 policies resume; all distinct generated Hard-allowed actions, final gate preserved; no physical exhaustive oracle'},null,2));
 const {scenarios}=loadRollingV1ScenariosForIds([...new Set(targets.map(r=>r.id))],root),{module}=await loadSimulator(root),select=E.prototype.selectIncumbent,work=new WeakMap(),records=[];let runs=0;
 const check=m=>{assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);};
 try{E.prototype.selectIncumbent=function(count){const incumbent=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,incumbent);};
 for(const t of targets){const old=source.find(r=>r.matchUrlId===t.id&&r.candidateSeat===t.seat),scenario=scenarios.find(s=>s.matchUrlId===t.id);assert.equal(scenario.fingerprint,old.scenarioFingerprint);
  const natural=await play(module,scenario,t.seat,true);runs++;check(natural);for(const side of ['candidate','control']){assert.equal(natural[side].compactActionStream,old[side].compactActionStream);assert.deepEqual(natural[side].compactArguments,old[side].compactArguments);}assert.equal(natural.frames,old.frames);assert.equal(natural.analysisOutcome,old.analysisOutcome);assert.deepEqual(natural.counts,old.counts);
  const last=natural.candidateEngine.rootFrames.at(-1),frame=last.frame;assert.equal(frame,t.arms.candidate.last.frame);assert.equal(frame,Buffer.from(old.candidate.compactActionStream,'base64').length-1,'CALLBACK_FRAME_GAP');
  const seen=new Set(),candidates=last.candidates.filter(c=>c.hard===0&&!seen.has(c.action)&&seen.add(c.action));assert.ok(!candidates.some(c=>c.action===ACTION.CAST_TELEPORT),'TELEPORT_ARGUMENT_UNSUPPORTED');
  const rec={id:t.id,seat:t.seat,frame,originalAction:last.emittedAction,originalRoot:last,branches:[]};
  for(const c of candidates){const m=await play(module,scenario,t.seat,false,null,true,true,'current',false,false,1,'off',frame,c.action);runs++;check(m);const applied=m.candidateEngine.forceApplied===1;
   if(applied){assert.ok(prefixMatches(natural,m,frame,c.action),'PREFIX_DRIFT');assert.equal(Buffer.from(natural.control.compactActionStream,'base64')[frame],Buffer.from(m.control.compactActionStream,'base64')[frame],'ENEMY_SAME_FRAME_ACTION_DRIFT');}
   else for(const side of ['candidate','control'])assert.equal(m[side].compactActionStream,natural[side].compactActionStream,'BLOCKED_FORCE_DRIFT');
   if(c.action===last.emittedAction&&applied){for(const side of ['candidate','control'])assert.equal(m[side].compactActionStream,natural[side].compactActionStream,'NOOP_DRIFT');assert.deepEqual(m.counts,natural.counts);}
   rec.branches.push({action:c.action,acceptable:c.acceptable,dominated:c.dominated,immediate:c.immediate,committed:c.committed,unknown:c.unknown,...classifyBranch(natural,m,applied),outcome:m.analysisOutcome,terminal:m.terminalCategory,frames:m.frames,stars:m.counts.stars,crashes:m.counts.crashes});
  }
  records.push(rec);if(records.length%4===0||records.length===targets.length)console.error(`[bp351] ${records.length}/37 cases, ${runs} executions`);
 }
 }finally{E.prototype.selectIncumbent=select;}
 const groups={};for(const r of records){const executed=r.branches.filter(b=>b.status==='EXECUTED'),survivors=executed.filter(b=>b.survivedOriginalDeadline),recovered=executed.filter(b=>b.analysisRecovered);r.classification=!executed.length?'NO_EXECUTABLE_GENERATED_HARD_ACTION':recovered.length?'ANALYSIS_RECOVERY_WITNESS':survivors.length?'DEADLINE_ESCAPE_ONLY':'NO_ESCAPE_IN_TESTED_ACTIONS';groups[r.classification]=(groups[r.classification]||0)+1;r.witnesses={survive:survivors.map(b=>b.action),recover:recovered.map(b=>b.action)};}
 assert.equal(productionTreeSha256(root),tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const overview={tree,cases:records.length,runs,groups,branches:records.reduce((n,r)=>n+r.branches.length,0),blocked:records.reduce((n,r)=>n+r.branches.filter(b=>b.status==='FINAL_GATE_BLOCKED').length,0),survivalWitnessCases:records.filter(r=>r.witnesses.survive.length).length,recoveryWitnessCases:records.filter(r=>r.witnesses.recover.length).length,acceptableSurvivalCases:records.filter(r=>r.branches.some(b=>b.survivedOriginalDeadline&&b.acceptable&&!b.dominated)).length,checks:{naturalActionDrift:0,noOpDrift:0,prefixDrift:0,sameFrameOpponentDrift:0,errors:0,timeouts:0,restore:0},limitations:['Empirical fixed-policy one-step deviation, not minimax or a safety certificate','No allowed generated action does not prove physical impossibility','Later death is separate from survival at original terminal deadline','No risk thresholds or production ownership changed'],productionAdoption:false};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(records.map(({originalRoot,...r})=>JSON.stringify(r)).join('\n')+'\n'));fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(records.slice(0,32).map(r=>JSON.stringify({id:r.id,seat:r.seat,root:r.originalRoot})).join('\n')+'\n'));assert.ok(fs.readdirSync(output).reduce((s,f)=>s+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={classifyBranch};
