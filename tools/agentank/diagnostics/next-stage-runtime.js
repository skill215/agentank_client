'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict'),cp=require('node:child_process');
const D=require('./semantic-performance-design');
const read=f=>JSON.parse(fs.readFileSync(f));
function save(f,x){fs.writeFileSync(f,JSON.stringify(x,null,2)+'\n',{flag:'wx'});}
const memoryPrelude=`(()=>{const seen=new WeakSet();globalThis.__bp407mem={bytes:0,arrays:0,callbackBytes:0,callbackArrays:0,inCallback:false};for(const name of ['Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array','Uint8ClampedArray']){const C=globalThis[name];globalThis[name]=new Proxy(C,{construct(target,args){const a=Reflect.construct(target,args);if(!seen.has(a.buffer)){seen.add(a.buffer);__bp407mem.bytes+=a.buffer.byteLength;if(__bp407mem.inCallback)__bp407mem.callbackBytes+=a.buffer.byteLength;}__bp407mem.arrays++;if(__bp407mem.inCallback)__bp407mem.callbackArrays++;return a;}});}})();\n`;
async function worker(root,out,mode,block){
 const arena=require('./native-base-policy-standalone-arena'),{VmNativeBasePolicyDiagnosticBot:VM}=arena;
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock'),event=await require('./strategic-event-simulator').load(root);
 const enemy=V3DiagnosticBot.prototype.decide;V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const p=read(path.join(out,'protocol.json'));assert.equal(arena.productionTreeSha256(root),p.productionTree);
 const scenes=read(path.join(out,'scenarios.json'));let code=mode==='native'?null:fs.readFileSync(path.join(out,'build',mode.startsWith('candidate')?'candidate':'baseline',mode.includes('source')?'source.js':'minified.js'),'utf8');
 const memory=mode.endsWith('-memory');if(memory)code=memoryPrelude+code;
 const dec=VM.prototype.decide,summary=VM.prototype.summary;
 VM.prototype.decide=function(c){if(memory)this.sandbox.__bp407mem.inCallback=true;try{return dec.call(this,c);}finally{if(memory)this.sandbox.__bp407mem.inCallback=false;}};
 VM.prototype.summary=function(){return {...summary.call(this),...(memory?{observedTypedArrays:JSON.parse(JSON.stringify(this.sandbox.__bp407mem))}:{})};};
 if(block>=0)for(let i=0;i<4;i++)await arena.play(event.wrap({seed:407900+i},()=>{}),scenes[i],i%2,false,code);
 const rows=[];
 for(let i=0;i<scenes.length;i++)for(let seat=0;seat<2;seat++){
  const seed=407100+i,job={mode,block,id:scenes[i].matchUrlId,seat,seed,env:i%2?'event':'original',origin:scenes[i].origin,...(i%2?{eventFrom:0,eventSeed:seed}:{})};
  const r=await arena.play(event.wrap(job,()=>{}),scenes[i],seat,false,code);
  for(const side of [r.candidate,r.control]){assert.equal(side.errorCount,0);assert.equal(side.timeoutCount,0);}r.job=job;r.signature=D.hash(D.signature(r));rows.push(r);
 }
 assert.equal(arena.productionTreeSha256(root),p.productionTree);save(path.join(out,block>=0?'timing-'+block+'.json':mode+'.json'),{mode,block,games:rows.length,warmups:block>=0?4:0,rows,processMemory:process.memoryUsage()});
}
async function run(root,out){
 fs.mkdirSync(out,{recursive:true});const arena=require('./native-base-policy-standalone-arena');const tree=arena.productionTreeSha256(root);
 const candidate=fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp406-hotspot-performance-hundred-rounds/candidate/hazard.js'),'utf8');
 const manifest=read(path.join(root,'artifacts/native-causal-audit/bp406-hotspot-performance-hundred-rounds/candidate/manifest.json'));assert.equal(D.hash(candidate),manifest.candidateSha256);
 const historical=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/scenarios.json.gz'))));
 const synthetic=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp404-completed-layer-hundred-rounds/scenarios.json.gz')))).filter(s=>s.origin==='synthetic');
 const scenes=Array.from({length:8},(_,i)=>i%2?{...synthetic[200+i],origin:'synthetic-reuse'}:{...historical[650+i],origin:'historical-reuse'});
 // Alternate RNG independently of data origin.
 const ordered=[scenes[0],scenes[2],scenes[1],scenes[3],scenes[4],scenes[6],scenes[5],scenes[7]];
 save(path.join(out,'scenarios.json'),ordered);
 save(path.join(out,'protocol.json'),{version:'BP407_TARGET_SHAPED_RUNTIME_V1',productionTree:tree,candidateSha256:manifest.candidateSha256,sourceSha256:D.hash(fs.readFileSync(__filename)),
  cases:16,timingOrder:['baseline-minified','candidate-minified','candidate-minified','baseline-minified'],
  acceptance:'Exact complete-game behavior across native/source/minified baseline/candidate; deterministic builds and code-size pass; observed typed-array allocations equal; geometric timing ratio <=.95 and bootstrap hi<1; per-case ratio p95<=1.10; each origin and RNG subgroup ratio<1; baseline repeat ratio within [.95,1.05].',
  limits:'Restricted-Math Node VM and upload-shaped minified bundle. Local compatibility/performance acceptance only, not remote platform certification. Memory counters cover typed-array constructor buffers, not total JS heap or platform memory cap.'});
 const {assembleProductionSource}=require('../build/imp6-builder'),{ENTRY,compile}=require('../build/native-base-policy-upload-builder'),{executeSequence}=require('../build/base-policy-candidate-builder'),{PLATFORM_CODE_LIMIT_BYTES}=require('../platform/code-size-policy');
 const builds={};
 for(const mode of ['baseline','candidate']){
  const source=assembleProductionSource(root,{entry:path.join(root,ENTRY),...(mode==='candidate'?{moduleSourceOverrides:{'engine-v2/src/fast/hazard.js':candidate}}:{})}).source;
  const mini=await compile(source),again=await compile(source);assert.equal(mini,again);const a=executeSequence(source),b=executeSequence(mini);assert.equal(a.fingerprint,b.fingerprint);assert.ok(Buffer.byteLength(mini)<=PLATFORM_CODE_LIMIT_BYTES);
  const dir=path.join(out,'build',mode);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'source.js'),source,{flag:'wx'});fs.writeFileSync(path.join(dir,'minified.js'),mini,{flag:'wx'});
  builds[mode]={sourceSha256:D.hash(source),minifiedSha256:D.hash(mini),bytes:Buffer.byteLength(mini),limit:PLATFORM_CODE_LIMIT_BYTES,deterministic:true,fixture:a.fingerprint};
 }assert.equal(builds.baseline.fixture,builds.candidate.fixture);save(path.join(out,'builds.json'),builds);
 for(const mode of ['native','baseline-source','candidate-source','baseline-minified','candidate-minified','baseline-memory','candidate-memory']){
  cp.execFileSync(process.execPath,[__filename,'--worker',root,out,mode,'-1'],{stdio:'pipe',maxBuffer:1024*1024});console.log(JSON.stringify({stage:'runtime-equivalence',mode}));
 }
 const references=read(path.join(out,'native.json')).rows;
 for(const mode of ['baseline-source','candidate-source','baseline-minified','candidate-minified','baseline-memory','candidate-memory'])for(const [i,r]of read(path.join(out,mode+'.json')).rows.entries())assert.equal(r.signature,references[i].signature,'VM_BEHAVIOR_DRIFT:'+mode+':'+i);
 const mb=read(path.join(out,'baseline-memory.json')).rows,mc=read(path.join(out,'candidate-memory.json')).rows;
 for(let i=0;i<mb.length;i++)assert.deepEqual(mb[i].candidateEngine.observedTypedArrays,mc[i].candidateEngine.observedTypedArrays);
 const order=read(path.join(out,'protocol.json')).timingOrder;
 for(let block=0;block<4;block++){cp.execFileSync(process.execPath,[__filename,'--worker',root,out,order[block],String(block)],{stdio:'pipe',maxBuffer:1024*1024});console.log(JSON.stringify({stage:'runtime-timing',block: block+1}));}
 const blocks=order.map((_,i)=>read(path.join(out,'timing-'+i+'.json')).rows),cases=[];
 for(let i=0;i<16;i++){for(const b of blocks)assert.equal(b[i].signature,references[i].signature);const ms=blocks.map(b=>b[i].candidateEngine.runtimeMicros/1000);
  cases.push({id:references[i].matchUrlId,seat:references[i].candidateSeat,origin:references[i].job.origin,env:references[i].job.env,ms,ratio:(ms[1]+ms[2])/(ms[0]+ms[3]),baselineRepeat:ms[3]/ms[0]});}
 const stats=D.stats(cases.map(r=>r.ratio)),repeat=D.stats(cases.map(r=>r.baselineRepeat)),groups={};
 for(const field of ['origin','env'])for(const val of new Set(cases.map(r=>r[field])))groups[field+':'+val]=D.stats(cases.filter(r=>r[field]===val).map(r=>r.ratio));
 const accepted=stats.ratio<=.95&&stats.hi<1&&stats.p95<=1.1&&Object.values(groups).every(g=>g.ratio<1)&&repeat.ratio>=.95&&repeat.ratio<=1.05;
 const result={status:accepted?'LOCAL_TARGET_SHAPED_ACCEPTED':'LOCAL_TARGET_SHAPED_NOT_QUALIFIED',productionChanged:false,remotePlatformCertified:false,builds,cases,stats,repeat,groups,
  behaviorChecks:16*10,memoryEqualityCases:16,typedArrayBytes:mb.map(r=>r.candidateEngine.observedTypedArrays.bytes),games:176,warmups:16,totalGames:192,
  pending:'Remote platform execution, full-heap memory cap and platform absolute deadline are not certified by this local harness.'};
 save(path.join(out,'summary.json'),result);assert.equal(arena.productionTreeSha256(root),tree);console.log(JSON.stringify(result));
}
if(process.argv[2]==='--worker')worker(process.argv[3],process.argv[4],process.argv[5],Number(process.argv[6])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
else if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={memoryPrelude};
