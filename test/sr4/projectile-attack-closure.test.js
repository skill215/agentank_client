"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { CombatPressure } = require("../../engine-v2/src/search/combat-pressure");
const { PAC_STATUS, PAC_CELL, ProjectileAttackTimeline, ProjectileAttackClosure } =
  require("../../engine-v2/src/search/projectile-attack-closure");
const { DeadlineKernel } = require("../../engine-v2/src/fast/deadline-kernel");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");

function closureFixture(own, enemy, enemyActions, overrides = {}) {
  const map = overrides.map ||
    { width: 12, height: 12, terrainColumnMajor: boxedMap(12, 12) };
  const built = fast.createFastPhysical(physical({ map, tanks: [own, enemy] }));
  const actions = new Uint8Array([fast.ACTION.FIRE]);
  const arguments_ = new Uint16Array([fast.NONE_CELL]);
  const projectedCell = new Uint16Array([built.state.arrays[fast.ARRAY.TANK_CELL][0]]);
  const projectedDirection = new Uint8Array(
    [built.state.arrays[fast.ARRAY.TANK_DIR][0]]);
  const combat = new CombatPressure();
  combat.evaluate(built, actions, 1, projectedCell, projectedDirection,
    overrides.visible !== false, new Uint16Array(1));
  const robustPressureBefore = combat.vector.robustPressure[0];
  const closure = new ProjectileAttackClosure();
  closure.evaluate(built, actions, arguments_, 1, new Uint8Array(enemyActions),
    new Uint16Array(enemyActions.length).fill(fast.NONE_CELL),
    enemyActions.length, combat.vector);
  return { built, combat, closure, robustPressureBefore };
}

test("PAC1 seven-cell movement crossing remains soft while open escape survives", () => {
  const fixture = closureFixture(tank(0, [1, 5], "right"),
    tank(1, [8, 6], "up"), [fast.ACTION.NONE, fast.ACTION.GO,
      fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT]);
  assert.equal(fixture.combat.vector.possibleHit[0], 1);
  assert.equal(fixture.combat.vector.directKill[0], 0);
  assert.equal(fixture.closure.status[0], PAC_STATUS.COMPLETE);
  assert.equal(fixture.closure.doomedEnemyColumns[0], 0);
  assert.equal(fixture.closure.survivingEnemyColumns[0], 4);
  assert.equal(fixture.combat.vector.robustPressure[0],
    fixture.robustPressureBefore);
});

test("PAC1 marks only first actions whose full movement continuation is doomed", () => {
  const actions = [fast.ACTION.NONE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];
  const fixture = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), actions, { map:
      { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
  assert.deepEqual(Array.from(fixture.closure.cellStatus.slice(0, 4)),
    [PAC_CELL.PROVEN_DOOMED, PAC_CELL.SURVIVES,
      PAC_CELL.PROVEN_DOOMED, PAC_CELL.PROVEN_DOOMED]);
  assert.equal(fixture.closure.doomedEnemyColumns[0], 3);
  assert.equal(fixture.closure.survivingEnemyColumns[0], 1);
  assert.ok(fixture.closure.cellPressure[0] > 0);
  assert.equal(fixture.closure.cellPressure[1], 0);
  assert.equal(fixture.combat.vector.escapeDenial[0], 1);
  assert.equal(fixture.combat.vector.enemySafeSuccessors[0], 1);
  assert.equal(fixture.combat.vector.robustPressure[0],
    fixture.robustPressureBefore);
});

test("PAC1 all basic first actions may be doomed without manufacturing Proof", () => {
  const terrain = boxedMap(8, 7); terrain[3][2] = "x";
  const fixture = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), [fast.ACTION.NONE, fast.ACTION.GO,
      fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT], { map:
      { width: 8, height: 7, terrainColumnMajor: terrain } });
  assert.equal(fixture.closure.status[0], PAC_STATUS.COMPLETE);
  assert.equal(fixture.closure.doomedEnemyColumns[0], 4);
  assert.equal(fixture.closure.survivingEnemyColumns[0], 0);
  assert.equal("proofStatus" in fixture.closure, false);
  assert.equal("hardStatus" in fixture.closure, false);
  assert.equal(fixture.combat.vector.robustPressure[0],
    fixture.robustPressureBefore);
});

test("PAC1 shield teleport and boost support fail closed as UNKNOWN", () => {
  for (const skillId of ["shield", "teleport", "boost"]) {
    const fixture = closureFixture(tank(0, [1, 3], "right"),
      tank(1, [3, 3], "up", { skillId, skillReadyFrame: 0 }),
      [fast.ACTION.NONE, fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT],
      { map: { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
    assert.equal(fixture.closure.doomedEnemyColumns[0], 0, skillId);
    assert.ok(fixture.closure.unknownEnemyColumns[0] > 0, skillId);
    assert.equal(fixture.closure.status[0], PAC_STATUS.INCOMPLETE, skillId);
  }
});

test("PAC1 overload owns two independent trajectory members", () => {
  const fixture = closureFixture(tank(0, [1, 3], "right",
    { overloadUntilFrame: 4 }), tank(1, [3, 3], "up"),
  [fast.ACTION.NONE, fast.ACTION.GO], { map:
    { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
  assert.equal(fixture.closure.timeline.memberCount, 2);
  assert.ok(fixture.closure.timeline.horizonTick > 0);
  assert.equal(fixture.closure.timeline.complete, 1);
});

test("PAC1 wall dirt and boundary terminate candidate projectile timelines", () => {
  const state = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [5, 4], "up"), [fast.ACTION.NONE], { map:
      { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } }).built.state;
  const timeline = new ProjectileAttackTimeline();
  assert.equal(timeline.build(state, state.cell(1, 3), fast.DIRECTION.RIGHT, 0), 1);
  assert.equal(timeline.horizonTick, 5);
  state.arrays[fast.ARRAY.TERRAIN][state.cell(4, 3)] = fast.TERRAIN.DIRT;
  assert.equal(timeline.build(state, state.cell(1, 3), fast.DIRECTION.RIGHT, 0), 1);
  assert.equal(timeline.horizonTick, 2);
  assert.equal(timeline.isLethal(3, state.cell(4, 3)), 0);
});

function oracleSurvives(timeline, state, startCell, startDirection, startTick) {
  const memo = new Map();
  function walkable(cell) {
    return cell !== fast.NONE_CELL &&
      state.arrays[fast.ARRAY.TERRAIN][cell] !== fast.TERRAIN.WALL &&
      state.arrays[fast.ARRAY.TERRAIN][cell] !== fast.TERRAIN.DIRT;
  }
  function target(cell, direction) {
    const dx = [0, 1, 0, -1]; const dy = [-1, 0, 1, 0];
    const x = state.x(cell) + dx[direction]; const y = state.y(cell) + dy[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      fast.NONE_CELL : state.cell(x, y);
  }
  function solve(cell, direction, tick) {
    if (timeline.isLethal(tick, cell)) return false;
    if (tick >= timeline.horizonTick) return true;
    const key = `${cell}:${direction}:${tick}`;
    if (memo.has(key)) return memo.get(key);
    let result = false;
    if ((tick & 1) !== 0) result = solve(cell, direction, tick + 1);
    else {
      result = solve(cell, direction, tick + 1) ||
        solve(cell, (direction + 3) & 3, tick + 1) ||
        solve(cell, (direction + 1) & 3, tick + 1);
      const next = target(cell, direction);
      if (!result && walkable(next)) result = solve(next, direction, tick + 1);
    }
    memo.set(key, result); return result;
  }
  return solve(startCell, startDirection, startTick);
}

test("PAC1 reverse viability matches an exhaustive orientation-time oracle", () => {
  const terrain = boxedMap(8, 7); terrain[4][2] = "x"; terrain[5][4] = "m";
  const built = fast.createFastPhysical(physical({ map:
    { width: 8, height: 7, terrainColumnMajor: terrain },
  tanks: [tank(0, [1, 3], "right"), tank(1, [6, 5], "left")] }));
  const timeline = new ProjectileAttackTimeline();
  assert.equal(timeline.build(built.state, built.state.cell(1, 3),
    fast.DIRECTION.RIGHT, 0), 1);
  const deadline = new DeadlineKernel(); deadline.buildReverse(timeline);
  for (let cell = 0; cell < built.state.cells; cell += 1) {
    if (built.state.arrays[fast.ARRAY.TERRAIN][cell] === fast.TERRAIN.WALL ||
        built.state.arrays[fast.ARRAY.TERRAIN][cell] === fast.TERRAIN.DIRT) continue;
    for (let direction = 0; direction < 4; direction += 1) {
      const expected = oracleSurvives(timeline, built.state, cell, direction, 1);
      const actual = deadline.poseViable(deadline.viableTick1, cell, direction) === 1;
      assert.equal(actual, expected, `${cell}:${direction}`);
    }
  }
});

function ownProjectileActive(state) {
  const arrays = state.arrays;
  for (let slot = 0; slot < arrays[fast.ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
    if (arrays[fast.ARRAY.PROJECTILE_ACTIVE][slot] &&
        arrays[fast.ARRAY.PROJECTILE_OWNER][slot] === 0) return true;
  return false;
}

function fastKernelEnemyCanSurvive(bundle, rootEnemyAction) {
  const state = bundle.state; const kernel = bundle.kernel;
  const continuations = [fast.ACTION.NONE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];
  function continueFrom(depth) {
    if (state.arrays[fast.ARRAY.TANK_CRASH][1]) return false;
    if (!ownProjectileActive(state)) return true;
    if (depth >= 12) return true;
    for (const action of continuations) {
      const status = kernel.applyFrame(fast.ACTION.NONE, fast.NONE_CELL,
        action, fast.NONE_CELL);
      if (status !== fast.FAST_STATUS.APPLIED &&
          status !== fast.FAST_STATUS.APPLIED_TERMINAL) continue;
      const mark = kernel.lastMark;
      const survives = continueFrom(depth + 1);
      state.undoTo(mark);
      if (survives) return true;
    }
    return false;
  }
  const status = kernel.applyFrame(fast.ACTION.FIRE, fast.NONE_CELL,
    rootEnemyAction, fast.NONE_CELL);
  if (status !== fast.FAST_STATUS.APPLIED &&
      status !== fast.FAST_STATUS.APPLIED_TERMINAL) return true;
  const mark = kernel.lastMark;
  const survives = continueFrom(1);
  state.undoTo(mark);
  return survives;
}

test("PAC1 PROVEN_DOOMED has zero false positives against FastKernel continuation", () => {
  const actions = [fast.ACTION.NONE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];
  const names = ["up", "right", "down", "left"];
  let doomed = 0;
  for (const direction of names) {
    const fixture = closureFixture(tank(0, [1, 3], "right"),
      tank(1, [3, 3], direction), actions, { map:
        { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
    for (let column = 0; column < actions.length; column += 1) {
      if (fixture.closure.cellStatus[column] !== PAC_CELL.PROVEN_DOOMED) continue;
      assert.equal(fastKernelEnemyCanSurvive(fixture.built, actions[column]), false,
        `${direction}:${actions[column]}`);
      doomed += 1;
    }
  }
  assert.ok(doomed > 0);
});

test("PAC1 exact query cache preserves all cell relations and hot allocation stays zero", () => {
  const actions = [fast.ACTION.NONE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.TURN_RIGHT];
  const fixture = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), actions, { map:
      { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
  const before = Array.from(fixture.closure.cellStatus.slice(0, 4));
  const fire = new Uint8Array([fast.ACTION.FIRE]);
  const pressureBefore = fixture.combat.vector.pressureValue[0];
  const root = [fixture.built.state.hashLo, fixture.built.state.hashHi,
    fixture.built.state.deltaUsed, fixture.built.state.eventUsed];
  fixture.closure.evaluate(fixture.built, fire,
    new Uint16Array([fast.NONE_CELL]), 1, new Uint8Array(actions),
    new Uint16Array(actions.length).fill(fast.NONE_CELL), actions.length,
    fixture.combat.vector);
  assert.deepEqual(Array.from(fixture.closure.cellStatus.slice(0, 4)), before);
  assert.equal(fixture.closure.cacheHitCount, 1);
  assert.equal(fixture.closure.reverseBuildCount, 1);
  assert.equal(fixture.closure.hotAllocationCount, 0);
  assert.equal(fixture.combat.vector.pressureValue[0], pressureBefore);
  assert.deepEqual([fixture.built.state.hashLo, fixture.built.state.hashHi,
    fixture.built.state.deltaUsed, fixture.built.state.eventUsed], root);
  assert.equal(fixture.closure.rootRestoreFailures, 0);
});

test("PAC1 cache key includes the soft FIRE qualification view", () => {
  const actions = [fast.ACTION.NONE, fast.ACTION.GO];
  const fixture = closureFixture(tank(0, [1, 3], "right"),
    tank(1, [3, 3], "up"), actions, { map:
      { width: 8, height: 7, terrainColumnMajor: boxedMap(8, 7) } });
  const beforeHits = fixture.closure.cacheHitCount;
  fixture.combat.vector.possibleHit[0] = 0;
  fixture.combat.vector.intercept[0] = 0;
  fixture.combat.vector.directKill[0] = 0;
  fixture.closure.evaluate(fixture.built, new Uint8Array([fast.ACTION.FIRE]),
    new Uint16Array([fast.NONE_CELL]), 1, new Uint8Array(actions),
    new Uint16Array(actions.length).fill(fast.NONE_CELL), actions.length,
    fixture.combat.vector);
  assert.equal(fixture.closure.cacheHitCount, beforeHits);
  assert.equal(fixture.closure.status[0], PAC_STATUS.NONE);
  assert.equal(fixture.closure.doomedEnemyColumns[0], 0);
});

test("PAC1 pressure enters StageMatrix only after Risk/Pareto qualification", () => {
  const fixture = productionRootFixture();
  fixture.game.map = boxedMap(8, 7);
  fixture.me.tank.position = [1, 3]; fixture.me.tank.direction = "right";
  fixture.enemy.tank.position = [3, 3]; fixture.enemy.tank.direction = "up";
  const engine = new ProductionRootEngine();
  engine.decide(fixture.me, fixture.enemy, fixture.game);
  let fireRow = -1; let matrixRow = -1;
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === fast.ACTION.FIRE) fireRow = row;
  for (let row = 0; row < engine.search.matrix.rows; row += 1)
    if (engine.stageRowMap[row] === fireRow) matrixRow = row;
  assert.ok(fireRow >= 0);
  const qualified = engine.riskController.outcome.acceptable[fireRow] &&
    !engine.riskController.outcome.dominated[fireRow] &&
    engine.strategyBands.selected[fireRow];
  assert.equal(matrixRow >= 0, !!qualified);
  if (matrixRow < 0) {
    assert.equal(engine.riskController.outcome.dominated[fireRow] ||
      !engine.riskController.outcome.acceptable[fireRow] ||
      !engine.strategyBands.selected[fireRow], 1);
    return;
  }
  const stride = engine.search.matrix.maxColumns;
  let checked = 0;
  for (let column = 0; column < engine.enemyCount; column += 1) {
    const pressure = engine.projectileAttack.cellPressure[fireRow * stride + column];
    if (!pressure) continue;
    const raw = engine.depthSearch.rootCellScore[fireRow * stride + column];
    const tactical = engine.riskController.outcome.tacticalValue[fireRow];
    const expected = Math.max(-10000, Math.min(10000,
      tactical + Math.trunc(raw / engine.riskController.searchDivisor) + pressure));
    assert.equal(engine.search.matrix.lower[matrixRow * stride + column], expected);
    checked += 1;
  }
  assert.ok(checked > 0);
  assert.equal(engine.riskController.outcome.acceptable[fireRow], 1);
  assert.equal(engine.riskController.outcome.dominated[fireRow], 0);
});

test("PAC1 production root evaluates closure but keeps Hard and Proof ownership separate", () => {
  const fixture = productionRootFixture(); const engine = new ProductionRootEngine();
  engine.decide(fixture.me, fixture.enemy, fixture.game);
  assert.ok(engine.projectileAttack.evaluationCount > 0);
  assert.equal(engine.projectileAttack.rootRestoreFailures, 0);
  assert.equal(engine.riskDominatedSelectionCount, 0);
  assert.equal("proofStatus" in engine.projectileAttack, false);
  assert.equal("hardStatus" in engine.projectileAttack, false);
});

test("PAC1 hot core contains fixed integer arrays and no random clock or float arrays", () => {
  const closure = new ProjectileAttackClosure(); const seen = new Set(); let floats = 0;
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      if (value instanceof Float32Array || value instanceof Float64Array) floats += 1;
      return;
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(closure); assert.equal(floats, 0); assert.equal(closure.hotAllocationCount, 0);
  const source = fs.readFileSync(path.join(__dirname,
    "../../engine-v2/src/search/projectile-attack-closure.js"), "utf8");
  assert.doesNotMatch(source, /Float32Array|Float64Array|Math\.random|Date\.now|console\./);
});
