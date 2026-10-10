'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {NativeBasePolicyLeafEvaluator:Leaf,COMPONENT_NAME}=require('../../../engine-v2/src/base-policy-specialized/policy-leaf');
const {FastState,ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const {SEARCH_CAPACITY}=require('../../../engine-v2/src/generated/search-config');
const {ThinLayerExecutor}=require('./thin-layer-executor'),{FixedSnapshot}=require('./search-transaction-workspace');
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena'),{loadSimulator}=require('../simulation/paired-arena');
function reflect(state){const out=new FastState(state.width,state.height);for(let i=0;i<state.arrays.length;i++)out.arrays[i].set(state.arrays[i]);
 const cell=c=>c===NONE_CELL?c:Math.floor(c/state.width)*state.width+state.width-1-c%state.width;
 for(let c=0;c<state.cells;c++)out.arrays[ARRAY.TERRAIN][cell(c)]=state.arrays[ARRAY.TERRAIN][c];
 for(const k of [ARRAY.TANK_CELL,ARRAY.PROJECTILE_CELL,ARRAY.BOMB_CELL])for(let i=0;i<out.arrays[k].length;i++)out.arrays[k][i]=cell(state.arrays[k][i]);
 for(const k of [ARRAY.TANK_DIR,ARRAY.PROJECTILE_DIR])for(let i=0;i<out.arrays[k].length;i++)out.arrays[k][i]=(4-state.arrays[k][i])&3;
 out.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]=cell(state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]);return out;
}
function pose(s){return {cells:Array.from(s.arrays[ARRAY.TANK_CELL]),directions:Array.from(s.arrays[ARRAY.TANK_DIR]),star:s.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL]};}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),tree=productionTreeSha256(root);
 const prior=JSON.parse(fs.readFileSync(path.join(base,'bp334-layered-flip-audit-verified/overview.json')));assert.equal(tree,prior.tree);const targets=prior.records.filter(r=>r.frame===2);assert.equal(targets.length,9);
 const old=zlib.gunzipSync(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/matches.ndjson.gz'))).toString().trim().split('\n').map(JSON.parse);
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios,{module}=await loadSimulator(root);
 const prepare=S.prototype.prepare,select=O.prototype.selectOverride,records=[];let target,record;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:targets.map(({id,seat,frame})=>({id,seat,frame})),games:9,scope:'isolated complete depth1 leaf decomposition and horizontal reflection'},null,2));
 try{S.prototype.prepare=function(engine,count,eligibility){const state=engine.adapter.state;if(state.arrays[ARRAY.SCALAR][SCALAR.FRAME]!==2)return prepare.call(this,engine,count,eligibility);
  this.bindIsolatedHard(engine.adapter.bundle);const objects=[this,this.diagnosticKernel,this.diagnosticHard,this.leafEvaluator,this.pathUtility,state],snapshots=objects.map(o=>new FixedSnapshot(o));snapshots.forEach((s,i)=>s.capture(objects[i]));
  const physical=state.arrays.map(a=>a.slice()),oldH=this.diagnosticHazard,oldHH=this.diagnosticHard.hazard,cell=this.rootCell,leaf=this.leaf,ownCell=Object.hasOwn(this,'rootCell'),ownLeaf=Object.hasOwn(this,'leaf');let context=null;
  record={id:target.id,seat:target.seat,before:target.before,after:target.after,root:pose(state),width:state.width,height:state.height,lastAction:engine.lastAction,turnStreak:engine.turnStreak,controlMode:engine.lastControlMode,distance:engine.manhattan(state.arrays[ARRAY.TANK_CELL][0],state.arrays[ARRAY.TANK_CELL][1]),line:engine.clearLine(state.arrays[ARRAY.TANK_CELL][0],state.arrays[ARRAY.TANK_CELL][1]),enemyStunUntil:state.arrays[ARRAY.TANK_STUN_UNTIL][1],leaves:[],matrix:[]};
  try{this.diagnosticHazard=new HazardKernel(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:4,reverseLatticeIncludesOwnProjectiles:true,hazardSignatureCache:true});this.diagnosticHard.hazard=this.diagnosticHazard;
   this.rootCell=function(e,row,col){context={row,col,action:e.ourActions[row],enemy:e.enemyActions[col]};const value=cell.call(this,e,row,col);record.matrix.push({...context,value});return value;};
   this.leaf=function(e,pathScore,top){const value=leaf.call(this,e,pathScore,top),components=Array.from(this.leafEvaluator.lastComponents),fresh=new Leaf();fresh.beginRoot(state);const raw=fresh.evaluate(state);assert.deepEqual(Array.from(fresh.lastComponents),components,'FRESH_LEAF_DRIFT');
    const mirrored=reflect(state),mirrorLeaf=new Leaf();mirrorLeaf.beginRoot(mirrored);const mirrorValue=mirrorLeaf.evaluate(mirrored),mirrorComponents=Array.from(mirrorLeaf.lastComponents);
    record.leaves.push({...context,...pose(state),value,pathScore,repeatPenalty:this.pathRepeatLastPenalty[top],top,raw,components,mirrorValue,mirrorComponents,mirrorEqual:raw===mirrorValue&&components.every((v,i)=>v===mirrorComponents[i])});return value;};
   const executor=new ThinLayerExecutor(this,this.diagnosticKernel,state),schedule=executor.run(engine,count,eligibility,prepare,128,1);assert.equal(schedule.completedDepth,1);
   record.work=schedule.used;record.shallowScores=Array.from(this.rootScore);record.shallowNominal=Array.from(this.rootNominalScore);record.mask=Array.from(this.rootDomainMask);
  }finally{if(ownCell)this.rootCell=cell;else delete this.rootCell;if(ownLeaf)this.leaf=leaf;else delete this.leaf;snapshots.forEach((s,i)=>s.restore(objects[i]));this.diagnosticHazard=oldH;this.diagnosticHard.hazard=oldHH;for(let i=0;i<physical.length;i++)assert.deepEqual(state.arrays[i],physical[i]);}
  const ok=prepare.call(this,engine,count,eligibility);record.currentScores=Array.from(this.rootScore);record.currentNominal=Array.from(this.rootNominalScore);return ok;
 };
 O.prototype.selectOverride=function(engine,selected,incumbent){const frame=engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME],r=select.call(this,engine,selected,incumbent);if(frame===2){record.incumbent=incumbent;record.selected=r?r.action:incumbent;record.intent={proposed:this.intent.currentProposed,committed:this.intent.currentCommitted,mappedAction:this.intent.currentCommittedAction,epoch:this.intent.contextEpoch};record.rows=[];
   for(let row=0;row<engine.ourCount;row++)if(this.allowedRow[row]&&record.mask[row])record.rows.push({row,action:engine.ourActions[row],projectedCell:engine.projectedCell[row],projectedDirection:engine.projectedDirection[row],current:record.currentScores[row],shallow:record.shallowScores[row],bonus:this.backedValue[row]-record.currentScores[row],nominal:this.nominalValue[row]});}
  return r;};
 for(target of targets){record=null;const m=await play(module,scenarios.find(s=>s.matchUrlId===target.id),target.seat,false),b=old.find(x=>x.matchUrlId===target.id&&x.candidateSeat===target.seat);
  for(const side of ['candidate','control'])assert.equal(m[side].compactActionStream,b[side].compactActionStream);assert.equal(m.analysisOutcome,b.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);assert.ok(record);records.push(record);console.error(`[early-turn] ${records.length}/9`);}
 }finally{S.prototype.prepare=prepare;O.prototype.selectOverride=select;}
 assert.equal(productionTreeSha256(root),tree);const all=records.flatMap(r=>r.leaves);const summary={roots:records.length,leaves:all.length,mirrorDifferences:all.filter(r=>!r.mirrorEqual).length,components:COMPONENT_NAME,checks:{actionDrift:0,outcomeDrift:0,restoreFailures:0}};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,summary,records},null,2));console.log(JSON.stringify({summary,roots:records.map(r=>({id:r.id,root:r.root,rows:r.rows,leaves:r.leaves.filter(l=>l.action===2||l.action===3)}))},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={reflect};
