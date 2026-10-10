"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeStunTurnDomainCompactionPoc } = require(
  "../../tools/agentank/diagnostics/native-stun-turn-domain-compaction-poc");

function fixture(stunned = true) {
  const state = new FastState(7, 7); const arrays = state.arrays;
  arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  arrays[ARRAY.TANK_CELL][0] = state.cell(1, 1);
  arrays[ARRAY.TANK_CELL][1] = state.cell(5, 5);
  arrays[ARRAY.TANK_STUN_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_FROZEN_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_POISON_UNTIL].fill(NONE_FRAME);
  arrays[ARRAY.TANK_POISON_APPLIED].fill(NONE_FRAME);
  arrays[ARRAY.TANK_FIRE_LOCK].fill(NONE_FRAME);
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  if (stunned) arrays[ARRAY.TANK_STUN_UNTIL][1] = 3;
  const engine = { adapter: { state }, enemyCount: 3,
    enemyActions: Uint8Array.from([
      ACTION.TURN_LEFT, ACTION.GO, ACTION.TURN_RIGHT]),
    enemyArguments: Uint16Array.from([NONE_CELL, NONE_CELL, NONE_CELL]) };
  const search = { rootEnemyDomainMask: Uint8Array.from([1, 1, 1]),
    opponentWeight(_engine, _state, action) {
      if (action === ACTION.TURN_LEFT) return 30;
      if (action === ACTION.TURN_RIGHT) return 70;
      return 50;
    } };
  return { engine, search };
}

test("stunned left/right response domains merge and retain total weight", () => {
  const { engine, search } = fixture(true);
  const compact = new NativeStunTurnDomainCompactionPoc("shadow");
  assert.equal(compact.copyEnemyDomain(engine, search, 0), 2);
  assert.deepEqual(Array.from(compact.enemyActions.subarray(0, 2)),
    [ACTION.TURN_LEFT, ACTION.GO]);
  assert.equal(compact.responseWeight(engine, search, engine.adapter.state,
    ACTION.TURN_LEFT, 0, 0), 100);
  assert.equal(compact.responseWeight(engine, search, engine.adapter.state,
    ACTION.GO, 0, 1), 50);
  assert.equal(compact.compactedActionCount, 1);
});

test("non-stunned response domain remains unchanged", () => {
  const { engine, search } = fixture(false);
  const compact = new NativeStunTurnDomainCompactionPoc("shadow");
  assert.equal(compact.copyEnemyDomain(engine, search, 0), 3);
  assert.deepEqual(Array.from(compact.enemyActions.subarray(0, 3)),
    [ACTION.TURN_LEFT, ACTION.GO, ACTION.TURN_RIGHT]);
  assert.equal(compact.compactedActionCount, 0);
});
