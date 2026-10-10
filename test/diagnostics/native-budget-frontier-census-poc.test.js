"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { NativeBudgetFrontierCensusPoc } = require(
  "../../tools/agentank/diagnostics/native-budget-frontier-census-poc");

test("budget frontier census separates transition and node stops", () => {
  const census = new NativeBudgetFrontierCensusPoc("shadow");
  census.observeBudgetStop(1, 4, ACTION.GO, ACTION.FIRE, 1);
  census.observeBudgetStop(2, 5, ACTION.NONE, ACTION.NONE, 2);
  const summary = census.summary();
  assert.equal(summary.transitionBudgetStopByDepth[4], 1);
  assert.equal(summary.nodeBudgetStopByDepth[5], 1);
  assert.equal(summary.budgetStopByPolicy[1], 1);
  assert.equal(summary.budgetStopByPolicy[2], 1);
  assert.equal(summary.budgetStopByOwnAction[ACTION.GO], 1);
  assert.equal(summary.budgetStopByEnemyAction[ACTION.FIRE], 1);
  assert.equal(summary.frontierCensusHotAllocationCount, 0);
});
