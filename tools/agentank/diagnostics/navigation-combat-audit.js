'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NativeBasePolicyEngine:E}=require('../../../engine-v2/src/runtime/native-base-policy-engine');
const {RouteNavigationConsumer}=require('./route-navigation-consumer');
const {selectNavigationFamily}=require('./navigation-family-selector');
const {firstDifference}=require('./admission-navigation-audit');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadRollingV1ScenariosForIds}=require('../simulation/historical-scenarios');
const {loadSimulator}=require('../simulation/paired-arena');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function summarizeRoots(roots){
 const out={roots:roots.length,firstGeometricContact:null,firstFire:null,firstStun:null,contactRoots:0,fireEligibleRoots:0,fireEligibleNotTaken:0,contactFireEligibleNotTaken:0,fireEmitted:0,fireWithModelRisk:0,stunEmitted:0,stunOutsideGeometricContact:0,turnsAtContact:0,searchProposalRoots:0};
 for(const r of roots){const contact=r.ownEnemyDistance<=9||Boolean(r.clearLineToEnemy),action=r.emittedAction;
  if(contact){out.contactRoots++;if(out.firstGeometricContact===null)out.firstGeometricContact=r.frame;}
  const fire=r.candidates.find(c=>c.action===4&&c.hard===0&&c.acceptable&&!c.dominated);
  if(fire){out.fireEligibleRoots++;if(action!==4){out.fireEligibleNotTaken++;if(contact)out.contactFireEligibleNotTaken++;}}
  if(action===4){out.fireEmitted++;if(out.firstFire===null)out.firstFire=r.frame;const c=r.candidates.find(c=>c.row===r.selected);if(c&&(c.immediate>0||c.horizon>0||c.unknown>0))out.fireWithModelRisk++;}
  if(action===8){out.stunEmitted++;if(out.firstStun===null)out.firstStun=r.frame;if(!contact)out.stunOutsideGeometricContact++;}
  if(contact&&(action===2||action===3))out.turnsAtContact++;
  if(r.proposal>=0)out.searchProposalRoots++;
 }
 return out;
}
function addMetrics(to,from){for(const [k,v]of Object.entries(from))if(!k.startsWith('first'))to[k]=(to[k]||0)+v;}
async function run(root,output){
 assert.ok(!fs.existsSync(output));const input=path.join(root,'artifacts/native-causal-audit/bp349-navigation-family-external'),manifestBytes=fs.readFileSync(path.join(input,'manifest.json')),manifest=JSON.parse(manifestBytes),bytes=fs.readFileSync(path.join(input,'matches.ndjson.gz')),tree=productionTreeSha256(root);assert.equal(tree,manifest.tree);
 for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const rows=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse),key=m=>m.matchUrlId+':'+m.candidateSeat,current=new Map(rows.filter(m=>m.mode==='CURRENT').map(m=>[key(m),m]));
 const targets=rows.filter(m=>m.mode==='NAVIGATION_FAMILY').map(b=>({a:current.get(key(b)),b})).filter(({a,b})=>a.analysisOutcome!==b.analysisOutcome&&a.analysisOutcome!=='DRAW'&&b.analysisOutcome!=='DRAW');assert.equal(targets.length,125);
 const sampled=new Set();for(const outcome of ['V1_WIN','V2_WIN'])for(const t of targets.filter(t=>t.b.analysisOutcome===outcome).sort((a,b)=>hash('bp350-root-sample'+key(a.b)).localeCompare(hash('bp350-root-sample'+key(b.b)))).slice(0,16))sampled.add(key(t.b));
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,inputSha256:hash(bytes),inputManifestSha256:hash(manifestBytes),runnerSha256:hash(fs.readFileSync(__filename)),candidateSources:manifest.candidateSources,reconstructions:250,targets:targets.map(t=>({id:t.b.matchUrlId,seat:t.b.candidateSeat,from:t.a.analysisOutcome,to:t.b.analysisOutcome,sample:sampled.has(key(t.b))})),scope:'Frozen BP349 trajectory reconstruction; no new intervention; all 125 decisive outcome flips, 32 first-divergence root samples'},null,2));
 const {scenarios}=loadRollingV1ScenariosForIds([...new Set(targets.map(t=>t.b.matchUrlId))],root),byId=new Map(scenarios.map(s=>[s.matchUrlId,s])),{module}=await loadSimulator(root),select=E.prototype.selectIncumbent,work=new WeakMap(),records=[],samples=[],groups={};let active=false;
 try{E.prototype.selectIncumbent=function(count){const incumbent=select.call(this,count);if(!active)return incumbent;let c=work.get(this);if(!c){c=new RouteNavigationConsumer(this.adapter.state.cells,this.ourActions.length);work.set(this,c);}return selectNavigationFamily(this,c,count,incumbent);};
 for(const t of targets){const scenario=byId.get(t.b.matchUrlId);assert.equal(scenario.fingerprint,t.a.scenarioFingerprint);assert.equal(scenario.fingerprint,t.b.scenarioFingerprint);const index=firstDifference(t.a.candidate.compactActionStream,t.b.candidate.compactActionStream);assert.ok(index>=0);
  const record={id:t.b.matchUrlId,seat:t.b.candidateSeat,from:t.a.analysisOutcome,to:t.b.analysisOutcome,index,arms:{}},firsts={};
  for(active of [false,true]){const old=active?t.b:t.a,m=await play(module,scenario,t.b.candidateSeat,true),name=active?'candidate':'current';
   for(const side of ['candidate','control']){assert.equal(m[side].compactActionStream,old[side].compactActionStream,'ACTION_DRIFT');assert.deepEqual(m[side].compactArguments,old[side].compactArguments,'ARGUMENT_DRIFT');}
   assert.equal(m.analysisOutcome,old.analysisOutcome);assert.equal(m.terminalCategory,old.terminalCategory);assert.equal(m.frames,old.frames);assert.deepEqual(m.counts,old.counts);assert.equal(m.candidate.errorCount,0);assert.equal(m.candidate.timeoutCount,0);assert.equal(m.candidateEngine.rootRestoreFailures,0);
   const roots=m.candidateEngine.rootFrames;assert.equal(roots.length,m.candidate.decisionCount);firsts[name]=roots[index];
   const last=roots.at(-1),chosen=last.candidates.find(c=>c.row===last.selected);
   record.arms[name]={metrics:summarizeRoots(roots),terminal:m.terminalCategory,crashCause:m.counts.v2CrashCause,frames:m.frames,last:{frame:last.frame,action:last.emittedAction,hardAllowed:last.candidates.filter(c=>c.hard===0).length,acceptable:last.candidates.filter(c=>c.hard===0&&c.acceptable&&!c.dominated).length,immediate:chosen?.immediate??null,committed:chosen?.committed??null,unknown:chosen?.unknown??null}};
  }
  const a=firsts.current,b=firsts.candidate;assert.ok(a&&b);for(const k of ['frame','ownCell','ownDirection','enemyCell','enemyDirection','starCell','ownStars','enemyStars'])assert.equal(a[k],b[k],'COMMON_ROOT_DRIFT');
  record.first={frame:a.frame,actions:a.emittedAction+'->'+b.emittedAction,owners:(a.proposal>=0?'SEARCH':'INCUMBENT_OR_FINAL')+'->'+(b.proposal>=0?'SEARCH':'INCUMBENT_OR_FINAL'),mode:a.controlMode,distance:a.ownEnemyDistance};
  const group=record.from+'->'+record.to,g=groups[group]??={count:0,current:{},candidate:{},firstFrames:{},firstActions:{},firstOwners:{},terminal:{},contactEarlier:0,contactLater:0,contactSame:0,contactMissing:0,firstFireEarlier:0,firstFireLater:0,firstFireSame:0,firstFireMissing:0,terminalNoAcceptable:0};g.count++;
  for(const n of ['current','candidate'])addMetrics(g[n],record.arms[n].metrics);
  for(const [field,value]of [['firstFrames',record.first.frame],['firstActions',record.first.actions],['firstOwners',record.first.owners],['terminal',record.arms.candidate.terminal]])g[field][value]=(g[field][value]||0)+1;
  for(const [metric,prefix]of [['firstGeometricContact','contact'],['firstFire','firstFire']]){const x=record.arms.current.metrics[metric],y=record.arms.candidate.metrics[metric];g[prefix+(x===null||y===null?'Missing':y<x?'Earlier':y>x?'Later':'Same')]++;}
  if(record.arms.candidate.last.acceptable===0)g.terminalNoAcceptable++;
  records.push(record);if(sampled.has(key(t.b)))samples.push({id:record.id,seat:record.seat,from:record.from,to:record.to,roots:firsts});if(records.length%8===0||records.length===targets.length)console.error(`[bp350] ${records.length}/${targets.length}`);
 }
 }finally{E.prototype.selectIncumbent=select;}
 assert.equal(productionTreeSha256(root),tree);for(const f of manifest.candidateSources)assert.equal(hash(fs.readFileSync(path.join(root,f.path))),f.sha256);
 const overview={tree,groups,checks:{reconstructions:250,actionDrift:0,eventCountDrift:0,outcomeDrift:0,rootRestore:0,errors:0,timeouts:0},notes:['Conditioned on decisive flips, not an overall treatment-effect estimate','Geometric contact uses model pose/distance/line, not simulator visibility ground truth','Eligible FIRE is not a verified profitable attack or a missed kill','Model risk is not a counter-kill oracle','No single-action counterfactual; first divergence is not sufficient terminal-loss causality'],productionAdoption:false};
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));fs.writeFileSync(path.join(output,'matches.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+'\n'));fs.writeFileSync(path.join(output,'diagnostic-samples.ndjson.gz'),zlib.gzipSync(samples.map(JSON.stringify).join('\n')+'\n'));assert.ok(fs.readdirSync(output).reduce((s,f)=>s+fs.statSync(path.join(output,f)).size,0)<2*1024*1024);console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={summarizeRoots};
