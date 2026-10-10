"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { LEAF_COMPONENT, LEAF_COMPONENT_ALL } = require(
  "../../tools/agentank/diagnostics/native-tactical-domain-evaluator-poc");
const { EVENT_LANE, laneOptions, SemanticAttackEventDeadlineShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-event-deadline-shadow");

test("BP138 event lanes remove the generic ATTACK scalar", () => {
  for (let lane = 0; lane < EVENT_LANE.COUNT; lane += 1) {
    const options = laneOptions(lane);
    assert.equal(options.leafMask & LEAF_COMPONENT.ATTACK, 0);
    assert.equal(options.leafMask,
      LEAF_COMPONENT_ALL & ~LEAF_COMPONENT.ATTACK);
    assert.equal(options.commonContinuation, true);
    assert.equal(options.pairedDepth, 3);
  }
});

test("BP138 separates outcome frontier from committed settlement", () => {
  const outcome = laneOptions(EVENT_LANE.OUTCOME_FRONTIER);
  const settlement = laneOptions(EVENT_LANE.PROJECTILE_SETTLEMENT);
  assert.equal(outcome.outcomeVector, true);
  assert.equal(outcome.eventSettlement, undefined);
  assert.equal(settlement.eventSettlement, true);
  assert.equal(settlement.outcomeVector, undefined);
});

test("BP138 is diagnostic-only and preallocates all runtime records", () => {
  const policies = new Array(6).fill({ hotAllocationCount: 0 });
  const shadow = new SemanticAttackEventDeadlineShadow({}, { policies });
  assert.equal(shadow.summary().actionOwnership, false);
  assert.ok(shadow.recordBaselineCell instanceof Int16Array);
  assert.ok(shadow.recordCandidateCell instanceof Int16Array);
  assert.equal(shadow.totalHotAllocationCount(), 0);
});
