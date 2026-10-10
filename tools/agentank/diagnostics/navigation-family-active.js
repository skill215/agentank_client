'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {play,summarize,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {compact}=require('./reducer-repair-active');
const {effect}=require('./geometric-factorial');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function run(root,output){
 assert.ok(!fs.existsSync(output));const input=path.join(root,'artifacts/native-causal-audit/bp338-geometric-external-validation'),manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);
 const bytes=fs.readFileSync(path.join(input,'matches.ndjson.gz')),baseline=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse).filter(m=>m.mode==='CURRENT');
 const {scenarios}=loadRollingV1ScenariosForIds(manifest.targets.map(t=>t.id),root);for(let i=0;i<scenarios.length;i++)assert.equal(scenarios[i].fingerprint,manifest.targets[i].fingerprint);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets:manifest.targets,inputSha256:hash(bytes),games:128,baselineReused:128,mode:'NAVIGATION_FAMILY',diagnosticNotHoldout:true,contract:'only original navigation incumbent, strategic-navigation mode, strict route improvement, risk nonworsening; no score/strategy writes; original search and final gate follow',thresholds:{gain:3,p:.05,killsNondecreasing:true,deathsNonincreasing:true},sources:[__filename,path.join(__dirname,'navigation-family-selector.js'),path.join(__dirname,'route-navigation-consumer.js'),path.join(__dirname,'pose-route-field.js')].map(f=>({path:path.relative(root,f),sha256:hash(fs.readFileSync(f))}))},null,2));
 const {module}=await loadSimulator(root),select=E.prototype.selectIncumbent,work=new WeakMap(),all=[],matches=[],counters={roots:0,changed:0,resourceIncumbents:0,resourceChanged:0,actionPairs:{}};
 try{E.prototype.selectIncumbent=function(count){const incumbent=select.call(this,count);let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);all.push(c);}const selected=selectNavigationFamily(this,c,count,incumbent);counters.roots++;const originalAction=this.ourActions[incumbent];if(originalAction>=4)counters.resourceIncumbents++;if(selected!==incumbent){assert.ok(originalAction>=1&&originalAction<=3);assert.ok(this.ourActions[selected]>=1&&this.ourActions[selected]<=3);assert.equal(this.hardStatus[selected],0);const o=this.riskController.outcome;assert.ok(o.acceptable[selected]&&!o.dominated[selected]);counters.changed++;const k=originalAction+'->'+this.ourActions[selected];counters.actionPairs[k]=(counters.actionPairs[k]||0)+1;}return selected;};
 for(const s of scenarios)for(let seat=0;seat<2;seat++){const m=await play(module,s,seat,false);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);matches.push({...compact(m),mode:'NAVIGATION_FAMILY'});if(matches.length%16===0)console.error(`[bp348] ${matches.length}/128`);}
 }finally{E.prototype.selectIncumbent=select;}
 assert.equal(productionTreeSha256(root),tree);assert.equal(hash(fs.readFileSync(path.join(input,'matches.ndjson.gz'))),hash(bytes));
 const details=list=>{const s=summarize(list),terminal={};for(const m of list){const k=m.terminalCategory+'/'+m.analysisOutcome;terminal[k]=(terminal[k]||0)+1;}return {...s,exactScore:100*(s.wins+s.draws/2)/list.length,kills:list.filter(m=>m.counts.crashes[m.candidateSeat^1]&&!m.counts.crashes[m.candidateSeat]).length,deaths:list.filter(m=>m.counts.crashes[m.candidateSeat]&&!m.counts.crashes[m.candidateSeat^1]).length,terminal};};
 const before=details(baseline),after=details(matches),comparison=effect(baseline,matches,manifest.targets),pass=comparison.gainPercentagePoints>=3&&comparison.test.twoSidedP<.05&&after.kills>=before.kills&&after.deaths<=before.deaths;
 const overview={tree,before,after,comparison,counters,cache:{builds:all.reduce((n,c)=>n+c.field.builds,0),hits:all.reduce((n,c)=>n+c.field.hits,0)},checks:{error:0,timeout:0,restore:0},status:pass?'DEVELOPMENT_POSITIVE':'NOT_QUALIFIED',productionAdoption:false};fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(matches.map(JSON.stringify).join('\n')+'\n'));assert.ok(fs.readdirSync(output).reduce((s,f)=>s+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
