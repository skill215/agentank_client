'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {ARRAY}=require('../../../engine-v2/src/state/fast-state');
const {PoseRouteField}=require('./pose-route-field');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
function run(root,output){
 assert.ok(!fs.existsSync(output));const state={width:20,height:20,cells:400,arrays:[]},terrain=new Uint8Array(400);state.arrays[ARRAY.TERRAIN]=terrain;
 for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(x===0||y===0||x===19||y===19||(x%4===0&&y>2&&y<17))terrain[y*20+x]=1;
 const field=new PoseRouteField(400),target=378,goals=[{cell:21,direction:1},{cell:22,direction:1},{cell:21,direction:0},{cell:21,direction:2}],prepare=mode=>{if(mode==='REBUILD')field.reset();field.prepare(state,target);let sum=0;for(let i=0;i<goals.length;i++)sum+=field.value(goals[i].cell,goals[i].direction);return sum;};
 for(let n=0;n<500;n++){prepare('REBUILD');prepare('CACHE_HIT');}
 const expected=prepare('CACHE_HIT'),batches=[];
 for(let batch=0;batch<5;batch++)for(const mode of batch%2?['CACHE_HIT','REBUILD']:['REBUILD','CACHE_HIT']){const times=[],builds=field.builds,hits=field.hits;for(let i=0;i<500;i++){const start=performance.now(),sum=prepare(mode),elapsed=performance.now()-start;assert.equal(sum,expected);times.push(elapsed*1000);}times.sort((a,b)=>a-b);batches.push({batch,mode,samples:times.length,totalMicros:times.reduce((a,b)=>a+b,0),p95Micros:times[Math.ceil(times.length*.95)-1],builds:field.builds-builds,hits:field.hits-hits});}
 fs.mkdirSync(output,{recursive:true});const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({node:process.version,tree:productionTreeSha256(root),shape:[20,20],target,warmupsPerMode:500,batches:5,samplesPerBatch:500,files:[__filename,path.join(__dirname,'pose-route-field.js')].map(f=>({path:path.relative(root,f),sha256:sha(f)}))},null,2));
 const overview={typedArrayBytes:field.bytes,maxPoseCount:1600,checksum:expected,batches,scope:'synthetic function cost only; cache hit includes exact terrain comparison and four pose reads; no arena or callback performance qualification',allocations:'TypedArray allocation only in constructor; hot methods contain no object/array construction; no GC allocation profiler claim'};fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify(overview,null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]);
