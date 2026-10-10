"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VALUE_RELATION, POINTWISE_RELATION } = require(
  "../../tools/agentank/diagnostics/semantic-attack-refusal-value-search");
const { policyComplete, selectRobustPolicy, compareSelectedPolicies,
  summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-refusal-policy-portfolio-corpus");

function cells(values) { return Int32Array.from(values); }

function policy(incumbentValues, candidateValues, complete = true) {
  return { variants: incumbentValues.map((incumbentValue, at) => ({
    name: "W" + at, complete, enemyCount: 2,
    incumbentValue, candidateValue: candidateValues[at],
    incumbentCells: cells([incumbentValue, incumbentValue]),
    candidateCells: cells([candidateValues[at], candidateValues[at]])
  })) };
}

test("robust policy selection maximizes the cross-world minimum", () => {
  const evaluations = [
    policy([9, 9, 9], [1, 1, 1]),
    policy([12, 8, 12], [2, 2, 2]),
    policy([10, 10, 10], [3, 3, 3])
  ];
  const selected = selectRobustPolicy(evaluations, "incumbent");
  assert.equal(selected.policyKind, 2);
  assert.equal(selected.robustValue, 10);
});

test("robust policy selection is stable and never selects incomplete policy", () => {
  const evaluations = [
    policy([7, 7, 7], [1, 1, 1]),
    policy([99, 99, 99], [2, 2, 2], false),
    policy([7, 7, 7], [3, 3, 3])
  ];
  assert.equal(policyComplete(evaluations[1]), false);
  assert.equal(selectRobustPolicy(evaluations, "incumbent").policyKind, 0);
});

test("portfolio certificate fails closed when any named policy is incomplete", () => {
  const evaluations = [
    policy([5, 5, 5], [6, 6, 6]),
    policy([5, 5, 5], [6, 6, 6]),
    policy([5, 5, 5], [6, 6, 6], false)
  ];
  const output = compareSelectedPolicies(evaluations,
    selectRobustPolicy(evaluations, "incumbent"),
    selectRobustPolicy(evaluations, "candidate"));
  assert.equal(output.portfolioComplete, false);
  assert.equal(output.supportComplete, false);
  assert.equal(output.classification, "INCOMPLETE");
});

test("portfolio candidate certificate requires all-world pointwise dominance", () => {
  const evaluations = [
    policy([5, 5, 5], [6, 6, 6]),
    policy([4, 4, 4], [5, 5, 5]),
    policy([3, 3, 3], [4, 4, 4])
  ];
  const output = compareSelectedPolicies(evaluations,
    selectRobustPolicy(evaluations, "incumbent"),
    selectRobustPolicy(evaluations, "candidate"));
  assert.equal(output.classification, "LOCAL_ROBUST_CANDIDATE");
  assert.equal(output.variants[0].valueRelation,
    VALUE_RELATION.CANDIDATE_HIGHER);
  assert.equal(output.variants[0].pointwiseRelation,
    POINTWISE_RELATION.CANDIDATE_DOMINATES);
});

test("portfolio summary reconciles selected policies and invariants", () => {
  const output = summarize([{ exact: true, portfolioComplete: true,
    classification: "LOCAL_EQUAL", historicalLabel: "EQUAL",
    incumbentSelection: { policyName: "DIRECT_PURSUIT" },
    candidateSelection: { policyName: "FLANKING_LINE" },
    policies: [{ policyName: "DIRECT_PURSUIT", policyDecisionCount: 9,
      directRayDecisionCount: 2, flankingDecisionCount: 0,
      counterEscapeDecisionCount: 0, fallbackDecisionCount: 7 }],
    variants: [{ complete: true }], totalNodes: 10, maximumNodes: 7,
    totalTtHits: 3, totalLowerBoundCutoffs: 2,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 }]);
  assert.equal(output.rootCount, 1);
  assert.equal(output.completePortfolioCount, 1);
  assert.equal(output.incumbentSelectedPolicies.DIRECT_PURSUIT, 1);
  assert.equal(output.candidateSelectedPolicies.FLANKING_LINE, 1);
  assert.equal(output.totalNodes, 10);
  assert.equal(output.policyActivity.DIRECT_PURSUIT.policyDecisionCount, 9);
});
