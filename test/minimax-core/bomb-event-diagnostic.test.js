'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {geometricEscape,actionCode}=require('../../tools/agentank/diagnostics/bomb-event-diagnostic');
test('bomb escape geometry counts turning and blocking separately',()=>{
 const map=Array.from({length:5},(_,x)=>Array.from({length:5},(_,y)=>x===0||x===4||y===0||y===4?'x':'.'));
 const blast=[[2,2],[2,1],[2,3],[1,2],[3,2]];
 const free=geometricEscape(map,{x:2,y:2,direction:0},blast);assert.equal(free.moves,3);assert.equal(free.path.length,3);
 const blocked=geometricEscape(map,{x:2,y:2,direction:0},blast,[2,1]);assert.equal(blocked.moves,4);
 assert.equal(geometricEscape(map,{x:1,y:1,direction:0},blast).moves,0);
});
test('bomb geometry reports no static route without claiming tactical proof',()=>{
 const map=[['x','x','x'],['x','.','x'],['x','x','x']];
 const r=geometricEscape(map,{x:1,y:1,direction:0},[[1,1]]);assert.equal(r.moves,null);assert.equal(r.visited,4);
});
test('commanded turn is distinguished from simulator-normalized turn',()=>{
 assert.equal(actionCode({type:'turn',side:'left'}),2);assert.equal(actionCode({type:'turn',side:'right',stunReversed:true}),3);assert.equal(actionCode(null),0);assert.equal(actionCode({type:'unknown'}),-1);
});
