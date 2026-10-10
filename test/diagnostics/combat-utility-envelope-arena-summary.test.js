"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(gain, qualified) {
  return { implementation: "COMBAT_UTILITY", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { combatUtilityEnvelopeShadow: {
      riskPoints: [0, 25, 50, 65, 75, 100], evaluationCount: 1,
      offensiveGainCount: gain, currentRiskQualifiedCount: qualified,
      tradeoffCount: 1, offensiveGainByRisk: [0, 0, gain, gain, gain, gain],
      qualifiedByRisk: [0, 0, qualified, qualified, qualified, qualified] } } };
}

test("arena summary aggregates risk-conditioned combat utility vectors", () => {
  const output = summarize([match(1, 1), match(1, 0)], "COMBAT_UTILITY");
  const summary = output.combatUtilityEnvelopeShadow;
  assert.equal(summary.evaluationCount, 2);
  assert.equal(summary.offensiveGainCount, 2);
  assert.equal(summary.currentRiskQualifiedCount, 1);
  assert.equal(summary.tradeoffCount, 2);
  assert.deepEqual(summary.offensiveGainByRisk, [0, 0, 2, 2, 2, 2]);
  assert.deepEqual(summary.qualifiedByRisk, [0, 0, 1, 1, 1, 1]);
});

