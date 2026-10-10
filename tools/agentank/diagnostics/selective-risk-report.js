'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chooseCohorts,loadCheckpoint,validateRow,jsonHash}=require('./selective-risk-campaign');
const {compare,semantic}=require('./efficient-tuning-campaign');
const {SPECS}=require('./selective-risk-variants');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadBombPhaseAdapter}=require('../simulation/bomb-phase-adapter');
const {resolveFrozenV1}=require('../../../engine-v3/src/legacy/default-source');
const {PROTOCOL}=require('./deterministic-v1-clock');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),key=r=>r.matchUrlId+':'+r.candidateSeat;
const read=f=>JSON.parse(fs.readFileSync(f)),rows=f=>z.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
function save(f,v){const b=Buffer.from(JSON.stringify(v,null,2));if(fs.existsSync(f))assert.deepEqual(fs.readFileSync(f),b);else fs.writeFileSync(f,b,{flag:'wx'});}
function gate(p,dev=false){return p.deltaPoints>=(dev?2:.5)&&p.candidate.singleCrashLosses<=p.baseline.singleCrashLosses&&p.candidate.doubleLosses<=p.baseline.doubleLosses&&p.nodeRatio<=2;}
function why(p,dev=false){return [p.deltaPoints<(dev?2:.5)?'局分不足':null,p.candidate.singleCrashLosses>p.baseline.singleCrashLosses?'单死增加':null,p.candidate.doubleLosses>p.baseline.doubleLosses?'双负增加':null,p.nodeRatio>2?'节点超限':null].filter(Boolean);}
async function run(root,out){
 const m=read(path.join(out,'manifest.json')),result=read(path.join(out,'rounds.json'));
 const base=path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated'),portable=path.join(root,'artifacts/native-causal-audit/bp392-portable-path-ten-rounds');
 const evidence=path.join(root,'artifacts/native-causal-audit/bp395-persistent-death-ten-rounds'),prior=path.join(root,'artifacts/native-causal-audit/bp394-multiseed-ten-rounds');
 const auditDir=path.join(root,'artifacts/native-causal-audit/bp397-owner-ranking-ten-rounds');
 const referenceFiles={auditCases:path.join(auditDir,'next-investigation.json'),auditR15:path.join(auditDir,'R91-development/matches.ndjson.gz'),auditR29:path.join(auditDir,'R92-development/matches.ndjson.gz'),previousManifest:path.join(root,'artifacts/native-causal-audit/bp397-owner-ranking-ten-rounds/manifest.json'),baseline:path.join(base,'matches.ndjson.gz'),R15:path.join(portable,'R41-portable-full/matches.ndjson.gz'),R29:path.join(portable,'R42-portable-full/matches.ndjson.gz'),evidence:path.join(evidence,'rounds.json'),evidenceManifest:path.join(evidence,'manifest.json'),priorManifest:path.join(prior,'manifest.json')};
 for(const [k,f]of Object.entries(referenceFiles))assert.equal(hash(fs.readFileSync(f)),m.referenceHashes[k]);
 assert.equal(productionTreeSha256(root),m.tree);assert.deepEqual((await loadBombPhaseAdapter(root)).identity,m.adapter);assert.equal(resolveFrozenV1(root).sha256,m.v1);assert.equal(PROTOCOL,m.clock);assert.equal(process.version,m.node);
 assert.equal(hash(fs.readFileSync(require.resolve('./native-base-policy-standalone-arena'))),m.hostHash);
 assert.equal(hash(fs.readFileSync(path.join(root,'battle-records/index/match-index.json'))),m.indexHash);
 for(const [f,h]of Object.entries(m.sourceHashes)){assert.equal(hash(fs.readFileSync(path.join(root,f))),h);assert.equal(hash(fs.readFileSync(path.join(out,'sources',f))),h);}
 const scenes=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(out,'scenarios.json.gz'))));assert.deepEqual(scenes,JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,'scenarios.json.gz')))));
 const groups=chooseCohorts(scenes,read(referenceFiles.evidenceManifest).cells.map(c=>c.parent),read(referenceFiles.priorManifest).cells.map(c=>c.parentId));
 assert.deepEqual(groups.development,m.development);assert.deepEqual(m.development,read(referenceFiles.previousManifest).development);assert.deepEqual(m.validation,read(referenceFiles.previousManifest).validation);assert.deepEqual(groups.validation,m.validation);assert.deepEqual(m.specs,SPECS);
 const sceneIndex=new Map(scenes.map(s=>[s.matchUrlId,s])),fingerprints=new Map(scenes.map(s=>[s.matchUrlId,s.fingerprint]));
 const devMaps=new Set(m.development.map(id=>jsonHash(sceneIndex.get(id).map))),valMaps=new Set(m.validation.map(id=>jsonHash(sceneIndex.get(id).map)));
 assert.equal(devMaps.size,64);assert.equal(valMaps.size,128);for(const h of valMaps)assert.ok(!devMaps.has(h));
 const priorMaps=new Set(m.priorParents.map(id=>jsonHash(sceneIndex.get(id).map)));for(const h of valMaps)assert.ok(!priorMaps.has(h),'EVIDENCE_VALIDATION_LEAK');
 const refs=Object.fromEntries(['baseline','R15','R29'].map(k=>[k,new Map(rows(referenceFiles[k]).map(r=>[key(r),r]))]));
 const stages=new Map();let executed=0,materialized=0,reused=0;
 for(const stage of result.stages){
  const dir=path.join(out,stage.name),jobs=read(path.join(dir,'jobs.json')),rs=rows(path.join(dir,'matches.ndjson.gz'));
  assert.deepEqual(read(path.join(dir,'identity.json')),{campaign:jsonHash(m),jobsSha256:jsonHash(jobs)});
  assert.equal(hash(fs.readFileSync(path.join(dir,'matches.ndjson.gz'))),stage.matchesSha256);assert.equal(rs.length,jobs.length);assert.equal(rs.length,stage.games);
  const cp=loadCheckpoint(path.join(dir,'checkpoint.ndjson'),jobs,fingerprints);assert.equal(cp.truncatedBytes,0);assert.equal(cp.records.size,jobs.length);
  rs.forEach((r,i)=>{validateRow(r,jobs[i],fingerprints.get(jobs[i].id));assert.deepEqual(r,cp.records.get(i));});
  assert.equal(stage.executedGames+stage.reusedGames,rs.length);assert.ok(!stages.has(stage.name));stages.set(stage.name,{rows:rs,jobs});executed+=stage.executedGames;reused+=stage.reusedGames;materialized+=stage.games;
 }
 const jobsFor=(ids,mode)=>ids.flatMap(id=>[0,1].map(seat=>({id,seat,mode}))),refFor=(ids,mode)=>ids.flatMap(id=>[0,1].map(seat=>refs[mode].get(id+':'+seat)));
 const expected=[];
 for(const mode of ['noop','R15','R29']){
  const name='preflight-'+mode,s=stages.get(name);expected.push(name);assert.deepEqual(s.jobs,jobsFor(m.development,mode));
  for(const r of s.rows){const b=refs[mode==='noop'?'baseline':mode].get(key(r));assert.deepEqual(semantic(r),semantic(b));assert.deepEqual(r.audit,b.audit);assert.equal(r.result.reason,b.result.reason);}
 }
 const auditCases=read(referenceFiles.auditCases).cases;assert.equal(auditCases.length,54);
 const evidence=[];
 for(const parent of ['R15','R29']){
  const name='mechanism-audit-'+parent,s=stages.get(name);expected.push(name);
  const cases=auditCases.filter(c=>c.parent===parent),jobs=cases.map(c=>({id:c.id,seat:c.seat,mode:'audit-'+parent,traceFrame:c.firstDifference.decisionIndex}));assert.deepEqual(s.jobs,jobs);
  const previous=new Map(rows(referenceFiles['audit'+parent]).map(r=>[key(r),r]));
  s.rows.forEach((r,i)=>{const b=previous.get(key(r));assert.deepEqual(semantic(r),semantic(b));assert.deepEqual(r.audit,b.audit);assert.equal(r.result.reason,b.result.reason);assert.equal(r.variant.traceOutcome.frame,jobs[i].traceFrame);
   const changed=r.variant.trace.filter(t=>!!t.before!==!!t.after).map(t=>{const safer=t.rowDominates?t.rowRisk:t.bestRisk,worse=t.rowDominates?t.bestRisk:t.rowRisk;
    const improvedMass=['immediateFatalMass','committedChanceFatalMass','horizonFatalMass','unknownMass'].filter(k=>safer[k]<worse[k]);
    return {...t,improvedMass,onlyNonMass:improvedMass.length===0};});
   evidence.push({id:r.matchUrlId,seat:r.candidateSeat,parent,frame:jobs[i].traceFrame,outcome:r.variant.traceOutcome,comparisons:r.variant.trace,changedComparisons:changed});
  });
 }
 save(path.join(out,'mechanism-evidence.json'),{games:54,equivalent:true,cases:evidence});
 const analysis=[];assert.deepEqual(result.rounds.map(r=>r.id),SPECS.map(r=>r.id));
 for(const r of result.rounds){
  const spec=SPECS.find(s=>s.id===r.id);assert.equal(r.mode,spec.mode);assert.equal(r.parent,spec.parent);let status='REJECTED_DEVELOPMENT';
  const available=[];
  for(const [level,ids]of [['development',m.development],['validation',m.validation],['full',scenes.map(s=>s.matchUrlId)]]){
   if(level==='validation'&&!(gate(r.development,true)&&gate(r.developmentParent,true)&&r.developmentActivity.mechanismChanges>0))break;
   if(level==='full'&&!(gate(r.validation)&&gate(r.validationParent)))break;
   const name=r.id+'-'+level,s=stages.get(name);assert.ok(s,'MISSING_STAGE:'+name);expected.push(name);assert.deepEqual(s.jobs,jobsFor(ids,r.mode));
   assert.deepEqual(compare(refFor(ids,'baseline'),s.rows),r[level]);assert.deepEqual(compare(refFor(ids,r.parent),s.rows),r[level+'Parent']);
   const activity=Object.fromEntries(['ownerCalls','comparisons','changedPreferences','bonusCalls','changedBonuses','mechanismChanges'].map(k=>[k,s.rows.reduce((n,x)=>n+x.variant[k],0)]));assert.deepEqual(activity,r[level+'Activity']);
   if(level==='full'){
    const index=new Map(s.rows.map(x=>[key(x),x]));for(const l of ['development','validation'])for(const x of stages.get(r.id+'-'+l).rows)assert.deepEqual(index.get(key(x)),x);
    assert.equal(result.stages.find(s=>s.name===name).reusedGames,384);
   }else assert.equal(result.stages.find(s=>s.name===name).reusedGames,0);
   status=level==='full'&&gate(r.full)&&gate(r.fullParent)?'QUALIFIED_DIAGNOSTIC_PENDING_PORTABILITY_AND_MULTISEED':'REJECTED_'+level.toUpperCase();available.push(level);
  }
  assert.equal(status,r.status);const last=available.at(-1);
  analysis.push({id:r.id,parent:r.parent,condition:r.condition,status,lastStage:last,productionReasons:why(r[last],last==='development'),parentReasons:why(r[last+'Parent'],last==='development')});
 }
 assert.deepEqual([...stages.keys()],expected);assert.equal(executed,result.executedGames);assert.equal(reused,result.reusedGames);assert.equal(materialized,result.materializedRows);
 assert.deepEqual(result.qualified,result.rounds.filter(r=>r.status.startsWith('QUALIFIED_')).map(r=>r.id));
 save(path.join(out,'analysis.json'),analysis);
 save(path.join(out,'validation.json'),{status:'PASS',rounds:10,executedGames:executed,materializedRows:materialized,reusedGames:reused,stages:stages.size,sourceIdentity:true,inputIdentity:true,mapIsolation:true,checkpointIntegrity:true,dualReferenceGates:true,productionUnchanged:true,errors:0,timeouts:0,restore:0,hotAllocations:0});
 console.log(JSON.stringify({status:'PASS',executedGames:executed,reusedGames:reused,qualified:result.qualified,analysis},null,2));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={gate,run};
