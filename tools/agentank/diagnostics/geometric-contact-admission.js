'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadCohort}=require('./v2-native-initiative-arena'),{loadSimulator}=require('../simulation/paired-arena');
function skipSearch(distance,line,disabled){return distance>9&&!line&&disabled;}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const load=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n+'/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const baseline={CURRENT:load('bp317-reducer-active-verified'),LAYERED128:load('bp333-layered-budget-active')};
 assert.equal(tree,JSON.parse(fs.readFileSync(path.join(base,'bp333-layered-budget-active/overview.json'))).tree);
 const targets=JSON.parse(fs.readFileSync(path.join(base,'bp305-independent-admission/manifest.json'))).targets;
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const source=O.prototype.source,prepare=S.prototype.prepare,executors=new WeakMap(),matches=[],summary={};let mode,counters;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,modes:['CURRENT','LAYERED128'],games:64,change:'source returns null only for distance>9, no clear line and active enemy stun; observation/history and downstream final gate preserved'},null,2));
 try{O.prototype.source=function(engine,count){const s=engine.adapter.state,a=s.arrays,frame=a[ARRAY.SCALAR][SCALAR.FRAME],until=a[ARRAY.TANK_STUN_UNTIL][1];
  const distance=engine.manhattan(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),line=engine.clearLine(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]);
  counters.entries++;if(skipSearch(distance,line,until!==NONE_FRAME&&until>frame)){counters.skipped++;return null;}return source.call(this,engine,count);};
 S.prototype.prepare=function(engine,count,eligibility){counters.searches++;if(mode==='CURRENT')return prepare.call(this,engine,count,eligibility);
  this.bindIsolatedHard(engine.adapter.bundle);let e=executors.get(this);if(!e){e=new ThinLayerExecutor(this,this.diagnosticKernel,engine.adapter.state);executors.set(this,e);}const r=e.run(engine,count,eligibility,prepare,128,3);assert.ok(r.used<=128);counters.depths[r.completedDepth]++;return r.completedDepth>0?1:0;};
 for(mode of ['CURRENT','LAYERED128']){counters={entries:0,skipped:0,searches:0,depths:[0,0,0,0]};const list=[],transitions={};
  for(const t of targets)for(let seat=0;seat<2;seat++){const scenario=scenarios.find(s=>s.matchUrlId===t.id),b=baseline[mode].find(m=>m.matchUrlId===t.id&&m.candidateSeat===seat);assert.equal(scenario.fingerprint,b.scenarioFingerprint);
   const m=await play(module,scenario,seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);list.push(compact(m));matches.push({...compact(m),mode});const key=b.analysisOutcome+'->'+m.analysisOutcome;transitions[key]=(transitions[key]||0)+1;console.error(`[admission-${mode}] ${list.length}/32`);}
  const attack=l=>({kills:l.filter(m=>m.counts.crashes[m.candidateSeat^1]&&!m.counts.crashes[m.candidateSeat]).length,deaths:l.filter(m=>m.counts.crashes[m.candidateSeat]&&!m.counts.crashes[m.candidateSeat^1]).length});
  summary[mode]={before:summarize(baseline[mode]),after:summarize(list),attack:{before:attack(baseline[mode]),after:attack(list)},transitions,counters};
 }
 }finally{O.prototype.source=source;S.prototype.prepare=prepare;}
 assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,summary,checks:{errors:0,timeouts:0,restore:0},notes:['Experimental search admission only, not a physical stun rule change','Repeated development scenes, no independent significance','Skipping source preserves the existing incumbent; no replacement navigation algorithm']},null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={skipSearch};
