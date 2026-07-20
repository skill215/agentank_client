"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, terminalMatrixGraph } = require("./helpers");

test("deep Value results preserve sound lower upper complete and incomplete reasons", () => {
  const graph = new search.InformationGraph();
  const left = graph.addLeaf(-3000, 4000, { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  const right = graph.addTerminal(0);
  const root = graph.addNode(search.NODE_KIND.OUR_DECISION, [left, right]);
  const value = new search.ValueSearch(graph);
  assert.equal(value.solve(root), search.SEARCH_STATUS.COMPLETE);
  assert.equal(value.lower[root], 0); assert.equal(value.upper[root], 4000);
  assert.equal(value.boundKind[root], search.BOUND_KIND.INTERVAL_COMPLETE);
  assert.equal(value.complete[root], 1); assert.ok(value.lower[root] <= value.upper[root]);
  assert.equal(value.solve(root, 1), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(value.lower[root], search.VALUE_MIN); assert.equal(value.upper[root], search.VALUE_MAX);
  assert.ok(value.reason[root] & search.INCOMPLETE.BUDGET);
});

test("ordinary evaluator ordering points never narrow the terminal game interval", () => {
  const graph = new search.InformationGraph();
  const leaf = graph.addLeaf(9000, 9000, { kind: search.LEAF_KIND.ORDINARY,
    orderingEstimate: 9000 }); const value = new search.ValueSearch(graph);
  assert.equal(value.solve(leaf), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(value.lower[leaf], search.VALUE_MIN); assert.equal(value.upper[leaf], search.VALUE_MAX);
  assert.equal(value.ordering[leaf], 9000); assert.equal(value.boundKind[leaf], search.BOUND_KIND.HEURISTIC_ONLY);
});

test("pure simultaneous bounds contain the exact mixed oracle and incomplete equality is not exact", () => {
  const rps = terminalMatrixGraph([[0, -1000, 1000], [1000, 0, -1000], [-1000, 1000, 0]]);
  const value = new search.ValueSearch(rps.graph); value.solve(rps.root);
  assert.equal(value.lower[rps.root], -1000); assert.equal(value.upper[rps.root], 1000);
  assert.ok(value.lower[rps.root] <= 0 && value.upper[rps.root] >= 0);
  const graph = new search.InformationGraph(); const exact = graph.addTerminal(0);
  const unknown = graph.addUnknown(); const root = graph.addSimultaneous(1, 2, [exact, unknown]);
  const incomplete = new search.ValueSearch(graph); incomplete.solve(root);
  assert.notEqual(incomplete.boundKind[root], search.BOUND_KIND.EXACT_COMPLETE);
  assert.equal(incomplete.complete[root], 0);
});

test("recursive epsilon contamination is integer outward monotone across chance hidden and enemy", () => {
  const graph = new search.InformationGraph(); const loss = graph.addTerminal(-10000);
  const win = graph.addTerminal(10000);
  const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME, [loss, win], [5000, 5000],
    { riskClass: 0 }); const value = new search.ValueSearch(graph);
  let previous = -10001;
  for (let risk = 0; risk <= 100; risk += 1) {
    value.solve(chance, 512, risk); assert.ok(value.lower[chance] >= previous); previous = value.lower[chance];
  }
  value.solve(chance, 512, 0); assert.equal(value.lower[chance], -10000);
  value.solve(chance, 512, 100); assert.equal(value.lower[chance], -100);
  const hidden = graph.addNode(search.NODE_KIND.HIDDEN_WORLD, [chance, win], [5000, 5000],
    { riskClass: 0 }); value.solve(hidden, 512, 100);
  assert.ok(value.lower[hidden] >= value.lower[chance]);
  const matrix = new search.StageMatrix(); matrix.initialize(1, 2);
  matrix.setCell(0, 0, -10000, -10000); matrix.setCell(0, 1, 10000, 10000);
  const q = new Uint16Array([5000, 5000]); const riskKernel = new search.RiskKernel();
  assert.equal(riskKernel.transformEnemyMatrix(matrix, q, 100, 0), search.SEARCH_STATUS.COMPLETE);
  assert.equal(matrix.riskLower[0], -100); assert.equal(matrix.riskLower[1], 100);
});

test("risk profile state classification is deterministic bounded and never changes strict graph data", () => {
  const profile = new search.RiskProfile();
  const a = profile.classify(1, 4, 2, 0, 2, 2); const b = profile.classify(1, 4, 2, 0, 2, 2);
  assert.equal(a, b); assert.equal(profile.lambda(0, a, search.RISK_DIMENSION.CHANCE_OUTCOME), 0);
  assert.ok(profile.lambda(100, 0, search.RISK_DIMENSION.CHANCE_OUTCOME) <= 9900);
  for (let risk = 1; risk <= 100; risk += 1) assert.ok(profile.lambda(risk, a, 0) >=
    profile.lambda(risk - 1, a, 0));
});
