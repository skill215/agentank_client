'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bucket,analyze}=require('../../tools/agentank/diagnostics/certificate-residual-analysis');
function row(mode,seat,outcome){return {mode,matchUrlId:'a',candidateSeat:seat,frames:128,analysisOutcome:outcome,terminalCategory:'FRAME_LIMIT_STARS',counts:{stars:[0,1]},candidate:{actionCounts:{fire:2}},control:{actionCounts:{fire:4}},certificateAudit:{expanded:0,skipped:128,overrides:0,reasons:{}}};}
test('residual report reconciles paired seats and zero-trigger evidence',()=>{const r=analyze([row('OFF',0,'V1_WIN'),row('OFF',1,'V1_WIN'),row('ACTIVE',0,'V1_WIN'),row('ACTIVE',1,'V1_WIN')]);assert.equal(r.pairKinds.V1_SWEEP,1);assert.equal(r.losses.games,2);assert.equal(r.losses.expanded,0);assert.equal(r.losses.v2Fire,4);assert.equal(r.transitions['V1_WIN->V1_WIN'],2);});
test('empty bucket has finite rates; incomplete pair is rejected',()=>{assert.equal(bucket([]).v2FirePer100Frames,0);assert.throws(()=>analyze([row('OFF',0,'V1_WIN'),row('ACTIVE',0,'V1_WIN')]));});
