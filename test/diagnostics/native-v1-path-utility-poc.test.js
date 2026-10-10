"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeV1PolicyLeafEvaluatorPoc } = require(
  "../../tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc");
const { NativeV1PathUtilityPoc } = require(
  "../../tools/agentank/diagnostics/native-v1-path-utility-poc");
const { NativeBoundedPolicySearchPoc } = require(
  "../../tools/agentank/diagnostics/native-bounded-policy-search-poc");

function makeState() {
  const value = new FastState(8, 8); const a = value.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, value.cells);
  a[ARRAY.TANK_CELL][0] = value.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = value.cell(6, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_SKILL][0] = SKILL.STUN;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  return value;
}

test("path utility rewards a purposeful direct shot and rejects an empty shot", () => {
  const value = makeState(); const utility = new NativeV1PathUtilityPoc(
    new NativeV1PolicyLeafEvaluatorPoc());
  const direct = utility.scoreTransition(value, ACTION.FIRE, ACTION.GO,
    ACTION.NONE, 0);
  value.arrays[ARRAY.TANK_DIR][0] = 0;
  const empty = utility.scoreTransition(value, ACTION.FIRE, ACTION.GO,
    ACTION.NONE, 0);
  assert.ok(direct > 300);
  assert.ok(empty < 0);
});

test("path utility preserves V1 turn streak and reversal costs", () => {
  const utility = new NativeV1PathUtilityPoc(); const value = makeState();
  const first = utility.scoreTransition(value, ACTION.TURN_LEFT, ACTION.GO,
    ACTION.NONE, 0);
  const repeated = utility.scoreTransition(value, ACTION.TURN_LEFT, ACTION.GO,
    ACTION.TURN_LEFT, 1);
  const reversed = utility.scoreTransition(value, ACTION.TURN_RIGHT, ACTION.GO,
    ACTION.TURN_LEFT, 1);
  assert.equal(first, -22);
  assert.equal(repeated, -92);
  assert.equal(reversed, -202);
});

test("path utility dimensions can be ablated independently", () => {
  const value = makeState(); const fireOnly = new NativeV1PathUtilityPoc(null, {
    fire: true, bomb: false, turn: false, stun: false
  });
  assert.ok(fireOnly.scoreTransition(value, ACTION.FIRE, ACTION.GO,
    ACTION.NONE, 0) > 0);
  assert.equal(fireOnly.scoreTransition(value, ACTION.TURN_LEFT, ACTION.GO,
    ACTION.NONE, 0), 0);
  assert.equal(fireOnly.scoreTransition(value, ACTION.THROW_BOMB, ACTION.GO,
    ACTION.NONE, 0), 0);
});

test("root turn history can be applied without penalizing deep turns", () => {
  const value = makeState(); const utility = new NativeV1PathUtilityPoc(null, {
    fire: false, bomb: false, turn: true, stun: false, rootTurnOnly: true
  });
  assert.equal(utility.scoreTransition(value, ACTION.TURN_RIGHT, ACTION.GO,
    ACTION.TURN_LEFT, 1, 1), -202);
  assert.equal(utility.scoreTransition(value, ACTION.TURN_RIGHT, ACTION.GO,
    ACTION.TURN_LEFT, 1, 2), 0);
});

test("root reversal can be isolated from generic turn cost", () => {
  const value = makeState(); const utility = new NativeV1PathUtilityPoc(null, {
    fire: false, bomb: false, turn: true, stun: false,
    rootTurnOnly: true, reversalOnly: true
  });
  assert.equal(utility.scoreTransition(value, ACTION.TURN_LEFT, ACTION.GO,
    ACTION.TURN_LEFT, 2, 1), 0);
  assert.equal(utility.scoreTransition(value, ACTION.TURN_RIGHT, ACTION.GO,
    ACTION.TURN_LEFT, 2, 1), -110);
});

test("bounded policy leaf accumulates path utility without mutating FastState", () => {
  const value = makeState(); const beforeLo = value.hashLo; const beforeHi = value.hashHi;
  const utility = new NativeV1PathUtilityPoc();
  const bounded = new NativeBoundedPolicySearchPoc({
    leafEvaluator: { evaluate() { return 100; } }, pathUtility: utility
  });
  assert.equal(bounded.leaf({ adapter: { state: value }, depthSearch: {} }, 37), 137);
  assert.equal(value.hashLo, beforeLo); assert.equal(value.hashHi, beforeHi);
  assert.equal(bounded.summary().pathUtility, true);
});

test("response-conditioned FIRE rewards the enemy branch that enters the shot lane", () => {
  const value = makeState(); const a = value.arrays;
  a[ARRAY.TANK_CELL][1] = value.cell(6, 4);
  a[ARRAY.TANK_DIR][1] = 0;
  const utility = new NativeV1PathUtilityPoc(null, {
    exactFireTransition: true, responseConditionedFire: true
  });
  utility.setOpponentContext(10, 1, 1, 1, 0);
  const token = utility.prepareAppliedTransition(value, ACTION.FIRE);
  assert.notEqual(token, 0xffffffff);
  a[ARRAY.TANK_CELL][1] = value.cell(6, 3);
  const supporting = utility.scoreAppliedTransition(value, ACTION.FIRE,
    ACTION.GO, 0, token);
  a[ARRAY.TANK_CELL][1] = value.cell(6, 4);
  const turning = utility.scoreAppliedTransition(value, ACTION.FIRE,
    ACTION.TURN_LEFT, 0, token);
  assert.ok(supporting > turning);
  assert.ok(turning > 0);
  assert.equal(utility.summary().responseFireAppliedCount, 2);
  assert.equal(utility.summary().hotAllocationCount, 0);
});
