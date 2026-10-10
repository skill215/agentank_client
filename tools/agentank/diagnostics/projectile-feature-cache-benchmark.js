"use strict";
const fs=require('node:fs');
const {FastState,ARRAY}=require('../../../engine-v2/src/state/fast-state');
const {NativeBasePolicyLeafEvaluator}=require('../../../engine-v2/src/base-policy-specialized/policy-leaf');
const {ProjectileFeatureCache}=require('./projectile-feature-cache');
function measure(active,cached){const s=new FastState(19,15),a=s.arrays;
  a[ARRAY.TANK_CELL].set([s.cell(2,7),s.cell(15,7)]);a[ARRAY.TANK_DIR].set([1,3]);
  a[ARRAY.PROJECTILE_ACTIVE][0]=active;a[ARRAY.PROJECTILE_OWNER][0]=0;
  a[ARRAY.PROJECTILE_CELL][0]=s.cell(4,7);a[ARRAY.PROJECTILE_DIR][0]=1;s.initializeHash();
  const leaf=new NativeBasePolicyLeafEvaluator();leaf.beginRoot(s);const cache=new ProjectileFeatureCache(s);
  const compute=leaf.projectileThreat;let sum=0;
  const loop=n=>{for(let i=0;i<n;i++)sum+=cached?cache.evaluate(s,0,compute,leaf):compute.call(leaf,s,0);};
  loop(3000);const batches=[];
  for(let b=0;b<5;b++){const t=process.hrtime.bigint();loop(20000);batches.push(Number(process.hrtime.bigint()-t));}
  return {batchesNs:batches,checksum:sum,bytes:cached?cache.bytes():0};}
const report={node:process.version,warning:'Best-case repeated-state microbenchmark; not full pipeline or platform time.',cases:[]};
for(const active of [0,1]){const off=measure(active,false),on=measure(active,true);
  if(off.checksum!==on.checksum)throw Error('CHECKSUM_MISMATCH');report.cases.push({active,off,on});}
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
