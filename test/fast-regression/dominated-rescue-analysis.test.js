"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SELECTION_BUCKET, ROOT_CAUSE, selectionBucket, dominatedRootCause, analyzeReport } =
  require("../../tools/agentank/fast-regression/dominated-rescue-analysis");

function branch(overrides = {}) {
  return { action: "TURN_LEFT", replayable: true, acceptable: true, dominated: true,
    immediateFatalMass: 100, horizonFatalMass: 500, unknownMass: 0,
    earliestFatalFrame: 3, escapeSlack: 0, robustLower: 10,
    result: { branch: { v2Crashed: false } }, ...overrides };
}

function frame(overrides = {}) {
  return { frame: 8, distanceToTerminal: 2,
    frameClass: "AVOIDABLE_UNDER_FIXED_CONTINUATION", currentSelectedDies: true,
    currentSelectedAction: "GO", currentSelectedCandidate: branch({ action: "GO",
      result: { branch: { v2Crashed: true } }, robustLower: 20 }),
    rootDiagnostics: { safeFloor: 20, multiFrameRiskStatus: 2, possibleProjectileCount: 1,
      hiddenSupportComplete: false, safetySupportComplete: false,
      enemyCapabilitySupportComplete: true, informationDepth: 1, physicalDepth: 0 },
    branches: [branch()], ...overrides };
}

test("dominated rescue classifier separates path support before value depth", () => {
  const incomplete = frame();
  assert.equal(selectionBucket(incomplete), SELECTION_BUCKET.DOMINATED_RESCUE);
  assert.equal(dominatedRootCause(incomplete), ROOT_CAUSE.POSSIBLE_AND_HIDDEN_SUPPORT);
  const completeEqual = frame({ rootDiagnostics: { ...incomplete.rootDiagnostics,
    multiFrameRiskStatus: 1, possibleProjectileCount: 0, hiddenSupportComplete: true,
    safetySupportComplete: true } });
  assert.equal(dominatedRootCause(completeEqual), ROOT_CAUSE.VALUE_NON_DISCRIMINATION);
  const inversion = frame({ currentSelectedCandidate: branch({ action: "GO",
    result: { branch: { v2Crashed: true } }, immediateFatalMass: 0,
    horizonFatalMass: 0, earliestFatalFrame: 255, escapeSlack: 4, robustLower: 20 }),
  rootDiagnostics: { ...incomplete.rootDiagnostics, multiFrameRiskStatus: 1,
    possibleProjectileCount: 0, hiddenSupportComplete: true, safetySupportComplete: true } });
  assert.equal(dominatedRootCause(inversion), ROOT_CAUSE.PATH_RISK_INVERSION);
});

test("analysis keeps selection buckets mutually exclusive and source traceable", () => {
  const dominated = frame(); const survivor = frame({ frame: 9, currentSelectedDies: false });
  const noAcceptable = frame({ frame: 10, branches: [branch({ acceptable: false })] });
  const lower = frame({ frame: 11, branches: [branch({ dominated: false, robustLower: 5 })] });
  const floor = frame({ frame: 12, branches: [branch({ dominated: false, robustLower: 20 })] });
  const report = { results: [{ role: "PRIMARY_LOSS", fingerprint: "capsule", matchId: "match",
    historicalMatchUrlId: "match", frames: [dominated, survivor, noAcceptable, lower, floor] }] };
  const result = analyzeReport(report);
  assert.equal(result.denominator.avoidableFrames, 5);
  assert.equal(Object.values(result.selectionBuckets).reduce((sum, value) => sum + value, 0), 5);
  assert.deepEqual(result.selectionBuckets, { DOMINATED_RESCUE: 1, CURRENT_SURVIVOR: 1,
    NO_ACCEPTABLE_RESCUE: 1, LOWER_ROBUST_RESCUE: 1, RESCUE_AT_OR_ABOVE_FLOOR: 1 });
  assert.equal(result.rootCauses[ROOT_CAUSE.POSSIBLE_AND_HIDDEN_SUPPORT], 1);
  assert.equal(result.cases[0].capsuleFingerprint, "capsule");
});
