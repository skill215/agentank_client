'use strict';
// Fresh processes never execute the shadow oracle. An unchanged recompiled
// method is a negative control for dynamic compilation / JIT attribution.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const D=require('./hotspot-performance-design');
const read=f=>JSON.parse(fs.readFileSync(f));
function save(f,x){assert.ok(!fs.existsSync(f),'IMMUTABLE_FILE_EXISTS:'+f);fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n');}
async function worker(root,out,mode,block){
 const {play,NativeBasePolicyDiagnosticBot:Bot,productionTreeSha256}=require('./native-base-policy-standalone-arena');
 const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const p=read(path.join(out,'clean-process-protocol.json')),scenes=read(path.join(out,'scenarios.json'));
 assert.equal(productionTreeSha256(root),p.productionTree);
 const methods=D.compile(root);if(mode!=='original')HazardKernel.prototype.reverseViable=methods[mode==='recompiled'?'baseline':mode];
 const enemy=V3DiagnosticBot.prototype.decide;V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 let times=[],ownerChecks=0,finalChecks=0;const decide=Bot.prototype.decide;
 Bot.prototype.decide=function(...a){const start=process.hrtime.bigint();try{return decide.apply(this,a);}finally{times.push(Number(process.hrtime.bigint()-start)/1e6);}};
 Bot.prototype.captureRoot=function(){const e=this.engine;if(this.searchEvidenceCurrent&&e.lastProposalRow>=0){assert.equal(e.hardStatus[e.lastProposalRow],0);assert.equal(e.basePolicy.owner.allowedRow[e.lastProposalRow],1);ownerChecks++;}
  if(e.lastSelectedRow>=0){assert.ok(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,e.lastSelectedRow,e.ourCount));finalChecks++;}};
 const event=await require('./strategic-event-simulator').load(root);
 for(let i=0;i<8;i++)await play(event.wrap({seed:406900+i%3},()=>{}),scenes.preflight[i%4],i%2,true);
 const result=[];
 for(let i=70;i<100;i++){const scene=scenes.formal[i],job=read(path.join(out,'R'+(721+i),'jobs.json'))[0];times=[];ownerChecks=finalChecks=0;
  const r=await play(event.wrap(job,()=>{}),scene,job.seat,true);for(const side of [r.candidate,r.control])assert.equal(side.errorCount+side.timeoutCount,0);
  assert.equal(r.candidateEngine.rootRestoreFailures,0);assert.equal(r.candidateEngine.hotAllocations,0);delete r.candidateEngine.rootFrames;delete r.control.actionFrames;
  result.push({mode,block,round:721+i,decisionMs:times.reduce((n,v)=>n+v,0),decisionTimesMs:times,ownerChecks,finalChecks,row:r,signature:D.hash(D.signature(r))});
 }
 assert.equal(productionTreeSha256(root),p.productionTree);save(path.join(out,`clean-block-${block}.json`),{mode,block,warmupGames:8,games:30,result});
}
async function run(root,out){
 const summary=read(path.join(out,'summary.json')),mode=Object.keys(summary.final)[0];assert.ok(mode,'NO_CANDIDATE_TO_VERIFY');
 const sourceSha256=D.hash(fs.readFileSync(__filename));
 const protocol={version:'BP406_CLEAN_PROCESS_NEGATIVE_CONTROL_V1',selected:mode,productionTree:summary.productionTree,sourceSha256,
  order:['original','recompiled',mode,mode,'recompiled','original'],warmupGamesPerProcess:8,measuredGamesPerProcess:30,
  inputs:'Reuse fixed last 30 formal cases solely for independent runtime-harness verification. No shadow evaluator, no profiling, no mode swapping within each process.',
  gate:'Candidate must pass the same 30-case performance qualification versus both original and unchanged recompiled source. Negative-control geometric ratio must lie in [.95,1.05]; original first/last block repeat ratio must lie in [.95,1.05]. Otherwise withhold qualification.',
  limits:'A local isolated-process verification, not an independent workload or target-platform runtime certificate.'};
 save(path.join(out,'clean-process-protocol.json'),protocol);fs.copyFileSync(__filename,path.join(out,'sources',path.basename(__filename)));
 for(let i=0;i<protocol.order.length;i++){
  cp.execFileSync(process.execPath,[__filename,'--worker',root,out,protocol.order[i],String(i)],{stdio:'pipe',maxBuffer:1024*1024});
  assert.equal(D.hash(fs.readFileSync(__filename)),sourceSha256);console.log(JSON.stringify({phase:'CLEAN_PROCESS_VERIFICATION',block:i+1,mode:protocol.order[i],games:(i+1)*30}));
 }
 const blocks=protocol.order.map((_,i)=>read(path.join(out,`clean-block-${i}.json`))),records=[];
 for(let i=0;i<30;i++){const record=read(path.join(out,'R'+(791+i)+'.json')),rows=blocks.map(b=>b.result[i]);assert.ok(rows.every(r=>r.signature===rows[0].signature));assert.equal(rows[0].signature,record.semanticSha256);
  const sum=m=>rows.filter(r=>r.mode===m).reduce((n,r)=>n+r.decisionMs,0);
  records.push({round:791+i,env:record.env,origin:record.origin,ratios:{versusOriginal:sum(mode)/sum('original'),versusRecompiled:sum(mode)/sum('recompiled'),negativeControl:sum('recompiled')/sum('original')},repeat:rows[5].decisionMs/rows[0].decisionMs,exact:true});
 }
 const original=D.qualify(records,'versusOriginal'),recompiled=D.qualify(records,'versusRecompiled'),control=D.stats(records.map(r=>r.ratios.negativeControl)),repeat=D.stats(records.map(r=>r.repeat));
 const qualified=original.qualified&&recompiled.qualified&&control.ratio>=.95&&control.ratio<=1.05&&repeat.ratio>=.95&&repeat.ratio<=1.05;
 save(path.join(out,'clean-process-verification.json'),{selected:mode,games:180,warmupGames:48,processes:6,records,versusOriginal:original,versusRecompiled:recompiled,negativeControl:control,baselineRepeat:repeat,exact:true,qualified,
  conclusion:qualified?'CONFIRMED_LOCAL_SPEEDUP_RETAIN_DIAGNOSTIC':'WITHHOLD_QUALIFICATION_RUNTIME_HARNESS_SENSITIVITY'});
 console.log(JSON.stringify({qualified,original,recompiled,control,repeat}));
}
if(process.argv[2]==='--worker')worker(process.argv[3],process.argv[4],process.argv[5],Number(process.argv[6])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
