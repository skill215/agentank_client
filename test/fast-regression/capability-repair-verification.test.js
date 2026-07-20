"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareCapabilityRepair } =
  require("../../tools/agentank/fast-regression/capability-repair-verification");

function frame(frameNumber, modelClass, candidate, rootDiagnostics = {}) {
  return { frame: frameNumber, modelClass, selectedCandidate: {
    hard: "ALLOW", safety: "POSSIBLE_DEATH", immediateFatalMass: 0,
    horizonFatalMass: 0, unknownMass: 0, futureFireDepth: 3, ...candidate },
  rootDiagnostics: { enemyCapabilitySupportComplete: true,
    futureEnemyFireSupport: true, ...rootDiagnostics } };
}

function diagnostic(fingerprint, frames, safeCount) {
  return { fingerprint, cohort: { fingerprint: "cohort" }, execution: {
    failures: 0, workingSourceSha256: fingerprint }, primary: {
    oneStepProvenSafeContradictions: 0,
    modelProvenSafeFixedContinuationFatalFrames: safeCount,
    actionReproductionFailures: 0, exactReplayFailures: 0 }, controls: {
    exactReplayFailures: 0, controlSurvivalRegressions: 0 }, results: frames.map(item => ({
      fingerprint: item.capsule, frames: [item.value] })) };
}

test("capability repair accepts exact fatal support, incomplete unknown, and physical witness", () => {
  const safeClass = "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES";
  const before = diagnostic("before", [
    { capsule: "exact", value: frame(1, safeClass, { safety: "PROVEN_SAFE" }) },
    { capsule: "incomplete", value: frame(2, safeClass, { safety: "PROVEN_SAFE" }) },
    { capsule: "witness", value: frame(3, safeClass, { safety: "PROVEN_SAFE" }) }
  ], 3);
  const after = diagnostic("after", [
    { capsule: "exact", value: frame(1, "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES",
      { horizonFatalMass: 1200 }) },
    { capsule: "incomplete", value: frame(2,
      "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES", { unknownMass: 1 },
      { enemyCapabilitySupportComplete: false }) },
    { capsule: "witness", value: frame(3, safeClass, { safety: "PROVEN_SAFE",
      futureFireDepth: 255 }) }
  ], 1);
  const classification = { source: { focusedReportFingerprint: "before",
    cohortFingerprint: "cohort" }, counts: { confirmedFalseProvenSafe: 2 }, results: [
    { capsuleFingerprint: "exact", frame: 1, verdict: "CONFIRMED_FALSE_PROVEN_SAFE" },
    { capsuleFingerprint: "incomplete", frame: 2, verdict: "CONFIRMED_FALSE_PROVEN_SAFE" },
    { capsuleFingerprint: "witness", frame: 3,
      verdict: "OBSERVATION_CONSISTENT_WINDOW_WITNESS" }
  ] };
  const result = compareCapabilityRepair(classification, before, after);
  assert.equal(result.status, "ACCEPTED");
  assert.ok(result.checks.every(item => item.status === "PASS"));
  assert.equal(result.delta.provenSafeFatalFrames, -2);
  assert.deepEqual(result.delta.remainingAuditedSafe, ["witness:3"]);
});

test("capability repair rejects guessing an exact future from incomplete support", () => {
  const safeClass = "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES";
  const before = diagnostic("before", [{ capsule: "case", value:
    frame(1, safeClass, { safety: "PROVEN_SAFE" }) }], 1);
  const after = diagnostic("after", [{ capsule: "case", value:
    frame(1, "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES", { unknownMass: 0 },
      { enemyCapabilitySupportComplete: false }) }], 0);
  const classification = { source: { focusedReportFingerprint: "before",
    cohortFingerprint: "cohort" }, counts: { confirmedFalseProvenSafe: 1 }, results: [
    { capsuleFingerprint: "case", frame: 1, verdict: "CONFIRMED_FALSE_PROVEN_SAFE" }
  ] };
  const result = compareCapabilityRepair(classification, before, after);
  assert.equal(result.status, "REJECTED");
  assert.equal(result.checks.find(item => item.checkId ===
    "INCOMPLETE_CAPABILITY_REMAINS_UNKNOWN").status, "FAIL");
});
