"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeEnemyNominalOptionResponseMassPoc,
  NativeEnemyResponseOptionCensusPoc } = require(
  "../../tools/agentank/diagnostics/native-enemy-response-option-poc");

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
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  return { adapter: { state }, enemyCount: 3,
    enemyActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT, ACTION.FIRE]),
    enemyArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]) };
}

test("enemy response option keeps root domain and compresses deeper domain", () => {
  const engine = fixture();
  const search = { rootEnemyDomainMask: Uint8Array.from([1, 1, 1]),
    opponentWeight() { return 1000; } };
  const option = new NativeEnemyNominalOptionResponseMassPoc("shadow");
  assert.equal(option.copyEnemyDomain(engine, search, 0), 3);
  assert.equal(option.copyEnemyDomain(engine, search, 1), 1);
  assert.ok(option.enemyActions[6] >= ACTION.NONE);
  assert.equal(option.enemyOptionStateCount, 1);
  assert.equal(option.enemyOptionHotAllocationCount, 0);
});

test("enemy response option census preserves the host-resolved action", () => {
  const census = new NativeEnemyResponseOptionCensusPoc("shadow");
  const resolved = { action: ACTION.FIRE, argument: NONE_CELL, row: 3 };
  assert.strictEqual(census.closeHostOverride(null, ACTION.GO, NONE_CELL,
    resolved), resolved);
});
