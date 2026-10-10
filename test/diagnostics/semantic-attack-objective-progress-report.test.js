"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-objective-progress-report");

function record(relation, overrides = {}) {
  return { objectiveRelation: relation, discoveryNoRegression: false,
    discoveryQualified: false, holdoutNoRegression: false,
    holdoutQualified: false, allChanceNoRegression: false,
    allChanceStrictNoRegression: false, allChanceQualified: false,
    chanceOutcomeImprovementCount: 1, chanceOutcomeRegressionCount: 2,
    chanceOutcomeEqualCount: 5, pairedRegressionCount: 3, ...overrides };
}

test("objective report keeps relation buckets and Chance evidence separate", () => {
  const summary = summarize([
    record("CANDIDATE_DOMINATES"),
    record("CANDIDATE_DOMINATES", { discoveryNoRegression: true,
      holdoutQualified: true, allChanceNoRegression: true,
      chanceOutcomeImprovementCount: 2, chanceOutcomeRegressionCount: 0 }),
    record("INCOMPARABLE", { chanceOutcomeImprovementCount: 0 })
  ]);
  assert.equal(summary.rootCount, 3);
  assert.equal(summary.candidateDominanceCount, 2);
  assert.equal(summary.byRelation.CANDIDATE_DOMINATES.discoveryNoRegressionCount, 1);
  assert.equal(summary.byRelation.CANDIDATE_DOMINATES.holdoutQualifiedCount, 1);
  assert.equal(summary.candidateDominanceRejectionBasis.allChanceNoRegressionCount, 1);
  assert.equal(summary.candidateDominanceRejectionBasis.allChanceQualifiedCount, 0);
  assert.equal(summary.rejectedOwner, true);
});
