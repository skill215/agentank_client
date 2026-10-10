"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(action, strict) {
  return { implementation: "RESPONSE_SET", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { attackResponseSetShadow: {
      candidateRowCount: 1, columnEvaluationCount: 3,
      strictSupersetCount: strict, nodeCount: 8, maximumNodes: 5,
      candidateByAction: { [action]: 1 },
      strictSupersetByAction: strict ? { [action]: 1 } : {},
      coverageHistogram: [0, 1, 0] } } };
}

test("arena summary aggregates response-set masks and coverage histograms", () => {
  const output = summarize([match(1, 1), match(2, 0)], "RESPONSE_SET");
  const summary = output.attackResponseSetShadow;
  assert.equal(summary.candidateRowCount, 2);
  assert.equal(summary.columnEvaluationCount, 6);
  assert.equal(summary.strictSupersetCount, 1);
  assert.equal(summary.nodeCount, 16);
  assert.equal(summary.maximumNodes, 5);
  assert.deepEqual(summary.candidateByAction, { 1: 1, 2: 1 });
  assert.deepEqual(summary.strictSupersetByAction, { 1: 1 });
  assert.equal(summary.coverageHistogram[1], 2);
});
