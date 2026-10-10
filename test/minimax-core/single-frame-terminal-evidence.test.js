'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TerminalEvidenceFold:F}=require('../../tools/agentank/diagnostics/single-frame-terminal-evidence');
test('terminal evidence requires all uniquely covered responses and complete input',()=>{
 const f=new F().reset(2,true,true);f.add(0,'WIN');assert.equal(f.status(),'INCOMPLETE');f.add(1,'WIN');assert.equal(f.status(),'ALL_TERMINAL_WIN');assert.throws(()=>f.add(1,'WIN'),/DUPLICATE/);
 for(const [complete,hard]of [[false,true],[true,false]]){f.reset(1,complete,hard);f.add(0,'WIN');assert.equal(f.status(),'INCOMPLETE');}
 assert.equal(f.reset(0,true,true).status(),'INCOMPLETE');
});
test('loss/equal trade, shield survival, escape and interrupted branches cannot certify a win',()=>{
 for(const result of ['DRAW','LOSS','UNRESOLVED','INCOMPLETE']){const f=new F().reset(2,true,true);f.add(0,'WIN');f.add(1,result);assert.notEqual(f.status(),'ALL_TERMINAL_WIN');}
 const f=new F().reset(2,true,true);f.add(0,'WIN');assert.equal(f.status(),'INCOMPLETE');assert.throws(()=>f.add(2,'WIN'),/INDEX/);
});
