"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { MASS_INDEX, RESPONSE_RELATION } = require(
  "../../tools/agentank/diagnostics/native-long-option-response-mass-poc");
const { ENEMY_RESPONSE_POLICY, NativeEnemyPolicyResponseMassPoc,
  NativeEnemyResponsePortfolioCensusPoc, responseRelation } = require(
  "../../tools/agentank/diagnostics/native-enemy-response-portfolio-poc");

function fixture() {
  const state = new FastState(7, 7); const arrays = state.arrays;
  arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  arrays[ARRAY.TANK_CELL][0] = state.cell(1, 1);
  arrays[ARRAY.TANK_CELL][1] = state.cell(5, 5);
  arrays[ARRAY.TANK_DIR][0] = 1; arrays[ARRAY.TANK_DIR][1] = 3;
  arrays[ARRAY.TANK_STUN_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_FROZEN_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_POISON_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_POISON_APPLIED].fill(NONE_FRAME);
  arrays[ARRAY.TANK_FIRE_LOCK].fill(NONE_FRAME);
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = state.cell(5, 1);
  return state;
}

test("persistent enemy response policies produce distinct state routes", () => {
  const state = fixture();
  const actions = [];
  for (let id = 0; id < ENEMY_RESPONSE_POLICY.COUNT; id += 1) {
    const policy = new NativeEnemyPolicyResponseMassPoc("shadow",
      { enemyPolicyId: id });
    actions.push(policy.enemyPolicyAction(state));
  }
  assert.deepEqual(actions,
    [ACTION.GO, ACTION.TURN_RIGHT, ACTION.TURN_LEFT]);
});

test("portfolio relation retains incomplete and dominance semantics", () => {
  const base = new Uint16Array(11); const candidate = new Uint16Array(11);
  base[MASS_INDEX.FAILURE] = 4000; candidate[MASS_INDEX.FAILURE] = 2000;
  base[MASS_INDEX.SUCCESS] = 2000; candidate[MASS_INDEX.SUCCESS] = 4000;
  assert.equal(responseRelation(0, base, 0, candidate),
    RESPONSE_RELATION.CANDIDATE_DOMINATES);
  assert.equal(responseRelation(0, base, 1 << MASS_INDEX.INCOMPLETE, candidate),
    RESPONSE_RELATION.TRADEOFF);
});

test("portfolio census is a transparent shadow owner", () => {
  const census = new NativeEnemyResponsePortfolioCensusPoc("shadow");
  const resolved = { action: ACTION.FIRE, argument: NONE_CELL, row: 2 };
  assert.strictEqual(census.closeHostOverride(null, ACTION.GO, NONE_CELL,
    resolved), resolved);
});
