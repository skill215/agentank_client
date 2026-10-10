"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { mergePolicies, goalClassification, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-one-deviation-event-corpus");

function entry(action) {
  return { semanticLo: 1, semanticHi: 2, depth: 3,
    deviationAvailable: 1, action, argument: 65535,
    consumesDeviation: 0 };
}

test("cross-world policy merge rejects conflicting action ownership", () => {
  assert.equal(mergePolicies([[entry(2)], [entry(2)], [entry(2)]]).compatible,
    true);
  const conflict = mergePolicies([[entry(2)], [entry(3)], [entry(2)]]);
  assert.equal(conflict.compatible, false);
  assert.equal(conflict.conflictCount, 1);
});

test("attack event classification requires common rule-world proof", () => {
  const proven = { supportComplete: true,
    incumbentStatus: PROOF_STATUS.UNKNOWN,
    candidateStatus: PROOF_STATUS.PROVEN };
  assert.equal(goalClassification([proven, proven, proven]),
    "CANDIDATE_ONLY");
  assert.equal(goalClassification([proven, proven,
    { ...proven, candidateStatus: PROOF_STATUS.UNKNOWN }]),
  "NEITHER_PROVEN");
  assert.equal(goalClassification([proven, proven,
    { ...proven, supportComplete: false }]), "INCOMPLETE");
});

test("attack event summary reconciles executable policy evidence", () => {
  const output = summarize([{ exact: true, totalNodes: 9, maximumNodes: 7,
    budgetStopCount: 0, ttCapacityStopCount: 0, supportLossCount: 0,
    rootRestoreFailureCount: 0, hotAllocationCount: 0,
    goals: [{ name: "SAFE_THREAT_FIRE", classification: "CANDIDATE_ONLY",
      candidateExecutable: true, incumbentExecutable: false }] }]);
  assert.equal(output.rootCount, 1);
  assert.equal(output.goalClassifications[
    "SAFE_THREAT_FIRE/CANDIDATE_ONLY"], 1);
  assert.equal(output.candidateExecutableByGoal.SAFE_THREAT_FIRE, 1);
});
