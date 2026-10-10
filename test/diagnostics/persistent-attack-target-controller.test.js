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
const { StrategicAttackOverStarProposal } = require(
  "../../tools/agentank/diagnostics/strategic-attack-over-star-proposal");
const { TARGET_STATUS, PersistentAttackTargetController } = require(
  "../../tools/agentank/diagnostics/persistent-attack-target-controller");

function fixture(active = false) {
  const arrays = [];
  arrays[ARRAY.SCALAR] = new Uint32Array(16);
  arrays[ARRAY.SCALAR][SCALAR.FRAME] = 10;
  arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] = 20;
  arrays[ARRAY.TANK_CELL] = Uint16Array.from([10, 40]);
  arrays[ARRAY.TANK_STARS] = Uint16Array.from([0, 1]);
  arrays[ARRAY.TANK_POISON_UNTIL] = Uint16Array.from([NONE_FRAME, NONE_FRAME]);
  arrays[ARRAY.TANK_SHIELD_HITS] = new Uint8Array(2);
  const robust = new Int16Array(POLICY_DIMENSION.COUNT);
  robust[POLICY_DIMENSION.PROJECTILE_THREAT] = 100;
  robust[POLICY_DIMENSION.ENEMY_MOBILITY] = 100;
  const response = {
    lastEvaluationStatus: POLICY_EVALUATION_STATUS.COMPLETE,
    lastCurrentRiskIndex: 0, lastRelation: POLICY_RELATION.TRADEOFF,
    robust, rootRestoreFailureCount: 0, hotAllocationCount: 0,
    evaluateRows() { return 1; }, summary() { return {}; }
  };
  const risk = { count: 2, acceptable: Uint8Array.from([1, 1]),
    dominated: new Uint8Array(2), immediateFatalMass: new Uint16Array(2),
    horizonFatalMass: new Uint16Array(2), unknownMass: new Uint16Array(2),
    earliestFatalFrame: Uint8Array.from([4, 4]),
    escapeSlack: Int8Array.from([1, 1]),
    robustLower: Int32Array.from([100, 90]),
    expectedValue: Int32Array.from([100, 90]) };
  const combat = { directKill: new Uint8Array(2),
    enemyDoomedFirstActions: new Uint8Array(2),
    enemyEndpointReduction: Uint8Array.from([0, 2]),
    enemyMobilityLoss: Uint8Array.from([0, 1]),
    ownCounterExposure: new Uint16Array(2),
    purposeCompleteness: Uint16Array.from([0, 5000]),
    postFireEscape: Uint8Array.from([0, 2]),
    hitDeadline: Uint8Array.from([255, 2]) };
  const engine = { adapter: { state: { arrays }, enemyVisible: true,
      ownBombReady: false, ownSkillReady: false }, lastControlMode: 1,
    rootGlobalMode() { return 0; }, escapeObligation: {
      supportStatus: SUPPORT_STATUS.NONE, committedEntityCount: 0,
      firstActionCount: 0 }, ourCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: risk }, combat: { vector: combat },
    depthSearch: { completedDepth: 2, representativeSupportComplete: 1,
      rootOurCount: 2, rootDomainRestricted: 0,
      rootDomainMask: Uint8Array.from([1, 1]),
      rootScore: Int32Array.from([100, 200]) },
    informationSearch: { completedDepth: 0 },
    projectedCell: Uint16Array.from([10, 11]), starDistance() { return 4; },
    optionPortfolio: { count: 2, primitiveRow: Uint8Array.from([0, 1]),
      kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL, OPTION_KIND.ATTACK_SETUP]),
      supportComplete: Uint8Array.from([1, 1]) } };
  const owner = new StrategicAttackOverStarProposal({ responsePolicy: response });
  return { arrays, risk, combat, engine, owner,
    controller: new PersistentAttackTargetController(owner, { active }) };
}

test("a complete FIRE-over-STAR conflict adopts one semantic target", () => {
  const value = fixture();
  assert.equal(value.controller.evaluate(value.engine, 0, 2), 1);
  assert.equal(value.controller.targetActive, 1);
  assert.equal(value.controller.targetDeadline, 12);
  assert.equal(value.controller.targetEnemyCell, 40);
  assert.equal(value.controller.adoptionCount, 1);
  assert.equal(value.controller.hotAllocationCount, 0);
});

test("the target can execute a different qualified primitive on the next frame", () => {
  const value = fixture();
  assert.equal(value.controller.evaluate(value.engine, 0, 2), 1);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  value.engine.ourActions[1] = ACTION.GO;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), 1);
  assert.equal(value.controller.lastStatus, TARGET_STATUS.CONTINUED);
  assert.equal(value.controller.continuationProposalCount, 1);
  assert.equal(value.controller.targetActive, 1);
});

test("committed escape yields one frame without completing the attack target", () => {
  const value = fixture();
  value.controller.evaluate(value.engine, 0, 2);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  value.engine.escapeObligation.supportStatus = SUPPORT_STATUS.COMPLETE;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.controller.targetActive, 1);
  assert.equal(value.controller.lastStatus, TARGET_STATUS.SAFETY_YIELD);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 12;
  value.engine.escapeObligation.supportStatus = SUPPORT_STATUS.NONE;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), 1);
});

test("an independent resource Option owns its frame while the target remains alive", () => {
  const value = fixture();
  value.controller.evaluate(value.engine, 0, 2);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  value.engine.ourActions[0] = ACTION.CAST_POISON;
  value.engine.optionPortfolio.kind[0] = OPTION_KIND.RESOURCE;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.controller.lastStatus, TARGET_STATUS.STRATEGIC_YIELD);
  assert.equal(value.controller.targetActive, 1);
  assert.equal(value.controller.strategicYieldCount, 1);
});

test("deadline and a newly established score lead end the target", () => {
  const expired = fixture();
  expired.controller.evaluate(expired.engine, 0, 2);
  expired.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 13;
  assert.equal(expired.controller.evaluate(expired.engine, 0, 2), -1);
  assert.equal(expired.controller.lastStatus, TARGET_STATUS.EXPIRED);
  assert.equal(expired.controller.targetActive, 0);

  const leading = fixture();
  leading.controller.evaluate(leading.engine, 0, 2);
  leading.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  leading.arrays[ARRAY.TANK_STARS][0] = 2;
  assert.equal(leading.controller.evaluate(leading.engine, 0, 2), -1);
  assert.equal(leading.controller.lastStatus, TARGET_STATUS.SCORE_ABORT);
});

test("a Risk regression creates an execution gap and never an unsafe proposal", () => {
  const value = fixture();
  value.controller.evaluate(value.engine, 0, 2);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  value.risk.horizonFatalMass[1] = 1;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.controller.lastStatus, TARGET_STATUS.EXECUTION_GAP);
  assert.equal(value.controller.targetActive, 1);
  assert.notEqual(value.controller.lastProposal, ACTION.NONE);
});

test("a continuation cannot own an action without exact Minimax dominance", () => {
  const value = fixture();
  value.controller.evaluate(value.engine, 0, 2);
  value.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 11;
  value.engine.ourActions[1] = ACTION.GO;
  value.engine.depthSearch.representativeSupportComplete = 0;
  assert.equal(value.controller.evaluate(value.engine, 0, 2), -1);
  assert.equal(value.controller.exactValueBlockedCount, 1);
  assert.equal(value.controller.targetActive, 1);
});
