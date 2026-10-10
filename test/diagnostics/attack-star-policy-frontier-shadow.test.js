"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PAC_STATUS } = require(
  "../../engine-v2/src/search/projectile-attack-closure");
const { FRONTIER, AttackStarPolicyFrontierShadow } = require(
  "../../tools/agentank/diagnostics/attack-star-policy-frontier-shadow");

function fixture() {
  const rollout = {
    horizon: 4,
    physicalComplete: Uint8Array.from([1, 1]),
    rootRestored: Uint8Array.from([1, 1]),
    hardFatal: new Uint8Array(2), ownCrashed: new Uint8Array(2),
    enemyCrashed: new Uint8Array(2), starGain: new Int16Array(2),
    starDistance: Uint16Array.from([2, 2]), mobility: Uint8Array.from([3, 3]),
    projectileThreat: new Uint8Array(2), enemyMobility: Uint8Array.from([3, 3]),
    ownFireLane: new Uint8Array(2)
  };
  const interval = { evaluationSerial: 1, lastAttackRow: 1,
    lastSelectedRow: 0, rollout };
  const utility = { lastEvaluationSerial: 1, lastAttackRow: 1,
    lastSelectedRow: 0, lastCurrentRiskQualified: 1,
    lastCurrentRiskIndex: 0, robust: Int16Array.from([1, 0, 0, 0, 0]) };
  const combat = { resourceOccupancy: new Uint16Array(2) };
  const engine = { combat: { vector: combat }, projectileAttack: {
    status: Uint8Array.from([PAC_STATUS.NONE, PAC_STATUS.COMPLETE]) } };
  return { rollout, interval, utility, engine,
    shadow: new AttackStarPolicyFrontierShadow(interval, utility) };
}

test("attack policy dominates only when every star and safety dimension is preserved", () => {
  const built = fixture();
  built.rollout.projectileThreat[1] = 1;
  built.shadow.observe(built.engine);
  const summary = built.shadow.summary();
  assert.equal(summary.attackDominatesCount, 1);
  assert.equal(summary.policyQualifiedCount, 1);
  assert.equal(summary.strictOwnershipCount, 0);
  assert.equal(summary.hotAllocationCount, 0);
});

test("a delayed star path remains a tradeoff even with combat progress", () => {
  const built = fixture();
  built.rollout.projectileThreat[1] = 1;
  built.rollout.starDistance[1] = 3;
  built.shadow.observe(built.engine);
  const summary = built.shadow.summary();
  assert.equal(summary.attackStarPathRegressionCount, 1);
  assert.equal(summary.tradeoffCount, 1);
  assert.equal(summary.policyQualifiedCount, 0);
  assert.equal(summary.lastFrontier, FRONTIER.TRADEOFF);
});

test("star policy dominates an attack with no verified combat progress", () => {
  const built = fixture();
  built.utility.robust.fill(0);
  built.rollout.starDistance[1] = 4;
  built.shadow.observe(built.engine);
  assert.equal(built.shadow.summary().starDominatesCount, 1);
});

test("unaligned evidence fails closed without changing either source slab", () => {
  const built = fixture();
  built.utility.lastEvaluationSerial = 0;
  const beforeDistance = Array.from(built.rollout.starDistance);
  const beforeRobust = Array.from(built.utility.robust);
  built.shadow.observe(built.engine);
  assert.equal(built.shadow.summary().unalignedUtilityCount, 1);
  assert.deepEqual(Array.from(built.rollout.starDistance), beforeDistance);
  assert.deepEqual(Array.from(built.utility.robust), beforeRobust);
});

