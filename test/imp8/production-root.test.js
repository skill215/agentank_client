"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, TERRAIN, DIRECTION } = require("../../engine-v2/src/abi/fast-codes");
const { CACHE_ID } = require("../../engine-v2/src/abi/cache-runtime-codes");
const { NODE_KIND } = require("../../engine-v2/src/abi/search-codes");
const { PLAN_KIND, PLAN_STATUS, NONE_HANDLE } = require("../../engine-v2/src/abi/policy-codes");
const { GLOBAL_MODE, STRATEGY } = require("../../engine-v2/src/abi/policy-codes");
const { POSSIBLE_HAZARD } = require("../../engine-v2/src/policy/hidden-risk");
const { ARRAY, SCALAR, FastState } = require("../../engine-v2/src/state/fast-state");
const { PossibleProjectileTracker } = require("../../engine-v2/src/runtime/possible-projectiles");
const { ProductionRootEngine, ProductionObservationAdapter } =
  require("../../engine-v2/src/runtime/production-root");

function boxedMap(width = 7, height = 7) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

function side(id, position, direction, skillType, calls) {
  return { tank: position ? { id, position, direction, crashed: false } : null,
    stars: 0, bullet: null, skill: { type: skillType, remainingCooldownFrames: 1 },
    effects: { self: null, debuff: null }, status: { shielded: false, frozen: false,
      stunned: false, overloaded: false, cloaked: false, poisoned: false, boosted: false,
      fireLocked: false, bombActive: false, bombCooldownFrames: 1, canActThisFrame: true,
      actionSpeed: 1 },
    go() { calls?.push("GO"); }, turn(value) { calls?.push(`TURN:${value}`); },
    fire() { calls?.push("FIRE"); }, throwBomb() { calls?.push("BOMB"); },
    poison() { calls?.push("POISON"); } };
}

function game(frame, map, overrides = {}) {
  return { frames: frame, map, star: null, bombs: [], ...overrides };
}

test("Information A/B switches are opt-in and cannot change production defaults", () => {
  const production = new ProductionRootEngine();
  assert.equal(production.diagnosticLegacyInformationSearch, 0);
  assert.equal(production.diagnosticInformationDepthOne, 0);
  assert.equal(production.diagnosticDisableShallowInfoAdjustment, 0);
  assert.equal(production.diagnosticDisableShallowClearLineReversal, 0);
  assert.equal(production.diagnosticDisableShallowEscapeBonus, 0);
  assert.equal(production.diagnosticEnableLegacyShallowFacingPenalty, 0);
  const diagnostic = new ProductionRootEngine({
    diagnosticLegacyInformationSearch: true,
    diagnosticInformationDepthOne: true,
    diagnosticDisableShallowInfoAdjustment: true,
    diagnosticDisableShallowClearLineReversal: true,
    diagnosticDisableShallowEscapeBonus: true,
    diagnosticEnableLegacyShallowFacingPenalty: true
  });
  assert.equal(diagnostic.diagnosticLegacyInformationSearch, 1);
  assert.equal(diagnostic.diagnosticInformationDepthOne, 1);
  assert.equal(diagnostic.diagnosticDisableShallowInfoAdjustment, 1);
  assert.equal(diagnostic.informationSearch.diagnosticDisableShallowAdjustment, 1);
  assert.equal(diagnostic.informationSearch.diagnosticDisableShallowClearLineReversal, 1);
  assert.equal(diagnostic.informationSearch.diagnosticDisableShallowEscapeBonus, 1);
  assert.equal(diagnostic.informationSearch.diagnosticEnableLegacyShallowFacingPenalty, 1);
});

test("production root maps a complete platform root and emits the selected action", () => {
  const calls = []; const map = boxedMap(5, 5);
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [3, 1], "left", "stun");
  me.skill.remainingCooldownFrames = 0; me.status.bombCooldownFrames = 0;
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy,
    game(1, map, { star: [2, 2] }));
  assert.equal(action, ACTION.TURN_RIGHT); assert.deepEqual(calls, ["TURN:right"]);
  assert.equal(engine.lastRootStatus, 1); assert.ok(engine.forcedWinSearch.nodes > 0);
  assert.equal(engine.adapter.state.deltaUsed, 0); assert.equal(engine.adapter.state.eventUsed, 0);
});

test("every generated FIRE and BOMB owns a PlanSketch before it can be scored", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [5, 2], "left", "stun");
  me.status.bombCooldownFrames = 0;
  const engine = new ProductionRootEngine(); engine.adapter.adapt(me, enemy, game(1, map));
  engine.generateActions();
  for (let index = 0; index < engine.ourCount; index += 1) {
    const action = engine.ourActions[index];
    if (action !== ACTION.FIRE && action !== ACTION.THROW_BOMB) continue;
    const sketch = engine.planSketchHandle[index]; assert.notEqual(sketch, NONE_HANDLE);
    assert.equal(engine.policy.sketches.kind[sketch],
      action === ACTION.FIRE ? PLAN_KIND.SHOT : PLAN_KIND.BOMB);
  }
});

test("a selected shot becomes a generation-bound PersistentPlan on observation", () => {
  const calls = []; const map = boxedMap(9, 5);
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [6, 1], "left", "stun");
  const engine = new ProductionRootEngine();
  assert.equal(engine.decide(me, enemy, game(1, map)), ACTION.FIRE);
  assert.equal(engine.planCommitCount, 1);
  const plans = engine.policy.plans;
  const pending = Array.from(plans.status).findIndex(value => value === PLAN_STATUS.PENDING_EXECUTION);
  assert.ok(pending >= 0); assert.equal(plans.kind[pending], PLAN_KIND.SHOT);

  calls.length = 0; enemy.tank.position = [7, 1];
  me.bullet = { position: [3, 1], direction: "right" };
  engine.decide(me, enemy, game(2, map));
  assert.equal(plans.status[pending], PLAN_STATUS.ACTIVE);
  assert.equal(plans.entityCount[pending], 1); assert.ok(engine.planActivateCount >= 1);
  const at = pending * plans.entityStride;
  assert.equal(plans.entityGeneration[at],
    engine.adapter.tracker.projectileGeneration[plans.entitySlot[at]]);
  assert.ok(plans.hardValidationCount >= 1);
});

test("committed projectile death chain hard-rejects non-escape actions before scoring", () => {
  const calls = []; const map = boxedMap(7, 5);
  const me = side("own", [3, 2], "up", "poison", calls);
  const enemy = side("enemy", [5, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(4, map));
  assert.equal(action, ACTION.GO); assert.deepEqual(calls, ["GO"]);
  assert.equal(engine.hardStatus[0], HARD_STATUS.ALLOW);
  assert.ok(Array.from(engine.hardStatus.slice(1, engine.ourCount))
    .every(value => value === HARD_STATUS.REJECT_PROVEN));
});

test("every valid production selection passes the single FinalActionGate", () => {
  const calls = []; const map = boxedMap(7, 5);
  const me = side("own", [3, 2], "up", "poison", calls);
  const enemy = side("enemy", [5, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(4, map));
  assert.equal(action, ACTION.GO); assert.equal(engine.finalGate.lastSelected, 0);
  assert.equal(engine.finalGate.checkedCount, engine.ourCount);
  assert.ok(engine.finalGate.finalCheckCount >= 1);
  assert.equal(engine.finalGate.status[engine.finalGate.lastSelected], HARD_STATUS.ALLOW);
});

test("due bomb death chain selects the only HardGate escape", () => {
  const calls = []; const map = boxedMap(9, 7);
  const me = side("own", [4, 3], "down", "poison", calls);
  const enemy = side("enemy", [7, 5], "left", "stun");
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy,
    game(4, map, { bombs: [{ position: [4, 1], remainingFrames: 0 }] }));
  assert.equal(action, ACTION.GO); assert.deepEqual(calls, ["GO"]);
  assert.deepEqual(Array.from(engine.hardStatus.slice(0, engine.ourCount)),
    [HARD_STATUS.ALLOW, HARD_STATUS.REJECT_PROVEN, HARD_STATUS.REJECT_PROVEN,
      HARD_STATUS.REJECT_PROVEN, HARD_STATUS.REJECT_PROVEN]);
});

test("unknown bomb timing is InformationState risk and cannot create a false hard rejection", () => {
  const calls = []; const map = boxedMap(9, 7);
  const me = side("own", [4, 3], "down", "poison", calls);
  const enemy = side("enemy", [7, 5], "left", "stun");
  const engine = new ProductionRootEngine(); engine.decide(me, enemy,
    game(4, map, { bombs: [{ position: [4, 1] }] }));
  assert.equal(engine.adapter.informationComplete, 0);
  assert.equal(engine.depthSearch.completedDepth, 0);
  assert.ok(engine.informationSearch.completedDepth >= 1);
  assert.equal(engine.informationSearch.supportComplete, 0);
  assert.equal(engine.adapter.state.activeBombCount(), 0);
  assert.ok(engine.possibleBombRisk(engine.adapter.state.arrays[ARRAY.TANK_CELL][0]) > 0);
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .some(value => value === HARD_STATUS.ALLOW));
  enemy.status.bombCooldownFrames = 1;
  engine.decide(me, enemy, game(5, map));
  assert.equal(engine.adapter.tracker.bombActive[0], 1);
  assert.ok(engine.possibleBombRisk(engine.adapter.state.arrays[ARRAY.TANK_CELL][0]) > 0);
});

test("valid root with no safe active command holds instead of bypassing FinalActionGate", () => {
  const calls = []; const map = boxedMap(5, 5); map[2][1] = "x"; map[2][3] = "x";
  const me = side("own", [2, 2], "up", "poison", calls);
  const enemy = side("enemy", [3, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(4, map));
  assert.equal(action, ACTION.NONE); assert.deepEqual(calls, []);
  assert.equal(engine.invalidRootCount, 0); assert.equal(engine.finalGate.lastSelected, -1);
  assert.ok(engine.finalGate.noSafeActionCount > 0);
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .every(value => value === HARD_STATUS.REJECT_PROVEN));
});

test("possible enemy fire remains a risk score and never becomes a root hard-failure fact", () => {
  const calls = []; const map = boxedMap(7, 7);
  const me = side("own", [2, 3], "up", "poison", calls);
  const enemy = side("enemy", [5, 3], "left", "stun");
  const engine = new ProductionRootEngine(); engine.decide(me, enemy, game(2, map));
  assert.ok(engine.possibleShotRisk(engine.adapter.state.arrays[ARRAY.TANK_CELL][0]) > 0);
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .some(value => value === HARD_STATUS.ALLOW));
});

test("possible hidden projectile uses fixed arrays, persists, and expires only on physical invalidation", () => {
  const state = new FastState(7, 5); const terrain = state.arrays[ARRAY.TERRAIN];
  for (let x = 0; x < state.width; x += 1) for (let y = 0; y < state.height; y += 1)
    if (x === 0 || y === 0 || x === state.width - 1 || y === state.height - 1)
      terrain[state.cell(x, y)] = TERRAIN.WALL;
  const tracker = new PossibleProjectileTracker(); tracker.reset(1);
  assert.equal(tracker.addFired(state, state.cell(1, 2), DIRECTION.RIGHT, 1, 1), 1);
  const active = tracker.active; const cells = tracker.cell;
  tracker.advance(state, 2);
  assert.equal(tracker.active, active); assert.equal(tracker.cell, cells);
  assert.equal(tracker.count(), 1); assert.equal(tracker.cell[0], state.cell(3, 2));
  assert.ok(tracker.risk(state, state.cell(5, 2), DIRECTION.UP) > 0);
  terrain[state.cell(4, 2)] = TERRAIN.DIRT; tracker.advance(state, 3);
  assert.equal(tracker.count(), 0); assert.equal(tracker.expireCount, 1);
  assert.equal(tracker.hotAllocationCount, 0);
});

test("unobserved enemy FIRE creates only Possible risk and never a Physical hard threat", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 3], "up", "poison", []);
  const enemy = side("enemy", [5, 3], "left", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(1, map)); enemy.tank = null;
  engine.decide(me, enemy, game(2, map));
  assert.ok(engine.possibleProjectiles.count() > 0);
  assert.ok(engine.possibleShotRisk(engine.adapter.state.arrays[ARRAY.TANK_CELL][0]) > 0);
  assert.equal(engine.adapter.state.activeProjectileCount(), 0);
  assert.equal(engine.adapter.bundle.hard.hasCommittedThreat(), 0);
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .some(value => value === HARD_STATUS.ALLOW));
});

test("possible projectile presence enters bounded InformationState value backup, not Hard", () => {
  const map = boxedMap(9, 5); const me = side("own", [5, 2], "up", "poison", []);
  const enemy = side("enemy", [1, 2], "right", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(0, map)); enemy.tank = null;
  engine.decide(me, enemy, game(1, map));
  assert.ok(engine.possibleProjectiles.count() > 0);
  assert.ok(engine.informationSearch.projectilePresenceBackupCount > 0);
  assert.equal(engine.adapter.bundle.hard.hasCommittedThreat(), 0);
  assert.equal(engine.informationSearch.supportComplete, 0);
});

test("hidden same-frame muzzle worlds update the FIRE matrix without becoming Hard", () => {
  const map = boxedMap(9, 7); const me = side("own", [3, 3], "right", "poison", []);
  const enemy = side("enemy", [5, 4], "up", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(0, map)); enemy.tank = null;
  engine.decide(me, enemy, game(1, map));
  assert.ok(engine.informationSearch.immediateFireBackupCount > 0);
  assert.equal(engine.adapter.bundle.hard.hasCommittedThreat(), 0);
  assert.equal(engine.informationSearch.supportComplete, 0);
  assert.ok(engine.informationSearch.nodes <= engine.searchOptions.nodeBudget);
});

test("depth-one selective extension distinguishes a direct-fire setup trap from an escape turn", () => {
  const map = boxedMap(7, 13); map[1][7] = "x";
  const me = side("own", [1, 6], "left", "poison", []);
  const enemy = side("enemy", [5, 6], "down", "stun");
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(me, enemy,
    game(117, map));
  const ourActions = new Uint8Array([ACTION.TURN_LEFT, ACTION.TURN_RIGHT]);
  const ourArguments = new Uint16Array([0xffff, 0xffff]);
  const enemyActions = new Uint8Array([ACTION.TURN_RIGHT]);
  const enemyArguments = new Uint16Array([0xffff]);
  const completed = engine.depthSearch.search(adapted.bundle, ourActions, ourArguments, 2,
    enemyActions, enemyArguments, 1, 1, 64, 35);
  assert.equal(completed, 1);
  assert.equal(engine.depthSearch.rootScore[0], -29900);
  assert.ok(engine.depthSearch.rootScore[1] > -29900);
  assert.ok(engine.depthSearch.directFireTrapProofCount > 0);
  assert.ok(engine.depthSearch.nodes <= 64);
  assert.equal(adapted.bundle.state.deltaUsed, 0);
  assert.equal(adapted.bundle.state.eventUsed, 0);
});

test("terminal strategy mode treats equal stars as recovery and a strict lead as preservation", () => {
  const map = boxedMap(9, 7); const me = side("own", [2, 3], "right", "poison", []);
  const enemy = side("enemy", [6, 3], "left", "stun");
  const recovery = new ProductionRootEngine(); recovery.decide(me, enemy,
    game(112, map, { star: [4, 3] }));
  assert.equal(recovery.policy.selector.lastMode, GLOBAL_MODE.FORCED_LOSS_RECOVERY);
  assert.equal(recovery.policy.selector.current, STRATEGY.COMEBACK);
  me.stars = 2; enemy.stars = 1;
  const preserve = new ProductionRootEngine(); preserve.decide(me, enemy,
    game(112, map, { star: [4, 3] }));
  assert.equal(preserve.policy.selector.lastMode, GLOBAL_MODE.HARD_SURVIVAL);
  assert.equal(preserve.policy.selector.current, STRATEGY.PRESERVE_LEAD);
});

test("production root graph represents active stun as ChanceOutcome children", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "stun");
  me.status.stunned = true; me.effects.debuff = { type: "stun", remainingFrames: 2 };
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(me, enemy, game(1, map));
  engine.generateActions(); const root = engine.rootAdapter.build(adapted.bundle,
    engine.ourActions, engine.ourArguments, engine.ourCount,
    engine.enemyActions, engine.enemyArguments, engine.enemyCount);
  assert.ok(root >= 0);
  let chanceNodes = 0;
  for (let node = 0; node < engine.rootAdapter.graph.nodeCount; node += 1)
    if (engine.rootAdapter.graph.kind[node] === NODE_KIND.CHANCE_OUTCOME) chanceNodes += 1;
  assert.ok(chanceNodes > 0);
  assert.equal(adapted.informationComplete, true);
  assert.ok(Array.from(engine.rootAdapter.graph.coverageMask.slice(0,
    engine.rootAdapter.graph.nodeCount)).some(mask =>
      (mask & require("../../engine-v2/src/abi/search-codes").COVERAGE.NO_PROBABILITY_PRUNING) === 0));
  assert.ok(engine.rootAdapter.hardCheckedCells > engine.ourCount * engine.enemyCount);
  assert.equal(engine.adapter.state.deltaUsed, 0); assert.equal(engine.adapter.state.eventUsed, 0);
});

test("poison observation reconstructs relative cadence without storing boundary float speed", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "stun");
  me.status.poisoned = true; me.status.actionSpeed = 0.5; me.status.canActThisFrame = false;
  me.effects.debuff = { type: "poison", remainingFrames: 3 };
  const adapter = new ProductionObservationAdapter(); const adapted = adapter.adapt(me, enemy,
    game(11, map));
  assert.equal(adapted.informationComplete, true);
  assert.equal(adapter.state.arrays[ARRAY.TANK_POISON_APPLIED][0], 10);
  assert.equal(adapter.state.arrays[ARRAY.TANK_POISON_UNTIL][0], 14);
  assert.equal(adapter.ownCanAct, false);
});

test("cadence disagreement disables strict support while closed teleport family stays complete", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "teleport");
  enemy.skill.remainingCooldownFrames = 0;
  const adapter = new ProductionObservationAdapter(); let adapted = adapter.adapt(me, enemy,
    game(3, map, { star: [3, 3] }));
  assert.equal(adapted.informationComplete, true);

  enemy.skill.type = "stun"; enemy.skill.remainingCooldownFrames = 1;
  me.status.poisoned = true; me.status.actionSpeed = 0.5; me.status.canActThisFrame = true;
  me.effects.debuff = { type: "poison", remainingFrames: 3 };
  adapted = adapter.adapt(me, enemy, game(11, map));
  assert.equal(adapted.informationComplete, false);
});

test("active enemy boost emits complete bounded compound root programs", () => {
  const map = boxedMap(7, 7); const me = side("own", [1, 1], "right", "poison", []);
  const enemy = side("enemy", [5, 5], "left", "boost");
  enemy.status.boosted = true; enemy.effects.self = { type: "boost", remainingFrames: 3 };
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(me, enemy,
    game(3, map));
  assert.equal(adapted.informationComplete, true); engine.generateActions();
  assert.equal(engine.enemyCount, 13);
  assert.ok(Array.from(engine.enemyActions.slice(0, engine.enemyCount))
    .includes(ACTION.BOOST_LEFT_GO));
  assert.ok(Array.from(engine.enemyActions.slice(0, engine.enemyCount))
    .includes(ACTION.BOOST_RIGHT_FIRE));
  assert.ok(engine.rootAdapter.build(adapted.bundle, engine.ourActions, engine.ourArguments,
    engine.ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount) >= 0);
});

test("ready enemy teleport is one lazy complete family and can refute immediate FIRE proof", () => {
  const map = boxedMap(7, 5); const me = side("own", [1, 2], "right", "poison", []);
  const enemy = side("enemy", [3, 2], "left", "teleport");
  enemy.skill.remainingCooldownFrames = 0;
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(me, enemy,
    game(2, map));
  assert.equal(adapted.informationComplete, true); engine.generateActions();
  const teleportColumns = Array.from(engine.enemyActions.slice(0, engine.enemyCount))
    .filter(action => action === ACTION.CAST_TELEPORT);
  assert.equal(teleportColumns.length, 1);
  const root = engine.rootAdapter.build(adapted.bundle, engine.ourActions, engine.ourArguments,
    engine.ourCount, engine.enemyActions, engine.enemyArguments, engine.enemyCount);
  assert.ok(root >= 0); assert.ok(engine.rootAdapter.lazyTeleportTargetsChecked > 0);
  assert.notEqual(engine.search.proof.solve(root,
    require("../../engine-v2/src/abi/search-codes").PROOF_GOAL.FORCED_WIN), 1);
});

test("frame-limit equal stars are Hard policy loss without becoming strict Proof", () => {
  const map = boxedMap(7, 7); const me = side("own", [1, 1], "right", "poison", []);
  const enemy = side("enemy", [5, 5], "left", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(127, map));
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .every(value => value === HARD_STATUS.REJECT_POLICY));
  assert.notEqual(engine.lastProofStatus, 1);
  assert.equal(engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.RUNTIME_POLICY], 1);
});

test("frame-limit action collecting a deciding star overrides runtime policy loss", () => {
  const calls = []; const map = boxedMap(7, 7);
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [5, 5], "left", "stun"); const engine = new ProductionRootEngine();
  const action = engine.decide(me, enemy, game(127, map, { star: [2, 1] }));
  assert.equal(action, ACTION.GO); assert.deepEqual(calls, ["GO"]);
  assert.equal(engine.hardStatus[0], HARD_STATUS.ALLOW);
  assert.ok(Array.from(engine.hardStatus.slice(1, engine.ourCount))
    .every(value => value === HARD_STATUS.REJECT_POLICY));
});

test("poison is a real production candidate and can win ordinary root scoring", () => {
  const calls = []; const map = boxedMap(7, 7);
  const me = side("own", [2, 2], "up", "poison", calls);
  const enemy = side("enemy", [4, 4], "left", "stun");
  me.skill.remainingCooldownFrames = 0;
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(1, map));
  assert.equal(action, ACTION.CAST_POISON); assert.deepEqual(calls, ["POISON"]);
});

test("hidden opponent reuses the tracked pose but disables exact strict search", () => {
  const calls = []; const map = boxedMap(7, 7);
  const me = side("own", [2, 2], "right", "poison", calls);
  const enemy = side("enemy", [4, 2], "left", "stun");
  const engine = new ProductionRootEngine(); engine.decide(me, enemy, game(1, map));
  const searches = engine.coordinator.minimaxInvocationCount;
  enemy.tank = null; calls.length = 0; const action = engine.decide(me, enemy, game(2, map));
  assert.ok(action > ACTION.NONE); assert.equal(calls.length, 1);
  assert.equal(engine.adapter.enemyVisible, 0); assert.equal(engine.adapter.informationComplete, 0);
  assert.equal(engine.coordinator.minimaxInvocationCount, searches);
  assert.ok(engine.informationSearch.completedDepth >= 1);
  assert.ok(engine.informationSearch.worldsEvaluated > 0);
  assert.equal(engine.informationSearch.supportComplete, 0);
  assert.equal(engine.lastProofStatus, 0);
  assert.equal(engine.informationSearch.rootRestoreFailures, 0);
});

test("a hidden opponent on the first root creates bounded soft worlds instead of an invalid root", () => {
  const calls = []; const map = boxedMap(7, 7);
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", null, "left", "stun");
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(1, map));
  assert.ok(action > ACTION.NONE); assert.equal(engine.lastRootStatus, 2);
  assert.ok(engine.hiddenWorldCount > 0); assert.equal(engine.hiddenSupportComplete, 0);
  assert.equal(engine.policy.hidden.hardWriteCount, 0);
  assert.equal(engine.policy.hidden.proofWriteCount, 0);
});

test("grass and cloak uncertainty populate reachable belief and possible-shot fields only", () => {
  const calls = []; const map = boxedMap(9, 7); map[4][3] = "o";
  const me = side("own", [1, 3], "right", "poison", calls);
  const enemy = side("enemy", [4, 3], "left", "cloak");
  const engine = new ProductionRootEngine(); engine.decide(me, enemy, game(1, map));
  enemy.tank = null; enemy.status.cloaked = true;
  enemy.effects.self = { type: "cloak", remainingFrames: 3 };
  calls.length = 0; engine.decide(me, enemy, game(2, map));
  const hidden = engine.policy.hidden; const last = 3 * 9 + 4;
  assert.ok(hidden.flags[last] & POSSIBLE_HAZARD.BELIEF_ROUTE);
  assert.ok(hidden.flags[last] & POSSIBLE_HAZARD.GRASS);
  assert.ok(hidden.flags[last] & POSSIBLE_HAZARD.CLOAK_PROXIMITY);
  assert.ok(hidden.shotExposure[3 * 9 + 2] > 0);
  assert.ok(Array.from(engine.hardStatus.slice(0, engine.ourCount))
    .some(value => value === HARD_STATUS.ALLOW));
});

test("tracked projectiles persist across missing observations until physical invalidation", () => {
  const map = boxedMap(7, 5); const adapter = new ProductionObservationAdapter();
  const me = side("own", [3, 1], "up", "poison");
  const enemy = side("enemy", [5, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  adapter.adapt(me, enemy, game(1, map)); const id = adapter.tracker.projectileId[0];
  enemy.bullet = null; adapter.adapt(me, enemy, game(2, map));
  assert.equal(adapter.tracker.projectileActive[0], 1);
  assert.equal(adapter.enemyCanFire, false);
  assert.equal(adapter.tracker.projectileCell[0], 2 * 7 + 3);
  assert.equal(adapter.tracker.projectileId[0], id);
  adapter.adapt(me, enemy, game(4, map));
  assert.equal(adapter.tracker.projectileActive[0], 0);
});

test("a null enemy bullet after the initial root is an InformationState relation", () => {
  const map = boxedMap(7, 5); const adapter = new ProductionObservationAdapter();
  const me = side("own", [2, 1], "down", "poison");
  const enemy = side("enemy", [5, 3], "left", "stun");
  assert.equal(adapter.adapt(me, enemy, game(0, map)).informationComplete, true);
  const next = adapter.adapt(me, enemy, game(1, map));
  assert.equal(next.informationComplete, false);
  assert.equal(adapter.enemyCanFire, true);
  assert.equal(adapter.bundle.hard.hasCommittedThreat(), 0);
});

test("tracked projectile advances against prior terrain before a destroyed dirt update", () => {
  const map = boxedMap(7, 5); map[3][2] = "m";
  const adapter = new ProductionObservationAdapter();
  const me = side("own", [5, 1], "down", "poison");
  const enemy = side("enemy", [5, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  adapter.adapt(me, enemy, game(0, map));
  const changed = map.map(column => column.slice()); changed[3][2] = ".";
  enemy.bullet = null; adapter.adapt(me, enemy, game(1, changed));
  assert.equal(adapter.tracker.hasActiveProjectile(1), 0);
  assert.equal(adapter.enemyCanFire, true);
});

test("a predicted enemy projectile missing from an observable forward ray is refuted", () => {
  const map = boxedMap(7, 5); const adapter = new ProductionObservationAdapter();
  const me = side("own", [5, 2], "left", "poison");
  const enemy = side("enemy", [5, 3], "left", "stun");
  enemy.bullet = { position: [1, 2], direction: "right" };
  adapter.adapt(me, enemy, game(0, map));
  enemy.bullet = null; adapter.adapt(me, enemy, game(1, map));
  assert.equal(adapter.tracker.hasActiveProjectile(1), 0);
  assert.equal(adapter.enemyCanFire, true);
});

test("steady callbacks reuse root objects and declare zero production hot-path allocations", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(1, map)); const state = engine.adapter.state;
  const bundle = engine.adapter.bundle; const hazard = engine.adapter.hazard;
  engine.decide(me, enemy, game(2, map));
  assert.equal(engine.adapter.state, state); assert.equal(engine.adapter.bundle, bundle);
  assert.equal(engine.adapter.hazard, hazard); assert.ok(engine.adapter.reusedStateCount > 0);
  assert.equal(engine.hotAllocationCount + engine.adapter.hotAllocationCount +
    engine.adapter.tracker.hotAllocationCount, 0);
});

test("production root executes iterative depth, restores the root, and writes the physical TT", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(1, map));
  assert.ok(engine.searchOptions.decisionDepth > 1);
  assert.ok(engine.depthSearch.attemptedDepth > 1);
  assert.ok(engine.depthSearch.completedDepth >= 2);
  assert.ok(engine.depthSearch.nodes > engine.ourCount * engine.enemyCount);
  assert.ok(engine.depthSearch.cacheWrites > 0);
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
  assert.equal(engine.adapter.state.deltaUsed, 0);
  assert.equal(engine.adapter.state.eventUsed, 0);
  assert.ok(engine.forcedWinSearch.nodes > 0);
  assert.equal(engine.forcedWinSearch.rootRestoreFailures, 0);
});

test("exact direct kill is emitted only after multi-frame AND/OR proof and FinalActionGate", () => {
  const calls = []; const map = boxedMap(5, 5);
  const me = side("own", [1, 1], "right", "poison", calls);
  const enemy = side("enemy", [3, 1], "left", "stun");
  enemy.status.frozen = true; enemy.status.canActThisFrame = false;
  enemy.effects.debuff = { type: "freeze", remainingFrames: 3 };
  const engine = new ProductionRootEngine(); const action = engine.decide(me, enemy, game(1, map));
  assert.equal(action, ACTION.FIRE); assert.deepEqual(calls, ["FIRE"]);
  assert.equal(engine.lastProofStatus, 1); assert.equal(engine.forcedWinSearch.completedDepth, 1);
  assert.equal(engine.ourActions[engine.forcedWinSearch.winningRootRow], ACTION.FIRE);
  assert.equal(engine.finalGate.status[engine.finalGate.lastSelected], HARD_STATUS.ALLOW);
  assert.equal(engine.forcedWinSearch.rootRestoreFailures, 0);
});

test("repeated physical roots hit the production TT without changing the emitted action", () => {
  const map = boxedMap(7, 7); const calls = [];
  const me = side("own", [2, 2], "right", "poison", calls);
  const enemy = side("enemy", [4, 2], "left", "stun"); const engine = new ProductionRootEngine();
  const first = engine.decide(me, enemy, game(1, map)); const hits = engine.depthSearch.cacheHits;
  calls.length = 0; const second = engine.decide(me, enemy, game(1, map));
  assert.equal(second, first); assert.equal(calls.length, 1);
  assert.ok(engine.depthSearch.cacheHits > hits);
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
  assert.equal(engine.adapter.state.deltaUsed, 0);
  assert.equal(engine.adapter.state.eventUsed, 0);
});

test("physical TT off changes cache work only, never action Hard or strict Proof", () => {
  const map = boxedMap(7, 7); const input = game(1, map);
  const enabled = new ProductionRootEngine(); const enabledMe = side("own", [2, 2],
    "right", "poison", []); const enabledEnemy = side("enemy", [4, 2], "left", "stun");
  const enabledAction = enabled.decide(enabledMe, enabledEnemy, input);
  enabled.decide(enabledMe, enabledEnemy, input);
  const enabledHard = Array.from(enabled.hardStatus.slice(0, enabled.ourCount));
  assert.ok(enabled.depthSearch.cacheHits > 0);

  const disabled = new ProductionRootEngine(); disabled.cacheBank.setEnabled(
    CACHE_ID.PHYSICAL_VALUE_TT, false);
  const disabledMe = side("own", [2, 2], "right", "poison", []);
  const disabledEnemy = side("enemy", [4, 2], "left", "stun");
  const disabledAction = disabled.decide(disabledMe, disabledEnemy, input);
  disabled.decide(disabledMe, disabledEnemy, input);
  assert.equal(disabledAction, enabledAction);
  assert.deepEqual(Array.from(disabled.hardStatus.slice(0, disabled.ourCount)), enabledHard);
  assert.equal(disabled.lastProofStatus, enabled.lastProofStatus);
  assert.equal(disabled.search.strictFingerprintLo, enabled.search.strictFingerprintLo);
  assert.equal(disabled.search.strictFingerprintHi, enabled.search.strictFingerprintHi);
  assert.equal(disabled.depthSearch.cacheHits, 0);
  assert.equal(disabled.depthSearch.rootRestoreFailures, 0);
});

test("fallback runtime profile caps production iterative deepening at its configured depth", () => {
  const map = boxedMap(7, 7); const me = side("own", [2, 2], "right", "poison", []);
  const enemy = side("enemy", [4, 2], "left", "stun"); const engine = new ProductionRootEngine();
  engine.decide(me, enemy, game(1, map));
  engine.runtime.enterMode(2); engine.decide(me, enemy, game(2, map));
  assert.equal(engine.searchOptions.decisionDepth, 3);
  assert.ok(engine.depthSearch.attemptedDepth <= 3);
  assert.ok(engine.depthSearch.completedDepth <= 3);
  assert.equal(engine.depthSearch.rootRestoreFailures, 0);
});
