"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  LOSS_STAGE,
  terminalBetter,
  bestLabel,
  lossStage,
  summarize
} = require("../../tools/agentank/diagnostics/root-counterfactual-report");

function terminal(outcome, candidateStars = 0, controlStars = 0) {
  return { outcome, candidateStars, controlStars, frame: 10 };
}

test("counterfactual terminal ordering is runtime-independent and star-aware", () => {
  assert.equal(terminalBetter(terminal("DRAW"), terminal("V1_WIN")), true);
  assert.equal(terminalBetter(terminal("V2_WIN"), terminal("DRAW")), true);
  assert.equal(terminalBetter(terminal("DRAW", 2, 1),
    terminal("DRAW", 1, 1)), true);
});

test("counterfactual report assigns the first action-loss ownership stage", () => {
  assert.equal(lossStage({ acceptable: false, dominated: false }),
    LOSS_STAGE.RISK_THRESHOLD);
  assert.equal(lossStage({ acceptable: true, dominated: true }),
    LOSS_STAGE.RISK_PARETO);
  assert.equal(lossStage({ acceptable: true, dominated: false }),
    LOSS_STAGE.POST_FRONTIER_OWNER);
});

test("counterfactual report counts a Pareto-eliminated winning action", () => {
  const labels = [
    { row: 0, action: { type: "fire" }, acceptable: true, dominated: false,
      terminal: terminal("V1_WIN"), horizonFatalMass: 0, escapeSlack: 1,
      robustLower: 100, expectedValue: 100, tacticalValue: 100 },
    { row: 1, action: { type: "turn", side: "left" }, acceptable: true,
      dominated: true, terminal: terminal("V2_WIN"), horizonFatalMass: 0,
      escapeSlack: 0, robustLower: 200, expectedValue: 200,
      tacticalValue: 200 }
  ];
  assert.equal(bestLabel(labels).row, 1);
  const value = summarize({
    physicalMatches: 1,
    matches: [{ matchUrlId: "m", candidateSeat: 0,
      roots: [{ frame: 4, selectedRow: 0, labels }] }]
  });
  assert.equal(value.rootsWithOutcomeBetterAction, 1);
  assert.deepEqual(value.lossStageCounts, { RISK_PARETO: 1 });
  assert.deepEqual(value.outcomeLossStageCounts, { RISK_PARETO: 1 });
  assert.deepEqual(value.starOnlyLossStageCounts, {});
  assert.equal(value.modelInversionCounts.escapeSlack, 1);
});
