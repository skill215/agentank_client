"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { LONG_OPTION, OPTION_EVENT } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { SCORE_BAND } = require(
  "../../tools/agentank/diagnostics/strategic-state-ledger-shadow");
const { POLICY_DIMENSION, POLICY_RELATION, POLICY_EVALUATION_STATUS } = require(
  "../../tools/agentank/diagnostics/response-conditioned-option-policy-shadow");
const { STRATEGIC_DECISION, StrategicConflictArbiterShadow } = require(
  "../../tools/agentank/diagnostics/strategic-conflict-arbiter-shadow");

function fixture() {
  const arrays = []; arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  const ledger = {
    capacity: 3,
    active: Uint8Array.from([1, 1, 0]),
    available: Uint8Array.from([1, 1, 0]),
    generation: Uint16Array.from([11, 22, 0]),
    deadline: Uint16Array.from([20, 18, 0]),
    lastSelectedSlot: 0,
    lastSelectedGeneration: 11,
    lastSelectedKind: LONG_OPTION.STAR_CONTROL,
    lastEventMask: OPTION_EVENT.MATCH_START
  };
  const strategic = { lastScoreBand: SCORE_BAND.TIED };
  const interval = { evaluationSerial: 0, lastAttackGeneration: 22,
    lastSelectedRow: 0, lastAttackRow: 1 };
  const response = {
    lastEvaluationStatus: POLICY_EVALUATION_STATUS.NONE,
    lastCurrentRiskIndex: -1,
    lastEvaluationSerial: 0,
    lastRelation: POLICY_RELATION.EQUAL,
    robust: new Int16Array(POLICY_DIMENSION.COUNT)
  };
  const engine = { adapter: { state: { arrays } },
    projectedCell: Uint16Array.from([10, 11]),
    combat: { vector: { hitDeadline: Uint8Array.from([255, 2]) } },
    starDistance(cell) { return Math.abs(cell - 13); } };
  const shadow = new StrategicConflictArbiterShadow(ledger, strategic,
    interval, response);
  return { arrays, ledger, strategic, interval, response, engine, shadow };
}

function tick(value) {
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
}

test("persistent target state suppresses only unsignaled switches while target lives", () => {
  const value = fixture(); const { ledger, shadow, engine } = value;
  shadow.observe(engine);
  assert.equal(shadow.shadowTargetGeneration, 11);
  tick(value); ledger.lastSelectedSlot = 1; ledger.lastSelectedGeneration = 22;
  ledger.lastSelectedKind = LONG_OPTION.ATTACK; ledger.lastEventMask = 0;
  shadow.observe(engine);
  assert.equal(shadow.shadowTargetGeneration, 11);
  assert.equal(shadow.unsignaledWouldHoldCount, 1);
  tick(value); ledger.active[0] = 0;
  shadow.observe(engine);
  assert.equal(shadow.shadowTargetGeneration, 22);
  assert.equal(shadow.targetSemanticAbortCount, 1);
});

test("semantic events permit target reevaluation without pretending completion", () => {
  const value = fixture(); const { ledger, shadow, engine } = value;
  shadow.observe(engine);
  tick(value); ledger.lastSelectedSlot = 1; ledger.lastSelectedGeneration = 22;
  ledger.lastSelectedKind = LONG_OPTION.ATTACK;
  ledger.lastEventMask = OPTION_EVENT.STAR_SCORE;
  shadow.observe(engine);
  assert.equal(shadow.shadowTargetGeneration, 22);
  assert.equal(shadow.eventReevaluationCount, 1);
  assert.equal(shadow.targetSemanticAbortCount, 0);
});

test("trailing tradeoff proposes a durable target generation, not a primitive action", () => {
  const value = fixture();
  const { ledger, strategic, interval, response, shadow, engine } = value;
  // These Plan execution deadlines deliberately say STAR is earlier.  The
  // strategic conflict must ignore them and compare semantic completion:
  // ATTACK hit deadline=2 versus STAR arrival deadline=4.
  ledger.deadline[0] = 1;
  ledger.deadline[1] = 100;
  strategic.lastScoreBand = SCORE_BAND.TRAILING;
  interval.evaluationSerial = 1;
  response.lastEvaluationSerial = 1;
  response.lastEvaluationStatus = POLICY_EVALUATION_STATUS.COMPLETE;
  response.lastCurrentRiskIndex = 0;
  response.lastRelation = POLICY_RELATION.TRADEOFF;
  response.robust[POLICY_DIMENSION.PROJECTILE_THREAT] = 100;
  response.robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 100;
  response.robust[POLICY_DIMENSION.STAR_DISTANCE] = -100;
  shadow.observe(engine);
  assert.equal(shadow.lastDecision, STRATEGIC_DECISION.ATTACK_SCORE_CONDITIONED);
  assert.equal(shadow.trailingAttackProposalCount, 1);
  assert.equal(shadow.lastAttackGeneration, 22);
  assert.equal(shadow.shadowTargetGeneration, 22);
  assert.equal(shadow.shadowTargetKind, LONG_OPTION.ATTACK);
  assert.equal(shadow.shadowTargetProposalOwned, 1);
  assert.equal(shadow.shadowTargetDeadline, 12);
  assert.equal(shadow.proposalTargetAdoptionCount, 1);
  assert.equal(shadow.lastAttackDeadline, 2);
  assert.equal(shadow.lastIncumbentDeadline, 4);
  assert.equal(shadow.summary().proposalUnit, "TARGET_GENERATION");
});

test("leading state rejects the same star-regressive tradeoff", () => {
  const value = fixture(); const { strategic, interval, response, shadow, engine } = value;
  strategic.lastScoreBand = SCORE_BAND.LEADING;
  interval.evaluationSerial = 1;
  response.lastEvaluationSerial = 1;
  response.lastEvaluationStatus = POLICY_EVALUATION_STATUS.COMPLETE;
  response.lastCurrentRiskIndex = 0;
  response.lastRelation = POLICY_RELATION.TRADEOFF;
  response.robust[POLICY_DIMENSION.PROJECTILE_THREAT] = 100;
  response.robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 100;
  response.robust[POLICY_DIMENSION.STAR_DISTANCE] = -100;
  shadow.observe(engine);
  assert.equal(shadow.lastDecision, STRATEGIC_DECISION.TRADEOFF);
  assert.equal(shadow.leadingAttackProposalCount, 0);
});

test("proposal target expires at its semantic completion deadline", () => {
  const value = fixture();
  const { strategic, interval, response, shadow, engine, arrays } = value;
  strategic.lastScoreBand = SCORE_BAND.TRAILING;
  interval.evaluationSerial = 1;
  response.lastEvaluationSerial = 1;
  response.lastEvaluationStatus = POLICY_EVALUATION_STATUS.COMPLETE;
  response.lastCurrentRiskIndex = 0;
  response.lastRelation = POLICY_RELATION.TRADEOFF;
  response.robust[POLICY_DIMENSION.PROJECTILE_THREAT] = 100;
  response.robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 100;
  shadow.observe(engine);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 13;
  shadow.observe(engine);
  assert.equal(shadow.proposalTargetDeadlineExpiryCount, 1);
  assert.equal(shadow.shadowTargetProposalOwned, 0);
  assert.equal(shadow.shadowTargetKind, LONG_OPTION.STAR_CONTROL);
});

test("Pareto attack remains a target proposal and observer mutates no source slab", () => {
  const value = fixture(); const { interval, response, shadow, engine, ledger } = value;
  interval.evaluationSerial = 1;
  response.lastEvaluationSerial = 1;
  response.lastEvaluationStatus = POLICY_EVALUATION_STATUS.COMPLETE;
  response.lastCurrentRiskIndex = 0;
  response.lastRelation = POLICY_RELATION.ATTACK_DOMINATES;
  const active = Array.from(ledger.active); const robust = Array.from(response.robust);
  shadow.observe(engine);
  assert.equal(shadow.lastDecision, STRATEGIC_DECISION.ATTACK_PARETO);
  assert.deepEqual(Array.from(ledger.active), active);
  assert.deepEqual(Array.from(response.robust), robust);
  assert.equal(shadow.hotAllocationCount, 0);
});
