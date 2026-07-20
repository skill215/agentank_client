"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, forEachVector, exactLeaf, terminalMatrixGraph } = require("./helpers");

test("ValueSearch matches an independent exhaustive max-min oracle on alternating trees", () => {
  let cases = 0;
  forEachVector(4, values => {
    let graph = new search.InformationGraph(); const leaves = Array.from(values,
      value => exactLeaf(graph, value));
    const enemy0 = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [leaves[0], leaves[1]]);
    const enemy1 = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [leaves[2], leaves[3]]);
    let root = graph.addNode(search.NODE_KIND.OUR_DECISION, [enemy0, enemy1]);
    let solved = new search.ValueSearch(graph); assert.equal(solved.solve(root), search.SEARCH_STATUS.COMPLETE);
    let expected = Math.max(Math.min(values[0], values[1]), Math.min(values[2], values[3]));
    assert.equal(solved.lower[root], expected); assert.equal(solved.upper[root], expected);

    graph = new search.InformationGraph(); const reverseLeaves = Array.from(values,
      value => exactLeaf(graph, value));
    const our0 = graph.addNode(search.NODE_KIND.OUR_DECISION, [reverseLeaves[0], reverseLeaves[1]]);
    const our1 = graph.addNode(search.NODE_KIND.OUR_DECISION, [reverseLeaves[2], reverseLeaves[3]]);
    root = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [our0, our1]);
    solved = new search.ValueSearch(graph); assert.equal(solved.solve(root), search.SEARCH_STATUS.COMPLETE);
    expected = Math.min(Math.max(values[0], values[1]), Math.max(values[2], values[3]));
    assert.equal(solved.lower[root], expected); assert.equal(solved.upper[root], expected); cases += 2;
  });
  assert.equal(cases, 162);
});

test("ValueSearch simultaneous intervals match exhaustive pure maximin/minimax bounds", () => {
  let cases = 0;
  forEachVector(4, values => {
    const fixture = terminalMatrixGraph(values); const solved = new search.ValueSearch(fixture.graph);
    assert.equal(solved.solve(fixture.root), search.SEARCH_STATUS.COMPLETE);
    const lower = Math.max(Math.min(values[0], values[1]), Math.min(values[2], values[3]));
    const upper = Math.min(Math.max(values[0], values[2]), Math.max(values[1], values[3]));
    assert.equal(solved.lower[fixture.root], lower); assert.equal(solved.upper[fixture.root], upper);
    assert.ok(lower <= upper); cases += 1;
  });
  assert.equal(cases, 81);
});

test("recursive chance and hidden-world robust backup matches independent integer arithmetic", () => {
  const probabilitySets = [[5000, 5000], [2500, 7500], [1, 9999]];
  const risks = [0, 1, 50, 100]; let cases = 0;
  forEachVector(2, values => {
    for (const probabilities of probabilitySets) for (const risk of risks) {
      const graph = new search.InformationGraph(); const left = exactLeaf(graph, values[0]);
      const right = exactLeaf(graph, values[1]);
      const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME, [left, right], probabilities);
      const solved = new search.ValueSearch(graph); solved.solve(chance, 32, risk);
      const weighted = probabilities[0] * values[0] + probabilities[1] * values[1];
      const expectedLower = Math.floor(weighted / 10000);
      const expectedUpper = Math.ceil(weighted / 10000); const worst = Math.min(...values);
      const lambda = 99 * risk;
      const lower = Math.floor((lambda * expectedLower + (10000 - lambda) * worst) / 10000);
      const upper = Math.ceil((lambda * expectedUpper + (10000 - lambda) * worst) / 10000);
      assert.equal(solved.lower[chance], lower); assert.equal(solved.upper[chance], upper);
      assert.ok(solved.lower[chance] <= solved.upper[chance]); cases += 1;
    }
  });
  assert.equal(cases, 108);
});

test("decision interval propagation and observation envelopes preserve sound bounds", () => {
  const graph = new search.InformationGraph();
  const a = graph.addLeaf(-8000, -1000, { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  const b = graph.addLeaf(-2000, 4000, { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  const c = graph.addLeaf(1000, 7000, { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  const ours = graph.addNode(search.NODE_KIND.OUR_DECISION, [a, b, c]);
  const enemy = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [a, b, c]);
  const observation = graph.addNode(search.NODE_KIND.OBSERVATION_SPLIT, [ours, enemy]);
  const solved = new search.ValueSearch(graph); solved.solve(observation);
  assert.deepEqual([solved.lower[ours], solved.upper[ours]], [1000, 7000]);
  assert.deepEqual([solved.lower[enemy], solved.upper[enemy]], [-8000, -1000]);
  assert.deepEqual([solved.lower[observation], solved.upper[observation]], [-8000, 7000]);
  assert.equal(solved.complete[observation], 1);
});

test("ValueSearch node budget counts only the root-reachable subgraph", () => {
  const graph = new search.InformationGraph();
  for (let index = 0; index < 24; index += 1) graph.addTerminal(index % 2 ? 0 : search.VALUE_MIN);
  const loss = graph.addTerminal(search.VALUE_MIN); const win = graph.addTerminal(search.VALUE_MAX);
  const root = graph.addNode(search.NODE_KIND.OUR_DECISION, [loss, win]);
  const solved = new search.ValueSearch(graph);
  assert.equal(solved.solve(root, 3), search.SEARCH_STATUS.COMPLETE);
  assert.equal(solved.visitedNodes, 3); assert.equal(solved.lower[root], search.VALUE_MAX);
  assert.equal(solved.solve(root, 2), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(solved.lower[root], search.VALUE_MIN); assert.equal(solved.upper[root], search.VALUE_MAX);
});

test("unknown or incomplete dependencies never become an exact complete Value result", () => {
  const graph = new search.InformationGraph(); const exact = graph.addTerminal(0);
  const unknown = graph.addUnknown(); const root = graph.addNode(search.NODE_KIND.OUR_DECISION,
    [exact, unknown], null, { supportComplete: false });
  const solved = new search.ValueSearch(graph); assert.equal(solved.solve(root),
    search.SEARCH_STATUS.INCOMPLETE); assert.equal(solved.complete[root], 0);
  assert.notEqual(solved.boundKind[root], search.BOUND_KIND.EXACT_COMPLETE);
  assert.ok(solved.reason[root] & search.INCOMPLETE.SUPPORT);
  assert.ok(solved.reason[root] & search.INCOMPLETE.UNKNOWN_RULE);
});
