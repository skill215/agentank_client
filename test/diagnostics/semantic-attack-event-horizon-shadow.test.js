"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { ACTION, DIRECTION } = require("../../engine-v2/src/abi/fast-codes");
const { SETTLEMENT } = require(
  "../../tools/agentank/diagnostics/native-tactical-domain-evaluator-poc");
const { EVENT_GOAL, fireEventStatus, pairRelation,
  SafeFireEventHorizonSearch, SemanticAttackEventHorizonShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-horizon-shadow");

test("BP139 possible-hit fire is a safe threat event, not a forced kill", () => {
  assert.equal(fireEventStatus(EVENT_GOAL.SAFE_THREAT_FIRE,
    SETTLEMENT.SURVIVES, SETTLEMENT.NONE), PROOF_STATUS.PROVEN);
  assert.equal(fireEventStatus(EVENT_GOAL.DOOMED_TARGET_FIRE,
    SETTLEMENT.SURVIVES, SETTLEMENT.NONE), PROOF_STATUS.DISPROVEN);
});

test("BP139 counter-death and incomplete settlement fail closed", () => {
  assert.equal(fireEventStatus(EVENT_GOAL.SAFE_THREAT_FIRE,
    SETTLEMENT.DOOMED, SETTLEMENT.DOOMED), PROOF_STATUS.DISPROVEN);
  assert.equal(fireEventStatus(EVENT_GOAL.SAFE_THREAT_FIRE,
    SETTLEMENT.UNKNOWN, SETTLEMENT.NONE), PROOF_STATUS.UNKNOWN);
  assert.equal(fireEventStatus(EVENT_GOAL.SAFE_THREAT_FIRE,
    SETTLEMENT.DOOMED, SETTLEMENT.UNKNOWN), PROOF_STATUS.UNKNOWN);
});

test("BP139 pair relation never promotes UNKNOWN to strict dominance", () => {
  assert.equal(pairRelation(PROOF_STATUS.DISPROVEN, PROOF_STATUS.PROVEN), 1);
  assert.equal(pairRelation(PROOF_STATUS.UNKNOWN, PROOF_STATUS.PROVEN), 0);
  assert.equal(pairRelation(PROOF_STATUS.PROVEN, PROOF_STATUS.UNKNOWN), 0);
  assert.equal(pairRelation(PROOF_STATUS.UNKNOWN, PROOF_STATUS.UNKNOWN), 0);
  assert.equal(pairRelation(PROOF_STATUS.PROVEN, PROOF_STATUS.DISPROVEN), 3);
});

test("BP139 fixed replanning policy reaches and fires on a clear ray", () => {
  const arrays = [];
  arrays[ARRAY.TANK_CELL] = new Uint16Array([0, 4]);
  arrays[ARRAY.TANK_DIR] = new Uint8Array([DIRECTION.RIGHT, DIRECTION.LEFT]);
  arrays[ARRAY.TERRAIN] = new Uint8Array(25);
  const state = { arrays, width: 5, height: 5, cells: 25,
    x: cell => cell % 5, y: cell => Math.floor(cell / 5),
    cell: (x, y) => y * 5 + x };
  const search = new SafeFireEventHorizonSearch(EVENT_GOAL.SAFE_THREAT_FIRE);
  assert.equal(search.policyAction(state), ACTION.FIRE);
  arrays[ARRAY.TANK_DIR][0] = DIRECTION.UP;
  assert.equal(search.policyAction(state), ACTION.TURN_RIGHT);
  arrays[ARRAY.TANK_CELL][1] = 24;
  arrays[ARRAY.TANK_DIR][0] = DIRECTION.RIGHT;
  assert.equal(search.policyAction(state), ACTION.GO);
});

test("BP139 shadow contract keeps non-events UNKNOWN and has no owner", () => {
  const searches = new Array(6).fill({ hotAllocationCount: 0,
    settlement: { hotAllocationCount: 0 } });
  const shadow = new SemanticAttackEventHorizonShadow({ searches });
  const summary = shadow.summary();
  assert.equal(summary.nonEventAtCap, "UNKNOWN");
  assert.equal(summary.actionOwnership, false);
  assert.equal(summary.positiveCertificateSound, true);
  assert.equal(summary.negativeSubsetResult, "UNKNOWN");
  assert.equal(summary.maximumDepth, 4);
  assert.equal(summary.hotAllocationCount, 0);
});
