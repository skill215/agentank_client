"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION, HARD_STATUS } = require("../abi/fast-codes");
const { OPTION_KIND } = require("../policy/option-portfolio");
const { optionSearchOwnableKind, OptionAwareDepthSearch } =
  require("./option-aware-depth-search");
const { INFORMATION_VALUE_MIN, INFORMATION_VALUE_MAX, ProductionInformationSearch } =
  require("./production-information-search");

const OPTION_INFORMATION_STATUS = Object.freeze({ NONE: 0, ORDERING_ONLY: 1, EXACT: 2 });
const ACTION_COUNT = ACTION.CAST_BOOST + 1;

// InformationState search is evidence, not an automatic action owner.  The
// scalar robust estimate is always retained for diagnostics.  Ownership needs
// a separated interval and candidate.lower > incumbent.upper.  Any missing
// world, direction, enemy column, common-policy support, typed Option support,
// budget, or root restore leaves the interval at the full legal value range.
class OptionInformationIntervalSearch {
  constructor(cacheBank, runtimeConfig, riskProfile, options = null) {
    this.evaluator = new OptionAwareDepthSearch(cacheBank, runtimeConfig, null, {
      selectiveContinuationEnabled: false,
      windowedBoundsEnabled: false,
      crossFramePVEnabled: false,
      crossFrameRootPVEnabled: false
    });
    this.evaluator.rootTransitions.setEnabled(false);
    this.information = new ProductionInformationSearch({ runtimeConfig, riskProfile,
      maximumEnemyColumns: options && options.maximumEnemyColumns });
    this.lower = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.upper = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ordering = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.exact = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.optionCount = 0; this.lastStatus = OPTION_INFORMATION_STATUS.NONE;
    this.lastIncumbentOption = -1; this.lastProposalOption = -1;
    this.lastProposalPrimitive = -1;
    this.attemptCount = 0; this.resultCount = 0; this.exactRootCount = 0;
    this.orderingOnlyRootCount = 0; this.resolvedRowCount = 0; this.fullRangeRowCount = 0;
    this.strictDominanceCount = 0; this.differentPrimitiveCount = 0;
    this.overrideCount = 0; this.hardBlockedCount = 0; this.riskBlockedCount = 0;
    this.optionSupportBlockedCount = 0; this.truncatedCount = 0;
    this.noChallengerCount = 0;
    this.totalNodes = 0; this.maximumNodes = 0; this.hotAllocationCount = 0;
    this.proposalKindCount = new Uint32Array(8);
    this.actionTransitionCount = new Uint32Array(ACTION_COUNT * ACTION_COUNT);
    this.active = options && options.active ? 1 : 0;
    this.allowSetupOwnership = options && options.allowSetupOwnership ? 1 : 0;
    this.attackSetupClosure = options && options.attackSetupClosure || null;
  }

  resetRoot() {
    this.optionCount = 0; this.lastStatus = OPTION_INFORMATION_STATUS.NONE;
    this.lastIncumbentOption = -1; this.lastProposalOption = -1;
    this.lastProposalPrimitive = -1;
    this.lower.fill(INFORMATION_VALUE_MIN); this.upper.fill(INFORMATION_VALUE_MAX);
    this.ordering.fill(0); this.exact.fill(0);
  }

  findIncumbent(preferredPrimitiveRow) {
    for (let option = 0; option < this.optionCount; option += 1)
      if (this.evaluator.optionPrimitiveRow[option] === preferredPrimitiveRow) return option;
    return -1;
  }

  publishIntervals(portfolio, globalSupportComplete) {
    const info = this.information;
    const exactRoot = globalSupportComplete && info.supportComplete === 1 &&
      info.approximate === 0 && info.completedDepth === 1 &&
      info.lastContinuationPool === 0 && info.workInterruptedCount === 0 &&
      info.rootRestoreFailures === 0 && this.evaluator.optionTruncated === 0;
    for (let option = 0; option < this.optionCount; option += 1) {
      const value = Math.max(INFORMATION_VALUE_MIN,
        Math.min(INFORMATION_VALUE_MAX, info.rootScore[option] | 0));
      this.ordering[option] = value;
      const source = this.evaluator.optionSourceIndex[option];
      const typed = source === 255 || Boolean(portfolio.supportComplete[source]);
      if (exactRoot && typed) {
        this.lower[option] = value; this.upper[option] = value;
        this.exact[option] = 1; this.resolvedRowCount += 1;
      } else {
        this.fullRangeRowCount += 1;
        if (!typed) this.optionSupportBlockedCount += 1;
      }
    }
    if (exactRoot) { this.lastStatus = OPTION_INFORMATION_STATUS.EXACT;
      this.exactRootCount += 1; }
    else { this.lastStatus = OPTION_INFORMATION_STATUS.ORDERING_ONLY;
      this.orderingOnlyRootCount += 1; }
    return exactRoot ? 1 : 0;
  }

  bestStrictCandidate(incumbent, hardStatus, outcome, combat = null, pac = null,
      enemyCount = 0, escape = null, bundle = null, ourActions = null,
      ourArguments = null, enemyActions = null, enemyArguments = null) {
    if (incumbent < 0 || incumbent >= this.optionCount || !this.exact[incumbent]) return -1;
    let best = -1;
    for (let option = 0; option < this.optionCount; option += 1) {
      if (option === incumbent || !this.exact[option] ||
          this.lower[option] <= this.upper[incumbent]) continue;
      const kind = this.evaluator.optionKind[option];
      const row = this.evaluator.optionPrimitiveRow[option];
      if (hardStatus[row] !== HARD_STATUS.ALLOW) { this.hardBlockedCount += 1; continue; }
      if (!outcome.acceptable[row] || outcome.dominated[row]) {
        this.riskBlockedCount += 1; continue;
      }
      const immediateSetupCertificate = kind === OPTION_KIND.ATTACK_SETUP &&
        this.attackSetupClosure && this.attackSetupClosure.evaluateRow(row, kind,
          this.exact[option], outcome, combat, pac, enemyCount, escape, bundle,
          ourActions, ourArguments, enemyActions, enemyArguments, enemyCount);
      const setupOwnable = immediateSetupCertificate &&
        (!this.attackSetupClosure.allowsOwnership ||
         this.attackSetupClosure.allowsOwnership(row, immediateSetupCertificate)) ||
        !immediateSetupCertificate && kind === OPTION_KIND.ATTACK_SETUP &&
        this.attackSetupClosure && this.attackSetupClosure.allowsOwnership &&
        this.attackSetupClosure.allowsOwnership(row, 0);
      const ownable = optionSearchOwnableKind(kind) ||
        (this.allowSetupOwnership && kind === OPTION_KIND.ATTACK_SETUP) ||
        setupOwnable;
      if (!ownable) continue;
      if (best < 0 || this.lower[option] > this.lower[best] ||
          this.lower[option] === this.lower[best] &&
          (this.upper[option] > this.upper[best] ||
           this.upper[option] === this.upper[best] && option < best)) best = option;
    }
    return best;
  }

  search(bundle, portfolio, ourActions, ourArguments, ourCount,
      enemyActions, enemyArguments, enemyCount, worldCells, worldMass, worldCount,
      supportComplete, nodeBudget, baseRisk, lastDirection, directionComplete,
      enemyProbability, preferredPrimitiveRow, hardStatus, outcome,
      combat = null, pac = null, closureEnemyCount = 0, escape = null,
      possibleProjectiles = null, possibleSupportComplete = 0,
      possibleCadenceRephase = 0, possibleEnemyCanAct = 0) {
    this.resetRoot(); this.attemptCount += 1;
    this.optionCount = this.evaluator.prepareInformationPortfolio(portfolio,
      ourActions, ourArguments, ourCount, preferredPrimitiveRow);
    if (this.evaluator.optionTruncated) this.truncatedCount += 1;
    if (this.optionCount < 2) { this.noChallengerCount += 1; return preferredPrimitiveRow; }
    this.lastIncumbentOption = this.findIncumbent(preferredPrimitiveRow);
    const ok = this.information.search(bundle, this.evaluator,
      this.evaluator.optionActions, this.evaluator.optionArguments, this.optionCount,
      enemyActions, enemyArguments, enemyCount, worldCells, worldMass, worldCount,
      supportComplete, nodeBudget, baseRisk, lastDirection, directionComplete,
      enemyProbability, 1, 0);
    this.evaluator.bindInformationOption(-1);
    this.totalNodes += this.information.nodes;
    if (this.information.nodes > this.maximumNodes) this.maximumNodes = this.information.nodes;
    if (!ok) return preferredPrimitiveRow;
    this.resultCount += 1; this.publishIntervals(portfolio, supportComplete);
    if (this.attackSetupClosure) {
      this.attackSetupClosure.reset(ourCount, preferredPrimitiveRow);
      this.attackSetupClosure.scanTwoStageFrontier(bundle, ourActions, ourArguments,
        ourCount, enemyActions, enemyArguments, enemyCount);
      this.attackSetupClosure.scanPossibleProjectileFrontier(bundle, ourActions,
        ourArguments, ourCount, enemyActions, enemyArguments, enemyCount,
        possibleProjectiles, possibleSupportComplete,
        possibleCadenceRephase, possibleEnemyCanAct);
    }
    const proposal = this.bestStrictCandidate(this.lastIncumbentOption, hardStatus, outcome,
      combat, pac, closureEnemyCount, escape, bundle, ourActions, ourArguments,
      enemyActions, enemyArguments);
    if (proposal < 0) return preferredPrimitiveRow;
    this.lastProposalOption = proposal;
    this.lastProposalPrimitive = this.evaluator.optionPrimitiveRow[proposal];
    this.strictDominanceCount += 1;
    this.proposalKindCount[this.evaluator.optionKind[proposal]] += 1;
    if (this.lastProposalPrimitive !== preferredPrimitiveRow) {
      this.differentPrimitiveCount += 1;
      const from = ourActions[preferredPrimitiveRow];
      const to = ourActions[this.lastProposalPrimitive];
      this.actionTransitionCount[from * ACTION_COUNT + to] += 1;
    }
    if (this.active && this.lastProposalPrimitive !== preferredPrimitiveRow) {
      this.overrideCount += 1; return this.lastProposalPrimitive;
    }
    return preferredPrimitiveRow;
  }

  summary() {
    return { active: Boolean(this.active),
      allowSetupOwnership: Boolean(this.allowSetupOwnership), status: this.lastStatus,
      attemptCount: this.attemptCount, resultCount: this.resultCount,
      exactRootCount: this.exactRootCount,
      orderingOnlyRootCount: this.orderingOnlyRootCount,
      resolvedRowCount: this.resolvedRowCount, fullRangeRowCount: this.fullRangeRowCount,
      strictDominanceCount: this.strictDominanceCount,
      differentPrimitiveCount: this.differentPrimitiveCount,
      overrideCount: this.overrideCount, hardBlockedCount: this.hardBlockedCount,
      riskBlockedCount: this.riskBlockedCount,
      optionSupportBlockedCount: this.optionSupportBlockedCount,
      truncatedCount: this.truncatedCount, noChallengerCount: this.noChallengerCount,
      totalNodes: this.totalNodes,
      maximumNodes: this.maximumNodes, lastProposalPrimitive: this.lastProposalPrimitive,
      proposalKindCount: Array.from(this.proposalKindCount),
      actionTransitionCount: Array.from(this.actionTransitionCount),
      attackSetupClosure: this.attackSetupClosure ?
        this.attackSetupClosure.summary() : null,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OPTION_INFORMATION_STATUS, OptionInformationIntervalSearch };
