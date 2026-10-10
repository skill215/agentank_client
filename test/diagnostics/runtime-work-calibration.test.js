"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveCalibration } =
  require("../../tools/agentank/benchmark/runtime-work-calibration");
const { WORK_KIND } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { RUNTIME_CONFIG } = require("../../engine-v2/src/generated/runtime-config");

function batch() {
  return { summaries: { CURRENT: { matches: 2, totalRuntimeMicros: 10000,
    phaseTiming: { matrixIterations: 100, exclusiveMicros: {
      OBSERVATION: 1000, NAVIGATION: 10, HIDDEN_RISK: 10, FINAL_HARD: 100,
      SAFETY_CLOSURE: 10, COMMITTED_EO: 10, INFORMATION_OVERLAY: 10,
      STAGE_MATRIX: 100, PLAN_SKETCH: 100, MULTI_FRAME_RISK: 100,
      COMBAT_VECTOR: 100, PROJECTILE_ATTACK: 100, STRATEGY_EVIDENCE: 100,
      FAST_APPLY: 300, HARD_CLASSIFY: 100, REVERSE_VIABILITY: 1000,
      OBSERVATION_SAFETY: 100, FORCED_WIN: 100, PHYSICAL_SEARCH: 100,
      INFORMATION_SEARCH: 100, INFO_CONTINUATION: 100, DEPTH_HEURISTIC: 100,
      MATRIX_SOLVER: 200, FINAL_SELECTION: 100 }, micros: {
      OBSERVATION_SAFETY: 200, FORCED_WIN: 200 }, calls: {
      OBSERVATION: 100, FAST_APPLY: 100, HARD_CLASSIFY: 100 } },
    workLedger: { units: {
      FEATURE_PLAN: RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.FEATURE_PLAN] * 100,
      PROOF_NODE: RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.PROOF_NODE] * 10,
      EMITTER: RUNTIME_CONFIG.WORK_CHARGES[WORK_KIND.EMITTER] * 100 }, calls: {} },
    runtimeSchedule: { searchNodes: 100, observationSafetyAudits: 10,
      forcedWinSearchNodes: 10, rootActionTotal: 100 },
    reverseViabilityCache: { latticeHits: 50, latticeMisses: 10 },
    invariants: { avoidableHardReject: 0, riskDominatedSelection: 0,
      rootRestoreFailure: 0, hotAllocation: 0 } } } };
}

test("HP9 derives deterministic positive integer work charges from five batches", () => {
  const result = deriveCalibration([batch(), batch(), batch(), batch(), batch()]);
  assert.equal(result.status, "PASS");
  assert.equal(result.aggregate.batches, 5);
  assert.equal(result.derived.workCharges.length, WORK_KIND.COUNT);
  for (const charge of result.derived.workCharges)
    assert.ok(Number.isSafeInteger(charge) && charge > 0);
  assert.ok(result.derived.workCharges[WORK_KIND.HARD] >
    result.derived.workCharges[WORK_KIND.CACHE]);
  assert.ok(result.derived.fixedLongGameUnits < result.derived.thresholds.degraded);
  assert.equal(result.derived.releaseCalibrated, false);
});

test("HP9 rejects fewer than five measured batches", () => {
  assert.throws(() => deriveCalibration([batch(), batch(), batch(), batch()]),
    /HP9_CALIBRATION_BATCHES/);
});
