"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { NativeBasePolicyEngine } = require(
  "../../engine-v2/src/runtime/native-base-policy-engine");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { TERRAIN } = require("../../engine-v2/src/abi/fast-codes");

function side(id, position, direction = "right", skill = "stun") {
  return { tank: position ? { id, position, direction, crashed: false } : null,
    stars: 0, bullet: null,
    skill: { type: skill, remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null },
    status: { shielded: false, cloaked: false, boosted: false,
      overloaded: false, frozen: false, stunned: false, poisoned: false,
      fireLocked: false, bombCooldownFrames: 0, bombActive: false,
      canActThisFrame: true, actionSpeed: 1 } };
}

function game(frame, size = 7) {
  const map = Array.from({ length: size }, (_, x) => Array.from(
    { length: size }, (_, y) => x === 0 || y === 0 || x === size - 1 ||
      y === size - 1 ? "x" : "."));
  return { frame, frames: frame, map, star: [3, 3], bombs: [] };
}

function mass(engine) {
  let total = 0;
  for (let index = 0; index < engine.hiddenWorldCount; index += 1)
    total += engine.worldMass[index];
  return total;
}

test("hidden enemy produces a normalized reachable InformationState", () => {
  const engine = new NativeBasePolicyEngine();
  const own = side("own", [1, 3], "right", "poison");
  const visible = side("enemy", [5, 3], "left");
  assert.ok(engine.adapter.adapt(own, visible, game(1)).bundle);
  assert.equal(engine.prepareHiddenWorlds(), 1);
  assert.equal(engine.hiddenWorldSupportComplete, 1);
  assert.equal(engine.worldMass[0], 10000);

  const hidden = side("enemy", null, "left");
  assert.ok(engine.adapter.adapt(own, hidden, game(2)).bundle);
  const count = engine.prepareHiddenWorlds();
  assert.ok(count > 0);
  assert.equal(engine.hiddenWorldSupportComplete, 0);
  assert.equal(engine.hiddenWorldRiskSupportComplete, 1);
  assert.equal(mass(engine), 10000);
  const cells = Array.from(engine.worldCell.subarray(0, count));
  assert.ok(cells.includes(engine.adapter.lastEnemyCell));
  assert.ok(cells.includes(engine.adapter.state.cell(4, 3)));
});

test("hidden worlds prevent blanket UNKNOWN=10000 and keep Hard separate", () => {
  const engine = new NativeBasePolicyEngine();
  const own = side("own", [1, 3], "right", "poison");
  assert.ok(engine.adapter.adapt(own,
    side("enemy", [5, 3], "left"), game(1)).bundle);
  const adapted = engine.adapter.adapt(own,
    side("enemy", null, "left"), game(2));
  engine.updatePossibleProjectiles(true);
  engine.generateActions();
  const selectionCount = engine.prepareRoot(adapted.bundle);
  const outcome = engine.riskController.outcome;
  assert.ok(engine.hiddenWorldCount > 0);
  assert.equal(engine.hiddenWorldSupportComplete, 0);
  let actionable = 0; let blanketUnknown = 1;
  for (let row = 0; row < selectionCount; row += 1) {
    if (outcome.unknownMass[row] < 10000) blanketUnknown = 0;
    if (outcome.acceptable[row] && !outcome.dominated[row]) actionable += 1;
  }
  assert.equal(blanketUnknown, 0);
  assert.ok(actionable > 0);
});

test("unknown initial pose is bounded explicitly instead of becoming exact", () => {
  const engine = new NativeBasePolicyEngine();
  const adapted = engine.adapter.adapt(side("own", [1, 1], "right", "poison"),
    side("enemy", null, "left", "teleport"), game(1, 20));
  assert.ok(adapted.bundle);
  const count = engine.prepareHiddenWorlds();
  assert.equal(count, engine.worldCell.length);
  assert.equal(engine.hiddenWorldSupportComplete, 0);
  assert.equal(engine.hiddenWorldRiskSupportComplete, 0);
  assert.equal(mass(engine), 10000);
  for (let index = 0; index < count; index += 1) {
    const cell = engine.worldCell[index];
    assert.notEqual(cell, engine.adapter.state.arrays[ARRAY.TANK_CELL][0]);
    assert.notEqual(engine.adapter.state.arrays[ARRAY.TERRAIN][cell], TERRAIN.WALL);
    assert.equal(engine.worldDirectionMask[index], 0x0f);
  }
});

test("mobility treats the enemy pose as occupied", () => {
  const engine = new NativeBasePolicyEngine();
  assert.ok(engine.adapter.adapt(side("own", [2, 2], "right", "poison"),
    side("enemy", [3, 2], "left"), game(1)).bundle);
  assert.equal(engine.countMobility(engine.adapter.state.cell(2, 2)), 3);
});
