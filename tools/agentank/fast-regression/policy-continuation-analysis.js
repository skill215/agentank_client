"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");
const { inspectRootsAtFrames } = require("./focused-diagnostic");
const { replayPolicyContinuationWindow } = require("./rehydrate");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");
const { SELECTION_BUCKET, selectionBucket } = require("./dominated-rescue-analysis");

const JOINT_CAUSE = "PATH_SUPPORT_POSSIBLE_PROJECTILE_AND_HIDDEN_WORLD";
const TARGET_CAUSES = new Set(["PATH_RISK_INVERSION", "VALUE_DEPTH_NON_DISCRIMINATION",
  "VALUE_ORDERING_OVERRIDES_MODELED_SAFER_RESCUE"]);

function readBoundReport(file) {
  invariant(fs.existsSync(file), "POLICY_CONTINUATION_SOURCE_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value),
    "POLICY_CONTINUATION_SOURCE_INVALID", file); return value;
}
function key(fingerprint, frame) { return `${fingerprint}:${frame}`; }
function sameCommand(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}
function noMoreInformationRisk(left, right) {
  return left && right && left.immediateFatalMass <= right.immediateFatalMass &&
    left.horizonFatalMass <= right.horizonFatalMass && left.unknownMass <= right.unknownMass &&
    left.earliestFatalFrame >= right.earliestFatalFrame &&
    left.escapeSlack >= right.escapeSlack;
}
function strictlyLessInformationRisk(left, right) {
  return noMoreInformationRisk(left, right) &&
    (left.immediateFatalMass < right.immediateFatalMass ||
     left.horizonFatalMass < right.horizonFatalMass || left.unknownMass < right.unknownMass ||
     left.earliestFatalFrame > right.earliestFatalFrame || left.escapeSlack > right.escapeSlack);
}

async function analyzePolicyContinuations(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const jointFile = path.resolve(options.jointSourcePath || path.join(workspaceRoot, "artifacts",
    "fast-regression", "reports", "dominated-rescue-search-frontier-r11",
    "5eb0a5971d7d2ffd57909adb2f8e3717da8f6257bdf0ded8ff5778f2cce32dcc.json"));
  const targetFile = path.resolve(options.targetAnalysisPath || path.join(workspaceRoot, "artifacts",
    "fast-regression", "reports", "dominated-rescue-hidden-possible-joint-r12-final",
    "6b6dc0dd2c008e589dfe6503a17d25f93929e7e41a780270cce25eb0d60fe901.json"));
  const focusedFile = path.resolve(options.focusedReportPath || path.join(workspaceRoot, "artifacts",
    "fast-regression", "reports", "native-poison-death-hidden-possible-joint-r12-final",
    "a2c468260b3c457153ebda37448e605994b249adf28a40f31b2293d11b1b4d2e.json"));
  const focused = readBoundReport(focusedFile);
  const requestedBucket = options.selectionBucket || null;
  if (requestedBucket) invariant(Object.values(SELECTION_BUCKET).includes(requestedBucket),
    "POLICY_CONTINUATION_SELECTION_BUCKET_INVALID", String(requestedBucket));
  let joint = null; let target = null; let cases;
  if (requestedBucket) {
    cases = [];
    for (const result of focused.results || []) {
      if (result.role !== "PRIMARY_LOSS") continue;
      for (const frame of result.frames || []) if (
        frame.frameClass === "AVOIDABLE_UNDER_FIXED_CONTINUATION" &&
        selectionBucket(frame) === requestedBucket)
        cases.push({ capsuleFingerprint: result.fingerprint, matchId: result.matchId,
          frame: frame.frame, rootCause: null });
    }
  } else {
    joint = readBoundReport(jointFile); target = readBoundReport(targetFile);
    const jointKeys = new Set(joint.cases.filter(item => item.rootCause === JOINT_CAUSE)
      .map(item => key(item.capsuleFingerprint, item.frame)));
    cases = target.cases.filter(item => jointKeys.has(key(item.capsuleFingerprint, item.frame)) &&
      TARGET_CAUSES.has(item.rootCause));
    invariant(cases.length === 14, "POLICY_CONTINUATION_TARGET_DENOMINATOR_CHANGED",
      String(cases.length));
  }
  invariant(cases.length > 0, "POLICY_CONTINUATION_TARGET_EMPTY",
    requestedBucket || "legacy-joint");
  const sourceFrames = new Map();
  for (const result of focused.results || []) for (const frame of result.frames || [])
    sourceFrames.set(key(result.fingerprint, frame.frame), frame);
  const settings = v2Options(loadFrozenCandidate(workspaceRoot).manifest.parameters).engine;
  const results = []; let completed = 0;
  for (const item of cases) {
    const { capsule } = store.readCapsule(item.capsuleFingerprint);
    const prepared = (await inspectRootsAtFrames(workspaceRoot, capsule, [item.frame], settings))
      .get(item.frame);
    const source = sourceFrames.get(key(item.capsuleFingerprint, item.frame));
    invariant(source, "POLICY_CONTINUATION_FRAME_NOT_FOUND", key(item.capsuleFingerprint, item.frame));
    const candidates = [{ action: prepared.selectedAction, command: prepared.command,
      currentSelected: true }];
    for (const branch of source.branches || []) if (branch.replayable && branch.actionCode !== 0 &&
        branch.result?.branch && (requestedBucket || !branch.result.branch.v2Crashed) &&
        !candidates.some(candidate => sameCommand(candidate.command, branch.command)))
      candidates.push({ action: branch.action, command: branch.command, currentSelected: false });
    const branches = [];
    for (const candidate of candidates) {
      const model = prepared.candidates.find(item => item.action === candidate.action) || null;
      const replay = await replayPolicyContinuationWindow(workspaceRoot, capsule, candidate.command,
        { branchFrame: item.frame, currentRootCommand: prepared.command, v2Options: settings });
      branches.push({ ...candidate, survives: !replay.branch.v2Crashed,
        model: model ? { actionCode: model.actionCode, immediateFatalMass: model.immediateFatalMass,
          horizonFatalMass: model.horizonFatalMass, unknownMass: model.unknownMass,
          earliestFatalFrame: model.earliestFatalFrame, escapeSlack: model.escapeSlack,
          robustLower: model.robustLower, acceptable: model.acceptable,
          expectedValue: model.expectedValue, tacticalValue: model.tacticalValue,
          committedFatalMass: model.committedFatalMass,
          possibleProjectileFatalMass: model.possibleProjectileFatalMass,
          futureFireFatalMass: model.futureFireFatalMass,
          dominated: model.dominated } : null,
        rootActionVerified: replay.rootActionVerified,
        actionTrace: replay.actionTrace, eventFingerprint: replay.eventFingerprint,
        terminal: replay.branch, rootRestoreFailures: replay.rootRestoreFailures });
    }
    const selected = branches[0]; const rescues = branches.filter(branch =>
      !branch.currentSelected && branch.survives);
    const defect = !selected.survives && rescues.length > 0;
    const dominatingRescues = rescues.filter(branch =>
      strictlyLessInformationRisk(branch.model, selected.model));
    results.push({ capsuleFingerprint: item.capsuleFingerprint, matchId: item.matchId,
      frame: item.frame, priorRootCause: item.rootCause,
      currentSelectedAction: prepared.selectedAction,
      currentSelectedSurvives: selected.survives,
      policyRescuingActions: rescues.map(branch => branch.action),
      strategyConsistentCounterexample: defect,
      informationStateDominatingDefect: defect && dominatingRescues.length > 0,
      informationStateDominatingRescues: dominatingRescues.map(branch => branch.action),
      epistemicAmbiguity: defect && dominatingRescues.length === 0, branches });
    completed += 1;
    if (typeof options.onProgress === "function")
      options.onProgress(completed, cases.length, item.capsuleFingerprint, item.frame,
        defect);
  }
  const denominator = { targetCases: cases.length,
    selectedPolicySurvivors: results.filter(item => item.currentSelectedSurvives).length,
    strategyConsistentCounterexamples: results.filter(item =>
      item.strategyConsistentCounterexample).length,
    informationStateDominatingDefects: results.filter(item =>
      item.informationStateDominatingDefect).length,
    epistemicAmbiguities: results.filter(item => item.epistemicAmbiguity).length,
    noPolicyRescue: results.filter(item => !item.currentSelectedSurvives &&
      item.policyRescuingActions.length === 0).length,
    rootRestoreFailures: results.reduce((sum, item) => sum + item.branches.reduce((inner, branch) =>
      inner + branch.rootRestoreFailures, 0), 0) };
  const report = { artifactKind: "FAST_REGRESSION_POLICY_CONTINUATION_ANALYSIS",
    status: "COMPLETED", properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND",
      "POLICY_CONSISTENT_V2_CONTINUATION", "HISTORICAL_OPPONENT_CONTINUATION",
      "DIAGNOSTIC_NOT_PROOF"],
    semantics: { currentBranch: "CURRENT_ROOT_AND_LATER_CALLBACKS_USE_CURRENT_V2_POLICY",
      alternativeBranch: "FORCED_ROOT_ACTION_THEN_CURRENT_V2_POLICY_WITH_COLD_ROOT_PLAN",
      opponent: "FIXED_HISTORICAL_ACTIONS",
      defectCriterion: "SURVIVING_POLICY_BRANCH_STRICTLY_DOMINATES_SELECTED_INFORMATION_RISK",
      epistemicAmbiguity: "ACTUAL_WORLD_RESCUE_DOES_NOT_DOMINATE_AT_DECISION_INFORMATION_STATE",
      inferenceLimit: "FOUR_FRAME_CONDITIONAL_COUNTERFACTUAL_NOT_PLATFORM_PROOF" },
    sources: { joint: requestedBucket ? null : {
      file: path.relative(store.paths.root, jointFile).replaceAll("\\", "/"),
      fingerprint: joint.fingerprint },
    target: requestedBucket ? null : {
      file: path.relative(store.paths.root, targetFile).replaceAll("\\", "/"),
      fingerprint: target.fingerprint },
    focused: { file: path.relative(store.paths.root, focusedFile).replaceAll("\\", "/"),
      fingerprint: focused.fingerprint } }, selection: requestedBucket ? {
      kind: "FOCUSED_SELECTION_BUCKET", bucket: requestedBucket } : {
      kind: "LEGACY_JOINT_ROOT_CAUSE" }, denominator, results };
  return store.writeReport(report, options.outputName || "policy-continuation-analysis");
}

module.exports = { JOINT_CAUSE, TARGET_CAUSES, noMoreInformationRisk,
  strictlyLessInformationRisk, analyzePolicyContinuations };
