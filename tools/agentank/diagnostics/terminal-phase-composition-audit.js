'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {inspectPhase,inspectEarlyTerminal}=require('./simulator-terminal-phase-witness');
const {command,chanceCount}=require('./terminal-risk-simulator-oracle');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function inspectRoot(sim,seat,step){
 const before=JSON.stringify(sim.snapshotFor(seat)),cells=[];
 assert.equal(sim.players[0].skillType,'stun');assert.equal(sim.players[1].skillType,'stun');
 for(const enemyAction of [0,1,2,3,4,5,8])for(let chance=0;chance<chanceCount(sim.players[seat^1],sim.frame,enemyAction);chance++){
  let calls=0;const expected=chanceCount(sim.players[seat^1],sim.frame,enemyAction)===2?1:0;
  const copy=sim.clone({starProvider:()=>null,rng:()=>{assert.ok(calls++<expected);return chance===0?.25:.75;}});
  const ids=new Set(copy.bullets.filter(b=>b.ownerIndex===seat).map(b=>b.objectId));
  let witness=null,phaseCalls=0,phaseMargin=null;
  const advance=copy.moveBullets;
  copy.moveBullets=function(events){phaseCalls++;phaseMargin=this.players[seat].stars-this.players[seat^1].stars;witness=inspectPhase(this,seat,ids);return advance.call(this,events);};
  step.call(copy,seat===0?[command(4),command(enemyAction)]:[command(enemyAction),command(4)],[]);
  assert.equal(calls,expected);assert.ok(phaseCalls<=1);
  if(!phaseCalls)witness=inspectEarlyTerminal(copy,seat);
  const own=copy.players[seat],enemy=copy.players[seat^1];
  const supported=['CLEAR_FRESH_SHOT','ENEMY_ALREADY_DEAD','EARLY_TERMINAL_LEADING_WIN'].includes(witness);
  if(supported){assert.equal(copy.result?.winner,seat,'WITNESS_FALSE_POSITIVE');assert.equal(enemy.crashed,true);assert.ok(own.stars>enemy.stars);}
  cells.push({enemyAction,chance,witness,phaseCalls,phaseMargin,finalMargin:own.stars-enemy.stars,supported,
   ownCrash:own.crashed,enemyCrash:enemy.crashed,winner:copy.result?.winner??null});
 }
 assert.equal(JSON.stringify(sim.snapshotFor(seat)),before);
 // If an unseen enemy bullet suppresses FIRE, its action-phase effect equals
 // NONE; the NONE branch must itself have a supported positive-margin witness.
 const none=cells.find(c=>c.enemyAction===0&&c.chance===0);
 return {cells,enemyFireSuppressionCovered:Boolean(none?.supported),allBranchesSupported:cells.every(c=>c.supported)&&Boolean(none?.supported)};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),inputs=[];
 const read=n=>{const file=path.join(base,n),bytes=fs.readFileSync(file);inputs.push({path:path.relative(root,file),sha256:hash(bytes)});return zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse);};
 const targets=read('bp360-terminal-entry-shadow/diagnostic-samples.ndjson.gz'),old=read('bp349-navigation-family-external/matches.ndjson.gz');
 const manifest=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);
 for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const {module,directory}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root);
 const step=module.AgenTankSimulator.prototype.step,select=E.prototype.selectIncumbent,work=new WeakMap(),records=[];let target,record;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,inputs,
  sources:['terminal-phase-composition-audit.js','simulator-terminal-phase-witness.js'].map(f=>({path:f,sha256:hash(fs.readFileSync(path.join(__dirname,f)))})),
  simulatorSha256:hash(fs.readFileSync(path.join(directory,'src/engine.js'))),protocol:'Observe actual pinned simulator action/ballistic boundary, including early terminal; no production override; conditional unknown-enemy-projectile monotonicity only'},null,2));
 try{
  E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
  module.AgenTankSimulator.prototype.step=function(actions,decisions){if(this.frame===target.frame){assert.equal(record,null);record=inspectRoot(this,target.seat,step);}return step.call(this,actions,decisions);};
  for(target of targets){record=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),prior=old.find(m=>m.mode==='NAVIGATION_FAMILY'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat);assert.equal(scenario.fingerprint,prior.scenarioFingerprint);
   const m=await play(module,scenario,target.seat,false);assert.ok(record);assert.equal(target.entryPremise,'CONDITIONAL_ENTRY_SUPPORTED');assert.equal(record.cells.length,target.expected);
   for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,prior[side].compactActionStream);assert.deepEqual(m[side].compactArguments,prior[side].compactArguments);}assert.deepEqual(m.counts,prior.counts);assert.equal(m.analysisOutcome,prior.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
   records.push({id:target.id,seat:target.seat,frame:target.frame,entryPremise:target.entryPremise,...record});
  }
 }finally{E.prototype.selectIncumbent=select;module.AgenTankSimulator.prototype.step=step;}
 const cells=records.flatMap(r=>r.cells),witnesses={};for(const c of cells)witnesses[c.witness]=(witnesses[c.witness]||0)+1;
 const overview={tree,roots:records.length,branches:cells.length,witnesses,supportedRoots:records.filter(r=>r.allBranchesSupported).length,
  rootsSummary:records.map(({cells,...r})=>r),checks:{actionDrift:0,eventCountDrift:0,errors:0,timeouts:0,restore:0,witnessFalsePositive:0},
  authority:'PINNED_SIMULATOR_CONDITIONAL_LEMMA',strictProof:false,productionAdoption:false};
 assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={inspectRoot};
