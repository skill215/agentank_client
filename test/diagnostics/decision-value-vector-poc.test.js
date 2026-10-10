"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROFILE, vector, select, analyze } =
  require("../../tools/agentank/diagnostics/decision-value-vector-poc");

function label(row, action, outcome, extra = {}) {
  return { row, action: { type: action }, acceptable: true, dominated: false,
    robustLower: row, expectedValue: row, tacticalValue: row,
    immediateFatalMass: 0, horizonFatalMass: 0, unknownMass: 0,
    ownCounterExposure: 0, postFireEscape: 4, purposeCompleteness: 0,
    enemySafeSuccessors: 0, projectedMobility: 4, projectedStarProgress: 0,
    responseMatrix: { policies: ["V2", "V3"], cells: [
      { ownPolicy: "V2", enemyPolicy: "V2", terminal: { outcome,
        candidateStars: 0, controlStars: 0 } },
      { ownPolicy: "V2", enemyPolicy: "V3", terminal: { outcome,
        candidateStars: 0, controlStars: 0 } }
    ] }, ...extra };
}

test("risk-combat vector is integer lexicographic and keeps risk before value", () => {
  const safe = label(0, "go", "DRAW", { robustLower: -100 });
  const risky = label(1, "fire", "V2_WIN", { robustLower: 100,
    horizonFatalMass: 1, possibleHit: true });
  assert.ok(vector(safe, PROFILE.RISK_COMBAT_LEX)[1] >
    vector(risky, PROFILE.RISK_COMBAT_LEX)[1]);
  assert.equal(select({ selectedRow: 1, labels: [safe, risky] },
    PROFILE.RISK_COMBAT_LEX).row, 0);
});

test("value-vector report only advances a profile with score and robust gain", () => {
  const loss = label(0, "poison", "V1_WIN", { robustLower: 10 });
  const draw = label(1, "go", "DRAW", { robustLower: 20 });
  const report = analyze({ fingerprint: "f", matches: [{ roots: [{
    selectedRow: 0, labels: [loss, draw]
  }] }] });
  assert.equal(report.profiles.FRONTIER_ROBUST.scoreDeltaBasisPoints, 5000);
  assert.equal(report.profiles.FRONTIER_ROBUST.advance, true);
});
