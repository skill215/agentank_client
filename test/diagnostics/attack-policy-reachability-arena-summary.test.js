"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(action, proof, nodes) {
  return { implementation: "POLICY", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { attackPolicyReachabilityShadow: {
      candidateRowCount: 1, provenRowCount: proof, nodeCount: nodes,
      maximumNodes: nodes, ttHits: 2, rootRestoreFailures: 0,
      candidateByAction: { [action]: 1 }, provenByAction: proof ? { [action]: 1 } : {},
      statusByDepth: [0, 0, proof, 1 - proof, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      goalLeafCounts: [proof, 0, 0] } } };
}

test("arena summary aggregates adaptive policy evidence without replay payloads", () => {
  const output = summarize([match(1, 1, 9), match(2, 0, 5)], "POLICY");
  const summary = output.attackPolicyReachabilityShadow;
  assert.equal(summary.candidateRowCount, 2);
  assert.equal(summary.provenRowCount, 1);
  assert.equal(summary.nodeCount, 14);
  assert.equal(summary.maximumNodes, 9);
  assert.equal(summary.ttHits, 4);
  assert.deepEqual(summary.candidateByAction, { 1: 1, 2: 1 });
  assert.deepEqual(summary.provenByAction, { 1: 1 });
  assert.equal(summary.goalLeafCounts[0], 1);
});
