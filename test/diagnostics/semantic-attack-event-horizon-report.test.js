"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { sideCertified, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-horizon-report");

function variant(baselineStatus, candidateStatus,
    baselineSupport = true, candidateSupport = true) {
  return { name: "SEQUENTIAL_BLOCK", relation: 0,
    baselineStatus, candidateStatus, baselineSupport, candidateSupport,
    baselineNodes: 7, candidateNodes: 9 };
}

test("BP139 report requires every movement world for a certificate", () => {
  const goal = { variants: [
    variant(PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN),
    variant(PROOF_STATUS.PROVEN, PROOF_STATUS.PROVEN),
    variant(PROOF_STATUS.PROVEN, PROOF_STATUS.UNKNOWN) ] };
  assert.equal(sideCertified([goal], "baseline"), true);
  assert.equal(sideCertified([goal], "candidate"), false);
  goal.variants[2].candidateStatus = PROOF_STATUS.PROVEN;
  assert.equal(sideCertified([goal], "candidate"), true);
  goal.variants[1].candidateSupport = false;
  assert.equal(sideCertified([goal], "candidate"), false);
});

test("BP139 report separates support completeness from positive proof", () => {
  const records = [{ outcomeRelation: "CANDIDATE_BETTER", complete: true,
    baselineCertified: false, candidateCertified: false,
    goals: [{ variants: [
      variant(PROOF_STATUS.UNKNOWN, PROOF_STATUS.UNKNOWN) ] }] },
  { outcomeRelation: "INCUMBENT_BETTER", complete: false,
    baselineCertified: false, candidateCertified: false,
    goals: [{ variants: [
      variant(PROOF_STATUS.UNKNOWN, PROOF_STATUS.UNKNOWN, true, false) ] }] }];
  const output = summarize(records);
  assert.equal(output.rootCount, 2);
  assert.equal(output.completeRootCount, 1);
  assert.equal(output.incompleteRootCount, 1);
  assert.equal(output.neitherCertifiedRootCount, 2);
  assert.equal(output.supportCompleteSearchCount, 3);
  assert.equal(output.supportIncompleteSearchCount, 1);
  assert.equal(output.totalNodes, 32);
  assert.equal(output.maximumNodes, 9);
});
