"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, forEachVector, exactLeaf, terminalMatrixGraph,
  terminalPredicate, proofBoolean } = require("./helpers");

const GOALS = [search.PROOF_GOAL.FORCED_WIN, search.PROOF_GOAL.FORCED_NONLOSS,
  search.PROOF_GOAL.FORCED_LOSS];

test("ProofSearch matches independent simultaneous quantifiers for every 2x2 terminal game", () => {
  let cases = 0;
  forEachVector(4, values => {
    const fixture = terminalMatrixGraph(values); const proof = new search.ProofSearch(fixture.graph);
    for (const goal of GOALS) {
      const predicate = Array.from(values, value => terminalPredicate(value, goal));
      let expected;
      if (goal === search.PROOF_GOAL.FORCED_LOSS)
        expected = (predicate[0] && predicate[2]) || (predicate[1] && predicate[3]);
      else expected = (predicate[0] && predicate[1]) || (predicate[2] && predicate[3]);
      proof.coverageArena.used = 0;
      assert.equal(proof.solve(fixture.root, goal), expected ? search.PROOF_STATUS.PROVEN :
        search.PROOF_STATUS.DISPROVEN, `${Array.from(values)} goal=${goal}`); cases += 1;
    }
  });
  assert.equal(cases, 243);
});

test("ProofSearch matches independent alternating AND/OR quantifiers for every terminal assignment", () => {
  let cases = 0;
  forEachVector(4, values => {
    for (const goal of GOALS) {
      const graph = new search.InformationGraph(); const leaves = Array.from(values,
        value => exactLeaf(graph, value));
      const enemy0 = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [leaves[0], leaves[1]]);
      const enemy1 = graph.addNode(search.NODE_KIND.ENEMY_DECISION, [leaves[2], leaves[3]]);
      const root = graph.addNode(search.NODE_KIND.OUR_DECISION, [enemy0, enemy1]);
      const terminal = Array.from(values, value => terminalPredicate(value, goal));
      const expected = proofBoolean(search.NODE_KIND.OUR_DECISION, goal, [
        proofBoolean(search.NODE_KIND.ENEMY_DECISION, goal, terminal.slice(0, 2)),
        proofBoolean(search.NODE_KIND.ENEMY_DECISION, goal, terminal.slice(2, 4))
      ]);
      const proof = new search.ProofSearch(graph);
      assert.equal(proof.solve(root, goal), expected ? search.PROOF_STATUS.PROVEN :
        search.PROOF_STATUS.DISPROVEN); cases += 1;
    }
  });
  assert.equal(cases, 243);
});

test("HiddenWorld, ChanceOutcome, and ObservationSplit are strict AND support quantifiers", () => {
  const kinds = [search.NODE_KIND.HIDDEN_WORLD, search.NODE_KIND.CHANCE_OUTCOME,
    search.NODE_KIND.OBSERVATION_SPLIT]; let cases = 0;
  forEachVector(3, values => {
    for (const kind of kinds) for (const goal of GOALS) {
      const graph = new search.InformationGraph(); const children = Array.from(values,
        value => exactLeaf(graph, value));
      const probabilities = kind === search.NODE_KIND.CHANCE_OUTCOME ? [2500, 2500, 5000] : null;
      const root = graph.addNode(kind, children, probabilities);
      const expected = Array.from(values, value => terminalPredicate(value, goal)).every(Boolean);
      const proof = new search.ProofSearch(graph);
      assert.equal(proof.solve(root, goal), expected ? search.PROOF_STATUS.PROVEN :
        search.PROOF_STATUS.DISPROVEN); cases += 1;
    }
  });
  assert.equal(cases, 243);
});

test("incomplete support, assumptions, and unknown leaves force Proof UNKNOWN", () => {
  let graph = new search.InformationGraph(); let win = graph.addTerminal(search.VALUE_MAX);
  let root = graph.addNode(search.NODE_KIND.OUR_DECISION, [win], null, { supportComplete: false });
  let proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.UNKNOWN);

  graph = new search.InformationGraph(); win = graph.addTerminal(search.VALUE_MAX);
  root = graph.addNode(search.NODE_KIND.AUTOMATIC, [win], null, { assumptionMask: 1 });
  proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.UNKNOWN);

  graph = new search.InformationGraph(); const unknown = graph.addUnknown();
  root = graph.addNode(search.NODE_KIND.OUR_DECISION, [unknown]); proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.UNKNOWN);
});

test("every strict prefix of the proof budget is UNKNOWN and never a false positive", () => {
  const fixture = terminalMatrixGraph(new Int16Array([10000, 10000, 10000, 10000]));
  const proof = new search.ProofSearch(fixture.graph); const reachable = 5;
  for (let budget = 0; budget < reachable; budget += 1) {
    proof.coverageArena.used = 0;
    assert.equal(proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN, budget),
      search.PROOF_STATUS.UNKNOWN, `budget=${budget}`);
  }
  proof.coverageArena.used = 0;
  assert.equal(proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN, reachable),
    search.PROOF_STATUS.PROVEN);
});

test("AND_OR_DFS and DFPN modes agree on exhaustive complete games", () => {
  let cases = 0;
  forEachVector(4, values => {
    const fixture = terminalMatrixGraph(values); const proof = new search.ProofSearch(fixture.graph);
    for (const goal of GOALS) {
      proof.coverageArena.used = 0; const dfs = proof.solve(fixture.root, goal, 64,
        search.PROOF_MODE.AND_OR_DFS);
      proof.coverageArena.used = 0; const dfpn = proof.solve(fixture.root, goal, 64,
        search.PROOF_MODE.DFPN);
      assert.equal(dfpn, dfs); cases += 1;
    }
  });
  assert.equal(cases, 243);
});
