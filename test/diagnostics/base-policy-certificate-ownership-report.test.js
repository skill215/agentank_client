"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { summary, compare } = require(
  "../../tools/agentank/diagnostics/base-policy-certificate-ownership-report");

function row(outcome, stream, proof = {}) {
  return { implementation: "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE",
    matchUrlId: "m", scenarioFingerprint: "f", candidateSeat: 0,
    seatSkills: ["stun", "stun"], analysisOutcome: outcome, frames: 2,
    result: { reason: "frameLimit" }, counts: { stars: [2, 1],
      crashes: [0, 0], skills: [1, 0] },
    candidate: { actionCounts: { fire: 1 },
      compactActionStream: Buffer.from(stream).toString("base64"),
      nativeCandidateForcedWin: proof } };
}

test("BP17 report reconciles outcomes and action transitions", () => {
  const baseline = { rows: [row("V2_WIN", [1, 2])] };
  const candidate = { rows: [row("V2_WIN", [1, 4], {
    proofCheckCount: 1, provenCount: 1, restoreFailureCount: 0 })] };
  assert.deepEqual(summary(candidate), { matches: 1, wins: 1, losses: 0,
    draws: 0, fire: 1, skills: 1, starDifference: 1,
    candidateDeaths: 0, opponentDeaths: 0, proofChecks: 1, proven: 1,
    exactDominance: 0, restoreFailures: 0, scoreBasisPoints: 10000 });
  const result = compare(baseline, candidate);
  assert.equal(result.streamDifferenceMatches, 1);
  assert.deepEqual(result.transitions, { "V2_WIN->V2_WIN": 1 });
  assert.deepEqual(result.differences[0].actionDifferences, [[1, 2, 4]]);
});
