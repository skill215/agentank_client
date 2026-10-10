"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sideImprovement, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-one-deviation-corpus");

function variant(incumbentValue, baselineIncumbentValue,
    candidateValue, baselineCandidateValue, complete = true) {
  return { complete, incumbentValue, baselineIncumbentValue,
    candidateValue, baselineCandidateValue };
}

test("one-deviation side improvement is monotone or fails explicitly", () => {
  const equal = [variant(5, 5, 6, 6), variant(5, 5, 6, 6)];
  assert.equal(sideImprovement(equal, "incumbent"), "EQUAL");
  assert.equal(sideImprovement([variant(6, 5, 6, 6), equal[1]],
    "incumbent"), "STRICT_IMPROVEMENT");
  assert.equal(sideImprovement([variant(4, 5, 6, 6), equal[1]],
    "incumbent"), "MONOTONICITY_FAILURE");
  assert.equal(sideImprovement([variant(5, 5, 6, 6, false)],
    "candidate"), "INCOMPLETE");
});

test("one-deviation summary reconciles policy gains and action witnesses", () => {
  const output = summarize([{ exact: true,
    classification: "LOCAL_EQUAL", baselineClassification: "LOCAL_EQUAL",
    incumbentImprovement: "STRICT_IMPROVEMENT",
    candidateImprovement: "EQUAL",
    totalNodes: 9, maximumNodes: 7, totalTtHits: 2,
    totalLowerBoundCutoffs: 1, totalDeviationStates: 4,
    totalDeviationCandidates: 8, totalDeviationSelections: 2,
    rootRestoreFailureCount: 0, hotAllocationCount: 0,
    variants: [{ complete: true, incumbentBudgetStops: 0,
      candidateBudgetStops: 0, incumbentTtCapacityStops: 0,
      candidateTtCapacityStops: 0, incumbentUnsupportedStops: 0,
      candidateUnsupportedStops: 0, incumbentFastIncomplete: 0,
      candidateFastIncomplete: 0, incumbentHardIncomplete: 0,
      candidateHardIncomplete: 0, incumbentDominanceCutoffs: 0,
      candidateDominanceCutoffs: 0 }], selectedActionCounts: { 3: 2 } }]);
  assert.equal(output.rootCount, 1);
  assert.equal(output.incumbentImprovements.STRICT_IMPROVEMENT, 1);
  assert.equal(output.selectedActionCounts[3], 2);
  assert.equal(output.monotonicityFailureCount, 0);
});
