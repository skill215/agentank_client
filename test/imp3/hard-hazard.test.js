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
    (Math.max(built.state.width, built.state.height,
      RULE.BOMB_FUSE * RULE.PROJECTILE_STEPS) + 1) * built.state.cells);
  assert.equal(hazard.viableA.length, built.state.cells * 4);
  assert.ok(CAPACITY.MAX_PROJECTILES + CAPACITY.MAX_BOMBS <= 0xff);
});

test("hazard storage is bounded by physical lifetime and overlong bomb evidence fails closed", () => {
  const built = fast.createFastPhysical(physical({ platformFrame: 1, recordIndex: 1,
    bombs: [{ entityId: 7, ownerSeat: 1, cell: [3, 2], placedFrame: 0,
      explodeFrame: 100 }] }));
  assert.equal(built.hazard.maxTicks,
    Math.max(built.state.width, built.state.height,
      RULE.BOMB_FUSE * RULE.PROJECTILE_STEPS));
  assert.equal(built.hazard.rebuild(0), 0);
  assert.equal(built.hazard.complete, 0);
  assert.equal(built.hazard.reverseViable(0), -1);
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

test("reverse viability result cache is exact, optional, and invalidated by state hash", () => {
  const spec = physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
  ] });
  const uncached = fast.createFastPhysical(spec);
  const cached = fast.createFastPhysical(spec, { reverseViabilityCacheEntries: 8 });
  const expected = uncached.hazard.reverseViable(0);
  assert.equal(cached.hazard.reverseCacheEntries, 8);
  assert.equal(cached.hazard.reverseViable(0), expected);
  assert.equal(cached.hazard.reverseCacheMissCount, 1);
  assert.equal(cached.hazard.reverseViable(0), expected);
  assert.equal(cached.hazard.reverseCacheHitCount, 1);

  assert.equal(cached.kernel.applyFrame(), fast.FAST_STATUS.APPLIED);
  const changed = cached.hazard.reverseViable(0);
  assert.equal(uncached.kernel.applyFrame(), fast.FAST_STATUS.APPLIED);
  assert.equal(changed, uncached.hazard.reverseViable(0));
  assert.equal(cached.hazard.reverseCacheMissCount, 2);
  assert.equal(uncached.hazard.reverseCacheEntries, 0);
  assert.equal(uncached.hazard.reverseCacheHitCount, 0);
});

test("reverse lattice cache reuses an exact committed hazard field across tank poses", () => {
  const spec = physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
  ] });
  const built = fast.createFastPhysical(spec, { reverseLatticeCacheEntries: 4 });
  const control = fast.createFastPhysical(spec);
  assert.equal(built.hazard.reverseViable(0), control.hazard.reverseViable(0));
  assert.equal(built.hazard.reverseLatticeMissCount, 1);
  const mark = built.state.beginTransition();
  const controlMark = control.state.beginTransition();
  const direction = (built.state.arrays[fast.ARRAY.TANK_DIR][0] + 1) & 3;
  assert.equal(built.state.write(fast.ARRAY.TANK_DIR, 0,
    direction), 1);
  assert.equal(control.state.write(fast.ARRAY.TANK_DIR, 0, direction), 1);
  assert.equal(built.hazard.reverseViable(0), control.hazard.reverseViable(0));
  assert.equal(built.hazard.reverseLatticeHitCount, 1);
  built.state.undoTo(mark);
  control.state.undoTo(controlMark);
  assert.equal(built.state.deltaUsed, 0);
});

test("reverse lattice cache matches uncached viability across every free pose", () => {
  const spec = physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" },
    { entityId: 4, ownerSeat: 1, cell: [5, 1], direction: "down" }
  ], bombs: [
    { entityId: 5, ownerSeat: 1, cell: [3, 3], placedFrame: 0, explodeFrame: 3 }
  ] });
  const cached = fast.createFastPhysical(spec, { reverseLatticeCacheEntries: 2 });
  const control = fast.createFastPhysical(spec);
  const terrain = cached.state.arrays[fast.ARRAY.TERRAIN];
  for (let cell = 0; cell < cached.state.cells; cell += 1) {
    if (terrain[cell] === fast.TERRAIN.WALL || terrain[cell] === fast.TERRAIN.DIRT) continue;
    for (let direction = 0; direction < 4; direction += 1) {
      cached.state.arrays[fast.ARRAY.TANK_CELL][0] = cell;
      cached.state.arrays[fast.ARRAY.TANK_DIR][0] = direction;
      control.state.arrays[fast.ARRAY.TANK_CELL][0] = cell;
      control.state.arrays[fast.ARRAY.TANK_DIR][0] = direction;
      cached.state.initializeHash(); control.state.initializeHash();
      assert.equal(cached.hazard.reverseViable(0), control.hazard.reverseViable(0),
        `pose ${cell}:${direction}`);
    }
  }
  assert.ok(cached.hazard.reverseLatticeHitCount >
    cached.hazard.reverseLatticeMissCount);
});

test("hazard plane cache ignores tank pose but invalidates on entity generation", () => {
  const built = fast.createFastPhysical(physical({ projectiles: [
    { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
  ] }));
  assert.equal(built.hazard.rebuild(0), 1);
  const initialBuilds = built.hazard.rebuildCount;
  built.state.arrays[fast.ARRAY.TANK_DIR][0] =
    (built.state.arrays[fast.ARRAY.TANK_DIR][0] + 1) & 3;
  built.state.initializeHash();
  assert.equal(built.hazard.rebuild(0), 1);
  assert.equal(built.hazard.rebuildCount, initialBuilds);
  assert.ok(built.hazard.cacheHitCount > 0);
  built.state.arrays[fast.ARRAY.PROJECTILE_GENERATION][0] += 1;
  built.state.initializeHash();
  assert.equal(built.hazard.rebuild(0), 1);
  assert.equal(built.hazard.rebuildCount, initialBuilds + 1);
});
