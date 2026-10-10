'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),Module=require('node:module'),assert=require('node:assert/strict');
const {play,productionTreeSha256,NativeBasePolicyDiagnosticBot}=require('./native-base-policy-standalone-arena');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {SEARCH_CAPACITY}=require('../../../engine-v2/src/generated/search-config');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
const {prefixMatches}=require('./native-base-policy-root-action-counterfactual');
const {compact}=require('./reducer-repair-active');
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const base=path.join(root,'artifacts/native-causal-audit'),prior=JSON.parse(fs.readFileSync(path.join(base,'bp317-reducer-active-verified/overview.json')));
 const tree=productionTreeSha256(root);assert.equal(tree,prior.productionTreeSha256);
 const targets=prior.firstChanges.filter(r=>['mat_I52zYeSqz1RCC3Vqs','mat_2oo7Bhd32HH4mziLA'].includes(r.id));assert.equal(targets.length,2);
 const filename=path.join(root,'engine-v2/src/base-policy-specialized/policy-search.js'),legacy=new Module(filename);
 legacy.filename=filename;legacy.paths=Module._nodeModulePaths(path.dirname(filename));
 legacy._compile(fs.readFileSync(path.join(base,'bp316-reducer-repair/baseline-policy-search.js'),'utf8'),filename);
 const proto=NativeBasePolicySearch.prototype,names=['prepare','transitionValue','worstReply','policyValue'],fixed=names.map(n=>proto[n]);
 const botProto=NativeBasePolicyDiagnosticBot.prototype,capture=botProto.captureRoot;
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),matches=[],roots=[],results=[];let targetFrame;
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,targets,protocol:'2 targets x 2 suffix policies x (natural + force old + force new)',games:12},null,2));
 botProto.captureRoot=function(context,action){if(context.game.frames!==targetFrame)return;
  capture.call(this,context,action);const r=this.rootFrames.at(-1),e=this.engine,s=e.basePolicy.policySearch;
  r.searchRows=Array.from({length:e.ourCount},(_,row)=>({action:e.ourActions[row],domain:s.rootDomainMask[row],
   value:s.rootScore[row],nominal:s.rootNominalScore[row],intentBonus:e.basePolicy.intent.bonus(row),
   responses:Array.from({length:e.enemyCount},(_,col)=>({action:e.enemyActions[col],domain:s.rootEnemyDomainMask[col],
    value:s.rootCellScore[row*SEARCH_CAPACITY.MAX_ENEMY_POLICIES+col]}))}));
 };
 try{for(const t of targets){targetFrame=t.frame;let common=null;
  for(const mode of ['OLD','FIXED']){
   for(let i=0;i<names.length;i++)proto[names[i]]=mode==='OLD'?legacy.exports.NativeBasePolicySearch.prototype[names[i]]:fixed[i];
   const scenario=scenarios.find(s=>s.matchUrlId===t.id),natural=await play(module,scenario,t.seat,true);
   if(!common)common=natural;
   assert.ok(prefixMatches(common,natural,t.frame,mode==='OLD'?t.before:t.after),'COMMON_PREFIX_DRIFT');
   const r=natural.candidateEngine.rootFrames.find(x=>x.frame===t.frame);assert.ok(r);roots.push({id:t.id,mode,root:r});
   for(const [label,action] of [['NATURAL',-1],['FORCE_OLD',t.before],['FORCE_NEW',t.after]]){
    const match=action<0?natural:await play(module,scenario,t.seat,true,null,true,true,'current',false,false,1,'off',t.frame,action);
    if(action>=0){assert.equal(match.candidateEngine.forceApplied,1);assert.ok(prefixMatches(natural,match,t.frame,action));}
    if(action===(mode==='OLD'?t.before:t.after))for(const side of ['candidate','control'])
     assert.equal(match[side].compactActionStream,natural[side].compactActionStream,'NOOP_INTERVENTION_DRIFT');
    assert.equal(match.candidate.errorCount,0);assert.equal(match.candidate.timeoutCount,0);assert.equal(match.candidateEngine.rootRestoreFailures,0);
    results.push({id:t.id,seat:t.seat,mode,label,action:action<0?(mode==='OLD'?t.before:t.after):action,
     outcome:match.analysisOutcome,category:match.terminalCategory,frames:match.frames,stars:match.counts.stars,crashes:match.counts.crashes});
    matches.push({...compact(match),intervention:{mode,label}});console.error(`[root-intervention] ${matches.length}/12`);
   }
  }
 }}finally{botProto.captureRoot=capture;for(let i=0;i<names.length;i++)proto[names[i]]=fixed[i];}
 assert.equal(productionTreeSha256(root),tree);
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify({tree,results,checks:{commonPrefixes:true,noOpInterventions:true,errors:0,timeouts:0,restoreFailures:0}},null,2));
 for(const [name,data] of [['matches',matches],['diagnostic-samples',roots]])fs.writeFileSync(path.join(output,name+'.ndjson.gz'),zlib.gzipSync(data.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(results,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
