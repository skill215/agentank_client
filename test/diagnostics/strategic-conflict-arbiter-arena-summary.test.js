"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(proposals, age) {
  return { implementation: "CONFLICT", analysisOutcome: "DRAW", candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { strategicConflictArbiterShadow: {
      observationCount: 4, scoreConditionedAttackCount: proposals,
      maximumShadowTargetAge: age,
      decisionByScore: { TRAILING: { ATTACK_SCORE_CONDITIONED: proposals } },
      actualSelectionByScore: { TRAILING: { STAR_CONTROL: 4 } },
      proposalByScore: { TRAILING: proposals },
      starCostByScore: { TRAILING: proposals },
      deadlineAdvantageByScore: { TRAILING: proposals },
      durableCombatByScore: { TRAILING: proposals } } } };
}

test("arena summary aggregates target proposals and keeps maximum age", () => {
  const summary = summarize([match(2, 4), match(3, 9)], "CONFLICT")
    .strategicConflictArbiterShadow;
  assert.equal(summary.observationCount, 8);
  assert.equal(summary.scoreConditionedAttackCount, 5);
  assert.equal(summary.decisionByScore.TRAILING.ATTACK_SCORE_CONDITIONED, 5);
  assert.equal(summary.actualSelectionByScore.TRAILING.STAR_CONTROL, 8);
  assert.equal(summary.maximumShadowTargetAge, 9);
});

test("arena summary aggregates target execution without action ownership", () => {
  const values = [match(1, 2), match(2, 3)];
  values[0].candidateEngine.strategicTargetExecutionShadow = {
    observationCount: 4, attackTargetFrameCount: 2, proposalRootCount: 1,
    candidateRowCount: 2, targetGapCount: 1, differentPrimitiveCount: 1,
    fireProposalCount: 1, statusCounts: { TARGET_GAP: 1,
      DIFFERENT_PRIMITIVE: 1 }, proposalByAction: { FIRE: 1 } };
  values[1].candidateEngine.strategicTargetExecutionShadow = {
    observationCount: 5, attackTargetFrameCount: 3, proposalRootCount: 2,
    candidateRowCount: 4, targetGapCount: 1, samePrimitiveCount: 1,
    differentPrimitiveCount: 1, fireProposalCount: 1,
    statusCounts: { TARGET_GAP: 1, SAME_PRIMITIVE: 1,
      DIFFERENT_PRIMITIVE: 1 }, proposalByAction: { FIRE: 1, GO: 1 } };
  const summary = summarize(values, "CONFLICT").strategicTargetExecutionShadow;
  assert.equal(summary.observationCount, 9);
  assert.equal(summary.attackTargetFrameCount, 5);
  assert.equal(summary.proposalRootCount, 3);
  assert.equal(summary.targetGapCount, 2);
  assert.equal(summary.statusCounts.DIFFERENT_PRIMITIVE, 2);
  assert.equal(summary.proposalByAction.FIRE, 2);
});
