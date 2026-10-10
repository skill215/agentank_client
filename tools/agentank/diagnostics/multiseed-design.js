'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fingerprintObject}=require('../core/hash');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function createDesign(historical,priorScenes,cells){
  const byId=new Map(historical.map(s=>[s.matchUrlId,s]));
  assert.equal(cells.length,192);assert.equal(new Set(cells.map(c=>c.parentId)).size,192);
  assert.equal(new Set(cells.map(c=>JSON.stringify(byId.get(c.parentId).map))).size,192);
  const conditions={},used=new Map(cells.map(c=>[c.parentId,new Set([c.oldSeed,c.newSeed,c.replicaSeed])]));
  for(let k=1;k<=5;k++){
    const name='seed-'+String(k).padStart(2,'0');conditions[name]=[];
    for(const c of cells){const p=byId.get(c.parentId),seed=parseInt(hash('bp394-'+name+'-v1:'+p.fingerprint).slice(0,8),16)>>>0;
      assert.ok(!used.get(c.parentId).has(seed),'SEED_COLLISION');used.get(c.parentId).add(seed);
      const s=structuredClone(p);s.matchUrlId='bp394-'+name+'-'+p.matchUrlId;s.scenarioKind='MULTISEED_REPLICATION';
      s.parentMatchUrlId=p.matchUrlId;s.parentFingerprint=p.fingerprint;s.condition=name;s.simulationSeed=seed;
      delete s.originalResult;delete s.originalFrames;s.fingerprint='';s.fingerprint=fingerprintObject(s);conditions[name].push(s);
    }
  }
  const oldReplica=new Map(priorScenes.filter(s=>s.condition==='seed-replica').map(s=>[s.parentMatchUrlId,s]));
  const selected=cells.slice().sort((a,b)=>hash('bp394-preflight-v1:'+a.parentId).localeCompare(hash('bp394-preflight-v1:'+b.parentId))).slice(0,8);
  const preflight=selected.flatMap(c=>{assert.ok(oldReplica.has(c.parentId));return [byId.get(c.parentId),oldReplica.get(c.parentId)];});
  return {conditions,preflight};
}
function clusterInterval(blocks,gamesPerMap=2){
  assert.ok(blocks.length>0&&Number.isInteger(gamesPerMap)&&gamesPerMap>0);let state=394;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};const samples=[];
  for(let i=0;i<2000;i++){let d=0;for(let j=0;j<blocks.length;j++)d+=blocks[Math.floor(random()*blocks.length)];samples.push(100*d/(blocks.length*gamesPerMap));}
  samples.sort((a,b)=>a-b);return {deltaPoints:blocks.reduce((a,b)=>a+b,0),games:blocks.length*gamesPerMap,mapGroups:blocks.length,
    descriptive95PercentInterval:[samples[50],samples[1949]],resamples:2000};
}
function support(performance,uncertainty,rounds){
  assert.equal(rounds.length,5);const reasons=[];
  if(performance.deltaPoints<=0)reasons.push('NON_POSITIVE_TOTAL');
  if(uncertainty.descriptive95PercentInterval[0]<=0)reasons.push('INTERVAL_NOT_POSITIVE');
  if(performance.candidate.singleCrashLosses>performance.baseline.singleCrashLosses)reasons.push('DEATH_INCREASE');
  if(performance.candidate.doubleLosses>performance.baseline.doubleLosses)reasons.push('SWEEP_INCREASE');
  if(rounds.some(r=>r.performance.nodeRatio>2))reasons.push('WORK_LIMIT');
  if(rounds.filter(r=>r.status==='PRESSURE_PASS').length<4)reasons.push('FEWER_THAN_FOUR_SEED_PASSES');
  return {status:reasons.length?'INSUFFICIENT_MULTI_SEED_SUPPORT':'MULTI_SEED_SUPPORT',reasons};
}
module.exports={createDesign,clusterInterval,support};
