'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {TerminalDependencyContract,REASON}=require('./terminal-dependency-contract');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),names=['bp354b-terminal-evidence-support/overview.json','bp353-terminal-risk-simulator-oracle/manifest.json','bp356-multi-projectile-terminal/overview.json'],inputs=names.map(name=>({name,bytes:fs.readFileSync(path.join(base,name))})),shadow=JSON.parse(inputs[0].bytes),oracle=JSON.parse(inputs[1].bytes),stress=JSON.parse(inputs[2].bytes),tree=productionTreeSha256(root);assert.equal(shadow.tree,tree);assert.equal(stress.tree,tree);
 const checker=new TerminalDependencyContract(),records=[];
 for(const r of shadow.records){const identity={frame:r.frame,hashLo:r.sourceHashLo,hashHi:r.sourceHashHi,action:r.action,ruleHash:oracle.simulatorEngineSha256};
  const evidence={identity,hardAllowed:r.conditions.hardAllowed,expected:r.expected,seen:r.seen,unresolved:r.unresolved,wins:r.wins,draws:r.draws,losses:r.losses,gapMask:r.informationGapMask,
   // No independent all-platform-command domain proof exists yet.
   domainComplete:false,ruleCertificate:null,projectileCertificate:null,starCertificate:null};
  const status=checker.evaluate(evidence,identity),reasons=Object.entries(REASON).filter(([,flag])=>checker.reasonMask&flag).map(([name])=>name);
  records.push({id:r.id,seat:r.seat,identity,enumeratedAllWin:r.seen===r.expected&&r.wins===r.expected&&r.unresolved===0,status,reasons,ignoredGapMask:checker.ignoredGapMask,finiteStress:stress.records.find(x=>x.id===r.id&&x.seat===r.seat)?.counts});
 }
 const reasons={};for(const r of records)for(const k of r.reasons)reasons[k]=(reasons[k]||0)+1;
 const overview={tree,roots:records.length,enumeratedAllWin:records.filter(r=>r.enumeratedAllWin).length,dependenciesSatisfied:records.filter(r=>r.status==='SHADOW_DEPENDENCIES_SATISFIED').length,reasons,records,productionAdoption:false,strictProof:false,notes:['Existing frozen records only; no new simulation or parameter tuning','Certificate validation tests use synthetic objects, not genuine rule proofs','Dependency checker validates contract shape/identity, not mathematical correctness of a supplied derivation']};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,inputs:inputs.map(i=>({path:i.name,sha256:hash(i.bytes)})),sources:['terminal-dependency-contract.js','terminal-dependency-audit.js'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(__dirname,name)))}))},null,2));fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]);
