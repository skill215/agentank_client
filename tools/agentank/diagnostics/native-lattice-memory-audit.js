'use strict';
const fs=require('node:fs'),path=require('node:path');
const {NativeBasePolicySearch}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
const {play,productionTreeSha256}=require('./native-base-policy-standalone-arena');
const {loadCohort}=require('./v2-native-initiative-arena');
const {loadSimulator}=require('../simulation/paired-arena');
function memory(root){const seen=new Set(),buffers=new Set();let views=0;function visit(v){
 if(!v||typeof v!=='object'||seen.has(v))return;seen.add(v);
 if(ArrayBuffer.isView(v)){views++;buffers.add(v.buffer);return;}
 for(const key of Object.keys(v))visit(v[key]);}visit(root);
 return {uniqueBufferBytes:[...buffers].reduce((s,b)=>s+b.byteLength,0),buffers:buffers.size,views};}
async function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const scenarios=loadCohort(root,path.join(root,'config/engine-v3/v3-repair-cohort.json'),'DISCOVERY').scenarios;
 const {module}=await loadSimulator(root),proto=NativeBasePolicySearch.prototype,prepare=proto.prepare;let result=null;
 try{proto.prepare=function(engine,count,eligibility){this.bindIsolatedHard(engine.adapter.bundle);
  if(!result){const h=this.diagnosticHazard,on=memory(engine),keys=['reverseLatticeGrid','reverseLatticeValid','reverseLatticeHashLo','reverseLatticeHashHi'],saved=keys.map(k=>h[k]);
   try{for(const k of keys)h[k]=null;const off=memory(engine);result={on,off,deltaBytes:on.uniqueBufferBytes-off.uniqueBufferBytes};}
   finally{keys.forEach((k,i)=>h[k]=saved[i]);}}
  return prepare.call(this,engine,count,eligibility);};
  for(const scenario of scenarios){await play(module,scenario,0,false);if(result)break;}
 }finally{proto.prepare=prepare;}
 if(!result)throw Error('SEARCH_NOT_REACHED');
 const report={productionTreeSha256:productionTreeSha256(root),...result,
  scope:'entire reachable NativeBasePolicyEngine typed-array buffers at first searched root, deduplicated by backing buffer; not JS heap or platform peak'};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={memory};
