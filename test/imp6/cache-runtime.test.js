"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fast, search, policy, cache, runtime, cacheCodes, runtimeConfig,
  boxedMap, tank, physical, terminalMatrixGraph } = require("./helpers");

const { CACHE_ID, CACHE_FLAG, CACHE_MISS, CACHE_DEPENDENCY, WORK_KIND,
  RUNTIME_MODE, EMERGENCY_REASON } = cacheCodes;
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");

test("all eleven canonical caches verify dual hash signature lifecycle and cache off semantics", () => {
  const inventory = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    "../../docs/design/dd8-cache-inventory.json"), "utf8"));
  assert.equal(CACHE_ID.COUNT, 11); assert.equal(inventory.canonicalCacheIds.length, 11);
  const bank = new cache.CacheBank({ enabled: new Array(11).fill(1) });
  const production = new ProductionCacheBank();
  for (let id = 0; id < CACHE_ID.COUNT; id += 1) {
    production.setEnabled(id, true); const current = bank.get(id); const stripped = production.get(id);
    const slot = current.write(100 + id, 200 + id, 300 + id,
      400 + id, 7, current.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, id,
      CACHE_FLAG.COMPLETE, 2, id * 10, id * -10, id + 1, id + 2);
    const strippedSlot = stripped.write(100 + id, 200 + id, 300 + id,
      400 + id, 7, stripped.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, id,
      CACHE_FLAG.COMPLETE, 2, id * 10, id * -10, id + 1, id + 2);
    assert.equal(strippedSlot, slot);
    assert.notEqual(slot, CACHE_MISS); assert.equal(current.probe(100 + id, 200 + id,
      300 + id, 400 + id, 7), slot); const direct = current.value0[slot];
    assert.equal(stripped.probe(100 + id, 200 + id, 300 + id, 400 + id, 7), slot);
    current.setEnabled(false); stripped.setEnabled(false); assert.equal(current.probe(100 + id, 200 + id,
      300 + id, 400 + id, 7), CACHE_MISS); assert.equal(id * 10, direct);
    assert.equal(stripped.probe(100 + id, 200 + id, 300 + id, 400 + id, 7), CACHE_MISS);
  }
  bank.beginMatch(); production.beginMatch();
  assert.ok(bank.caches.every(item => item.currentGeneration > 1));
  assert.deepEqual(production.caches.map(item => item.currentGeneration),
    bank.caches.map(item => item.currentGeneration));
});

test("cache collisions stale generations and protected replacement fail closed", () => {
  const current = new cache.CanonicalCache(CACHE_ID.PROOF_CACHE, 2, 2, 1);
  const first = current.write(0, 1, 2, 3, 1, current.currentGeneration,
    CACHE_DEPENDENCY.OBSERVATION, 10, CACHE_FLAG.PROTECTED, 5, 1, 2, 3, 4);
  assert.notEqual(first, CACHE_MISS);
  assert.equal(current.probe(0, 1, 9, 9, 1), CACHE_MISS); assert.equal(current.collisionCount, 1);
  assert.equal(current.probe(0, 1, 2, 3, 2), CACHE_MISS); assert.equal(current.staleCount, 1);
  const second = current.write(2, 1, 4, 5, 1, current.currentGeneration,
    CACHE_DEPENDENCY.OBSERVATION, 11, CACHE_FLAG.PINNED, 5, 5, 6, 7, 8);
  assert.notEqual(second, CACHE_MISS);
  assert.equal(current.write(4, 1, 6, 7, 1, current.currentGeneration,
    CACHE_DEPENDENCY.OBSERVATION, 12, 0, 1, 9, 10, 11, 12), CACHE_MISS);
  current.startGeneration(); assert.equal(current.probe(0, 1, 2, 3, 1), CACHE_MISS);
});

test("terrain entity opponent profile and plan invalidation is dependency exact", () => {
  const bank = new cache.CacheBank({ enabled: new Array(11).fill(1) });
  const current = bank.get(CACHE_ID.FEATURE_CACHE); const dependencies = [CACHE_DEPENDENCY.TERRAIN,
    CACHE_DEPENDENCY.ENTITY, CACHE_DEPENDENCY.OPPONENT, CACHE_DEPENDENCY.PROFILE, CACHE_DEPENDENCY.PLAN];
  const slots = dependencies.map((dependency, index) => current.write(index, 1, index + 10,
    index + 20, 1, current.currentGeneration, dependency, 100 + index, 0, 1,
    index, 0, 0, 0));
  assert.equal(bank.invalidate(CACHE_DEPENDENCY.ENTITY, 101), 1);
  for (let index = 0; index < slots.length; index += 1)
    assert.equal(current.valid[slots[index]], index === 1 ? 0 : 1);
  assert.equal(bank.invalidate(CACHE_DEPENDENCY.TERRAIN), 1);
  assert.equal(bank.invalidate(CACHE_DEPENDENCY.OPPONENT | CACHE_DEPENDENCY.PROFILE), 2);
  assert.equal(current.valid[slots[4]], 1); assert.equal(bank.invalidate(CACHE_DEPENDENCY.PLAN, 104), 1);
});

test("active projectile bomb and plan facts survive cache eviction and disabled caches", () => {
  const map = boxedMap(9, 7); const bundle = fast.createFastPhysical(physical({ platformFrame: 2,
    recordIndex: 2, map: { width: 9, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [2, 2], "right", { skillId: "poison" }), tank(1, [7, 5], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [5, 2], direction: "left" }],
    bombs: [{ entityId: 4, ownerSeat: 1, cell: [6, 4], placedFrame: 0, explodeFrame: 5 }] }));
  const sketches = new policy.PlanSketchArena(); const plans = new policy.PersistentPlanArena();
  const sketch = sketches.create(policy.PLAN_KIND.SHOT, policy.PLAN_PURPOSE.DIRECT_KILL,
    fast.ACTION.FIRE); const handle = plans.materialize(sketches, sketch, true); plans.activate(handle);
  const bank = new cache.CacheBank({ enabled: new Array(11).fill(1) });
  for (let id = 0; id < CACHE_ID.COUNT; id += 1) { const current = bank.get(id);
    for (let key = 0; key < current.entryCount * 3; key += 1) current.write(key, id,
      key ^ 3, key ^ 7, 1, current.currentGeneration, CACHE_DEPENDENCY.PHYSICAL, key,
      0, key & 7, key, id, 0, 0); current.setEnabled(false); }
  assert.equal(bundle.state.activeProjectileCount(), 1);
  assert.equal(bundle.state.arrays[fast.ARRAY.BOMB_ACTIVE][0], 1);
  assert.ok(plans.decode(handle) >= 0); assert.equal(plans.status[plans.decode(handle)], policy.PLAN_STATUS.ACTIVE);
});

test("runtime counter latches fallback at 1500 equivalent work and preserves emergency reserve", () => {
  const reserve = new runtime.EmergencyReserve(); const controller = new runtime.RuntimeController({
    emergencyReserve: reserve });
  for (let frame = 0; frame < 3; frame += 1) { controller.beginCallback(frame, 1, 2, frame === 0);
    controller.chargeUnits(50000, WORK_KIND.VALUE_NODE); controller.finishCallback(); }
  assert.equal(controller.accumulatedWorkUnits, runtimeConfig.RUNTIME_CONFIG.FALLBACK_ENTER_WORK_UNITS);
  assert.equal(controller.runtimeMode, RUNTIME_MODE.FALLBACK); assert.equal(controller.fallbackLatched, 1);
  controller.beginCallback(3, 1, 2); controller.chargeUnits(1, WORK_KIND.CACHE);
  assert.equal(controller.runtimeMode, RUNTIME_MODE.FALLBACK); controller.finishCallback();
  controller.beginCallback(4, 1, 2); controller.chargeUnits(50000, WORK_KIND.VALUE_NODE);
  controller.finishCallback(); controller.beginCallback(5, 1, 2);
  controller.chargeUnits(49999, WORK_KIND.VALUE_NODE); controller.finishCallback();
  assert.equal(controller.runtimeMode, RUNTIME_MODE.EMERGENCY);
  assert.equal(controller.emergencyReason, EMERGENCY_REASON.CUMULATIVE_LIMIT);
  assert.equal(reserve.bytes(), 2688); assert.ok(reserve.activationCount > 0);
});

test("same frame and ambiguous reset cannot erase accumulated runtime", () => {
  const controller = new runtime.RuntimeController(); controller.beginCallback(10, 11, 12, true);
  controller.chargeUnits(40000, WORK_KIND.VALUE_NODE); controller.finishCallback();
  const generation = controller.matchRuntimeGeneration;
  controller.beginCallback(10, 99, 100, false); controller.finishCallback();
  controller.beginCallback(0, 11, 12, false); controller.finishCallback();
  assert.equal(controller.accumulatedWorkUnits, 40000);
  assert.equal(controller.matchRuntimeGeneration, generation);
  controller.beginCallback(0, 99, 100, true); assert.equal(controller.accumulatedWorkUnits, 0);
  assert.equal(controller.matchRuntimeGeneration, generation + 1);
});

test("deterministic frame floors can reduce search without dividing the 128-frame budget", () => {
  const config = { ...runtimeConfig.RUNTIME_CONFIG, DEGRADED_ENTER_FRAME: 64,
    FALLBACK_ENTER_FRAME: 100, EMERGENCY_ENTER_FRAME: 124 };
  const controller = new runtime.RuntimeController({ runtimeConfig: config });
  controller.beginCallback(63, 1, 2, true); assert.equal(controller.runtimeMode, RUNTIME_MODE.NORMAL);
  controller.finishCallback(); controller.beginCallback(64, 1, 2);
  assert.equal(controller.runtimeMode, RUNTIME_MODE.DEGRADED);
  controller.finishCallback(); controller.beginCallback(100, 1, 2);
  assert.equal(controller.runtimeMode, RUNTIME_MODE.FALLBACK);
  controller.finishCallback(); controller.beginCallback(124, 1, 2);
  assert.equal(controller.runtimeMode, RUNTIME_MODE.EMERGENCY);
  assert.equal(controller.emergencyReason, EMERGENCY_REASON.FRAME_FLOOR);
});

test("fallback uses benchmark selected nonzero Minimax depth with unchanged Hard Terminal semantics", () => {
  const controller = new runtime.RuntimeController();
  for (let frame = 0; frame < 3; frame += 1) { controller.beginCallback(frame, 1, 2, frame === 0);
    controller.chargeUnits(50000, WORK_KIND.VALUE_NODE); controller.finishCallback(); }
  assert.equal(controller.runtimeMode, RUNTIME_MODE.FALLBACK); const options = {};
  controller.writeSearchOptions(options); assert.equal(options.decisionDepth, 3);
  assert.ok(options.nodeBudget > 0 && options.proofBudget > 0 && options.matrixIterations > 0);
  const fixture = terminalMatrixGraph([[search.VALUE_MAX, search.VALUE_MIN],
    [search.VALUE_MIN, search.VALUE_MAX]]); const engine = new search.SearchEngine(fixture.graph);
  const coordinator = new runtime.RuntimeSearchCoordinator(); controller.beginCallback(3, 1, 2);
  assert.notEqual(coordinator.solve(engine, fixture.root, controller), 0);
  assert.equal(coordinator.minimaxInvocationCount, 1);
  const source = fs.readFileSync(path.resolve(__dirname, "../../engine-v2/src/runtime/controller.js"), "utf8");
  assert.doesNotMatch(source, /Monte\s*Carlo|\bMCTS\b|Math\.random/);
});

test("emergency emitter works with every cache disabled and still checks Hard", () => {
  const bank = new cache.CacheBank(); for (let id = 0; id < CACHE_ID.COUNT; id += 1)
    bank.setEnabled(id, false);
  const map = boxedMap(9, 7); const root = physical({ platformFrame: 4, recordIndex: 4,
    map: { width: 9, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [4, 3], "down"), tank(1, [7, 5], "left")],
    bombs: [{ entityId: 3, ownerSeat: 1, cell: [4, 1], placedFrame: 0, explodeFrame: 4 }] });
  const bundle = fast.createFastPhysical(root); const emitter = new runtime.EmergencyEmitter(
    new runtime.EmergencyReserve()); const actions = new Uint8Array([fast.ACTION.NONE, fast.ACTION.GO]);
  const arguments_ = new Uint16Array([fast.NONE_CELL, fast.NONE_CELL]);
  assert.equal(emitter.select(bundle, actions, arguments_, 2), 1);
  assert.equal(emitter.lastAction, fast.ACTION.GO); assert.equal(emitter.hardCheckedActions, 2);
  assert.equal(bank.caches.every(item => item.enabled === 0), true);
});
