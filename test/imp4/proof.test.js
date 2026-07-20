"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, terminalMatrixGraph } = require("./helpers");

test("InformationState one row all columns proves ForcedWin with complete CoverageCertificate", () => {
  const fixture = terminalMatrixGraph([[10000, 10000, 10000]]); const proof = new search.ProofSearch(fixture.graph);
  assert.equal(proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.PROVEN);
  assert.equal(proof.mask[fixture.root], search.COVERAGE_REQUIRED);
  assert.ok(proof.coverageArena.isStrict(proof.lastCoverageHandle));
});

test("per row different enemy columns never produce a false simultaneous ForcedLoss", () => {
  const fixture = terminalMatrixGraph([[-10000, 10000], [10000, -10000]]);
  const proof = new search.ProofSearch(fixture.graph);
  assert.notEqual(proof.solve(fixture.root, search.PROOF_GOAL.FORCED_LOSS), search.PROOF_STATUS.PROVEN);
  assert.equal(proof.lastStatus, search.PROOF_STATUS.DISPROVEN);
});

test("hidden world strategy fusion and incomplete response partitions force Proof UNKNOWN", () => {
  const graph = new search.InformationGraph(); const win = graph.addTerminal(10000);
  const root = graph.addSimultaneous(1, 1, [win], { strategyConsistent: false });
  const proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.UNKNOWN);
  assert.ok(!(proof.mask[root] & search.COVERAGE.STRATEGY_CONSISTENT));
});

test("chance probability size is ignored by Proof while every complete support member is covered", () => {
  const graph = new search.InformationGraph(); const win0 = graph.addTerminal(10000);
  const win1 = graph.addTerminal(10000); const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME,
    [win0, win1], [1, 9999]); const proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(chance, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.PROVEN);
  const graph2 = new search.InformationGraph(); const win = graph2.addTerminal(10000);
  const loss = graph2.addTerminal(-10000); const residual = graph2.addNode(search.NODE_KIND.HIDDEN_WORLD,
    [win, loss], [9999, 1]); const proof2 = new search.ProofSearch(graph2);
  assert.equal(proof2.solve(residual, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.DISPROVEN);
});

test("unknown chance probability permits strict support Proof but keeps Value incomplete", () => {
  const graph = new search.InformationGraph(); const win0 = graph.addTerminal(10000);
  const win1 = graph.addTerminal(10000); const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME,
    [win0, win1], null, { probabilityComplete: false });
  const proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(chance, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.PROVEN);
  assert.ok(proof.coverageArena.isStrict(proof.lastCoverageHandle));
  assert.equal(proof.mask[chance] & search.COVERAGE.NO_PROBABILITY_PRUNING, 0);
  const value = new search.ValueSearch(graph);
  assert.equal(value.solve(chance), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(value.complete[chance], 0);
});

test("observation split permits different continuation policies only after the split", () => {
  const graph = new search.InformationGraph(); const win0 = graph.addTerminal(10000);
  const win1 = graph.addTerminal(10000); const branch0 = graph.addNode(search.NODE_KIND.OUR_DECISION, [win0]);
  const branch1 = graph.addNode(search.NODE_KIND.OUR_DECISION, [win1]);
  const split = graph.addNode(search.NODE_KIND.OBSERVATION_SPLIT, [branch0, branch1]);
  const proof = new search.ProofSearch(graph);
  assert.equal(proof.solve(split, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.PROVEN);
});

test("AND OR DFS and DFPN agree and interruption cannot publish a strict false positive", () => {
  const fixture = terminalMatrixGraph([[10000, 10000], [10000, -10000]]);
  const proof = new search.ProofSearch(fixture.graph);
  const dfs = proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN, 512, search.PROOF_MODE.AND_OR_DFS);
  const dfpn = proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN, 512, search.PROOF_MODE.DFPN);
  assert.equal(dfs, dfpn); assert.equal(dfs, search.PROOF_STATUS.PROVEN);
  assert.equal(proof.solve(fixture.root, search.PROOF_GOAL.FORCED_WIN, 1,
    search.PROOF_MODE.DFPN), search.PROOF_STATUS.UNKNOWN);
});

test("ACTION_REFUTED remains action local and never upgrades the whole state to ForcedLoss", () => {
  const graph = new search.InformationGraph(); const loss = graph.addTerminal(-10000);
  const win = graph.addTerminal(10000); const root = graph.addNode(search.NODE_KIND.OUR_DECISION, [loss, win]);
  const proof = new search.ProofSearch(graph);
  assert.equal(proof.refuteAction(loss, search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.ACTION_REFUTED);
  assert.equal(proof.solve(root, search.PROOF_GOAL.FORCED_LOSS), search.PROOF_STATUS.DISPROVEN);
});
