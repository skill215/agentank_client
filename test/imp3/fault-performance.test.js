"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../../config/engine-v2/imp3-capacity-manifest.json");
const { fast, physical } = require("./helpers");

test("FACT entity overflow returns incomplete without truncating an observed projectile", () => {
  const projectiles = Array.from({ length: 8 }, (_, index) => ({ entityId: index + 3,
    ownerSeat: 1, cell: [1 + index, 1], direction: "down", shotGroupId: index + 3 }));
  const map = Array.from({ length: 12 }, (_, x) => Array.from({ length: 5 }, (_, y) =>
    x === 0 || y === 0 || x === 11 || y === 4 ? "x" : "."));
  const built = fast.createFastPhysical(physical({ map: { width: 12, height: 5,
    terrainColumnMajor: map }, projectiles })); const root = built.state.rootSignature();
  assert.equal(built.kernel.applyFrame(fast.ACTION.FIRE),
    fast.FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY);
  assert.equal(built.state.activeProjectileCount(), 8); assert.equal(built.state.rootSignature(), root);
});

test("EVENT and DELTA required-minus-one capacity faults fail closed and fully undo", () => {
  const event = fast.createFastPhysical(physical(), { eventCapacity: 63 });
  const eventRoot = event.state.rootSignature();
  assert.equal(event.kernel.applyFrame(), fast.FAST_STATUS.INCOMPLETE_EVENT_CAPACITY);
  assert.equal(event.state.rootSignature(), eventRoot);
  const delta = fast.createFastPhysical(physical(), { deltaCapacity: 95 });
  const deltaRoot = delta.state.rootSignature();
  assert.equal(delta.kernel.applyFrame(), fast.FAST_STATUS.INCOMPLETE_DELTA_CAPACITY);
  assert.equal(delta.state.rootSignature(), deltaRoot);
});

test("root FACT overflow is explicit and cache absence means recompute rather than a semantic default", () => {
  const tooMany = physical({ projectiles: Array.from({ length: 9 }, (_, index) => ({
    entityId: index + 3, ownerSeat: index & 1, cell: [1, 1], direction: "right" })) });
  const imported = fast.createFastPhysical(tooMany);
  assert.equal(imported.status, fast.FAST_STATUS.INCOMPLETE_ENTITY_CAPACITY);
  const built = fast.createFastPhysical(physical());
  assert.equal(built.hazard.rebuild(0), 1); const builds = built.hazard.rebuildCount;
  built.hazard.builtHashLo ^= 1;
  assert.equal(built.hazard.rebuild(0), 1); assert.equal(built.hazard.rebuildCount, builds + 1);
});

test("declared hot kernels allocate no tracked temporary objects and publish bounded high-water", () => {
  const built = fast.createFastPhysical(physical());
  for (let iteration = 0; iteration < 16; iteration += 1)
    assert.equal(built.hard.evaluate(fast.ACTION.TURN_LEFT), fast.HARD_STATUS.ALLOW);
  assert.equal(built.state.hotAllocationCount, 0); assert.equal(built.kernel.state.hotAllocationCount, 0);
  assert.equal(built.hazard.hotAllocationCount, 0); assert.equal(built.hard.hotAllocationCount, 0);
  assert.ok(built.state.highWaterDelta <= manifest.limits.maxDeltasPerTransition);
  assert.ok(built.state.highWaterEvent <= manifest.limits.maxEventsPerTransition);
  assert.ok(built.hazard.highWaterTick <= manifest.limits.maxHazardFrames * 2);
});

test("capacity manifest separates FACT SUPPORT SEARCH CACHE and OUTPUT overflow classes", () => {
  assert.deepEqual(new Set(Object.values(manifest.capacityClasses)), new Set([
    "FACT_CRITICAL", "SUPPORT_CRITICAL", "SEARCH_QUALITY", "CACHE_ONLY", "OUTPUT_CRITICAL"
  ]));
  assert.equal(manifest.limits.maxCells,
    manifest.limits.maxMapWidth * manifest.limits.maxMapHeight);
  assert.equal(manifest.overflow.entity, "FAST_INCOMPLETE_ENTITY_CAPACITY");
  assert.equal(manifest.overflow.actions, "INCOMPLETE_ACTION_SUPPORT");
});
