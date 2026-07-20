"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { FastRegressionStore } = require("./artifact-store");
const { frameMap } = require("./safety-repair-verification");

const MODEL_SAFE_FATAL = "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES";
const WINDOW_SAFE = 1;

function loadArtifact(file, kind) {
  invariant(fs.existsSync(file), "FAST_REGRESSION_ARTIFACT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value) &&
    (!kind || value.artifactKind === kind), "FAST_REGRESSION_ARTIFACT_INVALID", file);
  return value;
}

function frontierCounters(focused) {
  const output = { entries: 0, frames: 0, executedFrames: 0, nodes: 0,
    groups: 0, incomplete: 0, rootRestoreFailures: 0, statuses: {} };
  for (const result of focused.results || []) {
    output.entries += 1;
    for (const frame of result.frames || []) {
      output.frames += 1; const diagnostics = frame.rootDiagnostics || {};
      const nodes = diagnostics.observationSafetyNodes || 0;
      const status = diagnostics.observationSafetyStatus || 0;
      if (nodes > 0) output.executedFrames += 1;
      output.nodes += nodes; output.groups += diagnostics.observationSafetyGroups || 0;
      output.incomplete += diagnostics.observationSafetyIncomplete || 0;
      output.rootRestoreFailures += diagnostics.observationSafetyRootRestoreFailures || 0;
      output.statuses[status] = (output.statuses[status] || 0) + 1;
    }
  }
  return output;
}

function compareObservationFrontier(capability, focused, sr2, imp6, build,
    workingSourceSha256) {
  invariant(capability.source.afterReportFingerprint === focused.fingerprint,
    "OBSERVATION_FRONTIER_FOCUSED_BINDING_MISMATCH", focused.fingerprint);
  const counters = frontierCounters(focused); const frames = frameMap(focused);
  const remaining = capability.delta.remainingAuditedSafe || [];
  const remainingWitnesses = remaining.map(key => {
    const current = frames.get(key); invariant(current,
      "OBSERVATION_FRONTIER_REMAINING_FRAME_MISSING", key);
    const diagnostics = current.frame.rootDiagnostics || {};
    return { key, modelClass: current.frame.modelClass,
      safety: current.frame.selectedCandidate?.safety,
      frontierStatus: diagnostics.observationSafetyStatus || 0,
      frontierNodes: diagnostics.observationSafetyNodes || 0,
      rootRestoreFailures: diagnostics.observationSafetyRootRestoreFailures || 0 };
  });
  const localCapacity = (imp6.checks || []).find(item =>
    item.checkId === "LOCAL_CAPACITY_GATES");
  const deterministicBuild = (imp6.checks || []).find(item =>
    item.checkId === "DETERMINISTIC_BUILD");
  const checks = [
    { checkId: "CAPABILITY_REPAIR_ACCEPTED", pass: capability.status === "ACCEPTED" &&
      capability.checks.every(item => item.status === "PASS") },
    { checkId: "FULL_FOCUSED_DIAGNOSTIC_COMPLETE", pass:
      focused.status === "COMPLETED" && focused.execution.executionLane === "FULL_FOCUSED" &&
      focused.execution.requested === focused.execution.completed && focused.execution.failures === 0 &&
      counters.entries === focused.execution.completed },
    { checkId: "OBSERVATION_FRONTIER_EXECUTED", pass:
      counters.executedFrames > 0 && counters.nodes >= counters.executedFrames },
    { checkId: "OBSERVATION_FRONTIER_ROOT_RESTORE_ZERO", pass:
      counters.rootRestoreFailures === 0 },
    { checkId: "REMAINING_SAFE_IS_PHYSICAL_FRONTIER_WITNESS", pass:
      remainingWitnesses.length > 0 && remainingWitnesses.every(item =>
        item.modelClass === MODEL_SAFE_FATAL && item.safety === "PROVEN_SAFE" &&
        item.frontierStatus === WINDOW_SAFE && item.frontierNodes > 0 &&
        item.rootRestoreFailures === 0) },
    { checkId: "SR2_FRONTIER_TEST_AND_PERFORMANCE_GATE", pass: sr2.status === "ACCEPTED" &&
      sr2.regression?.fail === 0 && sr2.benchmark?.status === "PASS" &&
      sr2.benchmark?.p95Micros <= sr2.benchmark?.p95LimitMicros &&
      sr2.benchmark?.hotAllocationCount === 0 },
    { checkId: "PRODUCTION_BUILD_LOCAL_CAPACITY", pass: imp6.status === "PASS" &&
      localCapacity?.status === "PASS" && build.memory?.totalTypedArrayBytes <= 1000000 &&
      build.memory?.productionRootBytes === build.memory?.totalTypedArrayBytes },
    { checkId: "SOURCE_MINIFIED_DETERMINISTIC", pass:
      deterministicBuild?.status === "PASS" && build.differential?.status === "PASS" &&
      build.differential?.mismatchCount === 0 && build.sandbox?.mathImulAvailable === false },
    { checkId: "WORKING_SOURCE_IDENTITY_BOUND", pass:
      focused.execution.workingSourceSha256 === workingSourceSha256 }
  ].map(item => ({ checkId: item.checkId, status: item.pass ? "PASS" : "FAIL" }));
  return { status: checks.every(item => item.status === "PASS") ? "ACCEPTED" : "REJECTED",
    checks, counters, remainingWitnesses, capacity: {
      productionRootBytes: build.memory?.productionRootBytes,
      maximumBytes: 1000000, sourceBytes: build.sourceBytes,
      minifiedBytes: build.minifiedBytes }, buildIdentity: {
      sourceHash: build.sourceHash, minifiedHash: build.minifiedHash,
      manifestFingerprint: build.fingerprint } };
}

function verifyObservationFrontier(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const reportFile = options.reportPath ? path.resolve(workspaceRoot, options.reportPath) :
    path.join(store.paths.reports, String(options.reportName ||
      "native-poison-death-observation-frontier"), "latest.json");
  const capabilityFile = options.capabilityPath ? path.resolve(workspaceRoot,
    options.capabilityPath) : path.join(store.paths.reports, String(options.capabilityName ||
      "observation-frontier-verification"), "latest.json");
  const sr2File = path.resolve(workspaceRoot, options.sr2Path ||
    "artifacts/reports/structural-repair/SR2/sr2-gate-report.json");
  const imp6File = path.resolve(workspaceRoot, options.imp6Path ||
    "artifacts/reports/imp6/imp6-gate-report.json");
  const buildFile = path.resolve(workspaceRoot, options.buildPath ||
    "artifacts/build/imp6/build-manifest.json");
  const focused = loadArtifact(reportFile,
    "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const capability = loadArtifact(capabilityFile,
    "FAST_REGRESSION_CAPABILITY_REPAIR_VERIFICATION");
  const sr2 = loadArtifact(sr2File);
  invariant(sr2.reportKind === "STRUCTURAL_REPAIR_GATE" && sr2.stageId === "SR2",
    "OBSERVATION_FRONTIER_SR2_GATE_INVALID", sr2File);
  const imp6 = loadArtifact(imp6File);
  const build = loadArtifact(buildFile);
  const working = sourceIdentity(workspaceRoot);
  const comparison = compareObservationFrontier(capability, focused, sr2, imp6,
    build, working.sha256);
  const report = { artifactKind: "FAST_REGRESSION_OBSERVATION_FRONTIER_VERIFICATION",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND",
      "BUILD_BOUND", "PERFORMANCE_BOUND"], source: {
      focusedFingerprint: focused.fingerprint, capabilityFingerprint: capability.fingerprint,
      sr2Fingerprint: sr2.fingerprint, imp6Fingerprint: imp6.fingerprint,
      buildFingerprint: build.fingerprint, workingSourceSha256: working.sha256,
      cohortFingerprint: focused.cohort.fingerprint }, ...comparison };
  return store.writeReport(report, options.outputName ||
    "observation-safety-frontier-verification");
}

module.exports = { frontierCounters, compareObservationFrontier,
  verifyObservationFrontier };
