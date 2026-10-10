"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { STRICT_VALUE_MIN, STRICT_VALUE_MAX, StableOptionIntervalShadow } = require(
  "../../tools/agentank/diagnostics/stable-option-interval-shadow");

class FakeRollout {
  constructor() {
    this.physicalComplete = Uint8Array.from([1, 1]);
    this.rootRestored = Uint8Array.from([1, 1]);
    this.hardFatal = new Uint8Array(2); this.ownCrashed = new Uint8Array(2);
    this.enemyCrashed = Uint8Array.from([0, 1]);
    this.starGain = Int16Array.from([1, 0]);
    this.terminalReached = Uint8Array.from([0, 1]);
    this.value = Int16Array.from([3, 7]);
    this.transitionCount = 0; this.rootRestoreFailureCount = 0;
    this.hotAllocationCount = 0;
  }
  evaluate(_bundle, _actions, _arguments, count) {
    this.transitionCount += count * 4; return count;
  }
  compare(left, right) { return this.value[left] > this.value[right]; }
}

function fixture(event = 1) {
  const ledger = {
    lastSelectedKind: LONG_OPTION.STAR_CONTROL, lastSelectedGeneration: 7,
    lastEventMask: event, availableGeneration() { return 11; },
    classifier: {
      selectedRow() { return 0; },
      purposeComplete(_engine, kind, row) {
        return kind === LONG_OPTION.ATTACK && row === 1 ? 1 : 0;
      }
    }
  };
  const engine = {
    adapter: { state: {} }, ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    ourArguments: new Uint16Array(2),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    lastProofStatus: PROOF_STATUS.UNKNOWN,
    escapeObligation: { committedEntityCount: 0 },
    riskController: { outcome: { count: 2,
      acceptable: Uint8Array.from([1, 1]), dominated: new Uint8Array(2),
      robustLower: Int16Array.from([100, 500]),
      expectedValue: Int16Array.from([300, 700]) } },
    optionPortfolio: { count: 2,
      primitiveRow: Uint8Array.from([0, 1]),
      kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL, OPTION_KIND.ATTACK_SETUP]),
      supportComplete: Uint8Array.from([1, 1]) }
  };
  return { ledger, engine };
}

test("event conflict produces nominal evidence but never strict ownership", () => {
  const { ledger, engine } = fixture(); const rollout = new FakeRollout();
  const shadow = new StableOptionIntervalShadow(ledger, null, rollout);
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(summary.evaluationCount, 1);
  assert.equal(summary.nominalBalancedAttackWinCount, 1);
  assert.equal(summary.nominalCombatAttackWinCount, 1);
  assert.equal(summary.riskBandAttackSeparationCount, 1);
  assert.equal(summary.attackEnemyCrashGainCount, 1);
  assert.equal(summary.attackStarRegressionCount, 1);
  assert.equal(summary.strictFullRangeCount, 1);
  assert.equal(summary.strictOwnershipCount, 0);
  assert.equal(summary.lastStrictLower, STRICT_VALUE_MIN);
  assert.equal(summary.lastStrictUpper, STRICT_VALUE_MAX);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(summary.hotAllocationCount, 0);
});

test("a conflict edge is an internal event while a stable conflict is skipped", () => {
  let built = fixture(0); let rollout = new FakeRollout();
  let shadow = new StableOptionIntervalShadow(built.ledger, null, rollout);
  shadow.observe(built.engine, ACTION.GO);
  assert.equal(shadow.summary().internalEventTriggerCount, 1);
  assert.ok(rollout.transitionCount > 0);
  const transitions = rollout.transitionCount;
  shadow.observe(built.engine, ACTION.GO);
  assert.equal(shadow.summary().steadyConflictSkipCount, 1);
  assert.equal(rollout.transitionCount, transitions);

  built = fixture(1); built.engine.escapeObligation.committedEntityCount = 1;
  rollout = new FakeRollout();
  shadow = new StableOptionIntervalShadow(built.ledger, null, rollout);
  shadow.observe(built.engine, ACTION.GO);
  assert.equal(shadow.summary().committedSkipCount, 1);
  assert.equal(rollout.transitionCount, 0);
});

test("even nominal terminal completion keeps the strict interval full range", () => {
  const { ledger, engine } = fixture(); const rollout = new FakeRollout();
  rollout.terminalReached.fill(1);
  const shadow = new StableOptionIntervalShadow(ledger, null, rollout);
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(summary.strictTerminalResolvedCount, 1);
  assert.equal(summary.strictOwnershipCount, 0);
  assert.equal(summary.strictFullRangeCount, 1);
});
