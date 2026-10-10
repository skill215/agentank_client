"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, aggregateRuntime } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-response-matrix-report");

function variant(name, support, probability) {
  return { name, complete: true, enemyCount: 2,
    pointwiseRelation: "TRADEOFF", normalizationMode: "IDENTITY",
    normalizationCollisionCount: 0,
    lanes: [{ name: "RAW", status: 5, boundKind: 5,
      candidateProbability: probability, supportClass: support,
      stageLower: 1, stageUpper: 2, gap: 1 },
    { name: "ROBUST", status: 5, boundKind: 5,
      candidateProbability: probability, supportClass: support,
      stageLower: 1, stageUpper: 2, gap: 1 }] };
}

test("BP136 report keeps historical outcomes separate from matrix support", () => {
  const variants = [variant("A", "MIXED", 5000),
    variant("B", "MIXED", 5000), variant("C", "MIXED", 5000)];
  const value = summarize([{ outcomeRelation: "CANDIDATE_BETTER", variants }]);
  assert.equal(value.rootCount, 1);
  assert.equal(value.crossWorldMismatchCount, 0);
  assert.equal(value.byOutcome.CANDIDATE_BETTER.lanes.RAW.support.MIXED, 1);
  assert.deepEqual(value.byOutcome.CANDIDATE_BETTER.lanes.RAW.probabilities,
    [5000]);
});

test("BP136 runtime aggregation audits completion and hot allocation", () => {
  const value = aggregateRuntime([{ candidateEngine: {
    semanticAttackPolicyIntervalShadow: { depthResponseMatrix: {
      attemptCount: 2, completeCount: 2, incompleteCount: 0,
      variantDisagreementCount: 0, hotAllocationCount: 0 } } } }]);
  assert.deepEqual(value, { attempts: 2, complete: 2, incomplete: 0,
    variantDisagreements: 0, hotAllocations: 0 });
});
