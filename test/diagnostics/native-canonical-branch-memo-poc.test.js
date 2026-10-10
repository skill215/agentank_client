"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, CHANCE, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeCanonicalBranchMemoPoc } = require(
  "../../tools/agentank/diagnostics/native-canonical-branch-memo-poc");

function stateFixture() {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  a[ARRAY.TANK_CELL][1] = state.cell(5, 2);
  a[ARRAY.TANK_DIR][0] = 1; a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.TANK_FROZEN_UNTIL].fill(NONE_FRAME);
  a[ARRAY.TANK_STUN_UNTIL].fill(NONE_FRAME);
  a[ARRAY.TANK_POISON_APPLIED].fill(NONE_FRAME);
  a[ARRAY.TANK_POISON_UNTIL].fill(NONE_FRAME);
  a[ARRAY.TANK_FIRE_LOCK].fill(NONE_FRAME);
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  return state;
}

test("memo reuses two raw stun commands with one effective branch", () => {
  const state = stateFixture();
  state.arrays[ARRAY.TANK_STUN_UNTIL][1] = 3;
  const memo = new NativeCanonicalBranchMemoPoc("shadow");
  memo.beginCanonicalState(0);
  assert.equal(memo.lookupCanonicalBranch(state, 0,
    ACTION.NONE, NONE_CELL, ACTION.TURN_LEFT, 0,
    CHANCE.NORMAL, CHANCE.REVERSED), -1);
  const evaluator = { maximumFrames: 6,
    ttIndex() { return -2; },
    setMass(target, offset, mask) { target[offset] = mask; },
    copyMass() {} };
  assert.equal(memo.storeCanonicalBranch(state, 0, 7, 0, 0, evaluator), 1);
  const hit = memo.lookupCanonicalBranch(state, 0,
    ACTION.NONE, NONE_CELL, ACTION.TURN_RIGHT, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.ok(hit >= 0);
  assert.equal(memo.canonicalMask[hit], 7);
  assert.equal(memo.canonicalHitCount, 1);
});

test("memo does not merge distinct effective turns", () => {
  const state = stateFixture();
  state.arrays[ARRAY.TANK_STUN_UNTIL][1] = 3;
  const memo = new NativeCanonicalBranchMemoPoc("shadow");
  memo.beginCanonicalState(0);
  memo.lookupCanonicalBranch(state, 0, ACTION.NONE, NONE_CELL,
    ACTION.TURN_LEFT, NONE_CELL, CHANCE.NORMAL, CHANCE.NORMAL);
  const evaluator = { maximumFrames: 6, ttIndex() { return -2; },
    setMass(target, offset, mask) { target[offset] = mask; }, copyMass() {} };
  memo.storeCanonicalBranch(state, 0, 1, 0, 0, evaluator);
  assert.equal(memo.lookupCanonicalBranch(state, 0, ACTION.NONE, NONE_CELL,
    ACTION.TURN_RIGHT, NONE_CELL, CHANCE.NORMAL, CHANCE.NORMAL), -1);
});
