"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { PLAN_KIND, PLAN_PURPOSE, NONE_HANDLE } =
  require("../../engine-v2/src/abi/policy-codes");
const { RESPONSE_OPTION_KIND, RESPONSE_OPTION_REASON, ResponseOptionController } =
  require("../../engine-v2/src/policy/response-option-controller");

function fixture() {
  const count = 5;
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint16Array(32);
  arrays[ARRAY.TANK_CELL] = new Uint16Array([6, 24]);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 8;
  const state = { arrays, width: 5, x: cell => cell % 5,
    y: cell => Math.floor(cell / 5) };
  const actions = new Uint8Array([ACTION.CAST_POISON, ACTION.GO,
    ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.FIRE]);
  const projectedCell = new Uint16Array([6, 7, 6, 6, 6]);
  const projectedDirection = new Uint8Array([1, 1, 0, 2, 1]);
  const handles = new Uint32Array(count).fill(NONE_HANDLE);
  handles[1] = 0; handles[2] = 1; handles[3] = 2;
  const sketches = { used: 3,
    kind: new Uint8Array([PLAN_KIND.NAVIGATION, PLAN_KIND.NAVIGATION,
      PLAN_KIND.NAVIGATION]),
    purpose: new Uint8Array([PLAN_PURPOSE.STAR_COLLECT,
      PLAN_PURPOSE.STAR_COLLECT, PLAN_PURPOSE.STAR_COLLECT]),
    deadline: new Uint16Array([18, 18, 18]),
    rawScore: new Int16Array([5000, 2000, 1000]) };
  const outcome = { count, acceptable: new Uint8Array(count).fill(1),
    dominated: new Uint8Array(count), unknownMass: new Uint16Array(count),
    horizonFatalMass: new Uint16Array(count), robustLower: new Int16Array(count),
    purposeCompleteness: new Uint16Array(count), postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count) };
  const controller = { outcome };
  return { state, actions, projectedCell, projectedDirection, handles, sketches,
    outcome, controller, envelope: null };
}

function select(owner, f, preferred = 0, committed = false) {
  return owner.select(preferred, committed, f.controller, f.actions,
    f.projectedCell, f.projectedDirection, f.handles, f.sketches, f.envelope, f.state);
}

test("response option stores a target and regenerates navigation after a skill interruption", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  assert.equal(owner.active, 1);
  assert.equal(owner.kind, RESPONSE_OPTION_KIND.STAR);
  assert.equal(select(owner, f), 1);
  assert.equal(owner.lastReason, RESPONSE_OPTION_REASON.CONTINUE_STAR);
  assert.equal(owner.skillOverrideCount, 1);
  assert.equal(owner.hotAllocationCount, 0);
});

test("committed rescue remains above an active response option", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  assert.equal(select(owner, f, 0, true), 0);
  assert.equal(owner.committedYieldCount, 1);
});

test("verified attack remains above an active response option", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  f.outcome.purposeCompleteness[4] = 9000;
  f.outcome.postFireEscape[4] = 1;
  assert.equal(select(owner, f, 4), 4);
  assert.equal(owner.attackYieldCount, 1);
});

test("risk and Pareto membership cannot be restored by an option", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  f.outcome.acceptable[1] = 0;
  f.outcome.acceptable[2] = 0;
  f.outcome.acceptable[3] = 0;
  assert.equal(select(owner, f), 0);
  assert.equal(owner.noResponseCount, 1);
});

test("a changed star generation ends the old objective", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  f.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 9;
  assert.equal(select(owner, f), 0);
  assert.equal(owner.active, 0);
  assert.equal(owner.targetCell, NONE_CELL);
  assert.equal(owner.targetGoneCount, 1);
});

test("generic reposition cannot masquerade as a cross-frame contact objective", () => {
  const f = fixture();
  const owner = new ResponseOptionController().configure(true);
  f.sketches.purpose[0] = PLAN_PURPOSE.REPOSITION;
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  assert.equal(owner.active, 0);
  f.sketches.purpose[0] = PLAN_PURPOSE.INTERCEPT;
  owner.observeSelection(1, false, f.actions, f.handles, f.sketches, f.state);
  assert.equal(owner.active, 1);
  assert.equal(owner.kind, RESPONSE_OPTION_KIND.CONTACT);
});
