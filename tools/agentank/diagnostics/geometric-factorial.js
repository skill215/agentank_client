'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {NONE_FRAME}=require('../../../engine-v2/src/abi/fast-codes');
const {ThinLayerExecutor}=require('./thin-layer-executor');
const {skipSearch}=require('./geometric-contact-admission');
const {pairedTest}=require('./geometric-contact-validation');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const modes=['CURRENT','CURRENT_GEOMETRIC','LAYERED128','LAYERED128_GEOMETRIC'];
const score=m=>m.analysisOutcome==='V2_WIN'?1:m.analysisOutcome==='DRAW'?0.5:0;
function effect(a,b,targets){
 const key=m=>m.matchUrlId+':'+m.candidateSeat,aa=new Map(a.map(m=>[key(m),m])),bb=new Map(b.map(m=>[key(m),m]));
 assert.equal(aa.size,targets.length*2);assert.equal(bb.size,aa.size);const transitions={},deltas=[];
 for(const t of targets){let d=0;for(let seat=0;seat<2;seat++){const x=aa.get(t.id+':'+seat),y=bb.get(t.id+':'+seat);assert.ok(x&&y);const k=x.analysisOutcome+'->'+y.analysisOutcome;transitions[k]=(transitions[k]||0)+1;d+=2*(score(y)-score(x));}deltas.push(d);}
 return {gainPercentagePoints:100*deltas.reduce((a,b)=>a+b,0)/(targets.length*4),transitions,deltas,test:pairedTest(deltas)};
}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const input=path.join(root,'artifacts/native-causal-audit/bp338-geometric-external-validation'),manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);
 for(const s of manifest.sourceHashes)assert.equal(hash(fs.readFileSync(path.join(root,s.file))),s.sha256,'FROZEN_SOURCE_DRIFT');
 const bytes=fs.readFileSync(path.join(input,'matches.ndjson.gz')),old=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse);assert.equal(old.length,256);
 const {scenarios}=loadRollingV1ScenariosForIds(manifest.targets.map(t=>t.id),root);for(let i=0;i<scenarios.length;i++)assert.equal(scenarios[i].fingerprint,manifest.targets[i].fingerprint);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:manifest.targets,input:path.relative(root,input),inputSha256:hash(bytes),newModes:['CURRENT_GEOMETRIC','LAYERED128'],newGames:256,reusedGames:256,parameterChanges:false,diagnosticNotHoldout:true,sourceSha256:hash(fs.readFileSync(__filename))},null,2));
 const {module}=await loadSimulator(root),source=O.prototype.source,prepare=S.prototype.prepare,executors=new WeakMap(),matches=[],counters={};let mode;
 for(const m of ['CURRENT_GEOMETRIC','LAYERED128'])counters[m]={entries:0,skipped:0,searches:0,depths:[0,0,0,0]};
 try{O.prototype.source=function(engine,count){const c=counters[mode];c.entries++;if(mode==='CURRENT_GEOMETRIC'){const a=engine.adapter.state.arrays,until=a[ARRAY.TANK_STUN_UNTIL][1],frame=a[ARRAY.SCALAR][SCALAR.FRAME];if(skipSearch(engine.manhattan(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),engine.clearLine(a[ARRAY.TANK_CELL][0],a[ARRAY.TANK_CELL][1]),until!==NONE_FRAME&&until>frame)){c.skipped++;return null;}}return source.call(this,engine,count);};
 S.prototype.prepare=function(engine,count,eligibility){const c=counters[mode];c.searches++;if(mode==='CURRENT_GEOMETRIC')return prepare.call(this,engine,count,eligibility);this.bindIsolatedHard(engine.adapter.bundle);let e=executors.get(this);if(!e){e=new ThinLayerExecutor(this,this.diagnosticKernel,engine.adapter.state);executors.set(this,e);}const r=e.run(engine,count,eligibility,prepare,128,3);assert.ok(r.used<=128);c.depths[r.completedDepth]++;return r.completedDepth>0?1:0;};
 for(let i=0;i<scenarios.length;i++)for(let seat=0;seat<2;seat++)for(mode of i%2?['LAYERED128','CURRENT_GEOMETRIC']:['CURRENT_GEOMETRIC','LAYERED128']){const m=await play(module,scenarios[i],seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);matches.push({...compact(m),mode});if(matches.length%16===0)console.error(`[bp339] ${matches.length}/256`);}
 }finally{O.prototype.source=source;S.prototype.prepare=prepare;}
 const all=old.concat(matches),lists={},summary={};for(const m of modes){const l=lists[m]=all.filter(x=>x.mode===m);assert.equal(l.length,128);const terminal={};for(const x of l){const k=x.terminalCategory+'/'+x.analysisOutcome;terminal[k]=(terminal[k]||0)+1;}summary[m]={...summarize(l),exactScore:100*l.reduce((s,x)=>s+score(x),0)/l.length,kills:l.filter(x=>x.counts.crashes[x.candidateSeat^1]&&!x.counts.crashes[x.candidateSeat]).length,deaths:l.filter(x=>x.counts.crashes[x.candidateSeat]&&!x.counts.crashes[x.candidateSeat^1]).length,terminal};}
 const comparisons={};for(const [name,a,b] of [['admissionCurrent',0,1],['admissionLayered',2,3],['layeredOriginalAdmission',0,2],['layeredGeometricAdmission',1,3]])comparisons[name]=effect(lists[modes[a]],lists[modes[b]],manifest.targets);
 const interactionDeltas=comparisons.admissionLayered.deltas.map((d,i)=>d-comparisons.admissionCurrent.deltas[i]);
 const overview={tree,summary,comparisons,interaction:{percentagePoints:comparisons.admissionLayered.gainPercentagePoints-comparisons.admissionCurrent.gainPercentagePoints,test:pairedTest(interactionDeltas)},counters,checks:{errors:0,timeouts:0,restore:0},productionAdoption:false,notes:['Four-arm diagnostic, not an independent Holdout','No parameter changes; previous two arms reused exactly','Whole-game runtimes are not matched-input performance qualifications']};
 assert.equal(productionTreeSha256(root),tree);assert.equal(hash(fs.readFileSync(path.join(input,'matches.ndjson.gz'))),hash(bytes));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));assert.ok(fs.readdirSync(output).reduce((s,f)=>s+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify({scores:Object.fromEntries(modes.map(m=>[m,{score:summary[m].exactScore,w:summary[m].wins,l:summary[m].losses,d:summary[m].draws,kills:summary[m].kills,deaths:summary[m].deaths,fire:summary[m].actions.fire,stars:summary[m].starDifference}])),effects:Object.fromEntries(Object.entries(comparisons).map(([k,v])=>[k,{gain:v.gainPercentagePoints,p:v.test.twoSidedP}])),interaction:overview.interaction},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});module.exports={effect};
