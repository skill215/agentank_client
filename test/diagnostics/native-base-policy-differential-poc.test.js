"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { NATIVE_RESULT, NativeBasePolicyDifferentialPoc } = require(
  "../../tools/agentank/diagnostics/native-base-policy-differential-poc");

test("differential action owner is explicit", () => {
  assert.equal(new NativeBasePolicyDifferentialPoc().summary().activeOwner,
    "oracle");
  assert.equal(new NativeBasePolicyDifferentialPoc({ activeOwner: "native" })
    .summary().activeOwner, "native");
});

test("same-root policy differential distinguishes proposal from fallback", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  const oracle = { action: ACTION.FIRE, argument: 0 };
  assert.equal(audit.observe(ACTION.GO, null, false, oracle, true), oracle);
  audit.observe(ACTION.GO, { action: ACTION.FIRE, argument: 0 }, true,
    oracle, true);
  const summary = audit.summary();
  assert.equal(summary.compareCount, 2);
  assert.equal(summary.actionAgreementCount, 1);
  assert.equal(summary.actionDisagreementCount, 1);
  assert.equal(summary.nativeFallbackCount, 1);
  assert.equal(summary.familyPairs["GO->FIRE"], 1);
  assert.equal(summary.familyPairs["FIRE->FIRE"], 1);
  assert.equal(summary.nativeFallbackDisagreementCount, 1);
  assert.equal(summary.nativeProposalAgreementCount, 1);
});

test("roots without a V1 tactical-stage proposal are outside the differential", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  assert.equal(audit.observe(ACTION.GO, null, false, null, false), null);
  assert.equal(audit.summary().compareCount, 0);
});

test("full controller census includes roots outside the tactical stage", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  audit.observe(ACTION.GO, null, false, null, false, null, null,
    NATIVE_RESULT.NON_CONTACT, 0, null, 0, ACTION.NONE, 9, ACTION.GO);
  const summary = audit.summary();
  assert.equal(summary.compareCount, 0);
  assert.equal(summary.fullControllerCompareCount, 1);
  assert.equal(summary.fullControllerAgreementCount, 1);
  assert.equal(summary.fullControllerStageCount[9], 1);
});

test("same-root differential separates domain removal from value ordering", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  const engine = { ourCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]) };
  const owner = { allowedRow: new Uint8Array([1, 0]),
    membershipStage: new Uint8Array([8, 2]),
    backedValue: new Int32Array([20, 40]) };
  audit.observe(ACTION.GO, { action: ACTION.GO }, true,
    { action: ACTION.FIRE }, true, engine, owner, NATIVE_RESULT.PROPOSED);
  const summary = audit.summary();
  assert.equal(summary.oracleActionDomainBlockedCount, 1);
  assert.equal(summary.oracleActionRiskRejectedCount, 1);
});

test("same-root policy differential preserves exact membership blocker", () => {
  const engine = { ourCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]) };
  for (const [stage, key] of [
    [3, "oracleActionRiskParetoBlockedCount"],
    [4, "oracleActionCommittedBlockedCount"],
    [5, "oracleActionSourceDomainBlockedCount"],
    [6, "oracleActionOwnerDomainBlockedCount"],
    [7, "oracleActionIntentBlockedCount"]
  ]) {
    const audit = new NativeBasePolicyDifferentialPoc();
    const owner = { allowedRow: new Uint8Array([1, 0]),
      membershipStage: new Uint8Array([8, stage]),
      backedValue: new Int32Array([20, 40]) };
    audit.observe(ACTION.GO, { action: ACTION.GO }, true,
      { action: ACTION.FIRE }, true, engine, owner, NATIVE_RESULT.PROPOSED);
    assert.equal(audit.summary()[key], 1, key);
  }
});

test("missed V1 fire census records value gap and combat evidence", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  const engine = { ourCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    combat: { vector: { count: 2, directKill: new Uint8Array([0, 1]),
      aimSetup: new Uint8Array(2), intercept: new Uint8Array([0, 1]),
      possibleHit: new Uint8Array([0, 1]), postFireEscape: new Uint8Array([0, 1]),
      purposeCompleteness: new Uint16Array([0, 5000]),
      ownCounterExposure: new Uint8Array([0, 2]),
      enemySafeSuccessors: new Uint8Array([0, 1]) } } };
  const owner = { allowedRow: new Uint8Array([1, 1]),
    backedValue: new Int32Array([220, 150]) };
  audit.observe(ACTION.GO, { action: ACTION.GO }, true,
    { action: ACTION.FIRE }, true, engine, owner, NATIVE_RESULT.PROPOSED,
    0, null, 0, ACTION.FIRE);
  const summary = audit.summary();
  assert.equal(summary.missedV1FireCount, 1);
  assert.equal(summary.missedV1FireAllowedCount, 1);
  assert.equal(summary.missedV1FireGapBuckets[3], 1);
  assert.equal(summary.missedV1FireDirectKillCount, 1);
  assert.equal(summary.missedV1FirePostEscapeCount, 1);
  assert.equal(summary.missedV1FireCounterExposureTotal, 2);
});

test("native fire census separates V1-agreed attack evidence", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  const engine = { ourCount: 1, ourActions: new Uint8Array([ACTION.FIRE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW]),
    combat: { vector: { count: 1, intercept: new Uint8Array([1]),
      possibleHit: new Uint8Array([1]), postFireEscape: new Uint8Array([1]),
      purposeCompleteness: new Uint16Array([5000]),
      ownCounterExposure: new Uint8Array([2]) } } };
  const owner = { allowedRow: new Uint8Array([1]),
    backedValue: new Int32Array([100]) };
  audit.observe(ACTION.FIRE, { action: ACTION.FIRE }, true,
    { action: ACTION.FIRE }, true, engine, owner, NATIVE_RESULT.PROPOSED,
    0, null, 0, ACTION.FIRE);
  const summary = audit.summary();
  assert.equal(summary.nativeFireCount, 1);
  assert.equal(summary.nativeFireV1Count, 1);
  assert.equal(summary.nativeFireV1InterceptCount, 1);
  assert.equal(summary.nativeFireV1PurposeCompleteCount, 1);
});

test("same-root differential attributes V1 strict tactical traps", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  const engine = { ourCount: 2,
    ourActions: new Uint8Array([ACTION.GO, ACTION.FIRE]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]) };
  const owner = { allowedRow: new Uint8Array([1, 1]),
    backedValue: new Int32Array([20, 40]) };
  audit.observe(ACTION.GO, { action: ACTION.FIRE }, true,
    { action: ACTION.GO }, true, engine, owner, NATIVE_RESULT.PROPOSED, 3,
    [{ action: "GO", value: 20 }, { action: "FIRE", value: -100,
      unsafe: true, turnThenFireTrap: true }]);
  const summary = audit.summary();
  assert.equal(summary.nativeActionV1UnsafeCount, 1);
  assert.equal(summary.nativeActionV1TurnThenFireTrapCount, 1);
  assert.equal(summary.nativeActionV1OverloadTrapCount, 0);
});

test("same-root differential preserves exact resource action pairs", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  audit.observe(ACTION.GO, { action: ACTION.THROW_BOMB }, true,
    { action: ACTION.TURN_LEFT }, true);
  audit.observe(ACTION.GO, { action: ACTION.CAST_POISON }, true,
    { action: ACTION.GO }, true);
  const summary = audit.summary();
  assert.equal(summary.exactPairs["THROW_BOMB->TURN_LEFT"], 1);
  assert.equal(summary.exactPairs["CAST_POISON->GO"], 1);
});

test("same-root differential attributes exact pairs to the active intent", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  audit.observe(ACTION.GO, { action: ACTION.TURN_LEFT }, true,
    { action: ACTION.TURN_RIGHT }, true, null, { intent: { committed: 2 } });
  assert.equal(audit.summary().intentPairs[
    "CHASE_STAR:TURN_LEFT->TURN_RIGHT"], 1);
});

test("same-root differential separates raw and pre Monte Carlo V1 best", () => {
  const audit = new NativeBasePolicyDifferentialPoc();
  audit.observe(ACTION.GO, { action: ACTION.GO }, true,
    { action: ACTION.FIRE }, true, null, null, NATIVE_RESULT.PROPOSED, 2, [
      { action: "GO", rawValue: 20, preMonteCarloValue: 40, value: 40,
        unsafe: false },
      { action: "FIRE", rawValue: 30, preMonteCarloValue: 35, value: 50,
        unsafe: false }
    ], 1, ACTION.FIRE);
  const summary = audit.summary();
  assert.equal(summary.v1RawBestCompareCount, 1);
  assert.equal(summary.v1RawBestAgreementCount, 0);
  assert.equal(summary.v1PreMonteCarloBestAgreementCount, 1);
  assert.equal(summary.v1EvaluatedFinalBestAgreementCount, 1);
  assert.equal(summary.v1RawToFinalDifferenceCount, 0);
  assert.equal(summary.v1PreMonteCarloToFinalDifferenceCount, 1);
});
