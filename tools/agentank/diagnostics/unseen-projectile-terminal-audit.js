'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {command,chanceCount}=require('./terminal-risk-simulator-oracle');
const {crashOutcome}=require('./terminal-risk-semantics-audit');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot:B}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function scan(sim,seat,step){
 const baseObservation=JSON.stringify(sim.snapshotFor(seat)),counts={},examples=[],enemy=seat^1;let worlds=0,branches=0,visibleRejected=0;
 const byDirection={};
 for(let x=0;x<sim.map.length;x++)for(let y=0;y<sim.map[x].length;y++){
  if(sim.map[x][y]==='x'||sim.map[x][y]==='m')continue;
  // Current live tank overlap is excluded: this is a post-previous-frame root.
  if(sim.players.some(p=>p.position[0]===x&&p.position[1]===y))continue;
  for(const direction of ['up','right','down','left']){
   const world=sim.clone({starProvider:()=>null});world.bullets.push({objectId:'bp355-unseen',ownerIndex:enemy,ownerObjectId:world.players[enemy].objectId,position:[x,y],direction,crashed:false});
   if(JSON.stringify(world.snapshotFor(seat))!==baseObservation){visibleRejected++;continue;}worlds++;
   for(const action of [0,1,2,3,4,5,8])for(let chance=0;chance<chanceCount(world.players[enemy],world.frame,action);chance++){
    let calls=0;const expected=chanceCount(world.players[enemy],world.frame,action)===2?1:0;
    const branch=world.clone({starProvider:()=>null,rng:()=>{assert.ok(calls++<expected);return chance===0?.25:.75;}}),actions=seat===0?[command(4),command(action)]:[command(action),command(4)];
    step.call(branch,actions,[]);assert.equal(calls,expected);branches++;
    const a=branch.players[seat],b=branch.players[enemy],result=crashOutcome(a.crashed,b.crashed,a.stars,b.stars);
    counts[result]=(counts[result]||0)+1;const k=direction+'/'+result;byDirection[k]=(byDirection[k]||0)+1;
    if(result!=='WIN'&&examples.length<8)examples.push({position:[x,y],direction,enemyAction:action,chance,result,ownCrash:a.crashed,enemyCrash:b.crashed,stars:[a.stars,b.stars]});
   }
  }
 }
 assert.equal(JSON.stringify(sim.snapshotFor(seat)),baseObservation);
 return {worlds,branches,visibleRejected,counts,byDirection,examples,scope:'One extra enemy projectile; current-observation-compatible superset, not history-consistent proof; overlaps with live tanks excluded'};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),read=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n))).toString().trim().split('\n').map(JSON.parse),targets=read('bp352-terminal-risk-semantics/diagnostic-samples.ndjson.gz'),matches=read('bp349-navigation-family-external/matches.ndjson.gz'),manifest=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const {module,directory}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root),step=module.AgenTankSimulator.prototype.step,select=E.prototype.selectIncumbent,capture=B.prototype.captureRoot,work=new WeakMap(),records=[];let target,record,support;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,runnerSha256:hash(fs.readFileSync(__filename)),simulatorSha256:hash(fs.readFileSync(path.join(directory,'src/engine.js'))),targets:targets.map(t=>({id:t.id,seat:t.seat,frame:t.frame})),protocol:'Frozen trajectory + single-extra-projectile observation-compatible superset. No action override; no promotion to strict Proof'},null,2));
 try{E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
 B.prototype.captureRoot=function(context,action){capture.call(this,context,action);if(context.game.frames===target.frame){const e=this.engine,p=e.possibleProjectiles;support={informationGapMask:e.adapter.informationGapMask,possibleCount:p.count(),capacityFailureCount:p.capacityFailureCount,poolComplete:p.pool.complete??null,possibleSlots:[]};for(let i=0;i<p.active.length;i++)if(p.active[i])support.possibleSlots.push({cell:p.cell[i],direction:p.direction[i],firedFrame:p.firedFrame[i],mass:p.mass[i]});}};
 module.AgenTankSimulator.prototype.step=function(actions,decisions){if(this.frame===target.frame){assert.equal(record,null);record=scan(this,target.seat,step);}return step.call(this,actions,decisions);};
 for(target of targets){record=null;support=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),old=matches.find(m=>m.mode==='NAVIGATION_FAMILY'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat);assert.equal(scenario.fingerprint,old.scenarioFingerprint);const m=await play(module,scenario,target.seat,true);assert.ok(record&&support);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,old[side].compactActionStream);assert.deepEqual(m[side].compactArguments,old[side].compactArguments);}assert.deepEqual(m.counts,old.counts);assert.equal(m.analysisOutcome,old.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);records.push({id:target.id,seat:target.seat,frame:target.frame,support,...record});console.error(`[bp355] ${records.length}/7, ${record.worlds} worlds, ${record.branches} cells`);}
 }finally{E.prototype.selectIncumbent=select;B.prototype.captureRoot=capture;module.AgenTankSimulator.prototype.step=step;}
 const counts={};for(const r of records)for(const [k,v]of Object.entries(r.counts))counts[k]=(counts[k]||0)+v;
 const overview={tree,roots:7,worlds:records.reduce((n,r)=>n+r.worlds,0),branches:records.reduce((n,r)=>n+r.branches,0),counts,records,strictProof:false,productionAdoption:false,checks:{naturalActionDrift:0,eventCountDrift:0,errors:0,timeouts:0,restore:0}};assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify({worlds:overview.worlds,branches:overview.branches,counts,support:records.map(r=>({id:r.id,support:r.support,counts:r.counts}))},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
