"use strict";

// Thin production-shaped owner for the validated BP68 contract. Search,
// intent and action-domain generation are injected and can migrate
// independently. No diagnostic arena or V1 VM dependency is permitted here.

const { ACTION, HARD_STATUS } = require("../abi/fast-codes");
const { PROOF_STATUS } = require("../abi/search-codes");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ROOT_CONTROL_MODE } = require("../runtime/root-control-mode");

const OWNER_MEMBERSHIP = Object.freeze({
  UNSEEN: 0,
  HARD_BLOCKED: 1,
  RISK_REJECTED: 2,
  SOURCE_DOMAIN_BLOCKED: 3,
  OWNER_DOMAIN_BLOCKED: 4,
  ALLOWED: 5
});

function basePolicyActionPriority(action) {
  if (action === ACTION.GO) return 5;
  if (action === ACTION.FIRE) return 4;
  if (action === ACTION.CAST_STUN || action === ACTION.THROW_BOMB) return 3;
  if (action === ACTION.TURN_LEFT) return 2;
  if (action === ACTION.TURN_RIGHT) return 1;
  return 0;
}

class NativeBasePolicyActionOwner {
  constructor(options = {}) {
    this.domain = options.domain || null;
    this.intent = options.intent || null;
    this.policySearch = options.policySearch || null;
    this.opponentHistory = options.opponentHistory || null;
    this.riskFrontierMode = options.riskFrontierMode === "joint" ? "joint" :
      options.riskFrontierMode === "acceptable" ? "acceptable" : "off";
    this.riskSoftBandMode = options.riskSoftBandMode === "intent-known" ?
      "intent-known" : "off";
    this.intentValueMode = options.intentValueMode === "off" ? "off" :
      options.intentValueMode === "tie" ? "tie" : "bonus";
    // Stable closed-state ABI for the existing report consumer. These are
    // configuration facts, not dormant behavior branches.
    this.attackPoseOptionFirst = false;
    this.attackPoseRequiredAimTurns = -1;
    this.resourceRequiresCellwiseDominance = false;
    this.intentMembership = false;
    this.nonContactBasePolicy = false;
    this.directAttackBasePolicy = "off";
    this.preemptiveSafetyBasePolicy = "off";
    this.committedSearchMode = "off";
    this.basePolicyVerifierMode = "off";
    this.basePolicyVerifierMargin = 100;
    this.policySearchSupportMode = "all";
    this.verifiedInterceptMode = "off";
    this.verifiedInterceptBand = 400;
    this.poisonProposalMode = "off";
    this.poisonProposalPolicy = "matrix";
    this.qualifiedFireOwnerMode = "off";
    this.allowedRow = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.membership = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.backedValue = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.nominalValue = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.result = { action: ACTION.NONE, argument: 0, row: -1 };
    this.checkCount = 0;
    this.proposalCount = 0;
    this.overrideCount = 0;
    this.sameCount = 0;
    this.noSupportCount = 0;
    this.strictSkipCount = 0;
    this.committedSkipCount = 0;
    this.riskSupportMissingCount = 0;
    this.softRiskCandidateCount = 0;
    this.softRiskIntentAllowedCount = 0;
    this.selectedJointDominatedCount = 0;
    this.nonContactSkipCount = 0;
    this.strictOwnerSkipCount = 0;
    this.noCompleteValueCount = 0;
    this.lastSource = null;
    // The differential reporter reads the historical field name. Keep the
    // same slab, not a second allocation.
    this.membershipStage = this.membership;
  }

  intentAdjustment(row) {
    return this.intent && this.intentValueMode === "bonus" ?
      this.intent.bonus(row) : 0;
  }

  intentTiePrefers(left, right) {
    return this.intent && this.intentValueMode === "tie" && left >= 0 &&
      right >= 0 && this.intent.bonus(left) > this.intent.bonus(right) ? 1 : 0;
  }

  jointRiskTiePrefers(engine, left, right) {
    if (this.riskFrontierMode !== "joint" || left < 0 || right < 0) return 0;
    const risk = engine.riskController;
    return risk && typeof risk.strictlyDominates === "function" &&
      risk.strictlyDominates(left, right) ? 1 : 0;
  }

  better(engine, row, best, value, bestValue, nominal, bestNominal) {
    if (best < 0 || value > bestValue) return 1;
    if (value < bestValue || nominal < bestNominal) return 0;
    if (nominal > bestNominal) return 1;
    if (this.intentTiePrefers(row, best)) return 1;
    if (this.intentTiePrefers(best, row)) return 0;
    if (this.jointRiskTiePrefers(engine, row, best)) return 1;
    if (this.jointRiskTiePrefers(engine, best, row)) return 0;
    const priority = basePolicyActionPriority(engine.ourActions[row]);
    const bestPriority = basePolicyActionPriority(engine.ourActions[best]);
    return priority > bestPriority || priority === bestPriority && row < best ? 1 : 0;
  }

  source(engine, count) {
    if (!this.policySearch || !this.policySearch.prepare(engine, count, null)) {
      this.lastSource = null;
      return null;
    }
    this.lastSource = this.policySearch;
    return this.policySearch;
  }

  selectOverride(engine, selected, incumbentAction) {
    void selected;
    this.checkCount += 1;
    if (this.opponentHistory) this.opponentHistory.observe(engine);
    if (this.intent && typeof this.intent.observeContext === "function")
      this.intent.observeContext(engine);
    if (this.policySearch && typeof this.policySearch.observeRoot === "function")
      this.policySearch.observeRoot(engine, this.intent?.contextEpoch || 0);
    if (!engine.adapter || !engine.adapter.enemyVisible ||
        engine.lastControlMode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT) {
      this.nonContactSkipCount += 1;
      return null;
    }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      this.strictSkipCount += 1;
      this.strictOwnerSkipCount += 1;
      return null;
    }
    if (engine.escapeObligation?.committedEntityCount > 0 &&
        !engine.basePolicyOwnsViableCommitted) {
      this.committedSkipCount += 1;
      return null;
    }
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    const source = this.source(engine, count);
    if (!source) {
      this.noSupportCount += 1;
      this.noCompleteValueCount += 1;
      return null;
    }
    if (this.intent) this.intent.prepare(engine, count);
    const risk = engine.riskController?.outcome;
    if (this.riskFrontierMode !== "off" && (!risk || risk.count < count)) {
      this.riskSupportMissingCount += 1;
      this.noCompleteValueCount += 1;
      return null;
    }
    this.allowedRow.fill(0, 0, count);
    this.membership.fill(OWNER_MEMBERSHIP.UNSEEN, 0, count);
    let best = -1;
    let bestValue = -2147483648;
    let bestNominal = -2147483648;
    for (let row = 0; row < count; row += 1) {
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
        this.membership[row] = OWNER_MEMBERSHIP.HARD_BLOCKED;
        continue;
      }
      if (this.riskFrontierMode !== "off" && !risk.acceptable[row]) {
        this.softRiskCandidateCount += 1;
        const softAllowed = this.riskSoftBandMode === "intent-known" &&
          risk.immediateFatalMass && risk.immediateFatalMass[row] === 0 &&
          risk.unknownMass && risk.unknownMass[row] === 0 &&
          (!risk.dominated || !risk.dominated[row]) && this.intent &&
          this.intent.member(row) > 0;
        if (!softAllowed) {
          this.membership[row] = OWNER_MEMBERSHIP.RISK_REJECTED;
          continue;
        }
        this.softRiskIntentAllowedCount += 1;
      }
      if (source.rootDomainRestricted && !source.rootDomainMask[row]) {
        this.membership[row] = OWNER_MEMBERSHIP.SOURCE_DOMAIN_BLOCKED;
        continue;
      }
      if (this.domain && !this.domain.allows(engine, row)) {
        this.membership[row] = OWNER_MEMBERSHIP.OWNER_DOMAIN_BLOCKED;
        continue;
      }
      const adjustment = this.intentAdjustment(row);
      const value = source.rootScore[row] + adjustment;
      const nominal = (source.rootNominalScore && source.rootNominalCellScore ?
        source.rootNominalScore[row] : source.rootScore[row]) + adjustment;
      this.allowedRow[row] = 1;
      this.membership[row] = OWNER_MEMBERSHIP.ALLOWED;
      this.backedValue[row] = value;
      this.nominalValue[row] = nominal;
      if (this.better(engine, row, best, value, bestValue, nominal, bestNominal)) {
        best = row;
        bestValue = value;
        bestNominal = nominal;
      }
    }
    if (best < 0) {
      this.noSupportCount += 1;
      this.noCompleteValueCount += 1;
      return null;
    }
    if (risk && this.riskFrontierMode === "joint" &&
        typeof engine.riskController.strictlyDominates === "function")
      for (let row = 0; row < count; row += 1) {
        if (row === best || !this.allowedRow[row] ||
            this.backedValue[row] < this.backedValue[best]) continue;
        if (engine.riskController.strictlyDominates(row, best)) {
          this.selectedJointDominatedCount += 1;
          break;
        }
      }
    this.proposalCount += 1;
    const action = engine.ourActions[best];
    if (this.intent && typeof this.intent.commitSelection === "function")
      this.intent.commitSelection(action);
    if (action === incumbentAction) {
      this.sameCount += 1;
      return null;
    }
    this.overrideCount += 1;
    this.result.action = action;
    this.result.argument = engine.ourArguments[best];
    this.result.row = best;
    return this.result;
  }

  summary() {
    return {
      checkCount: this.checkCount,
      proposalCount: this.proposalCount,
      overrideCount: this.overrideCount,
      sameCount: this.sameCount,
      noSupportCount: this.noSupportCount,
      strictSkipCount: this.strictSkipCount,
      committedSkipCount: this.committedSkipCount,
      riskSupportMissingCount: this.riskSupportMissingCount,
      softRiskCandidateCount: this.softRiskCandidateCount,
      softRiskIntentAllowedCount: this.softRiskIntentAllowedCount,
      selectedJointDominatedCount: this.selectedJointDominatedCount,
      riskFrontierMode: this.riskFrontierMode,
      riskSoftBandMode: this.riskSoftBandMode,
      intentValueMode: this.intentValueMode,
      attackPoseOptionFirst: this.attackPoseOptionFirst,
      attackPoseRequiredAimTurns: this.attackPoseRequiredAimTurns,
      resourceRequiresCellwiseDominance: this.resourceRequiresCellwiseDominance,
      intentMembership: this.intentMembership,
      nonContactBasePolicy: this.nonContactBasePolicy,
      directAttackBasePolicy: this.directAttackBasePolicy,
      preemptiveSafetyBasePolicy: this.preemptiveSafetyBasePolicy,
      committedSearchMode: this.committedSearchMode,
      basePolicyVerifierMode: this.basePolicyVerifierMode,
      basePolicyVerifierMargin: this.basePolicyVerifierMargin,
      policySearchSupportMode: this.policySearchSupportMode,
      verifiedInterceptMode: this.verifiedInterceptMode,
      verifiedInterceptBand: this.verifiedInterceptBand,
      poisonProposalMode: this.poisonProposalMode,
      poisonProposalPolicy: this.poisonProposalPolicy,
      qualifiedFireOwnerMode: this.qualifiedFireOwnerMode
    };
  }
}

module.exports = {
  OWNER_MEMBERSHIP,
  basePolicyActionPriority,
  NativeBasePolicyActionOwner
};
