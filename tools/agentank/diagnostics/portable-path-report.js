'use strict';
// Post-experiment verification and descriptive paired uncertainty; never tunes a candidate.
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {loadCheckpoint,jsonHash}=require('./portable-path-campaign');
const {compare,passes,semantic}=require('./efficient-tuning-campaign');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadIndexedV1Scenarios}=require('../simulation/historical-scenarios');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const readRows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(JSON.parse);
const key=r=>r.matchUrlId+':'+r.candidateSeat;
const score=r=>r.analysisOutcome==='V2_WIN'?1:r.analysisOutcome==='DRAW'?.5:0;
function paired(before,after,sceneIndex){
  const index=new Map(after.map(r=>[key(r),r])),groups=new Map();
  for(const r of before){const other=index.get(key(r));assert.ok(other);assert.equal(r.scenarioFingerprint,other.scenarioFingerprint);
    const group=jsonHash(sceneIndex.get(r.matchUrlId).map),g=groups.get(group)||{n:0,delta:0};
    g.n++;g.delta+=score(other)-score(r);groups.set(group,g);
  }
  const blocks=[...groups.values()];let state=392;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const resamples=[];for(let i=0;i<2000;i++){let n=0,delta=0;for(let j=0;j<blocks.length;j++){const g=blocks[Math.floor(random()*blocks.length)];n+=g.n;delta+=g.delta;}resamples.push(100*delta/n);}
  resamples.sort((a,b)=>a-b);const delta=blocks.reduce((n,g)=>n+g.delta,0);
  return {games:before.length,mapGroups:blocks.length,deltaPoints:delta,deltaPercentagePoints:100*delta/before.length,
    descriptive95PercentInterval:[resamples[50],resamples[1949]],resamples:2000};
}
function run(root,out){
  const read=f=>JSON.parse(fs.readFileSync(path.join(out,f)));
  function save(f,value){const bytes=Buffer.from(JSON.stringify(value,null,2)),file=path.join(out,f);if(fs.existsSync(file))assert.deepEqual(fs.readFileSync(file),bytes);else fs.writeFileSync(file,bytes,{flag:'wx'});}
  const manifest=read('manifest.json'),result=read('rounds.json');assert.equal(result.rounds.length,10);
  assert.deepEqual(result.rounds.map(r=>r.id),Array.from({length:10},(_,i)=>'R'+(41+i)));
  assert.equal(productionTreeSha256(root),manifest.tree);
  for(const [f,sha] of Object.entries(manifest.sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,f))),sha);
  for(const [mode,files] of Object.entries(manifest.buildHashes))for(const [f,sha] of Object.entries(files))assert.equal(hash(fs.readFileSync(path.join(out,'build',mode,f))),sha);
  const scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz'))));
  const sceneIndex=new Map(scenes.map(s=>[s.matchUrlId,s])),fingerprints=new Map(scenes.map(s=>[s.matchUrlId,s.fingerprint]));
  const historical=scenes.filter(s=>!s.parentMatchUrlId),baseMaps=new Set(historical.map(s=>jsonHash(s.map)));
  const indexed=loadIndexedV1Scenarios(root).scenarios;
  const inventory={historicalFrozen:historical.length,indexed:indexed.length,newMapScenes:indexed.filter(s=>!baseMaps.has(jsonHash(s.map))).length,
    indexSha256:hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json'))),indexedScenarioRoot:jsonHash(indexed.map(s=>s.fingerprint).sort())};
  assert.equal(inventory.newMapScenes,0);assert.equal(indexed.length,1243);save('local-corpus-inventory.json',inventory);
  const eqMaps=new Set(manifest.equivalence.map(id=>jsonHash(sceneIndex.get(id).map)));assert.equal(eqMaps.size,192);
  const parentMaps=new Set();for(const group of Object.values(manifest.pressure)){assert.equal(group.length,64);for(const s of group){const h=jsonHash(sceneIndex.get(s.parent).map);assert.ok(!parentMaps.has(h));parentMaps.add(h);}}
  const refs={baseline:readRows(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/matches.ndjson.gz')),
    R15:readRows(path.join(root,'artifacts/native-causal-audit/bp389-ranking-ten-rounds-v2/R15-full/matches.ndjson.gz')),
    R29:readRows(path.join(root,'artifacts/native-causal-audit/bp390-path-component-ten-rounds/R29-full/matches.ndjson.gz'))};
  for(const [mode,rows] of Object.entries(refs))assert.equal(jsonHash(rows),manifest.referenceHashes[mode]);
  const stages=new Map();let count=0,nativeGames=0,vmGames=0;
  for(const stage of result.stages){const dir=path.join(out,stage.name),jobs=JSON.parse(fs.readFileSync(path.join(dir,'jobs.json'))),rows=readRows(path.join(dir,'matches.ndjson.gz'));
    assert.equal(rows.length,jobs.length);assert.equal(rows.length,stage.games);assert.equal(stage.reusedGames,0);assert.equal(stage.executedGames,rows.length);
    assert.equal(hash(fs.readFileSync(path.join(dir,'matches.ndjson.gz'))),stage.matchesSha256);
    const checkpoint=loadCheckpoint(path.join(dir,'checkpoint.ndjson'),jobs,fingerprints);assert.equal(checkpoint.truncatedBytes,0);assert.equal(checkpoint.records.size,rows.length);
    rows.forEach((r,i)=>{assert.deepEqual(r,checkpoint.records.get(i));if(jobs[i].lane==='vm'){assert.equal(r.audit,null);assert.equal(r.candidateEngine.rootRestoreFailures,null);vmGames++;}
      else {assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);nativeGames++;}});
    stages.set(stage.name,rows);count+=rows.length;
  }
  assert.equal(count,result.executedGames);assert.equal(count,7020);
  function equivalent(rows,reference,work){const index=new Map(reference.map(r=>[key(r),r]));for(const r of rows){const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b));assert.equal(r.result.reason,b.result.reason);if(work)assert.deepEqual(r.audit,b.audit);}}
  equivalent(stages.get('baseline-vm-preflight'),refs.baseline,false);
  const cases=[],uncertainty=[],pooled={baseline:[],R15:[],R29:[]};
  for(const r of result.rounds){
    if(r.type==='NATIVE_PORT_EQUIVALENCE'){const rows=stages.get(r.id+'-portable-full');equivalent(rows,refs[r.candidate],true);assert.deepEqual(r.performance,compare(refs.baseline,rows));}
    else if(r.type==='MINIFIED_EQUIVALENCE')equivalent(stages.get(r.id+'-minified'),refs[r.candidate],false);
    else {
      const before=stages.get(r.kind+'-baseline'),after=stages.get(r.id+'-'+r.kind),p=compare(before,after);assert.deepEqual(p,r.performance);
      assert.equal(r.status,passes(p,'development')?'PRESSURE_PASS':'PRESSURE_REJECTED');
      uncertainty.push({id:r.id,...paired(before,after,sceneIndex)});
      if(r.candidate==='R15')pooled.baseline.push(...before);pooled[r.candidate].push(...after);
      const index=new Map(before.map(row=>[key(row),row])),regressions=[];
      for(const row of after){const prior=index.get(key(row));if(score(row)<score(prior))regressions.push({id:row.matchUrlId,parent:sceneIndex.get(row.matchUrlId).parentMatchUrlId,seat:row.candidateSeat,
        delta:score(row)-score(prior),before:{outcome:prior.analysisOutcome,terminal:prior.terminalCategory},after:{outcome:row.analysisOutcome,terminal:row.terminalCategory}});}
      regressions.sort((a,b)=>a.delta-b.delta||a.id.localeCompare(b.id));cases.push({id:r.id,regressions:regressions.length,largestRegressions:regressions.slice(0,12)});
    }
  }
  save('uncertainty.json',{scope:'Descriptive paired map-cluster bootstrap; 2000 resamples; no multiple-comparison correction; synthetic pressure only, not blind historical or platform evidence.',rounds:uncertainty,
    pooledR15:{performance:compare(pooled.baseline,pooled.R15),...paired(pooled.baseline,pooled.R15,sceneIndex)},
    pooledR29:{performance:compare(pooled.baseline,pooled.R29),...paired(pooled.baseline,pooled.R29,sceneIndex)},
    pooledR29versusR15:paired(pooled.R15,pooled.R29,sceneIndex)});
  save('followup-cases.json',cases);
  const testLog=fs.readFileSync('/tmp/bp392-full-tests.log','utf8');assert.match(testLog,/tests 480[\s\S]*pass 480[\s\S]*fail 0/);
  const validation={status:'PASS',rounds:10,executedGames:count,nativeGames,vmGames,errors:0,timeouts:0,nativeRestoreFailures:0,nativeHotAllocations:0,
    vmWorkCounters:'UNAVAILABLE',productionSha256:manifest.tree,tests:{passed:480,failed:0},pressureParentMaps:192,equivalenceMaps:192,
    postprocessorSha256:hash(fs.readFileSync(__filename)),roundsSha256:hash(fs.readFileSync(path.join(out,'rounds.json')))};
  save('validation.json',validation);fs.copyFileSync('/tmp/bp392-full-tests.log',path.join(out,'minimax-core-tests.txt'));fs.copyFileSync('/tmp/bp392-run.log',path.join(out,'run.log'));
  console.log(JSON.stringify(validation));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2]));
module.exports={paired};
