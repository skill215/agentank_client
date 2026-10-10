'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ARRAY}=require('../../engine-v2/src/state/fast-state');
const {PoseRouteField,UNREACHABLE}=require('../../tools/agentank/diagnostics/pose-route-field');
function state(w,h,terrain){const s={width:w,height:h,cells:w*h,arrays:[]};s.arrays[ARRAY.TERRAIN]=Uint8Array.from(terrain);return s;}
// Independent forward BFS; test-only allocation is intentional.
function oracle(s,start,dir,goal){const open=c=>c>=0&&c<s.cells&&[0,3].includes(s.arrays[ARRAY.TERRAIN][c]);if(!open(start)||!open(goal))return UNREACHABLE;const q=[[start,dir,0]],seen=new Set([start*4+dir]);for(let i=0;i<q.length;i++){const [c,d,n]=q[i];if(c===goal)return n;const x=c%s.width,y=Math.floor(c/s.width),nx=x+[0,1,0,-1][d],ny=y+[-1,0,1,0][d],next=[[c,(d+1)%4],[c,(d+3)%4]];if(nx>=0&&ny>=0&&nx<s.width&&ny<s.height&&open(ny*s.width+nx))next.push([ny*s.width+nx,d]);for(const [cc,dd]of next){const p=cc*4+dd;if(!seen.has(p)){seen.add(p);q.push([cc,dd,n+1]);}}}return UNREACHABLE;}
test('pose field equals forward oracle for every 2x3 obstacle map, goal and pose',()=>{
 const field=new PoseRouteField(6);let comparisons=0;
 for(let mask=0;mask<64;mask++){const s=state(3,2,Array.from({length:6},(_,i)=>(mask>>i)&1));for(let goal=0;goal<6;goal++){field.prepare(s,goal);for(let c=0;c<6;c++)for(let d=0;d<4;d++){assert.equal(field.value(c,d),oracle(s,c,d,goal));comparisons++;}}}assert.equal(comparisons,9216);
});
test('detours and useful turns progress; complete rotation has zero net progress',()=>{
 const s=state(5,5,new Array(25).fill(1));for(const c of [6,7,8,11,13])s.arrays[ARRAY.TERRAIN][c]=0;const f=new PoseRouteField(25);f.prepare(s,13);
 assert.equal(f.progress(11,0,6,0),1);assert.equal(f.progress(11,1,11,0),1);assert.equal(f.progress(11,0,11,3),-1);assert.equal(f.progress(11,0,11,0),0);
 let sum=0;for(let d=0;d<4;d++)sum+=f.progress(11,d,11,(d+1)&3);assert.equal(sum,0);assert.equal(f.value(13,2),0);
});
test('cache validates topology content, goal, dimensions and reset with stable buffers',()=>{
 const f=new PoseRouteField(6),s=state(3,2,[0,0,0,0,0,0]),arrays=[f.distance,f.queue,f.terrain];f.prepare(s,2);f.prepare(s,2);assert.equal(f.builds,1);assert.equal(f.hits,1);
 s.arrays[ARRAY.TERRAIN][1]=2;f.prepare(s,2);assert.equal(f.builds,2);f.prepare(s,5);assert.equal(f.builds,3);f.prepare(state(2,3,[0,2,0,0,0,0]),5);assert.equal(f.builds,4);f.reset();f.prepare(s,5);assert.equal(f.builds,5);assert.deepEqual([f.distance,f.queue,f.terrain],arrays);
 assert.equal(f.progress(0,0,99,0),null);assert.equal(f.prepare(s,65535),false);assert.equal(f.value(0,0),UNREACHABLE);assert.throws(()=>f.prepare(state(7,1,new Array(7).fill(0)),0));
});
