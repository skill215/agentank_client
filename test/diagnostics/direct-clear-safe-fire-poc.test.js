"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { DirectClearSafeFirePoc } = require(
  "../../tools/agentank/diagnostics/direct-clear-safe-fire-poc");

function engineFixture() {
  const map = boxedMap(8, 7);
  const built = fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [1, 3], "right"),
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
    immediateFatalMass: new Uint16Array(count), horizonFatalMass: new Uint16Array(count),
    unknownMass: new Uint16Array(count), escapeSlack: new Int8Array(count),
    robustLower: new Int32Array(count), expectedValue: new Int32Array(count) } } };
}

test("direct-clear safe FIRE overrides only an ordinary movement owner", () => {
  const engine = engineFixture(); const poc = new DirectClearSafeFirePoc();
  const result = poc.selectOverride(engine, 2, fast.ACTION.GO, fast.NONE_CELL, 3);
  assert.equal(result.action, fast.ACTION.FIRE);
  assert.equal(poc.overrideCount, 1);
  assert.equal(poc.safetyProvenCount, 1);
  assert.equal(poc.rootRestoreFailureCount, 0);
  assert.equal(poc.summary().records[0].distance, 3);
});

test("direct-clear safe FIRE cannot replace strict Proof or a skill", () => {
  const engine = engineFixture(); const poc = new DirectClearSafeFirePoc();
  engine.lastProofStatus = PROOF_STATUS.PROVEN;
  assert.equal(poc.selectOverride(engine, 2, fast.ACTION.GO, fast.NONE_CELL, 3), null);
  engine.lastProofStatus = PROOF_STATUS.UNKNOWN;
  assert.equal(poc.selectOverride(engine, 2, fast.ACTION.CAST_POISON,
    fast.NONE_CELL, 4), null);
  assert.equal(poc.overrideCount, 0);
});
