'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../../tools/agentank/diagnostics/global-baseline-report');
function row(seat,outcome,terminal){return {matchUrlId:'s',candidateSeat:seat,analysisOutcome:outcome,terminalCategory:terminal,frames:128,counts:{v2CrashCause:'NONE'},candidate:{totalRuntimeMicros:3},control:{totalRuntimeMicros:2},audit:{reasons:{ENEMY_NOT_VISIBLE:1},lastReason:'ENEMY_NOT_VISIBLE'},result:{winnerImplementation:'v1'}};}
test('global results use runtime-independent outcomes and do not call a hidden star loss hidden death',()=>{const r=analyze([row(0,'DRAW','FRAME_LIMIT_EQUAL_STARS'),row(1,'V1_WIN','FRAME_LIMIT_STARS')]);assert.equal(r.byTerminal.FRAME_LIMIT_EQUAL_STARS.draw,1);assert.equal(r.pairs.V1_WIN_DRAW,1);assert.equal(r.singleCrashHiddenLoss,0);});
test('global report requires both distinct seats',()=>{assert.throws(()=>analyze([row(0,'DRAW','FRAME_LIMIT_EQUAL_STARS')]));assert.throws(()=>analyze([row(0,'DRAW','FRAME_LIMIT_EQUAL_STARS'),row(0,'DRAW','FRAME_LIMIT_EQUAL_STARS')]));});
