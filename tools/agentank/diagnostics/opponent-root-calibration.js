'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator,actionCode}=require('../simulation/paired-arena');
function metrics(rows){
 const out={roots:rows.length,covered:0,outsideGenerated:0,filteredOut:0,emptyDomain:0,brier:0,uniformBrier:0,
  coveredNll:0,coveredUniformNll:0,zeroProbability:0,topCorrect:0,actualCounts:{},missingCounts:{},goBins:Array.from({length:10},()=>({n:0,p:0,hits:0}))};
 for(const r of rows){const weights=new Map();for(const c of r.columns)if(c.allowed)weights.set(c.action,(weights.get(c.action)||0)+c.weight);
  const total=[...weights.values()].reduce((s,w)=>s+w,0);if(!total){out.emptyDomain++;continue;}
  const p=new Map([...weights].map(([a,w])=>[a,w/total])),actual=r.actual;
  out.actualCounts[actual]=(out.actualCounts[actual]||0)+1;
  const prob=p.get(actual)||0;
  if(prob>0){out.covered++;out.coveredNll-=Math.log(prob);out.coveredUniformNll+=Math.log(p.size);}
  else{out.zeroProbability++;out.missingCounts[actual]=(out.missingCounts[actual]||0)+1;
   if(r.columns.some(c=>c.action===actual))out.filteredOut++;else out.outsideGenerated++;}
  let b=0,u=0,top=-1,best=-1;
  for(const a of new Set([...p.keys(),actual])){b+=((p.get(a)||0)-(a===actual?1:0))**2;
   u+=((p.has(a)?1/p.size:0)-(a===actual?1:0))**2;}
  for(const [a,v] of p)if(v>best){best=v;top=a;}
  out.brier+=b;out.uniformBrier+=u;out.topCorrect+=top===actual?1:0;
  const go=p.get(1)||0,bin=out.goBins[Math.min(9,Math.floor(go*10))];bin.n++;bin.p+=go;bin.hits+=actual===1?1:0;
 }
 const n=rows.length-out.emptyDomain;out.brier=n?out.brier/n:null;out.uniformBrier=n?out.uniformBrier/n:null;
 out.coveredNll=out.covered?out.coveredNll/out.covered:null;out.coveredUniformNll=out.covered?out.coveredUniformNll/out.covered:null;
 for(const b of out.goBins){b.meanPrediction=b.n?b.p/b.n:null;b.observed=b.n?b.hits/b.n:null;delete b.p;}
 return out;
}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit');
 const read=p=>JSON.parse(fs.readFileSync(path.join(base,p))),prior=read('bp317-reducer-active-verified/overview.json'),tree=productionTreeSha256(root);
 assert.equal(tree,prior.productionTreeSha256);const targets=read('bp305-independent-admission/manifest.json').targets;
 const baseline=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare,rows=[];let id,seat;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,games:32,policy:'unchanged FIXED',target:'same-frame enemy emitted command, not realized stun direction'},null,2));
 try{proto.prepare=function(engine,count,eligibility){const result=prepare.call(this,engine,count,eligibility);
  if(result)rows.push({id,seat,frame:engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME],blend:this.currentBlendBasisPoints,
   columns:Array.from({length:engine.enemyCount},(_,i)=>({action:engine.enemyActions[i],allowed:this.rootEnemyDomainMask[i],
    weight:this.opponentWeight(engine,engine.adapter.state,engine.enemyActions[i])}))});return result;};
 for(const t of targets)for(seat=0;seat<2;seat++){id=t.id;const start=rows.length;
  const match=await play(module,scenarios.find(s=>s.matchUrlId===id),seat,true),old=baseline.find(m=>m.matchUrlId===id&&m.candidateSeat===seat);
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,old[side].compactActionStream,'ACTION_DRIFT');
  assert.equal(match.analysisOutcome,old.analysisOutcome);assert.equal(match.candidate.errorCount,0);assert.equal(match.candidate.timeoutCount,0);assert.equal(match.candidateEngine.rootRestoreFailures,0);
  for(const r of rows.slice(start)){const actions=match.control.actionFrames.filter(a=>a.frame===r.frame);assert.equal(actions.length,1,'FRAME_ALIGNMENT');r.actual=actionCode(actions[0].command);}
  console.error(`[root-calibration] ${targets.indexOf(t)*2+seat+1}/32`);
 }
 }finally{proto.prepare=prepare;}
 assert.equal(productionTreeSha256(root),tree);
 const overview={tree,metrics:metrics(rows),perMatch:targets.flatMap(t=>[0,1].map(seat=>({id:t.id,seat,...metrics(rows.filter(r=>r.id===t.id&&r.seat===seat))}))),
  notes:['Probabilities are normalized policy weights, not claimed calibrated probabilities',
   'NLL conditional on covered labels; zero probability labels counted separately (unconditional NLL infinite)',
   'Uniform comparison uses exactly the same allowed domain; no parameter fitting','Correlated roots on reused development scenarios; no independent significance claim']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(rows.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(overview.metrics,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={metrics};
