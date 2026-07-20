"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");
const { analyzeReport } = require("./dominated-rescue-analysis");

const DIAGNOSTIC_KIND = "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC";
const VERIFICATION_KIND = "FAST_REGRESSION_VERIFICATION_REPORT";

function increment(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }

function loadArtifact(file, expectedKind) {
  invariant(fs.existsSync(file), "FAST_REGRESSION_ARTIFACT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.artifactKind === expectedKind,
    "FAST_REGRESSION_ARTIFACT_KIND_INVALID", `${file}:${value.artifactKind}`);
  invariant(value.fingerprint === fingerprintObject(value),
    "FAST_REGRESSION_ARTIFACT_FINGERPRINT_INVALID", file);
  return value;
}

function reportFile(store, reference, fallbackName) {
  const value = String(reference || fallbackName || "");
  const direct = path.resolve(store.workspaceRoot, value);
  if (reference && fs.existsSync(direct)) return direct;
  return path.join(store.paths.reports, value, "latest.json");
}

function frameKey(result, frame) {
  return `${result.role}|${result.matchId}|${result.fingerprint}|${frame.frame}`;
}

function indexedFrames(report) {
  const frames = new Map();
  for (const result of report.results || []) for (const frame of result.frames || []) {
    const key = frameKey(result, frame);
    invariant(!frames.has(key), "FAST_REGRESSION_COMPARISON_DUPLICATE_FRAME", key);
    frames.set(key, { result, frame });
  }
  return frames;
}

function survives(frame) { return frame.currentSelectedDies === false; }

function riskTuple(candidate) {
  return {
    safety: candidate?.safety || "UNKNOWN",
    immediateFatalMass: candidate?.immediateFatalMass ?? null,
    horizonFatalMass: candidate?.horizonFatalMass ?? null,
    unknownMass: candidate?.unknownMass ?? null,
    earliestFatalFrame: candidate?.earliestFatalFrame ?? null,
    escapeSlack: candidate?.escapeSlack ?? null,
    robustLower: candidate?.robustLower ?? null,
    acceptable: candidate?.acceptable ?? null,
    dominated: candidate?.dominated ?? null
  };
}

function transitionName(beforeSurvives, afterSurvives) {
  return `${beforeSurvives ? "SURVIVE" : "DIE"}_TO_${afterSurvives ? "SURVIVE" : "DIE"}`;
}

function roleSummary() {
  return { frames: 0, beforeSurvivors: 0, afterSurvivors: 0, dieToSurvive: 0,
    surviveToDie: 0, surviveToSurvive: 0, dieToDie: 0, netSurvivors: 0 };
}

function compareFocusedReports(before, after) {
  invariant(before.cohort?.fingerprint === after.cohort?.fingerprint,
    "FAST_REGRESSION_COMPARISON_COHORT_MISMATCH",
    `${before.cohort?.fingerprint}:${after.cohort?.fingerprint}`);
  const beforeFrames = indexedFrames(before); const afterFrames = indexedFrames(after);
  invariant(beforeFrames.size === afterFrames.size,
    "FAST_REGRESSION_COMPARISON_DENOMINATOR_MISMATCH",
    `${beforeFrames.size}:${afterFrames.size}`);

  const byRole = {}; const transitions = []; const changedActions = {};
  for (const [key, prior] of beforeFrames) {
    const current = afterFrames.get(key);
    invariant(current, "FAST_REGRESSION_COMPARISON_FRAME_MISSING", key);
    const role = prior.result.role; const summary = byRole[role] ||= roleSummary();
    const beforeSurvives = survives(prior.frame); const afterSurvives = survives(current.frame);
    summary.frames += 1; summary.beforeSurvivors += beforeSurvives ? 1 : 0;
    summary.afterSurvivors += afterSurvives ? 1 : 0;
    const transition = transitionName(beforeSurvives, afterSurvives);
    if (transition === "DIE_TO_SURVIVE") summary.dieToSurvive += 1;
    else if (transition === "SURVIVE_TO_DIE") summary.surviveToDie += 1;
    else if (transition === "SURVIVE_TO_SURVIVE") summary.surviveToSurvive += 1;
    else summary.dieToDie += 1;
    if (beforeSurvives === afterSurvives) continue;
    const actionChange = `${prior.frame.currentSelectedAction}->${current.frame.currentSelectedAction}`;
    increment(changedActions, `${transition}:${actionChange}`);
    const diagnostics = current.frame.rootDiagnostics || {};
    transitions.push({ transition, role, capsuleFingerprint: current.result.fingerprint,
      matchId: current.result.matchId, frame: current.frame.frame,
      distanceToTerminal: current.frame.distanceToTerminal,
      beforeAction: prior.frame.currentSelectedAction,
      afterAction: current.frame.currentSelectedAction,
      beforeRisk: riskTuple(prior.frame.currentSelectedCandidate),
      afterRisk: riskTuple(current.frame.currentSelectedCandidate),
      hiddenWorldCount: diagnostics.hiddenWorldCount || 0,
      possibleProjectileCount: diagnostics.possibleProjectileCount || 0,
      committedProjectileCount: diagnostics.committedProjectileCount || 0,
      committedBombCount: diagnostics.committedBombCount || 0 });
  }
  for (const summary of Object.values(byRole))
    summary.netSurvivors = summary.afterSurvivors - summary.beforeSurvivors;
  transitions.sort((left, right) => left.role.localeCompare(right.role) ||
    left.matchId.localeCompare(right.matchId) || left.frame - right.frame);

  const primaryBefore = new Map(); const primaryAfter = new Map();
  for (const result of before.results || []) if (result.role === "PRIMARY_LOSS")
    primaryBefore.set(result.matchId, (result.frames || []).filter(survives).length);
  for (const result of after.results || []) if (result.role === "PRIMARY_LOSS")
    primaryAfter.set(result.matchId, (result.frames || []).filter(survives).length);
  invariant(primaryBefore.size === primaryAfter.size,
    "FAST_REGRESSION_COMPARISON_PRIMARY_DENOMINATOR_MISMATCH",
    `${primaryBefore.size}:${primaryAfter.size}`);
  const entryTransitions = { rescuedToRescued: 0, unrescuedToUnrescued: 0,
    unrescuedToRescued: 0, rescuedToUnrescued: 0 };
  const changedEntries = [];
  for (const [matchId, beforeCount] of primaryBefore) {
    invariant(primaryAfter.has(matchId), "FAST_REGRESSION_COMPARISON_PRIMARY_MISSING", matchId);
    const afterCount = primaryAfter.get(matchId); const wasRescued = beforeCount > 0;
    const isRescued = afterCount > 0;
    const key = wasRescued ? (isRescued ? "rescuedToRescued" : "rescuedToUnrescued") :
      (isRescued ? "unrescuedToRescued" : "unrescuedToUnrescued");
    entryTransitions[key] += 1;
    if (wasRescued !== isRescued) changedEntries.push({ matchId, beforeSurvivingFrames: beforeCount,
      afterSurvivingFrames: afterCount, transition: key });
  }
  changedEntries.sort((left, right) => left.matchId.localeCompare(right.matchId));

  const primary = byRole.PRIMARY_LOSS || roleSummary();
  const controls = roleSummary();
  for (const [role, summary] of Object.entries(byRole)) if (role !== "PRIMARY_LOSS")
    for (const field of Object.keys(controls)) controls[field] += summary[field];
  const currentAnalysis = analyzeReport(after);
  return {
    assessment: primary.surviveToDie > 0 ? "NET_IMPROVEMENT_WITH_REGRESSIONS" :
      (primary.netSurvivors > 0 ? "NET_IMPROVEMENT_NO_REGRESSION" :
        (primary.netSurvivors === 0 ? "NO_NET_CHANGE" : "NET_REGRESSION")),
    denominator: { frames: beforeFrames.size, primaryEntries: primaryBefore.size,
      primaryFrames: primary.frames, controlFrames: controls.frames,
      avoidablePrimaryFrames: currentAnalysis.denominator.avoidableFrames },
    primary, controls, byRole, entryTransitions, changedEntries, changedActions, transitions,
    remainingAvoidableFailures: {
      count: currentAnalysis.denominator.avoidableFrames -
        (currentAnalysis.selectionBuckets.CURRENT_SURVIVOR || 0),
      selectionBuckets: currentAnalysis.selectionBuckets,
      dominatedRootCauses: currentAnalysis.rootCauses
    }
  };
}

function compareFocusedRegression(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const beforeFile = reportFile(store, options.beforePath || options.beforeName,
    "native-poison-death-hidden-possible-joint-r12-final");
  const afterFile = reportFile(store, options.afterPath || options.afterName,
    "native-poison-death-current-full-r17");
  const before = loadArtifact(beforeFile, DIAGNOSTIC_KIND);
  const after = loadArtifact(afterFile, DIAGNOSTIC_KIND);
  const comparison = compareFocusedReports(before, after);
  let verification = null;
  if (options.verificationPath || options.verificationName) {
    const verificationFile = reportFile(store,
      options.verificationPath || options.verificationName, "capsule-all");
    const value = loadArtifact(verificationFile, VERIFICATION_KIND);
    verification = { file: path.relative(store.paths.root, verificationFile).replaceAll("\\", "/"),
      fingerprint: value.fingerprint, status: value.status, lane: value.lane,
      completed: value.capsuleExecution?.completed || 0,
      invariants: value.invariantTotals || {} };
  }
  const report = { artifactKind: "FAST_REGRESSION_FOCUSED_COMPARISON",
    status: "COMPLETED",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_PAIR_BOUND",
      "FIXED_HISTORICAL_CONTINUATION", "DIAGNOSTIC_NOT_PLATFORM_PROOF"],
    semantics: {
      survival: "CURRENT_SELECTED_ACTION_DOES_NOT_CRASH_UNDER_RECORDED_CONTINUATION",
      improvement: "BEFORE_SELECTED_ACTION_DIES_AND_AFTER_SELECTED_ACTION_SURVIVES",
      regression: "BEFORE_SELECTED_ACTION_SURVIVES_AND_AFTER_SELECTED_ACTION_DIES",
      inferenceLimit: "ROOT_COUNTERFACTUAL_WITH_FIXED_HISTORICAL_OPPONENT_AND_CONTINUATION"
    },
    source: {
      cohortFingerprint: after.cohort.fingerprint,
      before: { file: path.relative(store.paths.root, beforeFile).replaceAll("\\", "/"),
        reportFingerprint: before.fingerprint,
        workingSourceSha256: before.execution.workingSourceSha256 },
      after: { file: path.relative(store.paths.root, afterFile).replaceAll("\\", "/"),
        reportFingerprint: after.fingerprint,
        workingSourceSha256: after.execution.workingSourceSha256 }, verification
    }, ...comparison };
  return store.writeReport(report, options.outputName || "focused-regression-comparison");
}

module.exports = { frameKey, indexedFrames, compareFocusedReports, compareFocusedRegression };
