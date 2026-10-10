"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { POST_FIRE_STATUS, AIM_SETUP_STATUS, AIM_ACTIVE_MODE, HorizonSurvivalSearch,
  AimSetupPostFireClosureShadow } = require(
  "../../tools/agentank/diagnostics/aim-setup-post-fire-closure-shadow");

function fixture(overrides = {}) {
  const map = boxedMap(8, 7);
  const own = tank(0, overrides.ownPosition || [1, 3],
    overrides.ownDirection || "up", overrides.own || {});
  const enemy = tank(1, overrides.enemyPosition || [3, 3],
    overrides.enemyDirection || "up", {
      frozenUntilFrame: 10, skillReadyFrame: 255, ...(overrides.enemy || {})
    });
  return fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [own, enemy]
  }));
}

function identity(state) {
  return [state.hashLo, state.hashHi, state.deltaUsed, state.eventUsed,
    state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.FRAME]];
}

function engineFor(built) {
  const count = 4;
  return {
    adapter: { bundle: built, state: built.state,
      enemyVisible: true, tracker: { complete: true } },
    hiddenSupportComplete: 1, hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]),
    possibleProjectiles: { count: () => 0 },
    ourCount: count,
    ourActions: new Uint8Array([fast.ACTION.FIRE, fast.ACTION.TURN_RIGHT,
      fast.ACTION.GO, fast.ACTION.TURN_LEFT]),
    ourArguments: new Uint16Array(count).fill(fast.NONE_CELL),
    hardStatus: new Uint8Array(count).fill(fast.HARD_STATUS.ALLOW),
    projectedCell: new Uint16Array(count).fill(
      built.state.arrays[fast.ARRAY.TANK_CELL][0]),
    projectedDirection: new Uint8Array(count).fill(
      built.state.arrays[fast.ARRAY.TANK_DIR][0]),
    enemyCount: 1, enemyActions: new Uint8Array([fast.ACTION.NONE]),
    enemyArguments: new Uint16Array([fast.NONE_CELL]),
    combat: { vector: {
      directKill: new Uint8Array(count), possibleHit: new Uint8Array(count),
      intercept: new Uint8Array(count), aimSetup: new Uint8Array(count),
      enemyDoomedFirstActions: new Uint8Array(count)
    } },
    riskController: { outcome: {
      count, acceptable: new Uint8Array(count).fill(1),
      dominated: new Uint8Array(count), immediateFatalMass: new Uint16Array(count),
      horizonFatalMass: new Uint16Array(count), unknownMass: new Uint16Array(count),
      escapeSlack: new Int8Array(count), robustLower: new Int32Array(count),
      expectedValue: new Int32Array(count)
    } }
  };
}

test("finite survival closure keeps the exact FastState root and proves a quiet horizon", () => {
  const built = fixture(); const before = identity(built.state);
  const search = new HorizonSurvivalSearch();
  const result = search.searchExact(built, fast.ACTION.FIRE, fast.NONE_CELL,
    new Uint8Array([fast.ACTION.NONE]), new Uint16Array([fast.NONE_CELL]),
    1, 3, 1024);
  assert.equal(result, PROOF_STATUS.PROVEN);
  assert.equal(search.completedDepth, 3);
  assert.ok(search.nodes > 0);
  assert.deepEqual(identity(built.state), before);
  assert.equal(search.rootRestoreFailures, 0);
  assert.equal(search.hotAllocationCount, 0);
});

test("zero-signal FIRE finds a response-complete turn-to-ray proposal without owning it", () => {
  const built = fixture(); const before = identity(built.state);
  const engine = engineFor(built);
  engine.riskController.outcome.dominated[1] = 1;
  const shadow = new AimSetupPostFireClosureShadow({ postFireDepth: 3,
    postFireBudget: 1024, setupSafetyDepth: 2, setupSafetyBudget: 256 });
  shadow.observe(engine, 0, 7);
  assert.equal(shadow.lastPostFireStatus, POST_FIRE_STATUS.PROVEN_SAFE);
  assert.equal(shadow.lastAimStatus, AIM_SETUP_STATUS.PROPOSED);
  assert.equal(shadow.lastAimRow, 1);
  assert.equal(shadow.lastAimAction, fast.ACTION.TURN_RIGHT);
  assert.equal(shadow.lastAimDirectBranches, 1);
  assert.equal(shadow.lastAimTotalBranches, 1);
  assert.equal(shadow.lastAimSafetyStatus, POST_FIRE_STATUS.PROVEN_SAFE);
  assert.equal(shadow.lastAimRescue, 0);
  assert.equal(shadow.aimQualityProposalCount, 1);
  assert.equal(shadow.aimProposalDespiteStaticRiskCount, 0);
  assert.equal(shadow.aimDominatedSeenCount, 1);
  assert.deepEqual(identity(built.state), before);
  assert.equal(shadow.summary().rootRestoreFailures, 0);
  assert.equal(shadow.summary().hotAllocationCount, 0);
});

test("possible-projectile support remains UNKNOWN and cannot create an aim proposal", () => {
  const built = fixture(); const engine = engineFor(built);
  engine.possibleProjectiles = { count: () => 1 };
  const shadow = new AimSetupPostFireClosureShadow();
  shadow.observe(engine, 0, 9);
  assert.equal(shadow.lastPostFireStatus, POST_FIRE_STATUS.UNKNOWN);
  assert.equal(shadow.lastAimStatus, AIM_SETUP_STATUS.UNKNOWN);
  assert.equal(shadow.aimProposalCount, 0);
  assert.equal(shadow.supportSkipCount, 1);
});

test("long-range aim ownership preserves near FIRE and overrides only at distance five or more", () => {
  const nearBuilt = fixture(); const near = engineFor(nearBuilt);
  const nearShadow = new AimSetupPostFireClosureShadow({ postFireDepth: 3,
    postFireBudget: 1024, setupSafetyDepth: 2, setupSafetyBudget: 256 });
  assert.equal(nearShadow.selectOverride(near, 0, fast.ACTION.FIRE, fast.NONE_CELL,
    AIM_ACTIVE_MODE.LONG_RANGE_QUALITY, 1), null);
  assert.equal(nearShadow.lastAimStatus, AIM_SETUP_STATUS.PROPOSED);
  assert.equal(nearShadow.activeOverrideCount, 0);

  const farBuilt = fixture({ enemyPosition: [6, 3] }); const far = engineFor(farBuilt);
  const farShadow = new AimSetupPostFireClosureShadow({ postFireDepth: 3,
    postFireBudget: 1024, setupSafetyDepth: 2, setupSafetyBudget: 256 });
  const replacement = farShadow.selectOverride(far, 0, fast.ACTION.FIRE, fast.NONE_CELL,
    AIM_ACTIVE_MODE.LONG_RANGE_QUALITY, 1);
  assert.equal(replacement.action, fast.ACTION.TURN_RIGHT);
  assert.equal(farShadow.activeOverrideCount, 1);
  assert.equal(farShadow.activeQualityOverrideCount, 1);
  assert.equal(farShadow.summary().activeRecords[0].currentDistance, 5);
});

test("fast long-range ownership skips the four-frame FIRE closure", () => {
  const built = fixture({ enemyPosition: [6, 3] }); const engine = engineFor(built);
  const shadow = new AimSetupPostFireClosureShadow({ postFireDepth: 3,
    postFireBudget: 1024, setupSafetyDepth: 2, setupSafetyBudget: 256 });
  const replacement = shadow.selectOverride(engine, 0, fast.ACTION.FIRE, fast.NONE_CELL,
    AIM_ACTIVE_MODE.LONG_RANGE_QUALITY_FAST, 1);
  assert.equal(replacement.action, fast.ACTION.TURN_RIGHT);
  assert.equal(shadow.postFireEvaluationCount, 0);
  assert.equal(shadow.postFireNodeCount, 0);
  assert.equal(shadow.fastQualityTriggerCount, 1);
  assert.ok(shadow.setupNodeCount > 0);
});
