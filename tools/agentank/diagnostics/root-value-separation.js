'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {SEARCH_CAPACITY}=require('../../../engine-v2/src/generated/search-config');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function aggregate(values,weights){if(!values.length||values.length!==weights.length)throw Error('EMPTY_OR_MISMATCHED_DOMAIN');
 let worst=values[0],sum=0,total=0;for(let i=0;i<values.length;i++){worst=Math.min(worst,values[i]);sum+=values[i]*weights[i];total+=weights[i];}
 if(total<=0)throw Error('NO_NOMINAL_MASS');return {worst,expected:Math.trunc(sum/total)};}
function choose(rows,tie,intentPrimary=false){let best=null,bw=0,be=0;for(const r of rows){
 const bonus=intentPrimary?r.backed-r.blend:0,w=r.worst+bonus,e=r.expected+bonus;
 if(!best||w>bw||w===bw&&(e>be||e===be&&tie(r,best))){best=r;bw=w;be=e;}
 }return best;}
function dominated(row,rows){return rows.some(r=>r.worst>=row.worst&&r.expected>=row.expected&&(r.worst>row.worst||r.expected>row.expected));}
function commitAlternative(owner,engine,incumbent,alternative){
 if(owner.intent)owner.intent.commitSelection(alternative.action);
 if(alternative.action===incumbent)return null;
 owner.result.action=alternative.action;owner.result.argument=engine.ourArguments[alternative.row];owner.result.row=alternative.row;
 return owner.result;
}
async function run(root,output){
 const active=process.argv.includes('--active');
 const intentPrimary=process.argv.includes('--worst-intent');
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const read=p=>JSON.parse(fs.readFileSync(path.join(base,p)));assert.equal(tree,read('bp317-reducer-active-verified/overview.json').productionTreeSha256);
 const targets=read('bp305-independent-admission/manifest.json').targets;
 const old=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),select=O.prototype.selectOverride,records=[],matches=[],baselines=[],transitions={},matchChanges=[];let id,seat;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,mode:active?'ROOT_WORST_THEN_EXPECTED_ACTIVE':'ROOT_WORST_THEN_EXPECTED_SHADOW',intentPlacement:intentPrimary?'PRIMARY_UNCHANGED_BONUS':'TIE_ONLY',
  scope:'root aggregation only; recursive cells retain current blend/chance/domain/budget; same owner membership; primary mode adds existing backed-minus-blend bonus to both comparison dimensions',games:32},null,2));
 try{O.prototype.selectOverride=function(engine,selected,incumbent){
  // Early returns must not consume stale root results.
  const s=this.policySearch,prepare=s.prepare,ownPrepare=Object.hasOwn(s,'prepare');let called=false;
  s.prepare=function(...args){const ok=prepare.apply(this,args);called=Boolean(ok);return ok;};
  let result;try{result=select.call(this,engine,selected,incumbent);}finally{if(ownPrepare)s.prepare=prepare;else delete s.prepare;}
  if(!called)return result;const state=engine.adapter.state,count=engine.ourCount-(engine.ourActions[engine.ourCount-1]===0?1:0),rows=[];
  for(let row=0;row<count;row++)if(this.allowedRow[row]){
   const values=[],weights=[];for(let col=0;col<engine.enemyCount;col++)if(s.rootEnemyDomainMask[col]){
    values.push(s.rootCellScore[row*SEARCH_CAPACITY.MAX_ENEMY_POLICIES+col]);weights.push(s.opponentWeight(engine,state,engine.enemyActions[col]));}
   const pair=aggregate(values,weights);assert.equal(s.blended(pair.worst,values.reduce((n,v,i)=>n+v*weights[i],0),weights.reduce((n,w)=>n+w,0)),s.rootScore[row],'AGGREGATION_DRIFT');
   rows.push({row,action:engine.ourActions[row],...pair,blend:s.rootScore[row],backed:this.backedValue[row],nominal:this.nominalValue[row],block:s.rowExactBlockMask[row]});
  }
  if(!rows.length)return result;
  const better=(r,b)=>this.better(engine,r.row,b.row,r.backed,b.backed,r.nominal,b.nominal);
  let current=rows[0];for(const r of rows.slice(1))if(better(r,current))current=r;
  assert.equal(current.action,result?result.action:incumbent,'OWNER_RECONSTRUCTION');
  const alternative=choose(rows,better,intentPrimary);
  records.push({id,seat,frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],current:current.action,alternative:alternative.action,
   changed:current.row!==alternative.row,currentDominated:dominated(current,rows),selectedBlock:alternative.block,
   frontier:rows.filter(r=>!dominated(r,rows)).map(r=>r.action),rows});return active?commitAlternative(this,engine,incumbent,alternative):result;
 };
 for(const t of targets)for(seat=0;seat<2;seat++){id=t.id;const m=await play(module,scenarios.find(s=>s.matchUrlId===id),seat,false),b=old.find(m=>m.matchUrlId===id&&m.candidateSeat===seat);
  if(!active){for(const side of ['candidate','control'])assert.equal(m[side].compactActionStream,b[side].compactActionStream,'ACTION_DRIFT');assert.equal(m.analysisOutcome,b.analysisOutcome);}
  else {matches.push(compact(m));baselines.push(b);const key=`${b.analysisOutcome}->${m.analysisOutcome}`;transitions[key]=(transitions[key]||0)+1;
   matchChanges.push({id,seat,before:b.analysisOutcome,after:m.analysisOutcome,beforeCategory:b.terminalCategory,afterCategory:m.terminalCategory,
    beforeFrames:b.frames,afterFrames:m.frames,beforeStars:b.counts.stars,afterStars:m.counts.stars});}
  assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
  console.error(`[value-separation] ${targets.indexOf(t)*2+seat+1}/32`);
 }
 }finally{O.prototype.selectOverride=select;}
 assert.equal(productionTreeSha256(root),tree);
 const changes={};for(const r of records)if(r.changed){const k=`${r.current}->${r.alternative}`;changes[k]=(changes[k]||0)+1;}
 const overview={tree,intentPlacement:intentPrimary?'PRIMARY_UNCHANGED_BONUS':'TIE_ONLY',roots:records.length,changed:records.filter(r=>r.changed).length,currentDominated:records.filter(r=>r.currentDominated).length,
  alternativesWithExactBlock:records.filter(r=>r.selectedBlock).length,changes,targetRoots:records.filter(r=>r.seat===0&&
   (r.id==='mat_I52zYeSqz1RCC3Vqs'&&r.frame===48||r.id==='mat_2oo7Bhd32HH4mziLA'&&r.frame===39)),mode:active?'ACTIVE':'SHADOW',
  ...(active?{before:summarize(baselines),after:summarize(matches),transitions,matchChanges}:{actionDrift:0,outcomeDrift:0}),
  notes:['Root worst is over retained responses and recursively blended cells, not a global safety proof','Reused development scenes; no independent holdout significance','Production bytes unchanged; experimental wrapper only']};
 if(active){const attack=list=>{let kills=0,deaths=0,fire=0;for(const m of list){const s=m.candidateSeat;
   kills+=m.counts.crashes[s^1]&&!m.counts.crashes[s]?1:0;deaths+=m.counts.crashes[s]&&!m.counts.crashes[s^1]?1:0;fire+=m.candidate.actionCounts.fire||0;}
   return {singleKills:kills,singleDeaths:deaths,fire,singleKillsPer100Fire:fire?100*kills/fire:0};};
  overview.attack={before:attack(baselines),after:attack(matches)};
  const seen=new Set(),samples=records.filter(r=>{const key=r.id+':'+r.seat;if(!r.changed||seen.has(key))return false;seen.add(key);return true;}).slice(0,32);
  fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(samples.map(JSON.stringify).join('\n')+'\n'));
  fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));
 }else fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={aggregate,choose,dominated,commitAlternative};
