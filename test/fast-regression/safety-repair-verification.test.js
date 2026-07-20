"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareSafetyRepair } =
  require("../../tools/agentank/fast-regression/safety-repair-verification");

function diagnostic(fingerprint, modelClass, options = {}) {
  return { fingerprint, cohort: { fingerprint: "cohort" }, execution: { failures: 0 },
    primary: { oneStepProvenSafeContradictions: options.oneStep ?? 0,
      modelProvenSafeFixedContinuationFatalFrames: modelClass.includes("PROVEN_SAFE") ? 1 : 0,
      actionReproductionFailures: 0, exactReplayFailures: 0 },
    controls: { exactReplayFailures: 0, controlSurvivalRegressions: 0 }, results: [{
      fingerprint: "capsule", frames: [{ frame: 7, modelClass,
        selectedCandidate: { hard: "ALLOW", safety: options.safety || "POSSIBLE_DEATH",
          chanceSupportCount: options.support ?? 2, chanceFatalSupportCount: options.fatal ?? 1 } }] }] };
}

test("Safety repair verifier accepts Chance reclassification without converting risk to Hard", () => {
  const before = diagnostic("before", "MODEL_PROVEN_SAFE_FIXED_CONTINUATION_DIES",
    { oneStep: 1, safety: "PROVEN_SAFE", support: 0, fatal: 0 });
  const after = diagnostic("after", "MODEL_POSSIBLE_DEATH_FIXED_CONTINUATION_DIES");
  const corpus = { source: { reportFingerprint: "before", cohortFingerprint: "cohort" },
    strict: [{ capsuleFingerprint: "capsule", frame: 7, distanceToTerminal: 0,
      defectClass: "STRICT_ONE_STEP_CONTRADICTION" }], continuationCandidates: [] };
  const result = compareSafetyRepair(corpus, before, after);
  assert.equal(result.status, "ACCEPTED");
  assert.ok(result.checks.every(item => item.status === "PASS"));
  assert.equal(result.delta.provenSafeFatalFrames, -1);
});
