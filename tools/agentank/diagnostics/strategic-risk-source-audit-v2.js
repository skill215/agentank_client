'use strict';
// Bounded observational replay. No policy candidates or coefficient search.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {play,NativeBasePolicyDiagnosticBot:Bot,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {V3DiagnosticBot}=require('../../../engine-v3/src');
const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
const {withClock,PROTOCOL}=require('./deterministic-v1-clock');
const {loadBombPhaseAdapter}=require('../simulation/bomb-phase-adapter');
const {install}=require('./selective-risk-variants');
const {semantic}=require('./efficient-tuning-campaign');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {TERMINAL,NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f)),rows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(JSON.parse);
const key=r=>r.matchUrlId+':'+r.candidateSeat;
async function run(root,out){
 assert.ok(!fs.existsSync(out),'USE_NEW_OUTPUT_DIRECTORY');
 const prior=path.join(root,'artifacts/native-causal-audit/bp398-selective-risk-ten-rounds'),m=read(path.join(prior,'manifest.json'));
 const {module:sim,identity}=await loadBombPhaseAdapter(root),tree=productionTreeSha256(root);
 assert.equal(tree,m.tree);assert.deepEqual(identity,m.adapter);assert.equal(resolveFrozenV1(root).sha256,m.v1);assert.equal(PROTOCOL,m.clock);assert.equal(process.version,m.node);
 const scenes=new Map(JSON.parse(z.gunzipSync(fs.readFileSync(path.join(prior,'scenarios.json.gz')))).map(s=>[s.matchUrlId,s]));
 const work=['R15','R29'].flatMap(parent=>{const dir=path.join(prior,'mechanism-audit-'+parent),js=read(path.join(dir,'jobs.json')),rs=rows(path.join(dir,'matches.ndjson.gz'));return js.map((job,i)=>({job,reference:rs[i]}));});assert.equal(work.length,54);
 const sources=['tools/agentank/diagnostics/strategic-risk-source-audit-v2.js','tools/agentank/diagnostics/selective-risk-variants.js','tools/agentank/diagnostics/path-component-variants.js','tools/agentank/diagnostics/deterministic-v1-clock.js'];
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({purpose:'54 existing adverse-event replays to decompose source risk, no candidate search',date:'2026-10-04',tree,adapter:identity,node:process.version,clock:PROTOCOL,v1:m.v1,priorManifest:hash(fs.readFileSync(path.join(prior,'manifest.json'))),jobs:work.map(x=>x.job),sourceHashes:Object.fromEntries(sources.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]))},null,2));
 const v1=V3DiagnosticBot.prototype.decide,v2=Bot.prototype.decide,capture=Bot.prototype.captureRoot;
 let job,audit,stats,snapshot;
 V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>v1.call(this,c));};
 Bot.prototype.decide=function(...args){if(!this.sourceAuditStats){this.sourceAuditStats=install(this.engine,job.mode,{traceFrame:job.traceFrame});stats=this.sourceAuditStats;}return v2.apply(this,args);};
 Bot.prototype.captureRoot=function(context){
  const e=this.engine,search=e.basePolicy.policySearch,reason=this.searchEntry;
  audit.reasons[reason]=(audit.reasons[reason]||0)+1;audit.lastReason=reason;
  if(this.searchEvidenceCurrent){audit.searchRoots++;audit.nodes+=search.nodes;audit.budgetLeaves+=search.lastBudgetLeafCount;}
  if(context.game.frames!==job.traceFrame)return;
  const a=e.adapter.state.arrays,safety=e.safetyClosure.outcome,risk=e.riskController.outcome;
  const sources=['committedDeathMass','possibleProjectileDeathMass','futureFireDeathMass'];
  snapshot={frame:context.game.frames,selectedRow:e.lastSelectedRow,action:e.lastAction,ownStars:a[ARRAY.TANK_STARS][0],enemyStars:a[ARRAY.TANK_STARS][1],
    ownStunUntil:a[ARRAY.TANK_STUN_UNTIL][0],enemyStunUntil:a[ARRAY.TANK_STUN_UNTIL][1],ownStunned:a[ARRAY.TANK_STUN_UNTIL][0]!==NONE_FRAME&&a[ARRAY.TANK_STUN_UNTIL][0]>a[ARRAY.SCALAR][SCALAR.FRAME],enemyStunned:a[ARRAY.TANK_STUN_UNTIL][1]!==NONE_FRAME&&a[ARRAY.TANK_STUN_UNTIL][1]>a[ARRAY.SCALAR][SCALAR.FRAME],rows:[]};
  for(let row=0;row<e.ourCount;row++){
   const component=Object.fromEntries(sources.map(k=>[k,Array.from(safety[k].slice(row*4,row*4+4))]));
   const total=Math.min(10000,Array.from({length:4},(_,d)=>Math.min(10000,sources.reduce((n,k)=>n+component[k][d],0))).reduce((x,y)=>x+y,0));
   assert.equal(total,safety.horizonFatalMass[row],'SOURCE_RECONSTRUCTION');assert.equal(total,risk.horizonFatalMass[row],'COPIED_RISK_DRIFT');
   snapshot.rows.push({row,action:e.ourActions[row],hard:e.hardStatus[row],allowed:!!e.basePolicy.owner.allowedRow[row],acceptable:!!risk.acceptable[row],
    horizon:total,sources:component,sourceSums:Object.fromEntries(sources.map(k=>[k,component[k].reduce((x,y)=>x+y,0)])),
    possibleStrategyApplied:safety.possibleProjectileStrategyApplied[row],futureStrategyApplied:safety.futureFireStrategyApplied[row],
    searchValue:search.rootScore[row],intentBonus:e.basePolicy.intent.bonus(row)});
  }
 };
 const records=[],played=[];const started=Date.now();
 try{for(const item of work){job=item.job;stats=null;snapshot=null;audit={reasons:{},searchRoots:0,nodes:0,budgetLeaves:0,lastReason:null};
  const r=await play(sim,scenes.get(job.id),job.seat,true);assert.deepEqual(semantic(r),semantic(item.reference));assert.deepEqual(audit,item.reference.audit);assert.equal(r.result.reason,item.reference.result.reason);
  for(const side of [r.candidate,r.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);assert.ok(snapshot);
  assert.deepEqual(stats.trace,item.reference.variant.trace,'COMPARE_TRACE_DRIFT');
  const changed=stats.trace.filter(t=>!!t.before!==!!t.after).map(t=>{const left=snapshot.rows[t.rowDominates?t.row:t.best],right=snapshot.rows[t.rowDominates?t.best:t.row];return {safer:left,worse:right,comparison:t,sourceImprovement:Object.fromEntries(Object.keys(left.sourceSums).map(k=>[k,right.sourceSums[k]-left.sourceSums[k]]))};});
  records.push({job,snapshot,changedComparisons:changed});delete r.candidateEngine.rootFrames;delete r.control.actionFrames;played.push(r);
  if(records.length%12===0||records.length===54)console.log(JSON.stringify({done:records.length,total:54}));
 }}finally{V3DiagnosticBot.prototype.decide=v1;Bot.prototype.decide=v2;Bot.prototype.captureRoot=capture;}
 const changed=records.flatMap(r=>r.changedComparisons),summary={replays:records.length,changedComparisons:changed.length,sourceImprovementCounts:Object.fromEntries(['committedDeathMass','possibleProjectileDeathMass','futureFireDeathMass'].map(k=>[k,changed.filter(c=>c.sourceImprovement[k]>0).length])),ownStunnedRoots:records.filter(r=>r.snapshot.ownStunned).length,enemyStunnedRoots:records.filter(r=>r.snapshot.enemyStunned).length,seconds:(Date.now()-started)/1000,equivalent:true,sourceReconstructed:true};
 // Direct semantic probe, deliberately synthetic: a non-crash terminal ignores
 // terminal code, and equal-star mutual crash is valued below an ordinary draw.
 const arrays=[];arrays[ARRAY.TANK_CRASH]=[0,0];arrays[ARRAY.TANK_STARS]=[1,0];const engine={adapter:{state:{arrays}}};
 const probe=Object.create(NativeBasePolicySearch.prototype);probe.leaf=()=>123;
 summary.terminalProbe={winCode:probe.terminalUtility(engine,TERMINAL.WIN0,0,0),lossCode:probe.terminalUtility(engine,TERMINAL.WIN1,0,0),drawCode:probe.terminalUtility(engine,TERMINAL.DRAW,0,0),synthetic:true};
 arrays[ARRAY.TANK_CRASH]=[1,1];arrays[ARRAY.TANK_STARS]=[1,1];summary.terminalProbe.equalStarMutualCrash=probe.terminalUtility(engine,TERMINAL.DRAW,0,0);
 assert.equal(productionTreeSha256(root),tree);
 fs.writeFileSync(path.join(out,'source-decomposition.json'),JSON.stringify({summary,records},null,2));
 fs.writeFileSync(path.join(out,'matches.ndjson.gz'),z.gzipSync(played.map(JSON.stringify).join('\n')+'\n'));
 for(const f of sources){const p=path.join(out,'sources',f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,f),p);}
 console.log(JSON.stringify(summary,null,2));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
