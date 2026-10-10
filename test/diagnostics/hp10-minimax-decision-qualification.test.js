"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, compare, actionDivergence, invariantTotal, transitionBalance } =
  require("../../tools/agentank/diagnostics/hp10-minimax-decision-qualification");
const { v2DiagnosticOptions } = require("../../tools/agentank/simulation/paired-arena");

function match(id, winner, crashes = [0, 0]) {
  return { matchId: id, v2Seat: 0, seatImplementations: ["v2", "v1"],
    result: { winnerSeat: winner, winnerImplementation: winner === 0 ? "v2" :
      winner === 1 ? "v1" : "draw", reason: crashes[0] || crashes[1] ? "crash" : "frameLimit" },
    counts: { stars: winner === 0 ? [2, 1] : winner === 1 ? [1, 2] : [1, 1],
      crashes, bullets: [3, 2] },
    v2: { actionCounts: { FIRE: 2 }, totalRuntimeMicros: 100,
      timeoutCount: 0, errorCount: 0, layerTotals: { stageMatrixSolves: 4,
        completeValueOwners: 1, incompleteValueOwners: 2,
        incompleteValueEvidenceOnly: 0, avoidableHardRejects: 0,
        riskDominatedSelections: 0, depthRootRestoreFailures: 0 } } };
}

test("HP10 decision report reconciles runtime-independent outcomes and ownership counts", () => {
  const summary = summarize([match("a", 0, [0, 1]), match("b", null)], "candidate");
  assert.deepEqual([summary.v2Wins, summary.v1Wins, summary.draws], [1, 0, 1]);
  assert.equal(summary.scoreBasisPoints, 7500);
  assert.equal(summary.v2SingleCrashWins, 1);
  assert.equal(summary.incompleteValueOwners, 4);
  assert.equal(summary.fireActions, 4);
  assert.equal(invariantTotal(summary), 0);
});

test("HP10 decision comparison accounts every common match exactly once", () => {
  const before = [match("a", 1, [1, 0]), match("b", null)];
  const after = [match("a", 0, [0, 1]), match("b", null)];
  const result = compare(before, after);
  assert.equal(result.comparable, 2);
  assert.deepEqual(result.transitions, { V1_WIN_TO_V2_WIN: 1, DRAW_TO_DRAW: 1 });
});

test("HP10 action divergence records the first causal action and paired outcome", () => {
  const before = match("a", 1, [1, 0]); const after = match("a", 0, [0, 1]);
  before.v2.compactActionStream = Buffer.from([1, 4, 2]).toString("base64");
  after.v2.compactActionStream = Buffer.from([1, 2, 2]).toString("base64");
  const result = actionDivergence([before], [after]);
  assert.equal(result.divergentMatches, 1);
  assert.deepEqual(result.firstActionTransitions, { "4_TO_2": 1 });
  assert.deepEqual(result.outcomeByActionTransition,
    { "4_TO_2:V1_WIN_TO_V2_WIN": 1 });
});

test("compact action capture can exclude non-canonical sample TypedArrays", () => {
  const compactOnly = v2DiagnosticOptions({}, { captureCompact: true, captureSamples: false });
  assert.equal(compactOnly.captureCompactFrames, true);
  assert.equal(compactOnly.captureSampleFrames, false);
  const historical = v2DiagnosticOptions({}, { captureCompact: true });
  assert.equal(historical.captureSampleFrames, true);
});

test("HP10 holdout transition balance weights full win flips above draw moves", () => {
  const value = transitionBalance({ transitions: { V1_WIN_TO_V2_WIN: 3,
    V2_WIN_TO_V1_WIN: 1, V1_WIN_TO_DRAW: 2, DRAW_TO_V1_WIN: 1 } });
  assert.deepEqual(value, { positiveUnits: 8, negativeUnits: 3, netUnits: 5 });
});
