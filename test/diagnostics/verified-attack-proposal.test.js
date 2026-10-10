"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { VerifiedAttackProposal } = require(
  "../../tools/agentank/diagnostics/verified-attack-proposal");

function fixture() {
  return {
    escapeObligation: { supportStatus: 0 },
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    riskController: { outcome: {
      acceptable: Uint8Array.from([1, 1]),
      dominated: Uint8Array.from([0, 0]),
      immediateFatalMass: Uint16Array.from([0, 0]),
      horizonFatalMass: Uint16Array.from([100, 100]),
      unknownMass: Uint16Array.from([0, 0]),
      earliestFatalFrame: Uint8Array.from([4, 4]),
      escapeSlack: Int8Array.from([1, 1]),
      robustLower: Int32Array.from([200, 200]),
      expectedValue: Int32Array.from([100, 120])
    } },
    combat: { vector: {
      directKill: Uint8Array.from([0, 0]),
      purposeCompleteness: Uint16Array.from([0, 6000]),
      attackClosureStatus: Uint8Array.from([0, 1]),
      postFireEscape: Uint8Array.from([0, 2]),
      ownCounterExposure: Uint16Array.from([1000, 1000]),
      enemyUnknownFirstActions: Uint8Array.from([0, 0]),
      enemySurvivingFirstActions: Uint8Array.from([0, 2]),
      enemyDoomedFirstActions: Uint8Array.from([0, 1]),
      enemyEndpointReduction: Uint16Array.from([0, 2]),
      enemyMobilityLoss: Uint8Array.from([0, 1]),
      hitDeadline: Uint8Array.from([255, 3])
    } }
  };
}

test("verified attack proposal requires no-regression response evidence", () => {
  const proposal = new VerifiedAttackProposal();
  assert.equal(proposal.evaluate(fixture(), 0, 2), 1);
  const summary = proposal.summary();
  assert.equal(summary.responseEvidenceRowCount, 1);
  assert.equal(summary.noRegressionRowCount, 1);
  assert.equal(summary.differentProposalCount, 1);
  assert.equal(summary.strictKillProposalCount, 0);
});

test("risk regression fails closed even when the attack constrains responses", () => {
  const value = fixture();
  value.riskController.outcome.horizonFatalMass[1] = 101;
  const proposal = new VerifiedAttackProposal({ active: true });
  assert.equal(proposal.evaluate(value, 0, 2), -1);
  assert.equal(proposal.summary().proposalCount, 0);
});

test("strict kill is counted only when no enemy first action survives", () => {
  const value = fixture();
  value.combat.vector.enemySurvivingFirstActions[1] = 0;
  const proposal = new VerifiedAttackProposal();
  assert.equal(proposal.evaluate(value, 0, 2), 1);
  assert.equal(proposal.summary().strictKillProposalCount, 1);
});

test("soft attack proposal yields to every committed escape obligation", () => {
  const value = fixture();
  value.escapeObligation.supportStatus = 1;
  const proposal = new VerifiedAttackProposal({ active: true });
  assert.equal(proposal.evaluate(value, 0, 2), -1);
  assert.equal(proposal.summary().fireRowCount, 0);
});

test("strict verified attack rejects response reduction without direct kill", () => {
  const value = fixture();
  const proposal = new VerifiedAttackProposal({ active: true,
    requireDirectKill: true });
  assert.equal(proposal.evaluate(value, 0, 2), -1);
  value.combat.vector.directKill[1] = 1;
  assert.equal(proposal.evaluate(value, 0, 2), 1);
  assert.equal(proposal.summary().requireDirectKill, true);
});
