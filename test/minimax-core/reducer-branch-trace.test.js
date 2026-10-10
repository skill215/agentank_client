'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {traceCell}=require('../../tools/agentank/diagnostics/reducer-branch-trace');
const {ARRAY}=require('../../engine-v2/src/state/fast-state');
test('branch tracing restores inherited and own hooks even when traversal throws',()=>{
 const inherited={transitionValue(){return 0;},pairedLeaf(){return 0;},terminalUtility(){return 0;},generate(){return 0;}};
 const kernel={applyFrame(){return 1;}},apply=kernel.applyFrame,search=Object.assign(Object.create(inherited),{diagnosticKernel:kernel});
 const arrays=[];arrays[ARRAY.SCALAR]=new Uint16Array(64);arrays[ARRAY.TANK_CELL]=new Uint16Array(2);arrays[ARRAY.TANK_CRASH]=new Uint8Array(2);
 const engine={adapter:{state:{arrays}}};
 assert.throws(()=>traceCell(search,engine,()=>{throw Error('INTERRUPT');}),/INTERRUPT/);
 for(const k of Object.keys(inherited))assert.equal(Object.hasOwn(search,k),false);
 assert.equal(kernel.applyFrame,apply);
 assert.deepEqual(traceCell(search,engine,()=>23),{value:23,events:[]});
});
