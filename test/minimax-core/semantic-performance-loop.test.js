'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../../tools/agentank/diagnostics/semantic-performance-design');
const {FastState,ARRAY}=require('../../engine-v2/src/state/fast-state');
const {TERRAIN}=require('../../engine-v2/src/abi/fast-codes');
const C=D.compile(process.cwd());
test('direct BFS preserves distances across geometry fallback, dimensions, obstacles and unreachable cells',()=>{
 for(const [w,h]of [[19,15],[7,9],[3,3]])for(const ready of [false,true])for(let seed=1;seed<=12;seed++){
  const s=new FastState(w,h);for(let i=0;i<s.cells;i++)s.arrays[ARRAY.TERRAIN][i]=(i*13+seed*7)%11<3?TERRAIN.WALL:(i+seed)%13===0?TERRAIN.DIRT:TERRAIN.OPEN;
  const a=new C.baseline(),b=new C['direct-bfs']();if(ready){a.beginRoot(s);b.beginRoot(s);}
  for(const star of [0,Math.floor(s.cells/2),s.cells-1]){a.buildStarField(s,star);b.buildStarField(s,star);assert.deepEqual(b.starDistance,a.starDistance);}
 }
});
test('bulk terrain copy preserves cache and inactive bytes through root and cache replacement',()=>{
 const a=new C.baseline(),b=new C['bulk-terrain']();for(const [w,h]of [[19,15],[7,9],[19,15]]){
  const s=new FastState(w,h);for(let change=0;change<5;change++){
   s.arrays[ARRAY.TERRAIN][change]=change%2?TERRAIN.WALL:TERRAIN.OPEN;a.beginRoot(s);b.beginRoot(s);
   a.prepareStarField(s,change);b.prepareStarField(s,change);for(const key of ['rootTerrain','starCacheTerrain','starCacheDistance'])assert.deepEqual(b[key],a[key]);
  }
 }
});
test('noisy small gains cannot qualify; locked confirmation needs all 30 rounds and strata',()=>{
 const rows=Array.from({length:30},(_,i)=>({ratios:{x:.9},env:i%2?'event':'original',origin:i%3?'synthetic':'historical'}));
 assert.equal(D.qualify(rows,'x').qualified,true);assert.equal(D.qualify(rows.slice(1),'x').qualified,false);
 rows[0].ratios.x=10;assert.equal(D.qualify(rows,'x').qualified,false);
});
test('negative performance families retire and final shortlist freezes at round 70',()=>{
 assert.deepEqual(D.choose(4,['a','b'],{a:{ratio:1,lo:.97},b:{ratio:.9,lo:.8}}).active,['b']);
 assert.deepEqual(D.choose(7,['a','b'],{a:{ratio:.96},b:{ratio:.93}}).active,['b']);
});
