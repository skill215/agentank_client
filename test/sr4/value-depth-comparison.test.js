"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { SAFETY_STATUS, SafetyOutcomeSlab } =
  require("../../engine-v2/src/search/information-safety-closure");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { ProductionDepthSearch } =
  require("../../engine-v2/src/search/production-depth-search");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");

function searchStub(scores) {
  return {
    completedDepth: 1,
    rootScore: Int32Array.from(scores),
    rootCellScore: new Int32Array(scores.length * 8)
  };
}

function deathSafety(count, horizon = 2500, slack = -1) {
  const safety = new SafetyOutcomeSlab();
  safety.reset(count);
  for (let row = 0; row < count; row += 1) {
    safety.status[row] = SAFETY_STATUS.POSSIBLE_DEATH;
    safety.coverage[row] = 10000;
    safety.escapeSlack[row] = slack;
    safety.earliestFatalFrame[row] = 3;
    safety.futureFireStrategyApplied[row] = 1;
    safety.addFutureFire(row, 3, horizon);
  }
  return safety;
}

test("SR4 under death pressure search signal outranks tactical aggression", () => {
  const controller = new RiskAcceptanceController();
  const safety = deathSafety(2);
  // GO has worse Information score but much better tactical; TURN is the escape.
  const tactical = new Int16Array([900, -1000]);
  const search = searchStub([-600, -300]);
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, tactical, null, search, 1, null, 2, actions);
  controller.gate(100, 0);
  assert.ok(controller.outcome.robustLower[1] > controller.outcome.robustLower[0],
    "TURN search-only robust must beat GO under death pressure");
  assert.equal(controller.outcome.dominated[1], 0);
  assert.equal(controller.select(0), 1,
    "value-depth must select the better search escape, not the tactical bait");
});

test("SR4 under death pressure FIRE does not dominate equal-search TURN", () => {
  const controller = new RiskAcceptanceController();
  const safety = deathSafety(2);
  const tactical = new Int16Array([800, 700]);
  const search = searchStub([7000, 7000]);
  const actions = new Uint8Array([ACTION.FIRE, ACTION.TURN_LEFT]);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, tactical, null, search, 1, null, 2, actions);
  controller.gate(100, 0);
  assert.equal(controller.outcome.robustLower[0], controller.outcome.robustLower[1]);
  assert.equal(controller.outcome.dominated[1], 0,
    "tactical edge alone must not dominate TURN when search robust is tied");
  assert.equal(controller.outcome.dominated[0], 0);
  assert.equal(controller.select(0), 1,
    "tied search under death pressure must prefer TURN mobility over FIRE");
});

test("SR4 near-tied robust cannot let FIRE outrank escape-class TURN", () => {
  const controller = new RiskAcceptanceController();
  const safety = deathSafety(2);
  const tactical = new Int16Array([100, 700]);
  // FIRE has a tiny search edge — not enough to beat TURN under slack.
  const search = searchStub([7040, 7000]);
  const actions = new Uint8Array([ACTION.FIRE, ACTION.TURN_LEFT]);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, tactical, null, search, 1, null, 2, actions);
  controller.gate(100, 0);
  assert.equal(controller.outcome.dominated[1], 0);
  assert.equal(controller.select(0), 1);
});

test("SR4 near-tied robust keeps GO undominated versus TURN", () => {
  const controller = new RiskAcceptanceController();
  const safety = deathSafety(2);
  const tactical = new Int16Array([1600, -3000]);
  // Near-tied search: after /2, robust gap is below ESCAPE_ROBUST_SLACK.
  const search = searchStub([-3200, -3150]);
  const actions = new Uint8Array([ACTION.GO, ACTION.TURN_RIGHT]);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, tactical, null, search, 1, null, 2, actions);
  controller.gate(100, 0);
  assert.equal(controller.outcome.dominated[0], 0,
    "GO must not be value-dominated by a near-tied TURN robust");
  assert.equal(controller.select(0), 0,
    "within slack, higher expected GO must beat TURN");
});

test("SR4 without death pressure keeps blended tactical+search robust", () => {
  const controller = new RiskAcceptanceController();
  const safety = new SafetyOutcomeSlab();
  safety.reset(2);
  for (let row = 0; row < 2; row += 1) {
    safety.status[row] = SAFETY_STATUS.PROVEN_SAFE;
    safety.coverage[row] = 10000; safety.escapeSlack[row] = 2;
  }
  const tactical = new Int16Array([900, -1000]);
  const search = searchStub([-600, -300]);
  controller.populate(2, new Uint8Array([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    safety, tactical, null, search, 1, null, 2,
    new Uint8Array([ACTION.GO, ACTION.TURN_LEFT]));
  assert.ok(controller.outcome.robustLower[0] > controller.outcome.robustLower[1],
    "safe rows still blend tactical when Safety shows no death pressure");
});

test("SR4 proximity leaf prefers facing away from a close enemy", () => {
  const { ProductionInformationSearch } =
    require("../../engine-v2/src/search/production-information-search");
  const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
  const depth = new ProductionDepthSearch(new ProductionCacheBank());
  const info = new ProductionInformationSearch();
  const state = {
    arrays: [],
    x(cell) { return cell & 15; },
    y(cell) { return cell >> 4; },
    cell(x, y) { return (y << 4) | x; }
  };
  const terrain = new Uint8Array(256);
  const tankCell = new Uint16Array([state.cell(5, 5), state.cell(5, 7)]);
  const tankDir = new Uint8Array([2, 0]);
  const tankStars = new Int16Array([1, 1]);
  const tankSkill = new Uint16Array([0xffff, 0xffff]);
  const scalar = new Uint16Array(32);
  scalar[SCALAR.STAR_CELL] = NONE_CELL;
  scalar[SCALAR.FRAME] = 10;
  state.arrays[ARRAY.TERRAIN] = terrain;
  state.arrays[ARRAY.TANK_CELL] = tankCell;
  state.arrays[ARRAY.TANK_DIR] = tankDir;
  state.arrays[ARRAY.TANK_STARS] = tankStars;
  state.arrays[ARRAY.TANK_SKILL_READY] = tankSkill;
  state.arrays[ARRAY.SCALAR] = scalar;
  depth.clearLine = () => 1;
  depth.mobility = () => 2;
  const toward = info.adjustShallowLeaf(depth, state, depth.heuristic(state));
  tankDir[0] = 0;
  const away = info.adjustShallowLeaf(depth, state, depth.heuristic(state));
  assert.ok(away > toward, "facing away must outrank facing into proximity threat");
});
