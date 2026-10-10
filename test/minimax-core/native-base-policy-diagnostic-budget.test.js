"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NativeBasePolicyDiagnosticBot } = require(
  "../../tools/agentank/diagnostics/native-base-policy-standalone-arena");

test("diagnostic node budgets reuse the generic policy search as depth facade", () => {
  const bot = new NativeBasePolicyDiagnosticBot({ nodeBudget: 256,
    targetDepth: 3, rootBudgetMode: "cell-equal" });
  const search = bot.engine.basePolicy.policySearch;
  assert.equal(search.nodeBudget, 256);
  assert.equal(search.targetDepth, 3);
  assert.equal(search.rootBudgetMode, "cell-equal");
  assert.equal(bot.engine.depthSearch, search);
  assert.equal(search.target, search.targetCell);
  assert.equal(search.walkable, search.positionWalkable);
  assert.equal(typeof search.heuristic, "function");
  assert.equal(typeof search.terminalValue, "function");
  assert.equal(typeof search.chanceAlternatives, "function");
});
