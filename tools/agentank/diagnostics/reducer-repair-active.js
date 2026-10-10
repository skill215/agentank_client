'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const read=p=>JSON.parse(fs.readFileSync(p));
const lines=p=>zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(JSON.parse);
function firstDifference(a,b){const x=Buffer.from(a,'base64'),y=Buffer.from(b,'base64');
 for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return i;
 return x.length===y.length?-1:Math.min(x.length,y.length);}
function compact(m){const {rootFrames,...engine}=m.candidateEngine;const {actionFrames,...control}=m.control;
 return {...m,candidateEngine:engine,control};}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const base=path.join(root,'artifacts/native-causal-audit'),shadow=read(path.join(base,'bp316-reducer-shadow/overview.json'));
 const tree=productionTreeSha256(root);assert.equal(tree,shadow.productionTreeSha256);
 const targets=read(path.join(base,'bp305-independent-admission/manifest.json')).targets;
 const origin=read(path.join(base,'bp280-root-oracle36.json'));
 const old=lines(path.join(origin.input.directory,'matches.ndjson.gz'));
 const changed=lines(path.join(base,'bp316-reducer-shadow/roots.ndjson.gz')).filter(r=>r.rawArgmaxChanged);
 assert.equal(changed.length,11);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),matches=[],baselines=[],diagnostics=[],transitions={},firstChanges=[];
 const Module=require('node:module'),filename=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js');
 const legacy=new Module(filename);legacy.filename=filename;legacy.paths=Module._nodeModulePaths(path.dirname(filename));
 legacy._compile(fs.readFileSync(path.join(base,'bp316-reducer-repair/baseline-policy-search.js'),'utf8'),filename);
 const proto=NativeBasePolicySearch.prototype,names=['prepare','transitionValue','worstReply','policyValue'],fixed=names.map(n=>proto[n]);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({
  productionTreeSha256:tree,baseline:path.join(base,'bp316-reducer-shadow/manifest.json'),
  scenarios:targets.map(t=>({id:t.id,fingerprint:t.scenarioFingerprint})),seats:[0,1],skills:['stun','stun'],
  games:32,baselineReplays:32,maxFrames:128,mode:'ACTIVE',parameterChanges:false},null,2));
 for(const t of targets)for(let seat=0;seat<2;seat++){
  const archived=old.find(m=>m.matchUrlId===t.id&&m.candidateSeat===seat);assert.ok(archived);
  const scenario=scenarios.find(s=>s.matchUrlId===t.id);assert.equal(scenario.fingerprint,archived.scenarioFingerprint);
  let before;
  try{for(const n of names)proto[n]=legacy.exports.NativeBasePolicySearch.prototype[n];
   before=await play(module,scenario,seat,true);
  }finally{for(let i=0;i<names.length;i++)proto[names[i]]=fixed[i];}
  for(const side of ['candidate','control'])assert.equal(before[side].compactActionStream,archived[side].compactActionStream,'BASELINE_ACTION_DRIFT');
  assert.equal(before.analysisOutcome,archived.analysisOutcome,'BASELINE_OUTCOME_DRIFT');
  const after=await play(module,scenario,seat,true);
  assert.equal(after.candidate.errorCount,0);assert.equal(after.candidate.timeoutCount,0);
  assert.equal(after.candidateEngine.rootRestoreFailures,0);
  const at=firstDifference(before.candidate.compactActionStream,after.candidate.compactActionStream);
  const priorRoots=before.candidateEngine.rootFrames,currentRoots=after.candidateEngine.rootFrames;
  assert.equal(priorRoots.length,before.candidate.decisionCount);assert.equal(currentRoots.length,after.candidate.decisionCount);
  if(at>=0)firstChanges.push({id:t.id,seat,index:at,frame:priorRoots[at]?.frame,
   before:priorRoots[at]?.emittedAction,after:currentRoots[at]?.emittedAction,
   incumbent:currentRoots[at]?.incumbent,proposal:currentRoots[at]?.proposal,selected:currentRoots[at]?.selected});
  for(const r of changed.filter(r=>r.id===t.id&&r.seat===seat)){
   const index=priorRoots.findIndex(x=>x.frame===r.frame);assert.ok(index>=0);
   const samePrefix=at<0||index<=at,cur=samePrefix?currentRoots[index]:null;
   diagnostics.push({id:t.id,seat,frame:r.frame,samePrefix,status:!samePrefix?'OFF_TRAJECTORY':
    cur?.emittedAction===priorRoots[index].emittedAction?'FINAL_ACTION_UNCHANGED':'FINAL_ACTION_CHANGED',
    before:priorRoots[index].emittedAction,after:cur?.emittedAction,
    incumbent:cur?.incumbent,proposal:cur?.proposal,selected:cur?.selected});
  }
  const key=`${before.analysisOutcome}->${after.analysisOutcome}`;transitions[key]=(transitions[key]||0)+1;
  baselines.push(compact(before));matches.push(compact(after));console.error(`[reducer-active] ${matches.length}/32`);
 }
 assert.equal(productionTreeSha256(root),tree);
 const overview={productionTreeSha256:tree,before:summarize(baselines),after:summarize(matches),transitions,firstChanges,
  divergenceRoots:diagnostics,notes:['Runtime-independent outcomes; local runtime is not platform timeout evidence',
   '16 reused development scenarios, not an independent holdout','After first differing action later roots are not same-state causal comparisons']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));
 fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));
 fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(diagnostics.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={firstDifference,compact};
