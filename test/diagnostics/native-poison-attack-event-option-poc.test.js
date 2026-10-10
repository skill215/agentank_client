"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, HARD_STATUS, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { ATTACK_POLICY_GOAL } = require(
  "../../tools/agentank/diagnostics/attack-policy-reachability-shadow");
const { NativePoisonAttackEventOptionPoc } = require(
  "../../tools/agentank/diagnostics/native-poison-attack-event-option-poc");

function search(status, goalMask = 0, hold = 0) {
  return { status, goalMask, poisonHoldTransitionCount: hold,
    nodes: 12, completedDepth: 4, rootRestoreFailures: 0, hotAllocationCount: 0,
    policyAction: ACTION.FIRE, policyArgument: NONE_CELL,
    policyFor() { return 1; },
    evaluateCandidate() { return this.status; } };
}

function fixture(candidate, baseline, mode = "active") {
  const state = new FastState(8, 8); const a = state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 4;
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_SKILL][0] = SKILL.POISON;
  a[ARRAY.TANK_SKILL_READY][0] = 0;
  a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  const engine = { adapter: { state,
      bundle: { state, kernel: { stationaryOccupiedBlockEnabled: false } },
      ownCanAct: 1,
      ownSkillReady: 1, enemyVisible: 1, tracker: { complete: 1 } },
    hiddenSupportComplete: 1, hiddenWorldCount: 1,
    hiddenWorldMass: Uint16Array.from([10000]),
    possibleProjectiles: { count: () => 0 },
    enemyCount: 1, enemyActions: Uint8Array.from([ACTION.GO]),
    enemyArguments: Uint16Array.from([NONE_CELL]),
    escapeObligation: { committedEntityCount: 0 },
    ourCount: 1, ourActions: Uint8Array.from([ACTION.FIRE]),
    ourArguments: Uint16Array.from([NONE_CELL]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW]),
    lastProofStatus: 0, lastSelectionWasStrictRescue: 0,
    lastSelectionWasVerifiedDirectKill: 0 };
  return { engine, option: new NativePoisonAttackEventOptionPoc(mode, {
    candidateSearch: candidate, baselineSearch: baseline
  }) };
}

test("Poison attack event owns only a causal irreversible attack certificate", () => {
  const candidate = search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 3);
  const baseline = search(PROOF_STATUS.DISPROVEN);
  const value = fixture(candidate, baseline);
  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.TURN_LEFT,
    NONE_CELL), { action: ACTION.CAST_POISON, argument: NONE_CELL });
  const summary = value.option.summary();
  assert.equal(summary.certificateCount, 1);
  assert.equal(summary.overrideCount, 1);
  assert.equal(summary.candidateNodes, 12);
  assert.equal(summary.baselineNodes, 12);
});

test("Poison attack event rejects debuff-only, no-hold and unknown baseline", () => {
  const debuff = fixture(search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.DEBUFF, 1), search(PROOF_STATUS.DISPROVEN));
  assert.equal(debuff.option.selectOverride(debuff.engine, ACTION.GO,
    NONE_CELL), null);
  assert.equal(debuff.option.summary().noHoldEvidenceCount, 1);

  const noHold = fixture(search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 0), search(PROOF_STATUS.DISPROVEN));
  assert.equal(noHold.option.selectOverride(noHold.engine, ACTION.GO,
    NONE_CELL), null);
  assert.equal(noHold.option.summary().noHoldEvidenceCount, 1);

  const unknown = fixture(search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 1), search(PROOF_STATUS.UNKNOWN));
  assert.equal(unknown.option.selectOverride(unknown.engine, ACTION.GO,
    NONE_CELL), null);
  assert.equal(unknown.option.summary().baselineUnknownCount, 1);
});

test("Poison attack event remains neutral in Shadow", () => {
  const value = fixture(search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 1), search(PROOF_STATUS.DISPROVEN), "shadow");
  assert.equal(value.option.selectOverride(value.engine, ACTION.GO,
    NONE_CELL), null);
  assert.equal(value.option.summary().wouldOverrideCount, 1);
  assert.equal(value.option.summary().overrideCount, 0);
});

test("axis trigger rejects an off-axis root before search", () => {
  const candidate = search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 1);
  const baseline = search(PROOF_STATUS.DISPROVEN);
  const value = fixture(candidate, baseline);
  value.option = new NativePoisonAttackEventOptionPoc("active", {
    candidateSearch: candidate, baselineSearch: baseline, triggerMode: "axis"
  });
  value.engine.adapter.state.arrays[ARRAY.TANK_CELL][1] =
    value.engine.adapter.state.cell(5, 3);
  assert.equal(value.option.selectOverride(value.engine, ACTION.FIRE,
    NONE_CELL), null);
  const summary = value.option.summary();
  assert.equal(summary.prefilterRootCount, 1);
  assert.equal(summary.triggerBlockedCount, 1);
  assert.equal(summary.eligibleCount, 0);
  assert.equal(summary.candidateNodes, 0);
});

test("pinned simulator evidence rejects odd-frame Poison cadence disagreement", () => {
  const candidate = search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 1);
  const baseline = search(PROOF_STATUS.DISPROVEN);
  const value = fixture(candidate, baseline);
  value.option = new NativePoisonAttackEventOptionPoc("active", {
    candidateSearch: candidate, baselineSearch: baseline,
    requireSimulatorCadenceAgreement: true
  });
  value.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 5;
  assert.equal(value.option.selectOverride(value.engine, ACTION.FIRE,
    NONE_CELL), null);
  const summary = value.option.summary();
  assert.equal(summary.cadenceCompatibilityBlockedCount, 1);
  assert.equal(summary.candidateNodes, 0);
});

test("one shared search proves baseline first and leaves the Poison policy resident", () => {
  const calls = [];
  const shared = search(PROOF_STATUS.DISPROVEN);
  shared.evaluateCandidate = function evaluateCandidate(_bundle, action) {
    calls.push(action);
    if (action === ACTION.CAST_POISON) {
      this.goalMask = ATTACK_POLICY_GOAL.ENEMY_CRASH;
      this.poisonHoldTransitionCount = 1;
      return PROOF_STATUS.PROVEN;
    }
    this.goalMask = 0; this.poisonHoldTransitionCount = 0;
    return PROOF_STATUS.DISPROVEN;
  };
  const value = fixture(shared, shared);
  value.option = new NativePoisonAttackEventOptionPoc("active", {
    candidateSearch: shared, baselineSearch: shared, sharedSearch: true
  });
  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.TURN_LEFT,
    NONE_CELL), { action: ACTION.CAST_POISON, argument: NONE_CELL });
  assert.deepEqual(calls, [ACTION.TURN_LEFT, ACTION.CAST_POISON]);
  const summary = value.option.summary();
  assert.equal(summary.sharedSearch, true);
  assert.equal(summary.baselineDisprovenCount, 1);
  assert.equal(summary.certificateCount, 1);
});

test("snapshot search proves candidate first and preserves its depth and policy", () => {
  const calls = [];
  const shared = search(PROOF_STATUS.DISPROVEN);
  shared.ttDepth = new Uint8Array(2);
  shared.ttStatus = new Uint8Array(2);
  shared.ttSemanticLo = new Uint32Array(2);
  shared.ttSemanticHi = new Uint32Array(2);
  shared.ttPolicyAction = new Uint8Array(2);
  shared.ttPolicyArgument = new Uint16Array(2);
  shared.semanticKey = function semanticKey() {
    this.semanticLo = 123; this.semanticHi = 456;
  };
  shared.evaluateCandidate = function evaluateCandidate(_bundle, action) {
    calls.push(action); this.ttDepth.fill(0); this.ttStatus.fill(0);
    if (action === ACTION.CAST_POISON) {
      this.goalMask = ATTACK_POLICY_GOAL.ENEMY_CRASH;
      this.poisonHoldTransitionCount = 1; this.completedDepth = 4;
      this.provenPolicyEntryCount = 1;
      this.ttDepth[0] = 3; this.ttStatus[0] = PROOF_STATUS.PROVEN;
      this.ttSemanticLo[0] = 123; this.ttSemanticHi[0] = 456;
      this.ttPolicyAction[0] = ACTION.FIRE;
      this.ttPolicyArgument[0] = NONE_CELL;
      return PROOF_STATUS.PROVEN;
    }
    this.goalMask = 0; this.poisonHoldTransitionCount = 0;
    this.completedDepth = 2; this.provenPolicyEntryCount = 0;
    return PROOF_STATUS.DISPROVEN;
  };
  const value = fixture(shared, shared);
  value.option = new NativePoisonAttackEventOptionPoc("active", {
    candidateSearch: shared, baselineSearch: shared, snapshotSearch: true
  });
  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.TURN_LEFT,
    NONE_CELL), { action: ACTION.CAST_POISON, argument: NONE_CELL });
  assert.deepEqual(calls, [ACTION.CAST_POISON, ACTION.TURN_LEFT]);
  let summary = value.option.summary();
  assert.equal(summary.lastCandidateCompletedDepth, 4);
  assert.equal(summary.continuationRemaining, 3);
  assert.equal(summary.certificateByCompletedDepth[4], 1);
  assert.equal(summary.policySnapshotCaptureCount, 1);
  assert.equal(summary.policySnapshotMaximumEntries, 1);

  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.GO,
    NONE_CELL), { action: ACTION.FIRE, argument: NONE_CELL });
  summary = value.option.summary();
  assert.equal(summary.continuationSemanticHitCount, 1);
  assert.equal(summary.policySnapshotHitCount, 1);
  assert.equal(summary.continuationMissCount, 0);
});

test("active certificate executes the stored exact continuation policy", () => {
  const candidate = search(PROOF_STATUS.PROVEN,
    ATTACK_POLICY_GOAL.ENEMY_CRASH, 1);
  const baseline = search(PROOF_STATUS.DISPROVEN);
  const value = fixture(candidate, baseline);
  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.TURN_LEFT,
    NONE_CELL), { action: ACTION.CAST_POISON, argument: NONE_CELL });
  assert.equal(value.option.summary().continuationArmCount, 1);
  assert.deepEqual(value.option.selectOverride(value.engine, ACTION.GO,
    NONE_CELL), { action: ACTION.FIRE, argument: NONE_CELL });
  const summary = value.option.summary();
  assert.equal(summary.continuationCheckCount, 1);
  assert.equal(summary.continuationSelectCount, 1);
  assert.equal(summary.continuationMissCount, 0);
});
