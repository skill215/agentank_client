"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { CombatPressure } = require("../../engine-v2/src/search/combat-pressure");
const { RULE } = require("../../engine-v2/src/generated/fast-config");
const { RiskAcceptanceController } = require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { PlanSketchArena, PersistentPlanArena } = require("../../engine-v2/src/policy/plan");
const { PLAN_KIND, PLAN_PURPOSE, FEATURE, FEATURE_OWNERSHIP } =
  require("../../engine-v2/src/abi/policy-codes");
const { FeatureRegistry } = require("../../engine-v2/src/policy/feature-registry");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ProductionDepthSearch } = require("../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");

function combatFixture(own, enemy, overrides = {}) {
  const built = fast.createFastPhysical(physical({ map: overrides.map ||
    { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
  tanks: [own, enemy], projectiles: overrides.projectiles || [] }));
  const actions = new Uint8Array([overrides.action ?? fast.ACTION.FIRE]);
  const cells = new Uint16Array([built.state.arrays[fast.ARRAY.TANK_CELL][0]]);
  const directions = new Uint8Array([overrides.direction ??
    built.state.arrays[fast.ARRAY.TANK_DIR][0]]);
  const coverage = new Uint16Array([overrides.coverage || 0]);
  const combat = new CombatPressure(); const vector = combat.evaluate(built, actions, 1,
    cells, directions, overrides.visible !== false, coverage);
  return { built, combat, vector };
}

test("SR4 direct kill and post-fire escape have verified deadlines", () => {
  const { vector } = combatFixture(tank(0, [1, 2], "right"), tank(1, [3, 2], "left"));
  assert.equal(vector.directKill[0], 1); assert.equal(vector.hitDeadline[0], 1);
  assert.equal(vector.purposeCompleteness[0], 10000); assert.ok(vector.postFireEscape[0] > 0);
  assert.ok(vector.pressureValue[0] > 0);
});

test("SR4 longer shot is an intercept while a turn into the ray is aim setup", () => {
  let fixture = combatFixture(tank(0, [1, 2], "right"), tank(1, [5, 2], "left"));
  assert.equal(fixture.vector.intercept[0], 1); assert.equal(fixture.vector.hitDeadline[0], 2);
  assert.ok(fixture.vector.pressureValue[0] >= 2000);
  fixture = combatFixture(tank(0, [1, 2], "up"), tank(1, [5, 2], "left"),
    { action: fast.ACTION.TURN_RIGHT, direction: fast.DIRECTION.RIGHT });
  assert.equal(fixture.vector.aimSetup[0], 1); assert.ok(fixture.vector.pressureValue[0] > 0);
});

test("SR4 primary ShotPlan purpose is stable when one shot has several purposes", () => {
  const terrain = boxedMap(7, 5); terrain[5][1] = "x"; terrain[5][3] = "x";
  const { vector } = combatFixture(tank(0, [1, 2], "right"), tank(1, [5, 2], "right",
    { shieldHitsRemaining: 2 }), { map: { width: 7, height: 5, terrainColumnMajor: terrain } });
  assert.equal(vector.directKill[0], 1); assert.equal(vector.shieldBreak[0], 1);
  assert.equal(vector.escapeDenial[0], 1); assert.equal(vector.purpose[0], PLAN_PURPOSE.DIRECT_KILL);
});

test("SR4 escape denial shield break and zone denial require physical support", () => {
  const terrain = boxedMap(7, 5); terrain[5][1] = "x"; terrain[5][3] = "x";
  let fixture = combatFixture(tank(0, [1, 2], "right"), tank(1, [5, 2], "left",
    { shieldHitsRemaining: 2 }), { map: { width: 7, height: 5, terrainColumnMajor: terrain } });
  assert.equal(fixture.vector.escapeDenial[0], 1); assert.equal(fixture.vector.shieldBreak[0], 1);
  assert.ok(fixture.vector.blockadeValue[0] > 0);
  fixture = combatFixture(tank(0, [2, 2], "right"), tank(1, [4, 2], "left"),
    { action: fast.ACTION.THROW_BOMB });
  assert.equal(fixture.vector.zoneDenial[0], 1); assert.ok(fixture.vector.pressureValue[0] > 0);
});

test("SR4 hidden belief sweep is soft and unreachable visible miss receives no pressure", () => {
  let fixture = combatFixture(tank(0, [1, 2], "right"), tank(1, [5, 2], "left"),
    { visible: false, coverage: 6400 });
  assert.equal(fixture.vector.beliefSweep[0], 1); assert.equal(fixture.vector.pressureValue[0], 800);
  fixture = combatFixture(tank(0, [1, 1], "right"), tank(1, [2, 3], "left"));
  assert.equal(fixture.vector.purposeFlags[0], 0); assert.ok(fixture.vector.pressureValue[0] < 0);
});

test("SR4 visible future ray crossing is a soft possible intercept", () => {
  const { combat, vector } = combatFixture(
    tank(0, [1, 2], "right"), tank(1, [4, 3], "left"));
  assert.equal(vector.possibleHit[0], 1);
  assert.equal(vector.intercept[0], 1);
  assert.equal(vector.directKill[0], 0);
  assert.equal(vector.hitDeadline[0], 2);
  assert.ok(vector.purposeCompleteness[0] >= 3500);
  assert.ok(vector.pressureValue[0] > 0);
  assert.equal(vector.robustPressure[0], 0);
  assert.equal(combat.possibleHitFoundCount, 1);
});

test("SR4 wall-blocked ray cannot become a possible intercept", () => {
  const terrain = boxedMap(7, 5); terrain[3][2] = "x";
  const { vector } = combatFixture(tank(0, [1, 2], "right"),
    tank(1, [4, 3], "left"),
    { map: { width: 7, height: 5, terrainColumnMajor: terrain } });
  assert.equal(vector.possibleHit[0], 0);
  assert.equal(vector.intercept[0], 0);
  assert.equal(vector.purposeFlags[0], 0);
});

test("SR4 possible-hit temporal query is reused without hot allocation", () => {
  const fixture = combatFixture(tank(0, [1, 2], "right"),
    tank(1, [4, 3], "left"));
  fixture.combat.evaluate(fixture.built, new Uint8Array([fast.ACTION.FIRE]), 1,
    new Uint16Array([fixture.built.state.arrays[fast.ARRAY.TANK_CELL][0]]),
    new Uint8Array([fast.DIRECTION.RIGHT]), true, new Uint16Array(1));
  assert.equal(fixture.combat.possibleHitReachBuilds, 1);
  assert.equal(fixture.combat.possibleHitQueryCacheHits, 1);
  assert.equal(fixture.combat.hotAllocationCount, 0);
});

function referencePossibleHit(state, source, direction, enemyCell, enemyCanAct) {
  const distances = new Int16Array(state.cells); distances.fill(-1);
  const queue = new Uint16Array(state.cells); let head = 0; let tail = 1;
  const dx = [0, 1, 0, -1]; const dy = [-1, 0, 1, 0];
  const terrain = state.arrays[fast.ARRAY.TERRAIN];
  const walkable = cell => cell !== fast.NONE_CELL &&
    terrain[cell] !== fast.TERRAIN.WALL && terrain[cell] !== fast.TERRAIN.DIRT;
  const target = (cell, move) => {
    const x = state.x(cell) + dx[move]; const y = state.y(cell) + dy[move];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      fast.NONE_CELL : state.cell(x, y);
  };
  if (!walkable(enemyCell)) return [0, 255, 0];
  queue[0] = enemyCell; distances[enemyCell] = 0;
  while (head < tail) {
    const cell = queue[head++]; const distance = distances[cell] + 1;
    for (let move = 0; move < 4; move += 1) {
      const next = target(cell, move);
      if (walkable(next) && distances[next] < 0) {
        distances[next] = distance; queue[tail++] = next;
      }
    }
  }
  let cell = source; const delay = enemyCanAct ? 0 : 1;
  for (let distance = 1; distance <= state.cells; distance += 1) {
    cell = target(cell, direction); if (cell === fast.NONE_CELL) break;
    if (!walkable(cell)) break;
    const arrival = Math.max(1, Math.floor(
      (distance + RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS));
    const required = distances[cell] < 0 ? 0xffff : distances[cell] + delay;
    if (required <= arrival) {
      const completeness = Math.max(3500, Math.min(6500,
        4500 + Math.min(2000, (arrival - required) * 500)));
      return [1, arrival, completeness];
    }
  }
  return [0, 255, 0];
}

test("SR4 bounded possible-hit query matches an exhaustive distance oracle", () => {
  const terrains = [boxedMap(7, 5), boxedMap(7, 5)];
  terrains[1][3][1] = "x"; terrains[1][3][2] = "x"; terrains[1][5][3] = "x";
  for (const terrainColumnMajor of terrains) {
    const built = fast.createFastPhysical(physical({ map:
      { width: 7, height: 5, terrainColumnMajor },
    tanks: [tank(0, [1, 2], "right"), tank(1, [5, 3], "left")] }));
    const state = built.state; const source = state.cell(1, 2);
    const combat = new CombatPressure();
    for (let direction = 0; direction < 4; direction += 1) {
      for (let enemyCell = 0; enemyCell < state.cells; enemyCell += 1) {
        for (let enemyCanAct = 0; enemyCanAct < 2; enemyCanAct += 1) {
          const expected = referencePossibleHit(state, source, direction,
            enemyCell, enemyCanAct);
          const actual = combat.findPossibleHit(state, source, direction,
            enemyCell, enemyCanAct);
          assert.deepEqual([actual, combat.lastPossibleHitDeadline,
            combat.lastPossibleHitCompleteness], expected);
        }
      }
    }
  }
});

test("SR4 dangerous trapped duel is not promoted by direct-fire pressure", () => {
  const terrain = boxedMap(7, 5);
  for (let x = 1; x < 6; x += 1) { terrain[x][1] = "x"; terrain[x][3] = "x"; }
  const { vector } = combatFixture(tank(0, [2, 2], "right"), tank(1, [4, 2], "left"),
    { map: { width: 7, height: 5, terrainColumnMajor: terrain } });
  assert.equal(vector.postFireEscape[0], 0); assert.ok(vector.ownCounterExposure[0] > 0);
  assert.ok(vector.pressureValue[0] < 0);
});

test("SR4 combat pressure is applied only after the pure-risk acceptable set is fixed", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) { o.hard[row] = fast.HARD_STATUS.ALLOW;
    o.safety[row] = SAFETY_STATUS.PROVEN_SAFE; o.coverage[row] = 10000;
    o.robustLower[row] = 500; o.expectedValue[row] = 500; o.tacticalValue[row] = 500; }
  controller.gate(0, 0); const combat = new CombatPressure(); combat.vector.reset(2);
  combat.vector.pressureValue[1] = 900; combat.vector.purposeCompleteness[1] = 10000;
  const accepted = Array.from(o.acceptable.slice(0, 2)); controller.applyCombatPressure(combat.vector);
  assert.deepEqual(Array.from(o.acceptable.slice(0, 2)), accepted);
  assert.deepEqual(Array.from(o.robustLower.slice(0, 2)), [500, 500]);
  assert.deepEqual(Array.from(o.expectedValue.slice(0, 2)), [500, 1400]);
  assert.deepEqual(Array.from(o.tacticalValue.slice(0, 2)), [500, 1400]);
  assert.equal(controller.select(1), 1);
});

test("SR4 committed-shot evidence is separate from speculative combat pressure", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome; o.reset(2);
  for (let row = 0; row < 2; row += 1) { o.hard[row] = fast.HARD_STATUS.ALLOW;
    o.safety[row] = SAFETY_STATUS.PROVEN_SAFE; o.coverage[row] = 10000;
    o.robustLower[row] = 500; o.expectedValue[row] = 500; o.tacticalValue[row] = 500; }
  const combat = new CombatPressure(); combat.vector.reset(2);
  combat.vector.pressureValue[0] = 900; combat.vector.robustPressure[0] = 900;
  combat.vector.pressureValue[1] = 1200;
  const safety = { status: new Uint8Array([SAFETY_STATUS.PROVEN_SAFE, SAFETY_STATUS.PROVEN_SAFE]),
    immediateFatalMass: new Uint16Array(2), horizonFatalMass: new Uint16Array(2),
    unknownMass: new Uint16Array(2), earliestFatalFrame: new Uint8Array(2),
    escapeSlack: new Int8Array(2), coverage: new Uint16Array([10000, 10000]) };
  controller.populate(2, new Uint8Array([fast.HARD_STATUS.ALLOW, fast.HARD_STATUS.ALLOW]),
    safety, new Int16Array([500, 500]), null, null, 0, combat.vector);
  controller.gate(0, 0);
  controller.applyCombatPressure(combat.vector);
  assert.deepEqual(Array.from(o.robustLower.slice(0, 2)), [1400, 500]);
  assert.deepEqual(Array.from(o.expectedValue.slice(0, 2)), [1400, 1700]);
  // Risk preserves the committed lower-bound evidence but no longer turns it
  // into global action ownership. A verified attack or exact dominance must be
  // proposed through the V3 ownership contract; ordinary selection may retain
  // the higher tactical expectation inside the already-safe set.
  assert.equal(controller.select(1), 1);
});

test("SR4 ShotPlan combat fields survive materialization", () => {
  const sketches = new PlanSketchArena(); const plans = new PersistentPlanArena();
  const shot = sketches.create(PLAN_KIND.SHOT, PLAN_PURPOSE.DIRECT_KILL, fast.ACTION.FIRE);
  const combat = new CombatPressure(); combat.vector.reset(1); combat.vector.directKill[0] = 1;
  combat.vector.hitDeadline[0] = 1; combat.vector.enemySafeSuccessors[0] = 0;
  combat.vector.purposeCompleteness[0] = 10000; combat.vector.postFireEscape[0] = 2;
  assert.equal(sketches.annotateCombat(shot, combat.vector, 0), 1);
  const handle = plans.materialize(sketches, shot, true); const slot = plans.decode(handle);
  assert.equal(plans.directKill[slot], 1); assert.equal(plans.hitDeadline[slot], 1);
  assert.equal(plans.purposeCompleteness[slot], 10000); assert.equal(plans.postFireEscape[slot], 2);
});

test("SR4 production root owns combat vectors and never selects a dominated action", () => {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); engine.decide(fixture.me, fixture.enemy, fixture.game);
  assert.ok(engine.combat.evaluationCount > 0); assert.ok(engine.riskController.combatAppliedCount > 0);
  assert.equal(engine.riskDominatedSelectionCount, 0);
  const fire = Array.from(engine.ourActions.slice(0, engine.ourCount)).indexOf(fast.ACTION.FIRE);
  assert.ok(fire >= 0); assert.ok(engine.riskController.outcome.purposeCompleteness[fire] > 0);
});

test("SR4 aim setup becomes an active short-lived ShotPlan before the follow-up FIRE", () => {
  const fixture = productionRootFixture(); fixture.me.tank.direction = "up";
  const engine = new ProductionRootEngine(); engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  engine.generateActions(); const count = engine.ourCount - 1;
  for (let row = 0; row < count; row += 1) { const packed = engine.projected(engine.ourActions[row]);
    engine.projectedCell[row] = (packed / 4) | 0; engine.projectedDirection[row] = packed & 3; }
  engine.prepareCombatVectors(count); const row = Array.from(engine.ourActions.slice(0, count))
    .findIndex(action => action === fast.ACTION.TURN_RIGHT);
  assert.ok(row >= 0); const sketch = engine.planSketchHandle[row]; assert.notEqual(sketch, 0xffffffff);
  assert.equal(engine.policy.sketches.aimSetup[sketch], 1);
  const handle = engine.commitSelectedPlan(row); const slot = engine.policy.plans.decode(handle);
  assert.equal(engine.policy.plans.aimSetup[slot], 1);
  assert.equal(engine.policy.plans.status[slot], 3);
});

test("SR4 an active fired ShotPlan rewards leaving a verified counter-fire line", () => {
  const fixture = productionRootFixture(); fixture.me.tank.direction = "down";
  const engine = new ProductionRootEngine(); engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  const sketches = engine.policy.sketches; const sketch = sketches.create(PLAN_KIND.SHOT,
    PLAN_PURPOSE.DIRECT_KILL, fast.ACTION.FIRE); const combat = new CombatPressure();
  combat.vector.reset(1); combat.vector.ownCounterExposure[0] = 10000;
  combat.vector.postFireEscape[0] = 2; sketches.annotateCombat(sketch, combat.vector, 0);
  const handle = engine.policy.plans.materialize(sketches, sketch, true);
  engine.policy.plans.activate(handle, 1);
  const current = engine.adapter.state.arrays[fast.ARRAY.TANK_CELL][0];
  const escaped = engine.target(current, fast.DIRECTION.DOWN);
  assert.ok(engine.activePlanProgress(fast.ACTION.GO, escaped, fast.DIRECTION.DOWN) >
    engine.activePlanProgress(fast.ACTION.FIRE, current, fast.DIRECTION.DOWN));
});

test("SR4 deep representatives progressively widen instead of leaving generated actions dormant", () => {
  let built = fast.createFastPhysical(physical({ map: { width: 9, height: 7,
    terrainColumnMajor: boxedMap(9, 7) }, tanks: [tank(0, [1, 1], "right"),
      tank(1, [7, 5], "left")] }));
  let depth = new ProductionDepthSearch(new ProductionCacheBank()); depth.generateDeep(0, built.state, 0);
  let actions = Array.from(depth.deepOurActions.slice(0, depth.frameOurCount[0]));
  assert.equal(actions.length, 2); assert.equal(actions.includes(fast.ACTION.FIRE), false);
  built = fast.createFastPhysical(physical({ tanks: [tank(0, [1, 2], "up",
    { skillId: "poison", skillReadyFrame: 0 }), tank(1, [5, 2], "left")] }));
  depth = new ProductionDepthSearch(new ProductionCacheBank()); depth.generateDeep(0, built.state, 0);
  actions = Array.from(depth.deepOurActions.slice(0, depth.frameOurGeneratedCount[0]));
  assert.ok(actions.length >= 3 && actions.length <= 4); assert.ok(actions.includes(fast.ACTION.TURN_RIGHT));
  assert.equal(depth.frameOurCount[0], 2);
  depth.configureIteration(2, 3); depth.generateDeep(0, built.state, 0);
  assert.equal(depth.iterationExpansionLimit, 3);
  assert.equal(depth.frameOurCount[0], Math.min(3, depth.frameOurGeneratedCount[0]));
  assert.ok(Array.from(depth.deepOurActions.slice(0, depth.frameOurCount[0]))
    .includes(depth.deepOurActions[2]));
});

test("SR4 committed danger emits at most two evasions plus one survival skill", () => {
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [3, 2], "up",
    { skillId: "shield", skillReadyFrame: 0 }), tank(1, [5, 3], "left")],
  projectiles: [{ entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }] }));
  const depth = new ProductionDepthSearch(new ProductionCacheBank()); depth.generateDeep(0, built.state, 0);
  const actions = Array.from(depth.deepOurActions.slice(0, depth.frameOurCount[0]));
  assert.ok(actions.length <= 3); assert.ok(actions.includes(fast.ACTION.CAST_SHIELD));
  assert.equal(actions.includes(fast.ACTION.FIRE), false);
});

test("SR4 direct-hit and escape-denial features have combat ownership", () => {
  const registry = new FeatureRegistry();
  assert.equal(registry.ownership[FEATURE.DIRECT_HIT_WINDOW], FEATURE_OWNERSHIP.COMBAT_OWNED);
  assert.equal(registry.ownership[FEATURE.ESCAPE_DENIAL], FEATURE_OWNERSHIP.COMBAT_OWNED);
});

test("SR4 combat hot path uses integer TypedArrays and no random or floating arrays", () => {
  const combat = new CombatPressure(); const seen = new Set(); let floats = 0; let allocations = 0;
  function visit(value) { if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value); if (ArrayBuffer.isView(value)) {
      if (value instanceof Float32Array || value instanceof Float64Array) floats += 1; return; }
    if (Number.isSafeInteger(value.hotAllocationCount)) allocations += value.hotAllocationCount;
    for (const item of Object.values(value)) visit(item);
  }
  visit(combat); assert.equal(floats, 0); assert.equal(allocations, 0);
  const source = fs.readFileSync(path.join(__dirname,
    "../../engine-v2/src/search/combat-pressure.js"), "utf8");
  assert.doesNotMatch(source, /Float32Array|Float64Array|Math\.random|Date\.now|console\./);
});
