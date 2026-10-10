"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE } = require("../../engine-v2/src/runtime/root-control-mode");
const { OBJECTIVE_PROFILE, OBJECTIVE_REASON, ObjectiveOptionRouter } =
  require("../../engine-v2/src/policy/objective-option-router");

function fixture() {
  const state = new FastState(7, 7);
  state.arrays[ARRAY.TANK_CELL][0] = state.cell(1, 1);
  state.arrays[ARRAY.TANK_CELL][1] = state.cell(5, 4);
  state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = state.cell(1, 5);
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
  const cells = new Uint16Array([state.cell(2, 1), state.cell(1, 1), state.cell(1, 1)]);
  const directions = new Uint8Array([1, 0, 2]);
  const outcome = { acceptable: new Uint8Array(3).fill(1), dominated: new Uint8Array(3),
    escapeSlack: new Int8Array(3) };
  return { adapter: { state, enemyVisible: true }, lastControlMode:
      ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION, ourActions: actions,
    projectedCell: cells, projectedDirection: directions,
    riskController: { outcome, lexicographicRiskLess() { return 0; } },
    strategyBands: { starPurpose: new Uint16Array([0, 0, 1]) },
    manhattan(left, right) { return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right)); },
    clearLine() { return 0; }, directionTo() { return -1; },
    starDistance(cell) { return Math.abs(state.x(cell) - 1) + Math.abs(state.y(cell) - 5); },
    starDirectionHelpful(cell, direction) { return cell === state.cell(1, 1) && direction === 2; }
  };
}

test("attack-first objective selects strict enemy approach", () => {
  const root = fixture();
  const router = new ObjectiveOptionRouter(OBJECTIVE_PROFILE.ATTACK_FIRST);
  assert.equal(router.select(root, 1, 3), 0);
  assert.equal(router.lastReason, OBJECTIVE_REASON.ATTACK_APPROACH);
  assert.equal(router.hotAllocationCount, 0);
});

test("star-first objective selects path-qualified star turn", () => {
  const root = fixture();
  const router = new ObjectiveOptionRouter(OBJECTIVE_PROFILE.STAR_FIRST);
  assert.equal(router.select(root, 0, 3), 2);
  assert.equal(router.lastReason, OBJECTIVE_REASON.STAR_PROGRESS);
});

test("objective owner leaves tactical roots unchanged", () => {
  const root = fixture(); root.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  root.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  const router = new ObjectiveOptionRouter(OBJECTIVE_PROFILE.ATTACK_FIRST);
  assert.equal(router.select(root, 2, 3), 2);
  assert.equal(router.lastReason, OBJECTIVE_REASON.FALLBACK);
});
