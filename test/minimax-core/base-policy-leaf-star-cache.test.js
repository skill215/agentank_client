"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { TERRAIN, SKILL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeV1PolicyLeafEvaluatorPoc } = require(
  "../../tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc");

function fixture() {
  const state = new FastState(12, 12); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  for (let x = 0; x < state.width; x += 1) {
    a[ARRAY.TERRAIN][state.cell(x, 0)] = TERRAIN.WALL;
    a[ARRAY.TERRAIN][state.cell(x, state.height - 1)] = TERRAIN.WALL;
  }
  for (let y = 0; y < state.height; y += 1) {
    a[ARRAY.TERRAIN][state.cell(0, y)] = TERRAIN.WALL;
    a[ARRAY.TERRAIN][state.cell(state.width - 1, y)] = TERRAIN.WALL;
  }
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(9, 9);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_SKILL][0] = SKILL.STUN;
  a[ARRAY.TANK_SKILL][1] = SKILL.STUN;
  for (let id = ARRAY.TANK_SHIELD_UNTIL;
      id <= ARRAY.TANK_FIRE_LOCK; id += 1) a[id].fill(NONE_FRAME);
  a[ARRAY.SCALAR][SCALAR.FRAME] = 7;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = state.cell(7, 7);
  return state;
}

test("star-field cache is exact across same-version terrain branches", () => {
  const state = fixture(); const a = state.arrays;
  const uncached = new NativeV1PolicyLeafEvaluatorPoc({ clampLimit: 25000 });
  const cached = new NativeV1PolicyLeafEvaluatorPoc({ clampLimit: 25000,
    starFieldCacheEntries: 4 });
  const evaluate = () => {
    const expected = uncached.evaluate(state);
    assert.equal(cached.evaluate(state), expected);
  };
  evaluate(); evaluate();
  assert.equal(cached.starFieldCacheMissCount, 1);
  assert.equal(cached.starFieldCacheHitCount, 1);

  // Equal TERRAIN_VERSION does not imply equal topology: separate search
  // branches can destroy different dirt cells. Full terrain comparison keeps
  // the cache exact rather than treating version as an identity.
  const left = state.cell(5, 7); const right = state.cell(7, 5);
  a[ARRAY.TERRAIN][left] = TERRAIN.DIRT;
  evaluate();
  assert.equal(cached.starFieldCacheMissCount, 2);
  a[ARRAY.TERRAIN][left] = TERRAIN.OPEN;
  a[ARRAY.TERRAIN][right] = TERRAIN.DIRT;
  evaluate();
  assert.equal(cached.starFieldCacheMissCount, 3);

  // Returning to the original branch finds its earlier exact snapshot.
  a[ARRAY.TERRAIN][right] = TERRAIN.OPEN;
  evaluate();
  assert.equal(cached.starFieldCacheHitCount, 2);
  assert.equal(cached.hotAllocationCount, 0);
});

test("root snapshot plus branch deltas avoid whole-map comparison per leaf", () => {
  const state = fixture(); const a = state.arrays;
  const uncached = new NativeV1PolicyLeafEvaluatorPoc({ clampLimit: 25000 });
  const cached = new NativeV1PolicyLeafEvaluatorPoc({ clampLimit: 25000,
    starFieldCacheEntries: 4 });
  uncached.beginRoot(state); cached.beginRoot(state);
  const evaluate = () => assert.equal(cached.evaluate(state),
    uncached.evaluate(state));
  evaluate(); evaluate();
  const rootMark = state.beginTransition();
  const left = state.cell(5, 7); const right = state.cell(7, 5);
  assert.equal(state.write(ARRAY.TERRAIN, left, TERRAIN.DIRT), 1);
  assert.equal(state.write(ARRAY.SCALAR, SCALAR.TERRAIN_VERSION, 1), 1);
  evaluate(); state.undoTo(rootMark);
  const rightMark = state.beginTransition();
  assert.equal(state.write(ARRAY.TERRAIN, right, TERRAIN.DIRT), 1);
  assert.equal(state.write(ARRAY.SCALAR, SCALAR.TERRAIN_VERSION, 1), 1);
  evaluate(); state.undoTo(rightMark); evaluate();
  assert.equal(cached.starFieldCount, 3);
  assert.equal(cached.starFieldCacheHitCount, 2);
  assert.ok(cached.starFieldCacheTerrainCellCompareCount <= 3);
  assert.equal(cached.hotAllocationCount, 0);
});

test("precomputed geometry is exact for every cell and direction", () => {
  const state = fixture();
  const leaf = new NativeV1PolicyLeafEvaluatorPoc({ starFieldCacheEntries: 2 });
  leaf.beginRoot(state);
  for (let cell = 0; cell < state.cells; cell += 1) {
    for (let direction = 0; direction < 4; direction += 1) {
      const x = state.x(cell) + [0, 1, 0, -1][direction];
      const y = state.y(cell) + [-1, 0, 1, 0][direction];
      const expected = x < 0 || x >= state.width || y < 0 || y >= state.height ?
        0xffff : state.cell(x, y);
      assert.equal(leaf.target(state, cell, direction), expected);
    }
    for (let other = 0; other < state.cells; other += 17)
      assert.equal(leaf.distance(state, cell, other),
        Math.abs(state.x(cell) - state.x(other)) +
        Math.abs(state.y(cell) - state.y(other)));
  }
});
