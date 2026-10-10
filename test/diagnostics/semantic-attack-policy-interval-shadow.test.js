"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { RUNTIME_MODE } = require(
  "../../engine-v2/src/abi/cache-runtime-codes");
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { SemanticAttackPolicyIntervalShadow, CERTIFICATE_CAPACITY,
  COMPARISON_CAPACITY } = require(
  "../../tools/agentank/diagnostics/semantic-attack-policy-interval-shadow");

function subject(strictMask = 0) {
  const epoch = { activeGeneration: 4, activeKind: LONG_OPTION.ATTACK,
    activeTargetSignature: 0x12345678, activeTargetGeneration: 7,
    lastStatus: 2 };
  const coverage = { lastStrictMask: strictMask };
  const pose = { hotAllocationCount: 0, calls: 0,
    prepare() { this.calls += 1; return 1; }, summary() { return {}; } };
  const policy = { hotAllocationCount: 0, calls: 0, lastComplete: 0,
    lastBestRow: -1, lastBestValue: -10, lastBaselineValue: -20,
    select() { this.calls += 1; this.lastComplete = 1; this.lastBestRow = 1;
      return 1; }, summary() { return {}; } };
  const arrays = new Array(ARRAY.SCALAR + 1).fill(null);
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 9;
  const outcome = { count: 2, acceptable: Uint8Array.from([1, 1]),
    dominated: new Uint8Array(2) };
  const engine = { ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT]),
    ourArguments: Uint16Array.from([3, 9]), hardStatus:
      Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    diagnosticInternalSelectedIndex: 0, enemyCount: 2,
    hiddenWorldCount: 1, hiddenWorldMass: Uint16Array.from([10000]),
    runtime: { runtimeMode: RUNTIME_MODE.NORMAL }, depthSearch: {},
    riskController: { outcome }, escapeObligation: { committedEntityCount: 0 },
    lastControlMode: 2,
    adapter: { enemyVisible: 1,
      state: { arrays, hashLo: 0xabcdef01, hashHi: 0x10203040 } } };
  const shadow = new SemanticAttackPolicyIntervalShadow(epoch, coverage, {},
    { pose, policy });
  return { shadow, pose, policy, engine };
}

test("branch-local strict policy dominance is audited without changing action", () => {
  const { shadow, pose, policy, engine } = subject();
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(pose.calls, 1); assert.equal(policy.calls, 1);
  assert.equal(summary.strictDominanceCount, 1);
  assert.equal(summary.dominanceByAction.TURN_LEFT, 1);
  assert.equal(summary.certificateCount, 1);
  assert.equal(summary.comparisonCount, 1);
  assert.equal(summary.comparisonOverflowCount, 0);
  assert.equal(summary.comparisonRoots[0].policyRelation, 1);
  assert.equal(summary.comparisonRoots[0].baselineValue, -20);
  assert.equal(summary.comparisonRoots[0].candidateValue, -10);
  assert.deepEqual(summary.certificateRoots[0], {
    frame: 9, hashLo: 0xabcdef01, hashHi: 0x10203040,
    currentRow: 0, candidateRow: 1,
    currentAction: ACTION.GO, candidateAction: ACTION.TURN_LEFT,
    currentArgument: 3, candidateArgument: 9,
    baselineValue: -20, candidateValue: -10,
    epochGeneration: 4, targetSignature: 0x12345678,
    targetGeneration: 7, controlMode: 2,
    objectiveRelation: 0,
    objectiveCurrent: { progress: 0, deadline: 0, muzzleCoverage: 0,
      responseViability: 0, escapeBranches: 0, counterExposure: 0 },
    objectiveCandidate: { progress: 0, deadline: 0, muzzleCoverage: 0,
      responseViability: 0, escapeBranches: 0, counterExposure: 0 }
  });
  assert.equal(engine.diagnosticInternalSelectedIndex, 0);
});

test("certificate slab only records dominance and reports overflow", () => {
  const { shadow, policy, engine } = subject();
  policy.select = function select() {
    this.calls += 1; this.lastComplete = 1; this.lastBestRow = 1;
    return this.calls === 1 ? -1 : 1;
  };
  shadow.observe(engine, ACTION.GO);
  assert.equal(shadow.summary().certificateCount, 0);
  for (let index = 0; index <= CERTIFICATE_CAPACITY; index += 1)
    shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.equal(summary.strictDominanceCount, CERTIFICATE_CAPACITY + 1);
  assert.equal(summary.certificateCount, CERTIFICATE_CAPACITY);
  assert.equal(summary.certificateOverflowCount, 1);
  assert.equal(summary.certificateRoots.length, CERTIFICATE_CAPACITY);
  assert.equal(summary.comparisonCount, COMPARISON_CAPACITY);
  assert.equal(summary.comparisonOverflowCount,
    CERTIFICATE_CAPACITY + 2 - COMPARISON_CAPACITY);
});

test("equal and lower completed comparisons remain in the bounded corpus", () => {
  const { shadow, policy, engine } = subject();
  policy.select = function select() {
    this.calls += 1; this.lastComplete = 1; this.lastBestRow = 1;
    this.lastBestValue = this.calls === 1 ? this.lastBaselineValue :
      this.lastBaselineValue - 1;
    return -1;
  };
  shadow.observe(engine, ACTION.GO);
  shadow.observe(engine, ACTION.GO);
  const summary = shadow.summary();
  assert.deepEqual(summary.comparisonRoots.map(root => root.policyRelation),
    [2, 3]);
  assert.equal(summary.certificateCount, 0);
});

test("saved FinalActionGate identity is used only for the same frame", () => {
  const current = subject();
  current.engine.diagnosticPhysicalRootFrame = 9;
  current.engine.diagnosticPhysicalRootHashLo = 0x11111111;
  current.engine.diagnosticPhysicalRootHashHi = 0x22222222;
  current.shadow.observe(current.engine, ACTION.GO);
  assert.deepEqual(current.shadow.summary().comparisonRoots[0],
    { ...current.shadow.summary().comparisonRoots[0],
      hashLo: 0x11111111, hashHi: 0x22222222 });

  const stale = subject();
  stale.engine.diagnosticPhysicalRootFrame = 8;
  stale.engine.diagnosticPhysicalRootHashLo = 0x33333333;
  stale.engine.diagnosticPhysicalRootHashHi = 0x44444444;
  stale.shadow.observe(stale.engine, ACTION.GO);
  const comparison = stale.shadow.summary().comparisonRoots[0];
  assert.equal(comparison.hashLo, 0xabcdef01);
  assert.equal(comparison.hashHi, 0x10203040);
});

test("comparison roots preserve a fixed-pair depth ladder", () => {
  const { shadow, engine } = subject();
  shadow.depthStability = {
    lastComplete: Uint8Array.from([1, 1, 1, 1]),
    lastRelation: Uint8Array.from([2, 1, 1, 3]),
    lastBaselineValue: Int32Array.from([10, 20, 21, 30]),
    lastCandidateValue: Int32Array.from([10, 21, 22, 29]),
    lastBaselineNodes: Uint16Array.from([4, 8, 8, 16]),
    lastCandidateNodes: Uint16Array.from([5, 9, 9, 17]),
    lastBaselineReasonMask: Uint16Array.from([0, 0, 0, 160]),
    lastCandidateReasonMask: new Uint16Array(4),
    lastBaselineCompletedDepth: Uint8Array.from([1, 2, 2, 3]),
    lastCandidateCompletedDepth: Uint8Array.from([1, 2, 2, 3]),
    lastBaselineSupportDepth: Uint8Array.from([1, 2, 2, 2]),
    lastCandidateSupportDepth: Uint8Array.from([1, 2, 2, 3]),
    lastBaselineTruncatedCount: Uint8Array.from([0, 0, 0, 1]),
    lastCandidateTruncatedCount: new Uint8Array(4),
    lastBaselineIncompleteTransitions: Uint16Array.from([0, 0, 0, 2]),
    lastCandidateIncompleteTransitions: new Uint16Array(4),
    lastBaselineInterrupted: new Uint8Array(4),
    lastCandidateInterrupted: new Uint8Array(4),
    lastBaselineAbortReason: Uint8Array.from([0, 0, 0, 1]),
    lastCandidateAbortReason: new Uint8Array(4),
    evaluate() {}, totalHotAllocationCount() { return 0; },
    summary() { return { evaluationCount: 1 }; }
  };
  shadow.depthWidthStability = {
    lastComplete: Uint8Array.from([0, 1, 1, 1]),
    lastRelation: Uint8Array.from([0, 1, 2, 2]),
    lastBaselineValue: Int32Array.from([0, 40, 50, 60]),
    lastCandidateValue: Int32Array.from([0, 41, 50, 60]),
    lastBaselineNodes: Uint16Array.from([20, 30, 40, 50]),
    lastCandidateNodes: Uint16Array.from([0, 31, 41, 51]),
    lastBaselineReasonMask: Uint16Array.from([208, 0, 0, 0]),
    lastCandidateReasonMask: new Uint16Array(4),
    evaluate() {}, totalHotAllocationCount() { return 0; },
    summary() { return { evaluationCount: 1 }; }
  };
  shadow.observe(engine, ACTION.GO);
  const ladder = shadow.summary().comparisonRoots[0].depthLadder;
  assert.equal(ladder.length, 4);
  assert.deepEqual(ladder.map(item => [item.name, item.relation]),
    [["D1_B2048", 2], ["D2_B256", 1], ["D2_B2048", 1],
      ["D3_B2048", 3]]);
  assert.equal(ladder[3].candidateNodes, 17);
  assert.equal(ladder[3].baselineReasonMask, 160);
  assert.equal(ladder[3].baselineSupportDepth, 2);
  assert.equal(ladder[3].baselineIncompleteTransitions, 2);
  assert.equal(ladder[3].baselineAbortReason, 1);
  const width = shadow.summary().comparisonRoots[0].depthWidthLadder;
  assert.deepEqual(width.map(item => [item.name, item.relation]),
    [["D3_W2_B2048", 0], ["D3_W3_B2048", 1],
      ["D3_W4_B2048", 2], ["D3_W4_B4096", 2]]);
  assert.equal(width[0].baselineReasonMask, 208);
});

test("existing strict ATTACK execution prevents policy synthesis", () => {
  const { shadow, pose, policy, engine } = subject(1);
  shadow.observe(engine, ACTION.GO);
  assert.equal(shadow.summary().strictExecutionAvailableCount, 1);
  assert.equal(pose.calls, 0); assert.equal(policy.calls, 0);
});

test("common continuation option is forwarded to paired policy search", () => {
  const epoch = { activeGeneration: 4, activeKind: LONG_OPTION.ATTACK,
    activeTargetSignature: 0, activeTargetGeneration: 0, lastStatus: 2 };
  const coverage = { lastStrictMask: 0 };
  const shadow = new SemanticAttackPolicyIntervalShadow(epoch, coverage, {}, {
    depth: 2, nodeBudget: 128, commonContinuation: true
  });
  assert.equal(shadow.policy.commonContinuation, true);
  assert.equal(shadow.policy.feedback, null);
});
