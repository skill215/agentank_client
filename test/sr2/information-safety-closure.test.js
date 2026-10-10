"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY } = require("../../engine-v2/src/state/fast-state");
const { HazardKernel } = require("../../engine-v2/src/fast/hazard");
const { InformationSafetyClosure, SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");
const { HARD_STATUS, TERRAIN } = require("../../engine-v2/src/abi/fast-codes");
const { PossibleProjectileTracker } = require("../../engine-v2/src/runtime/possible-projectiles");
const { NONE_FRAME } = require("../../engine-v2/src/abi/fast-codes");
const { SCALAR } = require("../../engine-v2/src/state/fast-state");
const { NONE_CAPABILITY_DEPTH, ThreatCapabilityTimeline } =
  require("../../engine-v2/src/search/threat-capability-timeline");

function fixture(width = 8, height = 8) {
  const state = new FastState(width, height); state.arrays[ARRAY.TERRAIN].fill(TERRAIN.OPEN);
  const hazard = new HazardKernel(state); return { state, hazard, bundle: { state, hazard } };
}
function evaluate(options = {}) {
  const item = options.item || fixture(); const closure = new InformationSafetyClosure();
  const target = options.target ?? item.state.cell(4, 3);
  const worlds = new Uint16Array(8); const mass = new Uint16Array(8);
  const list = options.worlds || []; for (let index = 0; index < list.length; index += 1) {
    worlds[index] = list[index][0]; mass[index] = list[index][1]; }
  const hard = new Uint8Array([options.hard ?? HARD_STATUS.ALLOW]);
  const cells = new Uint16Array([target]); const directions = new Uint8Array([options.direction || 0]);
  const outcome = closure.evaluate(item.bundle, new Uint8Array([0]), 1, hard, cells, directions,
    worlds, mass, list.length, options.complete === false ? 0 : 1,
    options.possible || null, options.enemyCanFire === false ? 0 : 1,
    options.enemyDirection || 0, options.budget ?? 100, options.strategyConsistent === false ? 0 : 1,
    10000, null, null, null, options.timeline || null, null, null,
    options.deadlineAware ? 1 : 0);
  return { closure, outcome, item };
}

function evaluateChance(options = {}) {
  const item = options.item || fixture(); const closure = new InformationSafetyClosure({
    uniformChanceMass: options.uniformChanceMass
  });
  const target = options.target ?? item.state.cell(4, 3);
  const outcome = closure.evaluate(item.bundle, new Uint8Array([0]), 1,
    new Uint8Array([HARD_STATUS.ALLOW]), new Uint16Array([target]), new Uint8Array([0]),
    new Uint16Array(1), new Uint16Array(1), 0, 1, null, 0, 0, 100, 1, 10000,
    new Uint8Array([options.support ?? 2]), new Uint8Array([options.fatal ?? 1]),
    new Uint8Array([options.incomplete ?? 0]));
  return { closure, outcome, item };
}

test("SR2 low risk to low risk to fatal frontier is never marked PROVEN_SAFE", () => {
  const item = fixture(); const world = item.state.cell(2, 2);
  const { outcome } = evaluate({ item, worlds: [[world, 10000]], target: item.state.cell(4, 3) });
  assert.notEqual(outcome.status[0], SAFETY_STATUS.PROVEN_SAFE);
  assert.ok(outcome.horizonFatalMass[0] > 0); assert.ok(outcome.earliestFatalFrame[0] <= 4);
});

test("SR2 potential FIRE writes Safety only and cannot upgrade root Hard", () => {
  const item = fixture(5, 5); const target = item.state.cell(2, 2); const world = item.state.cell(2, 4);
  item.state.arrays[ARRAY.TERRAIN][item.state.cell(1, 2)] = TERRAIN.WALL;
  item.state.arrays[ARRAY.TERRAIN][item.state.cell(3, 2)] = TERRAIN.WALL;
  const hard = HARD_STATUS.ALLOW; const { outcome } = evaluate({ item, target,
    worlds: [[world, 10000]], enemyDirection: 0, hard });
  assert.equal(hard, HARD_STATUS.ALLOW);
  assert.equal(outcome.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(outcome.immediateFatalMass[0], 10000);
});

test("SR2 fatal stun support is Safety risk and never a false PROVEN_SAFE or Hard reject", () => {
  const { outcome } = evaluateChance({ support: 2, fatal: 1 });
  assert.equal(outcome.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(outcome.immediateFatalMass[0], 10000);
  assert.equal(outcome.chanceSupportCount[0], 2);
  assert.equal(outcome.chanceFatalSupportCount[0], 1);
});

test("SR2 diagnostic uniform ChanceOutcome mass distinguishes partial from universal death", () => {
  const partial = evaluateChance({ support: 2, fatal: 1, uniformChanceMass: true });
  const universal = evaluateChance({ support: 2, fatal: 2, uniformChanceMass: true });
  assert.equal(partial.outcome.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(partial.outcome.immediateFatalMass[0], 5000);
  assert.equal(universal.outcome.immediateFatalMass[0], 10000);
});

test("SR2 incomplete hidden support budget or observation strategy returns UNKNOWN or POSSIBLE", () => {
  const incomplete = evaluate({ worlds: [], complete: false });
  assert.notEqual(incomplete.outcome.status[0], SAFETY_STATUS.PROVEN_SAFE);
  assert.equal(incomplete.outcome.unknownMass[0], 10000);
  const inconsistent = evaluate({ worlds: [], enemyCanFire: false, strategyConsistent: false });
  assert.equal(inconsistent.outcome.status[0], SAFETY_STATUS.UNKNOWN);
  const interrupted = evaluate({ worlds: [[1, 5000]], budget: 0 });
  assert.equal(interrupted.outcome.status[0], SAFETY_STATUS.UNKNOWN);
});

test("SR2 no-threat complete support is the only ordinary PROVEN_SAFE path", () => {
  const { outcome } = evaluate({ worlds: [], enemyCanFire: false, complete: true });
  assert.equal(outcome.status[0], SAFETY_STATUS.PROVEN_SAFE);
  assert.equal(outcome.horizonFatalMass[0], 0); assert.equal(outcome.unknownMass[0], 0);
});

test("SR2 committed Hard death is proven while incomplete Hard is never proven safe", () => {
  assert.equal(evaluate({ hard: HARD_STATUS.REJECT_PROVEN }).outcome.status[0],
    SAFETY_STATUS.PROVEN_DEAD);
  assert.equal(evaluate({ hard: HARD_STATUS.INCOMPLETE }).outcome.status[0],
    SAFETY_STATUS.POSSIBLE_DEATH);
});

test("SR2 committed projectile horizon is not truncated to four future-fire frames", () => {
  const item = fixture(20, 20); const a = item.state.arrays;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = item.state.cell(1, 1); a[ARRAY.PROJECTILE_DIR][0] = 1;
  a[ARRAY.PROJECTILE_ID][0] = 7; a[ARRAY.PROJECTILE_GENERATION][0] = 1;
  item.state.initializeHash(); item.hazard.rebuild(0);
  const target = item.state.cell(10, 10); const { outcome } = evaluate({ item, target,
    worlds: [], enemyCanFire: false });
  assert.ok(outcome.committedDeadlineFrames[0] > 4);
});

test("SR2 existing possible projectile uses arrival versus turn-and-escape viability", () => {
  const item = fixture(9, 7); const possible = new PossibleProjectileTracker(); possible.reset(4);
  const source = item.state.cell(6, 3); const target = item.state.cell(2, 3);
  assert.equal(possible.addFired(item.state, source, 3, 4, 4, 0xffff, 5000), 1);
  const trapped = evaluate({ item, target, direction: 3, possible, enemyCanFire: false });
  assert.equal(trapped.outcome.earliestFatalFrame[0], 2);
  assert.equal(trapped.outcome.horizonFatalMass[0], 5000);
  const escaped = evaluate({ item, target, direction: 0, possible, enemyCanFire: false });
  assert.equal(escaped.outcome.horizonFatalMass[0], 0);
  assert.ok(escaped.outcome.escapeSlack[0] >= 0);
});

test("SR2 zero frontier budget still evaluates an already tracked possible projectile", () => {
  const item = fixture(9, 7); const possible = new PossibleProjectileTracker(); possible.reset(4);
  const source = item.state.cell(4, 3); const target = item.state.cell(2, 3);
  assert.equal(possible.addFired(item.state, source, 3, 4, 4, 0xffff, 6412), 1);
  const result = evaluate({ item, target, direction: 2, possible,
    enemyCanFire: true, worlds: [[item.state.cell(6, 3), 10000]],
    enemyDirection: 3, budget: 0 });
  assert.equal(result.outcome.possibleProjectileDeathMass[0], 6412);
  assert.equal(result.outcome.immediateFatalMass[0], 6412);
  assert.equal(result.outcome.unknownMass[0], 10000);
  assert.notEqual(result.outcome.status[0], SAFETY_STATUS.PROVEN_SAFE);
});

test("SR2 aligned future FIRE uses projectile impact deadline and pose escape latency", () => {
  const item = fixture(9, 11); const target = item.state.cell(2, 8);
  const world = item.state.cell(6, 8);
  item.state.arrays[ARRAY.TANK_CELL][1] = world;
  item.state.arrays[ARRAY.TERRAIN][item.state.cell(2, 9)] = TERRAIN.WALL;
  const trapped = evaluate({ item, target, direction: 2,
    worlds: [[world, 10000]], enemyDirection: 3, budget: 100, deadlineAware: true });
  assert.equal(trapped.outcome.futureFireDepth[0], 2);
  assert.equal(trapped.outcome.futureFireDeathMass[1], 10000);
  assert.ok(trapped.outcome.escapeSlack[0] < 0);

  const ready = evaluate({ item, target, direction: 0,
    worlds: [[world, 10000]], enemyDirection: 3, budget: 100, deadlineAware: true });
  assert.equal(ready.outcome.futureFireDepth[0], 0xff);
  assert.equal(ready.outcome.horizonFatalMass[0], 0);
  assert.ok(ready.outcome.escapeSlack[0] >= 0);
});

test("SR2 non-aligned future FIRE retains conservative soft-risk slack", () => {
  const item = fixture(9, 11); const target = item.state.cell(4, 8);
  const world = item.state.cell(3, 10);
  item.state.arrays[ARRAY.TANK_CELL][1] = world;
  const result = evaluate({ item, target, direction: 1,
    worlds: [[world, 10000]], enemyDirection: 3, budget: 100 });
  // This is a soft InformationState ordering bound, not committed
  // ReverseViability. Keeping it conservative avoids promoting a lateral
  // move before a complete directional safety referee exists.
  assert.equal(result.outcome.escapeSlack[0], -1);
  assert.notEqual(result.outcome.status[0], SAFETY_STATUS.PROVEN_SAFE);
  assert.ok(result.outcome.horizonFatalMass[0] > 0);
});

test("SR2 exhaustive 1 to 4 frame threat fixtures have no safe or dead false positive", () => {
  const item = fixture(); const target = item.state.cell(4, 4);
  for (let depth = 1; depth <= 4; depth += 1) {
    const world = depth <= 2 ? item.state.cell(4, Math.min(7, 4 + depth)) :
      item.state.cell(4 - (depth - 2), 3);
    const { outcome } = evaluate({ item, target, worlds: [[world, 10000]], enemyDirection: 0 });
    assert.notEqual(outcome.status[0], SAFETY_STATUS.PROVEN_SAFE, `depth ${depth}`);
    assert.notEqual(outcome.status[0], SAFETY_STATUS.PROVEN_DEAD, `depth ${depth}`);
  }
});

test("SR2 safety closure owns fixed slabs and reports zero hot allocation", () => {
  const result = evaluate({ worlds: [], enemyCanFire: false });
  assert.equal(result.closure.hotAllocationCount, 0);
  assert.equal(result.closure.outcome.hotAllocationCount, 0);
});

test("SR2 threat capability waits for projectile release while using wait frames for setup", () => {
  const item = fixture(8, 8); const a = item.state.arrays; const state = item.state;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 10; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  a[ARRAY.PROJECTILE_ACTIVE][0] = 1; a[ARRAY.PROJECTILE_OWNER][0] = 1;
  a[ARRAY.PROJECTILE_CELL][0] = state.cell(5, 3); a[ARRAY.PROJECTILE_DIR][0] = 1;
  a[ARRAY.TERRAIN][state.cell(7, 3)] = TERRAIN.WALL;
  const timeline = new ThreatCapabilityTimeline(); timeline.prepare(item.bundle, 1, 1, 0, 1);
  assert.equal(timeline.projectileReleaseDepth, 2);
  assert.equal(timeline.canFire[1], 0); assert.equal(timeline.canFire[2], 1);
  assert.equal(timeline.earliestCompletion(1), 2);
  assert.equal(timeline.earliestCompletion(2), 2);
});

test("SR2 Safety consumes a future FIRE slot even when FIRE is unavailable at root", () => {
  const item = fixture(8, 8); const a = item.state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 10; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  const timeline = new ThreatCapabilityTimeline(); timeline.prepare(item.bundle, 1, 1, 0, 1);
  const target = item.state.cell(4, 3); const world = item.state.cell(4, 5);
  const { outcome } = evaluate({ item, target, worlds: [[world, 10000]], enemyDirection: 0,
    enemyCanFire: false, timeline });
  assert.equal(outcome.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(outcome.futureFireDepth[0], 2);
  assert.ok(outcome.horizonFatalMass[0] > 0);
});

test("SR2 threat capability advances freeze and poison cadence without inventing action slots", () => {
  const item = fixture(); const a = item.state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 10; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][1] = 12; a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  const frozen = new ThreatCapabilityTimeline(); frozen.prepare(item.bundle, 1, 0, 0, 1);
  assert.deepEqual([...frozen.canAct.slice(1)], [0, 0, 1, 1]);
  assert.equal(frozen.earliestCompletion(2), 4);
  a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME; a[ARRAY.TANK_POISON_APPLIED][1] = 10;
  a[ARRAY.TANK_POISON_UNTIL][1] = 14;
  const poisoned = new ThreatCapabilityTimeline(); poisoned.prepare(item.bundle, 1, 1, 1, 1);
  assert.deepEqual([...poisoned.canAct.slice(1)], [1, 0, 1, 0]);
  assert.equal(poisoned.earliestCompletion(2), 3);
});

test("SR2 incomplete capability support cannot claim a complete timeline", () => {
  const item = fixture(); const a = item.state.arrays;
  a[ARRAY.SCALAR][SCALAR.FRAME] = 10; a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_POISON_APPLIED][1] = NONE_FRAME; a[ARRAY.TANK_POISON_UNTIL][1] = 14;
  const timeline = new ThreatCapabilityTimeline();
  assert.equal(timeline.prepare(item.bundle, 1, 1, 1, 1), 0);
  assert.equal(timeline.complete, 0);
  assert.equal(timeline.hotAllocationCount, 0);
  assert.equal(timeline.earliestCompletion(9), NONE_CAPABILITY_DEPTH);
});
