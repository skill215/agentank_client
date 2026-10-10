"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { actionAt, compactResult, summarizeInterventions } = require(
  "../../tools/agentank/diagnostics/attack-pose-single-root-intervention");

test("single-root intervention reads the exact emitted action byte", () => {
  const stream = Buffer.from([1, 3, 4]).toString("base64");
  assert.equal(actionAt(stream, 1), 3);
  assert.equal(actionAt(stream, 3), -1);
});

test("single-root summary separates local causal direction from full trajectory", () => {
  const clean = { timeoutError: 0, avoidableHardReject: 0,
    riskDominatedSelection: 0, rootRestoreFailure: 0 };
  const records = [
    { actionMatched: true, localDelta: 2, fullDelta: 2,
      transition: "IMPROVEMENT", intervention: { invariants: clean } },
    { actionMatched: true, localDelta: 0, fullDelta: -1,
      transition: "REGRESSION", intervention: { invariants: clean } },
    { actionMatched: false, localDelta: -1, fullDelta: 1,
      transition: "IMPROVEMENT", intervention: { invariants: {
        ...clean, riskDominatedSelection: 1 } } }
  ];
  assert.deepEqual(summarizeInterventions(records), {
    records: 3, actionMatched: 2, localImprovement: 1, localRegression: 1,
    localNeutral: 1, reproducedFullDirection: 1, fullEffectRecovered: 1,
    hardInvariantFailures: 1,
    byOriginalTransition: {
      IMPROVEMENT: { records: 2, localImprovement: 1,
        localRegression: 1, localNeutral: 0 },
      REGRESSION: { records: 1, localImprovement: 0,
        localRegression: 0, localNeutral: 1 }
    }
  });
});

test("compact intervention result preserves only outcome and gate evidence", () => {
  const value = compactResult({ candidateSeat: 1, analysisOutcome: "V2_WIN",
    terminalCategory: "SINGLE_CRASH", frames: 7,
    counts: { stars: [1, 2], crashes: [1, 0], bullets: [3, 4] },
    projectileFunnel: { tankKills: [0, 1] },
    candidate: { timeoutCount: 0, errorCount: 0 },
    candidateEngine: { layerTotals: { riskDominatedSelections: 1 } } });
  assert.equal(value.candidateStars, 2);
  assert.equal(value.candidateFire, 4);
  assert.equal(value.candidateProjectileKills, 1);
  assert.equal(value.invariants.riskDominatedSelection, 1);
});
