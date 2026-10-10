"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { PossibleProjectileTracker } =
  require("../../engine-v2/src/runtime/possible-projectiles");
const { POSSIBLE_SETUP_STATUS, POSSIBLE_SETUP_REASON,
  PossibleProjectileAttackSetupClosure } =
  require("../../engine-v2/src/search/possible-projectile-attack-setup-closure");

function fixture() {
  const map = boxedMap(8, 7);
  const own = tank(0, [1, 3], "up");
  const enemy = tank(1, [3, 3], "up", {
    frozenUntilFrame: 10,
    skillReadyFrame: 255
  });
  const built = fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [own, enemy]
  }));
  return {
    built,
    ourActions: new Uint8Array([fast.ACTION.TURN_RIGHT]),
    ourArguments: new Uint16Array([fast.NONE_CELL]),
    enemyActions: new Uint8Array([fast.ACTION.NONE]),
    enemyArguments: new Uint16Array([fast.NONE_CELL])
  };
}

function identity(state) {
  return [state.hashLo, state.hashHi, state.deltaUsed, state.eventUsed,
    state.transitionDeltaBase, state.transitionEventBase];
}

function trackerAt(f, x, y, direction) {
  const tracker = new PossibleProjectileTracker();
  tracker.reset(0);
  tracker.addFired(f.built.state, f.built.state.cell(x, y), direction,
    0, 0, fast.NONE_CELL, 5000);
  return tracker;
}

test("possible-projectile setup closure certifies one common TURN then FIRE policy", () => {
  const f = fixture(); const before = identity(f.built.state);
  const possible = trackerAt(f, 1, 1, fast.DIRECTION.RIGHT);
  const closure = new PossibleProjectileAttackSetupClosure(4);
  closure.reset(1);
  assert.equal(closure.evaluateRow(f.built, 0, f.ourActions, f.ourArguments,
    f.enemyActions, f.enemyArguments, 1, possible, 1), 1);
  assert.equal(closure.status[0], POSSIBLE_SETUP_STATUS.ROBUST_CERTIFIED);
  assert.ok(closure.presentRootBranches[0] > 0);
  assert.ok(closure.presentSecondBranches[0] > 0);
  assert.ok(closure.presentDoomedColumns[0] > 0);
  assert.deepEqual(identity(f.built.state), before);
  assert.equal(closure.rootRestoreFailures, 0);
  assert.equal(closure.hotAllocationCount, 0);
});

test("possible-projectile setup closure rejects a present world that kills the setup", () => {
  const f = fixture(); const possible = trackerAt(f, 3, 3, fast.DIRECTION.LEFT);
  const closure = new PossibleProjectileAttackSetupClosure(4); closure.reset(1);
  assert.equal(closure.evaluateRow(f.built, 0, f.ourActions, f.ourArguments,
    f.enemyActions, f.enemyArguments, 1, possible, 1), 0);
  assert.equal(closure.status[0], POSSIBLE_SETUP_STATUS.REJECTED);
  assert.ok(closure.reason[0] & POSSIBLE_SETUP_REASON.PRESENT_WORLD_REJECTED);
});

test("possible-projectile setup closure fails closed on incomplete capability support", () => {
  const f = fixture(); const possible = trackerAt(f, 1, 1, fast.DIRECTION.RIGHT);
  const closure = new PossibleProjectileAttackSetupClosure(4); closure.reset(1);
  assert.equal(closure.evaluateRow(f.built, 0, f.ourActions, f.ourArguments,
    f.enemyActions, f.enemyArguments, 1, possible, 0), 0);
  assert.equal(closure.status[0], POSSIBLE_SETUP_STATUS.INCOMPLETE);
  assert.ok(closure.reason[0] & POSSIBLE_SETUP_REASON.SUPPORT);
});

test("possible-projectile setup closure does not collapse multiple tracks", () => {
  const f = fixture(); const possible = trackerAt(f, 1, 1, fast.DIRECTION.RIGHT);
  possible.addFired(f.built.state, f.built.state.cell(1, 2), fast.DIRECTION.RIGHT,
    0, 0, fast.NONE_CELL, 5000);
  const closure = new PossibleProjectileAttackSetupClosure(4); closure.reset(1);
  assert.equal(closure.evaluateRow(f.built, 0, f.ourActions, f.ourArguments,
    f.enemyActions, f.enemyArguments, 1, possible, 1), 0);
  assert.equal(closure.status[0], POSSIBLE_SETUP_STATUS.INCOMPLETE);
  assert.ok(closure.reason[0] & POSSIBLE_SETUP_REASON.PROJECTILE_COUNT);
});

test("possible-projectile closure reconstructs observed poison phase only inside its world", () => {
  const f = fixture(); const a = f.built.state.arrays;
  a[fast.ARRAY.SCALAR][fast.SCALAR.FRAME] = 2;
  a[fast.ARRAY.SCALAR][fast.SCALAR.RECORD] = 2;
  a[fast.ARRAY.TANK_FROZEN_UNTIL][1] = fast.NONE_FRAME;
  a[fast.ARRAY.TANK_POISON_APPLIED][1] = 0;
  a[fast.ARRAY.TANK_POISON_UNTIL][1] = 6;
  f.built.state.initializeHash();
  const before = identity(f.built.state);
  const possible = trackerAt(f, 1, 1, fast.DIRECTION.RIGHT);
  const closure = new PossibleProjectileAttackSetupClosure(4); closure.reset(1);
  const result = closure.evaluateRow(f.built, 0, f.ourActions, f.ourArguments,
    f.enemyActions, f.enemyArguments, 1, possible, 1, 1, 0);
  assert.equal(result, 0, JSON.stringify({ status: closure.status[0],
    reason: closure.reason[0], root: closure.presentRootBranches[0],
    second: closure.presentSecondBranches[0], doomed: closure.presentDoomedColumns[0],
    constrained: closure.presentConstrainedColumns[0],
    uncovered: closure.presentUncoveredColumns[0] }));
  assert.equal(closure.status[0], POSSIBLE_SETUP_STATUS.REJECTED);
  assert.ok(closure.reason[0] & POSSIBLE_SETUP_REASON.PRESENT_WORLD_REJECTED);
  assert.equal(closure.cadenceRephaseCount, 1);
  assert.deepEqual(identity(f.built.state), before);
  assert.equal(a[fast.ARRAY.TANK_POISON_APPLIED][1], 0);
  assert.equal(closure.rootRestoreFailures, 0);
});
