"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { PAC_STATUS } = require(
  "../../engine-v2/src/search/projectile-attack-closure");
const { ATTACK_PROGRESS, AttackContinuationProgressShadow } = require(
  "../../tools/agentank/diagnostics/attack-continuation-progress-shadow");

function fixture() {
  const rollout = {
    physicalComplete: Uint8Array.from([1, 1]),
    rootRestored: Uint8Array.from([1, 1]),
    hardFatal: new Uint8Array(2), ownCrashed: new Uint8Array(2),
    enemyCrashed: new Uint8Array(2), enemyDebuffCount: new Uint8Array(2),
    projectileThreat: new Uint8Array(2), ownProjectileCount: new Uint8Array(2),
    ownFireLane: new Uint8Array(2), enemyMobility: Uint8Array.from([4, 4]),
    objectiveProgress: new Int16Array(2), starGain: new Int16Array(2)
  };
  const interval = { evaluationSerial: 1, lastSelectedRow: 0, lastAttackRow: 1,
    lastAttackGeneration: 9, lastRiskIncumbentLower: 100,
    lastRiskAttackUpper: 200, rollout };
  const vector = { count: 2,
    attackClosureStatus: Uint8Array.from([0, PAC_STATUS.COMPLETE]),
    enemyUnknownFirstActions: new Uint8Array(2),
    purposeCompleteness: Uint16Array.from([0, 10000]),
    postFireEscape: Uint8Array.from([0, 1]),
    enemyDoomedFirstActions: Uint8Array.from([0, 1]),
    enemyEndpointReduction: new Uint16Array(2),
    enemyMobilityLoss: new Uint8Array(2) };
  const engine = { ourCount: 2, ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    combat: { vector }, projectileAttackClosure: { count: 2,
      status: Uint8Array.from([0, PAC_STATUS.COMPLETE]) } };
  return { interval, rollout, vector, engine };
}

test("first-action evidence and posture alone are not continuation progress", () => {
  const built = fixture(); built.rollout.ownFireLane[1] = 1;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.evaluationCount, 1);
  assert.ok(summary.lastMask & ATTACK_PROGRESS.FIRST_ACTION_COMPLETE);
  assert.ok(summary.lastMask & ATTACK_PROGRESS.RESPONSE_COMPRESSED);
  assert.ok(summary.lastMask & ATTACK_PROGRESS.POSTURE_PROGRESS);
  assert.equal(summary.lastMask & ATTACK_PROGRESS.DURABLE_PROGRESS, 0);
  assert.equal(summary.challengerBeforeStarTradeoffCount, 0);
  assert.equal(summary.postureOnlyCount, 1);
});

test("projectile constraint is durable and repeated generation becomes strong", () => {
  const built = fixture(); built.rollout.projectileThreat[1] = 1;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine);
  assert.equal(shadow.summary().challengerBeforeStarTradeoffCount, 1);
  assert.equal(shadow.summary().strongWitnessCount, 0);
  built.interval.evaluationSerial += 1;
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.sameGenerationRevalidationCount, 1);
  assert.equal(summary.progressMaintainedCount, 1);
  assert.equal(summary.maximumDurableRevalidations, 2);
  assert.equal(summary.strongWitnessCount, 1);
});

test("irreversible crash or debuff is immediately a strong witness", () => {
  const built = fixture(); built.rollout.enemyDebuffCount[1] = 1;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.ok(summary.lastMask & ATTACK_PROGRESS.IRREVERSIBLE_PROGRESS);
  assert.equal(summary.strongWitnessCount, 1);
});

test("risk separation and star regression remain explicit independent gates", () => {
  const built = fixture(); built.rollout.projectileThreat[1] = 1;
  built.rollout.starGain[0] = 1;
  built.interval.lastRiskIncumbentLower = 300;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.riskSeparatedBlockedCount, 1);
  assert.equal(summary.starRegressionCount, 1);
  assert.equal(summary.challengerBeforeStarTradeoffCount, 0);
  assert.equal(summary.nonRegressiveChallengerCount, 0);
});

test("duplicate interval evaluation is ignored and progress regression is tracked", () => {
  const built = fixture(); built.rollout.projectileThreat[1] = 1;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine); shadow.observe(built.engine);
  assert.equal(shadow.summary().duplicateSkipCount, 1);
  built.interval.evaluationSerial += 1; built.rollout.projectileThreat[1] = 0;
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.evaluationCount, 2);
  assert.equal(summary.progressRegressedCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("incomplete first action never becomes challenger", () => {
  const built = fixture(); built.engine.combat.vector.enemyUnknownFirstActions[1] = 1;
  built.rollout.projectileThreat[1] = 1;
  const shadow = new AttackContinuationProgressShadow(built.interval);
  shadow.observe(built.engine);
  const summary = shadow.summary();
  assert.equal(summary.firstActionIncompleteCount, 1);
  assert.equal(summary.challengerBeforeStarTradeoffCount, 0);
});
