"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, allZero } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth-stability-report");

function lane(name, complete, relation, baselineNodes, candidateNodes) {
  return { name, complete, relation,
    relationName: ["INCOMPLETE", "CANDIDATE_HIGHER", "EQUAL",
      "CANDIDATE_LOWER"][relation], baselineValue: 0, candidateValue: 0,
    baselineNodes, candidateNodes };
}

function record(sourcePolicyRelation, d1, d2, d2Wide, d3,
  outcomeRelation = "EQUAL", paretoRelation = "EQUAL") {
  return { sourcePolicyRelation, outcomeRelation, paretoRelation,
    lanes: [d1, d2, d2Wide, d3] };
}

test("depth report separates budget stability from horizon instability", () => {
  const summary = summarize([
    record("CANDIDATE_HIGHER",
      lane("D1_B2048", true, 2, 10, 10),
      lane("D2_B256", true, 1, 20, 20),
      lane("D2_B2048", true, 1, 21, 21),
      lane("D3_B2048", false, 0, 40, 0), "CANDIDATE_BETTER"),
    record("EQUAL",
      lane("D1_B2048", true, 2, 8, 8),
      lane("D2_B256", true, 2, 18, 18),
      lane("D2_B2048", true, 2, 18, 18),
      lane("D3_B2048", true, 3, 2048, 2048), "INCUMBENT_BETTER")
  ]);
  assert.equal(summary.rootCount, 2);
  assert.equal(summary.sourceRelationMismatchCount, 0);
  assert.equal(summary.transitions.depthTwoBudget.sameCount, 2);
  assert.equal(summary.transitions.depthTwoBudget.changedCount, 0);
  assert.equal(summary.transitions.depthOneToTwo.changedCount, 1);
  assert.equal(summary.transitions.depthTwoToThree.comparableCount, 1);
  assert.equal(summary.transitions.depthTwoToThree.changedCount, 1);
  assert.equal(summary.depthThreeIncomplete.count, 1);
  assert.equal(summary.depthThreeIncomplete.budgetHitCount, 0);
  assert.equal(summary.depthThreeComplete.budgetHitCount, 1);
  assert.equal(summary.lanes[1].outcomeByRelation.CANDIDATE_HIGHER
    .CANDIDATE_BETTER, 1);
});

test("depth report detects source mismatch and behavior deltas", () => {
  const summary = summarize([record("CANDIDATE_LOWER",
    lane("D1_B2048", true, 2, 1, 1),
    lane("D2_B256", true, 1, 1, 1),
    lane("D2_B2048", true, 1, 1, 1),
    lane("D3_B2048", false, 0, 1, 0))]);
  assert.equal(summary.sourceRelationMismatchCount, 1);
  assert.equal(allZero({ winDelta: 0, scoreDelta: 0, positive: false }), true);
  assert.equal(allZero({ winDelta: 1 }), false);
});
