"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_FRAME } = require("../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE } = require("../../engine-v2/src/runtime/root-control-mode");
const { AttackObjectiveFieldProposal } = require(
  "../../tools/agentank/diagnostics/attack-objective-field");

function fixture() {
  const width = 5; const height = 5; const cells = width * height;
  const arrays = [];
  arrays[ARRAY.TERRAIN] = new Uint8Array(cells);
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([0, 4]);
  arrays[ARRAY.TANK_DIR] = Uint8Array.from([2, 0]);
  arrays[ARRAY.TANK_FIRE_LOCK] = Uint16Array.from([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.TANK_STARS] = Uint8Array.from([0, 0]);
  arrays[ARRAY.TANK_SHIELD_HITS] = Uint8Array.from([0, 0]);
  arrays[ARRAY.SCALAR] = new Uint32Array(32);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION] = 1;
  const state = { width, height, cells, arrays,
    x(cell) { return cell % width; },
    y(cell) { return (cell / width) | 0; },
    cell(x, y) { return y * width + x; } };
  const outcome = {
    acceptable: Uint8Array.from([1, 1, 1]),
    dominated: Uint8Array.from([0, 0, 0]),
    immediateFatalMass: Uint16Array.from([0, 0, 0]),
    horizonFatalMass: Uint16Array.from([0, 0, 0]),
    unknownMass: Uint16Array.from([0, 0, 0]),
    earliestFatalFrame: Uint8Array.from([255, 255, 255]),
    escapeSlack: Int8Array.from([0, 0, 0]),
    robustLower: Int32Array.from([100, 100, 100]),
    expectedValue: Int32Array.from([100, 100, 100])
  };
  return {
    lastControlMode: ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION,
    adapter: { state, enemyVisible: true, enemyCanAct: true },
    escapeObligation: { supportStatus: 0 },
    ourActions: Uint8Array.from([ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    projectedCell: Uint16Array.from([5, 0, 0]),
    projectedDirection: Uint8Array.from([2, 1, 3]),
    riskController: { outcome },
    directionTo(from, to) {
      const fx = state.x(from); const fy = state.y(from);
      const tx = state.x(to); const ty = state.y(to);
      if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
      if (fy === ty) return tx > fx ? 1 : 3;
      return -1;
    },
    clearLine(from, to) { return this.directionTo(from, to) >= 0; }
  };
}

test("attack objective field proposes strict pose-cost progress", () => {
  const engine = fixture();
  const objective = new AttackObjectiveFieldProposal();
  assert.equal(objective.evaluate(engine, 0, 3), 1);
  const summary = objective.summary();
  assert.equal(summary.fieldBuildCount, 1);
  assert.equal(summary.progressRootCount, 1);
  assert.equal(summary.noRegressionDifferentCount, 1);
  assert.equal(summary.lastCurrentCost, 1);
  assert.equal(summary.lastProposalCost, 0);
  assert.equal(summary.hotAllocationCount, 0);
});

test("attack objective field cache is generation-bound", () => {
  const engine = fixture();
  const objective = new AttackObjectiveFieldProposal();
  objective.evaluate(engine, 0, 3);
  objective.evaluate(engine, 0, 3);
  assert.equal(objective.summary().fieldBuildCount, 1);
  assert.equal(objective.summary().cacheHitCount, 1);
  engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION] += 1;
  objective.evaluate(engine, 0, 3);
  assert.equal(objective.summary().fieldBuildCount, 2);
});

test("attack objective field cache follows every initiative input", () => {
  const engine = fixture();
  const objective = new AttackObjectiveFieldProposal();
  const arrays = engine.adapter.state.arrays;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_DIR][1] = 1;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_FIRE_LOCK][1] = 13;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  objective.evaluate(engine, 0, 3);
  engine.adapter.enemyCanAct = false;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_STARS][0] = 1;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_STARS][1] = 1;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_SHIELD_HITS][0] = 1;
  objective.evaluate(engine, 0, 3);
  arrays[ARRAY.TANK_SHIELD_HITS][1] = 1;
  objective.evaluate(engine, 0, 3);
  assert.equal(objective.summary().fieldBuildCount, 9);
  objective.evaluate(engine, 0, 3);
  assert.equal(objective.summary().cacheHitCount, 1);
});

test("strategic attack progress yields to committed escape", () => {
  const engine = fixture();
  engine.escapeObligation.supportStatus = 1;
  const objective = new AttackObjectiveFieldProposal({ active: true });
  assert.equal(objective.evaluate(engine, 0, 3), -1);
  assert.equal(objective.summary().fieldBuildCount, 0);
});

test("an owned ATTACK target reuses the pose field outside navigation mode", () => {
  const engine = fixture();
  engine.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  const objective = new AttackObjectiveFieldProposal();
  assert.equal(objective.evaluate(engine, 0, 3), -1);
  assert.equal(objective.evaluateOwnedTarget(engine, 0, 3), 1);
  assert.equal(objective.summary().fieldBuildCount, 1);
});

test("owned-target safety comparison does not restore the old robust value owner", () => {
  const engine = fixture();
  engine.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
  engine.riskController.outcome.robustLower[1] = 99;
  const objective = new AttackObjectiveFieldProposal();
  assert.equal(objective.evaluateOwnedTarget(engine, 0, 3), 1);
  assert.equal(objective.evaluate(engine, 0, 3), -1);
});
