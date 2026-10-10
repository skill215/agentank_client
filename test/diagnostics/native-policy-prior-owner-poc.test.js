"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE } = require("../../engine-v2/src/runtime/root-control-mode");
const { NativePolicyPriorOwnerPoc } = require(
  "../../tools/agentank/diagnostics/native-policy-prior-owner-poc");

function intent(preferred = 1) {
  return { prepareCount: 0, prepare() { this.prepareCount += 1; },
    bonus(row) { return row === preferred ? 150 : 0; },
    summary() { return { prepareCount: this.prepareCount }; } };
}

function engine() {
  return { lastControlMode: ROOT_CONTROL_MODE.TACTICAL_CONTACT,
    adapter: { enemyVisible: true }, lastProofStatus: 0,
    lastSelectionWasStrictRescue: false,
    lastSelectionWasVerifiedDirectKill: false,
    escapeObligation: { committedEntityCount: 0 }, ourCount: 3,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT]),
    ourArguments: new Uint16Array(3),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]), riskController: { outcome: { count: 3,
      acceptable: new Uint8Array([1, 0, 1]),
      dominated: new Uint8Array([0, 1, 0]) } } };
}

test("policy prior owns an incomplete tactical root without treating Risk as strategy", () => {
  const owner = new NativePolicyPriorOwnerPoc({ intent: intent(1) });
  assert.deepEqual(owner.selectOverride(engine(), 0, ACTION.GO),
    { action: ACTION.FIRE, argument: 0 });
  const summary = owner.summary();
  assert.equal(summary.overrideCount, 1);
  assert.equal(summary.riskRejectedObservedCount, 1);
  assert.equal(summary.dominatedObservedCount, 1);
  assert.equal(summary.incompleteVerifierCount, 1);
});

test("a complete terminal win may veto the policy prior", () => {
  const value = engine();
  value.depthSearch = { completedDepth: 2, representativeSupportComplete: 1,
    rootDomainRestricted: 0, rootScore: new Int32Array([30000, 100, 0]) };
  const owner = new NativePolicyPriorOwnerPoc({ intent: intent(1) });
  assert.equal(owner.selectOverride(value, 0, ACTION.GO), null);
  assert.equal(owner.summary().terminalWinVetoCount, 1);
});

test("committed rescue and strict proof remain above the policy prior", () => {
  const committed = engine(); committed.escapeObligation.committedEntityCount = 1;
  const owner = new NativePolicyPriorOwnerPoc({ intent: intent(1) });
  assert.equal(owner.selectOverride(committed, 0, ACTION.GO), null);
  assert.equal(owner.summary().committedSkipCount, 1);
  const strict = engine(); strict.lastSelectionWasStrictRescue = true;
  assert.equal(owner.selectOverride(strict, 0, ACTION.GO), null);
  assert.equal(owner.summary().strictOwnerSkipCount, 1);
});
