'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectTargets}=require('../../tools/agentank/diagnostics/layer-admission-validation');
test('validation excludes complete scenarios and aliases, not just root frames',()=>{
 const m=(id,fp,seat=0)=>({matchUrlId:id,scenarioFingerprint:fp,candidateSeat:seat,candidateEngine:{rootFrames:[{frame:5,searchEvidenceCurrent:true},{frame:8,searchEvidenceCurrent:true}]}});
 const rows=[m('old','a'),m('alias','a',1),m('new','b'),m('new','b',1),m('second','c')];
 const targets=selectTargets(rows,new Set(['old']),2);
 assert.deepEqual(new Set(targets.map(r=>r.scenarioFingerprint)),new Set(['b','c']));
 assert.deepEqual(targets,selectTargets([...rows].reverse(),new Set(['old']),2));
 assert.throws(()=>selectTargets(rows,new Set(['old']),3),/INSUFFICIENT/);
});
