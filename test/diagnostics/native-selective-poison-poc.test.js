"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, SKILL, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { ROOT_CONTROL_MODE } = require("../../engine-v2/src/runtime/root-control-mode");
const { NativeSelectivePoisonPoc } = require(
  "../../tools/agentank/diagnostics/native-selective-poison-poc");

function root() {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 20;
  a[ARRAY.TANK_CELL][0] = 3 * 7 + 3;
  a[ARRAY.TANK_CELL][1] = 3 * 7 + 6;
  a[ARRAY.TANK_SKILL][0] = SKILL.POISON;
  const engine = {
    adapter: { state, ownCanAct: true, ownSkillReady: true,
      informationComplete: 1, enemyVisible: 1, enemyCanAct: 1 },
    lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    escapeObligation: { supportStatus: SUPPORT_STATUS.NONE,
      committedEntityCount: 0 },
    possibleProjectiles: { count() { return 0; } },
    riskController: { outcome: { acceptable: new Uint8Array([1, 1]),
      dominated: new Uint8Array(2) } },
    ourActions: new Uint8Array([ACTION.TURN_LEFT, ACTION.NONE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    ourCount: 2
  };
  return engine;
}

test("shadow finds a close-contact poison proposal without changing the action", () => {
  const poc = new NativeSelectivePoisonPoc("shadow");
  assert.equal(poc.selectOverride(root(), ACTION.TURN_LEFT, NONE_CELL), null);
  assert.equal(poc.summary().evidenceCount, 1);
  assert.equal(poc.summary().wouldOverrideCount, 1);
  assert.equal(poc.summary().overrideCount, 0);
});

test("active replaces only the exact no-poison TURN_LEFT incumbent", () => {
  const poc = new NativeSelectivePoisonPoc("active");
  assert.deepEqual(poc.selectOverride(root(), ACTION.TURN_LEFT, NONE_CELL),
    { action: ACTION.CAST_POISON, argument: NONE_CELL });
  assert.equal(poc.selectOverride(root(), ACTION.GO, NONE_CELL), null);
  assert.equal(poc.summary().overrideCount, 1);
  assert.equal(poc.summary().incumbentBlockedCount, 1);
});

test("incomplete information stays soft while physical danger blocks ownership", () => {
  const poc = new NativeSelectivePoisonPoc("active");
  const incomplete = root(); incomplete.adapter.informationComplete = 0;
  assert.equal(poc.selectOverride(incomplete, ACTION.TURN_LEFT, NONE_CELL).action,
    ACTION.CAST_POISON);
  const committed = root();
  committed.escapeObligation.supportStatus = SUPPORT_STATUS.COMPLETE;
  committed.escapeObligation.committedEntityCount = 1;
  assert.equal(poc.selectOverride(committed, ACTION.TURN_LEFT, NONE_CELL), null);
  const possible = root(); possible.possibleProjectiles.count = () => 1;
  assert.equal(poc.selectOverride(possible, ACTION.TURN_LEFT, NONE_CELL), null);
  assert.equal(poc.summary().supportBlockedCount, 0);
  assert.equal(poc.summary().committedBlockedCount, 1);
  assert.equal(poc.summary().possibleBlockedCount, 1);
  assert.equal(poc.summary().hotAllocationCount, 0);
});

test("stationary Hard and terminal deadline remain mandatory", () => {
  const poc = new NativeSelectivePoisonPoc("active");
  const hard = root(); hard.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  assert.equal(poc.selectOverride(hard, ACTION.TURN_LEFT, NONE_CELL), null);
  const terminal = root();
  terminal.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 124;
  assert.equal(poc.selectOverride(terminal, ACTION.TURN_LEFT, NONE_CELL), null);
  assert.equal(poc.summary().stationaryHardBlockedCount, 1);
  assert.equal(poc.summary().deadlineBlockedCount, 1);
});

test("stationary Risk membership is required under incomplete information", () => {
  const poc = new NativeSelectivePoisonPoc("active"); const value = root();
  value.adapter.informationComplete = 0;
  value.riskController.outcome.acceptable[1] = 0;
  assert.equal(poc.selectOverride(value, ACTION.TURN_LEFT, NONE_CELL), null);
  assert.equal(poc.summary().stationaryRiskBlockedCount, 1);
});
