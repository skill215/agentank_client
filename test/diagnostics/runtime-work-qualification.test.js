"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { median, compactSchedule, qualify } =
  require("../../tools/agentank/benchmark/runtime-work-qualification");

function input(name, { frames = 10, nodes = 100, fallback = 20, emergency = 40,
  runtime = 1000, p95 = 100, depth = 2, invariant = 0 } = {}) {
  return { file: name, sha256: name, document: { summaries: { CURRENT: {
    matches: 2, runtimeModeCounts: { 0: 10 }, totalRuntimeMicros: runtime,
    p95RuntimeMicrosMax: p95,
    phaseTiming: { calls: { OBSERVATION: 20 } },
    runtimeSchedule: { firstModeFrames: [[0, 0], [10, 10], [fallback, fallback],
      [emergency, emergency]], searchFrames: frames, searchNodes: nodes,
    completedDepthCounts: Array.from({ length: depth + 1 }, (_, index) =>
      index === depth ? frames : 0) },
    invariants: { avoidableHardReject: invariant, riskDominatedSelection: 0,
      rootRestoreFailure: 0, hotAllocation: 0 }
  } } } };
}

test("HP9 runtime qualification computes stable upper median and complete iterations", () => {
  assert.equal(median([9, 1, 5, 3]), 5);
  const summary = compactSchedule(input("candidate"));
  assert.equal(summary.completeIterationBasisPoints, 10000);
  assert.equal(summary.firstFallbackMedian, 20);
});

test("HP9 local qualification requires later fallback, more search, and zero invariants", () => {
  const calibration = { file: "calibration", sha256: "calibration", document: {
    status: "PASS", fingerprint: "fingerprint", derived: { workCharges: [1],
      fixedLongGameUnits: 100, thresholds: { degraded: 1000 } } } };
  const result = qualify({ calibration,
    baseline: input("baseline", { frames: 10, nodes: 100, fallback: 15, emergency: 30 }),
    development: input("development", { frames: 40, nodes: 400, fallback: 35,
      emergency: 80, runtime: 1050, p95: 105 }),
    support: input("support", { frames: 80, nodes: 800 }),
    validation: input("validation", { frames: 160, nodes: 1600 }) });
  assert.equal(result.status, "PASS_LOCAL");
  assert.equal(result.releaseCalibrated, false);
  assert.equal(result.deltas.searchNodesBasisPoints, 40000);
});

test("HP9 local qualification fails closed on incomplete iterations", () => {
  const calibration = { file: "calibration", sha256: "calibration", document: {
    status: "PASS", fingerprint: "fingerprint", derived: { workCharges: [1],
      fixedLongGameUnits: 100, thresholds: { degraded: 1000 } } } };
  const validation = input("validation", { frames: 10, nodes: 100 });
  validation.document.summaries.CURRENT.runtimeSchedule.completedDepthCounts[2] = 9;
  const result = qualify({ calibration, baseline: input("baseline", { frames: 1, nodes: 1,
    fallback: 1, emergency: 1 }), development: input("development"),
  support: input("support"), validation });
  assert.equal(result.status, "FAIL");
  assert.equal(result.checks.validationIterationsComplete, false);
});
