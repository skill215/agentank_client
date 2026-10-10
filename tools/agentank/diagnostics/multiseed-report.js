'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {loadCheckpoint,validateRow,jsonHash}=require('./multiseed-campaign');
const {createDesign,clusterInterval,support}=require('./multiseed-design');
const {compare,passes,semantic}=require('./efficient-tuning-campaign');
const {firstDifference}=require('./seed-factor-report');
const {seedFor}=require('./v1-v3-arena');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const key=r=>r.matchUrlId+':'+r.candidateSeat;
const score=r=>r.analysisOutcome==='V2_WIN'?1:r.analysisOutcome==='DRAW'?.5:0;
const death=r=>r.analysisOutcome==='V1_WIN'&&r.terminalCategory==='SINGLE_CRASH';
const rows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(JSON.parse);
function run(root,out){
  const read=f=>JSON.parse(fs.readFileSync(path.join(out,f)));
  const save=(f,v)=>{const bytes=Buffer.from(JSON.stringify(v,null,2)),target=path.join(out,f);if(fs.existsSync(target))assert.deepEqual(fs.readFileSync(target),bytes);else fs.writeFileSync(target,bytes,{flag:'wx'});};
  const m=read('manifest.json'),result=read('rounds.json');assert.equal(productionTreeSha256(root),m.tree);
  assert.deepEqual(result.rounds.map(r=>r.id),Array.from({length:10},(_,i)=>'R'+(61+i)));
  for(const [f,h]of Object.entries(m.sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,f))),h);
  for(const [mode,h]of Object.entries(m.moduleHashes))assert.equal(hash(fs.readFileSync(path.join(out,'build',mode,'path-utility.js'))),h);
  assert.equal(hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json'))),m.indexHash);
  const scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz')))),sceneIndex=new Map(scenes.map(s=>[s.matchUrlId,s])),fingerprints=new Map(scenes.map(s=>[s.matchUrlId,s.fingerprint]));
  const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated'),portable=path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds'),prior=path.join(root,'artifacts/native-causal-audit/bp393-seed-factor-ten-rounds');
  assert.equal(hash(fs.readFileSync(path.join(prior,'manifest.json'))),m.priorManifestSha256);
  const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz')))),priorScenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(prior,'scenarios.json.gz'))));
  const design=createDesign(historical,priorScenes,m.cells);
  assert.deepEqual(scenes,[...design.preflight,...Object.values(design.conditions).flat()]);
  const referenceFiles={baseline:path.join(base,'matches.ndjson.gz'),R15:path.join(portable,'R41-portable-full/matches.ndjson.gz'),R29:path.join(portable,'R42-portable-full/matches.ndjson.gz')};
  const replicaNames={baseline:'seed-replica-baseline',R15:'R59-seed-replica',R29:'R60-seed-replica'};
  const references={};for(const mode of ['baseline','R15','R29']){references[mode]=[...rows(referenceFiles[mode]),...rows(path.join(prior,replicaNames[mode],'matches.ndjson.gz'))];assert.equal(jsonHash(references[mode]),m.referenceHashes[mode]);}
  const stages=new Map();let executed=0;
  for(const stage of result.stages){const dir=path.join(out,stage.name),jobs=JSON.parse(fs.readFileSync(path.join(dir,'jobs.json'))),rs=rows(path.join(dir,'matches.ndjson.gz'));
    const pre=stage.name.startsWith('seed-preflight-'),round=result.rounds.find(r=>stage.name===r.id+'-'+r.condition);
    const mode=pre?stage.name.slice('seed-preflight-'.length):round?round.candidate:'baseline';
    const condition=round?round.condition:stage.name.replace(/-baseline$/,'');
    const expectedScenes=pre?design.preflight:design.conditions[condition];assert.ok(expectedScenes);
    const expectedJobs=expectedScenes.flatMap(s=>[0,1].map(seat=>({id:s.matchUrlId,seat,mode,lane:'native',seed:s.simulationSeed??seedFor(s)})));
    assert.deepEqual(jobs,expectedJobs,'FROZEN_JOB_SET_DRIFT');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'identity.json'))),{campaign:jsonHash(m),jobsSha256:jsonHash(jobs)});
    assert.equal(hash(fs.readFileSync(path.join(dir,'matches.ndjson.gz'))),stage.matchesSha256);assert.equal(rs.length,jobs.length);assert.equal(rs.length,stage.executedGames);assert.equal(stage.reusedGames,0);
    const checkpoint=loadCheckpoint(path.join(dir,'checkpoint.ndjson'),jobs,fingerprints);assert.equal(checkpoint.records.size,rs.length);assert.equal(checkpoint.truncatedBytes,0);
    rs.forEach((r,i)=>{validateRow(r,jobs[i],fingerprints.get(jobs[i].id));assert.deepEqual(r,checkpoint.records.get(i));assert.equal(r.seedControl.hostDerivedSeed,seedFor(sceneIndex.get(r.matchUrlId)));assert.equal(r.compactRoots.length,Buffer.from(r.candidate.compactActionStream,'base64').length);assert.equal(r.candidate.decisionCount,r.compactRoots.length);});
    stages.set(stage.name,rs);executed+=rs.length;
  }
  assert.equal(executed,5856);assert.equal(result.executedGames,executed);
  for(const mode of ['baseline','R15','R29']){const index=new Map(references[mode].map(r=>[key(r),r]));for(const r of stages.get('seed-preflight-'+mode)){
    const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b));assert.deepEqual(r.audit,b.audit);assert.equal(r.result.reason,b.result.reason);
  }}
  const perRound=[],pooled={baseline:[],R15:[],R29:[]},safetyCases={R15:new Map(),R29:new Map()};
  for(const round of result.rounds){const before=stages.get(round.condition+'-baseline'),after=stages.get(round.id+'-'+round.condition),p=compare(before,after);
    assert.deepEqual(p,round.performance);assert.equal(round.status,passes(p,'development')?'PRESSURE_PASS':'PRESSURE_REJECTED');
    if(round.candidate==='R15')pooled.baseline.push(...before);pooled[round.candidate].push(...after);
    const ix=new Map(before.map(r=>[key(r),r])),blocks=new Map(),reasons={};let branches=0,newDeaths=0,preventedDeaths=0;
    for(const r of after){const b=ix.get(key(r)),parent=sceneIndex.get(r.matchUrlId).parentMatchUrlId,d=score(r)-score(b),first=firstDifference(b,r);
      blocks.set(parent,(blocks.get(parent)||0)+d);if(d!==0||death(b)!==death(r))assert.ok(first);
      if(first){branches++;const reason=first.baselineRoot?.reason||'UNOBSERVED';reasons[reason]=(reasons[reason]||0)+1;}
      if(death(b)&&!death(r))preventedDeaths++;
      if(death(r)&&!death(b)){newDeaths++;const k=parent+':'+r.candidateSeat,c=safetyCases[round.candidate].get(k)||{parent,seat:r.candidateSeat,events:[]};
        c.events.push({round:round.id,condition:round.condition,seed:r.seedControl.effectiveSeed,deltaPoints:d,before:{outcome:b.analysisOutcome,terminal:b.terminalCategory},after:{outcome:r.analysisOutcome,terminal:r.terminalCategory},first,
          decisionsFromFirstDifferenceToEnd:r.candidate.decisionCount-(first.decisionIndex+1)});safetyCases[round.candidate].set(k,c);
      }
    }
    assert.equal(newDeaths-preventedDeaths,p.candidate.singleCrashLosses-p.baseline.singleCrashLosses);
    perRound.push({id:round.id,...clusterInterval([...blocks.values()]),branches,firstDifferenceReasons:reasons,newDeaths,preventedDeaths});
  }
  function paired(a,b){const ix=new Map(b.map(r=>[key(r),r])),blocks=new Map();for(const r of a){const other=ix.get(key(r));assert.ok(other);assert.equal(r.scenarioFingerprint,other.scenarioFingerprint);const parent=sceneIndex.get(r.matchUrlId).parentMatchUrlId;blocks.set(parent,(blocks.get(parent)||0)+score(other)-score(r));}assert.equal(blocks.size,192);return clusterInterval([...blocks.values()],10);}
  const summaries=['R15','R29'].map(mode=>{const performance=compare(pooled.baseline,pooled[mode]),uncertainty=paired(pooled.baseline,pooled[mode]),rounds=result.rounds.filter(r=>r.candidate===mode);
    const deaths=[...safetyCases[mode].values()].map(c=>({...c,seedCount:c.events.length})).sort((a,b)=>b.seedCount-a.seedCount||a.parent.localeCompare(b.parent)||a.seat-b.seat);
    return {candidate:mode,performance,uncertainty,...support(performance,uncertainty,rounds),passedSeeds:rounds.filter(r=>r.status==='PRESSURE_PASS').length,
      worstSeedDelta:Math.min(...rounds.map(r=>r.performance.deltaPoints)),bestSeedDelta:Math.max(...rounds.map(r=>r.performance.deltaPoints)),
      deathRegressionsBySeedCount:Object.fromEntries([1,2,3,4,5].map(n=>[n,deaths.filter(c=>c.seedCount===n).length])),
      persistentDeathRegressions:deaths.filter(c=>c.seedCount>=3),watchlist:deaths.filter(c=>c.seedCount===2).slice(0,12)};
  });
  const persistentSets=summaries.map(s=>new Set(s.persistentDeathRegressions.map(c=>c.parent+':'+c.seat)));
  const common=[...persistentSets[0]].filter(k=>persistentSets[1].has(k));
  save('multiseed-analysis.json',{scope:'Preregistered five new seed groups on known parent maps; paired 2000-resample parent-map bootstrap preserves ten correlated games per map; no multiple-comparison correction or automatic production adoption.',
    rounds:perRound,candidates:summaries,headToHeadR29MinusR15:paired(pooled.R15,pooled.R29),commonPersistentDeathCases:common});
  const testLog=fs.readFileSync('/tmp/bp394-tests.log','utf8');assert.match(testLog,/tests 486[\s\S]*pass 486[\s\S]*fail 0/);
  save('validation.json',{status:'PASS',rounds:10,stages:result.stages.length,executedGames:executed,preflightGames:96,parentMaps:192,newSeedsPerMap:5,
    errors:0,timeouts:0,restore:0,hotAllocations:0,allSeedsVerified:true,productionSha256:m.tree,tests:{passed:486,failed:0},postprocessorSha256:hash(fs.readFileSync(__filename)),
    dependencyHashes:{'tools/agentank/diagnostics/seed-factor-report.js':hash(fs.readFileSync(require.resolve('./seed-factor-report')))},roundsSha256:hash(fs.readFileSync(path.join(out,'rounds.json')))});
  fs.copyFileSync('/tmp/bp394-tests.log',path.join(out,'minimax-core-tests.txt'));fs.copyFileSync('/tmp/bp394-run.log',path.join(out,'run.log'));
  console.log(JSON.stringify({status:'PASS',executedGames:executed,candidates:summaries.map(s=>({candidate:s.candidate,status:s.status,passedSeeds:s.passedSeeds,points:s.performance.deltaPoints,interval:s.uncertainty.descriptive95PercentInterval,persistentDeathCases:s.persistentDeathRegressions.length}))}));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2]));
module.exports={run};
