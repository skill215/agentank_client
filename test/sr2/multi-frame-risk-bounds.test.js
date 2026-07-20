"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FastState, ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { TERRAIN, HARD_STATUS, NONE_FRAME } = require("../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../engine-v2/src/generated/search-config");
const { CAPACITY, RULE } = require("../../engine-v2/src/generated/fast-config");
const { SafetyOutcomeSlab, SAFETY_STATUS } =
  require("../../engine-v2/src/search/information-safety-closure");
const { ThreatCapabilityTimeline } =
  require("../../engine-v2/src/search/threat-capability-timeline");
const { MultiFrameRiskBounds, RISK_BOUNDS_STATUS } =
  require("../../engine-v2/src/search/multi-frame-risk-bounds");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { PossibleProjectileTracker } =
  require("../../engine-v2/src/runtime/possible-projectiles");
const { HiddenProjectileRiskField } =
  require("../../engine-v2/src/runtime/hidden-projectile-risk-field");

function fixture(actionCount = 2) {
  const state = new FastState(7, 7); const a = state.arrays;
  a[ARRAY.TERRAIN].fill(TERRAIN.OPEN); a[ARRAY.SCALAR][SCALAR.FRAME] = 0;
  a[ARRAY.TANK_FIRE_LOCK][1] = NONE_FRAME;
  a[ARRAY.TANK_FROZEN_UNTIL][0] = a[ARRAY.TANK_FROZEN_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_POISON_UNTIL][0] = a[ARRAY.TANK_POISON_UNTIL][1] = NONE_FRAME;
  a[ARRAY.TANK_STUN_UNTIL][0] = NONE_FRAME; a[ARRAY.TANK_BOOST_UNTIL][0] = NONE_FRAME;
  const timeline = new ThreatCapabilityTimeline(); timeline.prepare({ state }, 1, 1, 1, 1);
  const hard = new Uint8Array(actionCount); hard.fill(HARD_STATUS.ALLOW);
  const chanceSupport = new Uint8Array(actionCount); chanceSupport.fill(1);
  const chanceIncomplete = new Uint8Array(actionCount);
  const chanceCell = new Uint16Array(actionCount * SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES);
  chanceCell.fill(0xffff);
  const chanceDirection = new Uint8Array(chanceCell.length);
  const worlds = new Uint16Array([state.cell(3, 0)]);
  const worldMass = new Uint16Array([10000]);
  const safety = new SafetyOutcomeSlab(); safety.reset(actionCount);
  safety.status.fill(SAFETY_STATUS.POSSIBLE_DEATH, 0, actionCount);
  return { state, timeline, hard, chanceSupport, chanceIncomplete, chanceCell,
    chanceDirection, worlds, worldMass, safety };
}

function evaluate(item, bounds, budget = 4096, fireProbability = 10000, possible = null,
    directionMask = null, riskSupportComplete = 1, exactSupportComplete = 1, hidden = null) {
  return bounds.evaluate({ state: item.state }, item.hard.length, item.hard,
    item.chanceSupport, item.chanceIncomplete, item.chanceCell, item.chanceDirection,
    item.worlds, item.worldMass, item.worlds.length, exactSupportComplete, item.timeline, 2,
    fireProbability, budget, item.safety, possible, directionMask, riskSupportComplete, hidden);
}

// Deliberately recomputes every track.  This is the pre-cache definition and
// therefore an independent oracle for the shared four-frame hazard field.
function naivePossibleHorizon(possible, state, candidateCell, candidateDirection,
    maximumFrames) {
  let horizonMass = 0; let horizonFrame = 0xff; let escapeSlack = 4;
  for (let slot = 0; slot < possible.active.length; slot += 1) if (possible.active[slot]) {
    let cell = possible.cell[slot]; const shotDirection = possible.direction[slot];
    let arrival = 0xff; let live = 1;
    for (let frame = 1; frame <= maximumFrames && arrival === 0xff && live; frame += 1)
      for (let step = 0; step < RULE.PROJECTILE_STEPS; step += 1) {
        cell = possible.target(state, cell, shotDirection);
        if (!possible.validTarget(state, cell)) { live = 0; break; }
        if (cell === candidateCell) { arrival = frame; break; }
      }
    if (arrival === 0xff) continue;
    const left = (shotDirection + 3) & 3; const right = (shotDirection + 1) & 3;
    const hasEscape = possible.validTarget(state, possible.target(state, candidateCell, left)) ||
      possible.validTarget(state, possible.target(state, candidateCell, right));
    let escapeFrames = 0xff;
    if (hasEscape) escapeFrames = (candidateDirection & 1) !== (shotDirection & 1) ? 1 : 2;
    const slack = escapeFrames === 0xff ? -4 : arrival - escapeFrames - 1;
    if (slack < escapeSlack) escapeSlack = Math.max(-4, slack);
    if (escapeFrames < arrival) continue;
    if (arrival < horizonFrame) {
      horizonFrame = arrival; horizonMass = possible.mass[slot];
    } else if (arrival === horizonFrame && possible.mass[slot] > horizonMass)
      horizonMass = possible.mass[slot];
  }
  return { horizonMass, horizonFrame, escapeSlack };
}

test("SR2 path-aware risk separates immediate fire from a four-frame evasive continuation", () => {
  const item = fixture(); const stride = SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
  item.chanceCell[0] = item.state.cell(3, 2); item.chanceDirection[0] = 0;
  item.chanceCell[stride] = item.state.cell(2, 2); item.chanceDirection[stride] = 0;
  // Seed the coarse static estimate. The path stage can tighten this upper
  // envelope, but cannot erase it before the future policy is committed.
  item.safety.addFutureFire(0, 1, 10000); item.safety.addFutureFire(1, 3, 2500);
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(item.hard[0], HARD_STATUS.ALLOW); assert.equal(item.hard[1], HARD_STATUS.ALLOW);
  assert.equal(item.safety.horizonFatalMass[0], 10000);
  assert.equal(item.safety.earliestFatalFrame[0], 1);
  assert.ok(item.safety.horizonFatalMass[1] < item.safety.horizonFatalMass[0]);
  assert.equal(item.safety.earliestFatalFrame[1], 3);
  assert.ok(item.safety.horizonFatalMass[1] >= 2500);
  assert.equal(item.safety.strategyRiskApplied[0], 1);
  assert.equal(item.safety.strategyRiskApplied[1], 1);
  const controller = new RiskAcceptanceController();
  controller.populate(2, item.hard, item.safety, new Int16Array(2), null, null, 0);
  controller.gate(26, 0);
  assert.equal(controller.outcome.horizonFatalMass[1], item.safety.horizonFatalMass[1]);
  assert.equal(controller.outcome.acceptable[1], 0,
    "a complete conservative upper envelope participates in the risk gate");
});

test("SR2 future FIRE creates a projectile that remains hazardous after the release frame", () => {
  const item = fixture(1); const target = item.state.cell(3, 6);
  item.chanceCell[0] = target; item.chanceDirection[0] = 0;
  item.safety.addFutureFire(0, 1, 1);
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.APPLIED);
  const at = 3 * CAPACITY.MAX_CELLS + target;
  assert.ok(bounds.fireThreatMassCache[at] > 0,
    "a depth-1 shot from six cells away must still occupy the ray at depth 3");
  assert.notEqual(bounds.choice[require("../../engine-v2/src/search/multi-frame-risk-bounds")
    .POSITION_STATES + target * 4], 0,
  "the recurrence must schedule an evasion instead of forgetting the new projectile");
});

test("SR2 multi-frame risk publishes the whole comparable root set or no row at all", () => {
  const item = fixture(); const stride = SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
  item.chanceCell[0] = item.state.cell(3, 2); item.chanceCell[stride] = item.state.cell(2, 2);
  item.safety.addFutureFire(0, 1, 7777); item.safety.addFutureFire(1, 2, 3333);
  const before = [...item.safety.deathMass.slice(0, 8)]; const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 1), RISK_BOUNDS_STATUS.BUDGET);
  assert.deepEqual([...item.safety.deathMass.slice(0, 8)], before);
  assert.deepEqual([...item.safety.strategyRiskApplied.slice(0, 2)], [0, 0]);
  assert.equal(bounds.appliedActions, 0);
});

test("SR2 ChanceOutcome support uses the conservative maximum without changing Hard or Proof", () => {
  const item = fixture(1); item.chanceSupport[0] = 2;
  item.chanceCell[0] = item.state.cell(2, 2);
  item.chanceCell[1] = item.state.cell(3, 2);
  item.safety.addFutureFire(0, 3, 1);
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(item.hard[0], HARD_STATUS.ALLOW);
  assert.equal(item.safety.status[0], SAFETY_STATUS.POSSIBLE_DEATH);
  assert.equal(item.safety.immediateFatalMass[0], 10000);
});

test("SR2 quantitative fire risk is monotone in opponent FIRE probability", () => {
  const low = fixture(1); low.chanceCell[0] = low.state.cell(2, 2);
  const high = fixture(1); high.chanceCell[0] = high.state.cell(2, 2);
  low.safety.addFutureFire(0, 3, 1); high.safety.addFutureFire(0, 3, 1);
  assert.equal(evaluate(low, new MultiFrameRiskBounds(), 4096, 3000),
    RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(evaluate(high, new MultiFrameRiskBounds(), 4096, 9000),
    RISK_BOUNDS_STATUS.APPLIED);
  assert.ok(high.safety.horizonFatalMass[0] >= low.safety.horizonFatalMass[0]);
});

test("SR2 incomplete chance support cannot publish, while complete future stun uses worst geometry", () => {
  const item = fixture(1); item.chanceCell[0] = item.state.cell(2, 2);
  item.safety.addFutureFire(0, 3, 1);
  item.chanceIncomplete[0] = 1; const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.INCOMPLETE);
  assert.equal(item.safety.strategyRiskApplied[0], 0);
  item.chanceIncomplete[0] = 0;
  item.state.arrays[ARRAY.TANK_STUN_UNTIL][0] = 3;
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(item.safety.strategyRiskApplied[0], 1);
  assert.ok(item.safety.horizonFatalMass[0] > 0);
});

test("SR2 multi-frame risk owns only fixed TypedArrays and reports zero hot allocation", () => {
  const bounds = new MultiFrameRiskBounds();
  for (const value of Object.values(bounds))
    if (ArrayBuffer.isView(value)) assert.equal(value.buffer instanceof ArrayBuffer, true);
  assert.equal(bounds.hotAllocationCount, 0);
});

test("SR2 zero static threat frontier skips all multi-frame work", () => {
  const item = fixture(1); item.chanceCell[0] = item.state.cell(6, 6);
  item.worlds[0] = item.state.cell(0, 0); const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds), RISK_BOUNDS_STATUS.NOT_APPLICABLE);
  assert.equal(bounds.nodes, 0); assert.equal(bounds.appliedActions, 0);
});

test("SR2 possible projectile shares the four-frame strategy path with future FIRE", () => {
  const item = fixture(2); const stride = SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
  item.timeline.hasFireSupport = 0;
  item.chanceCell[0] = item.state.cell(3, 2); item.chanceDirection[0] = 2;
  item.chanceCell[stride] = item.state.cell(2, 2); item.chanceDirection[stride] = 2;
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  assert.equal(possible.addFired(item.state, item.state.cell(3, 0), 2,
    0, 0, 0xffff, 5000), 1);
  item.safety.addPossibleProjectile(0, 1, 5000);
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible), RISK_BOUNDS_STATUS.APPLIED);
  assert.ok(item.safety.horizonFatalMass[0] > item.safety.horizonFatalMass[1]);
  assert.equal(item.safety.committedDeathMass[0], 0);
  assert.equal(item.safety.possibleProjectileDeathMass[0], 5000);
  assert.equal(item.safety.possibleProjectileStrategyApplied[0], 1);
  assert.equal(item.safety.possibleProjectileStrategyApplied[1], 1);
  assert.equal(item.safety.futureFireStrategyApplied[0], 0);
});

test("SR2 unresolved possible projectile prevents joint path publication", () => {
  const item = fixture(1); item.chanceCell[0] = item.state.cell(3, 2);
  item.safety.addFutureFire(0, 1, 5000);
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  assert.equal(possible.addFired(item.state, item.state.cell(3, 0), 2,
    0, 0, 0xffff, 5000), 1);
  possible.pool.complete = 0; const before = [...item.safety.deathMass.slice(0, 4)];
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible), RISK_BOUNDS_STATUS.INCOMPLETE);
  assert.deepEqual([...item.safety.deathMass.slice(0, 4)], before);
  assert.equal(item.safety.strategyRiskApplied[0], 0);
});

test("SR2 empty hidden projectile input cannot invalidate a complete ordinary track", () => {
  const item = fixture(1); item.timeline.hasFireSupport = 0;
  item.chanceCell[0] = item.state.cell(3, 2); item.chanceDirection[0] = 2;
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  possible.addFired(item.state, item.state.cell(3, 0), 2, 0, 0, 0xffff, 5000);
  item.safety.addPossibleProjectile(0, 1, 5000);
  const emptyHidden = new HiddenProjectileRiskField(); emptyHidden.reset();
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible, null, 1, 1, emptyHidden),
    RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(item.safety.possibleProjectileStrategyApplied[0], 1);
});

test("SR2 hidden-world plus possible-projectile envelope publishes Risk without upgrading Hard", () => {
  const item = fixture(2); const stride = SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES;
  item.chanceCell[0] = item.state.cell(3, 2); item.chanceDirection[0] = 2;
  item.chanceCell[stride] = item.state.cell(2, 2); item.chanceDirection[stride] = 2;
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  assert.equal(possible.addFired(item.state, item.state.cell(3, 0), 2,
    0, 0, 0xffff, 5000), 1);
  item.safety.addPossibleProjectile(0, 1, 5000);
  item.safety.unknownMass.fill(1, 0, 2);
  const directionMask = new Uint8Array([1 << 2]); const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible, directionMask, 1, 0),
    RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(bounds.appliedActions, 2);
  assert.equal(item.safety.possibleProjectileStrategyApplied[0], 1);
  assert.equal(item.safety.futureFireStrategyApplied[0], 1);
  assert.deepEqual([...item.hard], [HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]);
  assert.deepEqual([...item.safety.unknownMass.slice(0, 2)], [1, 1],
    "a conservative Risk envelope cannot make hidden support exact");
});

test("SR2 incomplete hidden Risk envelope atomically refuses the joint publication", () => {
  const item = fixture(1); item.chanceCell[0] = item.state.cell(3, 2);
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  possible.addFired(item.state, item.state.cell(3, 0), 2, 0, 0, 0xffff, 5000);
  item.safety.addPossibleProjectile(0, 1, 5000);
  const before = [...item.safety.deathMass.slice(0, 4)]; const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible,
    new Uint8Array([0x0f]), 0, 0), RISK_BOUNDS_STATUS.INCOMPLETE);
  assert.deepEqual([...item.safety.deathMass.slice(0, 4)], before);
  assert.equal(bounds.appliedActions, 0);
});

test("SR2 hidden direction support uses the worst supported orientation", () => {
  const away = fixture(1); const toward = fixture(1);
  away.chanceCell[0] = away.state.cell(3, 2); toward.chanceCell[0] = toward.state.cell(3, 2);
  away.safety.addFutureFire(0, 2, 1); toward.safety.addFutureFire(0, 2, 1);
  assert.equal(evaluate(away, new MultiFrameRiskBounds(), 4096, 10000, null,
    new Uint8Array([1 << 0]), 1, 0), RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(evaluate(toward, new MultiFrameRiskBounds(), 4096, 10000, null,
    new Uint8Array([1 << 2]), 1, 0), RISK_BOUNDS_STATUS.APPLIED);
  assert.ok(toward.safety.immediateFatalMass[0] > away.safety.immediateFatalMass[0]);
  assert.deepEqual([...toward.hard], [HARD_STATUS.ALLOW]);
});

test("SR2 possible projectile projection is exact for every cell and generation", () => {
  const item = fixture(1); item.timeline.hasFireSupport = 0;
  item.chanceCell[0] = item.state.cell(1, 1); item.chanceDirection[0] = 1;
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  possible.addFired(item.state, item.state.cell(0, 1), 1, 0, 0, 0xffff, 4000);
  possible.addFired(item.state, item.state.cell(6, 5), 3, 0, 0, 0xffff, 7000);
  const bounds = new MultiFrameRiskBounds();
  assert.equal(evaluate(item, bounds, 4096, 10000, possible), RISK_BOUNDS_STATUS.APPLIED);
  for (let depth = 1; depth <= 4; depth += 1)
    for (let cell = 0; cell < item.state.cells; cell += 1) {
      const at = depth * CAPACITY.MAX_CELLS + cell;
      let projected = 0;
      if (possible.horizonStamp[at] === possible.horizonGeneration) {
        const base = at * 4;
        for (let direction = 0; direction < 4; direction += 1)
          projected = Math.max(projected, possible.horizonMass[base + direction]);
      }
      assert.equal(projected, possible.lethalMassAt(item.state, cell, depth),
        `depth=${depth}:cell=${cell}`);
    }
  assert.equal(bounds.possibleHazardBuildCount, 1);
  assert.equal(possible.horizonBuildCount, 1);
  item.safety.reset(1); item.safety.status[0] = SAFETY_STATUS.POSSIBLE_DEATH;
  assert.equal(evaluate(item, bounds, 4096, 10000, possible), RISK_BOUNDS_STATUS.APPLIED);
  assert.equal(bounds.possibleHazardBuildCount, 1);
  assert.equal(possible.horizonBuildCount, 1);
  assert.equal(bounds.possibleHazardCacheHit, 1);
  possible.reset(1);
  possible.addFired(item.state, item.state.cell(0, 6), 1, 1, 1, 0xffff, 3000);
  item.safety.reset(1); item.safety.status[0] = SAFETY_STATUS.POSSIBLE_DEATH;
  assert.equal(evaluate(item, bounds, 4096, 10000, possible), RISK_BOUNDS_STATUS.APPLIED);
  const stale = CAPACITY.MAX_CELLS + item.state.cell(1, 1);
  assert.equal(bounds.possibleHazardBuildCount, 2);
  assert.equal(possible.horizonBuildCount, 2);
  assert.notEqual(possible.horizonStamp[stale], possible.horizonGeneration,
    "a prior generation must not leak a projectile cell");
});

test("SR2 shared possible-projectile cache is differential-equivalent to direct track scans", () => {
  const item = fixture(1); const state = item.state; const terrain = state.arrays[ARRAY.TERRAIN];
  terrain[state.cell(4, 1)] = TERRAIN.WALL;
  terrain[state.cell(6, 5)] = TERRAIN.DIRT;
  const possible = new PossibleProjectileTracker(); possible.reset(0);
  assert.equal(possible.addFired(state, state.cell(0, 3), 1, 0, 0, 0xffff, 4000), 1);
  assert.equal(possible.addFired(state, state.cell(6, 3), 3, 0, 0, 0xffff, 7000), 1);
  assert.equal(possible.addFired(state, state.cell(4, 6), 0, 0, 0, 0xffff, 5500), 1);
  for (let maximum = 4; maximum >= 1; maximum -= 1)
    for (let cell = 0; cell < state.cells; cell += 1)
      for (let direction = 0; direction < 4; direction += 1) {
        const expected = naivePossibleHorizon(possible, state, cell, direction, maximum);
        const actual = possible.evaluateHorizon(state, cell, direction, maximum);
        assert.deepEqual({ horizonMass: actual, horizonFrame: possible.lastHorizonFrame,
          escapeSlack: possible.lastEscapeSlack }, expected,
        `maximum=${maximum}:cell=${cell}:direction=${direction}`);
      }
  assert.equal(possible.horizonBuildCount, 1,
    "all candidate actions must share one terrain/trajectory projection");
  assert.ok(possible.horizonCacheHitCount > 0);

  terrain[state.cell(2, 3)] = TERRAIN.WALL;
  state.arrays[ARRAY.SCALAR][SCALAR.TERRAIN_VERSION] += 1;
  const expected = naivePossibleHorizon(possible, state, state.cell(3, 3), 0, 4);
  const actual = possible.evaluateHorizon(state, state.cell(3, 3), 0, 4);
  assert.deepEqual({ horizonMass: actual, horizonFrame: possible.lastHorizonFrame,
    escapeSlack: possible.lastEscapeSlack }, expected);
  assert.equal(possible.horizonBuildCount, 2, "terrain changes must invalidate the shared field");

  assert.equal(possible.advanceSlot(state, 0, 1), 1);
  const advancedExpected = naivePossibleHorizon(possible, state, state.cell(3, 3), 0, 4);
  const advancedActual = possible.evaluateHorizon(state, state.cell(3, 3), 0, 4);
  assert.deepEqual({ horizonMass: advancedActual, horizonFrame: possible.lastHorizonFrame,
    escapeSlack: possible.lastEscapeSlack }, advancedExpected);
  assert.equal(possible.horizonBuildCount, 3,
    "single-slot trajectory changes must invalidate the shared field");
});
