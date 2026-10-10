"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FAST_UNSUPPORTED_REASON } = require("../../engine-v2/src/fast/kernel");
const { PAIR_RELATION } = require(
  "../../tools/agentank/diagnostics/native-attack-pose-policy-search-poc");
const { WIDTH_LANE, TRANSITION_DETAIL_FIELD } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-width-shadow");
const { VARIANT_COMMON_STATUS, isJointMovementGap, commonStatus } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-move-variant-shadow");

function width(reason, complete = 0) {
  const lastComplete = new Uint8Array(4);
  lastComplete[WIDTH_LANE.W4_B4096] = complete;
  const baseline = new Uint16Array(TRANSITION_DETAIL_FIELD.COUNT);
  baseline[TRANSITION_DETAIL_FIELD.FIRST_FAST_REASON] = reason;
  return { lastComplete, lastBaselineTransitionDetail: baseline,
    lastCandidateTransitionDetail:
      new Uint16Array(TRANSITION_DETAIL_FIELD.COUNT) };
}

test("move variant envelope only opens for the classified fail-closed gap", () => {
  assert.equal(isJointMovementGap(width(
    FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION)), 1);
  assert.equal(isJointMovementGap(width(FAST_UNSUPPORTED_REASON.NONE)), 0);
  assert.equal(isJointMovementGap(width(
    FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION, 1)), 0);
});

test("common relation requires three complete agreeing rule worlds", () => {
  const complete = new Uint8Array([1, 1, 1]);
  const relation = new Uint8Array([PAIR_RELATION.CANDIDATE_HIGHER,
    PAIR_RELATION.CANDIDATE_HIGHER, PAIR_RELATION.CANDIDATE_HIGHER]);
  assert.equal(commonStatus(complete, relation),
    VARIANT_COMMON_STATUS.AGREEMENT);
  relation[2] = PAIR_RELATION.EQUAL;
  assert.equal(commonStatus(complete, relation),
    VARIANT_COMMON_STATUS.DISAGREEMENT);
  complete[1] = 0;
  assert.equal(commonStatus(complete, relation),
    VARIANT_COMMON_STATUS.INCOMPLETE);
});
