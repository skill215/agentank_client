"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { GLOBAL_MODE } = require("../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { QualifiedAttackOverStarProposal } = require(
  "../../tools/agentank/diagnostics/qualified-attack-over-star");

function fixture() {
  return {
    ourCount: 3,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT]),
    ourArguments: new Uint16Array(3),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW,
      HARD_STATUS.ALLOW]),
    globalMode: GLOBAL_MODE.NORMAL,
    rootGlobalMode() { return this.globalMode; },
    escapeObligation: { supportStatus: 0 },
    optionPortfolio: {
      count: 3,
      primitiveRow: Uint8Array.from([0, 1, 2]),
      kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL, OPTION_KIND.ATTACK_SETUP,
        OPTION_KIND.ATTACK_SETUP]),
      supportComplete: Uint8Array.from([1, 1, 1])
    },
    riskController: { outcome: {
      count: 3, acceptable: Uint8Array.from([1, 1, 1]),
      dominated: Uint8Array.from([0, 0, 0]),
      robustLower: Int32Array.from([100, 90, 110]),
      expectedValue: Int32Array.from([100, 90, 110])
    } },
    combat: { vector: {
      purposeCompleteness: Uint16Array.from([0, 5000, 6000]),
      directKill: new Uint8Array(3),
      enemyDoomedFirstActions: Uint8Array.from([0, 1, 1]),
      enemyEndpointReduction: Uint16Array.from([0, 1, 1]),
      enemyMobilityLoss: Uint8Array.from([0, 1, 1]),
      hitDeadline: Uint8Array.from([255, 4, 3]),
      ownCounterExposure: Uint16Array.from([1000, 1000, 1000])
    } }
  };
}

test("qualified attack owns a star conflict without changing Risk membership", () => {
  const engine = fixture(); const proposal = new QualifiedAttackOverStarProposal();
  assert.equal(proposal.evaluate(engine, 0, 3), 1);
  const summary = proposal.summary();
  assert.equal(summary.starOwnerRootCount, 1);
  assert.equal(summary.qualifiedAttackRowCount, 2);
  assert.equal(summary.qualifiedFireRootCount, 1);
  assert.equal(summary.differentProposalCount, 1);
  assert.equal(summary.hotAllocationCount, 0);
});

test("an incomplete, rejected, or dominated attack cannot claim ownership", () => {
  const engine = fixture(); const proposal = new QualifiedAttackOverStarProposal();
  engine.optionPortfolio.supportComplete[1] = 0;
  engine.optionPortfolio.supportComplete[2] = 0;
  assert.equal(proposal.evaluate(engine, 0, 3), -1);
  engine.optionPortfolio.supportComplete[1] = 1;
  engine.riskController.outcome.dominated[1] = 1;
  assert.equal(proposal.evaluate(engine, 0, 3), -1);
  engine.riskController.outcome.dominated[1] = 0;
  engine.hardStatus[1] = HARD_STATUS.REJECT_PROVEN;
  assert.equal(proposal.evaluate(engine, 0, 3), -1);
});

test("committed danger and terminal mode remain higher owners", () => {
  const engine = fixture(); const proposal = new QualifiedAttackOverStarProposal({ active: true });
  engine.escapeObligation.supportStatus = 1;
  assert.equal(proposal.evaluate(engine, 0, 3), -1);
  engine.escapeObligation.supportStatus = 0;
  engine.globalMode = GLOBAL_MODE.FORCED_LOSS_RECOVERY;
  assert.equal(proposal.evaluate(engine, 0, 3), -1);
  const summary = proposal.summary();
  assert.equal(summary.committedBlockedCount, 1);
  assert.equal(summary.terminalBlockedCount, 1);
});
