'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {command,chanceCount}=require('./terminal-risk-simulator-oracle');
const {crashOutcome}=require('./terminal-risk-semantics-audit');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function projectileSets(pool){
 const sets=[];for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++)sets.push([pool[i],pool[j]]);
 for(const size of [4,8,16])if(pool.length>=size)for(let offset=0;offset<8;offset++)sets.push(Array.from({length:size},(_,i)=>pool[(i+offset)%pool.length]));
 return sets;
}
function scan(sim,seat,step){
 const enemy=seat^1,observation=JSON.stringify(sim.snapshotFor(seat)),pool=[];
 const bullet=(p,i)=>({objectId:'bp356-'+i,ownerIndex:enemy,ownerObjectId:sim.players[enemy].objectId,position:[p.x,p.y],direction:p.direction,crashed:false});
 for(let x=0;x<sim.map.length;x++)for(let y=0;y<sim.map[x].length;y++){
  if(['x','m'].includes(sim.map[x][y])||sim.players.some(p=>p.position[0]===x&&p.position[1]===y))continue;
  for(const direction of ['up','right','down','left']){const p={x,y,direction},copy=sim.clone({starProvider:()=>null});copy.bullets.push(bullet(p,0));if(JSON.stringify(copy.snapshotFor(seat))===observation)pool.push(p);}
 }
 // Fixed geometric priority, never ordered by branch outcome.
 const distance=p=>Math.min(...sim.players.map(t=>Math.abs(p.x-t.position[0])+Math.abs(p.y-t.position[1])));
 pool.sort((a,b)=>distance(a)-distance(b)||a.x-b.x||a.y-b.y||a.direction.localeCompare(b.direction));
 const selected=pool.slice(0,24),sets=projectileSets(selected),counts={},bySize={},byOrder={},examples=[];let branches=0;
 for(const set of sets)for(const order of ['NATURAL','REVERSE_ALL','OWN_FIRST'])for(const enemyAction of [0,1,2,3,4,5,8])
  for(let chance=0;chance<chanceCount(sim.players[enemy],sim.frame,enemyAction);chance++){
   let calls=0;const expected=chanceCount(sim.players[enemy],sim.frame,enemyAction)===2?1:0;
   const copy=sim.clone({starProvider:()=>null,rng:()=>{assert.ok(calls++<expected);return chance===0?.25:.75;}});copy.bullets.push(...set.map(bullet));
   assert.equal(JSON.stringify(copy.snapshotFor(seat)),observation,'MULTI_OBSERVATION_DRIFT');
   if(order!=='NATURAL'){const move=copy.moveBullets;copy.moveBullets=function(events){if(order==='REVERSE_ALL')this.bullets.reverse();else this.bullets.sort((a,b)=>(a.ownerIndex===seat?0:1)-(b.ownerIndex===seat?0:1));return move.call(this,events);};}
   step.call(copy,seat===0?[command(4),command(enemyAction)]:[command(enemyAction),command(4)],[]);assert.equal(calls,expected);
   const a=copy.players[seat],b=copy.players[enemy],result=crashOutcome(a.crashed,b.crashed,a.stars,b.stars);branches++;counts[result]=(counts[result]||0)+1;
   for(const [o,k]of [[bySize,set.length],[byOrder,order]]){o[k]??={};o[k][result]=(o[k][result]||0)+1;}
   if(result!=='WIN'&&examples.length<8)examples.push({set,order,enemyAction,chance,result,crashes:[a.crashed,b.crashed]});
  }
 assert.equal(JSON.stringify(sim.snapshotFor(seat)),observation);
 return {eligibleSinglePoses:pool.length,selected,sets:sets.length,branches,counts,bySize,byOrder,examples};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),read=n=>zlib.gunzipSync(fs.readFileSync(path.join(base,n))).toString().trim().split('\n').map(JSON.parse),targets=read('bp352-terminal-risk-semantics/diagnostic-samples.ndjson.gz'),matches=read('bp349-navigation-family-external/matches.ndjson.gz'),manifest=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const {module,directory}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root),step=module.AgenTankSimulator.prototype.step,select=E.prototype.selectIncumbent,work=new WeakMap(),records=[];let target,record;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,runnerSha256:hash(fs.readFileSync(__filename)),simulatorSha256:hash(fs.readFileSync(path.join(directory,'src/engine.js'))),targets:targets.map(t=>({id:t.id,seat:t.seat,frame:t.frame})),protocol:'24 nearest invisible projectile poses; all unordered pairs; 8 cyclic sets each of size 4/8/16; three bullet processing orders; full primitive-stun enemy response domain; bounded stress, not exhaustive multi-world proof'},null,2));
 try{E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
 module.AgenTankSimulator.prototype.step=function(actions,decisions){if(this.frame===target.frame){assert.equal(record,null);record=scan(this,target.seat,step);}return step.call(this,actions,decisions);};
 for(target of targets){record=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),old=matches.find(m=>m.mode==='NAVIGATION_FAMILY'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat);assert.equal(scenario.fingerprint,old.scenarioFingerprint);const m=await play(module,scenario,target.seat,false);assert.ok(record);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,old[side].compactActionStream);assert.deepEqual(m[side].compactArguments,old[side].compactArguments);}assert.deepEqual(m.counts,old.counts);assert.equal(m.analysisOutcome,old.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);records.push({id:target.id,seat:target.seat,...record});console.error(`[bp356] ${records.length}/7, ${record.branches} branches`);}
 }finally{E.prototype.selectIncumbent=select;module.AgenTankSimulator.prototype.step=step;}
 const counts={};for(const r of records)for(const [k,v]of Object.entries(r.counts))counts[k]=(counts[k]||0)+v;
 const overview={tree,roots:7,branches:records.reduce((n,r)=>n+r.branches,0),counts,records,strictProof:false,productionAdoption:false,checks:{naturalActionDrift:0,eventCountDrift:0,errors:0,timeouts:0,restore:0}};assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify({branches:overview.branches,counts,perRoot:records.map(r=>({id:r.id,bySize:r.bySize,byOrder:r.byOrder}))},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={projectileSets};
