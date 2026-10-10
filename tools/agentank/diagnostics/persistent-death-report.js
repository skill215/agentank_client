'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const {input,read,readRows,hash,jh,save,saveJSON,loadCheckpoint,validateRow,validateBranch}=require('./persistent-death-campaign');
const {key,jobKey,semantic,createPlan,score,death,allowedActions}=require('./persistent-death-design');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
const {loadBombPhaseAdapter}=require('../simulation/bomb-phase-adapter');
function terminal(r){return {outcome:r.analysisOutcome,terminal:r.terminalCategory,frames:r.frames,points:score(r),singleCrashLoss:death(r),candidateSurvived:r.counts.crashes[r.candidateSeat]===0,counts:r.counts};}
async function run(root,out){
 const m=read(path.join(out,'manifest.json')),execution=read(path.join(out,'execution.json')),d=input(root);
 assert.equal(productionTreeSha256(root),m.tree);assert.deepEqual((await loadBombPhaseAdapter(root)).identity,m.adapter);
 assert.equal(resolveFrozenV1(root).sha256,m.v1);assert.equal(process.version,m.node);
 assert.equal(hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena'))),m.hostHash);
 assert.equal(hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json'))),m.indexHash);
 assert.deepEqual(d.referenceHashes,m.referenceHashes);assert.deepEqual(d.cells,m.cells);
 for(const [f,h]of Object.entries(m.sourceHashes)){assert.equal(hash(fs.readFileSync(path.join(root,f))),h);assert.equal(hash(fs.readFileSync(path.join(out,'sources',f))),h);}
 for(const [mode,h]of Object.entries(m.moduleHashes))assert.equal(hash(fs.readFileSync(path.join(out,'build',mode,'path-utility.js'))),h);
 const scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz'))));assert.deepEqual(scenes,d.scenarios);
 const si=new Map(scenes.map(s=>[s.matchUrlId,s])),stages=new Map();let total=0;
 assert.deepEqual(execution.stages.map(s=>s.name),['replay-R15','replay-R29','noop-R15','noop-R29','branches-R15','branches-R29']);
 for(const stage of execution.stages){
  const dir=path.join(out,stage.name),jobs=read(path.join(dir,'jobs.json')),rows=readRows(path.join(dir,'matches.ndjson.gz'));
  assert.deepEqual(read(path.join(dir,'identity.json')),{manifest:jh(m),jobsHash:jh(jobs)});
  assert.equal(hash(fs.readFileSync(path.join(dir,'matches.ndjson.gz'))),stage.matchesHash);assert.equal(rows.length,stage.games);assert.equal(rows.length,jobs.length);
  const cp=loadCheckpoint(path.join(dir,'checkpoint.ndjson'),jobs,si);assert.equal(cp.truncatedBytes,0);assert.equal(cp.records.size,jobs.length);
  rows.forEach((r,i)=>{validateRow(r,jobs[i],si.get(jobs[i].id));assert.deepEqual(r,cp.records.get(i));});
  stages.set(stage.name,{jobs,rows});total+=rows.length;
 }
 assert.equal(total,execution.executedGames);
 const replays=['R15','R29'].flatMap(mode=>stages.get('replay-'+mode).rows),ri=new Map(replays.map(r=>[key(r),r])),oi=new Map(d.original.map(r=>[key(r),r]));
 for(const r of replays){assert.deepEqual(semantic(r),semantic(oi.get(key(r))));assert.deepEqual(r.audit,oi.get(key(r)).audit);}
 const plan=createPlan(d.cells,d.original,d.baselines,replays);assert.deepEqual(plan,read(path.join(out,'plan.json')));
 const branches=new Map(),noops=new Set();
 for(const mode of ['R15','R29']){
  assert.deepEqual(stages.get('replay-'+mode).jobs,d.cells.filter(j=>j.mode===mode));
  for(const [name,jobs] of [['noop',plan.noopJobs],['branches',plan.branchJobs]]){
   const s=stages.get(name+'-'+mode);assert.deepEqual(s.jobs,jobs.filter(j=>j.mode===mode));
   s.rows.forEach((r,i)=>{const j=s.jobs[i],source=ri.get(key(r));validateBranch(source,r,j,name==='noop');
    assert.ok(allowedActions(source.roots[j.frame]).includes(j.action),'ILLEGAL_INTERVENTION');
    if(name==='noop')noops.add(jobKey(j));else{assert.ok(!branches.has(jobKey(j)));branches.set(jobKey(j),r);}
   });
  }
 }
 const reports=[],recoverableUnion={R15:new Set(),R29:new Set()},scoreUnion={R15:new Set(),R29:new Set()};
 for(const round of plan.rounds){
  const records=[];let eligible=0,blocked=0,noopCovered=0,originalDeaths=0,regressions=0,regressionRecovered=0,controlDamaged=0,
    improved=0,worsened=0,deathAvoidable=0,survivalRecoverable=0,deltaPoints=0,branchCount=0,positiveBranches=0,negativeBranches=0,riskRejectedRecoveries=0;
  for(const c of round.cases){
   const source=ri.get(key(c)),labels=[{action:c.selected,original:true,result:terminal(source)}];
   originalDeaths+=Number(death(source));regressions+=Number(c.regression);
   if(c.status==='ELIGIBLE')eligible++;else blocked++;
   if(c.frame!==null&&noops.has(jobKey({...c,action:c.selected})))noopCovered++;
   for(const action of c.actions.filter(a=>a!==c.selected)){
    const r=branches.get(jobKey({...c,action}));assert.ok(r);branchCount++;
    positiveBranches+=Number(score(r)>score(source));negativeBranches+=Number(score(r)<score(source));
    const risk=source.roots[c.index].candidates.find(x=>x.action===action);
    const avoids=death(source)&&!death(r);if(avoids&&(!risk.acceptable||risk.dominated))riskRejectedRecoveries++;
    labels.push({action,original:false,risk:{acceptable:risk.acceptable,dominated:risk.dominated},result:terminal(r)});
   }
   const actual=round.kind==='restore-first'?(labels.find(l=>l.action===c.wanted)||labels[0]):null;
   const bestPoints=actual?actual.result.points:Math.max(...labels.map(l=>l.result.points));
   const avoids=death(source)&&(actual?!actual.result.singleCrashLoss:labels.some(l=>!l.result.singleCrashLoss));
   const d=bestPoints-score(source);deltaPoints+=d;improved+=Number(d>0);worsened+=Number(d<0);deathAvoidable+=Number(avoids);
   survivalRecoverable+=Number(death(source)&&(actual?actual.result.candidateSurvived:labels.some(l=>l.result.candidateSurvived)));
   regressionRecovered+=Number(c.regression&&avoids);
   controlDamaged+=Number(!c.regression&&actual&&(actual.result.points<score(source)||(!death(source)&&actual.result.singleCrashLoss)));
   if(avoids)recoverableUnion[c.mode].add(key(c));if(d>0)scoreUnion[c.mode].add(key(c));
   records.push({...c,labels,deltaPoints:d,deathAvoidable:avoids});
  }
  const status=round.kind==='restore-first'?(deltaPoints>0?'RESTORE_HELPS':'RESTORE_NO_NET_GAIN'):(deathAvoidable||improved?'MECHANISM_RECOVERABLE':'NO_RECOVERY_OBSERVED');
  reports.push({id:round.id,mode:round.mode,kind:round.kind,offset:round.offset,cases:round.cases.length,eligible,blocked,noopCovered,
    originalDeaths,regressions,regressionRecovered,controlDamaged,improved,worsened,deathAvoidable,survivalRecoverable,deltaPoints,branchCount,
    positiveBranches,negativeBranches,riskRejectedRecoveries,status,records});
 }
 assert.deepEqual(reports.map(r=>r.id),Array.from({length:10},(_,i)=>'R'+(71+i)));
 const result={status:'TEN_ROUNDS_COMPLETE',executedGames:total,replays:replays.length,noops:noops.size,uniqueAlternativeBranches:branches.size,
   seconds:execution.seconds,productionUnchanged:true,errors:0,timeouts:0,restore:0,hotAllocations:0,
   union:Object.fromEntries(['R15','R29'].map(mode=>[mode,{deathAvoidable:recoverableUnion[mode].size,scoreImproved:scoreUnion[mode].size}])),rounds:reports};
 saveJSON(path.join(out,'rounds.json'),result);
 saveJSON(path.join(out,'validation.json'),{status:'PASS',rounds:10,games:total,inputIdentity:true,sourceIdentity:true,
   checkpointIntegrity:true,planReconstructed:true,allInterventionsLegal:true,allPrefixesEquivalent:true,
   allSameFrameOpponentActionsEquivalent:true,noopEquivalent:true,productionUnchanged:true});
 const compact=reports.map(({records,...r})=>r);
 console.log(JSON.stringify({...result,rounds:compact},null,2));return result;
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run,terminal};
