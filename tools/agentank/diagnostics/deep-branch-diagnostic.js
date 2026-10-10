'use strict';
const assert = require('node:assert/strict');
const {ARRAY:A,SCALAR:S} = require('../../../engine-v2/src/state/fast-state');
const {fastView,simView,differences,physicalHash} = require('./transition-ranking-diagnostic');
const {command,chanceCount} = require('./terminal-risk-simulator-oracle');
const D = require('./semantic-performance-design');

function classifyBranch(branch, parent) {
  if (![1,2].includes(branch.status)) return 'MODEL_UNSUPPORTED';
  if (branch.scopeUnknown || parent?.scopeUnknown) return 'REFERENCE_SCOPE_UNRESOLVED';
  if (parent?.firstDivergence != null) return 'INHERITED_DIVERGENCE';
  if (branch.beforeDifferences.length) return 'INPUT_DIFFERENT';
  return branch.differences.length ? 'FIRST_DIVERGENCE' : 'MATCH';
}
function referenceBranch(sim, seat, args, step) {
  const codes = seat === 0 ? [args[0],args[2]] : [args[2],args[0]];
  const chances = seat === 0 ? [args[4],args[5]] : [args[5],args[4]];
  const queue=[];
  for(let i=0;i<2;i++) if(chanceCount(sim.players[i],sim.frame,codes[i])>1) queue.push(chances[i]===0?.25:.75);
  let calls=0, spawnCalls=0;
  const copy=sim.clone({starProvider:()=>{spawnCalls++;return null;},rng:()=>queue[calls++]??.5});
  const alreadyTerminal=Boolean(sim.result), events=step.call(copy,codes.map(command),[]);
  return {copy,events,calls,expectedCalls:queue.length,spawnCalls,scopeUnknown:alreadyTerminal||spawnCalls>0||calls!==queue.length};
}
async function runJob(job,{root,readFrozen}) {
  const cohort=JSON.parse(readFrozen(job.cohortFile)), dataset=JSON.parse(readFrozen(job.datasetFile));
  const item=cohort.find(x=>x.case===job.case), frozen=dataset.cases.find(x=>x.case===job.case);
  const previous=JSON.parse(readFrozen(job.previousFile));
  const arena=require('./native-base-policy-standalone-arena'), Bot=arena.NativeBasePolicyDiagnosticBot;
  assert.equal(arena.productionTreeSha256(root),job.productionTree);
  const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
  const enemyDecide=V3DiagnosticBot.prototype.decide;
  V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemyDecide.call(this,c));};
  const event=await require('./strategic-event-simulator').load(root);
  assert.deepEqual(event.identity,job.simulatorIdentity);
  let simulator, enabled=false, captured;
  const nodes=[], branches=[], stack=[], referenceCopies=new Map();
  const decide=Bot.prototype.decide;
  Bot.prototype.decide=function(context) {
    const bot=this, search=this.engine.basePolicy.policySearch;
    this.bp410Frame=context.game.frames;
    if(!this.bp410Installed) {
      this.bp410Installed=true;
      const bind=search.bindIsolatedHard.bind(search);
      search.bindIsolatedHard=(bundle)=>{
        bind(bundle);
        const kernel=search.diagnosticKernel;
        if(kernel.bp410Installed)return;
        kernel.bp410Installed=true;
        const classify=search.diagnosticHard.classifyApplied.bind(search.diagnosticHard);
        search.diagnosticHard.classifyApplied=()=>{const result=classify();if(enabled)branches[stack.at(-1).activeBranch].hard=result;return result;};
        const apply=kernel.applyFrame.bind(kernel);
        kernel.applyFrame=(...args)=>{
          if(!enabled)return apply(...args);
          assert.ok(branches.length<job.maxBranches,'BRANCH_CAP');
          const node=stack.at(-1);assert.equal(node.kind,'transitionValue');
          const parent=branches[node.parentBranch]||null;
          const source=parent?referenceCopies.get(parent.id):simulator;
          const beforeFrame=bundle.state.arrays[A.SCALAR][S.FRAME];
          const before=fastView(bundle.state), referenceBefore=simView(source,item.seat);
          const b={id:branches.length,node:node.id,parent:parent?.id??null,top:node.top,args,beforeFrame,before,referenceBefore,beforeDifferences:differences(before,referenceBefore)};
          branches.push(b);node.branches.push(b.id);node.activeBranch=b.id;
          b.status=apply(...args);b.failureReason=kernel.failureReason;
          const ref=referenceBranch(source,item.seat,args,event.original.AgenTankSimulator.prototype.step);
          referenceCopies.set(b.id,ref.copy);
          b.reference=simView(ref.copy,item.seat,beforeFrame+1);b.referenceResult=ref.copy.result;
          b.referenceEvents=ref.events;b.randomCalls=ref.calls;b.expectedRandomCalls=ref.expectedCalls;b.spawnCalls=ref.spawnCalls;
          b.scopeUnknown=ref.scopeUnknown||Boolean(parent?.scopeUnknown);
          if(![1,2].includes(b.status)){b.differences=[];b.classification=classifyBranch(b,parent);}
          return b.status;
        };
      };
      const extend=search.extendV1StunCountdown.bind(search);
      search.extendV1StunCountdown=(...args)=>{
        const value=extend(...args);
        if(enabled){const n=stack.at(-1),b=branches[n.activeBranch],p=branches[b.parent];
          b.model=fastView(args[0],b.beforeFrame+1);b.terminal=args[0].arrays[A.SCALAR][S.TERMINAL_CODE];
          b.differences=differences(b.model,b.reference);
          b.classification=classifyBranch(b,p);
          b.firstDivergence=p?.firstDivergence??(['FIRST_DIVERGENCE','INPUT_DIFFERENT'].includes(b.classification)?b.id:null);
        }
        return value;
      };
      for(const kind of ['transitionValue','policyValue','worstReply','leaf','pairedLeaf','pairedTerminalUtility']) {
        const original=search[kind].bind(search);
        search[kind]=(...args)=>{
          if(!enabled)return original(...args);
          assert.ok(nodes.length<job.maxNodes,'NODE_RECORD_CAP');
          const parent=stack.at(-1), transition=[...stack].reverse().find(n=>n.kind==='transitionValue');
          const n={id:nodes.length,kind,parent:parent?.id??null,parentBranch:transition?.activeBranch??null,args:args.slice(1),children:[],branches:[],nodesBefore:search.nodes,budget:search.perRootBudget};
          if(kind==='transitionValue'){n.top=args[6];n.weight=search.opponentWeight(args[0],args[0].adapter.state,args[3]);}
          if(kind==='policyValue')n.cutoff=search.nodes+1>=search.perRootBudget?'budget':args[1]<=0?'depth':args[2]>=4?'top':null;
          nodes.push(n);if(parent)parent.children.push(n.id);stack.push(n);
          try{n.value=original(...args);n.nominal=search.lastNominalValue;n.nodesAfter=search.nodes;
            if(kind==='leaf'){n.components=Array.from(search.leafEvaluator.lastComponents);n.pathAdjustment=n.value-Math.max(-25000,Math.min(25000,n.components.reduce((a,b)=>a+b,0)));}
            return n.value;
          }finally{stack.pop();}
        };
      }
      const rootCell=search.rootCell.bind(search);
      search.rootCell=(engine,row,column)=>{
        if(bot.bp410Frame!==frozen.root.frame||!job.actions.includes(engine.ourActions[row]))return rootCell(engine,row,column);
        assert.equal(physicalHash(engine.adapter.state),frozen.root.state.physicalSha256,'ROOT_DRIFT');
        const simHash=D.hash(JSON.stringify(simView(simulator,item.seat))),from=nodes.length;
        enabled=true;let value;try{value=rootCell(engine,row,column);}finally{enabled=false;}
        assert.equal(D.hash(JSON.stringify(simView(simulator,item.seat))),simHash,'LIVE_REFERENCE_MUTATED');
        const old=previous.captured.trace.cells.find(c=>c.ownAction===engine.ourActions[row]&&c.enemyAction===engine.enemyActions[column]);
        assert.ok(old);assert.equal(value,old.value,'ROOT_CELL_DRIFT');assert.equal(search.lastNominalValue,old.nominal,'NOMINAL_DRIFT');
        nodes[from].root={row,column,ownAction:engine.ourActions[row],enemyAction:engine.enemyActions[column]};
        return value;
      };
    }
    return decide.call(this,context);
  };
  Bot.prototype.captureRoot=function(context){if(context.game.frames!==frozen.root.frame)return;
    const e=this.engine,s=e.basePolicy.policySearch;
    assert.equal(physicalHash(e.adapter.state),frozen.root.state.physicalSha256);
    captured={frame:context.game.frames,selectedAction:e.ourActions[e.lastSelectedRow],blend:s.currentBlendBasisPoints,depth:s.currentDepth,rows:previous.captured.rows.filter(r=>job.actions.includes(r.action)).map(r=>({action:r.action,row:r.row,score:s.rootScore[r.row],backed:e.basePolicy.owner.backedValue[r.row]}))};
    assert.equal(captured.selectedAction,frozen.root.selectedAction);
    for(const r of captured.rows)assert.equal(r.score,previous.captured.rows.find(p=>p.row===r.row).rootScore);
  };
  const row=await arena.play(event.wrap({},s=>{simulator=s;}),item.scene,item.seat,true);
  assert.ok(captured);assert.equal(D.signature(row),D.signature(item.reference),'BASELINE_DRIFT');
  assert.equal(arena.productionTreeSha256(root),job.productionTree);
  return {games:1,integrityPassed:true,safetyPassed:[row.candidate,row.control].every(x=>!x.errorCount&&!x.timeoutCount)&&!row.candidateEngine.rootRestoreFailures,case:job.case,baselineSignature:D.hash(D.signature(row)),captured,nodes,branches,nonGameWork:{clonedReferenceSteps:branches.length,maxBranches:job.maxBranches,nodeRecords:nodes.length},scope:'Visited branches of two frozen root actions; historical diagnostic, local calibrated reference only; no efficacy claim.'};
}
module.exports={classifyBranch,referenceBranch,runJob};
