'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectCertifiedRow:select}=require('../../tools/agentank/diagnostics/restricted-terminal-active-poc');
function fixture(){return {engine:{ourCount:1,ourActions:[4],ourArguments:[0],hardStatus:[0],adapter:{bundle:{}},finalGate:{finalAllows:()=>true}},cert:{status:'SUPPORTED_LOCAL_CERTIFICATE',action:4,row:0,reasons:[]}};}
test('active POC requires supported certificate and still respects final physical gate',()=>{const {engine,cert}=fixture();assert.equal(select(engine,cert),0);engine.finalGate.finalAllows=()=>false;assert.equal(select(engine,cert),-1);});
test('active POC cannot bypass Hard, incomplete evidence or invalid candidate row',()=>{for(const change of [f=>{f.engine.hardStatus[0]=1;},f=>{f.cert.status='BLOCKED';},f=>{f.cert.reasons=['ENTRY'];},f=>{f.cert.row=1;},f=>{f.engine.ourActions[0]=1;}]){const f=fixture();change(f);assert.equal(select(f.engine,f.cert),-1);}});
