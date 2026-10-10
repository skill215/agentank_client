"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, terminalEquivalent } =
  require("../../tools/agentank/diagnostics/stateful-option-causal-report");

function label(row, outcome, stars = 0) {
  return { row, action: { type: row === 0 ? "go" : row === 1 ? "fire" : "turn",
    side: row === 2 ? "left" : undefined }, optionRollout: {
    physicalComplete: true, rootRestored: true, hardFatal: false },
  acceptable: true, dominated: false, expectedValue: row * 100,
  robustLower: row * 50, terminal: {
    outcome, candidateStars: stars, controlStars: 0,
    candidateCrashed: outcome === "V1_WIN",
    controlCrashed: outcome === "V2_WIN" } };
}

test("option causal report compares shadow sequence rows with the current row", () => {
  const document = { fingerprint: "f", selectedReproductionMismatchCount: 0,
    matches: [{ scenarioFingerprint: "s", candidateSeat: 0,
      roots: [{ selectedRow: 0, optionRollout: { balancedRow: 2,
        combatRow: 1, positionRow: 2, resourceRow: 1 },
      labels: [label(0, "V1_WIN"), label(1, "V2_WIN"),
        label(2, "DRAW")] }] }] };
  const report = analyze([document], ["input.json"]);
  assert.equal(report.policies.CURRENT.scoreBasisPoints, 0);
  assert.equal(report.policies.COMBAT_OPTION.scoreBasisPoints, 10000);
  assert.equal(report.policies.COMBAT_OPTION.netUnits, 2);
  assert.equal(report.policies.VERIFIED_OPTION.netUnits, 2);
  assert.equal(report.policies.TRAJECTORY_VALUE_OPTION.netUnits, 2);
  assert.equal(report.policies.POSITION_OPTION.netUnits, 1);
  assert.equal(report.headToHead.resourceBetter, 1);
  assert.equal(report.selectedReproductionMismatchCount, 0);
});

test("option terminal equivalence ignores stable-row tie breaks", () => {
  assert.equal(terminalEquivalent(label(0, "DRAW", 1),
    label(2, "DRAW", 1)), true);
  assert.equal(terminalEquivalent(label(0, "DRAW", 1),
    label(2, "V2_WIN", 1)), false);
});
