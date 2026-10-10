'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {selectCohort,quantile}=require('../../tools/agentank/diagnostics/restricted-terminal-cohort-poc');
test('cohort selection is outcome-blind, unique, order-independent and excludes targeted roots',()=>{const rows=Array.from({length:24},(_,i)=>({mode:'NAVIGATION_FAMILY',matchUrlId:'m'+i,scenarioFingerprint:'f'+i,analysisOutcome:'V1_WIN'}));const selected=selectCohort(rows,new Set(['m0']));assert.equal(selected.length,16);assert.ok(selected.every(r=>r.id!=='m0'));assert.deepEqual(selectCohort([...rows,...rows].reverse().map(r=>({...r,analysisOutcome:'V2_WIN'})),new Set(['m0'])),selected);});
test('diagnostic percentile uses bounded observed samples',()=>{assert.equal(quantile([],0.95),0);assert.equal(quantile([3,1,2],0.95),3);});
