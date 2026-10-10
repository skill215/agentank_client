"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { outcomeUnits, terminalBetter, actionName, analyze } =
  require("../../tools/agentank/diagnostics/root-counterfactual-causal-report");

function label(row, action, outcome, expectedValue, stars = [0, 0]) {
  return { row, action, expectedValue, terminal: { outcome,
    candidateStars: stars[0], controlStars: stars[1],
    candidateCrashed: false, controlCrashed: outcome === "V2_WIN" } };
}

test("causal ordering prioritizes runtime-independent outcome before stars", () => {
  const win = label(1, { type: "fire" }, "V2_WIN", -10, [0, 2]);
  const draw = label(0, { type: "go" }, "DRAW", 10, [4, 4]);
  assert.equal(outcomeUnits(win.terminal), 2);
  assert.equal(terminalBetter(win, draw), true);
  assert.equal(actionName({ action: { type: "turn", side: "left" } }),
    "turn:left");
});

test("causal report accounts earliest recoverable roots and score inversions", () => {
  const selected = label(0, { type: "go" }, "V1_WIN", 500);
  const better = label(1, { type: "throwBomb" }, "V2_WIN", -100);
  const report = analyze([{
    fingerprint: "input",
    selectedReproductionMismatchCount: 0,
    matches: [{
      matchUrlId: "m1", scenarioFingerprint: "s1", candidateSeat: 0,
      baseline: { outcome: "V1_WIN" },
      roots: [{ frame: 16, selectedRow: 0, controlMode: 2,
        searchEvidence: { source: "INFORMATION", ownEnemyDistance: 3 },
        labels: [selected, better] }]
    }]
  }], ["input.json"]);
  assert.equal(report.matches, 1);
  assert.equal(report.roots, 1);
  assert.equal(report.recoverableRoots, 1);
  assert.equal(report.earliestRecoverableMatches, 1);
  assert.equal(report.scoreInversionCount, 1);
  assert.equal(report.transitions["go>throwBomb"], 1);
  assert.equal(report.frameSummaries[0].selectedScoreBasisPoints, 0);
  assert.equal(report.frameSummaries[0].oracleScoreBasisPoints, 10000);
});
