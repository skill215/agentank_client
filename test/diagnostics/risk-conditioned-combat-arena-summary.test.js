"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(proposals, overrides) {
  return { implementation: "RISK_COMBAT", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { riskConditionedCombatProposal: {
      checkCount: 10, staticCandidateCount: 2, deadlineCandidateCount: 1,
      proposalCount: proposals, overrideCount: overrides,
      rolloutTransitionCount: 8, rootRestoreFailureCount: 0 } } };
}

test("arena summary aggregates deadline-balanced proposal evidence", () => {
  const output = summarize([match(1, 1), match(0, 0)], "RISK_COMBAT");
  const summary = output.riskConditionedCombatProposal;
  assert.equal(summary.checkCount, 20);
  assert.equal(summary.staticCandidateCount, 4);
  assert.equal(summary.deadlineCandidateCount, 2);
  assert.equal(summary.proposalCount, 1);
  assert.equal(summary.overrideCount, 1);
  assert.equal(summary.rolloutTransitionCount, 16);
});

