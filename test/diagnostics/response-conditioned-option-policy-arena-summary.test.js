"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CANDIDATE, engineOptions, summarize } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(tradeoff, worlds, response = null) {
  const relationByRisk = new Array(24).fill(0); relationByRisk[3 * 4 + 3] = tradeoff;
  return { implementation: "RESPONSE_POLICY", analysisOutcome: "DRAW",
    candidateSeat: 0,
    counts: { stars: [0, 0], crashes: [0, 0], bullets: [0, 0],
      bombs: [0, 0], skills: [0, 0] },
    candidate: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0,
      timeoutCount: 0, errorCount: 0 },
    control: { actionCounts: {}, totalRuntimeMicros: 0, p95RuntimeMicros: 0 },
    candidateEngine: { responseConditionedOptionPolicyShadow: {
      riskPoints: [0, 25, 50, 65, 75, 100], dimensionCount: 11,
      evaluationCount: 1, worldCount: worlds,
      currentRiskTradeoffCount: tradeoff, relationByRisk },
    riskConditionedResponsePolicyShadow: {
      riskPoints: [0, 25, 50, 65, 75, 100], dimensionCount: 11,
      rowEvaluationRequestCount: 1, evaluationCount: 1, worldCount: worlds,
      qualificationCheckCount: 1, qualificationCount: tradeoff,
      relationByRisk },
    strategicAttackOverStarProposal: response ? { response } : undefined } };
}

test("arena summary aggregates response-conditioned policy vectors", () => {
  const summary = summarize([match(1, 4), match(1, 6)], "RESPONSE_POLICY")
    .responseConditionedOptionPolicyShadow;
  assert.equal(summary.evaluationCount, 2);
  assert.equal(summary.worldCount, 10);
  assert.equal(summary.currentRiskTradeoffCount, 2);
  assert.equal(summary.relationByRisk[15], 2);
  assert.equal(summary.dimensionCount, 11);
});

test("arena summary keeps exact proposal qualification separate", () => {
  const summary = summarize([match(1, 4), match(0, 5)], "RESPONSE_POLICY")
    .riskConditionedResponsePolicyShadow;
  assert.equal(summary.rowEvaluationRequestCount, 2);
  assert.equal(summary.evaluationCount, 2);
  assert.equal(summary.qualificationCheckCount, 2);
  assert.equal(summary.qualificationCount, 1);
  assert.equal(summary.worldCount, 9);
});

test("arena summary preserves rollout failure reason dimensions", () => {
  const first = {
    physicalIncompleteRootCount: 1,
    possibleAbsenceIncompleteRootCount: 2,
    possiblePresenceIncompleteRootCount: 3,
    rolloutFailureByReason: [0, 4, 1],
    rolloutFailureByPhaseReason: [0, 2, 0, 1],
    rolloutFailureByOptionReason: [0, 3],
    rolloutFailureByStepReason: [0, 0, 2],
    rolloutFailureByEnemyActionReason: [0, 5],
    rolloutIncompleteRootByReason: [0, 1, 2],
    rolloutFailureByUnsupportedSite: [0, 3, 4],
    rolloutIncompleteRootByUnsupportedSite: [0, 1],
    rolloutFailureByAppliedActionPair: [0, 2, 0, 1]
  };
  const second = {
    physicalIncompleteRootCount: 4,
    possibleAbsenceIncompleteRootCount: 5,
    possiblePresenceIncompleteRootCount: 6,
    rolloutFailureByReason: [0, 6, 2],
    rolloutFailureByPhaseReason: [0, 4, 0, 3],
    rolloutFailureByOptionReason: [0, 7],
    rolloutFailureByStepReason: [0, 0, 8],
    rolloutFailureByEnemyActionReason: [0, 9],
    rolloutIncompleteRootByReason: [0, 10, 20],
    rolloutFailureByUnsupportedSite: [0, 5, 6],
    rolloutIncompleteRootByUnsupportedSite: [0, 7],
    rolloutFailureByAppliedActionPair: [0, 4, 0, 3]
  };
  const response = summarize([match(0, 0, first), match(0, 0, second)],
    "RESPONSE_POLICY").strategicAttackOverStarProposal.response;
  assert.equal(response.physicalIncompleteRootCount, 5);
  assert.equal(response.possibleAbsenceIncompleteRootCount, 7);
  assert.equal(response.possiblePresenceIncompleteRootCount, 9);
  assert.deepEqual(response.rolloutFailureByReason, [0, 10, 3]);
  assert.deepEqual(response.rolloutFailureByPhaseReason, [0, 6, 0, 4]);
  assert.deepEqual(response.rolloutFailureByOptionReason, [0, 10]);
  assert.deepEqual(response.rolloutFailureByStepReason, [0, 0, 10]);
  assert.deepEqual(response.rolloutFailureByEnemyActionReason, [0, 14]);
  assert.deepEqual(response.rolloutIncompleteRootByReason, [0, 11, 22]);
  assert.deepEqual(response.rolloutFailureByUnsupportedSite, [0, 8, 10]);
  assert.deepEqual(response.rolloutIncompleteRootByUnsupportedSite, [0, 8]);
  assert.deepEqual(response.rolloutFailureByAppliedActionPair, [0, 6, 0, 4]);
});

test("arena summary preserves finite move-variant envelope evidence", () => {
  const envelope = values => ({ enabled: true, variants: [1, 2, 3],
    attemptCount: values, completeCount: values, recoveredCount: values,
    relationAgreementCount: values - 1, relationDisagreementCount: 1,
    reducedDimensionCount: values * 10, commonSequenceReplayCount: values * 4,
    transitionCount: values * 20, rootRestoreFailureCount: 0,
    completeByVariant: [0, values, values, values],
    incompleteByVariant: [0, 0, 0, 0],
    statusByVariant: [0, values],
    relationByRisk: [0, 0, values, 0] });
  const first = { moveContestVariantEnvelope: envelope(2) };
  const second = { moveContestVariantEnvelope: envelope(3) };
  const result = summarize([match(0, 0, first), match(0, 0, second)],
    "RESPONSE_POLICY").strategicAttackOverStarProposal.response
    .moveContestVariantEnvelope;
  assert.equal(result.attemptCount, 5);
  assert.equal(result.completeCount, 5);
  assert.equal(result.recoveredCount, 5);
  assert.equal(result.relationAgreementCount, 3);
  assert.equal(result.relationDisagreementCount, 2);
  assert.deepEqual(result.completeByVariant, [0, 5, 5, 5]);
  assert.deepEqual(result.statusByVariant, [0, 5]);
  assert.deepEqual(result.relationByRisk.slice(0, 4), [0, 0, 5, 0]);
  assert.equal(result.rootRestoreFailureCount, 0);
});

test("arena summary aggregates durable-combat block vectors", () => {
  const base = match(0, 0);
  base.candidateEngine.strategicAttackOverStarProposal = {
    durableCombatBlockCensus: { dimensionOrder: [2, 3, 4, 7, 8, 9],
      signOrder: ["NEGATIVE", "ZERO", "POSITIVE"],
      physicalSignalBits: { ENDPOINT_REDUCTION: 4 }, relation: [0, 0, 2, 3],
      byScore: [1, 2, 2], positiveDimensionCount: [2, 3, 0, 0, 0, 0, 0],
      robustSignCount: [1, 2, 2], robustSignPattern: [0, 5],
      robustSum: [10, 20], physicalSignalMask: [0, 0, 0, 0, 5],
      starCostMask: [1, 2, 2, 0], noPositiveDimensionCount: 2,
      physicalSignalWithoutValueCount: 1 } };
  const result = summarize([base, structuredClone(base)], "RESPONSE_POLICY")
    .strategicAttackOverStarProposal.durableCombatBlockCensus;
  assert.deepEqual(result.relation, [0, 0, 4, 6]);
  assert.deepEqual(result.byScore, [2, 4, 4]);
  assert.deepEqual(result.robustSignPattern, [0, 10]);
  assert.equal(result.physicalSignalMask[4], 10);
  assert.equal(result.noPositiveDimensionCount, 4);
  assert.equal(result.physicalSignalWithoutValueCount, 2);
});

test("response-policy ACTIVE requires the exact qualification without changing other candidates", () => {
  const active = engineOptions(CANDIDATE.RISK_CONDITIONED_RESPONSE_POLICY_ACTIVE);
  assert.equal(active.diagnosticRiskConditionedCombatProposalActive, true);
  assert.equal(active.diagnosticRiskConditionedCombatResponsePolicy, true);
  assert.equal(active.diagnosticRiskConditionedCombatResponsePolicyRequired, true);
  const legacy = engineOptions(CANDIDATE.RISK_CONDITIONED_COMBAT_ACTIVE);
  assert.equal(legacy.diagnosticRiskConditionedCombatResponsePolicyRequired, false);
});

test("strategic possible-projectile response modes keep Shadow and Active ownership separate", () => {
  const shadow = engineOptions(
    CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_SHADOW);
  assert.equal(shadow.diagnosticStrategicAttackPossibleProjectileWorlds, true);
  assert.equal(shadow.diagnosticStrategicAttackOverStarProposalActive, false);
  const active = engineOptions(
    CANDIDATE.STRATEGIC_ATTACK_POSSIBLE_RESPONSE_ACTIVE);
  assert.equal(active.diagnosticStrategicAttackPossibleProjectileWorlds, true);
  assert.equal(active.diagnosticStrategicAttackOverStarProposalActive, true);
  const envelope = engineOptions(
    CANDIDATE.STRATEGIC_ATTACK_MOVE_VARIANT_ENVELOPE_SHADOW);
  assert.equal(envelope.diagnosticStrategicAttackPossibleProjectileWorlds, true);
  assert.equal(envelope.diagnosticStrategicAttackMoveContestVariantEnvelope, true);
  assert.equal(envelope.diagnosticStrategicAttackOverStarProposalActive, false);
});
