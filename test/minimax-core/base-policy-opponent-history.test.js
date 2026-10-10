"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { TERRAIN, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { NativeBasePolicyOpponentHistory } = require(
  "../../engine-v2/src/base-policy/opponent-history");

function random(seed) {
  seed.value ^= seed.value << 13;
  seed.value ^= seed.value >>> 17;
  seed.value ^= seed.value << 5;
  return seed.value >>> 0;
}

function referenceBlend(reference) {
  const total = reference.counts.reduce((sum, value) => sum + value, 0);
  const concentration = Math.max(...reference.counts) / total;
  let blend = 0.15 + Math.min(0.12, reference.observations * 0.01);
  blend += Math.max(0, concentration - 0.5) * 0.28;
  if (reference.goStreak >= 3) blend += 0.05;
  return Math.round(Math.min(0.35, blend) * 10000);
}

function updateReference(reference, observation) {
  if (!observation.visible) {
    reference.lastBullet = observation.bullet;
    reference.lastVisible = false;
    return;
  }
  let action = -1;
  const consecutive = reference.lastVisible &&
    observation.frame === reference.lastVisibleFrame + 1;
  if (consecutive) {
    if (observation.cell !== reference.cell) {
      action = 0; reference.stationary = 0;
    } else if (observation.direction !== reference.direction) {
      reference.stationary += 1;
      if (observation.direction === ((reference.direction + 3) & 3)) action = 1;
      else if (observation.direction === ((reference.direction + 1) & 3)) action = 2;
    } else if (observation.bullet && !reference.lastBullet && observation.near) {
      reference.stationary += 1; action = 3;
    } else reference.stationary += 1;
  }
  if (action >= 0) {
    reference.counts[action] += 1;
    reference.observations += 1;
    reference.goStreak = action === 0 ? reference.goStreak + 1 : 0;
  }
  reference.cell = observation.cell;
  reference.direction = observation.direction;
  reference.lastBullet = observation.bullet;
  reference.lastVisibleFrame = observation.frame;
  reference.lastVisible = true;
}

test("native opponent history exactly reproduces V1 integer context", () => {
  const state = new FastState(12, 12); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN, 0, state.cells);
  a[ARRAY.TANK_CELL][0] = state.cell(2, 2);
  let enemyCell = state.cell(7, 7); let enemyDirection = 0;
  const projectileActive = new Uint8Array(16);
  const projectileOwner = new Uint8Array(16);
  const projectileCell = new Uint16Array(16);
  const seen = new Uint8Array(16);
  const projectiles = { lastObservationCount: 0, seen };
  const adapter = { state, enemyVisible: 1,
    tracker: { projectileActive, projectileOwner, projectileCell, projectiles } };
  const engine = { adapter };
  const history = new NativeBasePolicyOpponentHistory();
  const reference = { counts: [1, 1, 1, 1], observations: 0, goStreak: 0,
    stationary: 0, cell: 0xffff, direction: 0, lastBullet: false,
    lastVisibleFrame: NONE_FRAME, lastVisible: false };
  const seed = { value: 0x15968b01 };
  for (let frame = 0; frame < 4096; frame += 1) {
    const visible = random(seed) % 9 !== 0;
    const action = random(seed) % 6;
    let bullet = false;
    if (visible) {
      if (action === 0) {
        const x = state.x(enemyCell); const y = state.y(enemyCell);
        const nx = x + (enemyDirection === 1 ? 1 : enemyDirection === 3 ? -1 : 0);
        const ny = y + (enemyDirection === 2 ? 1 : enemyDirection === 0 ? -1 : 0);
        if (nx >= 0 && nx < state.width && ny >= 0 && ny < state.height)
          enemyCell = state.cell(nx, ny);
      } else if (action === 1) enemyDirection = (enemyDirection + 3) & 3;
      else if (action === 2) enemyDirection = (enemyDirection + 1) & 3;
      else if (action === 3) bullet = true;
    }
    a[ARRAY.SCALAR][SCALAR.FRAME] = frame;
    a[ARRAY.TANK_CELL][1] = enemyCell;
    a[ARRAY.TANK_DIR][1] = enemyDirection;
    adapter.enemyVisible = visible ? 1 : 0;
    projectiles.lastObservationCount = bullet ? 1 : 0;
    projectileActive.fill(0); projectileOwner.fill(0); seen.fill(0);
    if (bullet) {
      projectileActive[0] = 1; projectileOwner[0] = 1; seen[0] = 1;
      const x = state.x(enemyCell); const y = state.y(enemyCell);
      const px = Math.max(0, Math.min(state.width - 1,
        x + (enemyDirection === 1 ? 1 : enemyDirection === 3 ? -1 : 0)));
      const py = Math.max(0, Math.min(state.height - 1,
        y + (enemyDirection === 2 ? 1 : enemyDirection === 0 ? -1 : 0)));
      projectileCell[0] = state.cell(px, py);
    }
    const observation = { frame, visible, cell: enemyCell,
      direction: enemyDirection, bullet, near: bullet };
    updateReference(reference, observation);
    history.observe(engine);
    history.observe(engine); // same-frame diagnostics must be idempotent
    assert.deepEqual(Array.from(history.counts), reference.counts,
      `count mismatch at frame ${frame}`);
    assert.equal(history.observations, reference.observations,
      `observation mismatch at frame ${frame}`);
    assert.equal(history.goStreak, reference.goStreak,
      `GO streak mismatch at frame ${frame}`);
    assert.equal(history.stationaryStreak, reference.stationary,
      `stationary streak mismatch at frame ${frame}`);
    assert.equal(history.expectationBlendBasisPoints, referenceBlend(reference),
      `blend mismatch at frame ${frame}`);
  }
});

test("native opponent history owns fixed state and returns a reused context", () => {
  const history = new NativeBasePolicyOpponentHistory();
  assert.ok(history.counts instanceof Uint32Array);
  assert.equal(history.contextView(), history.contextView());
  assert.equal(history.contextView().expectationBlendBasisPoints, 1500);
  assert.equal(history.hotAllocationCount, 0);
});
