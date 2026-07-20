"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareObservationFrontier } = require(
  "../../tools/agentank/fast-regression/observation-frontier-verification");
const { selectedRootAudit } = require("../../tools/agentank/fast-regression/verify");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");

function fixtures(overrides = {}) {
  const focused = { fingerprint: "focused", status: "COMPLETED",
    execution: { executionLane: "FULL_FOCUSED", requested: 1, completed: 1,
      failures: 0, workingSourceSha256: "source" }, primary: {}, controls: {},
    results: [{ fingerprint: "capsule", frames: [{ frame: 4,
      modelClass: "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES",
      selectedCandidate: { safety: "PROVEN_SAFE" }, rootDiagnostics: {
        observationSafetyStatus: 1, observationSafetyNodes: 7,
        observationSafetyGroups: 2, observationSafetyIncomplete: 0,
        observationSafetyRootRestoreFailures: overrides.rootRestoreFailures || 0 } }] }] };
  const capability = { status: "ACCEPTED", source: { afterReportFingerprint: "focused" },
    checks: [{ status: "PASS" }], delta: { remainingAuditedSafe: ["capsule:4"] } };
  const sr2 = { status: "ACCEPTED", regression: { fail: 0 }, benchmark: {
    status: "PASS", p95Micros: 2000, p95LimitMicros: 3000, hotAllocationCount: 0 } };
  const imp6 = { status: "PASS", checks: [
    { checkId: "LOCAL_CAPACITY_GATES", status: "PASS" },
    { checkId: "DETERMINISTIC_BUILD", status: "PASS" }] };
  const build = { fingerprint: "build", sourceHash: "source-build", minifiedHash: "min",
    sourceBytes: 10, minifiedBytes: 5, memory: { productionRootBytes:
      overrides.bytes || 900000, totalTypedArrayBytes: overrides.bytes || 900000 },
    differential: { status: "PASS", mismatchCount: 0 },
    sandbox: { mathImulAvailable: false } };
  return { capability, focused, sr2, imp6, build };
}

test("observation frontier verification binds physical witness restore performance and build gates", () => {
  const f = fixtures(); const result = compareObservationFrontier(f.capability,
    f.focused, f.sr2, f.imp6, f.build, "source");
  assert.equal(result.status, "ACCEPTED");
  assert.ok(result.checks.every(item => item.status === "PASS"));
  assert.equal(result.counters.executedFrames, 1);
  assert.equal(result.counters.rootRestoreFailures, 0);
});

test("observation frontier verification rejects restore failure and capacity overflow", () => {
  const f = fixtures({ rootRestoreFailures: 1, bytes: 1000001 });
  const result = compareObservationFrontier(f.capability, f.focused,
    f.sr2, f.imp6, f.build, "source");
  assert.equal(result.status, "REJECTED");
  assert.equal(result.checks.find(item => item.checkId ===
    "OBSERVATION_FRONTIER_ROOT_RESTORE_ZERO").status, "FAIL");
  assert.equal(result.checks.find(item => item.checkId ===
    "PRODUCTION_BUILD_LOCAL_CAPACITY").status, "FAIL");
});

test("historical full-regression audit includes ObservationSafetyFrontier restore failures", () => {
  const engine = { ourCount: 1, ourActions: new Uint8Array([ACTION.GO]),
    hardStatus: new Uint8Array([HARD_STATUS.ALLOW]), riskController: { outcome: {
      count: 1, dominated: new Uint8Array(1) } }, lastProofStatus: PROOF_STATUS.UNKNOWN,
    adapter: { informationComplete: true }, depthSearch: { rootRestoreFailures: 1,
      completedDepth: 1, nodes: 2 }, informationSearch: { rootRestoreFailures: 2,
      completedDepth: 2, nodes: 3 }, forcedWinSearch: { rootRestoreFailures: 4 },
    observationSafety: { rootRestoreFailures: 8, lastStatus: 0, nodes: 5,
      incompleteCount: 1, capacityStops: 0, budgetStops: 1 }, runtime: { runtimeMode: 0 } };
  const audit = selectedRootAudit(engine, ACTION.GO);
  assert.equal(audit.rootRestoreFailures, 15);
  assert.deepEqual(audit.observationSafety, { status: 0, nodes: 5, incomplete: 1,
    capacityStops: 0, budgetStops: 1, rootRestoreFailures: 8 });
});
