"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ACTION, FAST_STATUS, NONE_CELL } =
  require("../../engine-v2/src/abi/fast-codes");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const reference = require("../../engine-v2/src/reference");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

function state(tanks) {
  const built = fast.createFastPhysical(physical({
    platformFrame: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks,
    star: null
  }));
  assert.equal(built.status, FAST_STATUS.APPLIED);
  return built;
}

function applyAndVerifyRestore(built, action0, action1) {
  const signature = built.state.rootSignature();
  const status = built.kernel.applyFrame(action0, NONE_CELL, action1, NONE_CELL);
  assert.equal(built.state.rootSignature(), signature,
    "unsupported movement must transactionally restore the root");
  return status;
}

test("HP23 stationary occupied-cell GO is a confirmed no-effect block", () => {
  const occupied = state([
    tank(0, [2, 2], "right", { skillReadyFrame: 255 }),
    tank(1, [3, 2], "left", { skillReadyFrame: 255 })
  ]);
  const occupiedRoot = occupied.state.rootSignature();
  assert.equal(occupied.kernel.applyFrame(ACTION.GO, NONE_CELL,
    ACTION.NONE, NONE_CELL), FAST_STATUS.APPLIED);
  assert.equal(occupied.state.arrays[ARRAY.TANK_CELL][0],
    occupied.state.cell(2, 2));
  occupied.state.undoTo(occupied.kernel.lastMark);
  assert.equal(occupied.state.rootSignature(), occupiedRoot);

  const enemyMovesIntoOccupied = state([
    tank(0, [2, 2], "up", { skillReadyFrame: 255 }),
    tank(1, [3, 2], "left", { skillReadyFrame: 255 })
  ]);
  const enemyRoot = enemyMovesIntoOccupied.state.rootSignature();
  assert.equal(enemyMovesIntoOccupied.kernel.applyFrame(ACTION.TURN_RIGHT, NONE_CELL,
    ACTION.GO, NONE_CELL), FAST_STATUS.APPLIED);
  assert.equal(enemyMovesIntoOccupied.state.arrays[ARRAY.TANK_CELL][1],
    enemyMovesIntoOccupied.state.cell(3, 2));
  enemyMovesIntoOccupied.state.undoTo(enemyMovesIntoOccupied.kernel.lastMark);
  assert.equal(enemyMovesIntoOccupied.state.rootSignature(), enemyRoot);

  const swap = state([
    tank(0, [2, 2], "right", { skillReadyFrame: 255 }),
    tank(1, [3, 2], "left", { skillReadyFrame: 255 })
  ]);
  assert.equal(applyAndVerifyRestore(swap, ACTION.GO, ACTION.GO),
    FAST_STATUS.UNSUPPORTED_RULE);
});

test("HP23 legacy diagnostic switch reproduces unsupported static occupancy", () => {
  const built = fast.createFastPhysical(physical({
    platformFrame: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks: [tank(0, [2, 2], "right"), tank(1, [3, 2], "up")]
  }), { stationaryOccupiedBlock: false });
  assert.equal(applyAndVerifyRestore(built, ACTION.GO, ACTION.FIRE),
    FAST_STATUS.UNSUPPORTED_RULE);
});

function referenceContext() {
  return reference.createRuleContext(reference.loadRuleCorpus(path.resolve(__dirname, "../..")));
}

function referenceTank(seat, cell, direction, command) {
  return { seat, cell, direction, runtimeMs: 0, queue: command ?
    [{ command, eligibleAtFrame: 4 }] : [] };
}

test("HP23 Reference and Fast agree on stationary occupied blocking without a variant", () => {
  const context = referenceContext(); const kernel = new reference.ReferenceKernel(context);
  const spec = {
    platformFrame: 4,
    recordIndex: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks: [referenceTank(0, [2, 2], "right", "GO"),
      referenceTank(1, [3, 2], "up", "FIRE")],
    projectiles: [], bombs: [], star: null
  };
  const parent = reference.createPhysicalState(spec, context);
  const result = kernel.advanceFrame(parent);
  assert.equal(result.status, "REFERENCE_OK");
  assert.deepEqual(result.childState.tanks.map(value => value.cell), [[2, 2], [3, 2]]);
  assert.equal(result.orderedEvents.some(event => event.eventType === "TANK_MOVED" &&
    event.actorSeat === 0), false);

  const built = fast.createFastPhysical(physical({ platformFrame: 4, recordIndex: 4,
    map: spec.map, tanks: [tank(0, [2, 2], "right"), tank(1, [3, 2], "up")] }));
  assert.equal(built.kernel.applyFrame(ACTION.GO, NONE_CELL,
    ACTION.FIRE, NONE_CELL), FAST_STATUS.APPLIED);
  assert.equal(built.state.arrays[ARRAY.TANK_CELL][0], built.state.cell(2, 2));
  assert.equal(built.state.arrays[ARRAY.TANK_CELL][1], built.state.cell(3, 2));
});

test("HP23 unresolved GO/GO contest remains unsupported in Reference and Fast", () => {
  const context = referenceContext(); const kernel = new reference.ReferenceKernel(context);
  const spec = {
    platformFrame: 4,
    recordIndex: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks: [referenceTank(0, [2, 2], "right", "GO"),
      referenceTank(1, [4, 2], "left", "GO")],
    projectiles: [], bombs: [], star: null
  };
  assert.equal(kernel.advanceFrame(reference.createPhysicalState(spec, context)).status,
    "REFERENCE_VARIANT_REQUIRED");
  const built = fast.createFastPhysical(physical({ platformFrame: 4, recordIndex: 4,
    map: spec.map, tanks: [tank(0, [2, 2], "right"), tank(1, [4, 2], "left")] }));
  assert.equal(applyAndVerifyRestore(built, ACTION.GO, ACTION.GO),
    FAST_STATUS.UNSUPPORTED_RULE);
});

test("HP22 same-target GO contest stays unsupported while non-GO control applies", () => {
  const contest = state([
    tank(0, [2, 2], "right", { skillReadyFrame: 255 }),
    tank(1, [4, 2], "left", { skillReadyFrame: 255 })
  ]);
  assert.equal(applyAndVerifyRestore(contest, ACTION.GO, ACTION.GO),
    FAST_STATUS.UNSUPPORTED_RULE);

  const control = state([
    tank(0, [2, 2], "right", { skillReadyFrame: 255 }),
    tank(1, [4, 2], "left", { skillReadyFrame: 255 })
  ]);
  const signature = control.state.rootSignature();
  assert.equal(control.kernel.applyFrame(ACTION.TURN_LEFT, NONE_CELL,
    ACTION.TURN_RIGHT, NONE_CELL), FAST_STATUS.APPLIED);
  control.state.undoTo(control.kernel.lastMark);
  assert.equal(control.state.rootSignature(), signature);
});
