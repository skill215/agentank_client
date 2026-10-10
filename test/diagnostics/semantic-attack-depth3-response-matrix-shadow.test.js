"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION_FAMILY } = require("../../engine-v2/src/abi/policy-codes");
const { SEARCH_STATUS, PROBABILITY_SCALE } = require(
  "../../engine-v2/src/abi/search-codes");
const { OpponentModel } = require("../../engine-v2/src/policy/opponent-model");
const { StageMatrix, DoubleOracleSolver } = require(
  "../../engine-v2/src/search/matrix");
const { PolicyArena } = require("../../engine-v2/src/search/arenas");
const { POINTWISE_RELATION, SUPPORT_CLASS, pointwiseRelation,
  NORMALIZATION_MODE, buildReadOnlyNominal,
  SemanticAttackDepth3ResponseMatrixShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-depth3-response-matrix-shadow");

function solve(cells) {
  const matrix = new StageMatrix({ maxRows: 2, maxColumns: cells[0].length });
  assert.equal(matrix.initialize(2, cells[0].length), SEARCH_STATUS.COMPLETE);
  for (let row = 0; row < 2; row += 1)
    for (let column = 0; column < cells[row].length; column += 1)
      assert.equal(matrix.setCell(row, column, cells[row][column],
        cells[row][column], 1), SEARCH_STATUS.COMPLETE);
  const arena = new PolicyArena({ maxPolicies: 2, maxEntries: 4 });
  const solver = new DoubleOracleSolver(matrix, arena);
  const status = solver.solve(8192, 16, cells[0].length + 2);
  let candidateProbability = 0;
  for (let slot = 0; slot < solver.rowCount; slot += 1)
    if (solver.rowIds[slot] === 1) candidateProbability = solver.averageRow[slot];
  return { status, candidateProbability, gap: solver.gap };
}

test("BP136 pointwise relation distinguishes dominance from response tradeoff", () => {
  assert.equal(pointwiseRelation([1, 2], [2, 3], 2),
    POINTWISE_RELATION.CANDIDATE_DOMINATES);
  assert.equal(pointwiseRelation([2, 3], [1, 2], 2),
    POINTWISE_RELATION.INCUMBENT_DOMINATES);
  assert.equal(pointwiseRelation([2, 2], [2, 2], 2),
    POINTWISE_RELATION.EQUAL);
  assert.equal(pointwiseRelation([1, 3], [3, 1], 2),
    POINTWISE_RELATION.TRADEOFF);
});

test("BP136 common 2xN matrix rejects dominated rows and mixes tradeoffs", () => {
  const dominated = solve([[2, 2, 2], [1, 1, 1]]);
  assert.equal(dominated.status, SEARCH_STATUS.COMPLETE);
  assert.equal(dominated.candidateProbability, 0);
  const dominant = solve([[1, 1, 1], [2, 2, 2]]);
  assert.equal(dominant.status, SEARCH_STATUS.COMPLETE);
  assert.equal(dominant.candidateProbability, PROBABILITY_SCALE);
  const mixed = solve([[100, -100], [-100, 100]]);
  assert.ok(mixed.status === SEARCH_STATUS.COMPLETE ||
    mixed.status === SEARCH_STATUS.APPROXIMATE);
  assert.ok(mixed.candidateProbability > 0 &&
    mixed.candidateProbability < PROBABILITY_SCALE);
  assert.ok(mixed.gap >= 0);
});

test("BP136 nominal snapshot is identical but does not mutate opponent queries", () => {
  const opponent = new OpponentModel(); const families = new Uint8Array([
    ACTION_FAMILY.HOLD, ACTION_FAMILY.MOVE, ACTION_FAMILY.FIRE]);
  const expected = new Uint16Array(3); opponent.buildNominalPolicy(families,
    3, 0, expected); const before = opponent.queryCount;
  const actual = new Uint16Array(3); const raw = new Uint32Array(3);
  const remainder = new Uint32Array(3);
  assert.equal(buildReadOnlyNominal(opponent, families, 3, 0, actual,
    raw, remainder), 3);
  assert.deepEqual(Array.from(actual), Array.from(expected));
  assert.equal(opponent.queryCount, before);
  assert.equal(actual[0] + actual[1] + actual[2], PROBABILITY_SCALE);
  assert.equal(SUPPORT_CLASS.INCOMPLETE, 3);
});

test("BP136 uses one affine root transform instead of clipping large leaf values", () => {
  const shadow = new SemanticAttackDepth3ResponseMatrixShadow();
  shadow.baselineCells[0] = -2498; shadow.baselineCells[1] = -8000;
  shadow.candidateCells[0] = -30100; shadow.candidateCells[1] = 12000;
  assert.equal(shadow.fillMatrix(2, 0), 1);
  assert.equal(shadow.lastNormalizationMode[0], NORMALIZATION_MODE.SCALE);
  const stride = shadow.matrix.maxColumns;
  assert.equal(shadow.matrix.lower[0] > shadow.matrix.lower[stride], true);
  assert.equal(shadow.matrix.lower[1] < shadow.matrix.lower[stride + 1], true);
  for (const at of [0, 1, stride, stride + 1])
    assert.ok(shadow.matrix.lower[at] >= -10000 &&
      shadow.matrix.lower[at] <= 10000);
});
