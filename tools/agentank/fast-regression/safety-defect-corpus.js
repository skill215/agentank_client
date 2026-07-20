"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { FastRegressionStore } = require("./artifact-store");

function selectedBranch(frame) {
  return frame.branches.find(branch => branch.historicalSelected) || null;
}

function compactDefect(result, frame) {
  const branch = selectedBranch(frame);
  invariant(branch?.result?.branch?.v2Crashed === true,
    "FAST_REGRESSION_SAFETY_DEFECT_BRANCH_INVALID", `${result.fingerprint}:${frame.frame}`);
  return { capsuleFingerprint: result.fingerprint, matchId: result.matchId,
    historicalMatchUrlId: result.historicalMatchUrlId, variantId: result.variantId,
    v2Seat: result.v2Seat, frame: frame.frame, distanceToTerminal: frame.distanceToTerminal,
    defectClass: frame.oneStepProvenSafeContradiction ? "STRICT_ONE_STEP_CONTRADICTION" :
      "CONTINUATION_OBLIGATION_CANDIDATE", historicalAction: frame.selectedAction,
    historicalCommand: frame.selectedCommand, hard: frame.selectedCandidate?.hard,
    safety: frame.selectedCandidate?.safety,
    safetyVector: { immediateFatalMass: frame.selectedCandidate?.immediateFatalMass,
      horizonFatalMass: frame.selectedCandidate?.horizonFatalMass,
      unknownMass: frame.selectedCandidate?.unknownMass,
      escapeSlack: frame.selectedCandidate?.escapeSlack },
    rootDiagnostics: frame.rootDiagnostics,
    fixedContinuation: { v2Crashed: branch.result.branch.v2Crashed,
      result: branch.result.branch.result, exactReproductionFailure:
        branch.result.exactReproductionFailure }, rescuingActions: frame.rescuingActions };
}

function buildSafetyDefectCorpus(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const reportName = String(options.reportName || "native-poison-death");
  const reportFile = options.reportPath ? path.resolve(workspaceRoot, options.reportPath) :
    path.join(store.paths.reports, reportName, "latest.json");
  invariant(fs.existsSync(reportFile), "FAST_REGRESSION_SAFETY_REPORT_NOT_FOUND", reportFile);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  invariant(report.fingerprint === fingerprintObject(report) &&
    report.artifactKind === "FAST_REGRESSION_FOCUSED_COUNTERFACTUAL_DIAGNOSTIC",
  "FAST_REGRESSION_SAFETY_REPORT_INVALID", reportFile);
  const defects = [];
  for (const result of report.results || []) if (result.role === "PRIMARY_LOSS")
    for (const frame of result.frames || [])
      if (frame.modelClass === "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES")
        defects.push(compactDefect(result, frame));
  defects.sort((left, right) => left.capsuleFingerprint.localeCompare(right.capsuleFingerprint) ||
    left.frame - right.frame);
  const strict = defects.filter(item => item.defectClass === "STRICT_ONE_STEP_CONTRADICTION");
  const candidates = defects.filter(item => item.defectClass ===
    "CONTINUATION_OBLIGATION_CANDIDATE");
  invariant(strict.length > 0, "FAST_REGRESSION_STRICT_SAFETY_DEFECT_MISSING", report.fingerprint);
  const artifact = { artifactKind: "FAST_REGRESSION_SAFETY_DEFECT_CORPUS",
    properties: ["IMMUTABLE", "CONTENT_ADDRESSED", "SOURCE_BOUND", "RULE_BOUND",
      "DIAGNOSTIC_NOT_PROOF"], semantics: {
      strict: "TERMINAL_ACTION_DIES_WITH_NO_LATER_OWN_DECISION",
      continuationCandidate: "FIXED_CONTINUATION_DIES_BUT_EXISTENTIAL_WITNESS_NOT_YET_ENUMERATED",
      promotionRule: "CANDIDATE_REQUIRES_EXHAUSTIVE_OBSERVATION_CONSISTENT_STRATEGY_ORACLE" },
    source: { reportFingerprint: report.fingerprint,
      cohortFingerprint: report.cohort.fingerprint, runId: report.cohort.runId,
      simulatorCommit: report.results.length ?
        store.readCapsule(report.results[0].fingerprint).capsule.simulator.commit : null,
      workingSourceSha256: report.execution.workingSourceSha256 },
    counts: { defects: defects.length, strict: strict.length,
      continuationCandidates: candidates.length }, strict, continuationCandidates: candidates,
    fingerprint: "" };
  artifact.fingerprint = fingerprintObject(artifact);
  const directory = path.join(store.paths.root, "defect-corpora", "safety-v1");
  ensureDirectory(directory); const file = path.join(directory, `${artifact.fingerprint}.json`);
  writeJsonImmutable(file, artifact, { mode: 0o644 });
  writeJsonAtomic(path.join(directory, "latest.json"), artifact, { mode: 0o644 });
  return { artifact, file };
}

module.exports = { selectedBranch, compactDefect, buildSafetyDefectCorpus };
