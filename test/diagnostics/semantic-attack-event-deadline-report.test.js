"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { relation, valueSignature, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-deadline-report");

test("BP138 report separates common, historical and nominal direction", () => {
  assert.equal(relation(4), "CANDIDATE_HIGHER");
  assert.equal(relation(0), "EQUAL");
  assert.equal(relation(-4), "CANDIDATE_LOWER");
  const record = { historicalColumns: [1], outcomeRelation: "CANDIDATE_BETTER",
    lanes: [{ name: "OUTCOME_FRONTIER", commonStatus: 2, commonRelation: 3,
      valueWorldAgreement: true,
      variants: [{ complete: true, historicalDelta: 0, nominalDelta: -2 }] }] };
  const output = summarize([record]);
  assert.equal(output.byOutcome.CANDIDATE_BETTER.lanes.OUTCOME_FRONTIER
    .common["3"], 1);
  assert.equal(output.byOutcome.CANDIDATE_BETTER.lanes.OUTCOME_FRONTIER
    .historical.EQUAL, 1);
  assert.equal(output.byOutcome.CANDIDATE_BETTER.lanes.OUTCOME_FRONTIER
    .nominal.CANDIDATE_LOWER, 1);
});

test("BP138 value agreement ignores node-count performance differences", () => {
  const left = { complete: true, relation: 2, baselineValue: 10,
    candidateValue: 10, baselineNodes: 20, candidateNodes: 30,
    baselineCells: [1, 2], candidateCells: [1, 2] };
  const right = { ...left, baselineNodes: 99, candidateNodes: 101 };
  assert.equal(valueSignature(left), valueSignature(right));
});
