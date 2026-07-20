"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY } = require("../../engine-v2/src/state/fast-state");
const { TERRAIN } = require("../../engine-v2/src/abi/fast-codes");
const { HiddenProjectileRiskField } =
  require("../../engine-v2/src/runtime/hidden-projectile-risk-field");

test("hidden move-turn-fire history remains a set-valued projectile field", () => {
  const state = new FastState(19, 19); state.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
  const field = new HiddenProjectileRiskField();
  assert.equal(field.build(state, state.cell(3, 9), 1, 3, 1, 5000,
    state.cell(4, 13)), 1);
  // GO, TURN_RIGHT, FIRE is one supported hidden action history. Its bullet
  // has advanced to (4,11) when frame 14 begins and reaches (4,13) next.
  assert.ok(field.projectileA[state.cell(4, 11) * 4 + 2] > 0);
  field.prepareHorizon(state, 4);
  assert.ok(field.preparedLethalMassAt(state.cell(4, 13), 1) > 0);
  assert.ok(field.activeCount > 1,
    "alternative hidden action histories remain separate Risk support");
  assert.equal(field.hotAllocationCount, 0);
});
