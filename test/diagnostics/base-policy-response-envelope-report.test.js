"use strict";

const assert = require("node:assert/strict");
const { analyze, firstDivergence } = require(
  "../../tools/agentank/diagnostics/base-policy-response-envelope-report");

function match(fingerprint, seat, outcome, actions, stars = 0, crashes = 0) {
  return { implementation: "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE",
    matchUrlId: fingerprint, scenarioFingerprint: fingerprint,
    candidateSeat: seat, analysisOutcome: outcome, terminalCategory: "TEST",
    counts: { stars: seat ? [0, stars] : [stars, 0],
      crashes: seat ? [0, crashes] : [crashes, 0] },
    candidate: { compactActionStream: Buffer.from(actions).toString("base64") } };
}

assert.equal(firstDivergence(Buffer.from([1, 2]), Buffer.from([1, 3])), 1);
assert.equal(firstDivergence(Buffer.from([1, 2]), Buffer.from([1, 2])), -1);

const report = analyze([
  match("a", 0, "V1_WIN", [1, 2], 0, 1),
  match("b", 1, "V2_WIN", [4, 1], 2, 0)
], [
  match("a", 0, "V2_WIN", [1, 4], 1, 0),
  match("b", 1, "DRAW", [4, 1], 2, 1)
]);

assert.equal(report.comparableMatches, 2);
assert.equal(report.improvedMatches, 1);
assert.equal(report.regressedMatches, 1);
assert.equal(report.netUnits, 1);
assert.equal(report.netStars, 1);
assert.equal(report.netCrashes, 0);
assert.equal(report.divergentActionStreams, 1);
assert.equal(report.exactActionStreams, 1);
assert.equal(report.firstActionTransitions.TURN_LEFT_TO_FIRE, 1);
assert.equal(report.outcomeTransitions.V1_WIN_TO_V2_WIN, 1);
assert.equal(report.outcomeTransitions.V2_WIN_TO_DRAW, 1);
assert.ok(report.fingerprint);

process.stdout.write("base policy response envelope report tests passed\n");
