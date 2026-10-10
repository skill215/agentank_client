'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {crashOutcome}=require('./terminal-risk-semantics-audit');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function command(code){switch(code){case 0:return null;case 1:return {type:'go'};case 2:return {type:'turn',side:'left'};case 3:return {type:'turn',side:'right'};case 4:return {type:'fire'};case 5:return {type:'throwBomb'};case 8:return {type:'stun'};default:throw Error('UNSUPPORTED_PRIMITIVE');}}
function chanceCount(player,frame,action){return action>=1&&action<=3&&player.effects.debuff?.type==='stun'&&player.effects.debuff.expiresAt>frame?2:1;}
function oracleAt(sim,seat,prior,step){
 assert.equal(sim.players[0].skillType,'stun');assert.equal(sim.players[1].skillType,'stun');
 const ownActions=[...new Set(prior.cells.map(c=>c.ownAction))],enemyActions=[0,1,2,3,4,5,8],cells=[];
 const signature=()=>JSON.stringify({frame:sim.frame,map:sim.map,players:sim.players,bullets:sim.bullets,bombs:sim.bombs,star:sim.star,result:sim.result});const before=signature();
 for(const ownAction of ownActions)for(const enemyAction of enemyActions)for(let chance0=0;chance0<chanceCount(sim.players[seat],sim.frame,ownAction);chance0++)for(let chance1=0;chance1<chanceCount(sim.players[seat^1],sim.frame,enemyAction);chance1++){
  const codes=seat===0?[ownAction,enemyAction]:[enemyAction,ownAction],chances=seat===0?[chance0,chance1]:[chance1,chance0],queue=[];
  for(let i=0;i<2;i++)if(chanceCount(sim.players[i],sim.frame,codes[i])===2)queue.push(chances[i]===0?.25:.75);
  let calls=0;const copy=sim.clone({starProvider:()=>null,rng:()=>{assert.ok(calls<queue.length,'UNEXPECTED_RNG_CALL');return queue[calls++];}});
  const events=step.call(copy,codes.map(command),[]);assert.equal(calls,queue.length,'CHANCE_NOT_CONSUMED');
  const a=copy.players[seat],b=copy.players[seat^1];const ownCrash=Number(a.crashed),enemyCrash=Number(b.crashed),ownStars=a.stars,enemyStars=b.stars;
  const result=crashOutcome(ownCrash,enemyCrash,ownStars,enemyStars),expected=prior.cells.find(c=>c.ownAction===ownAction&&c.enemyAction===enemyAction&&c.chance0===chance0&&c.chance1===chance1);
  cells.push({ownAction,enemyAction,chance0,chance1,result,ownCrash,enemyCrash,ownStars,enemyStars,expected:expected?.result??null,match:expected?expected.result===result&&expected.ownCrash===ownCrash&&expected.enemyCrash===enemyCrash&&expected.ownStars===ownStars&&expected.enemyStars===enemyStars:null,skillOnCooldown:enemyAction===8&&sim.players[seat^1].skillCooldownUntil>sim.frame,events:events.filter(e=>e.type==='tank'&&e.action==='crashed'||e.type==='skill').map(e=>({type:e.type,action:e.action,by:e.by,reason:e.reason}))});
 }
 assert.equal(signature(),before,'SIMULATOR_ROOT_MUTATED');
 return {id:prior.id,seat,frame:sim.frame,enemySkillReady:sim.players[seat^1].skillCooldownUntil<=sim.frame,cells,missingPriorCells:prior.cells.filter(c=>!cells.some(x=>x.ownAction===c.ownAction&&x.enemyAction===c.enemyAction&&x.chance0===c.chance0&&x.chance1===c.chance1)).length};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),read=n=>{const bytes=fs.readFileSync(path.join(base,n));return {bytes,rows:zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse)};},input=read('bp352-terminal-risk-semantics/diagnostic-samples.ndjson.gz'),old=read('bp349-navigation-family-external/matches.ndjson.gz'),manifest=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const {module,directory}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(input.rows.map(r=>r.id),root),step=module.AgenTankSimulator.prototype.step,select=E.prototype.selectIncumbent,work=new WeakMap(),records=[];let target,observed;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,runnerSha256:hash(fs.readFileSync(__filename)),inputSha256:hash(input.bytes),simulatorEngineSha256:hash(fs.readFileSync(path.join(directory,'src/engine.js'))),targets:input.rows.map(r=>({id:r.id,seat:r.seat,frame:r.frame})),domain:'Own selected and FIRE x enemy NONE/GO/LEFT/RIGHT/FIRE/BOMB/STUN x independent simulator stun chance support; unavailable commands included as no-ops',starProvider:'Suppressed on cloned one-frame branches only; no nonterminal/star continuation certificate'},null,2));
 try{E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
 module.AgenTankSimulator.prototype.step=function(actions,decisions){if(this.frame===target.frame){assert.equal(observed,null,'DUPLICATE_CAPTURE');observed=oracleAt(this,target.seat,target,step);}return step.call(this,actions,decisions);};
 for(target of input.rows){observed=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),prior=old.rows.find(m=>m.mode==='NAVIGATION_FAMILY'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat);assert.equal(scenario.fingerprint,prior.scenarioFingerprint);const m=await play(module,scenario,target.seat,false);assert.ok(observed);for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,prior[side].compactActionStream);assert.deepEqual(m[side].compactArguments,prior[side].compactArguments);}assert.deepEqual(m.counts,prior.counts);assert.equal(m.analysisOutcome,prior.analysisOutcome);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);records.push(observed);}
 }finally{E.prototype.selectIncumbent=select;module.AgenTankSimulator.prototype.step=step;}
 const all=records.flatMap(r=>r.cells),fire=all.filter(c=>c.ownAction===4),counts=cells=>cells.reduce((o,c)=>(o[c.result]=(o[c.result]||0)+1,o),{}),mismatches=all.filter(c=>c.match===false);
 const overview={tree,roots:records.length,cells:all.length,compared:all.filter(c=>c.match!==null).length,mismatches:mismatches.length,missingPrior:records.reduce((n,r)=>n+r.missingPriorCells,0),additionalCells:all.filter(c=>c.match===null).length,additionalCooldownCells:all.filter(c=>c.match===null&&c.skillOnCooldown).length,fire:counts(fire),selected:counts(all.filter(c=>c.ownAction!==4)),perRoot:records.map(r=>({id:r.id,fire:counts(r.cells.filter(c=>c.ownAction===4)),mismatches:r.cells.filter(c=>c.match===false)})),evidenceAuthority:'PINNED_LOCAL_SIMULATOR',strictProof:false,productionAdoption:false,checks:{naturalActionDrift:0,eventCountDrift:0,rootMutation:0,errors:0,timeouts:0,restore:0}};assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={command,chanceCount};
