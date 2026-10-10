"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { relation, summarize, aggregateRuntime } = require(
  "../../tools/agentank/diagnostics/semantic-attack-response-conditioned-report");

function variant(name) {
  return { name, complete: true, fullBaseline: [0], fullCandidate: [3],
    noAttackBaseline: [0], noAttackCandidate: [0], fullExpectedDelta: 3,
    noAttackExpectedDelta: 0, attackExpectedContribution: 3 };
}

test("BP137 report keeps ATTACK contribution separate from historical outcome", () => {
  assert.equal(relation(1), "CANDIDATE_HIGHER");
  assert.equal(relation(0), "EQUAL");
  assert.equal(relation(-1), "CANDIDATE_LOWER");
  const value = summarize([{ outcomeRelation: "INCUMBENT_BETTER",
    historicalColumns: [0], nominalSpread: 1,
    verifiedStructuralProgress: false, historicalNominalMass: 10000,
    historicalFullDelta: 3, historicalNoAttackDelta: 0,
    historicalAttackContribution: 3,
    variants: [variant("A"), variant("B"), variant("C")] }]);
  assert.equal(value.uniqueHistoricalColumnCount, 1);
  assert.equal(value.crossWorldMismatchCount, 0);
  assert.equal(value.byOutcome.INCUMBENT_BETTER.historicalAttack
    .CANDIDATE_HIGHER, 1);
});

test("BP137 runtime aggregation is independent from historical labels", () => {
  const value = aggregateRuntime([{ candidateEngine: {
    semanticAttackPolicyIntervalShadow: { responseConditioned: {
      attemptCount: 2, completeCount: 2, incompleteCount: 0,
      verifiedStructuralProgressCount: 1, hotAllocationCount: 0 } } } }]);
  assert.deepEqual(value, { attempts: 2, complete: 2, incomplete: 0,
    verifiedStructuralProgress: 1, hotAllocations: 0 });
});
