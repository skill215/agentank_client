"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(qualified, tradeoff) {
  return { implementation: "POLICY_FRONTIER", analysisOutcome: "DRAW",
    candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { attackStarPolicyFrontierShadow: {
      evaluationCount: 1, staticQualifiedCount: 1,
      policyQualifiedCount: qualified, tradeoffCount: tradeoff,
      attackStarPathRegressionCount: tradeoff } } };
}

test("arena summary aggregates policy-frontier evidence", () => {
  const summary = summarize([match(1, 0), match(0, 1)], "POLICY_FRONTIER")
    .attackStarPolicyFrontierShadow;
  assert.equal(summary.evaluationCount, 2);
  assert.equal(summary.staticQualifiedCount, 2);
  assert.equal(summary.policyQualifiedCount, 1);
  assert.equal(summary.tradeoffCount, 1);
  assert.equal(summary.attackStarPathRegressionCount, 1);
});

