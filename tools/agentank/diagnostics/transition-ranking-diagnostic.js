'use strict';
const assert=require('node:assert/strict');
const {FastState,ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {FAST_STATUS,CHANCE,NONE_FRAME,NONE_CELL}=require('../../../engine-v2/src/abi/fast-codes');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyLeafEvaluator}=require('../../../engine-v2/src/base-policy-specialized/policy-leaf');
const D=require('./semantic-performance-design');
const {command,chanceCount}=require('./terminal-risk-simulator-oracle');
const COMPONENTS=['star-score','star-route','projectile','attack','position','status'];
const DIRECTIONS=['up','right','down','left'];
const EFFECTS={stun:A.TANK_STUN_UNTIL,freeze:A.TANK_FROZEN_UNTIL,poison:A.TANK_POISON_UNTIL,shield:A.TANK_SHIELD_UNTIL,overload:A.TANK_OVERLOAD_UNTIL,cloak:A.TANK_CLOAK_UNTIL,boost:A.TANK_BOOST_UNTIL};
const remaining=(deadline,frame)=>deadline===NONE_FRAME||deadline==null?0:Math.max(0,deadline-frame);
const sorted=xs=>xs.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
function fastView(state,frame=state.arrays[A.SCALAR][S.FRAME]){
 const a=state.arrays,point=cell=>cell===NONE_CELL?null:[state.x(cell),state.y(cell)];
 return {terrain:Array.from(a[A.TERRAIN].slice(0,state.cells)),tanks:[0,1].map(i=>({position:point(a[A.TANK_CELL][i]),direction:DIRECTIONS[a[A.TANK_DIR][i]],crashed:Boolean(a[A.TANK_CRASH][i]),stars:a[A.TANK_STARS][i],skillReady:remaining(a[A.TANK_SKILL_READY][i],frame),bombReady:remaining(a[A.TANK_BOMB_READY][i],frame),fireLock:remaining(a[A.TANK_FIRE_LOCK][i],frame),effects:Object.fromEntries(Object.entries(EFFECTS).map(([k,id])=>[k,remaining(a[id][i],frame)]))})),
 projectiles:sorted(Array.from(a[A.PROJECTILE_ACTIVE]).flatMap((v,i)=>v?[{owner:a[A.PROJECTILE_OWNER][i],position:point(a[A.PROJECTILE_CELL][i]),direction:DIRECTIONS[a[A.PROJECTILE_DIR][i]]}]:[])),
 bombs:sorted(Array.from(a[A.BOMB_ACTIVE]).flatMap((v,i)=>v?[{owner:a[A.BOMB_OWNER][i],position:point(a[A.BOMB_CELL][i]),remaining:remaining(a[A.BOMB_EXPLODE][i],frame)}]:[])),star:point(a[A.SCALAR][S.STAR_CELL])};
}
function simView(sim,seat,frame=sim.frame){
 const terrain=[];for(let y=0;y<sim.map[0].length;y++)for(let x=0;x<sim.map.length;x++)terrain.push({'.':0,x:1,m:2,o:3}[sim.map[x][y]]);
 return {terrain,tanks:[seat,seat^1].map(i=>{const p=sim.players[i];return {position:p.position.slice(),direction:p.direction,crashed:p.crashed,stars:p.stars,skillReady:remaining(p.skillCooldownUntil,frame),bombReady:remaining(p.bombCooldownUntil||0,frame),fireLock:remaining(p.fireLockedUntil||0,frame),effects:Object.fromEntries(Object.keys(EFFECTS).map(k=>{const e=[p.effects.self,p.effects.debuff].find(e=>e?.type===k);return[k,remaining(e?.expiresAt,frame)];}))};}),
 projectiles:sorted(sim.bullets.filter(p=>!p.crashed).map(p=>({owner:p.ownerIndex^seat,position:p.position.slice(),direction:p.direction}))),
 bombs:sorted(sim.bombs.filter(p=>!p.exploded).map(p=>({owner:p.ownerIndex^seat,position:p.position.slice(),remaining:remaining(p.explodesAt,frame)}))),star:sim.star?.slice()||null};
}
function differences(a,b,prefix=''){
 if(JSON.stringify(a)===JSON.stringify(b))return[];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
  return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differences(a[k],b[k],prefix?prefix+'.'+k:k));
 }
 return[{field:prefix,model:a??null,reference:b??null}];
}
function cloneState(frozen){const s=new FastState(frozen.width,frozen.height);frozen.arrays.forEach((a,i)=>s.arrays[i].set(a));s.initializeHash();return s;}
function physicalHash(s){return D.hash(JSON.stringify(s.arrays.map((a,i)=>i===A.TANK_RUNTIME?[0,0]:Array.from(a))));}
function summarizeLeaves(leaves){
 const out={count:leaves.length,terminalCount:0,heuristicCount:0,meanComponents:Object.fromEntries(COMPONENTS.map(k=>[k,0])),meanPathAdjustment:0};
 for(const l of leaves){if(l.kind==='terminal'){out.terminalCount++;continue;}out.heuristicCount++;l.components.forEach((v,i)=>out.meanComponents[COMPONENTS[i]]+=v);out.meanPathAdjustment+=l.pathAdjustment;}
 if(out.heuristicCount){for(const k of COMPONENTS)out.meanComponents[k]/=out.heuristicCount;out.meanPathAdjustment/=out.heuristicCount;}
 return out;
}
function auditTransitions(sim,seat,engine,root,maxBranches,referenceStep){
 const state=cloneState(root.state),search=new NativeBasePolicySearch(),leaf=new NativeBasePolicyLeafEvaluator();
 search.bindIsolatedHard({state,kernel:{stationaryOccupiedBlockEnabled:1}});const kernel=search.diagnosticKernel;
 const frame=sim.frame, initialModel=fastView(state),initialReference=simView(sim,seat),initialDifferences=differences(initialModel,initialReference);
 const hash=physicalHash(state),simHash=D.hash(JSON.stringify(simView(sim,seat)));
 const actions=root.rows.filter(r=>r.hardAllowed&&r.finalAllowed&&[0,1,2,3,4,5,8].includes(r.action));
 const unique=[...new Map(actions.map(r=>[r.action,r])).values()],cells=[];
 let phaseTrace;
 for(const [name,label,before]of [['expireEffects','expiry',false],['advanceProjectiles','actions',true],['advanceProjectiles','projectiles',false],['resolveBombs','bombs',false]]){
  const old=kernel[name].bind(kernel);kernel[name]=(...args)=>{if(before)phaseTrace[label]=fastView(state,frame);const result=old(...args);if(!before)phaseTrace[label]=fastView(state,frame);return result;};
 }
 for(const own of unique)for(const enemyAction of [0,1,2,3,4,5,8]){
  const n0=chanceCount(sim.players[seat],frame,own.action),n1=chanceCount(sim.players[seat^1],frame,enemyAction);
  for(let c0=0;c0<n0;c0++)for(let c1=0;c1<n1;c1++){
   assert.ok(cells.length<maxBranches,'TRANSITION_CAP');
   const mark=state.deltaUsed*1024+state.eventUsed;phaseTrace={};
   const modelOwnChance=search.chanceAlternatives(state,0,own.action)>1?c0:CHANCE.NORMAL;
   const modelEnemyChance=search.chanceAlternatives(state,1,enemyAction)>1?c1:CHANCE.NORMAL;
   const status=kernel.applyFrame(own.action,own.argument,enemyAction,NONE_CELL,modelOwnChance,modelEnemyChance);
   const applied=status===FAST_STATUS.APPLIED||status===FAST_STATUS.APPLIED_TERMINAL;
   const raw=applied?fastView(state,frame+1):null;
   if(applied)search.extendV1StunCountdown(state,own.action,enemyAction,frame);
   const predicted=applied?fastView(state,frame+1):null;
   let leafComponents=null;if(applied){const value=leaf.evaluate(state);leafComponents={value,components:Array.from(leaf.lastComponents)};}
   const modelEvents=Array.from({length:state.eventUsed-(mark%1024)},(_,i)=>{const n=mark%1024+i;return{phase:state.eventPhase[n],type:state.eventType[n],entity:state.eventEntity[n],reason:state.eventReason[n]};});
   const failureReason=kernel.failureReason;state.undoTo(mark);assert.equal(physicalHash(state),hash,'MODEL_RESTORE');
   const codes=seat===0?[own.action,enemyAction]:[enemyAction,own.action],chances=seat===0?[c0,c1]:[c1,c0],queue=[];
   for(let i=0;i<2;i++)if(chanceCount(sim.players[i],frame,codes[i])>1)queue.push(chances[i]===0?.25:.75);
   let calls=0;const copy=sim.clone({starProvider:()=>null,rng:()=>{calls++;return queue[calls-1]??.5;}}),referenceTrace={};
   for(const [name,label,before]of [['expireEffects','expiry',false],['moveBullets','actions',true],['moveBullets','projectiles',false],['explodeDueBombs','bombs',false]]){
    const old=copy[name].bind(copy);copy[name]=(...args)=>{if(before)referenceTrace[label]=simView(copy,seat,frame);const r=old(...args);if(!before)referenceTrace[label]=simView(copy,seat,frame);return r;};
   }
   const events=referenceStep.call(copy,codes.map(command),[]),actual=simView(copy,seat,frame+1);
   const randomAligned=calls===queue.length;
   const diff=applied?differences(predicted,actual):[];
   const spawnSuppressed=!sim.star||events.some(e=>e.type==='star'&&e.action==='collected');
   const classification=initialDifferences.length?'INPUT_PARTIAL_OR_DIFFERENT':!applied?'MODEL_UNSUPPORTED':!randomAligned||spawnSuppressed?'REFERENCE_SCOPE_UNRESOLVED':diff.length?'TRANSITION_MISMATCH':'TRANSITION_MATCH';
   const phaseDifferences=['expiry','actions','projectiles','bombs'].flatMap(phase=>phaseTrace[phase]&&referenceTrace[phase]?differences(phaseTrace[phase],referenceTrace[phase]).map(d=>({phase,...d})):[]);
   cells.push({ownAction:own.action,enemyAction,chance0:c0,chance1:c1,modelOwnChance,modelEnemyChance,ownerAllowed:own.ownerAllowed,status,failureReason,classification,randomCalls:calls,expectedRandomCalls:queue.length,spawnSuppressed,differences:diff,firstComparablePhaseDifference:phaseDifferences[0]||null,rawDifferenceCount:raw?differences(raw,actual).length:null,compatibilityChanged:raw?differences(raw,predicted):[],predicted,reference:actual,modelEvents,referenceEvents:events,leaf:leafComponents});
  }
 }
 assert.equal(D.hash(JSON.stringify(simView(sim,seat))),simHash,'REFERENCE_ROOT_MUTATED');
 return {initialModel,initialReference,initialDifferences,branches:cells.length,cells};
}
async function runJob(job,{root:repo,readFrozen}){
 const cohort=JSON.parse(readFrozen(job.cohortFile)),data=JSON.parse(readFrozen(job.datasetFile)),item=cohort.find(r=>r.case===job.case),frozen=data.cases.find(r=>r.case===job.case);
 assert.ok(item&&frozen);const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 assert.equal(arena.productionTreeSha256(repo),job.productionTree);
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');const oldEnemy=V3DiagnosticBot.prototype.decide;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>oldEnemy.call(this,c));};
 const event=await require('./strategic-event-simulator').load(repo);assert.deepEqual(event.identity,job.simulatorIdentity);
 let simulator,activeBot,captured=null,transitions=null;const traces={cells:[],leaves:[]};
 const oldDecide=Bot.prototype.decide;
 Bot.prototype.decide=function(context){
  activeBot=this;
  if(!this.bp409){this.bp409=true;const s=this.engine.basePolicy.policySearch,rootCell=s.rootCell.bind(s),leaf=s.leaf.bind(s),terminal=s.pairedTerminalUtility.bind(s);
   const atTarget=()=>this.engine.adapter.state.arrays[A.SCALAR][S.FRAME]===frozen.root.frame;
   s.rootCell=(engine,row,column)=>{
    if(!atTarget())return rootCell(engine,row,column);
    const from=traces.leaves.length,before={nodes:s.nodes,budget:s.leafBudgetCount,fast:s.fastIncompleteCount,hard:s.hardIncompleteCount,depth:s.depthLeafCount,policy:s.hardRejectPolicyCount};
    const value=rootCell(engine,row,column);
    traces.cells.push({row,column,ownAction:engine.ourActions[row],enemyAction:engine.enemyActions[column],weight:s.opponentWeight(engine,engine.adapter.state,engine.enemyActions[column]),value,nominal:s.lastNominalValue,nodes:s.nodes-before.nodes,budgetLeaves:s.leafBudgetCount-before.budget,fastIncomplete:s.fastIncompleteCount-before.fast,hardIncomplete:s.hardIncompleteCount-before.hard,depthLeaves:s.depthLeafCount-before.depth,policyRejects:s.hardRejectPolicyCount-before.policy,leavesFrom:from,leavesTo:traces.leaves.length});return value;
   };
   s.leaf=(engine,pathScore=0,top=0)=>{const value=leaf(engine,pathScore,top);if(this.bp409Frame===frozen.root.frame&&s.currentRootMatrixIndex>=0){assert.ok(traces.leaves.length<job.maxLeafRecords,'LEAF_RECORD_CAP');const components=Array.from(s.leafEvaluator.lastComponents);traces.leaves.push({kind:'heuristic',matrix:s.currentRootMatrixIndex,top,frame:engine.adapter.state.arrays[A.SCALAR][S.FRAME],value,components,pathScore,pathAdjustment:value-Math.max(-25000,Math.min(25000,components.reduce((a,b)=>a+b,0)))});}return value;};
   s.pairedTerminalUtility=(...args)=>{const value=terminal(...args);if(this.bp409Frame===frozen.root.frame&&s.currentRootMatrixIndex>=0)traces.leaves.push({kind:'terminal',matrix:s.currentRootMatrixIndex,terminal:args[1],depth:args[2],value,crashes:Array.from(args[0].adapter.state.arrays[A.TANK_CRASH]),stars:Array.from(args[0].adapter.state.arrays[A.TANK_STARS])});return value;};
  }
  // Wrappers consult this per-decision field, including recursive search frames.
  this.bp409Frame=context.game.frames;
  return oldDecide.call(this,context);
 };
 // captureRoot occurs after production selection. Do not change any engine state.
 Bot.prototype.captureRoot=function(context){if(context.game.frames!==frozen.root.frame)return;
  const e=this.engine,s=e.basePolicy.policySearch,state=e.adapter.state,active=Boolean(this.searchEvidenceCurrent);
  assert.equal(physicalHash(state),frozen.root.state.physicalSha256,'FROZEN_ROOT_DRIFT');
  const rows=Array.from(e.ourActions).slice(0,e.ourCount).map((action,row)=>({row,action,argument:e.ourArguments[row],hardAllowed:e.hardStatus[row]===0,finalAllowed:Boolean(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,row,e.ourCount)),ownerAllowed:active?Boolean(e.basePolicy.owner.allowedRow[row]):null,membership:active?e.basePolicy.owner.membership[row]:null,searchIncluded:active?Boolean(s.rootDomainMask[row]):null,rootScore:active&&s.rootDomainMask[row]?s.rootScore[row]:null,backedValue:active&&e.basePolicy.owner.membership[row]===5?e.basePolicy.owner.backedValue[row]:null}));
  captured={case:job.case,frame:context.game.frames,selected:e.lastSelectedRow,selectedAction:e.ourActions[e.lastSelectedRow],incumbent:e.lastIncumbentRow,proposal:e.lastProposalRow,searchActive:active,searchEntry:this.searchEntry,blend:s.currentBlendBasisPoints,rows,state:{width:state.width,height:state.height,arrays:state.arrays.map(x=>Array.from(x))},trace:traces};
  assert.equal(captured.selectedAction,frozen.root.selectedAction);
 };
 const module=event.wrap({},sim=>{simulator=sim;const step=sim.step.bind(sim);sim.step=(actions,decisions)=>{
  if(sim.frame===frozen.root.frame){assert.ok(captured);transitions=auditTransitions(sim,item.seat,activeBot.engine,captured,job.maxBranches,event.original.AgenTankSimulator.prototype.step);}
  return step(actions,decisions);
 };});
 const row=await arena.play(module,item.scene,item.seat,true);assert.ok(captured&&transitions);assert.equal(D.signature(row),D.signature(item.reference),'BASELINE_REPLAY_DRIFT');
 delete row.candidateEngine.rootFrames;delete row.control.actionFrames;
 for(const r of captured.rows){const cells=traces.cells.filter(c=>c.row===r.row);if(!cells.length)continue;const worst=Math.min(...cells.map(c=>c.value)),weight=cells.reduce((n,c)=>n+c.weight,0),expected=Math.trunc(cells.reduce((n,c)=>n+c.value*c.weight,0)/weight),reconstructed=worst+Math.trunc((expected-worst)*captured.blend/10000);assert.equal(reconstructed,r.rootScore,'ROOT_SCORE_RECONSTRUCTION');r.decomposition={worst,expected,blend:captured.blend,reconstructed,intentAdjustment:r.backedValue===null?null:r.backedValue-r.rootScore,leafSummary:summarizeLeaves(cells.flatMap(c=>traces.leaves.slice(c.leavesFrom,c.leavesTo)))};}
 const healthy=[row.candidate,row.control].every(x=>x.errorCount===0&&x.timeoutCount===0)&&row.candidateEngine.rootRestoreFailures===0;
 assert.equal(arena.productionTreeSha256(repo),job.productionTree);
 return {games:1,integrityPassed:true,safetyPassed:healthy,case:job.case,baselineSignature:D.hash(D.signature(row)),row,captured,transitions,nonGameWork:{singleStepComparisons:transitions.branches,maximum:job.maxBranches,leafRecords:traces.leaves.length},scope:'Historical local diagnostic; transition reference is not platform truth and no strategy gain is claimed.'};
}
module.exports={fastView,simView,differences,cloneState,physicalHash,summarizeLeaves,runJob};
