"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");

const PAC_COMPLETE = 1;

// Diagnostic proposal service. It may only propose an already Risk-frontier
// FIRE action whose committed/finite-horizon evidence does not regress any
// safety dimension or robust lower value relative to the current owner.
class VerifiedAttackProposal {
  constructor(options = {}) {
    this.active = options.active ? 1 : 0;
    this.requireDirectKill = options.requireDirectKill ? 1 : 0;
    this.checkCount = 0;
    this.fireRowCount = 0;
    this.responseEvidenceRowCount = 0;
    this.noRegressionRowCount = 0;
    this.proposalCount = 0;
    this.sameSelectedCount = 0;
    this.differentProposalCount = 0;
    this.overrideCount = 0;
    this.finalRejectCount = 0;
    this.strictKillProposalCount = 0;
    this.hotAllocationCount = 0;
    this.lastProposal = -1;
  }

  riskNoWorse(outcome, row, preferred) {
    return outcome.immediateFatalMass[row] <= outcome.immediateFatalMass[preferred] &&
      outcome.horizonFatalMass[row] <= outcome.horizonFatalMass[preferred] &&
      outcome.unknownMass[row] <= outcome.unknownMass[preferred] &&
      outcome.earliestFatalFrame[row] >= outcome.earliestFatalFrame[preferred] &&
      outcome.escapeSlack[row] >= outcome.escapeSlack[preferred] &&
      outcome.robustLower[row] >= outcome.robustLower[preferred];
  }

  better(combat, outcome, left, right) {
    if (right < 0) return 1;
    const leftStrict = combat.enemySurvivingFirstActions[left] === 0 &&
      combat.enemyDoomedFirstActions[left] > 0;
    const rightStrict = combat.enemySurvivingFirstActions[right] === 0 &&
      combat.enemyDoomedFirstActions[right] > 0;
    if (leftStrict !== rightStrict) return leftStrict ? 1 : 0;
    if (combat.enemyDoomedFirstActions[left] !== combat.enemyDoomedFirstActions[right])
      return combat.enemyDoomedFirstActions[left] > combat.enemyDoomedFirstActions[right];
    if (combat.enemyEndpointReduction[left] !== combat.enemyEndpointReduction[right])
      return combat.enemyEndpointReduction[left] > combat.enemyEndpointReduction[right];
    if (combat.enemyMobilityLoss[left] !== combat.enemyMobilityLoss[right])
      return combat.enemyMobilityLoss[left] > combat.enemyMobilityLoss[right];
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    return left < right ? 1 : 0;
  }

  evaluate(engine, preferred, selectionCount) {
    this.checkCount += 1;
    this.lastProposal = -1;
    if (!engine || preferred < 0 || preferred >= selectionCount) return -1;
    // Soft response-constraint evidence cannot consume time from an already
    // committed bomb/projectile obligation. Strict kills remain owned by the
    // separate production certificate path.
    if (!engine.escapeObligation ||
        engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE) return -1;
    const combat = engine.combat.vector;
    const outcome = engine.riskController.outcome;
    let proposal = -1;
    for (let row = 0; row < selectionCount; row += 1) {
      if (engine.ourActions[row] !== ACTION.FIRE) continue;
      this.fireRowCount += 1;
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !outcome.acceptable[row] || outcome.dominated[row] ||
          combat.purposeCompleteness[row] < 4500 ||
          combat.attackClosureStatus[row] !== PAC_COMPLETE ||
          combat.postFireEscape[row] === 0 ||
          combat.ownCounterExposure[row] > combat.ownCounterExposure[preferred] ||
          combat.enemyUnknownFirstActions[row] !== 0) continue;
      if (this.requireDirectKill && !combat.directKill[row]) continue;
      const response = combat.enemyDoomedFirstActions[row] > 0 ||
        combat.enemyEndpointReduction[row] > 0 || combat.enemyMobilityLoss[row] > 0;
      if (!response) continue;
      this.responseEvidenceRowCount += 1;
      if (!this.riskNoWorse(outcome, row, preferred)) continue;
      this.noRegressionRowCount += 1;
      if (this.better(combat, outcome, row, proposal)) proposal = row;
    }
    if (proposal < 0) return -1;
    this.proposalCount += 1;
    this.lastProposal = proposal;
    if (proposal === preferred) this.sameSelectedCount += 1;
    else this.differentProposalCount += 1;
    if (combat.enemySurvivingFirstActions[proposal] === 0 &&
        combat.enemyDoomedFirstActions[proposal] > 0)
      this.strictKillProposalCount += 1;
    return proposal;
  }

  confirmOverride() { this.overrideCount += 1; }
  rejectFinal() { this.finalRejectCount += 1; }

  summary() {
    return {
      active: Boolean(this.active),
      requireDirectKill: Boolean(this.requireDirectKill),
      checkCount: this.checkCount,
      fireRowCount: this.fireRowCount,
      responseEvidenceRowCount: this.responseEvidenceRowCount,
      noRegressionRowCount: this.noRegressionRowCount,
      proposalCount: this.proposalCount,
      sameSelectedCount: this.sameSelectedCount,
      differentProposalCount: this.differentProposalCount,
      overrideCount: this.overrideCount,
      finalRejectCount: this.finalRejectCount,
      strictKillProposalCount: this.strictKillProposalCount,
      hotAllocationCount: this.hotAllocationCount,
      lastProposal: this.lastProposal
    };
  }
}

module.exports = { VerifiedAttackProposal };
