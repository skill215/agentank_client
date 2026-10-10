'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {skipSearch}=require('./geometric-contact-admission');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadRollingV1Scenarios}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const score=m=>m.analysisOutcome==='V2_WIN'?1:m.analysisOutcome==='DRAW'?0.5:0;
function pairedTest(deltas){
 let distribution=new Map([[0,1]]);
 for(const d of deltas){const next=new Map();for(const [sum,p] of distribution)for(const sign of [-1,1])next.set(sum+sign*d,(next.get(sum+sign*d)||0)+p/2);distribution=next;}
 const observed=deltas.reduce((a,b)=>a+b,0);let p=0;for(const [sum,prob] of distribution)if(Math.abs(sum)>=Math.abs(observed))p+=prob;
 return {observedHalfPoints:observed,twoSidedP:Math.min(1,p),unit:'scenario, paired seat sum',method:'exact sign randomization; historical reuse prevents confirmatory interpretation'};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const tree=productionTreeSha256(root),base=path.join(root,'artifacts/native-causal-audit');
 assert.equal(tree,JSON.parse(fs.readFileSync(path.join(base,'bp337-geometric-contact-admission/overview.json'))).tree);
 const excluded=new Set(JSON.parse(fs.readFileSync(path.join(root,'config/engine-v3/v3-repair-cohort.json'))).scenarios.map(x=>x.matchUrlId));
 for(const t of JSON.parse(fs.readFileSync(path.join(base,'bp305-independent-admission/manifest.json'))).targets)excluded.add(t.id);
 const rolling=loadRollingV1Scenarios(root),salt='bp338-frozen-geometric-layered128-external-v1';
 const seen=new Set(),pool=rolling.scenarios.filter(s=>!excluded.has(s.matchUrlId)&&!seen.has(s.fingerprint)&&seen.add(s.fingerprint));
 pool.sort((a,b)=>hash(salt+a.fingerprint).localeCompare(hash(salt+b.fingerprint)));const scenarios=pool.slice(0,64);assert.equal(scenarios.length,64);
 const files=[__filename,path.join(__dirname,'geometric-contact-admission.js'),path.join(__dirname,'thin-layer-executor.js')];
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,salt,eligible:pool.length,snapshot:rolling.snapshot.fingerprint,targets:scenarios.map(s=>({id:s.matchUrlId,fingerprint:s.fingerprint})),modes:['CURRENT','LAYERED128_GEOMETRIC'],games:256,skills:['stun','stun'],maxFrames:128,thresholds:{scoreGainPoints:3,scenarioPairedP:0.05,killsNondecreasing:true,deathsNonincreasing:true},historicallyReused:true,sourceHashes:files.map(f=>({file:path.relative(root,f),sha256:hash(fs.readFileSync(f))}))},null,2));
 const {module}=await loadSimulator(root),source=O.prototype.source,prepare=S.prototype.prepare,executors=new WeakMap(),matches=[],counters={CURRENT:{entries:0,skipped:0,searches:0,depths:[0,0,0,0]},LAYERED128_GEOMETRIC:{entries:0,skipped:0,searches:0,depths:[0,0,0,0]}};let mode;
 try{O.prototype.source=function(engine,count){const c=counters[mode];c.entries++;if(mode!=='CURRENT'){const a=engine.adapter.state.arrays,until=a[ARRAY.TANK_STUN_UNTIL][1],frame=a[ARRAY.SCALAR][SCALAR.FRAME];if(skipSearch(engine.manhattan(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),engine.clearLine(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),until!==NONE_FRAME&&until>frame)){c.skipped++;return null;}}return source.call(this,engine,count);};
 S.prototype.prepare=function(engine,count,eligibility){const c=counters[mode];c.searches++;if(mode==='CURRENT')return prepare.call(this,engine,count,eligibility);this.bindIsolatedHard(engine.adapter.bundle);let e=executors.get(this);if(!e){e=new ThinLayerExecutor(this,this.diagnosticKernel,engine.adapter.state);executors.set(this,e);}const r=e.run(engine,count,eligibility,prepare,128,3);assert.ok(r.used<=128);c.depths[r.completedDepth]++;return r.completedDepth>0?1:0;};
 for(let i=0;i<scenarios.length;i++)for(let seat=0;seat<2;seat++)for(mode of i%2?['LAYERED128_GEOMETRIC','CURRENT']:['CURRENT','LAYERED128_GEOMETRIC']){
 const m=await play(module,scenarios[i],seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);matches.push({...compact(m),mode});if(matches.length%16===0)console.error(`[bp338] ${matches.length}/256`);
 }
 }finally{O.prototype.source=source;S.prototype.prepare=prepare;}
 const before=matches.filter(m=>m.mode==='CURRENT'),after=matches.filter(m=>m.mode!=='CURRENT'),transitions={},deltas=[];
 for(const s of scenarios){let d=0;for(let seat=0;seat<2;seat++){const a=before.find(m=>m.matchUrlId===s.matchUrlId&&m.candidateSeat===seat),b=after.find(m=>m.matchUrlId===s.matchUrlId&&m.candidateSeat===seat);const k=a.analysisOutcome+'->'+b.analysisOutcome;transitions[k]=(transitions[k]||0)+1;d+=2*(score(b)-score(a));}deltas.push(d);}
 const attack=l=>({kills:l.filter(m=>m.counts.crashes[m.candidateSeat^1]&&!m.counts.crashes[m.candidateSeat]).length,deaths:l.filter(m=>m.counts.crashes[m.candidateSeat]&&!m.counts.crashes[m.candidateSeat^1]).length});
 const gain=100*(after.reduce((s,m)=>s+score(m),0)-before.reduce((s,m)=>s+score(m),0))/128,test=pairedTest(deltas),a=attack(before),b=attack(after);
 const overview={tree,before:summarize(before),after:summarize(after),attack:{before:a,after:b},gainPercentagePoints:gain,transitions,test,counters,checks:{errors:0,timeouts:0,restore:0},status:gain>=3&&test.twoSidedP<0.05&&b.kills>=a.kills&&b.deaths<=a.deaths?'EXTERNAL_VALIDATION_POSITIVE':'NOT_QUALIFIED',productionAdoption:false};
 assert.equal(productionTreeSha256(root),tree);fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));assert.ok(fs.readdirSync(output).reduce((n,f)=>n+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={pairedTest};
