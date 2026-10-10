"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VARIANT_COMMON_STATUS } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-move-variant-shadow");
const { summarize, aggregateRuntime } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-move-variant-report");

function variant(name, relation, value) {
  return { name, complete: true, relation, baselineValue: value,
    candidateValue: value + 1, baselineNodes: 4, candidateNodes: 5,
    baselineReasonMask: 0, candidateReasonMask: 0 };
}

test("variant report preserves historical direction apart from scalar relation", () => {
  const records = [{ commonStatus: VARIANT_COMMON_STATUS.AGREEMENT,
    commonRelation: "CANDIDATE_HIGHER", outcomeRelation: "INCUMBENT_BETTER",
    paretoRelation: "INCUMBENT_DOMINATES", geometry: "SAME_TARGET",
    variants: [variant("SEQUENTIAL_BLOCK", 1, 10),
      variant("INTENT_BLOCK", 1, 10), variant("COLLISION_CRASH", 1, 10)] }];
  const value = summarize(records);
  assert.equal(value.commonRelation.CANDIDATE_HIGHER, 1);
  assert.equal(value.outcomeByRelation.CANDIDATE_HIGHER.INCUMBENT_BETTER, 1);
  assert.equal(value.variantValueDisagreementRoots, 0);
  records[0].variants[2].candidateValue += 1;
  assert.equal(summarize(records).variantValueDisagreementRoots, 1);
});

test("runtime aggregation reconciles contest execution and invariants", () => {
  const summary = { attemptCount: 1, completeAcrossVariantsCount: 1,
    agreementCount: 1, disagreementCount: 0, rootRestoreFailureCount: 0,
    hotAllocationCount: 0, variants: [{ name: "SEQUENTIAL_BLOCK",
      totalNodes: 9, variantTransitionCount: 2,
      contestKindCount: [0, 0, 1, 0, 1, 0], relationCount: {
        incomplete: 0, candidateHigher: 1, equal: 0, candidateLower: 0 } }] };
  const value = aggregateRuntime([{ candidateEngine: {
    semanticAttackPolicyIntervalShadow: { depthMoveVariant: summary } } }]);
  assert.equal(value.attempts, 1);
  assert.equal(value.variants.SEQUENTIAL_BLOCK.transitions, 2);
  assert.equal(value.variants.SEQUENTIAL_BLOCK.contestKindCount[4], 1);
  assert.equal(value.restoreFailures, 0);
});
