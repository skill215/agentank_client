"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { search, forEachVector, exactMatrix } = require("./helpers");

function exact2x2Rational(values) {
  const a = values[0]; const b = values[1]; const c = values[2]; const d = values[3];
  const lower = Math.max(Math.min(a, b), Math.min(c, d));
  const upper = Math.min(Math.max(a, c), Math.max(b, d));
  if (lower === upper) return { numerator: lower, denominator: 1 };
  let denominator = a - b - c + d; let numerator = a * d - b * c;
  if (denominator < 0) { denominator = -denominator; numerator = -numerator; }
  assert.ok(denominator > 0); return { numerator, denominator };
}

function policyMass(solver) {
  const handle = solver.policyHandle; const arena = solver.policyArena;
  assert.notEqual(handle, search.NONE_NODE); const start = arena.entryStart[handle];
  const count = arena.entryCount[handle]; let total = 0;
  for (let index = 0; index < count; index += 1) total += arena.probability[start + index];
  return total;
}

test("DoubleOracle 2x2 bounds contain the independent exact rational value for all games", () => {
  let cases = 0;
  forEachVector(4, values => {
    const solver = new search.DoubleOracleSolver(exactMatrix(values));
    const status = solver.solve(512, 16, 8); const exact = exact2x2Rational(values);
    assert.ok(status === search.SEARCH_STATUS.COMPLETE || status === search.SEARCH_STATUS.APPROXIMATE);
    assert.ok(solver.stageLower * exact.denominator <= exact.numerator,
      `${Array.from(values)} lower`);
    assert.ok(solver.stageUpper * exact.denominator >= exact.numerator,
      `${Array.from(values)} upper`);
    assert.ok(solver.stageLower <= solver.stageUpper); assert.equal(policyMass(solver), 10000);
    if (solver.boundKind === search.BOUND_KIND.EXACT_COMPLETE)
      assert.equal(solver.stageLower, solver.stageUpper);
    cases += 1;
  });
  assert.equal(cases, 81);
});

test("DoubleOracle is deterministic and its reported gap is full-game exploitability", () => {
  const values = new Int16Array([0, -1000, 1000, 1000, 0, -1000, -1000, 1000, 0]);
  const left = new search.DoubleOracleSolver(exactMatrix(values, 3, 3));
  const right = new search.DoubleOracleSolver(exactMatrix(values, 3, 3));
  left.solve(512, 16, 8); right.solve(512, 16, 8);
  assert.deepEqual([left.stageLower, left.stageUpper, left.gap, left.rowCount, left.columnCount],
    [right.stageLower, right.stageUpper, right.gap, right.rowCount, right.columnCount]);
  assert.deepEqual(Array.from(left.averageRow.slice(0, left.rowCount)),
    Array.from(right.averageRow.slice(0, right.rowCount)));
  assert.equal(left.gap, left.stageUpper - left.stageLower);
  assert.ok(left.fullEnemyBestResponseScans > 0 && left.fullOurBestResponseScans > 0);
});

test("strictly dominated rows never enter the final mixed policy support", () => {
  const matrix = exactMatrix(new Int16Array([1000, -1000, -1000, 1000, -2000, -2000]), 3, 2);
  const solver = new search.DoubleOracleSolver(matrix); solver.solve(512, 8, 8);
  const arena = solver.policyArena; const start = arena.entryStart[solver.policyHandle];
  const count = arena.entryCount[solver.policyHandle];
  for (let index = 0; index < count; index += 1)
    assert.notEqual(arena.action[start + index], 2);
});

test("incomplete matrix equality cannot become exact or proven deterministic", () => {
  const matrix = new search.StageMatrix({ maxRows: 2, maxColumns: 2 }); matrix.initialize(2, 2);
  for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1)
    matrix.setCell(row, column, 0, 0, row === 0 && column === 0 ? 1 : 0);
  const solver = new search.DoubleOracleSolver(matrix); const status = solver.solve(64, 8, 4);
  assert.equal(status, search.SEARCH_STATUS.APPROXIMATE);
  assert.equal(solver.boundKind, search.BOUND_KIND.APPROXIMATE_WITH_GAP);
});

test("matrix iteration and expansion budgets are strict and zero cannot trigger hidden work", () => {
  const values = new Int16Array([0, -1000, 1000, 1000, 0, -1000, -1000, 1000, 0]);
  let solver = new search.DoubleOracleSolver(exactMatrix(values, 3, 3));
  assert.equal(solver.solve(0, 8, 8), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(solver.iterations, 0); assert.equal(solver.policyHandle, search.NONE_NODE);
  solver = new search.DoubleOracleSolver(exactMatrix(values, 3, 3));
  assert.equal(solver.solve(64, 0, 8), search.SEARCH_STATUS.INVALID);
  solver = new search.DoubleOracleSolver(exactMatrix(values, 3, 3));
  assert.equal(solver.solve(64, 8, 0), search.SEARCH_STATUS.INCOMPLETE);
  assert.equal(solver.iterations, 0); assert.equal(solver.policyHandle, search.NONE_NODE);
});
