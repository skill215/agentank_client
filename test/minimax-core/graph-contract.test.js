"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { search } = require("./helpers");

test("Minimax graph rejects empty, truncated, forward, fractional, and malformed quantified support", () => {
  const graph = new search.InformationGraph(); const win = graph.addTerminal(search.VALUE_MAX);
  const beforeNodes = graph.nodeCount; const beforeEdges = graph.edgeUsed;
  assert.equal(graph.addNode(search.NODE_KIND.HIDDEN_WORLD, []), search.NONE_NODE);
  assert.equal(graph.addNode(search.NODE_KIND.OUR_DECISION, [win], null,
    { childCount: 2 }), search.NONE_NODE);
  assert.equal(graph.addNode(search.NODE_KIND.CHANCE_OUTCOME, [win], [10000.5]), search.NONE_NODE);
  assert.equal(graph.addNode(search.NODE_KIND.AUTOMATIC, [win, win]), search.NONE_NODE);
  assert.equal(graph.addNode(search.NODE_KIND.ENEMY_DECISION, [graph.nodeCount]), search.NONE_NODE);
  assert.equal(graph.addLeaf(0.5, 1), search.NONE_NODE);
  assert.equal(graph.nodeCount, beforeNodes); assert.equal(graph.edgeUsed, beforeEdges);
  assert.ok(graph.overflowReason & search.INCOMPLETE.SUPPORT);
});

test("Minimax graph marks the exact missing support quantifier", () => {
  const kinds = [
    [search.NODE_KIND.OUR_DECISION, search.COVERAGE.OUR_ACTIONS],
    [search.NODE_KIND.ENEMY_DECISION, search.COVERAGE.ENEMY_POLICIES],
    [search.NODE_KIND.HIDDEN_WORLD, search.COVERAGE.WORLDS],
    [search.NODE_KIND.CHANCE_OUTCOME, search.COVERAGE.CHANCE],
    [search.NODE_KIND.OBSERVATION_SPLIT, search.COVERAGE.OBSERVATIONS]
  ];
  for (const [kind, bit] of kinds) {
    const graph = new search.InformationGraph(); const leaf = graph.addTerminal(0);
    const node = graph.addNode(kind, [leaf], kind === search.NODE_KIND.CHANCE_OUTCOME ? [10000] : null,
      { supportComplete: false });
    assert.notEqual(node, search.NONE_NODE); assert.equal(graph.coverageMask[node] & bit, 0);
    const proof = new search.ProofSearch(graph);
    assert.equal(proof.solve(node, search.PROOF_GOAL.FORCED_NONLOSS), search.PROOF_STATUS.UNKNOWN);
  }
});

test("StageMatrix reuse resets every active cell to a conservative incomplete interval", () => {
  const matrix = new search.StageMatrix({ maxRows: 2, maxColumns: 2 }); matrix.initialize(2, 2);
  for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1)
    matrix.setCell(row, column, 777, 777, 1);
  matrix.initialize(2, 2); matrix.setCell(0, 0, 0, 0, 1); matrix.computePureBounds();
  assert.equal(matrix.complete[1], 0); assert.equal(matrix.lower[1], search.VALUE_MIN);
  assert.equal(matrix.upper[1], search.VALUE_MAX); assert.equal(matrix.allCellsComplete, 0);
});

test("RiskKernel invalid input clears stale scalar results and stale matrix transforms", () => {
  const kernel = new search.RiskKernel(); const child = new Uint16Array([0, 1]);
  const probability = new Uint16Array([5000, 5000]);
  const lower = new Int16Array([-10000, 10000]); const upper = new Int16Array(lower);
  assert.equal(kernel.backupIndexed(2, 0, child, probability, lower, upper, 100, 0,
    search.RISK_DIMENSION.CHANCE_OUTCOME), search.SEARCH_STATUS.COMPLETE);
  assert.notEqual(kernel.expectedLower, search.VALUE_MIN);
  assert.equal(kernel.backupIndexed(2, 0, child, probability, lower, upper, 50.5, 0,
    search.RISK_DIMENSION.CHANCE_OUTCOME), search.SEARCH_STATUS.INCOMPLETE);
  assert.deepEqual([kernel.lower, kernel.upper, kernel.expectedLower, kernel.expectedUpper],
    [search.VALUE_MIN, search.VALUE_MAX, search.VALUE_MIN, search.VALUE_MAX]);
  const matrix = new search.StageMatrix({ maxRows: 1, maxColumns: 2 }); matrix.initialize(1, 2);
  matrix.setCell(0, 0, -1000, -1000); matrix.setCell(0, 1, 1000, 1000);
  assert.equal(kernel.transformEnemyMatrix(matrix, probability, 100, 0), search.SEARCH_STATUS.COMPLETE);
  assert.equal(matrix.riskTransformed, 1);
  assert.equal(kernel.transformEnemyMatrix(matrix, new Uint16Array([1, 1]), 100, 0),
    search.SEARCH_STATUS.INCOMPLETE); assert.equal(matrix.riskTransformed, 0);
});

test("SearchEngine honors explicit zero budgets and rejects fractional risk", () => {
  const graph = new search.InformationGraph(); const leaf = graph.addLeaf(-100, 100,
    { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  let engine = new search.SearchEngine(graph);
  assert.equal(engine.solveRoot(leaf, { proofBudget: 0, nodeBudget: 0 }),
    search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(engine.proof.visitedNodes, 0); assert.equal(engine.value.visitedNodes, 0);
  engine = new search.SearchEngine(graph);
  assert.equal(engine.solveRoot(leaf, { baseRisk: 0.5 }), search.SEARCH_STATUS.INVALID);
});

test("a proven OUR_DECISION root publishes the winning action policy", () => {
  const graph = new search.InformationGraph(); const win = graph.addTerminal(search.VALUE_MAX);
  const loss = graph.addTerminal(search.VALUE_MIN);
  const root = graph.addNode(search.NODE_KIND.OUR_DECISION, [loss, win]);
  const engine = new search.SearchEngine(graph); assert.equal(engine.solveRoot(root),
    search.SEARCH_STATUS.COMPLETE); assert.notEqual(engine.lastPolicyHandle, search.NONE_NODE);
  const start = engine.policyArena.entryStart[engine.lastPolicyHandle];
  assert.equal(engine.policyArena.action[start], 1);
  assert.equal(engine.policyArena.probability[start], search.PROBABILITY_SCALE);
});

test("Minimax hot core contains no random source, clocks, or floating TypedArrays", () => {
  const directory = path.join(__dirname, "../../engine-v2/src/search");
  const files = ["graph.js", "value-search.js", "proof-search.js", "matrix.js", "risk.js",
    "engine.js", "production-depth-search.js", "production-information-search.js"];
  const source = files.map(file => fs.readFileSync(path.join(directory, file), "utf8")).join("\n");
  assert.doesNotMatch(source, /Math\.random|Date\.now|Float32Array|Float64Array/);
});
