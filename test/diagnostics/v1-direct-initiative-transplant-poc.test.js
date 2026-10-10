"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { V1DirectInitiativeTransplantPoc } = require(
  "../../tools/agentank/diagnostics/v1-direct-initiative-transplant-poc");

function fixture() {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint16Array(8);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 7;
  arrays[ARRAY.TERRAIN] = new Uint8Array(25);
  arrays[ARRAY.TANK_CELL] = new Uint16Array([6, 9]);
  arrays[ARRAY.TANK_DIR] = new Uint8Array([0, 0]);
  arrays[ARRAY.TANK_STARS] = new Uint16Array([1, 0]);
  arrays[ARRAY.TANK_SHIELD_HITS] = new Uint8Array(2);
  arrays[ARRAY.TANK_SHIELD_UNTIL] = new Uint16Array([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.TANK_BOOST_UNTIL] = new Uint16Array([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.TANK_FIRE_LOCK] = new Uint16Array([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.PROJECTILE_ACTIVE] = new Uint8Array(8);
  arrays[ARRAY.PROJECTILE_OWNER] = new Uint8Array(8);
  const state = { arrays, width: 5, height: 5,
    x(cell) { return cell % 5; }, y(cell) { return Math.floor(cell / 5); },
    cell(x, y) { return y * 5 + x; } };
  const risk = { count: 4, acceptable: new Uint8Array(4).fill(1),
    dominated: new Uint8Array(4), immediateFatalMass: new Uint16Array(4),
    horizonFatalMass: new Uint16Array(4), unknownMass: new Uint16Array(4),
    escapeSlack: new Int8Array(4), robustLower: new Int32Array(4),
    expectedValue: new Int32Array(4) };
  return { adapter: { bundle: {}, enemyVisible: true, tracker: { complete: true }, state },
    hiddenSupportComplete: 1, hiddenWorldCount: 1,
    hiddenWorldMass: new Uint16Array([10000]), possibleProjectiles: { count() { return 0; } },
    enemyCount: 1, enemyActions: new Uint8Array([ACTION.GO]),
    enemyArguments: new Int16Array(1), ourCount: 4,
    ourActions: new Uint8Array([ACTION.GO, ACTION.TURN_LEFT,
      ACTION.TURN_RIGHT, ACTION.FIRE]), ourArguments: new Int16Array(4),
    hardStatus: new Uint8Array(4).fill(HARD_STATUS.ALLOW),
    riskController: { outcome: risk }, escapeObligation: { committedEntityCount: 0 },
    lastProofStatus: PROOF_STATUS.UNKNOWN, lastSelectionWasStrictRescue: 0,
    lastSelectionWasVerifiedDirectKill: 0 };
}

test("V1 direct initiative proposes the complete arrival-winning turn contract", () => {
  const engine = fixture(); const poc = new V1DirectInitiativeTransplantPoc();
  poc.search.searchExact = () => PROOF_STATUS.PROVEN;
  poc.search.nodes = 5; poc.search.rootRestoreFailures = 0;
  const result = poc.selectOverride(engine, 0, ACTION.GO, 0, null, 7);
  assert.deepEqual(result, { action: ACTION.TURN_RIGHT, argument: 0 });
  assert.equal(poc.overrideCount, 1);
  assert.equal(poc.turnOverrideCount, 1);
});

test("V1 direct initiative loses ownership on an unfavorable equal-star trade", () => {
  const engine = fixture(); engine.adapter.state.arrays[ARRAY.TANK_STARS][0] = 0;
  const poc = new V1DirectInitiativeTransplantPoc();
  const result = poc.selectOverride(engine, 0, ACTION.GO, 0, null, 7);
  assert.equal(result, null);
  assert.equal(poc.initiativeLostCount, 1);
  assert.equal(poc.overrideCount, 0);
});

test("committed danger stays ahead of the transplanted direct initiative", () => {
  const engine = fixture(); engine.escapeObligation.committedEntityCount = 1;
  const poc = new V1DirectInitiativeTransplantPoc();
  assert.equal(poc.selectOverride(engine, 0, ACTION.GO, 0, null, 7), null);
  assert.equal(poc.committedSkipCount, 1);
});
