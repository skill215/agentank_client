"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { FastRegressionStore } = require("./artifact-store");
const { ROOT_CAUSE } = require("./dominated-rescue-analysis");

const DEFAULT_DOMINATED =
  "artifacts/fast-regression/reports/dominated-rescue-post-migration-r21/latest.json";
const DEFAULT_FOCUSED =
  "artifacts/fast-regression/reports/native-poison-death-post-migration-full-r21/latest.json";
const DEFAULT_OUTPUT = "value-depth-probe-b0";

function readBoundReport(file) {
  invariant(fs.existsSync(file), "VALUE_DEPTH_REPORT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value),
    "VALUE_DEPTH_REPORT_INVALID", file);
  return value;
}

function key(fingerprint, frame) { return `${fingerprint}:${frame}`; }

function analyzeValueDepth(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const dominatedPath = path.resolve(options.dominatedReportPath ||
    path.join(workspaceRoot, DEFAULT_DOMINATED));
  const focusedPath = path.resolve(options.focusedReportPath ||
    path.join(workspaceRoot, DEFAULT_FOCUSED));
  const dominated = readBoundReport(dominatedPath);
  const focused = readBoundReport(focusedPath);
  const source = sourceIdentity(workspaceRoot);
  const baselineSha = dominated.source.workingSourceSha256;
  // Offline report analysis may run after a later semantic repair; bind to the
  // dominated/focused report baseline, and record any current-tree drift.
  const sourceDrift = source.sha256 !== baselineSha;

  const frameMap = new Map();
  for (const result of focused.results || [])
    for (const frame of result.frames || [])
      frameMap.set(key(result.fingerprint, frame.frame), frame);

  const cases = [];
  const depthPairs = {};
  let equalRobust = 0; let equalExpected = 0; let rescueBetterRobust = 0;
  let zeroPhysical = 0; let zeroInformation = 0;
  for (const item of dominated.cases || []) {
    if (item.rootCause !== ROOT_CAUSE.VALUE_NON_DISCRIMINATION &&
        item.rootCause !== "VALUE_DEPTH_NON_DISCRIMINATION") continue;
    const frame = frameMap.get(key(item.capsuleFingerprint, item.frame));
    const selected = frame?.currentSelectedCandidate || frame?.selectedCandidate || null;
    const rescues = (frame?.branches || []).filter(branch => branch.replayable &&
      branch.result && !branch.result.branch.v2Crashed);
    const bestRescue = rescues.reduce((best, branch) => {
      if (!best) return branch;
      return branch.robustLower > best.robustLower ? branch : best;
    }, null);
    const physicalDepth = item.physicalDepth;
    const informationDepth = item.informationDepth;
    increment(depthPairs, `p${physicalDepth}-i${informationDepth}`);
    if (physicalDepth === 0) zeroPhysical += 1;
    if (informationDepth === 0) zeroInformation += 1;
    if (selected && bestRescue) {
      if (selected.robustLower === bestRescue.robustLower) equalRobust += 1;
      if (selected.expectedValue === bestRescue.expectedValue) equalExpected += 1;
      if (bestRescue.robustLower > selected.robustLower) rescueBetterRobust += 1;
    }
    cases.push({
      capsuleFingerprint: item.capsuleFingerprint,
      matchId: item.matchId,
      frame: item.frame,
      selectedAction: item.currentSelectedAction,
      rescuingActions: item.rescuingActions,
      physicalDepth,
      informationDepth,
      selectedRobust: selected?.robustLower ?? null,
      rescueRobust: bestRescue?.robustLower ?? null,
      selectedExpected: selected?.expectedValue ?? null,
      rescueExpected: bestRescue?.expectedValue ?? null,
      selectedEscapeSlack: selected?.escapeSlack ?? null,
      rescueEscapeSlack: bestRescue?.escapeSlack ?? null
    });
  }

  const report = {
    artifactKind: "FAST_REGRESSION_VALUE_DEPTH_PROBE",
    status: "COMPLETED",
    properties: ["DIAGNOSTIC_NOT_PROOF", "SOURCE_BOUND", "BASELINE_B0"],
    semantics: {
      focus: "VALUE_DEPTH_NON_DISCRIMINATION dominated-rescue cases",
      implication: "Equal robust/expected between fatal selected and surviving rescue implies leaf/horizon value does not separate escape-critical futures."
    },
    source: {
      dominatedFingerprint: dominated.fingerprint,
      focusedFingerprint: focused.fingerprint,
      reportWorkingSourceSha256: baselineSha,
      workingSourceSha256: source.sha256,
      sourceDrift: sourceDrift ? 1 : 0,
      baselineId: "structural-repair-baseline-b0"
    },
    denominator: {
      valueDepthCases: cases.length,
      depthPairHistogram: depthPairs,
      zeroPhysicalDepth: zeroPhysical,
      zeroInformationDepth: zeroInformation,
      equalRobustLower: equalRobust,
      equalExpectedValue: equalExpected,
      rescueStrictlyBetterRobust: rescueBetterRobust
    },
    cases,
    schemaVersion: 1,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const written = store.writeReport(report, options.outputName || DEFAULT_OUTPUT);
  return { report, file: written.file };
}

function increment(target, keyName, amount = 1) {
  target[keyName] = (target[keyName] || 0) + amount;
}

module.exports = { analyzeValueDepth };
