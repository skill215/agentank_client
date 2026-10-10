'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {FixedSnapshot}=require('./search-transaction-workspace');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function rank(owner,engine,scores,nominal,adjustments,count){let best=-1,bv=-Infinity,bn=-Infinity;
 for(let i=0;i<count;i++)if(owner.allowedRow[i]){const v=scores[i]+adjustments[i],n=nominal[i]+adjustments[i];
  if(owner.better(engine,i,best,v,bv,n,bn)){best=i;bv=v;bn=n;}}
 return best;}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit');
 const read=p=>JSON.parse(fs.readFileSync(path.join(base,p))),tree=productionTreeSha256(root);
 assert.equal(tree,read('bp317-reducer-active-verified/overview.json').productionTreeSha256);
 const targets=read('bp305-independent-admission/manifest.json').targets;
 const old=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),prepare=S.prototype.prepare,select=O.prototype.selectOverride,contexts=new WeakMap(),pending=new WeakMap(),rows=[];
 let id,seat;fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,
  mode:'UNIFORM_WEIGHT_SHADOW',scope:'opponentWeight=1000 at root and recursive search; domain, blend, depth, budget unchanged',games:32},null,2));
 try{S.prototype.prepare=function(engine,count,eligibility){
  this.bindIsolatedHard(engine.adapter.bundle);const state=engine.adapter.state;let c=contexts.get(this);
  if(!c){const objects=[this,this.diagnosticKernel,this.diagnosticHard,this.leafEvaluator,this.pathUtility,state];
   c={objects,snapshots:objects.map(o=>new FixedSnapshot(o)),hazard:new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true})};contexts.set(this,c);}
  for(let i=0;i<c.objects.length;i++)c.snapshots[i].capture(c.objects[i]);
  const oldH=this.diagnosticHazard,oldHH=this.diagnosticHard.hazard,oldW=this.opponentWeight,ownW=Object.hasOwn(this,'opponentWeight');
  let scores,nominal,mask,enemyMask,nodes,uniformMs;
  try{this.diagnosticHazard=c.hazard;this.diagnosticHard.hazard=c.hazard;this.opponentWeight=()=>1000;
   const start=performance.now();prepare.call(this,engine,count,eligibility);uniformMs=performance.now()-start;
   scores=this.rootScore.slice();nominal=this.rootNominalScore.slice();mask=this.rootDomainMask.slice();enemyMask=this.rootEnemyDomainMask.slice();nodes=this.nodes;
  }finally{if(ownW)this.opponentWeight=oldW;else delete this.opponentWeight;
   for(let i=0;i<c.objects.length;i++)c.snapshots[i].restore(c.objects[i]);this.diagnosticHazard=oldH;this.diagnosticHard.hazard=oldHH;}
  const start=performance.now(),ok=prepare.call(this,engine,count,eligibility),currentMs=performance.now()-start;
  assert.deepEqual(mask,this.rootDomainMask,'OUR_DOMAIN_DRIFT');assert.deepEqual(enemyMask,this.rootEnemyDomainMask,'ENEMY_DOMAIN_DRIFT');assert.equal(nodes,this.nodes,'WORK_DRIFT');
  const record={id,seat,frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],nodes,currentMs,uniformMs,
   valueChanged:Array.from({length:count},(_,i)=>mask[i]&&scores[i]!==this.rootScore[i]).some(Boolean)};
  rows.push(record);pending.set(this,{scores,nominal,count,record});return ok;
 };
 O.prototype.selectOverride=function(engine,selected,action){pending.delete(this.policySearch);
  const result=select.call(this,engine,selected,action),p=pending.get(this.policySearch);if(!p)return result;
  const s=this.policySearch,adj=Array.from({length:p.count},(_,i)=>this.backedValue[i]-s.rootScore[i]);
  const current=rank(this,engine,s.rootScore,s.rootNominalScore,adj,p.count),uniform=rank(this,engine,p.scores,p.nominal,adj,p.count);
  if(current>=0)assert.equal(engine.ourActions[current],result?result.action:action,'OWNER_RECONSTRUCTION');
  Object.assign(p.record,{currentRow:current,uniformRow:uniform,currentAction:current<0?null:engine.ourActions[current],uniformAction:uniform<0?null:engine.ourActions[uniform],ownerChanged:current!==uniform});return result;
 };
 for(const t of targets)for(seat=0;seat<2;seat++){id=t.id;const match=await play(module,scenarios.find(s=>s.matchUrlId===id),seat,false),before=old.find(m=>m.matchUrlId===id&&m.candidateSeat===seat);
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,before[side].compactActionStream,'ACTION_DRIFT');
  assert.equal(match.analysisOutcome,before.analysisOutcome);assert.equal(match.candidate.errorCount,0);assert.equal(match.candidate.timeoutCount,0);assert.equal(match.candidateEngine.rootRestoreFailures,0);
  console.error(`[uniform-shadow] ${targets.indexOf(t)*2+seat+1}/32`);
 }
 }finally{S.prototype.prepare=prepare;O.prototype.selectOverride=select;}
 assert.equal(productionTreeSha256(root),tree);
 const changes={};for(const r of rows)if(r.ownerChanged){const k=`${r.currentAction}->${r.uniformAction}`;changes[k]=(changes[k]||0)+1;}
 const overview={tree,roots:rows.length,valueChanged:rows.filter(r=>r.valueChanged).length,ownerChanged:rows.filter(r=>r.ownerChanged).length,changes,
  targetRoots:rows.filter(r=>(r.id==='mat_I52zYeSqz1RCC3Vqs'&&r.seat===0&&r.frame===48)||(r.id==='mat_2oo7Bhd32HH4mziLA'&&r.seat===0&&r.frame===39)),
  currentMs:rows.reduce((s,r)=>s+r.currentMs,0),uniformMs:rows.reduce((s,r)=>s+r.uniformMs,0),actionDrift:0,outcomeDrift:0,
  notes:['Owner proposal, not final gate output or ACTIVE result','All nodes use uniform nominal weights; chance semantics and blend unchanged','Existing response residual remains; uniform is not full support','Fixed timing order is diagnostic only']};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(rows.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={rank};
