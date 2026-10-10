'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function traceCell(search,engine,run){
 const events=[],stack=[],restore=[];let next=0;
 const push=e=>{if(events.length>=4096)throw Error('TRACE_CAPACITY');events.push(e);};
 const wrap=(object,key,handler)=>{const old=object[key],own=Object.hasOwn(object,key);object[key]=function(...args){return handler.call(this,old,args);};
  restore.push(()=>{if(own)object[key]=old;else delete object[key];});};
 const state=engine.adapter.state;
 const pose=()=>({frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],cells:Array.from(state.arrays[ARRAY.TANK_CELL]),crashes:Array.from(state.arrays[ARRAY.TANK_CRASH])});
 wrap(search,'transitionValue',function(old,args){const id=++next,parent=stack.at(-1)||0;
  const event={type:'transition',id,parent,actions:[args[1],args[3]],depth:args[5],top:args[6],nodesBefore:this.nodes,...pose()};
  push(event);stack.push(id);try{event.value=old.apply(this,args);event.nominal=this.lastNominalValue;event.nodesAfter=this.nodes;return event.value;}finally{stack.pop();}});
 wrap(search,'pairedLeaf',function(old,args){const value=old.apply(this,args);push({type:'leaf',parent:stack.at(-1),value,pathScore:args[1],top:args[3],nodes:this.nodes,budget:this.perRootBudget,...pose()});return value;});
 wrap(search,'terminalUtility',function(old,args){const value=old.apply(this,args);push({type:'terminal',parent:stack.at(-1),code:args[1],value,depth:args[2],...pose()});return value;});
 wrap(search,'generate',function(old,args){const count=old.apply(this,args),top=args[1],seat=args[2],actions=seat?this.deepEnemyActions:this.deepOurActions;
  push({type:'domain',parent:stack.at(-1)||0,top,seat,actions:Array.from(actions.slice(top*6,top*6+count)),...pose()});return count;});
 wrap(search.diagnosticKernel,'applyFrame',function(old,args){const before=pose(),status=old.apply(this,args);push({type:'apply',parent:stack.at(-1),actions:args, status,before,after:pose()});return status;});
 try{return {value:run(),events};}finally{for(const undo of restore.reverse())undo();}
}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const base=path.join(root,'artifacts/native-causal-audit'),read=p=>JSON.parse(fs.readFileSync(path.join(base,p)));
 const prior=read('bp317-reducer-active-verified/overview.json'),tree=productionTreeSha256(root);assert.equal(tree,prior.productionTreeSha256);
 const targets=prior.firstChanges.filter(r=>['mat_I52zYeSqz1RCC3Vqs','mat_2oo7Bhd32HH4mziLA'].includes(r.id));
 const baseline=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare,traces=[];let target;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,scope:'selected root action against enemy GO, original budget/order'},null,2));
 try{proto.prepare=function(engine,count,eligibility){
  if(engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]!==target.frame)return prepare.call(this,engine,count,eligibility);
  const cell=this.rootCell;this.rootCell=function(e,row,col){
   if(e.ourActions[row]!==target.after||e.enemyActions[col]!==1)return cell.call(this,e,row,col);
   const trace=traceCell(this,e,()=>cell.call(this,e,row,col));traces.push({id:target.id,frame:target.frame,...trace});return trace.value;
  };try{return prepare.call(this,engine,count,eligibility);}finally{delete this.rootCell;}
 };
 for(target of targets){const match=await play(module,scenarios.find(s=>s.matchUrlId===target.id),target.seat,false),old=baseline.find(m=>m.matchUrlId===target.id&&m.candidateSeat===target.seat);
  for(const side of ['candidate','control'])assert.equal(match[side].compactActionStream,old[side].compactActionStream,'TRACE_ACTION_DRIFT');
  assert.equal(match.analysisOutcome,old.analysisOutcome);assert.equal(match.candidate.errorCount,0);assert.equal(match.candidate.timeoutCount,0);assert.equal(match.candidateEngine.rootRestoreFailures,0);
 }
 }finally{proto.prepare=prepare;}
 assert.equal(traces.length,2);assert.equal(productionTreeSha256(root),tree);
 const summary=traces.map(t=>({id:t.id,value:t.value,events:t.events.length,transitions:t.events.filter(e=>e.type==='transition').length,
  terminals:t.events.filter(e=>e.type==='terminal'),leaves:t.events.filter(e=>e.type==='leaf'),domains:t.events.filter(e=>e.type==='domain')}));
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,summary,actionDrift:0,outcomeDrift:0},null,2));
 fs.writeFileSync(path.join(output,'traces.ndjson.gz'),zlib.gzipSync(traces.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={traceCell};
