"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { AttackOpportunityCensus } = require(
  "../../tools/agentank/diagnostics/attack-opportunity-census");

function engine() {
  return {
    adapter: { bundle: {}, enemyVisible: true },
    ourCount: 2,
    ourActions: Uint8Array.from([ACTION.FIRE, ACTION.FIRE]),
    ourArguments: Uint16Array.from([NONE_CELL, 7]),
    lastArgument: NONE_CELL,
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: {
      acceptable: Uint8Array.from([1, 1]),
      dominated: Uint8Array.from([0, 1])
    } },
    combat: { vector: {
      purposeCompleteness: Uint16Array.from([10000, 10000]),
      attackClosureStatus: Uint8Array.from([1, 1]),
      postFireEscape: Uint8Array.from([2, 2]),
      ownCounterExposure: Uint16Array.from([0, 0]),
      enemyUnknownFirstActions: Uint8Array.from([0, 0]),
      enemySurvivingFirstActions: Uint8Array.from([0, 2]),
      enemyDoomedFirstActions: Uint8Array.from([3, 1]),
      enemyEndpointReduction: Uint16Array.from([2, 1]),
      enemyMobilityLoss: Uint8Array.from([1, 0]),
      possibleHit: Uint8Array.from([0, 1]),
      directKill: Uint8Array.from([1, 0])
    } }
  };
}

test("attack census separates strict kill ownership from response evidence", () => {
  const value = engine();
  const census = new AttackOpportunityCensus();
  census.observe(value, ACTION.FIRE);
  const summary = census.summary();
  assert.equal(summary.decisionCount, 1);
  assert.equal(summary.row.fireCandidate, 2);
  assert.equal(summary.row.responseConstraint, 2);
  assert.equal(summary.row.strictKillCertificate, 1);
  assert.equal(summary.row.qualifiedAttackEvidence, 1);
  assert.equal(summary.row.selectedFire, 1);
  assert.equal(summary.row.selectedQualifiedEvidence, 1);
  assert.equal(summary.row.selectedStrictKill, 1);
  assert.equal(summary.firstBlock.qualified, 1);
  assert.equal(summary.firstBlock.dominated, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("possible response constraint never becomes a strict kill certificate", () => {
  const value = engine();
  value.lastArgument = 7;
  const census = new AttackOpportunityCensus();
  census.observe(value, ACTION.FIRE);
  const summary = census.summary();
  assert.equal(summary.row.responseConstraint, 2);
  assert.equal(summary.row.strictKillCertificate, 1);
  assert.equal(summary.row.selectedQualifiedEvidence, 0);
  assert.equal(summary.row.selectedStrictKill, 0);
});

