"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProjectileTrackPool, PROJECTILE_FACT, ASSOCIATION_STATUS,
  PROJECTILE_INVALIDATION } = require("../../engine-v2/src/runtime/projectile-track-pool");
const { TERRAIN } = require("../../engine-v2/src/abi/fast-codes");

function terrain(width = 8, height = 8) { const value = new Uint8Array(width * height);
  value.fill(TERRAIN.OPEN); return value; }
function bullet(x, y, direction = "right") { return { position: [x, y], direction }; }

test("SR1 ordinary and overload FIRE create independent continuous handles", () => {
  const pool = new ProjectileTrackPool();
  assert.equal(pool.recordFire(0, 9, 1, 4, false), 1);
  assert.equal(pool.recordFire(1, 17, 3, 4, true), 2);
  assert.equal(pool.count(), 3); const overload = [];
  for (let slot = 0; slot < pool.capacity; slot += 1)
    if (pool.active[slot] && pool.owner[slot] === 1) overload.push(slot);
  assert.equal(pool.group[overload[0]], pool.group[overload[1]]);
  assert.notEqual(pool.id[overload[0]], pool.id[overload[1]]);
  assert.deepEqual(overload.map(slot => pool.member[slot]).sort(), [0, 1]);
  assert.ok(overload.every(slot => pool.generation[slot] > 0 &&
    pool.fact[slot] === PROJECTILE_FACT.COMMITTED));
});

test("SR1 observing one projectile never clears another active track", () => {
  const pool = new ProjectileTrackPool(); pool.recordFire(1, 18, 1, 0);
  pool.recordFire(1, 42, 3, 0); pool.beginObservation();
  assert.equal(pool.observeSet(bullet(2, 2), 1, 0, 8, 8), ASSOCIATION_STATUS.EXACT);
  assert.equal(pool.count(1), 2); assert.equal(pool.lastSetComplete, 0);
  pool.refuteMissing(1, 0, 1, terrain(), 8, pool.lastSetComplete);
  assert.equal(pool.count(1), 2);
});

test("SR1 overload singleton observation stays ambiguous instead of greedy merging", () => {
  const pool = new ProjectileTrackPool(); pool.recordFire(0, 18, 1, 0, true);
  pool.beginObservation(); const status = pool.observeSet(bullet(2, 2), 0, 0, 8, 8);
  assert.equal(status, ASSOCIATION_STATUS.AMBIGUOUS);
  assert.equal(pool.complete, 0); assert.equal(pool.count(0), 2);
  assert.equal(pool.ambiguousAssociationCount, 1);
});

test("SR1 projectile canonical invalidation covers boundary wall dirt and proved tank hit", () => {
  const cases = [
    { cell: 15, dir: 1, expected: PROJECTILE_INVALIDATION.BOUNDARY },
    { cell: 9, dir: 1, target: 10, tile: TERRAIN.WALL, expected: PROJECTILE_INVALIDATION.WALL },
    { cell: 9, dir: 1, target: 10, tile: TERRAIN.DIRT, expected: PROJECTILE_INVALIDATION.DIRT },
    { cell: 9, dir: 1, alive: 10, expected: PROJECTILE_INVALIDATION.TANK }
  ];
  for (const item of cases) {
    const pool = new ProjectileTrackPool(); const map = terrain(4, 4);
    if (item.target !== undefined) map[item.target] = item.tile;
    const slot = pool.allocate(1, item.cell, item.dir, 0); pool.lastFrame = 0;
    pool.advance(1, map, 4, 4, item.alive);
    assert.equal(pool.active[slot], 0); assert.equal(pool.invalidation[slot], item.expected);
  }
});

test("SR1 callback gap and hidden reappearance preserve generation without fake exact support", () => {
  const pool = new ProjectileTrackPool(); const slot = pool.allocate(1, 9, 1, 0);
  const generation = pool.generation[slot]; pool.lastFrame = 0; pool.beginObservation();
  pool.observeSet(null, 1, 0, 8, 8); pool.advance(1, terrain(), 8, 8);
  assert.equal(pool.active[slot], 1); assert.equal(pool.generation[slot], generation);
  pool.beginObservation(); pool.observeSet(bullet(3, 1), 1, 1, 8, 8);
  assert.equal(pool.generation[slot], generation); assert.equal(pool.count(1), 1);
});

test("SR1 capacity overflow is explicit incomplete and generation reuse is continuous", () => {
  const pool = new ProjectileTrackPool({ capacity: 2 });
  const first = pool.allocate(1, 1, 1, 0); pool.allocate(1, 2, 1, 0);
  assert.equal(pool.allocate(1, 3, 1, 0), -1); assert.equal(pool.complete, 0);
  assert.equal(pool.capacityFailureCount, 1); const generation = pool.generation[first];
  pool.invalidate(first, PROJECTILE_INVALIDATION.WALL); const reused = pool.allocate(1, 4, 1, 1);
  assert.equal(reused, first); assert.notEqual(pool.generation[reused], generation);
  assert.equal(pool.generationReuseCount, 1);
});

test("SR1 pending own overload materializes both members only after the next callback phase", () => {
  const pool = new ProjectileTrackPool(); pool.reset(10);
  assert.equal(pool.recordPendingFire(0, 9, 1, 10, true), 2);
  assert.equal(pool.count(0), 0); pool.advance(10, terrain(), 8, 8);
  assert.equal(pool.count(0), 0); pool.advance(11, terrain(), 8, 8);
  assert.equal(pool.count(0), 2);
});

test("SR1 production projectile hot structures declare zero per-operation allocation", () => {
  const pool = new ProjectileTrackPool();
  for (let index = 0; index < 1000; index += 1) {
    pool.reset(index); pool.recordFire(index & 1, 9, 1, index, (index & 3) === 0);
  }
  assert.equal(pool.hotAllocationCount, 0); assert.equal(pool.relation.hotAllocationCount, 0);
});
