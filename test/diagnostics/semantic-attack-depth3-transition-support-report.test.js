"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, FAST_STATUS } = require(
  "../../engine-v2/src/abi/fast-codes");
const { FAST_UNSUPPORTED_REASON, JOINT_RELOCATION_DETAIL } = require(
  "../../engine-v2/src/fast/kernel");
const { CAUSE, classifyBranch, summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-transition-support-report");

test("transition support report distinguishes physical gap from conservative Hard", () => {
  const relocation = { OUTER_FAST_COUNT: 1, HARD_INCOMPLETE_COUNT: 0,
    FIRST_FAST_STATUS: FAST_STATUS.UNSUPPORTED_RULE,
    FIRST_FAST_REASON: FAST_UNSUPPORTED_REASON.JOINT_TANK_RELOCATION,
    FIRST_FAST_DETAIL: JOINT_RELOCATION_DETAIL.OCCUPIED_AFTER_EARLIER_MOVE };
  const hard = { OUTER_FAST_COUNT: 0, HARD_INCOMPLETE_COUNT: 1,
    FIRST_HARD_VIABLE_CODE: 0, FIRST_HARD_HAZARD_COMPLETE: 1,
    FIRST_HARD_NARROW_PROOF_COMPLETE: 0, FIRST_HARD_SHIELD_ESCAPE: 0,
    FIRST_HARD_BOOST_ESCAPE: 0, FIRST_HARD_TELEPORT_ESCAPE: 0 };
  assert.equal(classifyBranch(relocation),
    CAUSE.JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE);
  assert.equal(classifyBranch(hard), CAUSE.HARD_NARROW_PROOF_INCOMPLETE);
  hard.FIRST_HARD_TELEPORT_ESCAPE = 1;
  assert.equal(classifyBranch(hard), CAUSE.UNCLASSIFIED);
});

test("transition support summary reconciles cause, side and ply", () => {
  const records = [{ failedSide: "baseline",
    cause: CAUSE.JOINT_RELOCATION_OCCUPIED_AFTER_EARLIER_MOVE,
    reasonMask: 224, outerFastCount: 1, hardInternalFastCount: 0,
    hardIncompleteCount: 0, outcomeRelation: "CANDIDATE_BETTER",
    paretoRelation: "MIXED", firstFast: { ply: 2,
      action0: ACTION.GO, action1: ACTION.GO,
      action0Name: "GO", action1Name: "GO" }, firstHard: null },
  { failedSide: "candidate", cause: CAUSE.HARD_NARROW_PROOF_INCOMPLETE,
    reasonMask: 448, outerFastCount: 0, hardInternalFastCount: 0,
    hardIncompleteCount: 1, outcomeRelation: "EQUAL",
    paretoRelation: "EQUAL", firstFast: null, firstHard: { ply: 2,
      action0: ACTION.GO, action1: ACTION.FIRE,
      action0Name: "GO", action1Name: "FIRE" } }];
  const value = summarize(records);
  assert.equal(value.incompleteRootCount, 2);
  assert.deepEqual(value.failedSide, { baseline: 1, candidate: 1 });
  assert.equal(value.ply[2], 2);
  assert.equal(value.actionPair["GO/GO"], 1);
  assert.equal(value.actionPair["GO/FIRE"], 1);
  assert.equal(value.outerFastFailureTotal, 1);
  assert.equal(value.hardIncompleteTotal, 1);
  assert.equal(value.unclassifiedCount, 0);
});
