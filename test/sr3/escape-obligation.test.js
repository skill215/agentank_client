"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EscapeObligation } = require("../../engine-v2/src/runtime/escape-obligation");
const { HARD_STATUS, ACTION, NONE_CELL, TERRAIN } = require("../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { FastKernel } = require("../../engine-v2/src/fast/kernel");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../engine-v2/src/fast/hard-gate");
const { InformationSafetyClosure } =
  require("../../engine-v2/src/search/information-safety-closure");
const { RULE } = require("../../engine-v2/src/generated/fast-config");

function openArena(width = 9, height = 9) {
  const state = new FastState(width, height);
  const terrain = state.arrays[ARRAY.TERRAIN];
  for (let cell = 0; cell < state.cells; cell += 1) terrain[cell] = TERRAIN.OPEN;
  for (let x = 0; x < width; x += 1) {
    terrain[state.cell(x, 0)] = TERRAIN.WALL;
    terrain[state.cell(x, height - 1)] = TERRAIN.WALL;
  }
  for (let y = 0; y < height; y += 1) {
    terrain[state.cell(0, y)] = TERRAIN.WALL;
    terrain[state.cell(width - 1, y)] = TERRAIN.WALL;
  }
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  state.arrays[ARRAY.TANK_CELL][0] = state.cell(4, 4);
  state.arrays[ARRAY.TANK_DIR][0] = 1;
  state.arrays[ARRAY.TANK_CELL][1] = state.cell(6, 4);
  state.arrays[ARRAY.TANK_DIR][1] = 3;
  state.initializeHash();
  const kernel = new FastKernel(state);
  const hazard = new HazardKernel(state);
  const hard = new HardGate(kernel, hazard, 0);
  return { state, kernel, hazard, hard, bundle: { state, kernel, hazard, hard } };
}

function placeBomb(state, cell, fuse = 3) {
  const slot = 0;
  state.arrays[ARRAY.BOMB_ACTIVE][slot] = 1;
  state.arrays[ARRAY.BOMB_CELL][slot] = cell;
  state.arrays[ARRAY.BOMB_OWNER][slot] = 1;
  state.arrays[ARRAY.BOMB_GENERATION][slot] = 7;
  state.arrays[ARRAY.BOMB_EXPLODE][slot] = state.arrays[ARRAY.SCALAR][SCALAR.FRAME] + fuse;
  state.arrays[ARRAY.BOMB_ID][slot] = 42;
}

describe("EscapeObligation", () => {
  it("adds committed Safety pressure for actions that remain in a bomb blast", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 2);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(5, 4), state.cell(4, 4), state.cell(4, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.ok(obligation.entityCount >= 1);
    assert.ok(obligation.committedPressure[0] > 0 || obligation.committedPressure[1] > 0 ||
      obligation.committedPressure[2] > 0);
    const safety = new InformationSafetyClosure().outcome;
    safety.reset(3);
    obligation.applyToSafety(safety, 3);
    assert.ok(safety.horizonFatalMass[0] + safety.horizonFatalMass[1] +
      safety.horizonFatalMass[2] > 0);
  });

  it("marks deadline move/turn escapes and excludes FIRE while still exposed", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 4);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    assert.ok(RULE.BOMB_RANGE < 3);
    const projected = new Uint16Array([
      state.cell(7, 4), state.cell(4, 4), state.cell(4, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.equal(obligation.firstAction[2], 0);
    assert.ok(obligation.firstAction[0] === 1 || obligation.firstAction[1] === 1);
  });

  it("restricts acceptable rows to clearing first actions on the same frame without prior active", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 3);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.FIRE]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([state.cell(7, 4), state.cell(4, 4)]);
    obligation.evaluate(bundle, actions, args, 2, hardStatus, projected);
    assert.equal(obligation.active, 0);
    assert.equal(obligation.firstAction[0], 1);
    assert.equal(obligation.firstAction[1], 0);
    const controller = {
      acceptableCount: 2,
      outcome: { acceptable: new Uint8Array([1, 1]) },
      recomputeSelectionFrontier() {}
    };
    const removed = obligation.restrictRiskController(controller, state, 2);
    assert.equal(removed, 1);
    assert.equal(controller.outcome.acceptable[0], 1);
    assert.equal(controller.outcome.acceptable[1], 0);
  });

  it("hard-restricts away from FIRE on same frame when DeadlineKernel finds move escapes", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 5);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.FIRE]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([state.cell(5, 4), state.cell(4, 4)]);
    obligation.evaluate(bundle, actions, args, 2, hardStatus, projected);
    assert.ok(obligation.deadlineFirstCount >= 1);
    assert.equal(obligation.firstAction[1], 0);
    const controller = {
      acceptableCount: 2,
      outcome: { acceptable: new Uint8Array([1, 1]) },
      recomputeSelectionFrontier() {}
    };
    const removed = obligation.restrictRiskController(controller, state, 2);
    assert.equal(removed, 1);
    assert.equal(controller.outcome.acceptable[1], 0);
  });

  it("prefers clearing over in-blast stay, but does not rank in-blast manhattan rings", () => {
    const { state, bundle } = openArena();
    placeBomb(state, state.cell(4, 4), 3);
    const obligation = new EscapeObligation();
    const actions = new Uint8Array([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT]);
    const args = new Uint16Array([NONE_CELL, NONE_CELL, NONE_CELL]);
    const hardStatus = new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
    const projected = new Uint16Array([
      state.cell(7, 4), state.cell(4, 4), state.cell(5, 4)
    ]);
    obligation.evaluate(bundle, actions, args, 3, hardStatus, projected);
    assert.equal(obligation.committedPressure[0], 0);
    assert.equal(obligation.committedPressure[1], obligation.committedPressure[2]);
    assert.equal(obligation.firstAction[0], 1);
    assert.equal(obligation.firstAction[1], 0);
  });
});
