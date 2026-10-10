"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { EVIDENCE_AUTHORITY, JOINT_GEOMETRY, classifyJointGeometry,
  createRuleMatrix } = require(
  "../../tools/agentank/diagnostics/joint-movement-rule-oracle");
const { summarize } = require(
  "../../tools/agentank/diagnostics/semantic-attack-joint-movement-oracle-report");

function detail(target0, target1, overrides = {}) {
  return { FIRST_FAST_START_CELL0: 10, FIRST_FAST_START_CELL1: 11,
    FIRST_FAST_PREPARED_TARGET0: target0,
    FIRST_FAST_PREPARED_TARGET1: target1,
    FIRST_FAST_EFFECT_MASK0: 0, FIRST_FAST_EFFECT_MASK1: 0, ...overrides };
}

test("joint geometry keeps same-target, swap, follow and status partial separate", () => {
  assert.equal(classifyJointGeometry(detail(12, 12)),
    JOINT_GEOMETRY.SAME_TARGET);
  assert.equal(classifyJointGeometry(detail(11, 10)),
    JOINT_GEOMETRY.DIRECT_SWAP);
  assert.equal(classifyJointGeometry(detail(11, 12)),
    JOINT_GEOMETRY.VACATED_FOLLOW);
  assert.equal(classifyJointGeometry(detail(NONE_CELL, 12,
    { FIRST_FAST_EFFECT_MASK0: 2 })),
  JOINT_GEOMETRY.STUN_AFFECTED_PARTIAL_PREPARATION);
  assert.equal(classifyJointGeometry(detail(NONE_CELL, 12)),
    JOINT_GEOMETRY.OTHER_PARTIAL_PREPARATION);
});

test("rule matrix never promotes pinned simulator assumptions to platform truth", () => {
  const official = { officialHistoricalEvidence: { followsVacatedStart: 31,
    seat0Follows: 17, seat1Follows: 14, successfulSameTarget: 0,
    successfulSwap: 0 } };
  const probe = { officialEvidence: { observedCount: 22 } };
  const matrix = createRuleMatrix(official, probe);
  assert.equal(matrix.find(item => item.rule === "VACATED_FOLLOW").authority,
    EVIDENCE_AUTHORITY.PLATFORM_REPLAY_CONFIRMED);
  const same = matrix.find(item => item.rule === "SAME_TARGET");
  assert.equal(same.authority, EVIDENCE_AUTHORITY.FINITE_VARIANT_UNRESOLVED);
  assert.equal(same.platformVerdict, "UNRESOLVED");
  assert.equal(same.productionVerdict, "FAIL_CLOSED");
});

test("joint movement summary reconciles geometry, effects and historical labels", () => {
  const records = [{ geometry: JOINT_GEOMETRY.SAME_TARGET,
    failedSide: "baseline", effectMask: [0, 0], ply: 2,
    outcomeRelation: "EQUAL", paretoRelation: "EQUAL" },
  { geometry: JOINT_GEOMETRY.STUN_AFFECTED_PARTIAL_PREPARATION,
    failedSide: "candidate", effectMask: [2, 0], ply: 2,
    outcomeRelation: "INCUMBENT_BETTER", paretoRelation: "MIXED" }];
  const value = summarize(records);
  assert.equal(value.rootCount, 2);
  assert.equal(value.geometry.SAME_TARGET, 1);
  assert.equal(value.geometry.STUN_AFFECTED_PARTIAL_PREPARATION, 1);
  assert.deepEqual(value.failedSide, { baseline: 1, candidate: 1 });
  assert.equal(value.effectMask["2/0"], 1);
  assert.equal(value.ply[2], 2);
});
