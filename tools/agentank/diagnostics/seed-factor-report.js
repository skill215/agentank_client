'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {loadCheckpoint,validateRow,jsonHash}=require('./seed-factor-campaign');
const {compare,passes,semantic}=require('./efficient-tuning-campaign');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const key=r=>r.matchUrlId+':'+r.candidateSeat;
const score=r=>r.analysisOutcome==='V2_WIN'?1:r.analysisOutcome==='DRAW'?.5:0;
const rows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(JSON.parse);
function interval(blocks,gamesPerMap=2){
  let state=393;const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const samples=[];for(let i=0;i<2000;i++){let d=0;for(let j=0;j<blocks.length;j++)d+=blocks[Math.floor(rand()*blocks.length)];samples.push(100*d/(blocks.length*gamesPerMap));}
  samples.sort((a,b)=>a-b);return {deltaPoints:blocks.reduce((a,b)=>a+b,0),games:blocks.length*gamesPerMap,mapGroups:blocks.length,
    descriptive95PercentInterval:[samples[50],samples[1949]],resamples:2000};
}
function firstDifference(before,after){
  const a=Buffer.from(before.candidate.compactActionStream,'base64'),b=Buffer.from(after.candidate.compactActionStream,'base64');
  const args=r=>new Map(r.candidate.compactArguments.map(x=>[x[0],x.slice(1)])),aa=args(before),bb=args(after);
  let at=-1;for(let i=0;i<Math.max(a.length,b.length);i++)if(a[i]!==b[i]||JSON.stringify(aa.get(i))!==JSON.stringify(bb.get(i))){at=i;break;}
  if(at<0)return null;
  const ca=Buffer.from(before.control.compactActionStream,'base64'),cb=Buffer.from(after.control.compactActionStream,'base64');
  assert.deepEqual(ca.subarray(0,at),cb.subarray(0,at),'OPPONENT_PREFIX_DRIFT');
  const ra=before.compactRoots[at]||null,rb=after.compactRoots[at]||null;
  return {decisionIndex:at,baselineAction:a[at]??null,candidateAction:b[at]??null,baselineArguments:aa.get(at)||null,candidateArguments:bb.get(at)||null,
    opponentPrefixEquivalent:true,baselineRoot:ra,candidateRoot:rb};
}
function run(root,out){
  const read=f=>JSON.parse(fs.readFileSync(path.join(out,f)));
  const save=(f,v)=>{const bytes=Buffer.from(JSON.stringify(v,null,2)),target=path.join(out,f);if(fs.existsSync(target))assert.deepEqual(fs.readFileSync(target),bytes);else fs.writeFileSync(target,bytes,{flag:'wx'});};
  const m=read('manifest.json'),result=read('rounds.json');assert.equal(productionTreeSha256(root),m.tree);
  assert.deepEqual(result.rounds.map(r=>r.id),Array.from({length:10},(_,i)=>'R'+(51+i)));
  for(const [f,h]of Object.entries(m.sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,f))),h);
  for(const [mode,h]of Object.entries(m.moduleHashes))assert.equal(hash(fs.readFileSync(path.join(out,'build',mode,'path-utility.js'))),h);
  assert.equal(hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json'))),m.indexHash);
  const scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz')))),sceneIndex=new Map(scenes.map(s=>[s.matchUrlId,s])),fingerprints=new Map(scenes.map(s=>[s.matchUrlId,s.fingerprint]));
  const stages=new Map();let executed=0;
  for(const stage of result.stages){const dir=path.join(out,stage.name),jobs=JSON.parse(fs.readFileSync(path.join(dir,'jobs.json'))),rs=rows(path.join(dir,'matches.ndjson.gz'));
    assert.equal(hash(fs.readFileSync(path.join(dir,'matches.ndjson.gz'))),stage.matchesSha256);assert.equal(rs.length,jobs.length);assert.equal(rs.length,stage.executedGames);assert.equal(stage.reusedGames,0);
    const checkpoint=loadCheckpoint(path.join(dir,'checkpoint.ndjson'),jobs,fingerprints);assert.equal(checkpoint.records.size,rs.length);assert.equal(checkpoint.truncatedBytes,0);
    rs.forEach((r,i)=>{validateRow(r,jobs[i],fingerprints.get(jobs[i].id));assert.deepEqual(r,checkpoint.records.get(i));assert.equal(r.compactRoots.length,Buffer.from(r.candidate.compactActionStream,'base64').length);});
    stages.set(stage.name,rs);executed+=rs.length;
  }
  assert.equal(executed,3648);assert.equal(result.executedGames,executed);
  const prior=path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds'),base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated');
  assert.equal(hash(fs.readFileSync(path.join(prior,'manifest.json'))),m.priorManifestSha256);
  const oldOriginal={baseline:rows(path.join(base,'matches.ndjson.gz')),R15:rows(path.join(prior,'R41-portable-full/matches.ndjson.gz')),R29:rows(path.join(prior,'R42-portable-full/matches.ndjson.gz'))};
  const names={baseline:['rotate90-baseline','mirror-x-baseline','star-early-baseline'],R15:['R45-rotate90','R47-mirror-x','R49-star-early'],R29:['R46-rotate90','R48-mirror-x','R50-star-early']};
  const oldChanged={};for(const mode of ['baseline','R15','R29']){
    oldChanged[mode]=names[mode].flatMap(n=>rows(path.join(prior,n,'matches.ndjson.gz')));const reference=[...oldOriginal[mode],...oldChanged[mode]];
    assert.equal(jsonHash(reference),m.referenceHashes[mode]);const index=new Map(reference.map(r=>[key(r),r]));
    for(const r of stages.get('seed-preflight-'+mode)){const b=index.get(key(r));assert.deepEqual(semantic(r),semantic(b));assert.deepEqual(r.audit,b.audit);assert.equal(r.result.reason,b.result.reason);}
  }
  const oldIndex=Object.fromEntries(Object.entries(oldOriginal).map(([k,v])=>[k,new Map(v.map(r=>[key(r),r]))]));
  const changedIndex=Object.fromEntries(Object.entries(oldChanged).map(([k,v])=>[k,new Map(v.map(r=>[key(r),r]))]));
  const maps=new Set();const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz')))),hIndex=new Map(historical.map(s=>[s.matchUrlId,s]));
  for(const c of m.cells){const h=jsonHash(hIndex.get(c.parentId).map);assert.ok(!maps.has(h));maps.add(h);}assert.equal(maps.size,192);
  const newIndex={};const roundReports=[],casebooks=[];
  for(const round of result.rounds){const before=stages.get(round.condition+'-baseline'),after=stages.get(round.id+'-'+round.condition),p=compare(before,after);
    assert.deepEqual(p,round.performance);assert.equal(round.status,passes(p,'development')?'PRESSURE_PASS':'PRESSURE_REJECTED');
    const byParent=rs=>new Map(rs.map(r=>[sceneIndex.get(r.matchUrlId).parentMatchUrlId+':'+r.candidateSeat,r]));
    newIndex[round.condition]||={};newIndex[round.condition].baseline=byParent(before);newIndex[round.condition][round.candidate]=byParent(after);
    const beforeIndex=new Map(before.map(r=>[key(r),r])),groups=new Map(),cases=[],reasons={};let branches=0;
    for(const r of after){const b=beforeIndex.get(key(r)),parent=sceneIndex.get(r.matchUrlId).parentMatchUrlId,d=score(r)-score(b),first=firstDifference(b,r);
      groups.set(parent,(groups.get(parent)||0)+d);if(d!==0)assert.ok(first,'OUTCOME_CHANGE_WITHOUT_ACTION_CHANGE');
      if(first){branches++;const reason=first.baselineRoot?.reason||'UNOBSERVED';reasons[reason]=(reasons[reason]||0)+1;}
      if(d!==0)cases.push({id:r.matchUrlId,parent,seat:r.candidateSeat,deltaPoints:d,seed:r.seedControl.effectiveSeed,
        before:{outcome:b.analysisOutcome,terminal:b.terminalCategory},after:{outcome:r.analysisOutcome,terminal:r.terminalCategory},first});
    }
    cases.sort((a,b)=>a.deltaPoints-b.deltaPoints||a.id.localeCompare(b.id));
    roundReports.push({id:round.id,...interval([...groups.values()]),branches,firstDifferenceReasons:reasons});
    casebooks.push({id:round.id,regressions:cases.filter(c=>c.deltaPoints<0).length,gains:cases.filter(c=>c.deltaPoints>0).length,
      largestRegressions:cases.filter(c=>c.deltaPoints<0).slice(0,12),largestGains:cases.filter(c=>c.deltaPoints>0).slice(-12)});
  }
  const factors=[];
  for(const kind of ['rotate90','mirror-x','star-early'])for(const mode of ['R15','R29']){
    const cells=m.cells.filter(c=>c.kind===kind),blocks=[],summaries={O0:[],O1:[],T0:[],T1:[]},baselines={O0:[],O1:[],T0:[],T1:[]};
    for(const c of cells){const values={O0:0,O1:0,T0:0,T1:0};for(const seat of [0,1]){
      const k=c.parentId+':'+seat,ck=c.changedId+':'+seat;
      const pairs={O0:[oldIndex.baseline.get(k),oldIndex[mode].get(k)],O1:[newIndex['seed-only'].baseline.get(k),newIndex['seed-only'][mode].get(k)],
        T0:[newIndex[kind].baseline.get(k),newIndex[kind][mode].get(k)],T1:[changedIndex.baseline.get(ck),changedIndex[mode].get(ck)]};
      for(const [name,[b,a]]of Object.entries(pairs)){assert.ok(a&&b);values[name]+=score(a)-score(b);baselines[name].push(b);summaries[name].push(a);}
    }blocks.push({parent:c.parentId,...values,seed:values.O1-values.O0,physical:values.T0-values.O0,interaction:values.T1-values.T0-values.O1+values.O0,total:values.T1-values.O0});}
    const effects=Object.fromEntries(['seed','physical','interaction','total'].map(k=>[k,interval(blocks.map(b=>b[k]))]));
    assert.equal(effects.seed.deltaPoints+effects.physical.deltaPoints+effects.interaction.deltaPoints,effects.total.deltaPoints);
    factors.push({kind,candidate:mode,cells:Object.fromEntries(Object.keys(summaries).map(k=>[k,compare(baselines[k],summaries[k])])),effects,blocks});
  }
  const pooledFactors=['R15','R29'].map(mode=>{
    const selected=factors.filter(f=>f.candidate===mode),blocks=selected.flatMap(f=>f.blocks);
    return {candidate:mode,mapGroups:blocks.length,cellDeltaPoints:Object.fromEntries(['O0','O1','T0','T1'].map(k=>[k,blocks.reduce((n,b)=>n+b[k],0)])),
      effects:Object.fromEntries(['seed','physical','interaction','total'].map(k=>[k,interval(blocks.map(b=>b[k]))]))};
  });
  const threeSeedSummary=['R15','R29'].map(mode=>{
    const before=[],after=[],blocks=[];
    for(const c of m.cells){let d=0;for(const seat of [0,1]){const k=c.parentId+':'+seat;
      for(const index of [oldIndex,newIndex['seed-only'],newIndex['seed-replica']]){
        const b=index.baseline.get(k),a=index[mode].get(k);before.push(b);after.push(a);d+=score(a)-score(b);
      }
    }blocks.push(d);}
    return {candidate:mode,scope:'Post-hoc descriptive aggregation over three initial seeds on original physical scenes; does not change round gates.',
      performance:compare(before,after),...interval(blocks,6)};
  });
  save('factor-analysis.json',{scope:'Paired 2x2 environment/initial-seed decomposition of candidate-minus-baseline score. Descriptive 2000-resample parent-map bootstrap; no multiple-comparison correction or causal attribution percentages.',factors,pooledFactors,threeSeedSummary,rounds:roundReports});
  save('followup-cases.json',casebooks);
  const testLog=fs.readFileSync('/tmp/bp393-tests.log','utf8');assert.match(testLog,/tests 483[\s\S]*pass 483[\s\S]*fail 0/);
  save('validation.json',{status:'PASS',rounds:10,executedGames:executed,stages:result.stages.length,preflightGames:192,parentMaps:192,
    errors:0,timeouts:0,restore:0,hotAllocations:0,allRequestedSeedsVerified:true,productionSha256:m.tree,tests:{passed:483,failed:0},
    postprocessorSha256:hash(fs.readFileSync(__filename)),roundsSha256:hash(fs.readFileSync(path.join(out,'rounds.json')))});
  fs.copyFileSync('/tmp/bp393-tests.log',path.join(out,'minimax-core-tests.txt'));fs.copyFileSync('/tmp/bp393-run.log',path.join(out,'run.log'));
  console.log(JSON.stringify({status:'PASS',executedGames:executed,factors:factors.map(f=>({kind:f.kind,candidate:f.candidate,cells:Object.fromEntries(Object.entries(f.cells).map(([k,v])=>[k,v.deltaPoints])),effects:Object.fromEntries(Object.entries(f.effects).map(([k,v])=>[k,v.deltaPoints]))}))}));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2]));
module.exports={interval,firstDifference};
