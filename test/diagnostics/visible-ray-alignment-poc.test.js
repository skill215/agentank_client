"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { VisibleRayAlignmentPoc } = require(
  "../../tools/agentank/diagnostics/visible-ray-alignment-poc");

function engineFixture() {
  const built = fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) },
    tanks: [tank(0, [1, 3], "up"),
      tank(1, [4, 3], "left", { frozenUntilFrame: 10, skillReadyFrame: 255 })]
  }));
  const count = 4;
  return { adapter: { bundle: built, state: built.state, enemyVisible: true,
    tracker: { complete: true } }, hiddenSupportComplete: 1, hiddenWorldCount: 1,
  hiddenWorldMass: new Uint16Array([10000]), possibleProjectiles: { count: () => 0 },
  ourCount: count, ourActions: new Uint8Array([fast.ACTION.FIRE,
    fast.ACTION.TURN_RIGHT, fast.ACTION.GO, fast.ACTION.TURN_LEFT]),
  ourArguments: new Uint16Array(count).fill(fast.NONE_CELL),
  hardStatus: new Uint8Array(count).fill(fast.HARD_STATUS.ALLOW),
  enemyCount: 1, enemyActions: new Uint8Array([fast.ACTION.NONE]),
  enemyArguments: new Uint16Array([fast.NONE_CELL]), lastProofStatus: PROOF_STATUS.UNKNOWN,
  lastSelectionWasStrictRescue: 0, lastSelectionWasVerifiedDirectKill: 0,
  riskController: { outcome: { count, acceptable: new Uint8Array(count).fill(1),
    dominated: new Uint8Array(count), horizonFatalMass: new Uint16Array(count),
    unknownMass: new Uint16Array(count), robustLower: new Int32Array(count),
    expectedValue: new Int32Array(count) } } };
}

test("visible clear wrong-facing axis selects the exact safe turn", () => {
  const engine = engineFixture(); const poc = new VisibleRayAlignmentPoc();
  const result = poc.selectOverride(engine, 2, fast.ACTION.GO, fast.NONE_CELL, 2);
  assert.equal(result.action, fast.ACTION.TURN_RIGHT);
  assert.equal(poc.overrideCount, 1);
  assert.equal(poc.safetyProvenCount, 1);
  assert.equal(poc.rootRestoreFailureCount, 0);
  assert.equal(poc.summary().records[0].distance, 3);
});

test("visible alignment does not reselect an already correct turn or a dominated row", () => {
  const engine = engineFixture(); const poc = new VisibleRayAlignmentPoc();
  assert.equal(poc.selectOverride(engine, 1, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, 2), null);
  engine.riskController.outcome.dominated[1] = 1;
  assert.equal(poc.selectOverride(engine, 2, fast.ACTION.GO, fast.NONE_CELL, 3), null);
  assert.equal(poc.sameActionCount, 1);
  assert.equal(poc.dominatedBlockedCount, 1);
});
