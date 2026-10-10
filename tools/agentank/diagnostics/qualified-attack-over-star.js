"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { GLOBAL_MODE } = require("../../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");

class QualifiedAttackOverStarProposal {
  constructor(options = {}) {
    this.active = options.active ? 1 : 0;
    this.checkCount = 0;
    this.starOwnerRootCount = 0;
    this.qualifiedAttackRowCount = 0;
    this.qualifiedAttackRootCount = 0;
    this.qualifiedFireRootCount = 0;
    this.proposalCount = 0;
    this.samePrimitiveCount = 0;
    this.differentProposalCount = 0;
    this.overrideCount = 0;
    this.fireOverrideCount = 0;
    this.finalRejectCount = 0;
    this.committedBlockedCount = 0;
    this.terminalBlockedCount = 0;
    this.hotAllocationCount = 0;
    this.lastProposal = -1;
  }

  optionComplete(engine, row, firstKind, secondKind = -1) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          (portfolio.kind[at] === firstKind || portfolio.kind[at] === secondKind)) return 1;
    return 0;
  }

  qualifiedAttack(engine, row) {
    if (row < 0 || row >= engine.ourCount ||
        engine.hardStatus[row] !== HARD_STATUS.ALLOW) return 0;
    const risk = engine.riskController.outcome;
    if (row >= risk.count || !risk.acceptable[row] || risk.dominated[row]) return 0;
    const combat = engine.combat.vector;
    if (combat.purposeCompleteness[row] < 4500) return 0;
    return this.optionComplete(engine, row, OPTION_KIND.DIRECT_KILL,
      OPTION_KIND.ATTACK_SETUP);
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const combat = engine.combat.vector;
    if (combat.directKill[left] !== combat.directKill[right])
      return combat.directKill[left] > combat.directKill[right] ? 1 : 0;
    const leftFire = engine.ourActions[left] === ACTION.FIRE ? 1 : 0;
    const rightFire = engine.ourActions[right] === ACTION.FIRE ? 1 : 0;
    if (leftFire !== rightFire) return leftFire > rightFire ? 1 : 0;
    if (combat.enemyDoomedFirstActions[left] !== combat.enemyDoomedFirstActions[right])
      return combat.enemyDoomedFirstActions[left] >
        combat.enemyDoomedFirstActions[right] ? 1 : 0;
    if (combat.enemyEndpointReduction[left] !== combat.enemyEndpointReduction[right])
      return combat.enemyEndpointReduction[left] >
        combat.enemyEndpointReduction[right] ? 1 : 0;
    if (combat.enemyMobilityLoss[left] !== combat.enemyMobilityLoss[right])
      return combat.enemyMobilityLoss[left] > combat.enemyMobilityLoss[right] ? 1 : 0;
    if (combat.purposeCompleteness[left] !== combat.purposeCompleteness[right])
      return combat.purposeCompleteness[left] > combat.purposeCompleteness[right] ? 1 : 0;
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    if (combat.ownCounterExposure[left] !== combat.ownCounterExposure[right])
      return combat.ownCounterExposure[left] < combat.ownCounterExposure[right] ? 1 : 0;
    const risk = engine.riskController.outcome;
    if (risk.robustLower[left] !== risk.robustLower[right])
      return risk.robustLower[left] > risk.robustLower[right] ? 1 : 0;
    if (risk.expectedValue[left] !== risk.expectedValue[right])
      return risk.expectedValue[left] > risk.expectedValue[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  evaluate(engine, selected, selectionCount) {
    this.checkCount += 1; this.lastProposal = -1;
    if (!engine || selected < 0 || selected >= selectionCount) return -1;
    if (engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE) {
      this.committedBlockedCount += 1; return -1;
    }
    if (engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL) {
      this.terminalBlockedCount += 1; return -1;
    }
    if (!this.optionComplete(engine, selected, OPTION_KIND.STAR_CONTROL)) return -1;
    if (this.qualifiedAttack(engine, selected)) return -1;
    this.starOwnerRootCount += 1;
    let best = -1; let fire = 0;
    for (let row = 0; row < selectionCount; row += 1) {
      if (!this.qualifiedAttack(engine, row)) continue;
      this.qualifiedAttackRowCount += 1;
      if (engine.ourActions[row] === ACTION.FIRE) fire = 1;
      if (this.better(engine, row, best)) best = row;
    }
    if (best < 0) return -1;
    this.qualifiedAttackRootCount += 1;
    if (fire) this.qualifiedFireRootCount += 1;
    this.proposalCount += 1; this.lastProposal = best;
    if (engine.ourActions[best] === engine.ourActions[selected] &&
        engine.ourArguments[best] === engine.ourArguments[selected])
      this.samePrimitiveCount += 1;
    else this.differentProposalCount += 1;
    return best;
  }

  confirmOverride(engine, row) {
    this.overrideCount += 1;
    if (engine.ourActions[row] === ACTION.FIRE) this.fireOverrideCount += 1;
  }

  rejectFinal() { this.finalRejectCount += 1; }

  summary() {
    return { active: Boolean(this.active), checkCount: this.checkCount,
      starOwnerRootCount: this.starOwnerRootCount,
      qualifiedAttackRowCount: this.qualifiedAttackRowCount,
      qualifiedAttackRootCount: this.qualifiedAttackRootCount,
      qualifiedFireRootCount: this.qualifiedFireRootCount,
      proposalCount: this.proposalCount, samePrimitiveCount: this.samePrimitiveCount,
      differentProposalCount: this.differentProposalCount,
      overrideCount: this.overrideCount, fireOverrideCount: this.fireOverrideCount,
      finalRejectCount: this.finalRejectCount,
      committedBlockedCount: this.committedBlockedCount,
      terminalBlockedCount: this.terminalBlockedCount,
      lastProposal: this.lastProposal, hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { QualifiedAttackOverStarProposal };
