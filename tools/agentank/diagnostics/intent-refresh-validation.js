'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME,NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const {skipSearch}=require('./geometric-contact-admission');
const {refreshOnMissingSource}=require('./intent-source-decoupling');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function view(i){return {target:i.target,proposed:i.currentProposed,committed:i.currentCommitted,action:i.currentCommittedAction,epoch:i.contextEpoch,lastIntent:i.lastIntent,lastIntentEpoch:i.lastIntentEpoch};}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root),audit=JSON.parse(fs.readFileSync(path.join(base,'bp340-admission-navigation/overview.json')));assert.equal(tree,audit.tree);
 const load=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n,'matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const old=load('bp338-geometric-external-validation').concat(load('bp339-geometric-factorial'));
 const targets=audit.records.map(r=>({id:r.id,seat:r.seat,frame:r.arms.CURRENT.frame})),{scenarios}=loadRollingV1ScenariosForIds([...new Set(targets.map(t=>t.id))],root),{module}=await loadSimulator(root);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,scope:'diagnostic missing-source intent refresh only; no new action ownership',games:18,selection:'nine known navigation regressions, not a qualification cohort',files:[__filename,path.join(__dirname,'intent-source-decoupling.js')].map(f=>({path:path.relative(root,f),sha256:hash(fs.readFileSync(f))}))},null,2));
 const source=O.prototype.source,select=O.prototype.selectOverride,records=[],matches=[],counters={CURRENT:{sourceCalls:0,missing:0,refreshed:0,skipped:0},REFRESH_ONLY:{sourceCalls:0,missing:0,refreshed:0,skipped:0}};let mode,target,record;
 try{O.prototype.source=function(engine,count){const c=counters[mode];c.sourceCalls++;const a=engine.adapter.state.arrays,frame=a[ARRAY.SCALAR][SCALAR.FRAME],until=a[ARRAY.TANK_STUN_UNTIL][1],skip=mode==='REFRESH_ONLY'&&skipSearch(engine.manhattan(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),engine.clearLine(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),until!==NONE_FRAME&&until>frame);if(skip)c.skipped++;
 const r=skip?null:source.call(this,engine,count);if(!r)c.missing++;const before=view(this.intent),lastIntent=this.intent.lastIntent,lastEpoch=this.intent.lastIntentEpoch,result=refreshOnMissingSource(this,engine,count,r);assert.equal(result,r);if(!r){c.refreshed++;assert.equal(this.intent.lastIntent,lastIntent);assert.equal(this.intent.lastIntentEpoch,lastEpoch);}if(frame===target.frame)record={frame,skipped:skip,missing:!r,before,after:view(this.intent),targetPresent:this.intent.target!==NONE_CELL};return result;};
 O.prototype.selectOverride=function(engine,selected,incumbent){const r=select.call(this,engine,selected,incumbent);if(engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]===target.frame){assert.ok(record);record.incumbent=incumbent;record.proposal=r?{action:r.action,row:r.row}:null;}return r;};
 for(target of targets)for(mode of ['CURRENT','REFRESH_ONLY']){record=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),prior=old.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat&&m.mode===(mode==='CURRENT'?'CURRENT':'CURRENT_GEOMETRIC'));assert.equal(scenario.fingerprint,prior.scenarioFingerprint);const m=await play(module,scenario,target.seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);assert.ok(record);
 const actionsEqual=['candidate','control'].every(side=>m[side].compactActionStream===prior[side].compactActionStream&&JSON.stringify(m[side].compactArguments)===JSON.stringify(prior[side].compactArguments)),eventsEqual=JSON.stringify(m.counts)===JSON.stringify(prior.counts);if(mode==='CURRENT'){assert.equal(actionsEqual,true,'SEARCH_ENABLED_ACTION_DRIFT');assert.equal(m.analysisOutcome,prior.analysisOutcome);assert.equal(eventsEqual,true);}else{assert.equal(record.proposal,null,'UNAUTHORIZED_INTENT_PROPOSAL');assert.equal(record.targetPresent,true);}
 records.push({id:target.id,seat:target.seat,mode,actionsEqual,eventsEqual,beforeOutcome:prior.analysisOutcome,afterOutcome:m.analysisOutcome,root:record});matches.push({...compact(m),mode});console.error(`[bp341] ${records.length}/18`);
 }
 }finally{O.prototype.source=source;O.prototype.selectOverride=select;}
 assert.equal(productionTreeSha256(root),tree);const summary={counters,modes:{},checks:{error:0,timeout:0,restore:0,sourceIdentityDrift:0,unauthorizedProposal:0}};for(const mode of ['CURRENT','REFRESH_ONLY']){const r=records.filter(r=>r.mode===mode);summary.modes[mode]={...summarize(matches.filter(m=>m.mode===mode)),actionDrift:r.filter(r=>!r.actionsEqual).length,eventDrift:r.filter(r=>!r.eventsEqual).length,outcomeDrift:r.filter(r=>r.beforeOutcome!==r.afterOutcome).length};}
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,summary,records,productionAdoption:false},null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
