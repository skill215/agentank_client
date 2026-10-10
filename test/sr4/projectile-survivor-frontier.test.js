"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { RULE } = require("../../engine-v2/src/generated/fast-config");
const { CombatPressure } = require("../../engine-v2/src/search/combat-pressure");
const { PAC_CELL, ProjectileAttackClosure } =
  require("../../engine-v2/src/search/projectile-attack-closure");

const BASIC = [fast.ACTION.NONE, fast.ACTION.GO,
  fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];

function closureFixture(own, enemy, enemyActions = BASIC, overrides = {}) {
  const map = overrides.map ||
    { width: 12, height: 12, terrainColumnMajor: boxedMap(12, 12) };
  const built = fast.createFastPhysical(physical({ map, tanks: [own, enemy] }));
  const actions = new Uint8Array([fast.ACTION.FIRE]);
  const arguments_ = new Uint16Array([fast.NONE_CELL]);
  const projectedCell = new Uint16Array(
    [built.state.arrays[fast.ARRAY.TANK_CELL][0]]);
  const projectedDirection = new Uint8Array(
    [built.state.arrays[fast.ARRAY.TANK_DIR][0]]);
  const combat = new CombatPressure();
  combat.evaluate(built, actions, 1, projectedCell, projectedDirection,
    true, new Uint16Array(1));
  const robustBefore = combat.vector.robustPressure[0];
  const closure = new ProjectileAttackClosure();
  closure.frontierEnabled = overrides.frontierEnabled === false ? 0 : 1;
  closure.evaluate(built, actions, arguments_, 1,
    new Uint8Array(enemyActions),
    new Uint16Array(enemyActions.length).fill(fast.NONE_CELL),
    enemyActions.length, combat.vector);
  return { built, combat, closure, robustBefore, actions, arguments_ };
}

function target(state, cell, direction) {
  const dx = [0, 1, 0, -1]; const dy = [-1, 0, 1, 0];
  const x = state.x(cell) + dx[direction];
  const y = state.y(cell) + dy[direction];
  return x < 0 || x >= state.width || y < 0 || y >= state.height ?
    fast.NONE_CELL : state.cell(x, y);
}

function walkable(state, cell) {
  if (cell === fast.NONE_CELL) return false;
  const terrain = state.arrays[fast.ARRAY.TERRAIN][cell];
  return terrain !== fast.TERRAIN.WALL && terrain !== fast.TERRAIN.DIRT;
}

function expand(state, source) {
  const own = state.arrays[fast.ARRAY.TANK_CELL][0];
  const result = new Set();
  for (const pose of source) {
    const cell = (pose / 4) | 0; const direction = pose & 3;
    result.add(pose);
    result.add(cell * 4 + ((direction + 1) & 3));
    result.add(cell * 4 + ((direction + 3) & 3));
    const forward = target(state, cell, direction);
    if (forward !== own && walkable(state, forward))
      result.add(forward * 4 + direction);
  }
  return result;
}

function counterfireDistance(state) {
  const own = state.arrays[fast.ARRAY.TANK_CELL][0];
  const distance = new Map(); const queue = [];
  for (let ray = 0; ray < 4; ray += 1) {
    let cell = target(state, own, ray);
    while (walkable(state, cell)) {
      const pose = cell * 4 + ((ray + 2) & 3);
      if (!distance.has(pose)) {
        distance.set(pose, 0); queue.push(pose);
      }
      cell = target(state, cell, ray);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const pose = queue[head]; const cell = (pose / 4) | 0;
    const direction = pose & 3; const nextDistance = distance.get(pose) + 1;
    for (const priorDirection of [((direction + 1) & 3),
      ((direction + 3) & 3)]) {
      const prior = cell * 4 + priorDirection;
      if (!distance.has(prior)) {
        distance.set(prior, nextDistance); queue.push(prior);
      }
    }
    const behind = target(state, cell, (direction + 2) & 3);
    const prior = behind * 4 + direction;
    if (behind !== own && walkable(state, behind) && !distance.has(prior)) {
      distance.set(prior, nextDistance); queue.push(prior);
    }
  }
  return distance;
}

function mobility(state, cell) {
  const own = state.arrays[fast.ARRAY.TANK_CELL][0]; let count = 0;
  for (let direction = 0; direction < 4; direction += 1) {
    const next = target(state, cell, direction);
    if (next !== own && walkable(state, next)) count += 1;
  }
  return count;
}

function measure(state, poses, distance) {
  let counterfire = 255; let bestMobility = 0;
  for (const pose of poses) {
    counterfire = Math.min(counterfire, distance.get(pose) ?? 255);
    bestMobility = Math.max(bestMobility, mobility(state, (pose / 4) | 0));
  }
  return { endpoints: poses.size, counterfire, mobility: bestMobility };
}

function frontierOracle(fixture, startCell, startDirection) {
  const state = fixture.built.state; const timeline = fixture.closure.timeline;
  let baseline = new Set([startCell * 4 + startDirection]);
  let constrained = new Set(baseline);
  for (let tick = 1; tick <= timeline.horizonTick; tick += 1) {
    if (tick > 1 && (tick & 1) !== 0) {
      baseline = expand(state, baseline);
      constrained = expand(state, constrained);
    }
    constrained = new Set([...constrained].filter(pose =>
      !timeline.isLethal(tick, (pose / 4) | 0)));
  }
  const distance = counterfireDistance(state);
  const before = measure(state, baseline, distance);
  const after = measure(state, constrained, distance);
  const setupDelay = before.counterfire === 255 ? 0 :
    after.counterfire === 255 ? 4 :
      Math.max(0, Math.min(4, after.counterfire - before.counterfire));
  const mobilityLoss = Math.max(0, before.mobility - after.mobility);
  return {
    setupDelay,
    mobilityLoss,
    endpointReduction: Math.max(0, before.endpoints - after.endpoints),
    pressure: Math.min(1600, setupDelay * 250 + mobilityLoss * 150)
  };
}

test("PAC2 survivor frontier prices delayed counterfire without changing survival", () => {
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [9, 3], "down"));
  assert.deepEqual([...fixture.closure.cellStatus.slice(0, 4)],
    [PAC_CELL.SURVIVES, PAC_CELL.SURVIVES,
      PAC_CELL.SURVIVES, PAC_CELL.SURVIVES]);
  assert.deepEqual([...fixture.closure.cellSetupDelay.slice(0, 4)], [1, 1, 1, 1]);
  assert.deepEqual([...fixture.closure.cellPressure.slice(0, 4)], [250, 250, 250, 250]);
  assert.equal(fixture.closure.frontierColumns[0], 4);
  assert.equal(fixture.combat.vector.robustPressure[0], fixture.robustBefore);
});

test("PAC2 forward frontier agrees with an independent set oracle", () => {
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [9, 3], "down"), [fast.ACTION.NONE]);
  const state = fixture.built.state;
  const expected = frontierOracle(fixture,
    state.arrays[fast.ARRAY.TANK_CELL][1],
    state.arrays[fast.ARRAY.TANK_DIR][1]);
  assert.equal(fixture.closure.cellSetupDelay[0], expected.setupDelay);
  assert.equal(fixture.closure.cellMobilityLoss[0], expected.mobilityLoss);
  assert.equal(fixture.closure.cellEndpointReduction[0], expected.endpointReduction);
  assert.equal(fixture.closure.cellPressure[0], expected.pressure);
});

test("PAC2 endpoint count reduction is audit-only when best endpoint is unchanged", () => {
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [4, 4], "down"), [fast.ACTION.NONE]);
  assert.equal(fixture.closure.cellStatus[0], PAC_CELL.SURVIVES);
  assert.ok(fixture.closure.cellEndpointReduction[0] > 0);
  assert.equal(fixture.closure.cellSetupDelay[0], 0);
  assert.equal(fixture.closure.cellMobilityLoss[0], 0);
  assert.equal(fixture.closure.cellPressure[0], 0);
});

test("PAC2 mobility loss remains a separate integer pressure dimension", () => {
  const terrain = [
    ["x","x","x","x","x","x","x","x","x","x","x","x"],
    ["x",".",".",".",".",".",".",".",".",".",".","x"],
    ["x","x",".",".",".",".",".",".",".",".",".","x"],
    ["x","x",".","x","x",".","x",".",".","x",".","x"],
    ["x",".",".",".",".",".",".",".",".",".",".","x"],
    ["x",".",".",".","x","x","x",".",".",".","x","x"],
    ["x",".",".",".",".",".","x",".","x",".",".","x"],
    ["x",".",".",".",".",".",".",".",".",".",".","x"],
    ["x","x",".","x",".","x",".",".",".",".",".","x"],
    ["x",".",".","x","x","x",".",".",".",".","x","x"],
    ["x",".",".",".",".",".",".",".",".",".",".","x"],
    ["x","x","x","x","x","x","x","x","x","x","x","x"]
  ];
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [4, 3], "down"), [fast.ACTION.GO], { map:
      { width: 12, height: 12, terrainColumnMajor: terrain } });
  assert.equal(fixture.closure.cellSetupDelay[0], 1);
  assert.equal(fixture.closure.cellMobilityLoss[0], 1);
  assert.equal(fixture.closure.cellPressure[0], 400);
});

test("PAC2 skill uncertainty and root-frame-only trajectories add no frontier value", () => {
  const skill = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [6, 4], "up", { skillId: "shield", skillReadyFrame: 0 }),
    [fast.ACTION.NONE], { map:
      { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
  assert.equal(skill.closure.frontierBuildCount, 0);
  assert.equal(skill.closure.cellPressure[0], 0);
  const short = closureFixture(tank(0, [1, 2], "right"),
    tank(1, [3, 1], "down"), [fast.ACTION.NONE], { map:
      { width: 5, height: 5, terrainColumnMajor: boxedMap(5, 5) } });
  assert.ok(short.closure.timeline.horizonTick <= RULE.PROJECTILE_STEPS);
  assert.equal(short.closure.frontierBuildCount, 0);
});

test("PAC2 off preserves PAC1 relation and its exact root contribution", () => {
  const terrain = boxedMap(8, 7); terrain[3][2] = "x";
  const options = { map: { width: 8, height: 7, terrainColumnMajor: terrain } };
  const on = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), BASIC, options);
  const off = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), BASIC, { ...options, frontierEnabled: false });
  assert.deepEqual([...on.closure.cellStatus.slice(0, 4)],
    [...off.closure.cellStatus.slice(0, 4)]);
  assert.deepEqual([...on.closure.cellPressure.slice(0, 4)],
    [...off.closure.cellPressure.slice(0, 4)]);
  assert.equal(on.combat.vector.attackPressureContribution[0],
    off.combat.vector.attackPressureContribution[0]);
});

test("PAC2 feature switch participates in exact cache identity", () => {
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [9, 3], "down"), [fast.ACTION.NONE]);
  const beforeHits = fixture.closure.cacheHitCount;
  fixture.closure.frontierEnabled = 0;
  fixture.closure.evaluate(fixture.built, fixture.actions, fixture.arguments_, 1,
    new Uint8Array([fast.ACTION.NONE]),
    new Uint16Array([fast.NONE_CELL]), 1, fixture.combat.vector);
  assert.equal(fixture.closure.cacheHitCount, beforeHits);
  assert.equal(fixture.closure.cellStatus[0], PAC_CELL.SURVIVES);
  assert.equal(fixture.closure.cellPressure[0], 0);
  assert.equal(fixture.closure.frontierColumns[0], 0);
});

test("PAC2 hot state is fixed integer memory and owns no Hard or Proof result", () => {
  const closure = new ProjectileAttackClosure(); const seen = new Set();
  let floats = 0;
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      if (value instanceof Float32Array || value instanceof Float64Array) floats += 1;
      return;
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(closure);
  assert.equal(floats, 0);
  assert.equal(closure.hotAllocationCount, 0);
  assert.equal("hardStatus" in closure, false);
  assert.equal("proofStatus" in closure, false);
  const source = fs.readFileSync(path.join(__dirname,
    "../../engine-v2/src/search/projectile-attack-closure.js"), "utf8");
  assert.doesNotMatch(source, /Float32Array|Float64Array|Math\.random|Date\.now|console\./);
});
