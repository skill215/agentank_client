"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INCOMPLETE_VALUE,
  VALUE_RELATION,
  POINTWISE_RELATION,
  POLICY_KIND,
  packVector,
  unpackVector,
  valueRelation,
  pointwiseRelation,
  RefusalAwareEventValueSearch
} = require(
  "../../tools/agentank/diagnostics/semantic-attack-refusal-value-search");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, DIRECTION, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");

test("mixed radix packing round-trips every refusal dimension", () => {
  const value = packVector(2, 3, 2, 1, 2, 4, 12, 8, 16, 6);
  assert.deepEqual(unpackVector(value), { terminal: 2,
    committedSafety: 3, attackStage: 2, counterSafety: 1,
    lineControl: 2, mobilityPressure: 4, proximity: 12,
    starDelta: 8, starRace: 16, resourceBalance: 6 });
  assert.equal(unpackVector(INCOMPLETE_VALUE), null);
});

test("every higher-order refusal dimension dominates all lower dimensions", () => {
  const lowMaximum = packVector(1, 2, 3, 1, 2, 4, 12, 8, 16, 6);
  const highMinimum = packVector(1, 3, 0, 0, 0, 0, 0, 0, 0, 0);
  assert.ok(highMinimum > lowMaximum);
  assert.ok(packVector(2, 0, 0, 0, 0, 0, 0, 0, 0, 0) >
    packVector(1, 3, 3, 1, 2, 4, 12, 8, 16, 6));
});

test("value and pointwise relations fail closed on incomplete support", () => {
  assert.equal(valueRelation(10, 11), VALUE_RELATION.CANDIDATE_HIGHER);
  assert.equal(valueRelation(10, 9), VALUE_RELATION.CANDIDATE_LOWER);
  assert.equal(valueRelation(10, 10), VALUE_RELATION.EQUAL);
  assert.equal(valueRelation(10, 11, false), VALUE_RELATION.INCOMPLETE);
  assert.equal(pointwiseRelation(Int32Array.from([1, 2]),
    Int32Array.from([2, 3]), 2), POINTWISE_RELATION.CANDIDATE_DOMINATES);
  assert.equal(pointwiseRelation(Int32Array.from([1, 3]),
    Int32Array.from([2, 2]), 2), POINTWISE_RELATION.MIXED);
  assert.equal(pointwiseRelation(Int32Array.from([1, 2]),
    Int32Array.from([1, INCOMPLETE_VALUE]), 2),
    POINTWISE_RELATION.INCOMPLETE);
});

test("refusal search inherits the fixed one-action replanning policy", () => {
  const search = new RefusalAwareEventValueSearch(64);
  assert.equal(search.maximumOwnDomain, 0);
  assert.equal(search.rootColumnValue.length > 0, true);
  assert.equal(search.absoluteLowerBoundCutoffCount, 0);
  assert.equal(search.policyDecisionCount, 0);
  assert.equal(search.ttValue.length, search.ttDepth.length);
  assert.equal(search.policyKind, POLICY_KIND.DIRECT_PURSUIT);
  assert.equal(new RefusalAwareEventValueSearch(64,
    POLICY_KIND.FLANKING_LINE).policyKind, POLICY_KIND.FLANKING_LINE);
  assert.equal(search.hotAllocationCount, 0);
});

test("counter-safe policy can refuse a mutually aimed shot", () => {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint16Array(32);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 7;
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([12, 10]);
  arrays[ARRAY.TANK_DIR] = Uint8Array.from([
    DIRECTION.LEFT, DIRECTION.RIGHT]);
  arrays[ARRAY.TANK_FIRE_LOCK] = Uint16Array.from([
    NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.PROJECTILE_ACTIVE] = new Uint8Array(16);
  arrays[ARRAY.TERRAIN] = new Uint8Array(25);
  const state = { arrays, cells: 25, width: 5, height: 5,
    x(cell) { return cell % 5; },
    y(cell) { return Math.floor(cell / 5); },
    cell(x, y) { return y * 5 + x; } };
  assert.equal(new RefusalAwareEventValueSearch(64,
    POLICY_KIND.DIRECT_PURSUIT).policyAction(state), ACTION.FIRE);
  assert.equal(new RefusalAwareEventValueSearch(64,
    POLICY_KIND.COUNTER_SAFE_PRESSURE).policyAction(state), ACTION.TURN_LEFT);
});
