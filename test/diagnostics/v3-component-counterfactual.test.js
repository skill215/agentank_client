"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { candidateOutcome, compareMatches } =
  require("../../tools/agentank/diagnostics/v3-component-counterfactual");

function match(seat, actions, crashes, stars, winnerSeat, reason = "crashed") {
  return { scenarioFingerprint: "scenario", candidateSeat: seat, frames: actions.length,
    result: { winnerSeat, reason }, counts: { crashes, stars },
    candidate: { compactActionStream: Buffer.from(actions).toString("base64") },
    candidateController: { tacticalCore: { firstPhysicalCellFrame: 1,
      firstPhysicalCellLegacyAction: 1, firstPhysicalCellCandidateAction: 3,
      firstPhysicalCellDepth: 2, firstPhysicalCellLegacyValue: 0,
      firstPhysicalCellCandidateValue: 50, firstPhysicalCellMinimumMargin: 50 } } };
}

test("counterfactual outcome is candidate-seat relative and ignores implementation ids", () => {
  const value = match(1, [1], [0, 1], [0, 0], 0);
  value.comparison = { challengerImplementation: "SAME", controlImplementation: "SAME" };
  value.seatImplementations = ["SAME", "SAME"];
  assert.equal(candidateOutcome(value).outcome, "LOSS");
});

test("counterfactual report aligns seats and records outcome-neutral survival gains", () => {
  const baseline = match(0, [1, 1, 1], [1, 0], [0, 1], 1);
  const candidate = match(0, [1, 3, 1, 1], [0, 0], [0, 1], 1, "frameLimit");
  const report = compareMatches([candidate], [baseline]);
  assert.deepEqual(report.transitions, { "LOSS->LOSS": 1 });
  assert.equal(report.changedActionMatches, 1);
  assert.equal(report.details[0].firstDifference.firstFrame, 1);
  assert.equal(report.details[0].firstDifference.beforeActionName, "GO");
  assert.equal(report.details[0].firstDifference.afterActionName, "RIGHT");
  assert.equal(report.details[0].terminalQuality, "IMPROVED");
});

test("counterfactual report rejects incomplete alignment", () => {
  const baseline = match(0, [1], [0, 1], [0, 0], 0);
  const candidate = match(1, [1], [1, 0], [0, 0], 1);
  assert.throws(() => compareMatches([candidate], [baseline]),
    /COUNTERFACTUAL_BASELINE_MISSING/);
});
