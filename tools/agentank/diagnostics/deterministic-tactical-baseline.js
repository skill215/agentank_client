'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PROTOCOL,withClock}=require('./deterministic-v1-clock');
const {saveFailure}=require('./failure-artifact');
const {V3DiagnosticBot,resolveFrozenV1}=require('../../../engine-v3/src');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),prior=JSON.parse(fs.readFileSync(path.join(base,'bp366-restricted-terminal-prefilter/manifest.json'))),drift=JSON.parse(fs.readFileSync(path.join(base,'bp367-baseline-repro/overview.json'))).target,cohort=[...prior.cohort];if(!cohort.some(t=>t.id===drift.id))cohort.push(drift);
 const tree=productionTreeSha256(root);assert.equal(tree,prior.tree);const frozen=resolveFrozenV1(root),{module,directory}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(cohort.map(t=>t.id),root),select=E.prototype.selectIncumbent,decide=V3DiagnosticBot.prototype.decide,work=new WeakMap(),records=[];let pending=null,clockChecks=0;
 const files=['tools/agentank/diagnostics/deterministic-tactical-baseline.js','tools/agentank/diagnostics/deterministic-v1-clock.js','tools/agentank/diagnostics/native-base-policy-standalone-arena.js','tools/agentank/diagnostics/v1-v3-arena.js','tools/agentank/diagnostics/navigation-family-selector.js','tools/agentank/diagnostics/route-navigation-consumer.js','tools/agentank/diagnostics/pose-route-field.js','tools/agentank/simulation/historical-scenarios.js','engine-v3/src/legacy/v1-runtime.js','engine-v3/src/controller.js','engine-v3/src/diagnostic-bot.js'];
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({protocol:PROTOCOL,tree,v1Sha256:frozen.sha256,node:process.version,cohort,repetitions:2,games:cohort.length*4,clock:{value:100000,progressThresholds:[64,100,112],officialRuntimeEvidence:false},sources:files.map(f=>({path:f,sha256:hash(fs.readFileSync(path.join(root,f)))})),simulator:['engine.js','constants.js','map.js'].map(f=>({path:path.relative(root,path.join(directory,'src',f)),sha256:hash(fs.readFileSync(path.join(directory,'src',f)))})),historicalIdentityClaim:false},null,2));
 try{
 E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
 V3DiagnosticBot.prototype.decide=function(context){const s=this.controller.runtime.sandbox,result=withClock(s,()=>decide.call(this,context));assert.equal(s.AT_ACCUMULATED_RUNTIME_MS,0);assert.equal(s.AT_MC_DISABLED_BY_RUNTIME,s.AT_MATCH_PROGRESS>=64);assert.equal(s.minimaxRuntimeReductionActive(),s.AT_MATCH_PROGRESS>=100);assert.equal(s.minimaxRuntimeEmergencyActive(),s.AT_MATCH_PROGRESS>=112);clockChecks++;return result;};
 for(let repetition=0;repetition<2;repetition++)for(const target of cohort)for(const seat of [0,1]){pending={repetition,id:target.id,seat,match:null};const scenario=scenarios.find(s=>s.matchUrlId===target.id);assert.equal(scenario.fingerprint,target.fingerprint);const m=await play(module,scenario,seat,false);pending.match=m;assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.control.errorCount,0);assert.equal(m.control.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
 if(repetition){const b=records.find(r=>r.matchUrlId===target.id&&r.candidateSeat===seat);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,b[side].compactActionStream);assert.deepEqual(m[side].compactArguments,b[side].compactArguments);}assert.deepEqual(m.counts,b.counts);assert.equal(m.analysisOutcome,b.analysisOutcome);}
 records.push({repetition,...m});console.error(`[bp369] ${records.length}/${cohort.length*4}`);
 }
 }catch(e){saveFailure(output,records,pending,e);throw e;}finally{E.prototype.selectIncumbent=select;V3DiagnosticBot.prototype.decide=decide;}
 const first=records.filter(r=>r.repetition===0),counts={wins:0,losses:0,draws:0};for(const r of first)counts[r.analysisOutcome==='V2_WIN'?'wins':r.analysisOutcome==='V1_WIN'?'losses':'draws']++;
 const summary={status:'DETERMINISTIC_BASELINE_VERIFIED',protocol:PROTOCOL,tree,scenarios:cohort.length,games:records.length,uniqueGames:first.length,counts,clockChecks,repeatActionDrift:0,repeatOutcomeDrift:0,errors:0,timeouts:0,restore:0,historicalIdentityClaim:false,productionAdoption:false};assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(summary,null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
