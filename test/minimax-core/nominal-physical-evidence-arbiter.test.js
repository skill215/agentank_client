"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PAC_STATUS } = require("../../engine-v2/src/search/projectile-attack-closure");
const { NominalPhysicalEvidenceArbiter, NOMINAL_EVIDENCE_REASON } =
  require("../../engine-v2/src/policy/nominal-physical-evidence-arbiter");

function root(actions, bestRow, scores) {
  const count = actions.length;
  return {
    nominalPhysicalRootActive: 1,
    ourActions: Uint8Array.from(actions),
    projectedCell: Uint16Array.from(actions.map((_, row) => row + 2)),
    hardStatus: Uint8Array.from(actions.map(() => HARD_STATUS.ALLOW)),
    adapter: { state: { arrays: [null, Uint16Array.from([1])] } },
    depthSearch: { completedDepth: 2, representativeSupportComplete: 1,
      representativeBestRow: bestRow, rootScore: Int32Array.from(scores) },
    riskController: {
      outcome: { acceptable: Uint8Array.from(actions.map(() => 1)),
        dominated: new Uint8Array(count) },
      riskStrictlyDominates: () => 0
    },
    combat: { vector: { directKill: new Uint8Array(count),
      attackClosureStatus: new Uint8Array(count),
      purposeCompleteness: new Uint16Array(count),
      postFireEscape: new Uint8Array(count),
      ownCounterExposure: new Uint16Array(count) } },
    projectileAttack: { doomedEnemyColumns: new Uint8Array(count) }
  };
}

test("nominal Physical evidence may replace a heuristic turn with strict better movement", () => {
  const value = root([ACTION.GO, ACTION.TURN_RIGHT], 0, [-1000, -5000]);
  const arbiter = new NominalPhysicalEvidenceArbiter(true);
  assert.equal(arbiter.select(value, 1, 2), 0);
  assert.equal(arbiter.lastReason, NOMINAL_EVIDENCE_REASON.VERIFIED_MOVEMENT);
  assert.equal(arbiter.overrideCount, 1);
});

test("nominal leaf value cannot give an unverified FIRE action ownership", () => {
  const value = root([ACTION.GO, ACTION.FIRE], 1, [-5000, -1000]);
  value.combat.vector.attackClosureStatus[1] = PAC_STATUS.COMPLETE;
  value.combat.vector.purposeCompleteness[1] = 10000;
  value.combat.vector.postFireEscape[1] = 1;
  const arbiter = new NominalPhysicalEvidenceArbiter(true);
  assert.equal(arbiter.select(value, 0, 2), 0);
  assert.equal(arbiter.lastReason, NOMINAL_EVIDENCE_REASON.ACTION_CLASS);
  assert.equal(arbiter.actionClassBlockedCount, 1);
});

test("nominal movement refines mobility but cannot cancel a qualified skill class", () => {
  const value = root([ACTION.TURN_LEFT, ACTION.CAST_POISON], 0, [-1000, -5000]);
  const arbiter = new NominalPhysicalEvidenceArbiter(true);
  assert.equal(arbiter.select(value, 1, 2), 1);
  assert.equal(arbiter.lastReason, NOMINAL_EVIDENCE_REASON.ACTION_CLASS);
});

test("a complete direct-kill attack certificate may own nominal evidence", () => {
  const value = root([ACTION.GO, ACTION.FIRE], 1, [-5000, -1000]);
  value.combat.vector.directKill[1] = 1;
  value.combat.vector.attackClosureStatus[1] = PAC_STATUS.COMPLETE;
  value.combat.vector.purposeCompleteness[1] = 10000;
  value.combat.vector.postFireEscape[1] = 1;
  value.projectileAttack.doomedEnemyColumns[1] = 1;
  const arbiter = new NominalPhysicalEvidenceArbiter(true);
  assert.equal(arbiter.select(value, 0, 2), 1);
  assert.equal(arbiter.lastReason, NOMINAL_EVIDENCE_REASON.VERIFIED_ATTACK);
});
