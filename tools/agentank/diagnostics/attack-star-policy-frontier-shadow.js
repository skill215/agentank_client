"use strict";

// Behavior-neutral comparison of an ATTACK policy and the incumbent
// STAR_CONTROL policy over the already-computed bounded rollout.  Unlike the
// rejected one-shot FIRE owner, this class never treats an earlier hit
// deadline as sufficient.  Survival, star progress, combat progress and
// resource occupancy remain separate Pareto dimensions.  It performs no Fast
// transition and owns no action.

const { PAC_STATUS } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");

const FRONTIER = Object.freeze({
  INCOMPLETE: 0,
  UNRESOLVED: 1,
  ATTACK_DOMINATES: 2,
  STAR_DOMINATES: 3,
  TRADEOFF: 4,
  EQUAL: 5
});

class AttackStarPolicyFrontierShadow {
  constructor(interval, utility) {
    this.interval = interval; this.utility = utility;
    this.observationCount = 0; this.evaluationCount = 0;
    this.duplicateSkipCount = 0; this.unalignedUtilityCount = 0;
    this.incompleteCount = 0; this.staticQualifiedCount = 0;
    this.attackProgressCount = 0; this.starProgressCount = 0;
    this.bothProgressCount = 0; this.noProgressCount = 0;
    this.attackDominatesCount = 0; this.starDominatesCount = 0;
    this.tradeoffCount = 0; this.equalCount = 0;
    this.attackSurvivalRegressionCount = 0;
    this.attackStarGainRegressionCount = 0;
    this.attackStarPathRegressionCount = 0;
    this.attackMobilityRegressionCount = 0;
    this.attackResourceCostCount = 0;
    this.policyQualifiedCount = 0; this.strictOwnershipCount = 0;
    this.lastEvaluationSerial = 0; this.lastAttackRow = -1;
    this.lastSelectedRow = -1; this.lastFrontier = FRONTIER.INCOMPLETE;
    this.lastStaticQualified = 0; this.lastPolicyQualified = 0;
    this.hotAllocationCount = 0;
  }

  offensiveGain() {
    const utility = this.utility;
    if (!utility || utility.lastCurrentRiskIndex < 0) return 0;
    const offset = utility.lastCurrentRiskIndex * 5;
    for (let index = 0; index < 5; index += 1)
      if (utility.robust[offset + index] > 0) return 1;
    return 0;
  }

  observe(engine) {
    this.observationCount += 1;
    const interval = this.interval; const utility = this.utility;
    if (!interval || interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return;
    }
    this.lastEvaluationSerial = interval.evaluationSerial;
    const attack = interval.lastAttackRow; const selected = interval.lastSelectedRow;
    this.lastAttackRow = attack; this.lastSelectedRow = selected;
    this.lastStaticQualified = 0; this.lastPolicyQualified = 0;
    if (!utility || utility.lastEvaluationSerial !== interval.evaluationSerial ||
        utility.lastAttackRow !== attack || utility.lastSelectedRow !== selected) {
      this.unalignedUtilityCount += 1; this.lastFrontier = FRONTIER.INCOMPLETE;
      return;
    }
    const rollout = interval.rollout;
    if (attack < 0 || selected < 0 || !rollout.physicalComplete[attack] ||
        !rollout.physicalComplete[selected] || !rollout.rootRestored[attack] ||
        !rollout.rootRestored[selected]) {
      this.incompleteCount += 1; this.lastFrontier = FRONTIER.INCOMPLETE;
      return;
    }
    this.evaluationCount += 1;
    const staticQualified = utility.lastCurrentRiskQualified ? 1 : 0;
    this.lastStaticQualified = staticQualified;
    if (staticQualified) this.staticQualifiedCount += 1;

    const attackFatal = rollout.hardFatal[attack] || rollout.ownCrashed[attack];
    const selectedFatal = rollout.hardFatal[selected] || rollout.ownCrashed[selected];
    const survivalRegression = attackFatal > selectedFatal;
    const starGainRegression = rollout.starGain[attack] < rollout.starGain[selected];
    const starPathRegression = rollout.starDistance[attack] >
      rollout.starDistance[selected];
    const mobilityRegression = rollout.mobility[attack] < rollout.mobility[selected];
    const combat = engine.combat.vector;
    const resourceCost = combat.resourceOccupancy[attack] >
      combat.resourceOccupancy[selected];
    if (survivalRegression) this.attackSurvivalRegressionCount += 1;
    if (starGainRegression) this.attackStarGainRegressionCount += 1;
    if (starPathRegression) this.attackStarPathRegressionCount += 1;
    if (mobilityRegression) this.attackMobilityRegressionCount += 1;
    if (resourceCost) this.attackResourceCostCount += 1;

    const attackProgress = rollout.enemyCrashed[attack] >
        rollout.enemyCrashed[selected] ||
      rollout.projectileThreat[attack] > rollout.projectileThreat[selected] ||
      rollout.enemyMobility[attack] < rollout.enemyMobility[selected] ||
      rollout.ownFireLane[attack] > rollout.ownFireLane[selected] ||
      this.offensiveGain();
    const starProgress = rollout.starGain[selected] > rollout.starGain[attack] ||
      rollout.starDistance[selected] < rollout.starDistance[attack];
    if (attackProgress) this.attackProgressCount += 1;
    if (starProgress) this.starProgressCount += 1;
    if (attackProgress && starProgress) this.bothProgressCount += 1;
    else if (!attackProgress && !starProgress) this.noProgressCount += 1;

    // A row is no worse only when every dimension owned by the other policy is
    // preserved.  No weighted score can hide a lost star path or new death.
    const attackNoWorse = !survivalRegression && !starGainRegression &&
      !starPathRegression && !mobilityRegression && !resourceCost;
    const starSurvivalRegression = selectedFatal > attackFatal;
    const starNoWorse = !starSurvivalRegression &&
      rollout.starGain[selected] >= rollout.starGain[attack] &&
      rollout.starDistance[selected] <= rollout.starDistance[attack] &&
      !attackProgress;
    let frontier = FRONTIER.UNRESOLVED;
    if (attackNoWorse && attackProgress) frontier = FRONTIER.ATTACK_DOMINATES;
    else if (starNoWorse && starProgress) frontier = FRONTIER.STAR_DOMINATES;
    else if (attackProgress || starProgress) frontier = FRONTIER.TRADEOFF;
    else if (!survivalRegression && !starSurvivalRegression &&
        rollout.starGain[attack] === rollout.starGain[selected] &&
        rollout.starDistance[attack] === rollout.starDistance[selected] &&
        rollout.mobility[attack] === rollout.mobility[selected] &&
        !resourceCost) frontier = FRONTIER.EQUAL;
    this.lastFrontier = frontier;
    if (frontier === FRONTIER.ATTACK_DOMINATES) this.attackDominatesCount += 1;
    else if (frontier === FRONTIER.STAR_DOMINATES) this.starDominatesCount += 1;
    else if (frontier === FRONTIER.TRADEOFF) this.tradeoffCount += 1;
    else if (frontier === FRONTIER.EQUAL) this.equalCount += 1;

    // This is a diagnostic qualifier, not an ownership certificate.  It asks
    // whether the rejected one-shot proposal survives a policy-level Pareto
    // comparison.  Strict ownership intentionally remains zero.
    const pac = engine.projectileAttackClosure || engine.projectileAttack;
    const policyQualified = staticQualified &&
      frontier === FRONTIER.ATTACK_DOMINATES &&
      pac && pac.status[attack] === PAC_STATUS.COMPLETE;
    if (policyQualified) {
      this.policyQualifiedCount += 1; this.lastPolicyQualified = 1;
    }
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, noStateTransitions: true,
      multidimensional: true, actionOwnership: false, horizon:
        this.interval?.rollout?.horizon || 0,
      observationCount: this.observationCount,
      evaluationCount: this.evaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      unalignedUtilityCount: this.unalignedUtilityCount,
      incompleteCount: this.incompleteCount,
      staticQualifiedCount: this.staticQualifiedCount,
      attackProgressCount: this.attackProgressCount,
      starProgressCount: this.starProgressCount,
      bothProgressCount: this.bothProgressCount,
      noProgressCount: this.noProgressCount,
      attackDominatesCount: this.attackDominatesCount,
      starDominatesCount: this.starDominatesCount,
      tradeoffCount: this.tradeoffCount, equalCount: this.equalCount,
      attackSurvivalRegressionCount: this.attackSurvivalRegressionCount,
      attackStarGainRegressionCount: this.attackStarGainRegressionCount,
      attackStarPathRegressionCount: this.attackStarPathRegressionCount,
      attackMobilityRegressionCount: this.attackMobilityRegressionCount,
      attackResourceCostCount: this.attackResourceCostCount,
      policyQualifiedCount: this.policyQualifiedCount,
      strictOwnershipCount: this.strictOwnershipCount,
      lastEvaluationSerial: this.lastEvaluationSerial,
      lastAttackRow: this.lastAttackRow, lastSelectedRow: this.lastSelectedRow,
      lastFrontier: this.lastFrontier,
      lastStaticQualified: this.lastStaticQualified,
      lastPolicyQualified: this.lastPolicyQualified,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { FRONTIER, AttackStarPolicyFrontierShadow };
