"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { TERRAIN, EVENT, NONE_FRAME, NONE_CELL } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeV1PolicyLeafEvaluatorPoc } = require(
  "../../tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc");

function state(own, enemy, ownDirection = 1, enemyDirection = 3) {
  const value = new FastState(12, 12); const a = value.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, value.cells);
  a[ARRAY.TANK_CELL][0] = value.cell(own[0], own[1]);
  a[ARRAY.TANK_CELL][1] = value.cell(enemy[0], enemy[1]);
  a[ARRAY.TANK_DIR][0] = ownDirection; a[ARRAY.TANK_DIR][1] = enemyDirection;
  a[ARRAY.TANK_FIRE_LOCK][0] = NONE_FRAME; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_SHIELD_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_SHIELD_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_OVERLOAD_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_OVERLOAD_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_CLOAK_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_CLOAK_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][0] = NONE_FRAME;
  a[ARRAY.TANK_BOOST_UNTIL][1] = NONE_FRAME;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = NONE_CELL;
  return value;
}

test("V1 policy geometry keeps stars meaningful without making one step dominant", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc();
  const ahead = state([3, 3], [8, 8]);
  const tied = state([3, 3], [8, 8]);
  ahead.arrays[ARRAY.TANK_STARS][0] = 1;
  assert.ok(evaluator.evaluate(ahead) > evaluator.evaluate(tied));
  assert.equal(evaluator.summary().hotAllocationCount, 0);
});

test("V1 policy geometry rewards the faster open attack race", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc();
  const initiative = state([2, 4], [8, 4], 1, 0);
  const exposed = state([2, 4], [8, 4], 0, 3);
  assert.ok(evaluator.evaluate(initiative) > evaluator.evaluate(exposed));
  assert.ok(evaluator.summary().attackRaceWinCount > 0);
});

test("V1 policy geometry penalizes a committed incoming projectile", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc();
  const safe = state([3, 4], [9, 4], 0, 0);
  const threatened = state([3, 4], [9, 4], 0, 0);
  const a = threatened.arrays;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = threatened.cell(7, 4);
  a[ARRAY.PROJECTILE_DIR][0] = 3;
  assert.ok(evaluator.evaluate(safe) > evaluator.evaluate(threatened));
  assert.ok(evaluator.summary().projectileThreatCount > 0);
});

test("V1-compatible leaf mode preserves non-terminal values beyond 25000", () => {
  const threatened = state([3, 4], [9, 4], 0, 0);
  const a = threatened.arrays;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = threatened.cell(5, 4);
  a[ARRAY.PROJECTILE_DIR][0] = 3;
  a[ARRAY.TERRAIN][threatened.cell(3, 3)] = TERRAIN.WALL;
  a[ARRAY.TERRAIN][threatened.cell(3, 5)] = TERRAIN.WALL;
  const clamped = new NativeV1PolicyLeafEvaluatorPoc();
  const compatible = new NativeV1PolicyLeafEvaluatorPoc({ clampLimit: 0 });
  assert.equal(clamped.evaluate(threatened), -25000);
  assert.ok(compatible.evaluate(threatened) < -25000);
  assert.equal(clamped.summary().clampLimit, 25000);
  assert.equal(compatible.summary().clampLimit, 0);
});

test("component leaf clamp preserves other dimensions after projectile saturation", () => {
  const threatened = state([3, 4], [9, 4], 0, 0);
  const a = threatened.arrays;
  a[ARRAY.TANK_STARS][0] = 1;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = threatened.cell(5, 4);
  a[ARRAY.PROJECTILE_DIR][0] = 3;
  a[ARRAY.TERRAIN][threatened.cell(3, 3)] = TERRAIN.WALL;
  a[ARRAY.TERRAIN][threatened.cell(3, 5)] = TERRAIN.WALL;
  const total = new NativeV1PolicyLeafEvaluatorPoc();
  const component = new NativeV1PolicyLeafEvaluatorPoc({
    clampMode: "component"
  });
  assert.equal(total.evaluate(threatened), -25000);
  assert.ok(component.evaluate(threatened) > -25000);
  assert.ok(component.summary().componentClampCount > 0);
  assert.equal(component.summary().clampMode, "component");
});

test("V1 policy geometry discounts a projectile created inside the search tree", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc({
    discountSimulatedProjectiles: true
  });
  const observed = state([2, 4], [10, 4], 0, 0);
  const simulated = state([2, 4], [10, 4], 0, 0);
  for (const value of [observed, simulated]) {
    const a = value.arrays;
    a[ARRAY.TERRAIN][value.cell(10, 3)] = TERRAIN.WALL;
    a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 0;
    a[ARRAY.PROJECTILE_ID][0] = 77; a[ARRAY.PROJECTILE_CELL][0] = value.cell(4, 4);
    a[ARRAY.PROJECTILE_DIR][0] = 1;
  }
  evaluator.beginRoot(observed);
  const observedValue = evaluator.evaluate(observed);
  evaluator.beginRoot(simulated);
  simulated.eventType[0] = EVENT.PROJECTILE_CREATED;
  simulated.eventEntity[0] = 77; simulated.eventUsed = 1;
  const simulatedValue = evaluator.evaluate(simulated);
  assert.ok(observedValue > simulatedValue);
  assert.ok(evaluator.summary().simulatedProjectileCount > 0);
});

test("V1 policy geometry prefers room to a pressured outer corner", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc();
  const center = state([5, 5], [8, 8], 0, 0);
  const corner = state([1, 1], [3, 2], 0, 0);
  corner.arrays[ARRAY.TERRAIN][corner.cell(2, 1)] = TERRAIN.WALL;
  corner.arrays[ARRAY.TERRAIN][corner.cell(1, 2)] = TERRAIN.WALL;
  assert.ok(evaluator.evaluate(center) > evaluator.evaluate(corner));
});

test("V1 policy geometry preserves timed status asymmetry", () => {
  const evaluator = new NativeV1PolicyLeafEvaluatorPoc();
  const enemyFrozen = state([3, 3], [8, 8]);
  const ownFrozen = state([3, 3], [8, 8]);
  enemyFrozen.arrays[ARRAY.TANK_FROZEN_UNTIL][1] = 3;
  ownFrozen.arrays[ARRAY.TANK_FROZEN_UNTIL][0] = 3;
  assert.ok(evaluator.evaluate(enemyFrozen) > evaluator.evaluate(ownFrozen));
  assert.ok(evaluator.summary().statusCount > 0);
});

test("V1 policy geometry component ablation removes only named dimensions", () => {
  const value = state([3, 4], [9, 4], 1, 3);
  const a = value.arrays;
  a[ARRAY.TANK_STARS][0] = 1;
  a[ARRAY.SCALAR][SCALAR.STAR_CELL] = value.cell(5, 4);
  a[ARRAY.TANK_FROZEN_UNTIL][1] = 2;
  const full = new NativeV1PolicyLeafEvaluatorPoc();
  const fullValue = full.evaluate(value);
  const components = Array.from(full.lastComponents);
  const names = ["star-score", "star-route", "projectile", "attack",
    "position", "status"];
  for (let index = 0; index < names.length; index += 1) {
    const ablated = new NativeV1PolicyLeafEvaluatorPoc({
      omitComponents: names[index]
    });
    assert.equal(ablated.evaluate(value), fullValue - components[index], names[index]);
    assert.deepEqual(ablated.summary().omittedComponents, [names[index]]);
  }
});

test("V1 policy geometry supports deterministic multi-component ablation", () => {
  const value = state([3, 4], [9, 4], 1, 3);
  value.arrays[ARRAY.TANK_STARS][0] = 1;
  const full = new NativeV1PolicyLeafEvaluatorPoc();
  const fullValue = full.evaluate(value);
  const ablated = new NativeV1PolicyLeafEvaluatorPoc({
    omitComponents: "star-score,status"
  });
  assert.equal(ablated.evaluate(value), fullValue - full.lastComponents[0] -
    full.lastComponents[5]);
  assert.deepEqual(ablated.summary().omittedComponents,
    ["star-score", "status"]);
  assert.equal(ablated.summary().hotAllocationCount, 0);
});
