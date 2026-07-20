"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, exactMatrix } = require("./helpers");

function policyProbabilities(solver) {
  const arena = solver.policyArena; const handle = solver.policyHandle;
  const start = arena.entryStart[handle]; const count = arena.entryCount[handle];
  return Array.from(arena.probability.slice(start, start + count));
}

test("restricted matrix full best response scans every row and column before reporting its gap", () => {
  const matrix = exactMatrix([[0, -1000, 1000], [1000, 0, -1000], [-1000, 1000, 0]]);
  const solver = new search.DoubleOracleSolver(matrix);
  assert.equal(solver.solve(512, 16), search.SEARCH_STATUS.APPROXIMATE);
  assert.equal(solver.fullEnemyBestResponseScans, solver.fullOurBestResponseScans);
  assert.ok(solver.fullEnemyBestResponseScans > 0); assert.equal(solver.rowCount, 3);
  assert.equal(solver.columnCount, 3); assert.ok(solver.stageLower <= 0 && solver.stageUpper >= 0);
  assert.equal(solver.gap, solver.stageUpper - solver.stageLower);
});

test("RPS and Matching Pennies produce reproducible mixed policies with exact probability mass", () => {
  const rps = new search.DoubleOracleSolver(exactMatrix([
    [0, -1000, 1000], [1000, 0, -1000], [-1000, 1000, 0]
  ])); rps.solve(512, 16); const probabilities = policyProbabilities(rps);
  assert.equal(probabilities.reduce((sum, value) => sum + value, 0), 10000);
  assert.ok(probabilities.every(value => Math.abs(value - 3333) <= 800));
  const pennies = new search.DoubleOracleSolver(exactMatrix([[1000, -1000], [-1000, 1000]]));
  pennies.solve(512, 16); const mirrored = policyProbabilities(pennies);
  assert.equal(mirrored.reduce((sum, value) => sum + value, 0), 10000);
  assert.ok(Math.abs(mirrored[0] - mirrored[1]) <= 200);
  assert.ok(pennies.stageLower <= 0 && pennies.stageUpper >= 0);
});

test("initial restricted support cannot hide a mixed best response or dominated support trap", () => {
  const matrix = exactMatrix([[1000, -1000], [-1000, 1000], [0, 0]]);
  const solver = new search.DoubleOracleSolver(matrix); solver.solve(256, 8);
  assert.ok(solver.rowActive[0]); assert.ok(solver.rowActive[1] || solver.rowActive[2]);
  assert.equal(solver.columnCount, 2); assert.ok(solver.fullEnemyBestResponseScans > 1);
  assert.ok(solver.stageLower <= solver.stageUpper);
});

test("interval midpoint regret never upgrades an unresolved matrix to exact", () => {
  const matrix = new search.StageMatrix(); matrix.initialize(2, 2);
  matrix.setCell(0, 0, -1000, 1000, 0); matrix.setCell(0, 1, -1000, 1000, 0);
  matrix.setCell(1, 0, -1000, 1000, 0); matrix.setCell(1, 1, -1000, 1000, 0);
  const solver = new search.DoubleOracleSolver(matrix); solver.solve(64, 8);
  assert.equal(solver.boundKind, search.BOUND_KIND.APPROXIMATE_WITH_GAP);
  assert.ok(solver.stageLower <= 0 && solver.stageUpper >= 0); assert.notEqual(solver.gap, 0);
});

test("pure saddle emits deterministic policy only when all dependency cells are complete", () => {
  const matrix = exactMatrix([[1000, 1000], [0, 2000]]); const solver = new search.DoubleOracleSolver(matrix);
  assert.equal(solver.solve(), search.SEARCH_STATUS.COMPLETE); assert.equal(solver.gap, 0);
  const arena = solver.policyArena; assert.equal(arena.entryCount[solver.policyHandle], 1);
  assert.ok(arena.flags[solver.policyHandle] & search.POLICY_FLAG.DETERMINISTIC);
});
