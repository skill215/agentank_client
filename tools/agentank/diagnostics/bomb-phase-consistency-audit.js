'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {loadSimulator}=require('../simulation/paired-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {play,NativeBasePolicyDiagnosticBot:B,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {V3DiagnosticBot}=require('../../../engine-v3/src');
const {withClock}=require('./deterministic-v1-clock');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
async function run(root,out){assert.ok(!fs.existsSync(out));const {module}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(['mat_HT5bQROODWk50q4Fp'],root),P=module.AgenTankSimulator.prototype,step=P.step,v1=V3DiagnosticBot.prototype.decide,decide=B.prototype.decide,select=E.prototype.selectIncumbent,work=new WeakMap(),evidence=[];let current;
 try{P.step=function(actions,decisions){const f=this.frame;if(f>=28){current={frame:f,actions:structuredClone(actions),before:structuredClone({players:this.players,bombs:this.bombs,bullets:this.bullets})};}const events=step.call(this,actions,decisions);if(f>=28){current.events=structuredClone(events);current.result=this.result;current.after=structuredClone({players:this.players,bombs:this.bombs,bullets:this.bullets});evidence.push(current);}return events;};
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>v1.call(this,c));};E.prototype.selectIncumbent=function(n){const row=select.call(this,n);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,n,row);};
 const observations=[];B.prototype.decide=function(c){const e=this.engine,emit=e.emit;if(c.game.frames>=28)e.emit=function(me,a){const arrays=e.adapter.state.arrays;observations.push({frame:c.game.frames,action:a,raw:structuredClone(c),stateFrame:arrays[ARRAY.SCALAR][SCALAR.FRAME],bombs:Array.from(arrays[ARRAY.BOMB_ACTIVE]).flatMap((active,i)=>active?[{cell:arrays[ARRAY.BOMB_CELL][i],explode:arrays[ARRAY.BOMB_EXPLODE][i],placed:arrays[ARRAY.BOMB_PLACED][i]}]:[]),ownCell:arrays[ARRAY.TANK_CELL][0],gap:e.adapter.informationGapMask});return emit.call(e,me,a);};try{return decide.call(this,c);}finally{e.emit=emit;}};
 const match=await play(module,scenarios[0],0,false);assert.equal(match.frames,32);assert.equal(match.analysisOutcome,'V1_WIN');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({tree:productionTreeSha256(root),match,observations,evidence},null,2));console.log(JSON.stringify(evidence.map(e=>({frame:e.frame,actions:e.actions,bombs:e.before.bombs,events:e.events})),null,2));
 }finally{P.step=step;V3DiagnosticBot.prototype.decide=v1;B.prototype.decide=decide;E.prototype.selectIncumbent=select;}}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
