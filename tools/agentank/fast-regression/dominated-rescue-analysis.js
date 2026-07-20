"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");

const SELECTION_BUCKET = Object.freeze({
  CURRENT_SURVIVOR: "CURRENT_SURVIVOR",
  NO_ACCEPTABLE_RESCUE: "NO_ACCEPTABLE_RESCUE",
  DOMINATED_RESCUE: "DOMINATED_RESCUE",
  LOWER_ROBUST_RESCUE: "LOWER_ROBUST_RESCUE",
  RESCUE_AT_OR_ABOVE_FLOOR: "RESCUE_AT_OR_ABOVE_FLOOR"
});

const ROOT_CAUSE = Object.freeze({
  POSSIBLE_AND_HIDDEN_SUPPORT: "PATH_SUPPORT_POSSIBLE_PROJECTILE_AND_HIDDEN_WORLD",
  POSSIBLE_PROJECTILE_SUPPORT: "PATH_SUPPORT_POSSIBLE_PROJECTILE",
  HIDDEN_WORLD_SUPPORT: "PATH_SUPPORT_HIDDEN_WORLD",
  OTHER_INCOMPLETE_SUPPORT: "PATH_SUPPORT_OTHER_INCOMPLETE",
  INCOMPLETE_UNATTRIBUTED: "PATH_SUPPORT_INCOMPLETE_UNATTRIBUTED",
  FRONTIER_NOT_ACTIVATED: "PATH_FRONTIER_NOT_ACTIVATED",
  VALUE_NON_DISCRIMINATION: "VALUE_DEPTH_NON_DISCRIMINATION",
  PATH_RISK_INVERSION: "PATH_RISK_INVERSION",
  SAFER_RESCUE_OVERRIDDEN: "VALUE_ORDERING_OVERRIDES_MODELED_SAFER_RESCUE",
  UNKNOWN_STATUS: "UNKNOWN_PATH_STATUS"
});

function increment(target, key, amount = 1) { target[key] = (target[key] || 0) + amount; }

function survivingBranches(frame) {
  return (frame.branches || []).filter(branch => branch.replayable && branch.result &&
    branch.result.branch && !branch.result.branch.v2Crashed);
}

function selectionBucket(frame) {
  if (frame.currentSelectedDies === false) return SELECTION_BUCKET.CURRENT_SURVIVOR;
  if (frame.currentSelectedDies !== true) return null;
  const acceptable = survivingBranches(frame).filter(branch => branch.acceptable);
  if (!acceptable.length) return SELECTION_BUCKET.NO_ACCEPTABLE_RESCUE;
  const frontier = acceptable.filter(branch => !branch.dominated);
  if (!frontier.length) return SELECTION_BUCKET.DOMINATED_RESCUE;
  return frontier.some(branch => branch.robustLower >= frame.rootDiagnostics.safeFloor) ?
    SELECTION_BUCKET.RESCUE_AT_OR_ABOVE_FLOOR : SELECTION_BUCKET.LOWER_ROBUST_RESCUE;
}

function earliest(candidate) {
  if (Number.isSafeInteger(candidate?.earliestFatalFrame)) return candidate.earliestFatalFrame;
  return Number.isSafeInteger(candidate?.strategyEarliestFatalFrame) ?
    candidate.strategyEarliestFatalFrame : 255;
}

function sameReportedRisk(left, right) {
  return left.immediateFatalMass === right.immediateFatalMass &&
    left.horizonFatalMass === right.horizonFatalMass &&
    left.unknownMass === right.unknownMass && left.escapeSlack === right.escapeSlack &&
    earliest(left) === earliest(right);
}

function noMoreReportedRisk(left, right) {
  return left.immediateFatalMass <= right.immediateFatalMass &&
    left.horizonFatalMass <= right.horizonFatalMass &&
    left.unknownMass <= right.unknownMass && left.escapeSlack >= right.escapeSlack &&
    earliest(left) >= earliest(right);
}

function reportedRiskRelation(selectedFatal, rescues) {
  if (!selectedFatal) return "SELECTED_CANDIDATE_MISSING";
  if (rescues.some(rescue => sameReportedRisk(selectedFatal, rescue))) return "SAME_RISK_EXISTS";
  if (rescues.some(rescue => noMoreReportedRisk(rescue, selectedFatal)))
    return "MODELED_SAFER_RESCUE_EXISTS";
  if (rescues.every(rescue => noMoreReportedRisk(selectedFatal, rescue)))
    return "FATAL_MODELED_SAFER_THAN_ALL_RESCUES";
  return "INCOMPARABLE_RISK";
}

function dominatedRootCause(frame) {
  const diagnostics = frame.rootDiagnostics || {}; const status = diagnostics.multiFrameRiskStatus;
  if (status === 2 || status === 3 || status === 4) {
    const possible = (diagnostics.possibleProjectileCount || 0) > 0;
    const hidden = !diagnostics.hiddenSupportComplete;
    if (possible && hidden) return ROOT_CAUSE.POSSIBLE_AND_HIDDEN_SUPPORT;
    if (possible) return ROOT_CAUSE.POSSIBLE_PROJECTILE_SUPPORT;
    if (hidden) return ROOT_CAUSE.HIDDEN_WORLD_SUPPORT;
    if (!diagnostics.safetySupportComplete || !diagnostics.enemyCapabilitySupportComplete)
      return ROOT_CAUSE.OTHER_INCOMPLETE_SUPPORT;
    return ROOT_CAUSE.INCOMPLETE_UNATTRIBUTED;
  }
  if (status === 0) return ROOT_CAUSE.FRONTIER_NOT_ACTIVATED;
  if (status !== 1) return ROOT_CAUSE.UNKNOWN_STATUS;
  const rescues = survivingBranches(frame).filter(branch => branch.acceptable);
  const relation = reportedRiskRelation(frame.currentSelectedCandidate, rescues);
  if (relation === "SAME_RISK_EXISTS") return ROOT_CAUSE.VALUE_NON_DISCRIMINATION;
  if (relation === "MODELED_SAFER_RESCUE_EXISTS") return ROOT_CAUSE.SAFER_RESCUE_OVERRIDDEN;
  return ROOT_CAUSE.PATH_RISK_INVERSION;
}

function analyzeReport(report) {
  const selectionBuckets = {}; const rootCauses = {}; const pathStatus = {};
  const informationDepth = {}; const physicalDepth = {}; const selectedActions = {};
  const distanceToTerminal = {}; const cases = [];
  let avoidableFrames = 0;
  for (const result of report.results || []) {
    if (result.role !== "PRIMARY_LOSS") continue;
    for (const frame of result.frames || []) {
      if (frame.frameClass !== "AVOIDABLE_UNDER_FIXED_CONTINUATION") continue;
      avoidableFrames += 1; const bucket = selectionBucket(frame);
      increment(selectionBuckets, bucket || "CURRENT_ACTION_NOT_REPLAYED");
      if (bucket !== SELECTION_BUCKET.DOMINATED_RESCUE) continue;
      const cause = dominatedRootCause(frame); const diagnostics = frame.rootDiagnostics || {};
      increment(rootCauses, cause); increment(pathStatus, String(diagnostics.multiFrameRiskStatus));
      increment(informationDepth, String(diagnostics.informationDepth));
      increment(physicalDepth, String(diagnostics.physicalDepth));
      increment(selectedActions, frame.currentSelectedAction || "UNKNOWN");
      increment(distanceToTerminal, String(frame.distanceToTerminal));
      const rescues = survivingBranches(frame).filter(branch => branch.acceptable);
      cases.push({ capsuleFingerprint: result.fingerprint, matchId: result.matchId,
        historicalMatchUrlId: result.historicalMatchUrlId, frame: frame.frame,
        distanceToTerminal: frame.distanceToTerminal, currentSelectedAction: frame.currentSelectedAction,
        currentSelectedCandidateIndex: frame.currentSelectedCandidate?.index ?? -1,
        rescuingActions: rescues.map(branch => branch.action), rootCause: cause,
        reportedRiskRelation: reportedRiskRelation(frame.currentSelectedCandidate, rescues),
        multiFrameRiskStatus: diagnostics.multiFrameRiskStatus,
        multiFrameRiskAppliedActions: diagnostics.multiFrameRiskAppliedActions,
        possibleProjectileCount: diagnostics.possibleProjectileCount,
        hiddenSupportComplete: Boolean(diagnostics.hiddenSupportComplete),
        safetySupportComplete: Boolean(diagnostics.safetySupportComplete),
        enemyCapabilitySupportComplete: Boolean(diagnostics.enemyCapabilitySupportComplete),
        informationDepth: diagnostics.informationDepth, physicalDepth: diagnostics.physicalDepth });
    }
  }
  cases.sort((left, right) => left.capsuleFingerprint.localeCompare(right.capsuleFingerprint) ||
    left.frame - right.frame);
  return { denominator: { primaryEntries: (report.results || []).filter(item =>
    item.role === "PRIMARY_LOSS").length, avoidableFrames,
    dominatedRescueFrames: selectionBuckets[SELECTION_BUCKET.DOMINATED_RESCUE] || 0 },
  selectionBuckets, rootCauses, pathStatus, informationDepth, physicalDepth, selectedActions,
  distanceToTerminal, cases };
}

function loadReport(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const file = options.reportPath ? path.resolve(options.reportPath) : path.join(store.paths.reports,
    String(options.reportName || "native-poison-death"), "latest.json");
  invariant(fs.existsSync(file), "DOMINATED_RESCUE_REPORT_NOT_FOUND", file);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(report.artifactKind === "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC",
    "DOMINATED_RESCUE_REPORT_KIND_INVALID", String(report.artifactKind));
  invariant(report.fingerprint === fingerprintObject(report),
    "DOMINATED_RESCUE_REPORT_FINGERPRINT_INVALID", file);
  return { store, file, report };
}

function analyzeDominatedRescues(workspaceRoot, options = {}) {
  const loaded = loadReport(workspaceRoot, options); const analysis = analyzeReport(loaded.report);
  const report = { artifactKind: "FAST_REGRESSION_DOMINATED_RESCUE_ANALYSIS",
    status: "COMPLETED",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_REPORT_BOUND",
      "FIXED_HISTORICAL_CONTINUATION", "DIAGNOSTIC_NOT_PROOF"],
    source: { reportFile: path.relative(loaded.store.paths.root, loaded.file).replaceAll("\\", "/"),
      reportFingerprint: loaded.report.fingerprint,
      workingSourceSha256: loaded.report.execution.workingSourceSha256,
      cohortFingerprint: loaded.report.cohort.fingerprint },
    semantics: { dominatedRescue: "CURRENT_ACTION_DIES_AND_EVERY_ACCEPTABLE_FIXED_CONTINUATION_RESCUE_IS_DOMINATED",
      pathSupport: "INCOMPLETE_PATH_SUPPORT_PRECEDES_VALUE_DEPTH_DIAGNOSIS",
      valueDepth: "ONLY_ASSIGNED_AFTER_COMPLETE_MULTI_FRAME_PATH_PUBLICATION",
      inferenceLimit: "ONE_ACTION_REPLACEMENT_WITH_FIXED_HISTORICAL_CONTINUATION" },
    ...analysis };
  return loaded.store.writeReport(report, options.outputName || "dominated-rescue-analysis");
}

module.exports = { SELECTION_BUCKET, ROOT_CAUSE, survivingBranches, selectionBucket,
  reportedRiskRelation, dominatedRootCause, analyzeReport, analyzeDominatedRescues };
