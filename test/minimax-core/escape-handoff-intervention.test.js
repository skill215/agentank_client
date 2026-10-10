'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {snapshot,eventSurvival}=require('../../tools/agentank/diagnostics/escape-handoff-intervention');
test('handoff snapshots detach arrays and omit mutable nested controllers',()=>{
 const a={status:1,rows:new Int16Array([2,4,8]),nested:{bad:true}};const s=snapshot(a,2);a.rows[0]=9;assert.deepEqual(s,{status:1,rows:[2,4]});
});
test('event survival requires complete endpoint and distinguishes actual crash',()=>{
 assert.equal(eventSurvival([{frame:108,after:{tanks:[{crashed:false}]},result:null}],108,0),true);
 assert.equal(eventSurvival([{frame:106,after:{tanks:[{crashed:true}]},result:{winner:1}}],108,0),false);
 assert.throws(()=>eventSurvival([{frame:106,after:{tanks:[{crashed:false}]},result:null}],108,0),/INCOMPLETE/);
});
