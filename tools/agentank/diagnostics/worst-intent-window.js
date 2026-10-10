'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {SEARCH_CAPACITY}=require('../../../engine-v2/src/generated/search-config');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {aggregate,choose,commitAlternative}=require('./root-value-separation');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {loadCohort}=require('./v2-native-initiative-arena'),{loadSimulator}=require('../simulation/paired-arena');
function inside(frame,start,length){return frame>=start&&frame<start+length;}
async function run(root,output,observer=null){
 const audit=process.argv.includes('--adjacent-audit');
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const read=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n+'/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const baseline=read('bp317-reducer-active-verified'),full=read('bp326-worst-intent-active'),single=read('bp328-worst-intent-intervention');
 assert.equal(tree,JSON.parse(fs.readFileSync(path.join(base,'bp326-worst-intent-active/overview.json'))).tree);
 const all=JSON.parse(fs.readFileSync(path.join(base,'bp327-worst-intent-divergence/overview.json'))).records;
 const keys=['mat_CMkgDDXF8PQFgTPUT:0','mat_GPIOLVbooHm3yDnkH:1','mat_GwN4smjNsEC3Ed9G6:0','mat_7j82fyujttV51dL8o:1'];
 const targets=(audit?keys.slice(0,2):keys).map(k=>all.find(r=>r.id+':'+r.seat===k)),windows=audit?[128]:[1,2,4,8,128];
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const original=O.prototype.selectOverride,results=[],matches=[],traces=[],cells=[];let target,length,trace;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:targets.map(t=>t.id+':'+t.seat),windows,games:targets.length*windows.length,audit,scope:'frame windows from first divergence; fixed default suffix; diagnostic only'},null,2));
 try{O.prototype.selectOverride=function(engine,selected,incumbent){
  const s=this.policySearch,prepare=s.prepare,own=Object.hasOwn(s,'prepare');let called=false;
  const rootFrame=engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
  const inspect=audit&&(target.seat===0?[21,22,23]:[15,16,22]).includes(rootFrame);
  s.prepare=function(...args){const cell=this.rootCell,ownCell=Object.hasOwn(this,'rootCell');
   if(inspect)this.rootCell=function(e,row,col){const before={nodes:this.nodes,budget:this.leafBudgetCount,depth:this.depthLeafCount,fast:this.fastIncompleteCount,policy:this.hardRejectPolicyCount};
    const value=cell.call(this,e,row,col);cells.push({id:target.id,seat:target.seat,frame:rootFrame,row,col,action:e.ourActions[row],enemy:e.enemyActions[col],value,
     nodesBefore:before.nodes,nodesAfter:this.nodes,budget:this.perRootBudget,budgetLeaves:this.leafBudgetCount-before.budget,depthLeaves:this.depthLeafCount-before.depth,fastIncomplete:this.fastIncompleteCount-before.fast,policyLeaves:this.hardRejectPolicyCount-before.policy});return value;};
   try{const ok=prepare.apply(this,args);called=Boolean(ok);return ok;}finally{if(inspect){if(ownCell)this.rootCell=cell;else delete this.rootCell;}}
  };
  let result;try{result=original.call(this,engine,selected,incumbent);}finally{if(own)s.prepare=prepare;else delete s.prepare;}
  if(!called)return result;
  const state=engine.adapter.state,frame=state.arrays[ARRAY.SCALAR][SCALAR.FRAME],rows=[];
  const count=engine.ourCount-(engine.ourActions[engine.ourCount-1]===0?1:0);
  for(let row=0;row<count;row++)if(this.allowedRow[row]){const values=[],weights=[];
   for(let c=0;c<engine.enemyCount;c++)if(s.rootEnemyDomainMask[c]){values.push(s.rootCellScore[row*SEARCH_CAPACITY.MAX_ENEMY_POLICIES+c]);weights.push(s.opponentWeight(engine,state,engine.enemyActions[c]));}
   rows.push({row,action:engine.ourActions[row],...aggregate(values,weights),blend:s.rootScore[row],backed:this.backedValue[row],nominal:this.nominalValue[row]});}
  if(!rows.length)return result;
  const better=(a,b)=>this.better(engine,a.row,b.row,a.backed,b.backed,a.nominal,b.nominal);
  let current=rows[0];for(const r of rows.slice(1))if(better(r,current))current=r;
  assert.equal(current.action,result?result.action:incumbent);
  const alternative=choose(rows,better,true),active=inside(frame,target.frame,length),i=this.intent;
  if(observer)observer({owner:this,engine,rows,current,alternative,frame,id:target.id,seat:target.seat});
  if(frame>=target.frame)trace.push({frame,current:current.action,alternative:alternative.action,active,changed:active&&current.action!==alternative.action,
   proposed:i.currentProposed,committed:i.currentCommitted,committedAction:i.currentCommittedAction,contextEpoch:i.contextEpoch,...(inspect?{rows}: {})});
  return active?commitAlternative(this,engine,incumbent,alternative):result;
 };
 for(target of targets)for(length of windows){trace=[];
  const b=baseline.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat),scenario=scenarios.find(s=>s.matchUrlId===target.id);assert.equal(scenario.fingerprint,b.scenarioFingerprint);
  const m=await play(module,scenario,target.seat,false);assert.ok(prefixMatches(b,m,target.frame,target.alternative.action));
  assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
  if(length===1||length===128){const expected=(length===1?single:full).find(x=>x.matchUrlId===target.id&&x.candidateSeat===target.seat&&(length!==1||x.intervention==='SUBSTITUTE'));
   for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,expected[side].compactActionStream,'ENDPOINT_ACTION_DRIFT');assert.deepEqual(m[side].compactArguments,expected[side].compactArguments);}
   assert.equal(m.analysisOutcome,expected.analysisOutcome);assert.deepEqual(m.counts,expected.counts);}
  const applied=trace.filter(r=>r.changed);results.push({id:target.id,seat:target.seat,start:target.frame,length,outcome:m.analysisOutcome,frames:m.frames,category:m.terminalCategory,
   fire:m.candidate.actionCounts.fire||0,overrides:applied.length,overrideFrames:applied.map(r=>r.frame),actions:applied.map(r=>[r.current,r.alternative])});
  const enemy=Buffer.from(m.control.compactActionStream,'base64');for(const r of trace)r.actualEnemyCommand=enemy[r.frame];
  matches.push({...compact(m),window:length});traces.push({id:target.id,seat:target.seat,length,trace});console.error(`[window] ${matches.length}/${targets.length*windows.length}`);
 }
 }finally{O.prototype.selectOverride=original;}
 assert.equal(productionTreeSha256(root),tree);
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,results,...(audit?{cells,roots:traces.flatMap(t=>t.trace.filter(r=>r.rows).map(r=>({id:t.id,seat:t.seat,...r})))}:{}),checks:{endpointEquivalent:audit?2:8,commonPrefixes:matches.length,errors:0,timeouts:0,restoreFailures:0},notes:['No window selected as production parameter','Selected development cases, not win-rate evidence','Recorded changed rows are proposals; final gate remains authoritative']},null,2));
 for(const [name,data] of [['matches',matches],['diagnostic-samples',traces]])fs.writeFileSync(path.join(output,name+'.ndjson.gz'),zlib.gzipSync(data.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(results,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={inside,run};
