"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DeadlineKernel, SUCCESSOR_PROOF } =
  require("../../engine-v2/src/fast/deadline-kernel");
const { EscapeObligation, SUPPORT_STATUS } =
  require("../../engine-v2/src/runtime/escape-obligation");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../engine-v2/src/fast/hard-gate");
const { ACTION, HARD_STATUS, NONE_CELL, TERRAIN } =
  require("../../engine-v2/src/abi/fast-codes");

function arena(shared) {
  const state = new FastState(9, 9); const terrain = state.arrays[ARRAY.TERRAIN];
  terrain.fill(TERRAIN.OPEN, 0, state.cells);
  for (let x = 0; x < 9; x += 1) {
    terrain[state.cell(x, 0)] = TERRAIN.WALL;
    terrain[state.cell(x, 8)] = TERRAIN.WALL;
  }
  for (let y = 0; y < 9; y += 1) {
    terrain[state.cell(0, y)] = TERRAIN.WALL;
    terrain[state.cell(8, y)] = TERRAIN.WALL;
  }
  const a = state.arrays; a[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  a[ARRAY.TANK_CELL][0] = state.cell(4, 4); a[ARRAY.TANK_DIR][0] = 1;
  a[ARRAY.TANK_CELL][1] = state.cell(7, 6); a[ARRAY.TANK_DIR][1] = 3;
  a[ARRAY.BOMB_ACTIVE][0] = 1; a[ARRAY.BOMB_CELL][0] = state.cell(4, 4);
  a[ARRAY.BOMB_OWNER][0] = 1; a[ARRAY.BOMB_ID][0] = 41;
  a[ARRAY.BOMB_GENERATION][0] = 3; a[ARRAY.BOMB_EXPLODE][0] = 15;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = state.cell(2, 4);
  a[ARRAY.PROJECTILE_DIR][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_ID][0] = 17; a[ARRAY.PROJECTILE_GENERATION][0] = 2;
  state.initializeHash(); const kernel = new FastKernel(state);
  const hazard = new HazardKernel(state, shared ? {
    reverseLatticeCacheEntries: 4, reverseLatticeLayerCache: true
  } : {});
  const hard = new HardGate(kernel, hazard, 0);
  return { state, kernel, hazard, hard, bundle: { state, kernel, hazard, hard } };
}

function snapshot(deadline, cells) {
  return {
    proofStatus: deadline.proofStatus,
    rootViable: deadline.rootViable,
    deadlineTick: deadline.deadlineTick,
    slack: deadline.slack,
    actionEscape: Array.from(deadline.actionEscape),
    tick1: Array.from(deadline.viableTick1.slice(0, cells * 4)),
    tick2: Array.from(deadline.viableTick2.slice(0, cells * 4))
  };
}

test("HP7 cold Deadline materializes the canonical ThreatLattice instead of a private reverse DP", () => {
  const shared = arena(true); const control = arena(false);
  const actual = new DeadlineKernel(); const expected = new DeadlineKernel({
    sharedThreatLattice: false
  });
  actual.solve(shared.bundle, 0); expected.solve(control.bundle, 0);
  assert.deepEqual(snapshot(actual, shared.state.cells), snapshot(expected, control.state.cells));
  assert.equal(actual.privateReverseBuildCount, 0);
  assert.equal(actual.sharedLayerBuildCount, 1);
  assert.equal(shared.hazard.reverseLatticeBuildCount, 1);
  assert.equal(expected.privateReverseBuildCount, 1);
  assert.ok(expected.privateReverseBuildNodeCount > 0);

  const second = new DeadlineKernel(); second.solve(shared.bundle, 0);
  assert.equal(second.privateReverseBuildCount, 0);
  assert.equal(second.sharedLayerHitCount, 1);
  assert.deepEqual(snapshot(second, shared.state.cells), snapshot(expected, control.state.cells));
});

test("HP7 lethal deadline timeline scans only queried cells and memoizes each cell", () => {
  const item = arena(true); const deadline = new DeadlineKernel();
  deadline.solve(item.bundle, 0);
  const rootCell = item.state.arrays[ARRAY.TANK_CELL][0];
  const afterSolve = deadline.timelineNodeCount;
  assert.ok(afterSolve <= item.hazard.horizonTick);
  deadline.earliestHitTick(item.hazard, rootCell);
  assert.equal(deadline.timelineNodeCount, afterSolve);

  const secondCell = item.state.cell(2, 2);
  deadline.earliestHitTick(item.hazard, secondCell);
  const afterSecondCell = deadline.timelineNodeCount;
  assert.ok(afterSecondCell - afterSolve <= item.hazard.horizonTick);
  deadline.earliestHitTick(item.hazard, secondCell);
  assert.equal(deadline.timelineNodeCount, afterSecondCell);
  assert.ok(afterSecondCell < item.state.cells * item.hazard.horizonTick);
});

test("HP7 EO fills its successor slab without calling the allocating compatibility query", () => {
  const item = arena(true); const obligation = new EscapeObligation();
  obligation.deadline.evaluateSuccessor = () => {
    throw new Error("allocating compatibility path reached");
  };
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE, ACTION.NONE]);
  const arguments_ = new Uint16Array(actions.length).fill(NONE_CELL);
  const cells = new Uint16Array([
    item.state.cell(5, 4), item.state.cell(4, 4),
    item.state.cell(7, 3), item.state.cell(7, 3)
  ]);
  const directions = new Uint8Array([1, 0, 0, 0]);
  const hard = new Uint8Array(actions.length).fill(HARD_STATUS.ALLOW);
  const status = obligation.evaluateCommitted(item.bundle, actions, arguments_,
    cells, directions, hard, actions.length);
  assert.ok(status === SUPPORT_STATUS.COMPLETE || status === SUPPORT_STATUS.TRAPPED);
  assert.equal(obligation.successorSlabFillCount, 1);
  assert.equal(obligation.hotAllocationCount, 0);
  assert.equal(obligation.deadline.hotAllocationCount, 0);
  for (let row = 0; row < actions.length; row += 1)
    assert.ok(obligation.successorProof[row] === SUCCESSOR_PROOF.PROVEN_DEAD ||
      obligation.successorProof[row] === SUCCESSOR_PROOF.UNKNOWN ||
      obligation.successorProof[row] === SUCCESSOR_PROOF.PROVEN_VIABLE);
});

test("HP7 own projectile and future-fire absence never enter the committed lattice", () => {
  const item = arena(true); const a = item.state.arrays;
  a[ARRAY.PROJECTILE_OWNER][0] = 0; a[ARRAY.BOMB_ACTIVE][0] = 0;
  item.state.initializeHash();
  assert.equal(item.hard.hasCommittedThreat(), 0);
  assert.equal(item.hard.classifyApplied(), HARD_STATUS.ALLOW);
  assert.equal(item.hazard.reverseLatticeBuildCount, 0);
});
