'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function attribution(before,full,one){return one===full?'REPRODUCED_OUTCOME':one===before?'BASELINE_OUTCOME_RETAINED':'THIRD_OUTCOME';}
async function run(root,output){
 assert.ok(!fs.existsSync(output),'OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const p=path.join(base,'bp327-worst-intent-divergence/overview.json'),bytes=fs.readFileSync(p),targets=JSON.parse(bytes).records;
 const load=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n+'/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const baseline=load('bp317-reducer-active-verified');assert.equal(tree,JSON.parse(fs.readFileSync(path.join(base,'bp326-worst-intent-active/overview.json'))).tree);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const proto=NativeBasePolicyDiagnosticBot.prototype,capture=proto.captureRoot,results=[],matches=[],samples=[];let target,wanted,observed=0;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targetsSha256:crypto.createHash('sha256').update(bytes).digest('hex'),targets:targets.map(t=>({id:t.id,seat:t.seat,frame:t.frame})),games:24,protocol:'12 noop controls + 12 single substitutions; current default suffix only'},null,2));
 proto.captureRoot=function(context,action){if(context.game.frames!==target.frame)return;
  const i=this.engine.basePolicy.intent;assert.ok(i);assert.equal(i.lastIntentEpoch,i.contextEpoch,'INTENT_EPOCH');
  assert.equal(i.lastIntent,wanted===i.currentCommittedAction?i.currentCommitted:i.currentProposed,'INTENT_SELECTION');observed++;
  capture.call(this,context,action);
 };
 try{for(target of targets){const scenario=scenarios.find(s=>s.matchUrlId===target.id),b=baseline.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat);
  assert.equal(scenario.fingerprint,b.scenarioFingerprint);
  for(const label of ['NOOP','SUBSTITUTE']){wanted=label==='NOOP'?target.current.action:target.alternative.action;observed=0;
   const m=await play(module,scenario,target.seat,true,null,true,true,'current',false,false,1,'off',target.frame,wanted);
   assert.equal(observed,1);assert.equal(m.candidateEngine.forceApplied,1);assert.equal(m.candidateEngine.forceOriginalAction,target.current.action);
   assert.ok(prefixMatches(b,m,target.frame,wanted),'COMMON_PREFIX');
   assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
   if(label==='NOOP'){for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,b[side].compactActionStream,'NOOP_STREAM');assert.deepEqual(m[side].compactArguments,b[side].compactArguments);}
    assert.equal(m.analysisOutcome,b.analysisOutcome);assert.equal(m.frames,b.frames);assert.deepEqual(m.counts,b.counts);}
   else {results.push({id:target.id,seat:target.seat,frame:target.frame,from:target.current.action,to:wanted,before:target.before,full:target.after,one:m.analysisOutcome,category:m.terminalCategory,frames:m.frames,attribution:attribution(target.before,target.after,m.analysisOutcome)});
    samples.push({id:target.id,seat:target.seat,root:m.candidateEngine.rootFrames[0]});}
   matches.push({...compact(m),intervention:label});console.error(`[single-step] ${matches.length}/24`);
  }
 }}finally{proto.captureRoot=capture;}
 assert.equal(productionTreeSha256(root),tree);const groups={};for(const r of results){const k=r.before+'->'+r.full;const g=groups[k]||(groups[k]={});g[r.attribution]=(g[r.attribution]||0)+1;}
 const overview={tree,groups,results,checks:{noopControls:12,substitutions:12,sharedPrefixes:24,intentVerified:24,errors:0,timeouts:0,restoreFailures:0},notes:['One-step effect conditional on fixed default suffix and deterministic opponent','Matching outcome does not prove identical loss mechanism','Selected flipped-game subset is not a win-rate evaluation']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));
 for(const [name,data] of [['matches',matches],['diagnostic-samples',samples]])fs.writeFileSync(path.join(output,name+'.ndjson.gz'),zlib.gzipSync(data.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={attribution};
