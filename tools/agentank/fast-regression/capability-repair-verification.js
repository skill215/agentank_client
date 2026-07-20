"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");
const { frameMap } = require("./safety-repair-verification");

const FALSE_SAFE = "CONFIRMED_FALSE_PROVEN_SAFE";
const SAFE_WITNESS = "OBSERVATION_CONSISTENT_WINDOW_WITNESS";
const MODEL_SAFE_FATAL = "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES";

function loadArtifact(file, kind) {
  invariant(fs.existsSync(file), "FAST_REGRESSION_ARTIFACT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value) && value.artifactKind === kind,
    "FAST_REGRESSION_ARTIFACT_INVALID", file);
  return value;
}

function caseKey(item) { return `${item.capsuleFingerprint}:${item.frame}`; }

function compareCapabilityRepair(classification, before, after) {
  invariant(classification.source.focusedReportFingerprint === before.fingerprint,
    "FAST_REGRESSION_CAPABILITY_BASELINE_MISMATCH", before.fingerprint);
  invariant(classification.source.cohortFingerprint === before.cohort.fingerprint &&
    before.cohort.fingerprint === after.cohort.fingerprint,
  "FAST_REGRESSION_CAPABILITY_COHORT_MISMATCH", after.cohort.fingerprint);

  const beforeFrames = frameMap(before); const afterFrames = frameMap(after);
  const confirmed = []; const witnesses = [];
  for (const classified of classification.results || []) {
    const key = caseKey(classified); const prior = beforeFrames.get(key);
    const current = afterFrames.get(key);
    invariant(prior && current, "FAST_REGRESSION_CAPABILITY_FRAME_MISSING", key);
    const candidate = current.frame.selectedCandidate || {};
    const diagnostics = current.frame.rootDiagnostics || {};
    const item = { capsuleFingerprint: classified.capsuleFingerprint,
      frame: classified.frame, verdict: classified.verdict,
      before: prior.frame.modelClass, after: current.frame.modelClass,
      hard: candidate.hard, safety: candidate.safety,
      immediateFatalMass: candidate.immediateFatalMass || 0,
      horizonFatalMass: candidate.horizonFatalMass || 0,
      unknownMass: candidate.unknownMass || 0,
      futureFireDepth: candidate.futureFireDepth ?? 255,
      capabilitySupportComplete: diagnostics.enemyCapabilitySupportComplete !== false,
      futureEnemyFireSupport: diagnostics.futureEnemyFireSupport === true };
    if (classified.verdict === FALSE_SAFE) confirmed.push(item);
    else if (classified.verdict === SAFE_WITNESS) witnesses.push(item);
    else invariant(false, "FAST_REGRESSION_CAPABILITY_VERDICT_UNSUPPORTED", classified.verdict);
  }

  const beforeSafe = new Set(); const afterSafe = new Set();
  for (const [key, value] of beforeFrames)
    if (value.frame.modelClass === MODEL_SAFE_FATAL) beforeSafe.add(key);
  for (const [key, value] of afterFrames)
    if (value.frame.modelClass === MODEL_SAFE_FATAL) afterSafe.add(key);
  const classifiedKeys = new Set((classification.results || []).map(caseKey));
  const witnessKeys = new Set((classification.results || [])
    .filter(item => item.verdict === SAFE_WITNESS).map(caseKey));
  const newSafeFatalFrames = [...afterSafe].filter(key => !beforeSafe.has(key));
  const remainingAuditedSafe = [...afterSafe].filter(key => classifiedKeys.has(key));

  const checks = [
    { checkId: "CONFIRMED_DENOMINATOR_PRESERVED", pass:
      confirmed.length === classification.counts.confirmedFalseProvenSafe },
    { checkId: "CONFIRMED_FALSE_SAFE_ZERO", pass: confirmed.length > 0 &&
      confirmed.every(item => item.before === MODEL_SAFE_FATAL &&
        item.after !== MODEL_SAFE_FATAL && item.safety !== "PROVEN_SAFE") },
    { checkId: "CONFIRMED_REMAINS_SAFETY_NOT_HARD", pass:
      confirmed.every(item => item.hard === "ALLOW") },
    { checkId: "FUTURE_FIRE_CAPABILITY_AUDITED", pass: confirmed.every(item =>
      item.futureEnemyFireSupport && item.futureFireDepth >= 1 && item.futureFireDepth <= 4) },
    { checkId: "COMPLETE_CAPABILITY_HAS_FATAL_MASS", pass: confirmed
      .filter(item => item.capabilitySupportComplete).every(item =>
        item.immediateFatalMass + item.horizonFatalMass > 0) },
    { checkId: "INCOMPLETE_CAPABILITY_REMAINS_UNKNOWN", pass: confirmed
      .filter(item => !item.capabilitySupportComplete).every(item => item.unknownMass > 0) },
    { checkId: "PHYSICAL_WITNESSES_NOT_PROVEN_DEAD", pass: witnesses.length > 0 &&
      witnesses.every(item => item.hard === "ALLOW" && item.safety !== "PROVEN_DEAD" &&
        !item.after.startsWith("MODEL_UNKNOWN_OR_DEAD")) },
    { checkId: "REMAINING_AUDITED_SAFE_HAS_PHYSICAL_WITNESS", pass:
      remainingAuditedSafe.every(key => witnessKeys.has(key)) },
    { checkId: "NO_NEW_PROVEN_SAFE_FATAL_FRAME", pass: newSafeFatalFrames.length === 0 },
    { checkId: "ONE_STEP_FALSE_POSITIVE_ZERO", pass:
      after.primary.oneStepProvenSafeContradictions === 0 },
    { checkId: "EVENT_EXACT_REPLAY_ZERO", pass: after.primary.exactReplayFailures === 0 &&
      after.controls.exactReplayFailures === 0 },
    { checkId: "CONTROL_SURVIVAL_REGRESSION_ZERO", pass:
      after.controls.controlSurvivalRegressions === 0 },
    { checkId: "EXECUTION_FAILURE_ZERO", pass: after.execution.failures === 0 }
  ].map(item => ({ checkId: item.checkId, status: item.pass ? "PASS" : "FAIL" }));

  return { status: checks.every(item => item.status === "PASS") ? "ACCEPTED" : "REJECTED",
    checks, confirmed, witnesses, delta: {
      provenSafeFatalFrames: after.primary.modelProvenSafeFixedContinuationFatalFrames -
        before.primary.modelProvenSafeFixedContinuationFatalFrames,
      remainingAuditedSafe, newSafeFatalFrames,
      actionReproductionFailures: after.primary.actionReproductionFailures -
        before.primary.actionReproductionFailures } };
}

function verifyCapabilityRepair(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const classificationFile = options.classificationPath ?
    path.resolve(workspaceRoot, options.classificationPath) :
    path.join(store.paths.reports, String(options.classificationName ||
      "physical-safety-oracle"), "latest.json");
  const classification = loadArtifact(classificationFile,
    "FAST_REGRESSION_PHYSICAL_SAFETY_CLASSIFICATION");
  const beforeFile = path.join(store.paths.reports, String(options.beforeName ||
    "native-poison-death-safety-chance"), "latest.json");
  const afterFile = options.reportPath ? path.resolve(workspaceRoot, options.reportPath) :
    path.join(store.paths.reports, String(options.reportName ||
      "native-poison-death-capability-timeline"), "latest.json");
  const before = loadArtifact(beforeFile, "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const after = loadArtifact(afterFile, "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC");
  const comparison = compareCapabilityRepair(classification, before, after);
  const report = { artifactKind: "FAST_REGRESSION_CAPABILITY_REPAIR_VERIFICATION",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND"],
    status: comparison.status, source: {
      classificationFingerprint: classification.fingerprint,
      beforeReportFingerprint: before.fingerprint,
      afterReportFingerprint: after.fingerprint,
      cohortFingerprint: after.cohort.fingerprint,
      beforeSourceSha256: before.execution.workingSourceSha256,
      afterSourceSha256: after.execution.workingSourceSha256 }, ...comparison };
  return store.writeReport(report, options.outputName || "capability-repair-verification");
}

module.exports = { compareCapabilityRepair, verifyCapabilityRepair };
