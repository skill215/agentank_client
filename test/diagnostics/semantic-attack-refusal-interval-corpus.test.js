"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { VALUE_RELATION, POINTWISE_RELATION } = require(
  "../../tools/agentank/diagnostics/semantic-attack-refusal-value-search");
const { localClassification, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-refusal-interval-corpus");

function variant(valueRelation, pointwiseRelation, complete = true) {
  return { complete, valueRelation, pointwiseRelation };
}

test("local certificate requires worst-value and pointwise dominance in all worlds", () => {
  const positive = variant(VALUE_RELATION.CANDIDATE_HIGHER,
    POINTWISE_RELATION.CANDIDATE_DOMINATES);
  assert.equal(localClassification([positive, positive, positive]),
    "LOCAL_ROBUST_CANDIDATE");
  assert.equal(localClassification([positive, positive,
    variant(VALUE_RELATION.CANDIDATE_HIGHER, POINTWISE_RELATION.MIXED)]),
    "LOCAL_TRADEOFF");
  assert.equal(localClassification([positive, { ...positive, complete: false }]),
    "INCOMPLETE");
});

test("local classification keeps rule disagreement separate from tradeoff", () => {
  assert.equal(localClassification([
    variant(VALUE_RELATION.CANDIDATE_HIGHER, POINTWISE_RELATION.MIXED),
    variant(VALUE_RELATION.CANDIDATE_LOWER,
      POINTWISE_RELATION.INCUMBENT_DOMINATES)
  ]), "RULE_WORLD_DISAGREEMENT");
});

test("summary reconciles exact roots, variants and invariants", () => {
  const output = summarize([{ exact: true, classification: "LOCAL_EQUAL",
    historicalLabel: "EQUAL", variants: [{ complete: true },
      { complete: false }], totalNodes: 9, maximumNodes: 7,
    rootRestoreFailureCount: 0, hotAllocationCount: 0 }]);
  assert.equal(output.rootCount, 1);
  assert.equal(output.exactRootCount, 1);
  assert.equal(output.completeVariantCount, 1);
  assert.equal(output.incompleteVariantCount, 1);
  assert.equal(output.totalNodes, 9);
  assert.equal(output.maximumNodes, 7);
});
