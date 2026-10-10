'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadCohort}=require('./v2-native-initiative-arena'),{loadSimulator}=require('../simulation/paired-arena');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const LIMIT=128,CAP=3;
function publishable(schedule){return schedule.completedDepth>0&&schedule.committed!==null?1:0;}
async function run(root,output){
 const depthCap=process.argv.includes('--depth1')?1:CAP;
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const read=n=>JSON.parse(fs.readFileSync(path.join(base,n)));assert.equal(tree,read('bp317-reducer-active-verified/overview.json').productionTreeSha256);
 const targets=read('bp305-independent-admission/manifest.json').targets;
 const old=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const prepare=S.prototype.prepare,executors=new WeakMap(),matches=[],baselines=[],records=[],transitions={};let id,seat;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,limit:LIMIT,depthCap,unit:'kernel.applyFrame',games:32,fallback:'prepare=0; no search proposal; existing incumbent and final safety remain',score:'unchanged production blended score + original intent',admission:false,secondSearch:false},null,2));
 try{S.prototype.prepare=function(engine,count,eligibility){
  this.bindIsolatedHard(engine.adapter.bundle);let executor=executors.get(this);
  if(!executor){executor=new ThinLayerExecutor(this,this.diagnosticKernel,engine.adapter.state);executors.set(this,executor);}
  const start=performance.now(),schedule=executor.run(engine,count,eligibility,prepare,LIMIT,depthCap),ms=performance.now()-start;
  assert.ok(schedule.used<=LIMIT);const ok=publishable(schedule);
  records.push({id,seat,frame:engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME],used:schedule.used,depth:schedule.completedDepth,stop:schedule.status[schedule.count-1]||0,published:ok,ms});return ok;
 };
 for(const t of targets)for(seat=0;seat<2;seat++){id=t.id;const b=old.find(m=>m.matchUrlId===id&&m.candidateSeat===seat),scenario=scenarios.find(s=>s.matchUrlId===id);assert.equal(scenario.fingerprint,b.scenarioFingerprint);
  const m=await play(module,scenario,seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
  matches.push(compact(m));baselines.push(b);const key=b.analysisOutcome+'->'+m.analysisOutcome;transitions[key]=(transitions[key]||0)+1;console.error(`[layered-active] ${matches.length}/32`);
 }}finally{S.prototype.prepare=prepare;}
 assert.equal(productionTreeSha256(root),tree);
 const depthCounts=[0,0,0,0],stops={};for(const r of records){depthCounts[r.depth]++;stops[r.stop]=(stops[r.stop]||0)+1;}
 const attack=list=>{let kills=0,deaths=0;for(const m of list){const s=m.candidateSeat;kills+=m.counts.crashes[s^1]&&!m.counts.crashes[s]?1:0;deaths+=m.counts.crashes[s]&&!m.counts.crashes[s^1]?1:0;}return {kills,deaths};};
 const overview={tree,depthCap,before:summarize(baselines),after:summarize(matches),attack:{before:attack(baselines),after:attack(matches)},transitions,roots:records.length,depthCounts,stops,work:records.reduce((n,r)=>n+r.used,0),searchMs:records.reduce((n,r)=>n+r.ms,0),checks:{errors:0,timeouts:0,restore:0,budgetOverrun:0},notes:['Fixed 128 physical-transition budget; not equivalent to old node budget','Reused development cohort; no independent significance','No complete layer means no search proposal, not unknown promoted to safety','No production change; local timing not platform evidence']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));
 for(const [name,data] of [['matches',matches],['diagnostic-samples',records]])fs.writeFileSync(path.join(output,name+'.ndjson.gz'),zlib.gzipSync(data.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={publishable,LIMIT,CAP};
