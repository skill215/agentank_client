"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");

function frameMap(report) {
  const output = new Map();
  for (const result of report.results || []) for (const frame of result.frames || [])
    output.set(`${result.fingerprint}:${frame.frame}`, { result, frame });
  return output;
}

function loadArtifact(file, kind) {
  invariant(fs.existsSync(file), "FAST_REGRESSION_ARTIFACT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value) && value.artifactKind === kind,
    "FAST_REGRESSION_ARTIFACT_INVALID", file); return value;
}

function compareSafetyRepair(corpus, before, after) {
  invariant(corpus.source.reportFingerprint === before.fingerprint,
    "FAST_REGRESSION_SAFETY_BASELINE_MISMATCH", before.fingerprint);
  invariant(before.cohort.fingerprint === after.cohort.fingerprint &&
    corpus.source.cohortFingerprint === after.cohort.fingerprint,
  "FAST_REGRESSION_SAFETY_COHORT_MISMATCH", after.cohort.fingerprint);
  const beforeFrames = frameMap(before); const afterFrames = frameMap(after);
  const strict = []; const candidates = [];
  for (const defect of [...corpus.strict, ...corpus.continuationCandidates]) {
    const key = `${defect.capsuleFingerprint}:${defect.frame}`;
    const prior = beforeFrames.get(key); const current = afterFrames.get(key);
    invariant(prior && current, "FAST_REGRESSION_SAFETY_FRAME_MISSING", key);
    const comparison = { capsuleFingerprint: defect.capsuleFingerprint, frame: defect.frame,
      distanceToTerminal: defect.distanceToTerminal, before: prior.frame.modelClass,
      after: current.frame.modelClass, hard: current.frame.selectedCandidate?.hard,
      safety: current.frame.selectedCandidate?.safety,
      chanceSupportCount: current.frame.selectedCandidate?.chanceSupportCount || 0,
      chanceFatalSupportCount: current.frame.selectedCandidate?.chanceFatalSupportCount || 0 };
    (defect.defectClass === "STRICT_ONE_STEP_CONTRADICTION" ? strict : candidates).push(comparison);
  }
  const beforeSafe = new Set(); const afterSafe = new Set();
  for (const [key, value] of beforeFrames) if (value.frame.modelClass ===
    "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES") beforeSafe.add(key);
  for (const [key, value] of afterFrames) if (value.frame.modelClass ===
    "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES") afterSafe.add(key);
  const newSafeFatalFrames = [...afterSafe].filter(key => !beforeSafe.has(key));
  const checks = [
    { checkId: "STRICT_ONE_STEP_RECLASSIFIED", pass: strict.length > 0 && strict.every(item =>
      item.before === "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES" &&
      item.after === "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES") },
    { checkId: "STRICT_CHANCE_SUPPORT_PRESERVED_AS_RISK", pass: strict.every(item =>
      item.hard === "ALLOW" && item.safety === "POSSIBLE_DEATH" &&
      item.chanceSupportCount > item.chanceFatalSupportCount && item.chanceFatalSupportCount > 0) },
    { checkId: "ONE_STEP_FALSE_POSITIVE_ZERO", pass:
      after.primary.oneStepProvenSafeContradictions === 0 },
    { checkId: "NO_NEW_PROVEN_SAFE_FATAL_FRAME", pass: newSafeFatalFrames.length === 0 },
    { checkId: "EVENT_EXACT_REPLAY_ZERO", pass: after.primary.exactReplayFailures === 0 &&
      after.controls.exactReplayFailures === 0 },
    { checkId: "CONTROL_SURVIVAL_REGRESSION_ZERO", pass:
      after.controls.controlSurvivalRegressions === 0 },
    { checkId: "EXECUTION_FAILURE_ZERO", pass: after.execution.failures === 0 }
  ].map(item => ({ checkId: item.checkId, status: item.pass ? "PASS" : "FAIL" }));
  return { status: checks.every(item => item.status === "PASS") ? "ACCEPTED" : "REJECTED",
    checks, strict, candidates, delta: { provenSafeFatalFrames:
      after.primary.modelProvenSafeFixedContinuationFatalFrames -
      before.primary.modelProvenSafeFixedContinuationFatalFrames,
      actionReproductionFailures: after.primary.actionReproductionFailures -
        before.primary.actionReproductionFailures, newSafeFatalFrames } };
}

function findReport(store, fingerprint) {
  for (const name of fs.readdirSync(store.paths.reports)) {
    const file = path.join(store.paths.reports, name, `${fingerprint}.json`);
    if (fs.existsSync(file)) return file;
  }
  throw Object.assign(new Error(`report not found: ${fingerprint}`),
    { code: "FAST_REGRESSION_REPORT_NOT_FOUND" });
}

function verifySafetyRepair(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const corpusFile = options.corpusPath ? path.resolve(workspaceRoot, options.corpusPath) :
    path.join(store.paths.root, "defect-corpora", "safety-v1", "latest.json");
  const corpus = loadArtifact(corpusFile, "FAST_REGRESSION_SAFETY_DEFECT_CORPUS");
  const before = loadArtifact(findReport(store, corpus.source.reportFingerprint),
    "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const afterName = String(options.reportName || "native-poison-death-safety-chance");
  const afterFile = options.reportPath ? path.resolve(workspaceRoot, options.reportPath) :
    path.join(store.paths.reports, afterName, "latest.json");
  const after = loadArtifact(afterFile, "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const comparison = compareSafetyRepair(corpus, before, after);
  const report = { artifactKind: "FAST_REGRESSION_SAFETY_REPAIR_VERIFICATION",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND"],
    status: comparison.status, source: { corpusFingerprint: corpus.fingerprint,
      beforeReportFingerprint: before.fingerprint, afterReportFingerprint: after.fingerprint,
      cohortFingerprint: after.cohort.fingerprint,
      beforeSourceSha256: before.execution.workingSourceSha256,
      afterSourceSha256: after.execution.workingSourceSha256 }, ...comparison };
  return store.writeReport(report, options.outputName || "safety-repair-verification");
}

module.exports = { frameMap, compareSafetyRepair, verifySafetyRepair };
