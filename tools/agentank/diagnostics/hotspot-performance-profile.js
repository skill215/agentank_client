'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),inspector=require('node:inspector'),assert=require('node:assert/strict');
async function run(root,out){
 fs.mkdirSync(out,{recursive:true});const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
 const {V3DiagnosticBot}=require('../../../engine-v3/src'),{withClock}=require('./deterministic-v1-clock');
 const enemy=V3DiagnosticBot.prototype.decide;V3DiagnosticBot.prototype.decide=function(c){return withClock(this.controller.runtime.sandbox,()=>enemy.call(this,c));};
 const event=await require('./strategic-event-simulator').load(root),tree=productionTreeSha256(root);
 const histories=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp386-bomb-phase-calibrated/scenarios.json.gz'))));
 const synth=JSON.parse(z.gunzipSync(fs.readFileSync(path.join(root,'artifacts/native-causal-audit/bp404-completed-layer-hundred-rounds/scenarios.json.gz')))).filter(s=>s.origin==='synthetic');
 const scenes=Array.from({length:16},(_,i)=>i%2?histories[200+i]:synth[160+i]);
 for(let i=0;i<4;i++)await play(event.wrap({seed:406000+i},()=>{}),scenes[i],i%2);
 const session=new inspector.Session();session.connect();const post=(m,p={})=>new Promise((resolve,reject)=>session.post(m,p,(e,r)=>e?reject(e):resolve(r)));
 await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:200});await post('Profiler.start');
 const matches=[];
 for(let i=0;i<32;i++){const job={seed:406100+i,seat:Math.floor(i/16),...(i%2?{eventFrom:0,eventSeed:406100+i}:{})};const r=await play(event.wrap(job,()=>{}),scenes[i%16],job.seat);
 for(const s of [r.candidate,r.control])assert.equal(s.errorCount+s.timeoutCount,0);matches.push({id:r.matchUrlId,seat:r.candidateSeat,frames:r.frames});}
 const {profile}=await post('Profiler.stop');session.disconnect();assert.equal(productionTreeSha256(root),tree);
 fs.writeFileSync(path.join(out,'baseline.cpuprofile'),JSON.stringify(profile));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of profile.nodes)for(const c of n.children||[])parents.set(c,n.id);
 const totals=new Map();let nativeMicros=0,totalMicros=0,nativeSamples=0;
 for(let i=0;i<profile.samples.length;i++){const id=profile.samples[i],n=nodes.get(id),micros=profile.timeDeltas[i];totalMicros+=micros;let native=false;
 for(let at=id;at;at=parents.get(at))if(nodes.get(at).callFrame.url.includes('/engine-v2/src/')){native=true;break;}
 if(!native)continue;nativeMicros+=micros;nativeSamples++;const c=n.callFrame,key=c.url.replace('file://'+root+'/','')+':'+(c.lineNumber+1)+':'+c.functionName;totals.set(key,(totals.get(key)||0)+micros);}
 const top=[...totals].sort((a,b)=>b[1]-a[1]).map(([location,micros])=>({location,micros,nativeSampleShare:micros/nativeMicros}));
 const summary={profile:'BP406_ADMISSION_PROFILE',productionTree:tree,games:32,warmupGames:4,samplingIntervalMicros:200,totalMicros,nativeMicros,nativeSamples,top,scenes:matches,limits:'Sample attribution includes descendants of native engine; profiler overhead and JIT inlining apply. Diagnostic evidence only; excluded from speed qualification.'};
 fs.writeFileSync(path.join(out,'profile-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,top:top.slice(0,18),scenes:undefined}));
}
if(require.main===module)run(process.cwd(),path.resolve(process.argv[2])).catch(e=>{console.error(String(e.stack).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[adapter]'));process.exitCode=1;});
module.exports={run};
