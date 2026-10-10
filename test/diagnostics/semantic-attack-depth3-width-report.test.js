"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LANE_NAMES, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-width-report");

function lane(index, complete, relation, nodes) {
  return { name: LANE_NAMES[index], complete, relation,
    relationName: ["INCOMPLETE", "CANDIDATE_HIGHER", "EQUAL",
      "CANDIDATE_LOWER"][relation], baselineNodes: nodes,
    candidateNodes: nodes, baselineReasonMask: complete ? 0 : 208,
    candidateReasonMask: 0 };
}

test("width report detects saturation independently from recovered roots", () => {
  const summary = summarize([{ outcomeRelation: "EQUAL", paretoRelation: "EQUAL",
    lanes: [lane(0, false, 0, 10), lane(1, true, 1, 20),
      lane(2, true, 1, 21), lane(3, true, 1, 21)] },
  { outcomeRelation: "INCUMBENT_BETTER", paretoRelation: "INCUMBENT_DOMINATES",
    lanes: [lane(0, true, 3, 15), lane(1, true, 3, 25),
      lane(2, true, 3, 26), lane(3, true, 3, 26)] }]);
  assert.equal(summary.transitions.widthTwoToThree.newlyCompleteCount, 1);
  assert.equal(summary.transitions.widthThreeToFour.sameStateCount, 2);
  assert.equal(summary.transitions.widthFourBudget.sameStateCount, 2);
  assert.equal(summary.widthThreeCost.additionalCompleteRoots, 1);
  assert.equal(summary.lanes[1].outcomeByRelation.CANDIDATE_LOWER
    .INCUMBENT_BETTER, 1);
});
