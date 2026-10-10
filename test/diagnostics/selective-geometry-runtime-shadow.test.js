"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");
const { SelectiveGeometryShadow } = require(
  "../../engine-v2/src/search/selective-geometry-shadow");
const { ProductionRootEngine } = require(
  "../../engine-v2/src/runtime/production-root");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");

function fakeEngine() {
  return {
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE,
      ACTION.THROW_BOMB]),
    ourArguments: new Uint16Array(4),
    riskController: { outcome: {
      acceptable: new Uint8Array([1, 1, 1, 1]),
      dominated: new Uint8Array([0, 0, 0, 1]),
      tacticalValue: new Int16Array([100, 300, 250, 1000]),
      expectedValue: new Int16Array([100, 300, 250, 1000]),
      combatPurpose: new Uint8Array([0, 0, 1, 1])
    } },
    runtime: { runtimeConfig: RUNTIME_CONFIG, accumulatedWorkUnits: 1000,
      currentCallbackWorkUnits: 2000 },
    availableOptionalWorkUnits() { return 50000; }
  };
}

test("runtime geometry candidate set keeps selected, ordinary and attack rows", () => {
  const engine = fakeEngine(); const shadow = new SelectiveGeometryShadow(3);
  assert.equal(shadow.selectCandidates(engine, 0, 4), 3);
  assert.deepEqual(Array.from(shadow.rowMap), [0, 1, 2]);
});

test("runtime geometry never restores a Risk-dominated high-score row", () => {
  const engine = fakeEngine(); const shadow = new SelectiveGeometryShadow(2);
  assert.equal(shadow.selectCandidates(engine, 0, 4), 2);
  assert.deepEqual(Array.from(shadow.rowMap.slice(0, 2)), [0, 1]);
});

test("runtime geometry quota reserves one complete optional callback", () => {
  const engine = fakeEngine(); const shadow = new SelectiveGeometryShadow(3);
  const reserve = RUNTIME_CONFIG.PER_CALLBACK_WORK_UNIT_LIMIT -
    RUNTIME_CONFIG.MINIMUM_EMERGENCY_BATCH_RESERVE;
  assert.equal(shadow.optionalQuota(engine), Math.min(50000,
    RUNTIME_CONFIG.FALLBACK_ENTER_WORK_UNITS - reserve - 3000));
  engine.runtime.accumulatedWorkUnits = RUNTIME_CONFIG.FALLBACK_ENTER_WORK_UNITS - reserve;
  engine.runtime.currentCallbackWorkUnits = 0;
  assert.equal(shadow.optionalQuota(engine), 0);
});

test("runtime geometry owns only fixed construction-time storage", () => {
  const shadow = new SelectiveGeometryShadow(3);
  assert.equal(shadow.hotAllocationCount, 0);
  assert.deepEqual(shadow.summary().widthCounts, [0, 0, 0, 0]);
});

test("runtime geometry trigger is a zero-search feature conjunction", () => {
  const shadow = new SelectiveGeometryShadow({ maximumRows: 3,
    triggerMask: 0b1010, triggerValue: 0b0010 });
  assert.equal(shadow.triggerMask, 0b1010);
  assert.equal(shadow.triggerValue, 0b0010);
  assert.equal((0b0110 & shadow.triggerMask) === shadow.triggerValue, true);
  assert.equal((0b1110 & shadow.triggerMask) === shadow.triggerValue, false);
});

test("runtime geometry cooldown is bounded construction-time state", () => {
  const shadow = new SelectiveGeometryShadow({ maximumRows: 3, cooldownFrames: 99 });
  assert.equal(shadow.cooldownFrames, 16);
  assert.equal(shadow.lastSearchFrame, -32);
  assert.equal(shadow.cooldownSkips, 0);
});

test("active geometry publishes only a strict completed challenger", () => {
  const engine = fakeEngine(); engine.informationSearch = { rootScore: new Int32Array([10, 20]) };
  const shadow = new SelectiveGeometryShadow({ maximumRows: 3, active: true });
  shadow.rowMap[0] = 0; shadow.rowMap[1] = 2; shadow.lastFeatureKey = 1;
  assert.equal(shadow.strictProposal(engine, 1), 2);
  assert.equal(shadow.proposalCount, 1);
  engine.informationSearch.rootScore[1] = 10;
  assert.equal(shadow.strictProposal(engine, 1), -1);
  assert.equal(shadow.proposalCount, 1);
});

test("exact geometry proposal stays below committed rescue but above verified attack", () => {
  const engine = new ProductionRootEngine();
  engine.finalGate.select = () => 0; engine.finalGate.finalAllows = () => true;
  engine.verifiedDirectKillEnabled = 1; engine.verifiedDirectKillCandidate = () => 2;
  engine.escapeObligation.supportStatus = SUPPORT_STATUS.NONE;
  assert.equal(engine.selectFinalAction({}, 0, 3, 0, 1), 0);
  engine.escapeObligation.supportStatus = SUPPORT_STATUS.COMPLETE;
  engine.escapeObligation.strictRescueCandidate = () => 1;
  engine.escapeObligation.confirmStrictRescue = () => {};
  assert.equal(engine.selectFinalAction({}, 0, 3, 0, 1), 1);
});
