"use strict";
const fs=require("node:fs"), path=require("node:path"), zlib=require("node:zlib");
const crypto=require('node:crypto');
const {completeLayers}=require("./complete-layer-scheduler");
const {NativeBasePolicySearch}=require("../../../engine-v2/src/base-policy-specialized/policy-search");
const {ARRAY,SCALAR}=require("../../../engine-v2/src/state/fast-state");
const {FAST_STATUS,HARD_STATUS}=require("../../../engine-v2/src/abi/fast-codes");
const {FAST_UNSUPPORTED_REASON,JOINT_RELOCATION_DETAIL}=require("../../../engine-v2/src/fast/kernel");
const {SEARCH_CAPACITY}=require("../../../engine-v2/src/generated/search-config");
function enumName(values,value){return Object.keys(values).find(key=>values[key]===value)||`UNKNOWN_${value}`;}
const {NativeBasePolicyDiagnosticBot,play,productionTreeSha256}=require("./native-base-policy-standalone-arena");
const {prefixMatches}=require("./native-base-policy-root-action-counterfactual");
const {loadCohort}=require("./v2-native-initiative-arena");
const {loadSimulator}=require("../simulation/paired-arena");
const {ProjectileFeatureCache}=require('./projectile-feature-cache');
const {profileSearch}=require('./search-phase-profiler');
const {withLatticeCache}=require('./audited-lattice-cache');
const {SearchCommitSlab}=require('./search-commit-slab');
const {SearchTransactionWorkspace}=require('./search-transaction-workspace');
const {FixedLayerScheduler}=require('./fixed-layer-scheduler');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const STATE_FIELDS=['transitionDeltaBase','transitionEventBase','highWaterDelta','highWaterEvent'];

function supportEvidence(search) {
  return {budgetLeaves:search.lastBudgetLeafCount,fastIncomplete:search.lastFastIncompleteCount,
    hardIncomplete:search.lastHardIncompleteCount,noAction:search.lastNoActionLeafCount,
    topLimit:search.lastTopLeafCount,depthLeaves:search.lastDepthLeafCount};
}
function sampleRoots(matches,perOutcome) {
  const output=[];
  for(const outcome of ['V2_WIN','DRAW','V1_WIN']) {
    const pool=matches.filter(m=>m.analysisOutcome===outcome).flatMap(m=>
      (m.candidateEngine.rootFrames||[]).filter(r=>r.searchEvidenceCurrent).map(r=>({
        matchUrlId:m.matchUrlId,candidateSeat:m.candidateSeat,baselineOutcome:outcome,root:r,
        rank:crypto.createHash('sha256').update(`layer-cost-v1:${m.scenarioFingerprint}:${m.candidateSeat}:${r.frame}`).digest('hex')})))
      .sort((a,b)=>a.rank.localeCompare(b.rank));
    const seen=new Set();let count=0;
    for(const item of pool){const key=`${item.matchUrlId}:${item.candidateSeat}`;
      if(seen.has(key))continue;seen.add(key);output.push(item);if(++count===perOutcome)break;}
  }
  return output;
}

function snapshot(object) {
  const values={};
  for(const [key,value] of Object.entries(object))
    if(ArrayBuffer.isView(value)) values[key]=value.slice();
    else if(typeof value==='number'||typeof value==='boolean') values[key]=value;
  return values;
}
function restore(object,values) {
  for(const [key,value] of Object.entries(values))
    if(ArrayBuffer.isView(value)) object[key].set(value); else object[key]=value;
}

function prepareLayered(search,engine,count,eligibility,prepare,limit=128,depthCap=4,admit=null) {
  search.bindIsolatedHard(engine.adapter.bundle);
  const state=engine.adapter.state,kernel=search.diagnosticKernel;
  if(process.argv.includes('--thin-layer-executor')){
    const thin=search.diagnosticThinExecutor||(search.diagnosticThinExecutor=new ThinLayerExecutor(search,kernel,state));
    return thin.run(engine,count,eligibility,prepare,limit,depthCap,admit).diagnostic();
  }
  const workspace=process.argv.includes('--transaction-workspace')?
    (search.diagnosticTransactionWorkspace||(search.diagnosticTransactionWorkspace=new SearchTransactionWorkspace(search,kernel,state))):null;
  if(workspace){if(workspace.state!==state||workspace.kernel!==kernel)throw Error('TRANSACTION_BINDING_DRIFT');workspace.begin();}
  const mark=state.deltaUsed*1024+state.eventUsed;
  const stateFields=STATE_FIELDS;
  const savedFields=workspace?null:Object.fromEntries(stateFields.map(k=>[k,state[k]]));
  const hash=workspace?null:[state.hashLo,state.hashHi];
  const stateArrays=workspace?null:state.arrays.map(a=>a.slice());
  const baseline=workspace?null:snapshot(search),kernelBaseline=workspace?null:snapshot(kernel);
  const commitSlab=workspace||process.argv.includes('--commit-slab')?
    (search.diagnosticCommitSlab||(search.diagnosticCommitSlab=new SearchCommitSlab(search))):null;
  if(commitSlab)commitSlab.valid=0;
  const scheduled=search.scheduledDepth,cell=search.rootCell,apply=kernel.applyFrame;
  const hard=search.diagnosticHard,classify=hard.classifyApplied;
  const maximumDepth=Math.min(depthCap,scheduled.call(search,engine));
  const cacheMode=process.argv.includes('--verify-projectile-cache')?'verify':
    process.argv.includes('--projectile-cache')?'on':'off';
  const evaluator=search.leafEvaluator,projectile=evaluator.projectileThreat;
  const featureCache=cacheMode==='off'?null:new ProjectileFeatureCache(state);
  if(featureCache)evaluator.projectileThreat=function(s,owner){return featureCache.evaluate(s,owner,projectile,this,cacheMode==='verify');};
  let result;
  const fixed=process.argv.includes('--fixed-layer-control')?
    (search.diagnosticFixedScheduler||(search.diagnosticFixedScheduler=new FixedLayerScheduler())):null;
  const runLayers=fixed?fixed.execute:completeLayers;
  const priorTransitions=new Set();
  try {
    result=runLayers(limit,maximumDepth,(depth,spend)=>{
      const transitionFailures={},failureReasons={},witnesses=[];
      const transitions=new Set();let repeatedWithin=0,repeatedEarlierLayer=0;
      if(workspace)workspace.restoreSearch();else restore(search,baseline);
      search.scheduledDepth=()=>depth;
      search.rootCell=function(...args){this.perRootBudget=0x3fffffff;return cell.apply(this,args);};
      kernel.applyFrame=function(...args){spend();
        const key=`${state.hashLo}:${state.hashHi}:${args.join(':')}`;
        if(transitions.has(key))repeatedWithin++;else transitions.add(key);
        if(priorTransitions.has(key))repeatedEarlierLayer++;
        const status=apply.apply(this,args);
        if(status!==FAST_STATUS.APPLIED&&status!==FAST_STATUS.APPLIED_TERMINAL)
        {transitionFailures[status]=(transitionFailures[status]||0)+1;
          const reason=enumName(FAST_UNSUPPORTED_REASON,this.failureReason);
          failureReasons[reason]=(failureReasons[reason]||0)+1;
          if(witnesses.length<8)witnesses.push({type:'FAST',status,reason,
            detail:enumName(JOINT_RELOCATION_DETAIL,this.failureDetail),actions:args,
            frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],
            cells:Array.from(state.arrays[ARRAY.TANK_CELL]),directions:Array.from(state.arrays[ARRAY.TANK_DIR])});}
        return status;};
      hard.classifyApplied=function(...args){const result=classify.apply(this,args);
        if(result===HARD_STATUS.INCOMPLETE&&witnesses.length<8)witnesses.push({type:'HARD',
          frame:state.arrays[ARRAY.SCALAR][SCALAR.FRAME],cells:Array.from(state.arrays[ARRAY.TANK_CELL]),
          viable:this.lastViable,hazardComplete:this.hazard.complete,narrowProofComplete:this.hazard.narrowProofComplete,
          horizon:this.hazard.horizonTick,maxTicks:this.hazard.maxTicks});
        return result;};
      try {
        const ok=prepare.call(search,engine,count,eligibility);
        const complete=Boolean(ok&&!search.lastBudgetLeafCount&&!search.lastFastIncompleteCount&&
          !search.lastHardIncompleteCount&&!search.lastNoActionLeafCount&&!search.lastTopLeafCount);
        const matrix=[];
        for(let row=0;row<count;row++)if(search.rootDomainMask[row]) {
          const responses=[];
          for(let col=0;col<engine.enemyCount;col++)if(search.rootEnemyDomainMask[col])responses.push({
            action:engine.enemyActions[col],value:search.rootCellScore[row*SEARCH_CAPACITY.MAX_ENEMY_POLICIES+col],
            weight:search.opponentWeight(engine,state,engine.enemyActions[col])});
          matrix.push({action:engine.ourActions[row],value:search.rootScore[row],responses});
        }
        if(complete&&commitSlab)commitSlab.capture(search);
        return {complete,value:complete?(commitSlab||snapshot(search)):null,
          evidence:{...supportEvidence(search),transitionFailures,failureReasons,witnesses,matrix,
            blend:search.currentBlendBasisPoints,
            transitionReuse:{uniqueHashKeys:transitions.size,repeatedWithin,repeatedEarlierLayer}}};
      } finally {
        for(const key of transitions)priorTransitions.add(key);
        if(workspace)workspace.rollback();else {state.undoTo(mark);
        Object.assign(state,savedFields);restore(kernel,kernelBaseline);
        if(state.hashLo!==hash[0]||state.hashHi!==hash[1])throw Error('ROOT_HASH_RESTORE');
        for(let i=0;i<state.arrays.length;i++)
          if(!state.arrays[i].every((v,j)=>v===stateArrays[i][j]))throw Error('ROOT_ARRAY_RESTORE');}
      }
    },admit);
    if(result.committed&&commitSlab)commitSlab.restore(search);
    else if(workspace)workspace.restoreSearch();else restore(search,result.committed||baseline);
    if(featureCache)result.featureCache={calls:featureCache.calls,hits:featureCache.hits,
      misses:featureCache.misses,bytes:featureCache.bytes(),mode:cacheMode};
    return result;
  } finally {
    search.scheduledDepth=scheduled;search.rootCell=cell;kernel.applyFrame=apply;hard.classifyApplied=classify;
    evaluator.projectileThreat=projectile;
    if(workspace){try{if(!result){workspace.rollback();workspace.restoreSearch();}}finally{workspace.end();}}
  }
}

async function run(root,input,output) {
  const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:Number(process.argv[i+1]);};
  const budget=option('--work-budget',128),depthCap=option('--max-depth',4);
  if(!Number.isSafeInteger(budget)||budget<0||budget>65536||!Number.isSafeInteger(depthCap)||depthCap<1||depthCap>4)
    throw Error('INVALID_BUDGET_OR_DEPTH');
  const oracle=JSON.parse(fs.readFileSync(input));
  const currentTree=productionTreeSha256(root);
  const transitionAt=process.argv.indexOf('--source-transition-from');
  const transitionFrom=transitionAt<0?null:process.argv[transitionAt+1];
  if(transitionFrom!==null&&transitionFrom!==oracle.productionTreeSha256)throw Error('INVALID_SOURCE_TRANSITION');
  if(oracle.productionTreeSha256!==currentTree&&transitionFrom!==oracle.productionTreeSha256)throw Error('SOURCE_DRIFT');
  const matches=zlib.gunzipSync(fs.readFileSync(path.join(oracle.input.directory,'matches.ndjson.gz')))
    .toString().trim().split('\n').map(JSON.parse);
  const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
  const {module}=await loadSimulator(root);
  const sampleCount=option('--sample-per-outcome',0);
  if(!Number.isSafeInteger(sampleCount)||sampleCount<0||sampleCount>32)throw Error('INVALID_SAMPLE');
  const regressionAt=process.argv.indexOf('--regressions-from');
  const regressionSource=regressionAt<0?null:JSON.parse(fs.readFileSync(process.argv[regressionAt+1]));
  if(regressionSource&&regressionSource.productionTreeSha256!==oracle.productionTreeSha256)throw Error('REGRESSION_SOURCE_DRIFT');
  const targets=regressionSource?regressionSource.records.filter(r=>r.mode==='LAYERED'&&r.baselineOutcome==='V2_WIN'&&r.outcome!=='V2_WIN')
    .map(r=>({matchUrlId:r.id,candidateSeat:r.seat,root:{frame:r.frame}})):
    sampleCount?sampleRoots(matches,sampleCount):oracle.records.filter(r=>r.recoverable&&r.root.searchEvidenceCurrent&&r.baselineOutcome!==r.oracle.terminal.outcome);
  const proto=NativeBasePolicySearch.prototype;
  const prepare=proto.prepare,columns=proto.buildRootColumnSequence,capture=NativeBasePolicyDiagnosticBot.prototype.captureRoot;
  const records=[];
  try {
    for(const target of targets)for(const mode of sampleCount?['CURRENT','LAYERED','LAYERED_REVERSE']:['LAYERED','LAYERED_REVERSE']) {
      const reverse=mode==='LAYERED_REVERSE';
      let scheduling,decision;
      proto.prepare=function(engine,count,eligibility){
        if(engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]!==target.root.frame)
          return prepare.call(this,engine,count,eligibility);
        const execute=()=>{
        if(mode==='CURRENT') {
          this.bindIsolatedHard(engine.adapter.bundle);
          const kernel=this.diagnosticKernel,apply=kernel.applyFrame;let used=0;
          kernel.applyFrame=function(...args){used++;return apply.apply(this,args);};
          try {const ok=prepare.call(this,engine,count,eligibility);
            scheduling={used,completedDepth:null,attempts:[{depth:this.currentDepth,work:used,
              status:'BASELINE_APPROXIMATE',evidence:supportEvidence(this)}]};return ok;
          } finally {kernel.applyFrame=apply;}
        }
        scheduling=prepareLayered(this,engine,count,eligibility,prepare,budget,depthCap);
        return scheduling.completedDepth>0?1:0;
        };
        const measured=()=>{
          if(!process.argv.includes('--profile-phases'))return execute();
          const result=profileSearch(this,engine,execute);scheduling.profile=result.profile;return result.value;
        };
        const entries=option('--lattice-cache',0);
        if(!entries)return measured();
        if(![1,2,4,8,16].includes(entries))throw Error('INVALID_LATTICE_ENTRIES');
        const result=withLatticeCache(this,engine,entries,process.argv.includes('--verify-lattice'),measured);
        scheduling.latticeCache=result.cache;return result.value;
      };
      proto.buildRootColumnSequence=function(engine){
        const result=columns.call(this,engine);
        if(reverse&&engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]===target.root.frame)
          this.rootColumnSequence.subarray(0,engine.enemyCount).reverse();
        return result;
      };
      NativeBasePolicyDiagnosticBot.prototype.captureRoot=function(context){
        if(this.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME]!==target.root.frame)return;
        capture.call(this,context,null);decision=this.rootFrames.pop();
      };
      const scenario=scenarios.find(s=>s.matchUrlId===target.matchUrlId);
      const match=await play(module,scenario,target.candidateSeat,true);
      const source=matches.find(m=>m.matchUrlId===target.matchUrlId&&m.candidateSeat===target.candidateSeat);
      const selected=decision.candidates.find(r=>r.row===decision.selected).action;
      if(!prefixMatches(source,match,target.root.frame,selected))throw Error('PREFIX_MISMATCH');
      if(mode==='CURRENT')for(const side of ['candidate','control'])
        if(source[side].compactActionStream!==match[side].compactActionStream)throw Error('BASELINE_DRIFT');
      records.push({id:target.matchUrlId,seat:target.candidateSeat,frame:target.root.frame,reverse,mode,
        baselineOutcome:source.analysisOutcome,
        used:scheduling.used,completedDepth:scheduling.completedDepth,attempts:scheduling.attempts,
        featureCache:scheduling.featureCache||null,
        profile:scheduling.profile||null,
        latticeCache:scheduling.latticeCache||null,
        selected,outcome:match.analysisOutcome,rows:decision.candidates.filter(r=>r.action!==0),
        restoreFailures:match.candidateEngine.rootRestoreFailures});
      if(records.length%6===0)console.error(`[complete-layer] ${records.length}/${targets.length*(sampleCount?3:2)}`);
    }
  }finally{proto.prepare=prepare;proto.buildRootColumnSequence=columns;NativeBasePolicyDiagnosticBot.prototype.captureRoot=capture;}
  if(productionTreeSha256(root)!==currentTree)throw Error('SOURCE_CHANGED_DURING_RUN');
  fs.writeFileSync(output,JSON.stringify({productionTreeSha256:currentTree,
    baselineProductionTreeSha256:transitionFrom,budget,depthCap,
    workUnit:'kernel.applyFrame calls (not policyValue nodes or wall time)',records},null,2)+'\n');
  console.log(JSON.stringify({output,roots:targets.length,runs:records.length,
    completedDepths:records.filter(r=>r.mode!=='CURRENT').map(r=>r.completedDepth)},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2],process.argv[3]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={prepareLayered,sampleRoots,supportEvidence,run};
