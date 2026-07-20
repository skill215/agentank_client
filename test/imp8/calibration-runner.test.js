"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { imp8CalibrationEvidence } = require("./helpers");
const { defaultWorkspaceRoot, contained } = require("../../tools/agentank/core/paths");
const { validateSchemaFile } = require("../../tools/agentank/core/schema-validator");
const { assertCalibrationOutput } = require("../../tools/agentank/calibration/imp8-runner");

test("calibration suite is schema-valid and cannot write into Frozen", () => {
  const root = defaultWorkspaceRoot(); const suiteFile = contained(root,
    "config", "engine-v2", "imp8-calibration-suite.json");
  assert.equal(validateSchemaFile("imp8-calibration-suite", suiteFile, root).lane, "CALIBRATION");
  const plan = JSON.parse(fs.readFileSync(contained(root, "config", "engine-v2",
    "imp8-calibration-plan.json"), "utf8"));
  assert.throws(() => assertCalibrationOutput(root, plan, contained(root, plan.lanes.frozen,
    "illegal-calibration")), { code: "IMP8_CALIBRATION_FROZEN_WRITE_FORBIDDEN" });
});

test("five local benchmark layers and source-minified differential pass in Calibration", async () => {
  const { report, reportFile } = await imp8CalibrationEvidence();
  assert.equal(report.status, "PASS"); assert.equal(report.calibrationStatus, "MEASURED_NOT_SELECTED");
  assert.deepEqual(report.baseline.localLayerStatuses, ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(report.baseline.platformStatus, "BLOCKED");
  assert.equal(report.baseline.sourceMinifiedMismatches, 0);
  assert.match(report.baseline.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(report.baseline.minifiedSha256, /^[0-9a-f]{64}$/);
  assert.match(path.relative(defaultWorkspaceRoot(), reportFile),
    /^artifacts[\\/]imp8[\\/]calibration[\\/]/);
});

test("depth-cache matrix covers every preregistered candidate with root-safe fixed-array search", async () => {
  const { report } = await imp8CalibrationEvidence(); const matrix = report.candidateMatrix;
  assert.equal(matrix.length, 4 * 3 * 2); assert.ok(matrix.every(item => item.scenarioCount === 4));
  assert.ok(matrix.every(item => item.sampleCount === 12));
  assert.ok(matrix.every(item => item.completedDepthMin > 0 && item.completedDepthMax <= item.depth));
  assert.ok(matrix.every(item => item.rootRestoreFailures === 0 && item.hotAllocations === 0));
  assert.equal(new Set(matrix.map(item => item.strictFingerprint)).size, 1);
  assert.ok(matrix.filter(item => item.cacheMode === "ON").some(item => item.cacheHits > 0));
  assert.ok(matrix.filter(item => item.cacheMode === "OFF").every(item =>
    item.cacheHits === 0 && item.cacheWrites === 0));
});

test("cache on-off production audit preserves action Hard and strict Proof across all scenarios", async () => {
  const { report } = await imp8CalibrationEvidence(); const audit = report.productionCacheAudit;
  assert.equal(audit.length, 4); assert.ok(audit.every(item => item.offCacheHits === 0));
  assert.ok(audit.some(item => item.onCacheHits > 0));
  assert.ok(audit.every(item => item.actionMismatch === 0 && item.hardMismatch === 0 &&
    item.proofMismatch === 0 && item.rootRestoreFailures === 0));
  assert.deepEqual(report.invariants, { rootRestoreFailures: 0, hotAllocations: 0,
    cacheActionMismatches: 0, cacheHardMismatches: 0, cacheProofMismatches: 0,
    sourceMinifiedMismatches: 0, frozenInputCount: 0, configMutationCount: 0,
    allZeroTolerancePass: true });
});

test("measurement cannot select or apply parameters before a gameplay quality oracle exists", async () => {
  const { report } = await imp8CalibrationEvidence(); assert.equal(report.selection.status,
    "PENDING_QUALITY_ORACLE"); assert.equal(report.selection.recommendedCandidateId, null);
  assert.equal(report.selection.applied, false);
  assert.deepEqual(report.selection.measuredDimensions, ["depth", "cache"]);
  assert.deepEqual(report.selection.deferredDimensions, ["risk", "weights", "arena"]);
  assert.match(report.selection.reason, /replay or arena outcome quality/);
});
