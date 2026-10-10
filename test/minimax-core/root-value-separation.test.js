'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {aggregate,choose,dominated}=require('../../tools/agentank/diagnostics/root-value-separation');
const {commitAlternative}=require('../../tools/agentank/diagnostics/root-value-separation');
test('ACTIVE alternative commits selected intent and leaves final gate to engine',()=>{
 let committed=-1;const owner={intent:{commitSelection:a=>{committed=a;}},result:{}};
 const engine={ourArguments:[65535,65535]};
 assert.equal(commitAlternative(owner,engine,1,{action:1,row:0}),null);assert.equal(committed,1);
 assert.deepEqual(commitAlternative(owner,engine,1,{action:4,row:1}),{action:4,argument:65535,row:1});assert.equal(committed,4);
});
test('root separation preserves weighted expectation and terminal magnitudes',()=>{
 assert.deepEqual(aggregate([100000,7062,25000,25000],[41600,4000,7000,1000]),{worst:7062,expected:Math.trunc((4160000000+28248000+200000000)/53600)});
 assert.throws(()=>aggregate([],[]));
});
test('worst-first makes explicit tradeoffs without calling an inferior-worst high-mean row dominated',()=>{
 const rows=[{action:1,worst:40,expected:500},{action:3,worst:-103,expected:9000}];
 assert.equal(choose(rows,()=>false).action,1);assert.equal(dominated(rows[1],rows),false);
 assert.equal(choose([{action:1,worst:40,expected:500},{action:3,worst:40,expected:9000}],()=>false).action,3);
});
test('primary intent preserves existing bonus without mutating rows or changing legacy mode',()=>{
 const rows=[{action:2,worst:0,expected:100,blend:50,backed:200},{action:1,worst:118,expected:200,blend:150,backed:150}];
 const before=JSON.stringify(rows);
 assert.equal(choose(rows,()=>false).action,1);
 assert.equal(choose(rows,()=>false,true).action,2);
 assert.equal(JSON.stringify(rows),before);
});
test('primary intent still resolves target roots toward GO and applies owner tie break',()=>{
 for(const rows of [
  [{action:1,worst:40,expected:4613,blend:1274,backed:1424},{action:3,worst:-103,expected:8809,blend:2303,backed:2303}],
  [{action:1,worst:15641,expected:23079,blend:18033,backed:18033},{action:4,worst:7062,expected:81870,blend:31120,backed:31270}]
 ])assert.equal(choose(rows,()=>false,true).action,1);
 const rows=[{action:1,worst:0,expected:0,blend:0,backed:150},{action:2,worst:150,expected:150,blend:150,backed:150}];
 assert.equal(choose(rows,(r,b)=>r.action>b.action,true).action,2);
});
