'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {NativeBasePolicySearch:S}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {NativeBasePolicyActionOwner:O}=require('../../../engine-v2/src/base-policy-specialized/action-owner');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {effect}=require('./geometric-factorial');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function run(root,output){
 assert.ok(!fs.existsSync(output));const input=path.join(root,'artifacts/native-causal-audit/bp338-geometric-external-validation'),manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);
 const bytes=fs.readFileSync(path.join(input,'matches.ndjson.gz')),baseline=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse).filter(m=>m.mode==='CURRENT');assert.equal(baseline.length,128);
 const {scenarios}=loadRollingV1ScenariosForIds(manifest.targets.map(t=>t.id),root);for(let i=0;i<scenarios.length;i++)assert.equal(scenarios[i].fingerprint,manifest.targets[i].fingerprint);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:manifest.targets,input:path.relative(root,input),inputSha256:hash(bytes),games:128,baselineReused:128,mode:'ROUTE_SCORE_ONLY',searchEntry:'CURRENT_UNCHANGED',budget:'CURRENT_UNCHANGED',strategyFlags:'UNCHANGED',diagnosticNotHoldout:true,acceptance:{gainPercentagePoints:3,scenarioPairedP:0.05,killsNondecreasing:true,deathsNonincreasing:true},sourceHashes:[__filename,path.join(__dirname,'route-navigation-consumer.js'),path.join(__dirname,'pose-route-field.js')].map(f=>({path:path.relative(root,f),sha256:hash(fs.readFileSync(f))}))},null,2));
 const {module}=await loadSimulator(root),prepareRoot=E.prototype.prepareRoot,score=E.prototype.actionScore,search=S.prototype.prepare,source=O.prototype.source,work=new WeakMap(),all=[],matches=[],counters={roots:0,prepared:0,enabled:0,rowsChanged:0,rowsUnchanged:0,hardRejectedChanged:0,attackChanged:0};
 try{E.prototype.prepareRoot=function(bundle){let w=work.get(this);if(!w){w={consumer:new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length),prepared:false};work.set(this,w);all.push(w);}w.prepared=false;counters.roots++;return prepareRoot.call(this,bundle);};
 E.prototype.actionScore=function(row){const original=score.call(this,row),w=work.get(this);assert.ok(w);if(!w.prepared){w.consumer.prepare(this,this.ourCount);w.prepared=true;counters.prepared++;if(w.consumer.enabled)counters.enabled++;}const value=w.consumer.score(this,row,original);if(value!==original){counters.rowsChanged++;assert.equal(this.hardStatus[row],0);assert.ok(this.ourActions[row]>=1&&this.ourActions[row]<=3);}else counters.rowsUnchanged++;return value;};
 for(const scenario of scenarios)for(let seat=0;seat<2;seat++){const m=await play(module,scenario,seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);matches.push({...compact(m),mode:'ROUTE_SCORE_ONLY'});if(matches.length%16===0)console.error(`[bp346] ${matches.length}/128`);}
 }finally{E.prototype.prepareRoot=prepareRoot;E.prototype.actionScore=score;}
 assert.equal(S.prototype.prepare,search);assert.equal(O.prototype.source,source);assert.equal(productionTreeSha256(root),tree);assert.equal(hash(fs.readFileSync(path.join(input,'matches.ndjson.gz'))),hash(bytes));
 function summary(list){const terminal={},seats=[{wins:0,losses:0,draws:0},{wins:0,losses:0,draws:0}];for(const m of list){const k=m.terminalCategory+'/'+m.analysisOutcome;terminal[k]=(terminal[k]||0)+1;seats[m.candidateSeat][m.analysisOutcome==='V2_WIN'?'wins':m.analysisOutcome==='DRAW'?'draws':'losses']++;}const v=summarize(list);return {...v,exactScore:100*(v.wins+v.draws/2)/list.length,kills:list.filter(m=>m.counts.crashes[m.candidateSeat^1]&&!m.counts.crashes[m.candidateSeat]).length,deaths:list.filter(m=>m.counts.crashes[m.candidateSeat]&&!m.counts.crashes[m.candidateSeat^1]).length,terminal,seats};}
 const before=summary(baseline),after=summary(matches),comparison=effect(baseline,matches,manifest.targets),passed=comparison.gainPercentagePoints>=3&&comparison.test.twoSidedP<.05&&after.kills>=before.kills&&after.deaths<=before.deaths;
 const overview={tree,before,after,comparison,counters,cache:{builds:all.reduce((s,w)=>s+w.consumer.field.builds,0),hits:all.reduce((s,w)=>s+w.consumer.field.hits,0),maxBytes:Math.max(...all.map(w=>w.consumer.field.bytes+w.consumer.progress.byteLength+w.consumer.known.byteLength))},checks:{errors:0,timeouts:0,restore:0,searchEntryDrift:0},status:passed?'DEVELOPMENT_POSITIVE':'NOT_QUALIFIED',productionAdoption:false};
 fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));assert.ok(fs.readdirSync(output).reduce((s,f)=>s+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
