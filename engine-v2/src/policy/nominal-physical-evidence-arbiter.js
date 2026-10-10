"use strict";

const { ACTION, HARD_STATUS } = require("../abi/fast-codes");
const { PAC_STATUS } = require("../search/projectile-attack-closure");
const { ARRAY } = require("../state/fast-state");

const NOMINAL_EVIDENCE_REASON = Object.freeze({
  NONE: 0,
  SAME_ACTION: 1,
  INCOMPLETE: 2,
  HARD: 3,
  RISK: 4,
  VALUE: 5,
  ACTION_CLASS: 6,
  VERIFIED_MOVEMENT: 7,
  VERIFIED_ATTACK: 8
});

// A visible pose inside an InformationState is useful search evidence, but it
// is not a complete world.  This arbiter is the only place where that nominal
// Physical value may become an action proposal.  It never writes Hard, Safety,
// Risk or StageMatrix and allocates nothing on the hot path.
class NominalPhysicalEvidenceArbiter {
  constructor(enabled = false) {
    this.enabled = enabled ? 1 : 0;
    this.checkCount = 0; this.proposalCount = 0; this.overrideCount = 0;
    this.movementCount = 0; this.attackCount = 0;
    this.sameActionCount = 0; this.incompleteCount = 0;
    this.hardBlockedCount = 0; this.riskBlockedCount = 0;
    this.valueBlockedCount = 0; this.actionClassBlockedCount = 0;
    this.lastProposal = -1; this.lastReason = NOMINAL_EVIDENCE_REASON.NONE;
    this.hotAllocationCount = 0;
  }

  verifiedMovement(root, row) {
    const action = root.ourActions[row];
    if (!this.movementAction(action)) return 0;
    if (action === ACTION.GO && root.projectedCell[row] ===
        root.adapter.state.arrays[ARRAY.TANK_CELL][0]) return 0;
    return 1;
  }

  movementAction(action) {
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 1 : 0;
  }

  verifiedAttack(root, row) {
    if (root.ourActions[row] !== ACTION.FIRE) return 0;
    const combat = root.combat.vector;
    return combat.directKill[row] &&
      combat.attackClosureStatus[row] === PAC_STATUS.COMPLETE &&
      combat.purposeCompleteness[row] >= 4500 &&
      combat.postFireEscape[row] &&
      combat.ownCounterExposure[row] < 10000 &&
      root.projectileAttack.doomedEnemyColumns[row] > 0 ? 1 : 0;
  }

  select(root, preferred, count) {
    if (!this.enabled || !root.nominalPhysicalRootActive) return preferred;
    this.checkCount += 1; this.lastProposal = -1;
    const search = root.depthSearch;
    if (!search || search.completedDepth < 1 ||
        !search.representativeSupportComplete) {
      this.incompleteCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.INCOMPLETE;
      return preferred;
    }
    const proposal = search.representativeBestRow;
    this.lastProposal = proposal;
    if (proposal < 0 || proposal >= count || preferred < 0 || preferred >= count) {
      this.incompleteCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.INCOMPLETE;
      return preferred;
    }
    if (proposal === preferred) {
      this.sameActionCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.SAME_ACTION;
      return preferred;
    }
    if (root.hardStatus[proposal] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.HARD;
      return preferred;
    }
    const controller = root.riskController; const outcome = controller.outcome;
    if (!outcome.acceptable[proposal] || outcome.dominated[proposal] ||
        controller.riskStrictlyDominates(preferred, proposal)) {
      this.riskBlockedCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.RISK;
      return preferred;
    }
    if (search.rootScore[proposal] <= search.rootScore[preferred]) {
      this.valueBlockedCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.VALUE;
      return preferred;
    }
    // Nominal value refines a proposal class; it does not invent strategic
    // priority between classes.  In particular, a locally better TURN cannot
    // cancel an already qualified skill/attack/escape proposal.
    const movement = this.verifiedMovement(root, proposal) &&
      this.movementAction(root.ourActions[preferred]);
    const attack = movement ? 0 : this.verifiedAttack(root, proposal);
    if (!movement && !attack) {
      this.actionClassBlockedCount += 1;
      this.lastReason = NOMINAL_EVIDENCE_REASON.ACTION_CLASS;
      return preferred;
    }
    this.proposalCount += 1; this.overrideCount += 1;
    if (movement) {
      this.movementCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.VERIFIED_MOVEMENT;
    } else {
      this.attackCount += 1; this.lastReason = NOMINAL_EVIDENCE_REASON.VERIFIED_ATTACK;
    }
    return proposal;
  }

  summary() {
    return { enabled: Boolean(this.enabled), checkCount: this.checkCount,
      proposalCount: this.proposalCount, overrideCount: this.overrideCount,
      movementCount: this.movementCount, attackCount: this.attackCount,
      sameActionCount: this.sameActionCount, incompleteCount: this.incompleteCount,
      hardBlockedCount: this.hardBlockedCount, riskBlockedCount: this.riskBlockedCount,
      valueBlockedCount: this.valueBlockedCount,
      actionClassBlockedCount: this.actionClassBlockedCount,
      lastProposal: this.lastProposal, lastReason: this.lastReason,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NOMINAL_EVIDENCE_REASON, NominalPhysicalEvidenceArbiter };
