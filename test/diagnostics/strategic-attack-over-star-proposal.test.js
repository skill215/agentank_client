"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_FRAME } = require(
  "../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require(
  "../../engine-v2/src/runtime/escape-obligation");
const { POLICY_DIMENSION, POLICY_RELATION, POLICY_EVALUATION_STATUS } = require(
  "../../tools/agentank/diagnostics/response-conditioned-option-policy-shadow");
const { SCORE_BAND } = require(
  "../../tools/agentank/diagnostics/strategic-state-ledger-shadow");
const { StrategicAttackOverStarProposal } = require(
  "../../tools/agentank/diagnostics/strategic-attack-over-star-proposal");

function fixture() {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 20;
  arrays[ARRAY.TANK_STARS] = Uint16Array.from([0, 1]);
  arrays[ARRAY.TANK_POISON_UNTIL] = Uint16Array.from([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.TANK_SHIELD_HITS] = new Uint8Array(2);
  const robust = new Int16Array(POLICY_DIMENSION.COUNT);
  robust[POLICY_DIMENSION.PROJECTILE_THREAT] = 100;
  robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 100;
  const response = {
    lastEvaluationStatus: POLICY_EVALUATION_STATUS.COMPLETE,
    lastCurrentRiskIndex: 0,
    lastRelation: POLICY_RELATION.TRADEOFF,
    robust,
    rootRestoreFailureCount: 0,
    hotAllocationCount: 0,
    evaluateRows(engine, selected, attack) {
      this.lastSelectedRow = selected; this.lastAttackRow = attack;
      return 1;
    },
    summary() { return { evaluationCount: 1 }; }
  };
  const risk = { count: 2, acceptable: Uint8Array.from([1, 1]),
    dominated: new Uint8Array(2) };
  const combat = { directKill: new Uint8Array(2),
    enemyDoomedFirstActions: new Uint8Array(2),
    enemyEndpointReduction: Uint8Array.from([0, 2]),
    ownCounterExposure: new Uint16Array(2),
    purposeCompleteness: Uint16Array.from([0, 5000]),
    postFireEscape: Uint8Array.from([0, 2]),
    hitDeadline: Uint8Array.from([255, 2]) };
  const engine = {
    adapter: { state: { arrays }, enemyVisible: true,
      ownBombReady: false, ownSkillReady: false },
    lastControlMode: 1,
    rootGlobalMode() { return 0; },
    escapeObligation: { supportStatus: SUPPORT_STATUS.NONE,
      committedEntityCount: 0, firstActionCount: 0 },
    ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: risk }, combat: { vector: combat },
    projectedCell: Uint16Array.from([10, 11]),
    starDistance() { return 4; },
    optionPortfolio: { count: 2,
      primitiveRow: Uint8Array.from([0, 1]),
      kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL,
        OPTION_KIND.ATTACK_SETUP]),
      supportComplete: Uint8Array.from([1, 1]) }
  };
  return { arrays, response, engine,
    proposal: new StrategicAttackOverStarProposal({ responsePolicy: response }) };
}

test("pre-final evidence reproduces a trailing FIRE-over-STAR proposal", () => {
  const value = fixture();
  const row = value.proposal.evaluate(value.engine, 0, 2);
  assert.equal(row, 1);
  assert.equal(value.proposal.lastScoreBand, SCORE_BAND.TRAILING);
  assert.equal(value.proposal.lastAttackDeadline, 2);
  assert.equal(value.proposal.lastStarDeadline, 5);
  assert.equal(value.proposal.proposalCount, 1);
  assert.equal(value.proposal.hotAllocationCount, 0);
});

test("the same star-regressive response is blocked while tied", () => {
  const value = fixture();
  value.arrays[ARRAY.TANK_STARS][1] = 0;
  value.response.robust[POLICY_DIMENSION.STAR_DISTANCE] = -100;
  assert.equal(value.proposal.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.proposal.scoreBlockedCount, 1);
});

test("a steady unchanged conflict is not repeatedly evaluated", () => {
  const value = fixture();
  assert.equal(value.proposal.evaluate(value.engine, 0, 2), 1);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] += 1;
  assert.equal(value.proposal.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.proposal.triggerCount, 1);
  assert.equal(value.proposal.steadySkipCount, 1);
});

test("durable-combat block census separates physical pressure from response value", () => {
  const value = fixture();
  value.response.robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 0;
  assert.equal(value.proposal.evaluate(value.engine, 0, 2), -1);
  const census = value.proposal.summary().durableCombatBlockCensus;
  assert.equal(value.proposal.combatBlockedCount, 1);
  assert.equal(census.positiveDimensionCount[1], 1);
  assert.equal(census.physicalSignalMask[4], 1);
  assert.equal(census.noPositiveDimensionCount, 0);
  assert.equal(census.relation[POLICY_RELATION.TRADEOFF], 1);
  assert.equal(census.byScore[SCORE_BAND.TRAILING], 1);

  const none = fixture(); none.response.robust.fill(0);
  none.response.temporalRobust = new Int16Array(5);
  none.response.temporalRobust[0] = 100;
  assert.equal(none.proposal.evaluate(none.engine, 0, 2), -1);
  const empty = none.proposal.summary().durableCombatBlockCensus;
  assert.equal(empty.positiveDimensionCount[0], 1);
  assert.equal(empty.physicalSignalMask[4], 1);
  assert.equal(empty.physicalSignalWithoutValueCount, 1);
  assert.equal(empty.temporalPositiveDimensionCount[1], 1);
  assert.equal(empty.temporalRecoveryCount, 1);
});
