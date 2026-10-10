"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reasonNames, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-support-report");

function record(overrides = {}) {
  return { d3Complete: false, failedBranch: "BASELINE", reasonMask: 208,
    abortReason: 1, truncatedCount: 1, interrupted: false,
    baselineNodes: 50, candidateNodes: 0, d2Relation: 1,
    outcomeRelation: "EQUAL", baselineIncompleteTransitions: 0,
    candidateIncompleteTransitions: 0, ...overrides };
}

test("support report separates width abort branch and work", () => {
  const summary = summarize([record(), record({ failedBranch: "CANDIDATE",
    baselineNodes: 120, candidateNodes: 40, truncatedCount: 2 }),
  record({ d3Complete: true, reasonMask: 0, abortReason: 0 })]);
  assert.equal(summary.rootCount, 3);
  assert.equal(summary.completeCount, 1);
  assert.equal(summary.incompleteCount, 2);
  assert.equal(summary.widthAbortCount, 2);
  assert.equal(summary.failedBranch.BASELINE, 1);
  assert.equal(summary.failedBranch.CANDIDATE, 1);
  assert.equal(summary.incompleteNodeTotal, 210);
  assert.equal(summary.interruptedCount, 0);
});

test("support reason mask retains independent dimensions", () => {
  assert.deepEqual(reasonNames(208), ["WIDTH", "TRAVERSAL",
    "REPRESENTATIVE_DEPTH"]);
});
