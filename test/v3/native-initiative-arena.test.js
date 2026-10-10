"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CANDIDATE, engineOptions, summarize, compare } =
  require("../../tools/agentank/diagnostics/v2-native-initiative-arena");

function match(kind, outcome, seat = 0) {
  return {
    implementation: kind,
    analysisOutcome: outcome,
    candidateSeat: seat,
    counts: {
      stars: [seat === 0 ? 1 : 0, seat === 1 ? 1 : 0],
      crashes: [0, 0],
      bullets: [seat === 0 ? 1 : 0, seat === 1 ? 1 : 0],
      bombs: [0, 0],
      skills: [0, 0]
    },
    candidate: {
      actionCounts: { FIRE: 1 },
      totalRuntimeMicros: 10,
      p95RuntimeMicros: 10,
      timeoutCount: 0,
      errorCount: 0,
      layerTotals: {
        avoidableHardRejects: 0,
        riskDominatedSelections: 0,
        depthRootRestoreFailures: 0
      },
    },
    candidateEngine: {
      layerTotals: {
        avoidableHardRejects: 0,
        riskDominatedSelections: 0,
        depthRootRestoreFailures: 0
      },
      nativeInitiative: { selectCount: kind === CANDIDATE.INITIATIVE ? 1 : 0 }
    },
    control: {
      actionCounts: { GO: 1 },
      totalRuntimeMicros: 10,
      p95RuntimeMicros: 10
    }
  };
}

test("native initiative arena keeps current and candidate identities separate", () => {
  const current = summarize([
    match(CANDIDATE.CURRENT, "V1_WIN", 0),
    match(CANDIDATE.CURRENT, "V1_WIN", 1)
  ], CANDIDATE.CURRENT);
  const initiative = summarize([
    match(CANDIDATE.INITIATIVE, "V2_WIN", 0),
    match(CANDIDATE.INITIATIVE, "V2_WIN", 1)
  ], CANDIDATE.INITIATIVE);
  const delta = compare(current, initiative);
  assert.equal(current.scoreBasisPoints, 0);
  assert.equal(initiative.scoreBasisPoints, 10000);
  assert.equal(delta.scoreBasisPointDelta, 10000);
  assert.equal(delta.positive, true);
});

test("strict rescue arena reproduces legacy ownership and isolates final-only rescue", () => {
  assert.deepEqual(engineOptions(CANDIDATE.LEGACY_EARLY_ESCAPE), {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: false,
    verifiedDirectKillEnabled: false
  });
  assert.deepEqual(engineOptions(CANDIDATE.STRICT_FINAL_RESCUE), {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: false
  });
  assert.deepEqual(engineOptions(CANDIDATE.FINAL_ONLY_RESCUE), {
    diagnosticLegacyEarlyEscapeRestriction: false,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: false
  });
  assert.deepEqual(engineOptions(CANDIDATE.VERIFIED_DIRECT_KILL), {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: true
  });
  assert.deepEqual(engineOptions(CANDIDATE.RESIDUAL_ATTACK_PROOF_SHADOW), {
    diagnosticLegacyEarlyEscapeRestriction: true,
    strictCommittedRescueEnabled: true,
    verifiedDirectKillEnabled: true,
    diagnosticResidualAttackProof: true,
    diagnosticResidualAttackProofDepth: 4,
    diagnosticResidualAttackProofBudget: 256
  });
  assert.deepEqual(engineOptions(CANDIDATE.CURRENT), {});
});
