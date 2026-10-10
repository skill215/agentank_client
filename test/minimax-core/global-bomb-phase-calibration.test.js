'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {comparison,semanticProjection}=require('../../tools/agentank/diagnostics/global-bomb-phase-calibration');
function row(seat,outcome='DRAW',bombs=[0,0]){return {matchUrlId:'frozen',scenarioFingerprint:'fingerprint',candidateSeat:seat,
  analysisOutcome:outcome,terminalCategory:'FRAME_LIMIT_STARS',frames:128,result:{winnerSeat:0},
  counts:{stars:[1,1],crashes:[0,0],bombs,v2CrashCause:'NONE'},
  candidate:{errorCount:0,timeoutCount:0,actionCounts:{},totalRuntimeMicros:123},
  control:{errorCount:0,timeoutCount:0,actionCounts:{},totalRuntimeMicros:456},
  candidateEngine:{rootRestoreFailures:0,runtimeMicros:123},audit:{reasons:{},searchRoots:0,nodes:0,budgetLeaves:0}};}
test('environment report pairs by identity, ignores runtime, retains analytical outcomes',()=>{
  const before=[row(0),row(1)],after=structuredClone(before);
  after[0].candidateEngine.observationStatus=undefined;
  after[0].result.winnerSeat=1;after[0].candidate.totalRuntimeMicros=999;
  assert.deepEqual(semanticProjection(before[0]),semanticProjection(after[0]));
  const report=comparison(before,after.reverse());
  assert.equal(report.noBombControl.games,2);assert.equal(report.noBombControl.semanticDifferenceCount,0);
  assert.equal(report.transitions['DRAW->DRAW'],2);
  after[0].candidate.actionCounts.go=1;
  assert.equal(comparison(before,after).noBombControl.semanticDifferenceCount,1);
});
test('environment report detects changed outcomes, bomb groups and invalid denominators',()=>{
  const before=[row(0),row(1)],after=[row(0,'V2_WIN',[1,0]),row(1)];
  const report=comparison(before,after);
  assert.equal(report.changed.length,1);assert.equal(report.bombRelated.games,1);
  assert.equal(report.transitions['DRAW->V2_WIN'],1);assert.equal(report.noBombControl.games,1);
  assert.throws(()=>comparison(before,[after[0]]));
  assert.throws(()=>comparison(before,[after[0],after[0]]));
  after[0].scenarioFingerprint='drift';assert.throws(()=>comparison(before,after));
});
