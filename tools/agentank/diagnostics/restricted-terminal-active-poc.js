'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {evaluateRestrictedTerminal}=require('./restricted-terminal-certificate');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot:B}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function selectCertifiedRow(engine,certificate){
 if(certificate.status!=='SUPPORTED_LOCAL_CERTIFICATE'||certificate.action!==4||certificate.reasons.length)return -1;
 const row=certificate.row;
 if(!Number.isInteger(row)||row<0||row>=engine.ourCount||engine.ourActions[row]!==4||engine.hardStatus[row]!==0)return -1;
 return engine.finalGate.finalAllows(engine.adapter.bundle,engine.ourActions,engine.ourArguments,row,engine.ourCount)?row:-1;
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),inputs=[];
 const read=n=>{const bytes=fs.readFileSync(path.join(base,n));inputs.push({path:n,sha256:hash(bytes)});return zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse);};
 const targets=read('bp363-restricted-terminal-certificate/diagnostic-samples.ndjson.gz'),old=read('bp349-navigation-family-external/matches.ndjson.gz');
 const frozen=JSON.parse(fs.readFileSync(path.join(base,'bp349-navigation-family-external/manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,frozen.tree);for(const f of frozen.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const {module}=await loadSimulator(root),{scenarios}=loadRollingV1ScenariosForIds(targets.map(t=>t.id),root),select=E.prototype.selectIncumbent,decide=B.prototype.decide,work=new WeakMap(),records=[];
 let target,audit;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,inputs,
  sources:['restricted-terminal-active-poc.js','restricted-terminal-certificate.js','single-frame-terminal-evidence.js','terminal-entry-premises.js','terminal-observation-boundary.js','ballistic-terminal-witness.js','cooldown-stun-normalization.js'].map(f=>({path:f,sha256:hash(fs.readFileSync(path.join(__dirname,f)))})),
  scope:'Seven preselected historical roots only; recompute certificate before emit; FinalActionGate retained; no general production adoption'},null,2));
 try{
  E.prototype.selectIncumbent=function(count){const row=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,row);};
  B.prototype.decide=function(context){
   if(context.game.frames!==target.frame)return decide.call(this,context);
   assert.equal(audit,null);const engine=this.engine,emit=engine.emit;
   engine.emit=function(me,action){
    assert.equal(audit,null);const cert=evaluateRestrictedTerminal(engine,context);
    assert.equal(cert.hashLo,target.restrictedCertificate.hashLo);assert.equal(cert.hashHi,target.restrictedCertificate.hashHi);assert.equal(cert.frame,target.frame);
    const row=selectCertifiedRow(engine,cert);audit={certificate:cert,originalAction:action,selectedAction:row>=0?4:action,override:row>=0&&action!==4};
    if(row>=0){engine.lastSelectedRow=row;engine.basePolicy.intent.commitSelection(4);}
    return emit.call(engine,me,audit.selectedAction);
   };
   try{return decide.call(this,context);}finally{engine.emit=emit;}
  };
  for(target of targets){audit=null;const scenario=scenarios.find(s=>s.matchUrlId===target.id),prior=old.find(m=>m.mode==='NAVIGATION_FAMILY'&&m.matchUrlId===target.id&&m.candidateSeat===target.seat);assert.equal(scenario.fingerprint,prior.scenarioFingerprint);
   const m=await play(module,scenario,target.seat,false);assert.ok(audit);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
   for(const side of ['candidate','control']){const a=Buffer.from(m[side].compactActionStream,'base64'),b=Buffer.from(prior[side].compactActionStream,'base64');assert.deepEqual(a.subarray(0,target.frame),b.subarray(0,target.frame));if(side==='control')assert.equal(a[target.frame],b[target.frame]);assert.deepEqual(m[side].compactArguments,prior[side].compactArguments);}
   assert.equal(Buffer.from(m.candidate.compactActionStream,'base64')[target.frame],audit.selectedAction);
   if(audit.override){assert.equal(m.analysisOutcome,'V2_WIN');assert.equal(m.frames,target.frame+1);assert.equal(m.counts.crashes[target.seat^1],1);assert.equal(m.counts.bullets[target.seat],prior.counts.bullets[target.seat]+1);}
   else{assert.equal(m.analysisOutcome,prior.analysisOutcome);assert.deepEqual(m.counts,prior.counts);for(const side of ['candidate','control'])assert.equal(m[side].compactActionStream,prior[side].compactActionStream);}
   records.push({id:target.id,seat:target.seat,frame:target.frame,before:prior.analysisOutcome,after:m.analysisOutcome,terminalCategory:m.terminalCategory,counts:m.counts,...audit,candidate:m.candidate,control:m.control});
  }
 }finally{E.prototype.selectIncumbent=select;B.prototype.decide=decide;}
 const transitions={};for(const r of records){const key=r.before+'->'+r.after;transitions[key]=(transitions[key]||0)+1;}
 const overview={tree,roots:records.length,overrides:records.filter(r=>r.override).length,transitions,
  records:records.map(({candidate,control,...r})=>r),checks:{prefixDrift:0,opponentActionAtRootDrift:0,blockedControlDrift:0,errors:0,timeouts:0,restore:0},
  productionAdoption:false,evidenceClass:'TARGETED_CAUSAL_POC_NOT_WINRATE_QUALIFICATION'};
 assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={selectCertifiedRow};
