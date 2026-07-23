"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { sourceIdentity } = require("../diagnostics/v1-v2-working-arena");
const { FastRegressionStore } = require("./artifact-store");
const { selectionBucket } = require("./dominated-rescue-analysis");
const { inspectRootAtFrame } = require("./focused-diagnostic");
const { loadFrozenCandidate, v2Options } = require("../candidate/imp8-g10a");

const DEFAULT_FOCUSED =
  "artifacts/fast-regression/reports/native-poison-death-post-migration-full-r21/latest.json";
const DEFAULT_OUTPUT = "fact-layer-scan-b0";

function readBoundReport(file) {
  invariant(fs.existsSync(file), "FACT_LAYER_REPORT_NOT_FOUND", file);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(value.fingerprint === fingerprintObject(value),
    "FACT_LAYER_REPORT_INVALID", file);
  return value;
}

function mismatchReasons(diagnostics) {
  const reasons = [];
  const observedBomb = diagnostics.observedBombCount || 0;
  const committedBomb = diagnostics.committedBombCount || 0;
  const observedBullet = (diagnostics.observedOwnBullet ? 1 : 0) +
    (diagnostics.observedEnemyBullet ? 1 : 0);
  const committedProj = diagnostics.committedProjectileCount || 0;
  const possible = diagnostics.possibleProjectileCount || 0;
  if (observedBomb > 0 && committedBomb === 0)
    reasons.push("OBSERVED_BOMB_WITHOUT_COMMITTED");
  if (observedBullet > 0 && committedProj === 0 && possible === 0)
    reasons.push("OBSERVED_BULLET_WITHOUT_TRACK");
  if (committedBomb > observedBomb + 1)
    reasons.push("COMMITTED_BOMB_EXCEEDS_OBSERVATION");
  if (!diagnostics.informationComplete && (observedBomb > 0 || observedBullet > 0) &&
      committedBomb === 0 && committedProj === 0 && possible === 0)
    reasons.push("INCOMPLETE_WITH_OBSERVED_HAZARD_UNTRACKED");
  return reasons;
}

function collectFrames(focused) {
  const frames = [];
  for (const result of focused.results || []) {
    for (const frame of result.frames || []) {
      const diagnostics = frame.rootDiagnostics || {};
      const reasons = mismatchReasons(diagnostics);
      const bucket = selectionBucket(frame);
      frames.push({
        role: result.role,
        capsuleFingerprint: result.fingerprint,
        matchId: result.matchId,
        frame: frame.frame,
        frameClass: frame.frameClass,
        currentSelectedDies: frame.currentSelectedDies === true,
        selectionBucket: bucket,
        diagnostics: {
          observedBombCount: diagnostics.observedBombCount || 0,
          committedBombCount: diagnostics.committedBombCount || 0,
          observedOwnBullet: diagnostics.observedOwnBullet ? 1 : 0,
          observedEnemyBullet: diagnostics.observedEnemyBullet ? 1 : 0,
          committedProjectileCount: diagnostics.committedProjectileCount || 0,
          possibleProjectileCount: diagnostics.possibleProjectileCount || 0,
          informationComplete: Boolean(diagnostics.informationComplete)
        },
        mismatch: reasons.length > 0,
        reasons
      });
    }
  }
  return frames;
}

async function liveVerify(workspaceRoot, store, settings, cases, limit) {
  const verified = [];
  for (let index = 0; index < cases.length && index < limit; index += 1) {
    const item = cases[index];
    const { capsule } = store.readCapsule(item.capsuleFingerprint);
    const prepared = await inspectRootAtFrame(workspaceRoot, capsule, item.frame, settings);
    const liveReasons = mismatchReasons(prepared.diagnostics);
    verified.push({
      capsuleFingerprint: item.capsuleFingerprint,
      frame: item.frame,
      reportReasons: item.reasons,
      liveReasons,
      liveDiagnostics: {
        observedBombCount: prepared.diagnostics.observedBombCount || 0,
        committedBombCount: prepared.diagnostics.committedBombCount || 0,
        observedOwnBullet: prepared.diagnostics.observedOwnBullet || 0,
        observedEnemyBullet: prepared.diagnostics.observedEnemyBullet || 0,
        committedProjectileCount: prepared.diagnostics.committedProjectileCount || 0,
        possibleProjectileCount: prepared.diagnostics.possibleProjectileCount || 0,
        informationComplete: Boolean(prepared.diagnostics.informationComplete)
      },
      confirmed: liveReasons.length > 0
    });
  }
  return verified;
}

async function scanFactLayer(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); store.initialize();
  const focusedPath = path.resolve(options.focusedReportPath ||
    path.join(workspaceRoot, DEFAULT_FOCUSED));
  const focused = readBoundReport(focusedPath);
  const source = sourceIdentity(workspaceRoot);
  invariant(source.sha256 === focused.execution.workingSourceSha256,
    "FACT_LAYER_SOURCE_DRIFT", `${source.sha256}/${focused.execution.workingSourceSha256}`);
  const frames = collectFrames(focused);
  const mismatches = frames.filter(item => item.mismatch);
  const avoidable = frames.filter(item =>
    item.frameClass === "AVOIDABLE_UNDER_FIXED_CONTINUATION" && item.currentSelectedDies);
  const avoidableMismatch = avoidable.filter(item => item.mismatch);
  const reasonHistogram = {};
  for (const item of mismatches) for (const reason of item.reasons)
    reasonHistogram[reason] = (reasonHistogram[reason] || 0) + 1;
  const bucketHistogram = {};
  for (const item of avoidableMismatch) if (item.selectionBucket)
    bucketHistogram[item.selectionBucket] = (bucketHistogram[item.selectionBucket] || 0) + 1;

  let live = [];
  if (mismatches.length > 0) {
    const settings = v2Options(loadFrozenCandidate(workspaceRoot).manifest.parameters).engine;
    const verifyLimit = Math.min(Number(options.verifyLimit) || 12, mismatches.length);
    live = await liveVerify(workspaceRoot, store, settings, mismatches, verifyLimit);
  }

  const report = {
    artifactKind: "FAST_REGRESSION_FACT_LAYER_SCAN",
    status: "COMPLETED",
    properties: ["DIAGNOSTIC_NOT_PROOF", "SOURCE_BOUND", "BASELINE_B0", "REPORT_FIELD_SCAN"],
    semantics: {
      mismatch: "Observation shows bomb/bullet but PhysicalState/tracker lacks corresponding committed or possible entity, or committed bomb far exceeds observation.",
      scope: "All focused frames offline; live rehydrate only when report mismatches exist."
    },
    source: {
      focusedReportPath: path.relative(workspaceRoot, focusedPath).replaceAll("\\", "/"),
      focusedFingerprint: focused.fingerprint,
      workingSourceSha256: source.sha256,
      baselineId: "structural-repair-baseline-b0"
    },
    denominator: {
      totalFrames: frames.length,
      mismatchFrames: mismatches.length,
      avoidableDeathFrames: avoidable.length,
      avoidableMismatchFrames: avoidableMismatch.length,
      reasonHistogram,
      avoidableBucketHistogram: bucketHistogram,
      liveVerified: live.length,
      liveConfirmed: live.filter(item => item.confirmed).length
    },
    mismatches: mismatches.slice(0, 64),
    liveVerification: live,
    schemaVersion: 1,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const written = store.writeReport(report, options.outputName || DEFAULT_OUTPUT);
  return { report, file: written.file };
}

module.exports = { scanFactLayer, mismatchReasons, collectFrames };
