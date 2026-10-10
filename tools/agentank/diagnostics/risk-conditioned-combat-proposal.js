"use strict";

// Diagnostic ACTIVE POC for one narrow ownership question: may a complete,
// risk-qualified FIRE whose combat deadline is earlier than the current star
// deadline replace STAR_CONTROL?  The proposal is deliberately downstream of
// Hard/EO/Proof, preserves every Risk dimension, and verifies a bounded
// no-immediate-star-loss rollout.  It is not a production default.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { GLOBAL_MODE } = require("../../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require(
  "../../../engine-v2/src/runtime/escape-obligation");
const { PAC_STATUS } = require(
  "../../../engine-v2/src/search/projectile-attack-closure");
const { StatefulOptionRollout } = require("./stateful-option-rollout");
const { METRIC, CombatUtilityEnvelopeShadow } = require(
  "./combat-utility-envelope-shadow");

class RiskConditionedCombatProposal {
  constructor(options = {}) {
    this.active = options.active ? 1 : 0;
    this.utility = new CombatUtilityEnvelopeShadow(null);
    this.rollout = new StatefulOptionRollout();
    this.candidate = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.metric = new Int16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS * METRIC.COUNT);
    this.checkCount = 0; this.starOwnerRootCount = 0;
    this.staticCandidateCount = 0; this.deadlineCandidateCount = 0;
    this.rolloutCount = 0; this.rolloutTransitionCount = 0;
    this.rolloutIncompleteCount = 0; this.starLossBlockedCount = 0;
    this.survivalBlockedCount = 0; this.proposalCount = 0;
    this.overrideCount = 0; this.finalRejectCount = 0;
    this.committedBlockedCount = 0; this.terminalBlockedCount = 0;
    this.hardBlockedCount = 0; this.riskBlockedCount = 0;
    this.pacBlockedCount = 0; this.utilityBlockedCount = 0;
    this.exposureBlockedCount = 0; this.deadlineBlockedCount = 0;
    this.rootRestoreFailureCount = 0; this.lastProposal = -1;
    this.lastSelected = -1;
    this.hotAllocationCount = 0;
  }

  optionComplete(engine, row, firstKind, secondKind = -1) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          (portfolio.kind[at] === firstKind || portfolio.kind[at] === secondKind))
        return 1;
    return 0;
  }

  offensiveGain(row) {
    const offset = row * METRIC.COUNT;
    for (let metric = 0; metric < METRIC.COUNT; metric += 1)
      if (this.metric[offset + metric] > 0) return 1;
    return 0;
  }

  staticCandidate(engine, row, selected) {
    if (engine.ourActions[row] !== ACTION.FIRE ||
        engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return 0;
    }
    const risk = engine.riskController.outcome;
    if (!risk.acceptable[row] || risk.dominated[row]) {
      this.riskBlockedCount += 1; return 0;
    }
    const combat = engine.combat.vector;
    const pac = engine.projectileAttackClosure || engine.projectileAttack;
    if (!pac || pac.status[row] !== PAC_STATUS.COMPLETE ||
        combat.attackClosureStatus[row] !== PAC_STATUS.COMPLETE ||
        pac.unknownEnemyColumns[row] !== 0 ||
        combat.purposeCompleteness[row] < 4500 ||
        !this.optionComplete(engine, row, OPTION_KIND.DIRECT_KILL,
          OPTION_KIND.ATTACK_SETUP)) {
      this.pacBlockedCount += 1; return 0;
    }
    const offset = row * METRIC.COUNT;
    if (!this.utility.backupAtRisk(engine, row, engine.policy.baseRisk,
        this.metric, offset) || !this.offensiveGain(row)) {
      this.utilityBlockedCount += 1; return 0;
    }
    if (!this.utility.safetyNonRegressive(risk, combat, row, selected) ||
        risk.robustLower[selected] > Math.max(risk.robustLower[row],
          risk.expectedValue[row])) {
      this.exposureBlockedCount += 1; return 0;
    }
    this.staticCandidateCount += 1;
    const attackDeadline = combat.hitDeadline[row];
    const starDeadline = Math.max(1,
      engine.starDistance(engine.projectedCell[selected]) + 1);
    if (attackDeadline > starDeadline) {
      this.deadlineBlockedCount += 1; return 0;
    }
    this.deadlineCandidateCount += 1; return 1;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const leftOffset = left * METRIC.COUNT;
    const rightOffset = right * METRIC.COUNT;
    for (let metric = 0; metric < METRIC.COUNT; metric += 1)
      if (this.metric[leftOffset + metric] !== this.metric[rightOffset + metric])
        return this.metric[leftOffset + metric] >
          this.metric[rightOffset + metric] ? 1 : 0;
    const combat = engine.combat.vector;
    if (combat.ownCounterExposure[left] !== combat.ownCounterExposure[right])
      return combat.ownCounterExposure[left] < combat.ownCounterExposure[right] ? 1 : 0;
    if (combat.postFireEscape[left] !== combat.postFireEscape[right])
      return combat.postFireEscape[left] > combat.postFireEscape[right] ? 1 : 0;
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  evaluate(engine, selected, selectionCount) {
    this.checkCount += 1; this.lastProposal = -1; this.lastSelected = selected;
    if (!engine || selected < 0 || selected >= selectionCount) return -1;
    if (engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE) {
      this.committedBlockedCount += 1; return -1;
    }
    if (engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL) {
      this.terminalBlockedCount += 1; return -1;
    }
    if (!this.optionComplete(engine, selected, OPTION_KIND.STAR_CONTROL) ||
        this.optionComplete(engine, selected, OPTION_KIND.DIRECT_KILL,
          OPTION_KIND.ATTACK_SETUP)) return -1;
    this.starOwnerRootCount += 1;
    this.candidate.fill(0, 0, selectionCount);
    let staticCount = 0;
    for (let row = 0; row < selectionCount; row += 1)
      if (row !== selected && this.staticCandidate(engine, row, selected)) {
        this.candidate[row] = 1; staticCount += 1;
      }
    if (!staticCount) return -1;
    const transitions = this.rollout.transitionCount;
    const restoreFailures = this.rollout.rootRestoreFailureCount;
    const count = this.rollout.evaluate(engine.adapter, engine.ourActions,
      engine.ourArguments, selectionCount);
    this.rolloutCount += 1;
    this.rolloutTransitionCount += this.rollout.transitionCount - transitions;
    this.rootRestoreFailureCount +=
      this.rollout.rootRestoreFailureCount - restoreFailures;
    if (count !== selectionCount || !this.rollout.physicalComplete[selected] ||
        !this.rollout.rootRestored[selected]) {
      this.rolloutIncompleteCount += 1; return -1;
    }
    let best = -1;
    for (let row = 0; row < selectionCount; row += 1) {
      if (!this.candidate[row]) continue;
      if (!this.rollout.physicalComplete[row] || !this.rollout.rootRestored[row]) {
        this.rolloutIncompleteCount += 1; continue;
      }
      if (this.rollout.hardFatal[row] || this.rollout.ownCrashed[row]) {
        this.survivalBlockedCount += 1; continue;
      }
      if (this.rollout.starGain[row] < this.rollout.starGain[selected]) {
        this.starLossBlockedCount += 1; continue;
      }
      if (this.better(engine, row, best)) best = row;
    }
    if (best < 0) return -1;
    this.proposalCount += 1; this.lastProposal = best; return best;
  }

  confirmOverride() { this.overrideCount += 1; }
  rejectFinal() { this.finalRejectCount += 1; }

  // Cold diagnostic capture.  The proposal hot path stays fixed-array only;
  // callers may request at most a small number of these immutable root
  // records after a proposal has already been computed.
  sample(engine, selected, proposal, responsePolicy = null) {
    if (!engine || proposal < 0 || selected < 0) return null;
    const state = engine.adapter.state; const a = state.arrays;
    const risk = engine.riskController.outcome; const combat = engine.combat.vector;
    const row = index => ({
      row: index, action: engine.ourActions[index],
      argument: engine.ourArguments[index], hard: engine.hardStatus[index],
      projectedCell: engine.projectedCell[index],
      projectedDirection: engine.projectedDirection[index],
      acceptable: risk.acceptable[index], dominated: risk.dominated[index],
      immediateFatalMass: risk.immediateFatalMass[index],
      horizonFatalMass: risk.horizonFatalMass[index],
      unknownMass: risk.unknownMass[index],
      earliestFatalFrame: risk.earliestFatalFrame[index],
      escapeSlack: risk.escapeSlack[index], robustLower: risk.robustLower[index],
      expectedValue: risk.expectedValue[index],
      hitDeadline: combat.hitDeadline[index],
      postFireEscape: combat.postFireEscape[index],
      ownCounterExposure: combat.ownCounterExposure[index],
      resourceOccupancy: combat.resourceOccupancy[index],
      purposeCompleteness: combat.purposeCompleteness[index],
      rollout: {
        frames: this.rollout.frames[index],
        complete: this.rollout.physicalComplete[index],
        hardFatal: this.rollout.hardFatal[index],
        ownCrashed: this.rollout.ownCrashed[index],
        enemyCrashed: this.rollout.enemyCrashed[index],
        starGain: this.rollout.starGain[index],
        starDistance: this.rollout.starDistance[index],
        mobility: this.rollout.mobility[index],
        enemyMobility: this.rollout.enemyMobility[index],
        projectileThreat: this.rollout.projectileThreat[index],
        ownFireLane: this.rollout.ownFireLane[index],
        enemyFireLane: this.rollout.enemyFireLane[index]
      }
    });
    return { schemaVersion: 1, sampleKind: "RISK_COMBAT_PROPOSAL_ROOT",
      frame: a[ARRAY.SCALAR][SCALAR.FRAME], stateHashLo: state.hashLo,
      stateHashHi: state.hashHi, ownCell: a[ARRAY.TANK_CELL][0],
      enemyCell: a[ARRAY.TANK_CELL][1], ownDirection: a[ARRAY.TANK_DIR][0],
      enemyDirection: a[ARRAY.TANK_DIR][1], ownStars: a[ARRAY.TANK_STARS][0],
      enemyStars: a[ARRAY.TANK_STARS][1],
      starCell: a[ARRAY.SCALAR][SCALAR.STAR_CELL],
      riskPoint: engine.policy.baseRisk,
      combatMetric: Array.from(this.metric.subarray(
        proposal * METRIC.COUNT, (proposal + 1) * METRIC.COUNT)),
      selected: row(selected), proposal: row(proposal), responsePolicy };
  }

  summary() {
    return { active: Boolean(this.active), checkCount: this.checkCount,
      starOwnerRootCount: this.starOwnerRootCount,
      staticCandidateCount: this.staticCandidateCount,
      deadlineCandidateCount: this.deadlineCandidateCount,
      rolloutCount: this.rolloutCount,
      rolloutTransitionCount: this.rolloutTransitionCount,
      rolloutIncompleteCount: this.rolloutIncompleteCount,
      starLossBlockedCount: this.starLossBlockedCount,
      survivalBlockedCount: this.survivalBlockedCount,
      proposalCount: this.proposalCount, overrideCount: this.overrideCount,
      finalRejectCount: this.finalRejectCount,
      committedBlockedCount: this.committedBlockedCount,
      terminalBlockedCount: this.terminalBlockedCount,
      hardBlockedCount: this.hardBlockedCount,
      riskBlockedCount: this.riskBlockedCount,
      pacBlockedCount: this.pacBlockedCount,
      utilityBlockedCount: this.utilityBlockedCount,
      exposureBlockedCount: this.exposureBlockedCount,
      deadlineBlockedCount: this.deadlineBlockedCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      lastProposal: this.lastProposal, lastSelected: this.lastSelected,
      hotAllocationCount: this.hotAllocationCount + this.utility.hotAllocationCount +
        this.rollout.hotAllocationCount };
  }
}

module.exports = { RiskConditionedCombatProposal };
