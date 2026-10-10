"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ROOT_CAUSE, matrixQuality, bestPolicyQuality, analyze } =
  require("../../tools/agentank/diagnostics/decision-quality-arena");

function terminal(outcome, stars = 0) {
  return { outcome, candidateStars: stars, controlStars: 0,
    candidateCrashed: outcome === "V1_WIN",
    controlCrashed: outcome === "V2_WIN" };
}

function label(row, values, extra = {}) {
  const policies = ["V2", "V3"];
  const cells = [];
  for (const ownPolicy of policies)
    for (const enemyPolicy of policies)
      cells.push({ ownPolicy, enemyPolicy,
        terminal: terminal(values[`${ownPolicy}:${enemyPolicy}`] || "DRAW") });
  return { row, action: { type: row ? "fire" : "go" }, acceptable: true,
    dominated: false, searchMinimum: row ? 20 : 10, robustLower: row ? 20 : 10,
    responseMatrix: { policies, cells }, ...extra };
}

test("response matrix keeps adversarial and controllable policy dimensions separate", () => {
  const candidate = label(0, { "V2:V2": "V1_WIN", "V2:V3": "DRAW",
    "V3:V2": "V2_WIN", "V3:V3": "V2_WIN" });
  assert.deepEqual(matrixQuality(candidate, "V2"), {
    ownPolicy: "V2", cells: 2, robustUnits: 0, robustStarDelta: 0,
    totalUnits: 1, totalStarDelta: 0
  });
  assert.equal(bestPolicyQuality(candidate).ownPolicy, "V3");
  assert.equal(bestPolicyQuality(candidate).robustUnits, 2);
});

test("layered regret attributes risk removal before search and arbitration", () => {
  const selected = label(0, { "V2:V2": "V1_WIN", "V2:V3": "V1_WIN",
    "V3:V2": "V1_WIN", "V3:V3": "V1_WIN" }, { searchMinimum: 30 });
  const better = label(1, { "V2:V2": "V2_WIN", "V2:V3": "DRAW",
    "V3:V2": "V2_WIN", "V3:V3": "V2_WIN" },
  { acceptable: false, searchMinimum: 10 });
  const document = { fingerprint: "fixture", supportKind: "RESET",
    responsePolicies: ["V2", "V3"], matches: [{ matchUrlId: "m",
      scenarioFingerprint: "s", candidateSeat: 0, roots: [{ frame: 4,
        selectedRow: 0, searchEvidence: { source: "PHYSICAL",
          physical: { completedDepth: 2 } }, labels: [selected, better] }] }] };
  const report = analyze(document);
  assert.equal(report.causes[ROOT_CAUSE.RISK_THRESHOLD_REMOVAL], 1);
  assert.equal(report.firstActionRegretRoots, 1);
  assert.equal(report.completeMatrixRoots, 1);
  assert.equal(report.actionTransitions["go>fire"], 1);
});

test("same first action with a stronger continuation is a continuation gap", () => {
  const selected = label(0, { "V2:V2": "V1_WIN", "V2:V3": "V1_WIN",
    "V3:V2": "V2_WIN", "V3:V3": "V2_WIN" });
  const report = analyze({ responsePolicies: ["V2", "V3"], matches: [{
    roots: [{ selectedRow: 0, searchEvidence: { source: "NONE" },
      labels: [selected] }] }] });
  assert.equal(report.causes[ROOT_CAUSE.CONTINUATION_POLICY_GAP], 1);
  assert.equal(report.firstActionRegretRoots, 0);
  assert.equal(report.continuationRegretRoots, 1);
});

test("a value inversion without a completed search is not blamed on Minimax", () => {
  const selected = label(0, { "V2:V2": "V1_WIN", "V2:V3": "V1_WIN",
    "V3:V2": "V1_WIN", "V3:V3": "V1_WIN" },
  { robustLower: 90, searchMinimum: 90 });
  const better = label(1, { "V2:V2": "V2_WIN", "V2:V3": "V2_WIN",
    "V3:V2": "V2_WIN", "V3:V3": "V2_WIN" },
  { robustLower: 10, searchMinimum: 10 });
  const report = analyze({ responsePolicies: ["V2", "V3"], matches: [{
    roots: [{ selectedRow: 0, searchEvidence: { source: "NONE" },
      labels: [selected, better] }] }] });
  assert.equal(report.causes[ROOT_CAUSE.VALUE_MODEL_INVERSION_NO_SEARCH], 1);
  assert.equal(report.causes[ROOT_CAUSE.SEARCH_VALUE_INVERSION] || 0, 0);
});
