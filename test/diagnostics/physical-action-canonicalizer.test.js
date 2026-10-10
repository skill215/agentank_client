"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { ACTION, CHANCE, TERRAIN, NONE_CELL, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { CANONICAL_REASON, PhysicalActionCanonicalizer } = require(
  "../../tools/agentank/diagnostics/physical-action-canonicalizer");

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

test("frozen commands canonicalize to NONE", () => {
  const state = stateFixture();
  state.arrays[ARRAY.TANK_FROZEN_UNTIL][0] = 3;
  const c = new PhysicalActionCanonicalizer();
  c.canonicalize(state, ACTION.FIRE, NONE_CELL, ACTION.NONE, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.equal(c.action[0], ACTION.NONE);
  assert.ok(c.reasonMask & CANONICAL_REASON.HELD_FROZEN);
});

test("existing projectile makes FIRE physically equivalent to NONE", () => {
  const state = stateFixture(); const a = state.arrays;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 0;
  const c = new PhysicalActionCanonicalizer();
  c.canonicalize(state, ACTION.FIRE, NONE_CELL, ACTION.NONE, NONE_CELL,
    CHANCE.REVERSED, CHANCE.NORMAL);
  assert.equal(c.action[0], ACTION.NONE);
  assert.ok(c.reasonMask &
    CANONICAL_REASON.SUPPRESSED_FIRE_ACTIVE_PROJECTILE);
});

test("GO into a wall canonicalizes to NONE but open GO does not", () => {
  const state = stateFixture(); const a = state.arrays;
  const c = new PhysicalActionCanonicalizer();
  a[ARRAY.TERRAIN][state.cell(3, 2)] = TERRAIN.WALL;
  c.canonicalize(state, ACTION.GO, NONE_CELL, ACTION.NONE, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.equal(c.action[0], ACTION.NONE);
  assert.ok(c.reasonMask & CANONICAL_REASON.BLOCKED_GO_TERRAIN);
  a[ARRAY.TERRAIN][state.cell(3, 2)] = TERRAIN.OPEN;
  c.canonicalize(state, ACTION.GO, NONE_CELL, ACTION.NONE, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.equal(c.action[0], ACTION.GO);
});

test("teleport keeps its argument while other actions discard it", () => {
  const state = stateFixture(); const c = new PhysicalActionCanonicalizer();
  c.canonicalize(state, ACTION.CAST_TELEPORT, 7, ACTION.NONE, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.equal(c.argument[0], 7);
  c.canonicalize(state, ACTION.FIRE, 7, ACTION.NONE, NONE_CELL,
    CHANCE.NORMAL, CHANCE.NORMAL);
  assert.equal(c.argument[0], NONE_CELL);
  assert.ok(c.reasonMask & CANONICAL_REASON.ARGUMENT_IGNORED);
});
