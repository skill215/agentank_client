"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { TWO_STAGE_SETUP_STATUS, TWO_STAGE_SETUP_REASON,
  TwoStageAttackSetupShadow } =
  require("../../engine-v2/src/search/two-stage-attack-setup-shadow");

function fixture(overrides = {}) {
  const map = boxedMap(8, 7);
  const own = tank(0, [1, 3], "up", overrides.own || {});
  const enemy = tank(1, [3, 3], "up", {
    frozenUntilFrame: 10,
    skillReadyFrame: 255,
    ...(overrides.enemy || {})
  });
  const built = fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [own, enemy],
    star: overrides.star || null
  }));
  const ourActions = new Uint8Array([fast.ACTION.TURN_RIGHT]);
  const ourArguments = new Uint16Array([fast.NONE_CELL]);
  const enemyActions = new Uint8Array([fast.ACTION.NONE]);
  const enemyArguments = new Uint16Array([fast.NONE_CELL]);
  return { built, ourActions, ourArguments, enemyActions, enemyArguments };
}

function rootIdentity(state) {
  return [state.hashLo, state.hashHi, state.deltaUsed, state.eventUsed,
    state.arrays[fast.ARRAY.SCALAR][fast.SCALAR.FRAME]];
}

test("two-stage Shadow certifies TURN then FIRE across complete frozen response support", () => {
  const f = fixture(); const before = rootIdentity(f.built.state);
  const closure = new TwoStageAttackSetupShadow(4);
  closure.reset(1);
  assert.equal(closure.evaluateCandidate(f.built, 0, OPTION_KIND.ATTACK_SETUP,
    f.ourActions, f.ourArguments, f.enemyActions, f.enemyArguments, 1), 1);
  assert.equal(closure.status[0], TWO_STAGE_SETUP_STATUS.CERTIFIED);
  assert.ok(closure.rootBranches[0] > 0);
  assert.ok(closure.secondBranches[0] > 0);
  assert.ok(closure.doomedColumns[0] > 0);
  assert.equal(closure.uncoveredColumns[0], 0);
  assert.deepEqual(rootIdentity(f.built.state), before);
  assert.equal(closure.rootRestoreFailures, 0);
  assert.equal(closure.hotAllocationCount, 0);
});

test("two-stage Shadow rejects a setup when FIRE is locked in the successor", () => {
  const f = fixture({ own: { fireLockUntilFrame: 10 } });
  const closure = new TwoStageAttackSetupShadow(4); closure.reset(1);
  assert.equal(closure.evaluateCandidate(f.built, 0, OPTION_KIND.ATTACK_SETUP,
    f.ourActions, f.ourArguments, f.enemyActions, f.enemyArguments, 1), 0);
  assert.equal(closure.status[0], TWO_STAGE_SETUP_STATUS.REJECTED);
  assert.ok(closure.reason[0] & TWO_STAGE_SETUP_REASON.NO_SECOND_FIRE);
});

test("two-stage Shadow fails closed on teleport survival support", () => {
  const f = fixture({ enemy: { frozenUntilFrame: null, skillId: "teleport",
    skillReadyFrame: 0 }, star: [5, 3] });
  const closure = new TwoStageAttackSetupShadow(4); closure.reset(1);
  assert.equal(closure.evaluateCandidate(f.built, 0, OPTION_KIND.ATTACK_SETUP,
    f.ourActions, f.ourArguments, f.enemyActions, f.enemyArguments, 1), 0);
  assert.equal(closure.status[0], TWO_STAGE_SETUP_STATUS.INCOMPLETE);
  assert.ok(closure.reason[0] & TWO_STAGE_SETUP_REASON.PAC_INCOMPLETE);
});

test("two-stage Shadow marks budget exhaustion incomplete and restores the root", () => {
  const f = fixture(); const before = rootIdentity(f.built.state);
  const closure = new TwoStageAttackSetupShadow(4, 1); closure.reset(1);
  assert.equal(closure.evaluateCandidate(f.built, 0, OPTION_KIND.ATTACK_SETUP,
    f.ourActions, f.ourArguments, f.enemyActions, f.enemyArguments, 1), 0);
  assert.equal(closure.status[0], TWO_STAGE_SETUP_STATUS.INCOMPLETE);
  assert.ok(closure.reason[0] & TWO_STAGE_SETUP_REASON.BUDGET);
  assert.deepEqual(rootIdentity(f.built.state), before);
});

test("two-stage Shadow ignores FIRE and strategic Options instead of claiming support", () => {
  const f = fixture(); f.ourActions[0] = fast.ACTION.FIRE;
  const closure = new TwoStageAttackSetupShadow(4); closure.reset(1);
  assert.equal(closure.evaluateCandidate(f.built, 0, OPTION_KIND.ATTACK_SETUP,
    f.ourActions, f.ourArguments, f.enemyActions, f.enemyArguments, 1), 0);
  assert.equal(closure.status[0], TWO_STAGE_SETUP_STATUS.NONE);
  assert.ok(closure.reason[0] & TWO_STAGE_SETUP_REASON.NOT_SETUP_MOVE);
});

