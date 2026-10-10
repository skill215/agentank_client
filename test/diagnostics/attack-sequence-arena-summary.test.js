"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(candidateByAction, certifiedByAction) {
  return { implementation: "SEQUENCE", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { attackSequenceGeneratorShadow: {
      candidateRowCount: 2, certifiedRowCount: 1,
      candidateByAction, certifiedByAction,
      closure: { evaluationCount: 2, certifiedCount: 1, nodeCount: 7,
        maximumNodes: 5, reasonBitCounts: [1, 2] } } } };
}

test("arena summary accepts object-shaped sequence action counters", () => {
  const output = summarize([match({ 1: 2 }, { 1: 1 }),
    match({ 2: 3 }, { 2: 1 })], "SEQUENCE");
  assert.deepEqual(output.attackSequenceGeneratorShadow.candidateByAction,
    { 1: 2, 2: 3 });
  assert.deepEqual(output.attackSequenceGeneratorShadow.certifiedByAction,
    { 1: 1, 2: 1 });
  assert.equal(output.attackSequenceGeneratorShadow.candidateRowCount, 4);
  assert.equal(output.attackSequenceGeneratorShadow.certifiedRowCount, 2);
  assert.equal(output.attackSequenceGeneratorShadow.closure.nodeCount, 14);
  assert.equal(output.attackSequenceGeneratorShadow.closure.maximumNodes, 5);
  assert.deepEqual(output.attackSequenceGeneratorShadow.closure.reasonBitCounts.slice(0, 2),
    [2, 4]);
});
