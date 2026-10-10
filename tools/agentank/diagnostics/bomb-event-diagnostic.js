'use strict';
const assert=require('node:assert/strict');
const base=require('./paired-label-diagnostic');
const D=require('./semantic-performance-design');
const {cloneState,fastView,simView,differences,physicalHash}=require('./transition-ranking-diagnostic');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyLeafEvaluator}=require('../../../engine-v2/src/base-policy-specialized/policy-leaf');
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {chanceCount}=require('./terminal-risk-simulator-oracle');
const directions=['up','right','down','left'],dx=[0,1,0,-1],dy=[-1,0,1,0];
function actionCode(a){if(!a)return 0;if(a.type==='turn')return a.side==='left'?2:3;return {go:1,fire:4,throwBomb:5,stun:8}[a.type]??-1;}
// Static geometry only. This is not a tactical survival proof: enemies, projectiles,
// new terrain destruction and future skill effects are outside this route model.
function geometricEscape(map,pose,blastCells,blocked=null,speed=1,allowReverse=false){
 const danger=new Set(blastCells.map(p=>p.join(','))),queue=[{...pose,moves:0,path:[]}],seen=new Set();
 while(queue.length){const s=queue.shift(),key=[s.x,s.y,s.direction].join(',');if(seen.has(key))continue;seen.add(key);
  if(!danger.has([s.x,s.y].join(',')))return {moves:s.moves,path:s.path,visited:seen.size};
  for(const a of [1,2,3,...(allowReverse?[6]:[])]){
   let {x,y,direction}=s;
   if(a===2)direction=(direction+3)%4;else if(a===3)direction=(direction+1)%4;
   else for(let step=0;step<speed;step++){
    const sign=a===6?-1:1,nx=x+sign*dx[direction],ny=y+sign*dy[direction],tile=map[nx]?.[ny];
    if(!tile||tile==='x'||tile==='m'||(blocked&&nx===blocked[0]&&ny===blocked[1]))break;x=nx;y=ny;
   }
   if(!seen.has([x,y,direction].join(',')))queue.push({x,y,direction,moves:s.moves+1,path:[...s.path,a]});
  }
 }
 return {moves:null,path:null,visited:seen.size};
}
function escapeAt(sim,seat,bomb){
 const p=sim.players[seat],pose={x:p.position[0],y:p.position[1],direction:directions.indexOf(p.direction)},cells=sim.bombBlastCells(bomb.position),available=bomb.explodesAt-sim.frame+1;
 const boost=p.effects.self?.type==='boost'&&p.effects.self.expiresAt>sim.frame;
 const stun=p.effects.debuff?.type==='stun'&&p.effects.debuff.expiresAt>sim.frame;
 const free=geometricEscape(sim.map,pose,cells,null,boost?2:1,stun),fixed=geometricEscape(sim.map,pose,cells,sim.players[seat^1].position,boost?2:1,stun);
 return {available,blastCells:cells,free,fixed,freeSlack:free.moves===null?null:available-free.moves,fixedSlack:fixed.moves===null?null:available-fixed.moves,scope:'Static movement geometry; stun motion treated optimistically; excludes projectile danger and future opponent actions.'};
}
async function runJob(job,context){
 const previous=JSON.parse(context.readFrozen(job.previousFile));assert.equal(job.eventSeed,previous.eventSeed);assert.equal(job.action,previous.action);
 const dataset=JSON.parse(context.readFrozen(job.datasetFile)),frozen=dataset.cases.find(c=>c.case===job.case),frame=frozen.root.frame,seat=frozen.seat;
 const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot;
 const search=new NativeBasePolicySearch(),model=cloneState(frozen.root.state);search.bindIsolatedHard({state:model,kernel:{stationaryOccupiedBlockEnabled:1}});
 const leaf=new NativeBasePolicyLeafEvaluator(),trace=[],cells=[],leafStats=[];
 let simulator,bot,bomb,chainValid=true,firstModelDifference=null,work=0;
 const originalDecide=Bot.prototype.decide;
 Bot.prototype.decide=function(c){
  this.captureRoots=true;this.bp412Frame=c.game.frames;bot=this;
  if(!this.bp412){this.bp412=true;const s=this.engine.basePolicy.policySearch,root=s.rootCell.bind(s),pl=s.leaf.bind(s);let cell=null;
   s.rootCell=(e,r,col)=>{
    if(this.bp412Frame<frame||this.bp412Frame>job.endFrame)return root(e,r,col);
    const record={frame:this.bp412Frame,row:r,ownAction:e.ourActions[r],enemyAction:e.enemyActions[col],nodesBefore:s.nodes,budgetBefore:s.leafBudgetCount,depthBefore:s.depthLeafCount,leafCount:0,leafTopCounts:{},leafMin:null,leafMax:null};cell=record;
    const value=root(e,r,col);record.value=value;record.nominal=s.lastNominalValue;record.nodes=s.nodes-record.nodesBefore;record.budgetLeaves=s.leafBudgetCount-record.budgetBefore;record.depthLeaves=s.depthLeafCount-record.depthBefore;cells.push(record);cell=null;return value;
   };
   s.leaf=(...args)=>{const value=pl(...args);if(cell){const top=args[2]??0;cell.leafCount++;cell.leafTopCounts[top]=(cell.leafTopCounts[top]||0)+1;cell.leafMin=cell.leafMin===null?value:Math.min(cell.leafMin,value);cell.leafMax=cell.leafMax===null?value:Math.max(cell.leafMax,value);}return value;};
  }
  return originalDecide.call(this,c);
 };
 Bot.prototype.captureRoot=function(c){
  if(c.game.frames<frame||c.game.frames>job.endFrame)return;
  const e=this.engine,s=e.basePolicy.policySearch,state=e.adapter.state;
  assert.ok(trace.length<job.maxFrames,'TRACE_FRAME_CAP');
  if(c.game.frames===frame){assert.equal(physicalHash(state),frozen.root.state.physicalSha256);bomb=simulator.bombs.find(b=>b.ownerIndex===seat&&!b.exploded&&b.explodesAt===job.endFrame);assert.ok(bomb,'KNOWN_BOMB_MISSING');bomb={...bomb,position:bomb.position.slice()};}
  const snap=cloneState({width:state.width,height:state.height,arrays:state.arrays});const rawLeaf=leaf.evaluate(snap);
  const view=fastView(state),ref=simView(simulator,seat);
  const center=state.cell(...bomb.position),minimum=leaf.minimumBombEscape(snap,0,center,Math.min(10,job.endFrame-c.game.frames+1));
  const rowData=Array.from(e.ourActions).slice(0,e.ourCount).map((a,i)=>({row:i,action:a,hard:e.hardStatus[i],finalAllowed:Boolean(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,i,e.ourCount)),acceptable:e.riskController.outcome.acceptable[i],immediate:e.riskController.outcome.immediateFatalMass[i],horizon:e.riskController.outcome.horizonFatalMass[i],committed:e.riskController.outcome.committedFatalMass?.[i]??null,escapeSlack:e.riskController.outcome.escapeSlack[i],membership:this.searchEvidenceCurrent?e.basePolicy.owner.membership[i]:null,rootScore:cells.some(x=>x.frame===c.game.frames&&x.row===i)?s.rootScore[i]:null,backedValue:this.searchEvidenceCurrent&&e.basePolicy.owner.membership[i]===5?e.basePolicy.owner.backedValue[i]:null}));
  trace.push({frame:c.game.frames,selectedAction:e.ourActions[e.lastSelectedRow],controlMode:e.lastControlMode,searchActive:this.searchEvidenceCurrent,searchEntry:this.searchEntry,depth:s.currentDepth,view,reference:ref,inputDifferences:differences(view,ref),leaf:{value:rawLeaf,components:Array.from(leaf.lastComponents),bombPressure:leaf.bombPressure(snap,0),minimumBombEscape:minimum},escape:escapeAt(simulator,seat,bomb),rows:rowData});
 };
 const eventModule=require('./strategic-event-simulator'),load=eventModule.load;
 eventModule.load=async root=>{
  const event=await load(root),wrap=event.wrap;
  event.wrap=(rng,observe)=>wrap(rng,sim=>{
   observe(sim);simulator=sim;const step=sim.step.bind(sim);
   sim.step=(actions,decisions)=>{
    if(sim.frame<frame||sim.frame>job.endFrame)return step(actions,decisions);
    const f=sim.frame,record=trace.at(-1);assert.equal(record.frame,f);const commanded=JSON.parse(JSON.stringify(actions)),codes=commanded.map(actionCode);assert.ok(codes.every(a=>a>=0));
    if(f===frame)assert.equal(codes[seat^1],2,'OPPONENT_FIRST_NOT_LEFT');
    record.commanded=commanded;record.actionCodes=codes;
    const chances=sim.players.map((p,i)=>chanceCount(p,f,codes[i])>1?(eventModule.eventUniform(job.eventSeed,f,'stun',i)<.5?0:1):0);
    if(chainValid){assert.ok(++work<=job.maxFrames);const status=search.diagnosticKernel.applyFrame(codes[seat],65535,codes[seat^1],65535,chances[seat],chances[seat^1]);
     record.modelStatus=status;record.modelFailure=search.diagnosticKernel.failureReason;
     if([1,2].includes(status)){search.extendV1StunCountdown(model,codes[seat],codes[seat^1],f);record.modelAfter=fastView(model,f+1);}else chainValid=false;
    }
    const result=step(actions,decisions);record.events=result;record.normalized=JSON.parse(JSON.stringify(actions));record.referenceAfter=simView(sim,seat,f+1);record.result=sim.result;
    record.modelDifferences=record.modelAfter?differences(record.modelAfter,record.referenceAfter):null;
    if(record.modelDifferences?.length&&firstModelDifference===null)firstModelDifference=f;
    record.firstModelDifference=firstModelDifference;
    record.knownBombExploded=result.some(e=>e.type==='bomb'&&e.action==='exploded'&&e.objectId===bomb.objectId);
    return result;
   };
  });return event;
 };
 const result=await base.runJob(job,context);
 assert.equal(result.signature,previous.signature,'FULL_REPLAY_DRIFT');assert.equal(trace.length,job.maxFrames,'EVENT_WINDOW_INCOMPLETE');assert.ok(trace.at(-1).knownBombExploded,'KNOWN_BOMB_NOT_REACHED');
 return {...result,eventTrace:trace,rootCells:cells,knownBomb:bomb,nonGameWork:{continuousShadowSteps:work,maximum:job.maxFrames,staticGeometryQueries:trace.length*2},scope:'Diagnostic replay of BP411 seeds with actual opponent LEFT at the root. Static escape geometry is not a survival proof; shadow model follows observed commands and random events, not new minimax search.'};
}
module.exports={actionCode,geometricEscape,escapeAt,runJob};
