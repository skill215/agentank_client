"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("./helpers");
const { CAPACITY, RULE } = require("../../engine-v2/src/generated/fast-config");

test("HardGate numeric ABI separates policy rejection from physical proof", () => {
  assert.deepEqual(fast.HARD_STATUS,
    { ALLOW: 0, REJECT_PROVEN: 1, REJECT_POLICY: 2, INCOMPLETE: 3 });
});

test("every scored action is applied checked through Terminal and Hard then fully undone", () => {
  const built = fast.createFastPhysical(physical()); const root = built.state.rootSignature();
  const actions = new Uint8Array([fast.ACTION.NONE, fast.ACTION.GO, fast.ACTION.TURN_LEFT,
    fast.ACTION.TURN_RIGHT]); const args = new Uint16Array(4); args.fill(fast.NONE_CELL);
  const output = new Uint8Array(4); built.hard.evaluateBatch(actions, args, 4, output);
  assert.equal(built.hard.checkedActions, 4); assert.equal(built.kernel.hardCheckedActionCount, 4);
  assert.ok([...output].every(value => value === fast.HARD_STATUS.ALLOW));
  assert.equal(built.state.rootSignature(), root); assert.equal(built.hard.rootMismatchCount, 0);
});

test("an already committed unavoidable projectile loss is rejected before scoring", () => {
  const map = boxedMap(7, 5); map[2][1] = "x"; map[2][3] = "x";
  const built = fast.createFastPhysical(physical({ map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [tank(0, [3, 2], "right"), tank(1, [5, 3], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }] }));
  assert.equal(built.hard.evaluate(fast.ACTION.NONE), fast.HARD_STATUS.REJECT_PROVEN);
  assert.equal(built.hard.rootMismatchCount, 0);
});

test("a committed projectile with a legal dodge does not become a false forced death", () => {
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [3, 2], "up"),
    tank(1, [5, 3], "left")], projectiles: [
      { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
    ] }));
  assert.equal(built.hard.evaluate(fast.ACTION.GO), fast.HARD_STATUS.ALLOW);
});

test("a due bomb rejects blast cells but permits an actual first-step escape", () => {
  const map = boxedMap(9, 7);
  const root = physical({ platformFrame: 4, recordIndex: 4,
    map: { width: 9, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [4, 3], "down"), tank(1, [7, 5], "left")],
    bombs: [{ entityId: 3, ownerSeat: 1, cell: [4, 1], placedFrame: 0, explodeFrame: 4 }] });
  const stay = fast.createFastPhysical(root);
  assert.equal(stay.hard.evaluate(fast.ACTION.NONE), fast.HARD_STATUS.REJECT_PROVEN);
  const escape = fast.createFastPhysical(root);
  assert.equal(escape.hard.evaluate(fast.ACTION.GO), fast.HARD_STATUS.ALLOW);
});

test("enemy possible future fire is not inserted into the committed Hard plane", () => {
  const built = fast.createFastPhysical(physical());
  assert.equal(built.hazard.rebuild(0), 1); assert.equal(built.hazard.planCount, 0);
  assert.equal(built.hard.evaluate(fast.ACTION.NONE), fast.HARD_STATUS.ALLOW);
  assert.ok(built.hard.fastAllowCount > 0);
});

test("hazard planes use the active map stride and one-byte bounded exposure counts", () => {
  const built = fast.createFastPhysical(physical()); const hazard = built.hazard;
  assert.ok(hazard.exposure instanceof Uint8Array);
  assert.equal(hazard.cellStride, built.state.cells);
  assert.equal(hazard.exposure.length,
    (CAPACITY.MAX_HAZARD_FRAMES * RULE.PROJECTILE_STEPS + 1) * built.state.cells);
  assert.equal(hazard.viableA.length, built.state.cells * 4);
  assert.ok(CAPACITY.MAX_PROJECTILES + CAPACITY.MAX_BOMBS <= 0xff);
});

test("hazard rebuild clears every strided time row after a projectile disappears", () => {
  const root = physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
  ] });
  const built = fast.createFastPhysical(root); const hazard = built.hazard;
  assert.equal(hazard.rebuild(0), 1);
  const staleOffset = hazard.offset(2, built.state.cell(3, 2));
  assert.equal(hazard.lethal[staleOffset], 1);
  built.state.arrays[fast.ARRAY.PROJECTILE_ACTIVE].fill(0);
  built.state.initializeHash(); hazard.builtHashLo ^= 1;
  assert.equal(hazard.rebuild(0), 1);
  assert.equal(hazard.lethal[staleOffset], 0);
});

test("shield boost teleport and dirt-dependent narrow paths fail closed instead of proving death", () => {
  const map = boxedMap(9, 5); map[5][1] = "x"; map[5][3] = "x";
  const built = fast.createFastPhysical(physical({ map: { width: 9, height: 5,
    terrainColumnMajor: map }, tanks: [tank(0, [5, 2], "up", {
      skillId: "teleport", skillReadyFrame: 0 }), tank(1, [7, 3], "left")], projectiles: [
        { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
      ] }));
  assert.equal(built.hard.evaluate(fast.ACTION.NONE), fast.HARD_STATUS.INCOMPLETE);
});

test("committed SourcePlans persist across cache hits and disappear only after physical invalidation", () => {
  const built = fast.createFastPhysical(physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [4, 1], direction: "right" }
  ] }));
  assert.equal(built.hazard.rebuild(0), 1); assert.equal(built.hazard.planCount, 1);
  assert.equal(built.hazard.rebuild(0), 1); assert.equal(built.hazard.cacheHitCount, 1);
  assert.equal(built.kernel.applyFrame(), fast.FAST_STATUS.APPLIED);
  assert.equal(built.state.activeProjectileCount(), 0);
  assert.equal(built.hazard.rebuild(0), 1); assert.equal(built.hazard.planCount, 0);
});
