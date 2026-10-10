"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ACTION, FAST_STATUS, NONE_CELL, CHANCE } =
  require("../../engine-v2/src/abi/fast-codes");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const reference = require("../../engine-v2/src/reference");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

function fastState(tanks, map = boxedMap(7, 7)) {
  const built = fast.createFastPhysical(physical({ platformFrame: 4,
    map: { width: 7, height: 7, terrainColumnMajor: map }, tanks, star: null }));
  assert.equal(built.status, FAST_STATUS.APPLIED);
  return built;
}

function referenceContext() {
  return reference.createRuleContext(reference.loadRuleCorpus(path.resolve(__dirname, "../..")));
}

function referenceTank(seat, cell, direction) {
  return { seat, cell, direction, runtimeMs: 0,
    queue: [{ command: "GO", eligibleAtFrame: 4 }] };
}

test("confirmed joint GO lets seat0 follow into the cell seat1 vacates", () => {
  const built = fastState([
    tank(0, [2, 2], "right", { skillReadyFrame: 255 }),
    tank(1, [3, 2], "down", { skillReadyFrame: 255 })
  ]);
  const root = built.state.rootSignature();
  assert.equal(built.kernel.applyFrame(ACTION.GO, NONE_CELL,
    ACTION.GO, NONE_CELL), FAST_STATUS.APPLIED);
  assert.deepEqual(Array.from(built.state.arrays[ARRAY.TANK_CELL]),
    [built.state.cell(3, 2), built.state.cell(3, 3)]);
  built.state.undoTo(built.kernel.lastMark);
  assert.equal(built.state.rootSignature(), root);

  const context = referenceContext(); const kernel = new reference.ReferenceKernel(context);
  const state = reference.createPhysicalState({ platformFrame: 4, recordIndex: 4,
    map: { width: 7, height: 7, terrainColumnMajor: boxedMap(7, 7) },
    tanks: [referenceTank(0, [2, 2], "right"), referenceTank(1, [3, 2], "down")]
  }, context);
  const result = kernel.advanceFrame(state);
  assert.equal(result.status, "REFERENCE_OK");
  assert.deepEqual(result.childState.tanks.map(value => value.cell), [[3, 2], [3, 3]]);
});

test("confirmed joint GO also preserves the seat1 follows-seat0 case", () => {
  const built = fastState([
    tank(0, [2, 2], "down", { skillReadyFrame: 255 }),
    tank(1, [3, 2], "left", { skillReadyFrame: 255 })
  ]);
  assert.equal(built.kernel.applyFrame(ACTION.GO, NONE_CELL,
    ACTION.GO, NONE_CELL), FAST_STATUS.APPLIED);
  assert.deepEqual(Array.from(built.state.arrays[ARRAY.TANK_CELL]),
    [built.state.cell(2, 3), built.state.cell(2, 2)]);
});

test("swap, same-target, blocked-vacate and uncertain effects still fail closed", () => {
  const cases = [
    fastState([tank(0, [2, 2], "right"), tank(1, [3, 2], "left")]),
    fastState([tank(0, [2, 2], "right"), tank(1, [4, 2], "left")]),
    (() => { const map = boxedMap(7, 7); map[4][2] = "m";
      return fastState([tank(0, [2, 2], "right"), tank(1, [3, 2], "right")], map); })(),
    fastState([tank(0, [2, 2], "right"),
      tank(1, [3, 2], "down", { stunUntilFrame: 8 })])
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const built = cases[index]; const root = built.state.rootSignature();
    const status = built.kernel.applyFrame(ACTION.GO, NONE_CELL, ACTION.GO, NONE_CELL,
      CHANCE.NORMAL, CHANCE.NORMAL);
    assert.equal(status, FAST_STATUS.UNSUPPORTED_RULE, `case=${index}`);
    assert.equal(built.state.rootSignature(), root, `restore case=${index}`);
  }
});
