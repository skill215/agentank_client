"use strict";

// Native V2 ownership POC. It reuses the already-computed V2 Physical/
// Information minimax root and changes only the final tactical owner: choose
// the maximum worst-reply root value among Physical-Hard-allowed rows, with
// V1's stable action priority as the tie break. No V1 runtime is consulted.

const { ACTION, HARD_STATUS, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ROOT_CONTROL_MODE, ROOT_CONTROL_REASON } = require(
  "../../../engine-v2/src/runtime/root-control-mode");
const { PAC_STATUS } = require("../../../engine-v2/src/search/projectile-attack-closure");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");
const { SUCCESSOR_PROOF } = require("../../../engine-v2/src/fast/deadline-kernel");

function actionPriority(action) {
  if (action === ACTION.GO) return 5;
  if (action === ACTION.FIRE) return 4;
  if (action === ACTION.CAST_STUN || action === ACTION.THROW_BOMB) return 3;
  if (action === ACTION.TURN_LEFT) return 2;
  if (action === ACTION.TURN_RIGHT) return 1;
  return 0;
}

function resourceAction(action) {
  return action === ACTION.THROW_BOMB ||
    action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST;
}

const QUALIFIED_FIRE_CLASS = Object.freeze({
  NONE: 0,
  INTENT_FLIP: 1,
  RESPONSE_TRADEOFF: 2,
  FIRE_DOMINATES: 4,
  BEST_DOMINATES: 8
});

// Diagnostic-only trace of the first ownership layer that stopped each row.
// The differential reporter consumes this fixed array instead of re-running
// mutable intent/domain logic after selection.
const MEMBERSHIP_STAGE = Object.freeze({
  UNSEEN: 0,
  HARD_BLOCKED: 1,
  RISK_REJECTED: 2,
  RISK_PARETO_BLOCKED: 3,
  COMMITTED_BLOCKED: 4,
  SOURCE_DOMAIN_BLOCKED: 5,
  OWNER_DOMAIN_BLOCKED: 6,
  INTENT_BLOCKED: 7,
  ALLOWED: 8
});

class NativeTacticalActionOwnerPoc {
  constructor(options = {}) {
    this.domain = options.domain || null;
    this.intent = options.intent || null;
    this.attackPoseOption = options.attackPoseOption || null;
    this.attackPosePolicySearch = options.attackPosePolicySearch || null;
    this.policySearch = options.policySearch || null;
    this.policySearchSupportMode = options.policySearchSupportMode === "exact" ?
      "exact" : options.policySearchSupportMode === "strict" ? "strict" : "all";
    this.riskFrontierMode = options.riskFrontierMode === "joint" ? "joint" :
      options.riskFrontierMode === "pareto" ? "pareto" :
      options.riskFrontierMode === "acceptable" ? "acceptable" : "off";
    this.riskSoftBandMode = options.riskSoftBandMode === "intent-known" ?
      "intent-known" : "off";
    this.intentValueMode = options.intentValueMode === "tie" ? "tie" :
      options.intentValueMode === "off" ? "off" : "bonus";
    this.terminalTradeAudit = options.terminalTradeAudit || null;
    this.candidateForcedWin = options.candidateForcedWin || null;
    this.nonContactBasePolicy = options.nonContactBasePolicy === true;
    this.nonContactBaseTerminalOnly =
      options.nonContactBaseTerminalOnly === true;
    this.directAttackBasePolicy = options.directAttackBasePolicy === "active" ?
      "active" : options.directAttackBasePolicy === "shadow" ? "shadow" : "off";
    this.preemptiveSafetyBasePolicy = options.preemptiveSafetyBasePolicy === "active" ?
      "active" : options.preemptiveSafetyBasePolicy === "shadow" ? "shadow" : "off";
    this.committedSearchMode = options.committedSearchMode === "viable" ?
      "viable" : "off";
    this.preemptiveOrigin = -1; this.preemptiveEscapeDirection = -1;
    this.preemptiveBulletDirection = -1; this.preemptiveCreatedFrame = -1;
    this.preemptiveExpiresFrame = -1;
    this.lastSource = null;
    this.attackPoseBand = Math.max(0, options.attackPoseBand | 0);
    this.attackPoseOptionFirst = options.attackPoseOptionFirst === true;
    this.attackPoseRequiredAimTurns = Number.isInteger(
      options.attackPoseRequiredAimTurns) && options.attackPoseRequiredAimTurns >= 0 &&
      options.attackPoseRequiredAimTurns <= 2 ?
      options.attackPoseRequiredAimTurns : -1;
    this.exactFireDomainBypass = options.exactFireDomainBypass === true;
    this.opponentBlendBasisPoints = Math.max(0, Math.min(10000,
      options.opponentBlendBasisPoints | 0));
    this.resourceRequiresCellwiseDominance =
      options.resourceRequiresCellwiseDominance === true;
    this.resourceCellwiseDominanceScope =
      options.resourceCellwiseDominanceScope === "bomb" ? "bomb" :
      options.resourceCellwiseDominanceScope === "skill" ? "skill" :
      this.resourceRequiresCellwiseDominance ? "all" : "none";
    this.intentMembership = options.intentMembership === true;
    this.basePolicyVerifierMode = options.basePolicyVerifierMode === "margin" ?
      "margin" : options.basePolicyVerifierMode === "cellwise" ? "cellwise" : "off";
    this.basePolicyVerifierMargin = Math.max(0, Math.min(32000,
      Number.isInteger(options.basePolicyVerifierMargin) ?
        options.basePolicyVerifierMargin : 100));
    this.verifiedInterceptMode = options.verifiedInterceptMode === "active" ?
      "active" : options.verifiedInterceptMode === "shadow" ? "shadow" : "off";
    this.verifiedInterceptBand = Math.max(0, Math.min(32000,
      Number.isInteger(options.verifiedInterceptBand) ?
        options.verifiedInterceptBand : 400));
    this.fireEvidenceSelection = options.fireEvidenceSelection === true;
    const qualifiedFireOwnerMode = options.qualifiedFireOwnerMode;
    this.qualifiedFireOwnerMode =
      qualifiedFireOwnerMode === "intent-shadow" ||
      qualifiedFireOwnerMode === "intent-active" ||
      qualifiedFireOwnerMode === "response-shadow" ||
      qualifiedFireOwnerMode === "response-active" ?
        qualifiedFireOwnerMode : "off";
    this.poisonProposalMode = options.poisonProposalMode === "active" ?
      "active" : options.poisonProposalMode === "shadow" ? "shadow" : "off";
    this.poisonProposalPolicy = options.poisonProposalPolicy ===
      "deferred-left-contact" ? "deferred-left-contact" : "matrix";
    this.lastPoisonProposal = -1;
    this.captureFrames = Array.isArray(options.captureFrames) ?
      new Set(options.captureFrames.map(value => value | 0)) : null;
    this.captureAllRoots = options.captureAllRoots === true;
    this.captureRootLimit = Math.max(1, Math.min(256,
      Number.isInteger(options.captureRootLimit) ? options.captureRootLimit : 128));
    this.attackPoseActiveFrames = Array.isArray(options.attackPoseActiveFrames) ?
      new Set(options.attackPoseActiveFrames.map(value => value | 0)) : null;
    this.rootSamples = this.captureFrames || this.captureAllRoots ? [] : null;
    this.nominalProbability = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.allowedRow = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.membershipStage = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.backedValue = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.nominalBackedValue = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.checkCount = 0; this.nonContactSkipCount = 0;
    this.nonContactBaseCheckCount = 0; this.nonContactBaseProposalCount = 0;
    this.nonContactBaseOverrideCount = 0; this.nonContactBaseMissingCount = 0;
    this.directAttackCheckCount = 0; this.directAttackProposalCount = 0;
    this.directAttackSameCount = 0; this.directAttackOverrideCount = 0;
    this.directAttackMissingCount = 0; this.directAttackHardBlockedCount = 0;
    this.directAttackShadowSearchSameCount = 0;
    this.directAttackShadowSearchDifferentCount = 0;
    this.preemptiveCheckCount = 0; this.preemptiveProposalCount = 0;
    this.preemptiveContinuationCheckCount = 0;
    this.preemptiveContinuationProposalCount = 0;
    this.preemptiveSameCount = 0; this.preemptiveOverrideCount = 0;
    this.preemptiveMissingCount = 0; this.preemptiveHardBlockedCount = 0;
    this.preemptiveShadowSearchSameCount = 0;
    this.preemptiveShadowSearchDifferentCount = 0;
    this.strictOwnerSkipCount = 0; this.committedSkipCount = 0;
    this.committedSearchCount = 0;
    this.committedSearchCompleteCount = 0;
    this.committedSearchIncompleteCount = 0;
    this.committedSearchNoMemberCount = 0;
    this.committedSearchMemberBlockedCount = 0;
    this.committedSearchSelectionViolationCount = 0;
    this.noCompleteValueCount = 0; this.proposalCount = 0;
    this.policySearchStrictSupportBlockedCount = 0;
    this.policySearchExactSupportBlockedCount = 0;
    this.sameActionCount = 0; this.overrideCount = 0;
    this.physicalOwnerCount = 0; this.informationOwnerCount = 0;
    this.goOverrideCount = 0; this.turnOverrideCount = 0;
    this.fireOverrideCount = 0; this.otherOverrideCount = 0;
    this.domainBlockedCount = 0;
    this.riskSupportMissingCount = 0;
    this.riskRejectedCount = 0;
    this.riskDominatedCount = 0;
    this.softRiskCandidateCount = 0;
    this.softRiskIntentAllowedCount = 0;
    this.softRiskImmediateBlockedCount = 0;
    this.softRiskUnknownBlockedCount = 0;
    this.softRiskDominatedBlockedCount = 0;
    this.softRiskIntentBlockedCount = 0;
    this.selectedRiskOnlyDominatedCount = 0;
    this.selectedJointDominatedCount = 0;
    this.exactFireBypassCount = 0;
    this.nominalBackupCount = 0; this.nominalBackupSkipCount = 0;
    this.pathNominalTieBreakCount = 0;
    this.resourceDominanceCheckCount = 0;
    this.resourceDominanceAcceptedCount = 0;
    this.resourceDominanceRejectedCount = 0;
    this.intentMembershipRootCount = 0;
    this.intentMembershipBlockedCount = 0;
    this.basePolicyVerifierCheckCount = 0;
    this.basePolicyVerifierAvailableCount = 0;
    this.basePolicyVerifierKeptCount = 0;
    this.basePolicyVerifierSearchOverrideCount = 0;
    this.basePolicyVerifierResourceBlockedCount = 0;
    this.verifiedInterceptCheckCount = 0;
    this.verifiedInterceptFireRowCount = 0;
    this.verifiedInterceptValueBlockedCount = 0;
    this.verifiedInterceptClosureBlockedCount = 0;
    this.verifiedInterceptNoDoomedResponseCount = 0;
    this.verifiedInterceptUnknownResponseCount = 0;
    this.verifiedInterceptEscapeBlockedCount = 0;
    this.verifiedInterceptPurposeBlockedCount = 0;
    this.verifiedInterceptExposureBlockedCount = 0;
    this.verifiedInterceptEvidenceCount = 0;
    this.verifiedInterceptWouldOverrideCount = 0;
    this.verifiedInterceptOverrideCount = 0;
    this.fireEvidenceCheckCount = 0;
    this.fireEvidenceSupportedCount = 0;
    this.fireEvidenceIncompleteCount = 0;
    this.fireEvidenceDemotionCount = 0;
    this.fireEvidenceNoAlternativeCount = 0;
    this.poisonProposalCheckCount = 0; this.poisonProposalRowCount = 0;
    this.poisonProposalVisibilityBlockedCount = 0;
    this.poisonProposalAlreadyActiveBlockedCount = 0;
    this.poisonProposalEnemyEffectBlockedCount = 0;
    this.poisonProposalCadenceBlockedCount = 0;
    this.poisonProposalRelevanceBlockedCount = 0;
    this.poisonProposalPolicyBlockedCount = 0;
    this.poisonProposalRiskBlockedCount = 0;
    this.poisonProposalCommittedBlockedCount = 0;
    this.poisonProposalValueBlockedCount = 0;
    this.poisonProposalCellwiseBlockedCount = 0;
    this.poisonProposalBasePolicyBlockedCount = 0;
    this.poisonProposalEvidenceCount = 0;
    this.poisonProposalWouldOverrideCount = 0;
    this.poisonProposalOverrideCount = 0;
    this.attackPosePrepareCount = 0; this.attackPoseEvidenceCount = 0;
    this.attackPoseOverrideCount = 0; this.attackPoseSameCount = 0;
    this.attackPoseTerminalProtectedCount = 0;
    this.attackPoseTerminalLossRejectedCount = 0;
    this.attackPoseAimTurnAcceptedCount = 0;
    this.attackPoseAimTurnRejectedCount = 0;
    // BP6 is observation-only.  These fixed counters explain whether the
    // newly admitted enemy-stunned roots suppress FIRE because of domain,
    // value, or a later selector.  They never participate in selection.
    this.stunWindowRootCount = 0; this.stunWindowStrictSkipCount = 0;
    this.stunWindowCommittedSkipCount = 0;
    this.stunWindowCompleteSearchCount = 0;
    this.stunWindowIncompleteSearchCount = 0;
    this.stunWindowFireMissingCount = 0;
    this.stunWindowFireHardBlockedCount = 0;
    this.stunWindowFireDomainBlockedCount = 0;
    this.stunWindowFireSourceDomainBlockedCount = 0;
    this.stunWindowFireOwnerDomainBlockedCount = 0;
    this.stunWindowFireIntentBlockedCount = 0;
    this.stunWindowOwnProjectileCount = 0;
    this.stunWindowFireLockCount = 0;
    this.stunWindowFireEligibleCount = 0;
    this.stunWindowFireMinimaxBestCount = 0;
    this.stunWindowFireFinalSelectedCount = 0;
    this.stunWindowFireDirectKillCount = 0;
    this.stunWindowFirePossibleHitCount = 0;
    this.stunWindowFireInterceptCount = 0;
    this.stunWindowFireAimSetupCount = 0;
    this.stunWindowFirePostEscapeCount = 0;
    this.stunWindowFirePurposeCompleteCount = 0;
    this.stunWindowFireVerifiedOpportunityCount = 0;
    this.stunWindowIncumbentActionCount = new Uint32Array(24);
    this.stunWindowMinimaxActionCount = new Uint32Array(24);
    this.stunWindowFinalActionCount = new Uint32Array(24);
    this.stunWindowFireGapHistogram = new Uint32Array(8);
    this.qualifiedFireRootCount = 0; this.qualifiedFirePresentCount = 0;
    this.qualifiedFireAllowedCount = 0;
    this.qualifiedFireRiskRejectedCount = 0;
    this.qualifiedFireRiskDominatedCount = 0;
    this.qualifiedFirePurposeCount = 0;
    this.qualifiedFireDirectKillCount = 0;
    this.qualifiedFirePossibleHitCount = 0;
    this.qualifiedFireInterceptCount = 0;
    this.qualifiedFireAimSetupCount = 0;
    this.qualifiedFireEnemyDoomedCount = 0;
    this.qualifiedFireUnknownResponseCount = 0;
    this.qualifiedFirePostEscapeCount = 0;
    this.qualifiedFireClosureCompleteCount = 0;
    this.qualifiedFireVerifiedCount = 0;
    this.qualifiedFireMinimaxSelectedCount = 0;
    this.qualifiedFireFinalSelectedCount = 0;
    this.qualifiedFireValueLossCount = 0;
    this.qualifiedFireTieLossCount = 0;
    this.qualifiedFireRawWorstLossCount = 0;
    this.qualifiedFireRawWorstTieCount = 0;
    this.qualifiedFireRawWorstWinCount = 0;
    this.qualifiedFireNominalFlipCount = 0;
    this.qualifiedFireIntentFlipCount = 0;
    this.qualifiedFireIntentGapSum = 0;
    this.qualifiedFireTerminalLossCount = 0;
    this.qualifiedFireDominatesBestCount = 0;
    this.qualifiedFireDominatedByBestCount = 0;
    this.qualifiedFireMatrixTradeoffCount = 0;
    this.qualifiedFireValueGapSum = 0;
    this.qualifiedFireValueGapMax = 0;
    this.qualifiedFireBestActionCount = new Uint32Array(24);
    this.qualifiedFireReasonCount = new Uint32Array(9);
    this.qualifiedFireGapHistogram = new Uint32Array(8);
    this.lastQualifiedFireRow = -1;
    this.lastQualifiedFireBestRow = -1;
    this.lastQualifiedFireClass = QUALIFIED_FIRE_CLASS.NONE;
    this.qualifiedFireAuditEpoch = 0;
    this.qualifiedFireOracleAuditEpoch = -1;
    // BP9 is a fidelity audit over qualified FIRE rows that lose every root
    // response cell.  It reads V1 oracle evidence after selection and cannot
    // alter the selected action.
    this.qualifiedFireOracleAuditCount = 0;
    this.qualifiedFireOracleMissingCount = 0;
    this.qualifiedFireOraclePairComparedCount = 0;
    this.qualifiedFireOracleFireLowerCount = 0;
    this.qualifiedFireOracleFireTieCount = 0;
    this.qualifiedFireOracleFireHigherCount = 0;
    this.qualifiedFireOracleBestAgreementCount = 0;
    this.qualifiedFireOracleBestFireCount = 0;
    this.qualifiedFireOracleGapSum = 0;
    this.qualifiedFireOracleGapMax = 0;
    this.qualifiedFireOneStepFireComparedCount = 0;
    this.qualifiedFireOneStepFireMismatchCount = 0;
    this.qualifiedFireOneStepFireUnsupportedCount = 0;
    this.qualifiedFireOneStepBestComparedCount = 0;
    this.qualifiedFireOneStepBestMismatchCount = 0;
    this.qualifiedFireOneStepBestUnsupportedCount = 0;
    this.qualifiedFireDeepFireComparedCount = 0;
    this.qualifiedFireDeepFireMismatchCount = 0;
    this.qualifiedFireDeepFireUnsupportedCount = 0;
    this.qualifiedFireDeepBestComparedCount = 0;
    this.qualifiedFireDeepBestMismatchCount = 0;
    this.qualifiedFireDeepBestUnsupportedCount = 0;
    this.qualifiedFireOneStepFireComponentSignedDifference = new Int32Array(8);
    this.qualifiedFireOneStepFireComponentAbsDifference = new Uint32Array(8);
    this.qualifiedFireOneStepBestComponentSignedDifference = new Int32Array(8);
    this.qualifiedFireOneStepBestComponentAbsDifference = new Uint32Array(8);
    this.qualifiedFireDeepFireComponentSignedDifference = new Int32Array(8);
    this.qualifiedFireDeepFireComponentAbsDifference = new Uint32Array(8);
    this.qualifiedFireDeepBestComponentSignedDifference = new Int32Array(8);
    this.qualifiedFireDeepBestComponentAbsDifference = new Uint32Array(8);
    // Isolate the roots where V1 ranks FIRE above the native-selected action.
    // Those are the actual native-value defect cohort; totals over all roots
    // would mix them with the 75% where both engines reject FIRE.
    this.qualifiedFireMismatchOneStepFireComponentSignedDifference =
      new Int32Array(8);
    this.qualifiedFireMismatchOneStepFireComponentAbsDifference =
      new Uint32Array(8);
    this.qualifiedFireMismatchOneStepBestComponentSignedDifference =
      new Int32Array(8);
    this.qualifiedFireMismatchOneStepBestComponentAbsDifference =
      new Uint32Array(8);
    this.qualifiedFireMismatchDeepFireComponentSignedDifference =
      new Int32Array(8);
    this.qualifiedFireMismatchDeepFireComponentAbsDifference =
      new Uint32Array(8);
    this.qualifiedFireMismatchDeepBestComponentSignedDifference =
      new Int32Array(8);
    this.qualifiedFireMismatchDeepBestComponentAbsDifference =
      new Uint32Array(8);
    this.qualifiedFireMismatchOneStepFireComparedCount = 0;
    this.qualifiedFireMismatchOneStepFireMismatchCount = 0;
    this.qualifiedFireMismatchOneStepFireUnsupportedCount = 0;
    this.qualifiedFireMismatchOneStepBestComparedCount = 0;
    this.qualifiedFireMismatchOneStepBestMismatchCount = 0;
    this.qualifiedFireMismatchOneStepBestUnsupportedCount = 0;
    this.qualifiedFireMismatchDeepFireComparedCount = 0;
    this.qualifiedFireMismatchDeepFireMismatchCount = 0;
    this.qualifiedFireMismatchDeepFireUnsupportedCount = 0;
    this.qualifiedFireMismatchDeepBestComparedCount = 0;
    this.qualifiedFireMismatchDeepBestMismatchCount = 0;
    this.qualifiedFireMismatchDeepBestUnsupportedCount = 0;
    this.qualifiedFireOwnerCheckCount = 0;
    this.qualifiedFireOwnerIntentProposalCount = 0;
    this.qualifiedFireOwnerResponseProposalCount = 0;
    this.qualifiedFireOwnerClosureBlockedCount = 0;
    this.qualifiedFireOwnerWouldOverrideCount = 0;
    this.qualifiedFireOwnerOverrideCount = 0;
    this.qualifiedFireOwnerSameCount = 0;
    this.hotAllocationCount = 0;
  }

  fireGapBucket(gap) {
    if (gap <= 0) return 0;
    if (gap <= 100) return 1;
    if (gap <= 250) return 2;
    if (gap <= 500) return 3;
    if (gap <= 1000) return 4;
    if (gap <= 2000) return 5;
    if (gap <= 4000) return 6;
    return 7;
  }

  auditQualifiedFire(engine, count, minimaxBest, minimaxBestValue, nominalReady) {
    this.qualifiedFireAuditEpoch += 1;
    this.lastQualifiedFireRow = -1;
    this.lastQualifiedFireBestRow = -1;
    this.lastQualifiedFireClass = QUALIFIED_FIRE_CLASS.NONE;
    this.qualifiedFireRootCount += 1;
    let firePresent = 0; let fireRow = -1;
    for (let row = 0; row < count; row += 1) {
      if (engine.ourActions[row] !== ACTION.FIRE) continue;
      firePresent = 1;
      if (!this.allowedRow[row]) continue;
      if (fireRow < 0 || this.backedValue[row] > this.backedValue[fireRow])
        fireRow = row;
    }
    this.qualifiedFirePresentCount += firePresent;
    if (fireRow < 0) return;
    this.qualifiedFireAllowedCount += 1;
    const risk = engine.riskController?.outcome;
    if (!risk || fireRow >= risk.count || !risk.acceptable[fireRow]) {
      this.qualifiedFireRiskRejectedCount += 1; return;
    }
    if (risk.dominated[fireRow]) {
      this.qualifiedFireRiskDominatedCount += 1; return;
    }
    const combat = engine.combat?.vector;
    if (!combat || fireRow >= combat.count) return;
    const purpose = combat.purposeCompleteness?.[fireRow] >= 4500 &&
      (combat.directKill?.[fireRow] || combat.possibleHit?.[fireRow] ||
       combat.intercept?.[fireRow] || combat.aimSetup?.[fireRow]);
    if (!purpose) return;
    this.qualifiedFirePurposeCount += 1;
    this.qualifiedFireDirectKillCount += combat.directKill?.[fireRow] ? 1 : 0;
    this.qualifiedFirePossibleHitCount += combat.possibleHit?.[fireRow] ? 1 : 0;
    this.qualifiedFireInterceptCount += combat.intercept?.[fireRow] ? 1 : 0;
    this.qualifiedFireAimSetupCount += combat.aimSetup?.[fireRow] ? 1 : 0;
    this.qualifiedFireEnemyDoomedCount +=
      combat.enemyDoomedFirstActions?.[fireRow] > 0 ? 1 : 0;
    this.qualifiedFireUnknownResponseCount +=
      combat.unknownResponseCount?.[fireRow] > 0 ? 1 : 0;
    if (!combat.postFireEscape[fireRow]) return;
    this.qualifiedFirePostEscapeCount += 1;
    if (combat.attackClosureStatus[fireRow] === PAC_STATUS.COMPLETE)
      this.qualifiedFireClosureCompleteCount += 1;
    this.qualifiedFireVerifiedCount += 1;
    this.lastQualifiedFireRow = fireRow;
    this.lastQualifiedFireBestRow = minimaxBest;
    const reason = engine.controlMode?.context?.reason | 0;
    if (reason >= 0 && reason < this.qualifiedFireReasonCount.length)
      this.qualifiedFireReasonCount[reason] += 1;
    const bestAction = engine.ourActions[minimaxBest];
    if (bestAction >= 0 && bestAction < this.qualifiedFireBestActionCount.length)
      this.qualifiedFireBestActionCount[bestAction] += 1;
    if (minimaxBest === fireRow) {
      this.qualifiedFireMinimaxSelectedCount += 1; return;
    }
    const fireValue = this.backedValue[fireRow];
    const gap = minimaxBestValue - fireValue;
    if (gap > 0) this.qualifiedFireValueLossCount += 1;
    else this.qualifiedFireTieLossCount += 1;
    if (fireValue <= -30000) this.qualifiedFireTerminalLossCount += 1;
    this.qualifiedFireValueGapSum += gap;
    if (gap > this.qualifiedFireValueGapMax) this.qualifiedFireValueGapMax = gap;
    this.qualifiedFireGapHistogram[this.fireGapBucket(gap)] += 1;
    const source = this.lastSource;
    const rawFire = source.rootScore[fireRow];
    const rawBest = source.rootScore[minimaxBest];
    if (rawFire < rawBest) this.qualifiedFireRawWorstLossCount += 1;
    else if (rawFire === rawBest) this.qualifiedFireRawWorstTieCount += 1;
    else this.qualifiedFireRawWorstWinCount += 1;
    const backupFire = this.backedUpValue(source, fireRow,
      engine.enemyCount, nominalReady);
    const backupBest = this.backedUpValue(source, minimaxBest,
      engine.enemyCount, nominalReady);
    if (rawFire >= rawBest && backupFire < backupBest)
      this.qualifiedFireNominalFlipCount += 1;
    const fireIntent = fireValue - backupFire;
    const bestIntent = minimaxBestValue - backupBest;
    if (backupFire >= backupBest && fireValue < minimaxBestValue) {
      this.qualifiedFireIntentFlipCount += 1;
      this.lastQualifiedFireClass |= QUALIFIED_FIRE_CLASS.INTENT_FLIP;
    }
    if (bestIntent > fireIntent)
      this.qualifiedFireIntentGapSum += bestIntent - fireIntent;
    if (!source.rootCellScore || !(engine.enemyCount > 0)) return;
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    let fireNoWorse = 1; let bestNoWorse = 1;
    let fireStrict = 0; let bestStrict = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const fire = source.rootCellScore[fireRow * stride + column];
      const best = source.rootCellScore[minimaxBest * stride + column];
      if (fire < best) fireNoWorse = 0;
      else if (fire > best) fireStrict = 1;
      if (best < fire) bestNoWorse = 0;
      else if (best > fire) bestStrict = 1;
    }
    if (fireNoWorse && fireStrict) {
      this.qualifiedFireDominatesBestCount += 1;
      this.lastQualifiedFireClass |= QUALIFIED_FIRE_CLASS.FIRE_DOMINATES;
    } else if (bestNoWorse && bestStrict) {
      this.qualifiedFireDominatedByBestCount += 1;
      this.lastQualifiedFireClass |= QUALIFIED_FIRE_CLASS.BEST_DOMINATES;
    } else {
      this.qualifiedFireMatrixTradeoffCount += 1;
      if (backupFire < backupBest)
        this.lastQualifiedFireClass |= QUALIFIED_FIRE_CLASS.RESPONSE_TRADEOFF;
    }
  }

  accumulateQualifiedFireTransitionEvidence(search, action, fire) {
    if (action < 0 || action >= 24) return;
    if (fire) {
      this.qualifiedFireOneStepFireComparedCount +=
        search.lastTransitionOwnCompared?.[action] || 0;
      this.qualifiedFireOneStepFireMismatchCount +=
        search.lastTransitionOwnMismatch?.[action] || 0;
      this.qualifiedFireOneStepFireUnsupportedCount +=
        search.lastTransitionOwnUnsupported?.[action] || 0;
      this.qualifiedFireDeepFireComparedCount +=
        search.lastDeepRootCompared?.[action] || 0;
      this.qualifiedFireDeepFireMismatchCount +=
        search.lastDeepRootMismatch?.[action] || 0;
      this.qualifiedFireDeepFireUnsupportedCount +=
        search.lastDeepRootUnsupported?.[action] || 0;
    } else {
      this.qualifiedFireOneStepBestComparedCount +=
        search.lastTransitionOwnCompared?.[action] || 0;
      this.qualifiedFireOneStepBestMismatchCount +=
        search.lastTransitionOwnMismatch?.[action] || 0;
      this.qualifiedFireOneStepBestUnsupportedCount +=
        search.lastTransitionOwnUnsupported?.[action] || 0;
      this.qualifiedFireDeepBestComparedCount +=
        search.lastDeepRootCompared?.[action] || 0;
      this.qualifiedFireDeepBestMismatchCount +=
        search.lastDeepRootMismatch?.[action] || 0;
      this.qualifiedFireDeepBestUnsupportedCount +=
        search.lastDeepRootUnsupported?.[action] || 0;
    }
    for (let component = 0; component < 8; component += 1) {
      const at = action * 8 + component;
      if (fire) {
        this.qualifiedFireOneStepFireComponentSignedDifference[component] +=
          search.lastTransitionOwnComponentSignedDifference?.[at] || 0;
        this.qualifiedFireOneStepFireComponentAbsDifference[component] +=
          search.lastTransitionOwnComponentAbsDifference?.[at] || 0;
        this.qualifiedFireDeepFireComponentSignedDifference[component] +=
          search.lastDeepRootComponentSignedDifference?.[at] || 0;
        this.qualifiedFireDeepFireComponentAbsDifference[component] +=
          search.lastDeepRootComponentAbsDifference?.[at] || 0;
      } else {
        this.qualifiedFireOneStepBestComponentSignedDifference[component] +=
          search.lastTransitionOwnComponentSignedDifference?.[at] || 0;
        this.qualifiedFireOneStepBestComponentAbsDifference[component] +=
          search.lastTransitionOwnComponentAbsDifference?.[at] || 0;
        this.qualifiedFireDeepBestComponentSignedDifference[component] +=
          search.lastDeepRootComponentSignedDifference?.[at] || 0;
        this.qualifiedFireDeepBestComponentAbsDifference[component] +=
          search.lastDeepRootComponentAbsDifference?.[at] || 0;
      }
    }
  }

  accumulateQualifiedFireMismatchComponents(search, action, fire) {
    if (action < 0 || action >= 24) return;
    for (let component = 0; component < 8; component += 1) {
      const at = action * 8 + component;
      if (fire) {
        this.qualifiedFireMismatchOneStepFireComponentSignedDifference[component] +=
          search.lastTransitionOwnComponentSignedDifference?.[at] || 0;
        this.qualifiedFireMismatchOneStepFireComponentAbsDifference[component] +=
          search.lastTransitionOwnComponentAbsDifference?.[at] || 0;
        this.qualifiedFireMismatchDeepFireComponentSignedDifference[component] +=
          search.lastDeepRootComponentSignedDifference?.[at] || 0;
        this.qualifiedFireMismatchDeepFireComponentAbsDifference[component] +=
          search.lastDeepRootComponentAbsDifference?.[at] || 0;
      } else {
        this.qualifiedFireMismatchOneStepBestComponentSignedDifference[component] +=
          search.lastTransitionOwnComponentSignedDifference?.[at] || 0;
        this.qualifiedFireMismatchOneStepBestComponentAbsDifference[component] +=
          search.lastTransitionOwnComponentAbsDifference?.[at] || 0;
        this.qualifiedFireMismatchDeepBestComponentSignedDifference[component] +=
          search.lastDeepRootComponentSignedDifference?.[at] || 0;
        this.qualifiedFireMismatchDeepBestComponentAbsDifference[component] +=
          search.lastDeepRootComponentAbsDifference?.[at] || 0;
      }
    }
  }

  auditDominatedQualifiedFireAgainstOracle(engine, recursion) {
    if (!(this.lastQualifiedFireClass & QUALIFIED_FIRE_CLASS.BEST_DOMINATES) ||
        this.lastQualifiedFireRow < 0 || this.lastQualifiedFireBestRow < 0)
      return;
    if (this.qualifiedFireOracleAuditEpoch === this.qualifiedFireAuditEpoch)
      return;
    this.qualifiedFireOracleAuditEpoch = this.qualifiedFireAuditEpoch;
    this.qualifiedFireOracleAuditCount += 1;
    const search = this.policySearch || this.lastSource;
    const roots = recursion?.roots;
    if (!search || typeof search.legacyAction !== "function" ||
        !Array.isArray(roots)) {
      this.qualifiedFireOracleMissingCount += 1; return;
    }
    const fireAction = engine.ourActions[this.lastQualifiedFireRow];
    const bestAction = engine.ourActions[this.lastQualifiedFireBestRow];
    let fireValue = 0; let bestValue = 0;
    let fireFound = 0; let bestFound = 0;
    let oracleBestAction = -1; let oracleBestValue = -Infinity;
    for (let index = 0; index < roots.length; index += 1) {
      const action = search.legacyAction(roots[index]?.action);
      const value = roots[index]?.value;
      if (action < 0 || !Number.isFinite(value)) continue;
      if (oracleBestAction < 0 || value > oracleBestValue) {
        oracleBestAction = action; oracleBestValue = value;
      }
      if (action === fireAction) { fireValue = value; fireFound = 1; }
      if (action === bestAction) { bestValue = value; bestFound = 1; }
    }
    if (!fireFound || !bestFound) {
      this.qualifiedFireOracleMissingCount += 1; return;
    }
    this.qualifiedFireOraclePairComparedCount += 1;
    const gap = Math.trunc(bestValue - fireValue);
    if (gap > 0) this.qualifiedFireOracleFireLowerCount += 1;
    else if (gap === 0) this.qualifiedFireOracleFireTieCount += 1;
    else this.qualifiedFireOracleFireHigherCount += 1;
    this.qualifiedFireOracleGapSum += gap;
    if (Math.abs(gap) > this.qualifiedFireOracleGapMax)
      this.qualifiedFireOracleGapMax = Math.abs(gap);
    if (oracleBestAction === bestAction)
      this.qualifiedFireOracleBestAgreementCount += 1;
    if (oracleBestAction === fireAction)
      this.qualifiedFireOracleBestFireCount += 1;
    this.accumulateQualifiedFireTransitionEvidence(search, fireAction, true);
    this.accumulateQualifiedFireTransitionEvidence(search, bestAction, false);
    if (gap < 0) {
      this.qualifiedFireMismatchOneStepFireComparedCount +=
        search.lastTransitionOwnCompared?.[fireAction] || 0;
      this.qualifiedFireMismatchOneStepFireMismatchCount +=
        search.lastTransitionOwnMismatch?.[fireAction] || 0;
      this.qualifiedFireMismatchOneStepFireUnsupportedCount +=
        search.lastTransitionOwnUnsupported?.[fireAction] || 0;
      this.qualifiedFireMismatchOneStepBestComparedCount +=
        search.lastTransitionOwnCompared?.[bestAction] || 0;
      this.qualifiedFireMismatchOneStepBestMismatchCount +=
        search.lastTransitionOwnMismatch?.[bestAction] || 0;
      this.qualifiedFireMismatchOneStepBestUnsupportedCount +=
        search.lastTransitionOwnUnsupported?.[bestAction] || 0;
      this.qualifiedFireMismatchDeepFireComparedCount +=
        search.lastDeepRootCompared?.[fireAction] || 0;
      this.qualifiedFireMismatchDeepFireMismatchCount +=
        search.lastDeepRootMismatch?.[fireAction] || 0;
      this.qualifiedFireMismatchDeepFireUnsupportedCount +=
        search.lastDeepRootUnsupported?.[fireAction] || 0;
      this.qualifiedFireMismatchDeepBestComparedCount +=
        search.lastDeepRootCompared?.[bestAction] || 0;
      this.qualifiedFireMismatchDeepBestMismatchCount +=
        search.lastDeepRootMismatch?.[bestAction] || 0;
      this.qualifiedFireMismatchDeepBestUnsupportedCount +=
        search.lastDeepRootUnsupported?.[bestAction] || 0;
      this.accumulateQualifiedFireMismatchComponents(search, fireAction, true);
      this.accumulateQualifiedFireMismatchComponents(search, bestAction, false);
    }
  }

  qualifiedFireOwnerRow(engine, minimaxBest) {
    if (this.qualifiedFireOwnerMode === "off" ||
        this.lastQualifiedFireRow < 0) return -1;
    this.qualifiedFireOwnerCheckCount += 1;
    const fireRow = this.lastQualifiedFireRow;
    const combat = engine.combat?.vector;
    if (!combat || combat.attackClosureStatus[fireRow] !== PAC_STATUS.COMPLETE) {
      this.qualifiedFireOwnerClosureBlockedCount += 1; return -1;
    }
    const intent = this.qualifiedFireOwnerMode.startsWith("intent-");
    const target = intent ? QUALIFIED_FIRE_CLASS.INTENT_FLIP :
      QUALIFIED_FIRE_CLASS.RESPONSE_TRADEOFF;
    if (!(this.lastQualifiedFireClass & target)) return -1;
    if (intent) this.qualifiedFireOwnerIntentProposalCount += 1;
    else this.qualifiedFireOwnerResponseProposalCount += 1;
    if (fireRow === minimaxBest) {
      this.qualifiedFireOwnerSameCount += 1; return -1;
    }
    this.qualifiedFireOwnerWouldOverrideCount += 1;
    if (!this.qualifiedFireOwnerMode.endsWith("-active")) return -1;
    this.qualifiedFireOwnerOverrideCount += 1;
    return fireRow;
  }

  captureRoot(engine, selected, action, source, minimaxBest,
    minimaxBestValue, poseBest, finalBest, count) {
    const decisionIndex = this.checkCount - 1;
    if ((!this.captureAllRoots && !this.captureFrames?.has(decisionIndex)) ||
        this.rootSamples.length >= this.captureRootLimit) return;
    const pose = this.attackPoseOption; const option = pose?.selected ?? -1;
    const policySearch = this.attackPosePolicySearch;
    const combat = engine.combat?.vector;
    const risk = engine.riskController?.outcome; const stride =
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES; const rows = [];
    for (let row = 0; row < count; row += 1) {
      const enemyCells = [];
      for (let column = 0; column < engine.enemyCount; column += 1)
        enemyCells.push(source.rootCellScore[row * stride + column]);
      rows.push({ row, action: engine.ourActions[row], argument: engine.ourArguments[row],
        projectedCell: engine.projectedCell[row],
        projectedDirection: engine.projectedDirection[row],
        hard: engine.hardStatus[row], allowed: this.allowedRow[row],
        sourceSupported: source.rootDomainRestricted ? source.rootDomainMask[row] : 1,
        intentBonus: this.intent ? this.intent.bonus(row) : 0,
        intentMember: this.intent ? this.intent.member(row) : 0,
        backedValue: this.backedValue[row],
        nominalBackedValue: this.nominalBackedValue[row],
        rootScore: source.rootScore[row],
        rootNominalScore: source.rootNominalScore ?
          source.rootNominalScore[row] : source.rootScore[row],
        enemyCells, poseSupported: pose?.supports(row) || 0,
        poseProgress: pose?.rowProgress[row] || 0,
        poseDeadline: pose?.rowDeadline[row] ?? 255,
        acceptable: risk && row < risk.count ? risk.acceptable[row] : 0,
        dominated: risk && row < risk.count ? risk.dominated[row] : 0,
        immediateFatalMass: risk && row < risk.count ?
          risk.immediateFatalMass?.[row] || 0 : 0,
        horizonFatalMass: risk && row < risk.count ?
          risk.horizonFatalMass?.[row] || 0 : 0,
        unknownMass: risk && row < risk.count ? risk.unknownMass?.[row] || 0 : 0,
        escapeSlack: risk && row < risk.count ? risk.escapeSlack?.[row] || 0 : 0,
        robustLower: risk && row < risk.count ? risk.robustLower?.[row] || 0 : 0,
        attackPolicyValue: policySearch ? policySearch.rowValue(row) : null,
        directKill: combat && row < combat.count ? combat.directKill[row] : 0,
        aimSetup: combat && row < combat.count ? combat.aimSetup[row] : 0,
        possibleHit: combat && row < combat.count ? combat.possibleHit[row] : 0,
        intercept: combat && row < combat.count ? combat.intercept[row] : 0,
        escapeDenial: combat && row < combat.count ? combat.escapeDenial[row] : 0,
        hitDeadline: combat && row < combat.count ? combat.hitDeadline[row] : 255,
        enemySafeSuccessors: combat && row < combat.count ?
          combat.enemySafeSuccessors[row] : 0,
        ownCounterExposure: combat && row < combat.count ?
          combat.ownCounterExposure[row] : 0,
        purposeCompleteness: combat && row < combat.count ?
          combat.purposeCompleteness[row] : 0,
        postFireEscape: combat && row < combat.count ?
          combat.postFireEscape[row] : 0 });
    }
    const state = engine.adapter.state;
    this.rootSamples.push({ decisionIndex,
      engineDecisionIndex: engine.decisionCount | 0,
      stateFrame: state.arrays[ARRAY.SCALAR][SCALAR.FRAME],
      stateHashLo: state.hashLo >>> 0, stateHashHi: state.hashHi >>> 0,
      selectedRow: selected, selectedAction: action,
      minimaxBestRow: minimaxBest, minimaxBestValue,
      poseBestRow: poseBest, finalBestRow: finalBest,
      proposedAction: finalBest >= 0 ? engine.ourActions[finalBest] : ACTION.NONE,
      source: source === engine.informationSearch ? "INFORMATION" : "PHYSICAL",
      width: state.width, height: state.height,
      ownCell: state.arrays[ARRAY.TANK_CELL][0],
      ownDirection: state.arrays[ARRAY.TANK_DIR][0],
      enemyCell: state.arrays[ARRAY.TANK_CELL][1],
      enemyDirection: state.arrays[ARRAY.TANK_DIR][1],
      ownStars: state.arrays[ARRAY.TANK_STARS][0],
      enemyStars: state.arrays[ARRAY.TANK_STARS][1],
      starCell: state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL],
      attackPosePolicySearch: policySearch ? {
        pairedDepth: policySearch.pairedDepth,
        completed: policySearch.lastComplete,
        depth: policySearch.lastDepth,
        selectedRow: policySearch.lastBestRow,
        selectedValue: policySearch.lastBestValue,
        baselineValue: policySearch.lastBaselineValue,
        margin: policySearch.lastComplete ?
          policySearch.lastBestValue - policySearch.lastBaselineValue : null
      } : null,
      enemyActions: Array.from(engine.enemyActions.slice(0, engine.enemyCount)),
      enemyProjectedCells: Array.from(pose?.enemyCell?.slice(0, engine.enemyCount) || []),
      option: option < 0 ? null : { index: option, cell: pose.cell[option],
        direction: pose.direction[option], deadline: pose.fireDeadline[option],
        responseCoverage: pose.responseCoverage[option],
        responseMask: pose.responseMask[option],
        postFireEscape: pose.postFireEscape[option],
        counterExposure: pose.counterExposure[option] }, rows });
  }

  annotateCapturedRootOracle(evaluated, stageAction, rounds) {
    if (!this.rootSamples?.length) return;
    const sample = this.rootSamples[this.rootSamples.length - 1];
    if (sample.decisionIndex !== this.checkCount - 1) return;
    sample.oracleStageAction = stageAction;
    sample.oracleRounds = rounds | 0;
    sample.oracleRows = [];
    if (!Array.isArray(evaluated)) return;
    for (let index = 0; index < evaluated.length; index += 1) {
      const entry = evaluated[index];
      if (!entry) continue;
      sample.oracleRows.push({
        action: this.policySearch?.legacyAction(entry.action) ?? ACTION.NONE,
        rawValue: Number.isFinite(entry.rawValue) ? Math.trunc(entry.rawValue) : null,
        value: Number.isFinite(entry.value) ? Math.trunc(entry.value) : null,
        unsafe: entry.unsafe ? 1 : 0
      });
    }
  }

  prepareNominal(engine, source) {
    if (!this.opponentBlendBasisPoints || !source.rootCellScore ||
        engine.enemyCount < 1 ||
        engine.enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) return 0;
    for (let column = 0; column < engine.enemyCount; column += 1)
      engine.enemyActionFamilies[column] = engine.actionFamilyForShadow(
        engine.enemyActions[column]);
    const count = engine.policy.opponent.buildNominalPolicy(
      engine.enemyActionFamilies, engine.enemyCount, engine.opponentContext(),
      this.nominalProbability);
    if (count !== engine.enemyCount) { this.nominalBackupSkipCount += 1; return 0; }
    let sum = 0;
    for (let column = 0; column < count; column += 1)
      sum += this.nominalProbability[column];
    if (sum !== 10000) { this.nominalBackupSkipCount += 1; return 0; }
    this.nominalBackupCount += 1; return 1;
  }

  backedUpValue(source, row, enemyCount, nominalReady) {
    const worst = source.rootScore[row];
    if (!nominalReady) return worst;
    let weighted = 0;
    for (let column = 0; column < enemyCount; column += 1)
      weighted += this.nominalProbability[column] * source.rootCellScore[
        row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
    const expected = Math.trunc(weighted / 10000);
    return worst + Math.trunc((expected - worst) *
      this.opponentBlendBasisPoints / 10000);
  }

  intentAdjustment(row) {
    return this.intent && this.intentValueMode === "bonus" ?
      this.intent.bonus(row) : 0;
  }

  intentTiePrefers(left, right) {
    return this.intent && this.intentValueMode === "tie" && left >= 0 &&
      right >= 0 && this.intent.bonus(left) > this.intent.bonus(right) ? 1 : 0;
  }

  backedUpPathNominalValue(source, row, enemyCount, nominalReady) {
    if (!source.rootNominalScore || !source.rootNominalCellScore)
      return this.backedUpValue(source, row, enemyCount, nominalReady);
    const worst = source.rootNominalScore[row];
    if (!nominalReady) return worst;
    let weighted = 0;
    for (let column = 0; column < enemyCount; column += 1)
      weighted += this.nominalProbability[column] * source.rootNominalCellScore[
        row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
    const expected = Math.trunc(weighted / 10000);
    return worst + Math.trunc((expected - worst) *
      this.opponentBlendBasisPoints / 10000);
  }

  cellwiseDominates(source, row, baseline, enemyCount) {
    this.resourceDominanceCheckCount += 1;
    if (!this.matrixDominates(source, row, baseline, enemyCount)) {
      this.resourceDominanceRejectedCount += 1; return 0;
    }
    this.resourceDominanceAcceptedCount += 1; return 1;
  }

  matrixDominates(source, row, baseline, enemyCount) {
    if (!source.rootCellScore || row < 0 || baseline < 0 || enemyCount < 1)
      return 0;
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES; let strict = 0;
    for (let column = 0; column < enemyCount; column += 1) {
      const candidate = source.rootCellScore[row * stride + column];
      const incumbent = source.rootCellScore[baseline * stride + column];
      if (candidate < incumbent) return 0;
      if (candidate > incumbent) strict = 1;
    }
    return strict;
  }

  requiresResourceDominance(action) {
    if (!resourceAction(action) || this.resourceCellwiseDominanceScope === "none")
      return 0;
    if (this.resourceCellwiseDominanceScope === "all") return 1;
    const bomb = action === ACTION.THROW_BOMB;
    return this.resourceCellwiseDominanceScope === "bomb" ? bomb : !bomb;
  }

  source(engine, count, rootEligibility = null, incumbentAction = ACTION.NONE) {
    if (this.policySearch) {
      if (this.policySearch.prepare(engine, count, rootEligibility)) {
        if (this.policySearchSupportMode === "strict" &&
            !this.policySearch.lastOwnershipSupportComplete) {
          this.policySearchStrictSupportBlockedCount += 1;
          this.lastSource = null; return null;
        }
        if (this.policySearchSupportMode === "exact" &&
            !this.policySearch.lastValueExact) {
          if (this.candidateForcedWin)
            this.candidateForcedWin.audit(engine, this.policySearch, count,
              incumbentAction);
          this.policySearchExactSupportBlockedCount += 1;
          this.lastSource = null; return null;
        }
        this.physicalOwnerCount += 1; this.lastSource = this.policySearch;
        return this.policySearch;
      }
      this.lastSource = null; return null;
    }
    const information = engine.informationSearch;
    if (information?.completedDepth > 0 && information.supportComplete === 1 &&
        information.approximate === 0) {
      this.informationOwnerCount += 1; this.lastSource = information;
      return information;
    }
    const physical = engine.depthSearch;
    if (physical?.completedDepth > 0 && physical.representativeSupportComplete === 1) {
      this.physicalOwnerCount += 1; this.lastSource = physical; return physical;
    }
    this.lastSource = null;
    return null;
  }

  actionRow(engine, action, count) {
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }

  jointRiskTiePrefers(engine, left, right) {
    if (this.riskFrontierMode !== "joint" || left < 0 || right < 0) return 0;
    const controller = engine.riskController;
    if (!controller || typeof controller.strictlyDominates !== "function") return 0;
    return controller.strictlyDominates(left, right) ? 1 : 0;
  }

  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  verifiedPoisonProposal(engine, source, incumbent, count) {
    this.poisonProposalCheckCount += 1;
    const row = this.actionRow(engine, ACTION.CAST_POISON, count);
    if (row < 0 || !this.allowedRow[row]) return -1;
    this.poisonProposalRowCount += 1;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!engine.adapter.enemyVisible) {
      this.poisonProposalVisibilityBlockedCount += 1; return -1;
    }
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][1];
    if (poisonUntil !== NONE_FRAME && poisonUntil > frame) {
      this.poisonProposalAlreadyActiveBlockedCount += 1; return -1;
    }
    const frozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][1];
    const stunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    if (frozenUntil !== NONE_FRAME && frozenUntil > frame ||
        stunUntil !== NONE_FRAME && stunUntil > frame) {
      this.poisonProposalEnemyEffectBlockedCount += 1; return -1;
    }
    if (!engine.adapter.enemyCanAct) {
      this.poisonProposalCadenceBlockedCount += 1; return -1;
    }
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const distance = this.distance(state, own, enemy);
    if (this.poisonProposalPolicy === "deferred-left-contact" &&
        (engine.ourActions[incumbent] !== ACTION.TURN_LEFT || distance > 4)) {
      this.poisonProposalPolicyBlockedCount += 1; return -1;
    }
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const relevant = engine.adapter.enemyCanFire || distance <= 9 ||
      star !== 0xffff && this.distance(state, enemy, star) <=
        this.distance(state, own, star) + 2;
    if (!relevant) {
      this.poisonProposalRelevanceBlockedCount += 1; return -1;
    }
    const risk = engine.riskController.outcome;
    if (row >= risk.count || !risk.acceptable[row] || risk.dominated[row]) {
      this.poisonProposalRiskBlockedCount += 1; return -1;
    }
    const escape = engine.escapeObligation;
    const committedSafe = escape.supportStatus === SUPPORT_STATUS.NONE ||
      escape.supportStatus === SUPPORT_STATUS.COMPLETE && escape.member[row] &&
      escape.successorProof[row] === SUCCESSOR_PROOF.PROVEN_VIABLE;
    if (!committedSafe) {
      this.poisonProposalCommittedBlockedCount += 1; return -1;
    }
    if (incumbent < 0 || !source.representativeSupportComplete ||
        this.backedValue[row] < this.backedValue[incumbent]) {
      this.poisonProposalValueBlockedCount += 1; return -1;
    }
    if (!this.matrixDominates(source, row, incumbent, engine.enemyCount)) {
      this.poisonProposalCellwiseBlockedCount += 1; return -1;
    }
    this.poisonProposalEvidenceCount += 1;
    return row;
  }

  clearPreemptiveCommitment() {
    this.preemptiveOrigin = -1; this.preemptiveEscapeDirection = -1;
    this.preemptiveBulletDirection = -1; this.preemptiveCreatedFrame = -1;
    this.preemptiveExpiresFrame = -1;
  }

  continuationAction(engine) {
    if (this.preemptiveOrigin < 0 || !this.intent) return ACTION.NONE;
    this.preemptiveContinuationCheckCount += 1;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0];
    if (frame <= this.preemptiveCreatedFrame || frame > this.preemptiveExpiresFrame ||
        own !== this.preemptiveOrigin ||
        a[ARRAY.TANK_DIR][0] !== this.preemptiveEscapeDirection) {
      this.clearPreemptiveCommitment(); return ACTION.NONE;
    }
    const speed = this.intent.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 0, frame) ? 2 : 1;
    const next = this.intent.advance(state, own, this.preemptiveEscapeDirection, speed);
    const sameAxis = this.preemptiveBulletDirection === 0 ||
      this.preemptiveBulletDirection === 2 ? state.x(own) === state.x(next) :
      state.y(own) === state.y(next);
    this.clearPreemptiveCommitment();
    if (next === own || next === a[ARRAY.TANK_CELL][1] || sameAxis) return ACTION.NONE;
    return ACTION.GO;
  }

  ownPreemptive(engine, action, row, incumbent, continuation = false) {
    if (row < 0) { this.preemptiveMissingCount += 1; return null; }
    if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
      this.preemptiveHardBlockedCount += 1; return null;
    }
    this.preemptiveProposalCount += 1;
    if (continuation) this.preemptiveContinuationProposalCount += 1;
    this.proposalCount += 1;
    if (action === incumbent) {
      this.sameActionCount += 1; this.preemptiveSameCount += 1; return null;
    }
    this.overrideCount += 1; this.preemptiveOverrideCount += 1;
    if (action === ACTION.GO) this.goOverrideCount += 1;
    else this.turnOverrideCount += 1;
    return { action, argument: engine.ourArguments[row] };
  }

  selectOverride(engine, selected, action, proofIncumbentAction = action) {
    this.checkCount += 1; this.lastPoisonProposal = -1;
    if (this.candidateForcedWin) this.candidateForcedWin.beginRoot();
    if (this.intent && typeof this.intent.observeContext === "function")
      this.intent.observeContext(engine);
    if (this.policySearch && typeof this.policySearch.observeRoot === "function")
      this.policySearch.observeRoot(engine, this.intent?.contextEpoch || 0);
    const tactical = engine.lastControlMode === ROOT_CONTROL_MODE.TACTICAL_CONTACT;
    const stunWindow = tactical && engine.controlMode?.context?.reason ===
      ROOT_CONTROL_REASON.ENEMY_DISABLED;
    if (stunWindow) {
      this.stunWindowRootCount += 1;
      if (action >= 0 && action < this.stunWindowIncumbentActionCount.length)
        this.stunWindowIncumbentActionCount[action] += 1;
    }
    if (!engine.adapter?.enemyVisible || !tactical && !this.nonContactBasePolicy) {
      this.nonContactSkipCount += 1; return null;
    }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      if (stunWindow) this.stunWindowStrictSkipCount += 1;
      this.strictOwnerSkipCount += 1; return null;
    }
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    const escape = engine.escapeObligation;
    const committed = escape?.committedEntityCount > 0;
    let committedSearch = 0;
    if (committed) {
      if (this.committedSearchMode !== "viable") {
        if (stunWindow) this.stunWindowCommittedSkipCount += 1;
        this.committedSkipCount += 1; return null;
      }
      this.committedSearchCount += 1;
      if (escape.supportStatus !== SUPPORT_STATUS.COMPLETE) {
        this.committedSearchIncompleteCount += 1; return null;
      }
      if (!(escape.firstActionCount > 0)) {
        this.committedSearchNoMemberCount += 1; return null;
      }
      committedSearch = 1; this.committedSearchCompleteCount += 1;
    }
    if (!tactical) {
      const frame = engine.adapter?.state?.arrays?.[ARRAY.SCALAR]?.[SCALAR.FRAME] ?? 0;
      if (this.nonContactBaseTerminalOnly && frame + 16 < 128) {
        this.nonContactSkipCount += 1; return null;
      }
      this.nonContactBaseCheckCount += 1;
      if (this.intent) this.intent.prepare(engine, count);
      const proposed = this.intent?.currentCommittedAction ?? ACTION.NONE;
      const nonContactRisk = engine.riskController?.outcome;
      let row = -1;
      for (let index = 0; index < count; index += 1)
        if (engine.ourActions[index] === proposed &&
            engine.hardStatus[index] === HARD_STATUS.ALLOW &&
            nonContactRisk && index < nonContactRisk.count &&
            nonContactRisk.acceptable[index]) { row = index; break; }
      if (row < 0 || proposed === ACTION.NONE) {
        this.nonContactBaseMissingCount += 1; return null;
      }
      this.nonContactBaseProposalCount += 1;
      if (this.intent && typeof this.intent.commitSelection === "function")
        this.intent.commitSelection(proposed);
      if (proposed === action) { this.sameActionCount += 1; return null; }
      this.overrideCount += 1; this.nonContactBaseOverrideCount += 1;
      if (proposed === ACTION.GO) this.goOverrideCount += 1;
      else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
        this.turnOverrideCount += 1;
      else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
      else this.otherOverrideCount += 1;
      return { action: proposed, argument: engine.ourArguments[row] };
    }
    if (!committedSearch && this.preemptiveSafetyBasePolicy === "active") {
      const continuation = this.continuationAction(engine);
      if (continuation !== ACTION.NONE) {
        const result = this.ownPreemptive(engine, continuation,
          this.actionRow(engine, continuation, count), action, true);
        if (result || continuation === action) return result;
      }
    }
    let directAttack = ACTION.NONE; let directAttackRow = -1;
    if (!committedSearch && this.directAttackBasePolicy !== "off" && this.intent &&
        typeof this.intent.directAttackAction === "function") {
      this.directAttackCheckCount += 1;
      directAttack = this.intent.directAttackAction(engine);
      if (directAttack !== ACTION.NONE) {
        for (let row = 0; row < count; row += 1)
          if (engine.ourActions[row] === directAttack) {
            directAttackRow = row; break;
          }
        if (directAttackRow < 0) this.directAttackMissingCount += 1;
        else if (engine.hardStatus[directAttackRow] !== HARD_STATUS.ALLOW)
          this.directAttackHardBlockedCount += 1;
        else {
          this.directAttackProposalCount += 1;
          if (this.directAttackBasePolicy === "active") {
            this.proposalCount += 1;
            this.intent.commitDirectAttack(directAttack);
            if (directAttack === action) {
              this.sameActionCount += 1; this.directAttackSameCount += 1;
              return null;
            }
            this.overrideCount += 1; this.directAttackOverrideCount += 1;
            if (directAttack === ACTION.FIRE) this.fireOverrideCount += 1;
            else this.turnOverrideCount += 1;
            return { action: directAttack,
              argument: engine.ourArguments[directAttackRow] };
          }
        }
      }
    }
    let preemptive = ACTION.NONE; let preemptiveRow = -1;
    if (!committedSearch && this.preemptiveSafetyBasePolicy !== "off" && this.intent &&
        typeof this.intent.preemptiveSafetyAction === "function") {
      this.preemptiveCheckCount += 1;
      preemptive = this.intent.preemptiveSafetyAction(engine);
      if (preemptive !== ACTION.NONE) {
        preemptiveRow = this.actionRow(engine, preemptive, count);
        if (preemptiveRow < 0) this.preemptiveMissingCount += 1;
        else if (engine.hardStatus[preemptiveRow] !== HARD_STATUS.ALLOW)
          this.preemptiveHardBlockedCount += 1;
        else if (this.preemptiveSafetyBasePolicy === "active") {
          if (preemptive === ACTION.TURN_LEFT || preemptive === ACTION.TURN_RIGHT) {
            const state = engine.adapter.state; const a = state.arrays;
            this.preemptiveOrigin = a[ARRAY.TANK_CELL][0];
            this.preemptiveEscapeDirection = this.intent.preemptiveEscapeDirection;
            this.preemptiveBulletDirection = a[ARRAY.TANK_DIR][1];
            this.preemptiveCreatedFrame = a[ARRAY.SCALAR][SCALAR.FRAME];
            this.preemptiveExpiresFrame = this.preemptiveCreatedFrame + 2;
          }
          return this.ownPreemptive(engine, preemptive, preemptiveRow, action);
        } else this.preemptiveProposalCount += 1;
      }
    }
    const source = this.source(engine, count,
      committedSearch ? escape.member : null, proofIncumbentAction);
    if (!source) {
      const forced = this.candidateForcedWin?.lastCertifiedRow ?? -1;
      if (forced >= 0 && this.candidateForcedWin.mode === "active") {
        this.proposalCount += 1; this.overrideCount += 1;
        const proposed = engine.ourActions[forced];
        if (proposed === ACTION.GO) this.goOverrideCount += 1;
        else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
          this.turnOverrideCount += 1;
        else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
        else this.otherOverrideCount += 1;
        return { action: proposed, argument: engine.ourArguments[forced] };
      }
      const exact = this.candidateForcedWin?.lastExactDominanceRow ?? -1;
      if (exact >= 0 &&
          this.candidateForcedWin.exactDominanceMode === "active") {
        this.proposalCount += 1; this.overrideCount += 1;
        const proposed = engine.ourActions[exact];
        if (proposed === ACTION.GO) this.goOverrideCount += 1;
        else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
          this.turnOverrideCount += 1;
        else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
        else this.otherOverrideCount += 1;
        return { action: proposed, argument: engine.ourArguments[exact] };
      }
      if (stunWindow) this.stunWindowIncompleteSearchCount += 1;
      this.noCompleteValueCount += 1; return null;
    }
    if (stunWindow) {
      this.stunWindowCompleteSearchCount += 1;
      const a = engine.adapter.state.arrays;
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const fireLock = a[ARRAY.TANK_FIRE_LOCK][0];
      if (fireLock !== NONE_FRAME && fireLock > frame)
        this.stunWindowFireLockCount += 1;
      for (let slot = 0; slot < a[ARRAY.PROJECTILE_ACTIVE].length; slot += 1)
        if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
            a[ARRAY.PROJECTILE_OWNER][slot] === 0) {
          this.stunWindowOwnProjectileCount += 1; break;
        }
    }
    const nominalReady = this.policySearch ? 0 : this.prepareNominal(engine, source);
    let best = -1; let bestValue = -2147483648;
    let bestNominalValue = -2147483648; let bestPriority = -1;
    let rejectedFire = -1; let rejectedFireValue = -2147483648;
    if (this.intent) this.intent.prepare(engine, count);
    let poseReady = 0;
    if (this.attackPoseOption && (!this.attackPoseActiveFrames ||
        this.attackPoseActiveFrames.has(this.checkCount - 1))) {
      this.attackPosePrepareCount += 1;
      poseReady = this.attackPoseOption.prepare(engine, count);
      if (poseReady && this.attackPoseRequiredAimTurns >= 0) {
        const option = this.attackPoseOption.selected;
        const state = engine.adapter.state;
        const turns = this.attackPoseOption.turns(
          state.arrays[ARRAY.TANK_DIR][0], this.attackPoseOption.direction[option]);
        if (turns !== this.attackPoseRequiredAimTurns) {
          poseReady = 0; this.attackPoseAimTurnRejectedCount += 1;
        } else this.attackPoseAimTurnAcceptedCount += 1;
      }
    }
    this.allowedRow.fill(0, 0, count);
    this.membershipStage.fill(MEMBERSHIP_STAGE.UNSEEN, 0, count);
    const risk = engine.riskController?.outcome;
    if (this.riskFrontierMode !== "off" && (!risk || risk.count < count)) {
      // Finite-depth values may own ordinary BasePolicy only inside the
      // already-computed Risk frontier. Missing support is not permission to
      // promote an approximate value into an unconstrained action owner.
      this.riskSupportMissingCount += 1;
      this.noCompleteValueCount += 1;
      return null;
    }
    let intentRestricted = 0;
    if (this.intentMembership && this.intent &&
        (this.intent.committed === 2 || this.intent.committed === 3 ||
         this.intent.committed === 4)) {
      for (let row = 0; row < count; row += 1)
        if ((typeof this.intent.member === "function" ?
          this.intent.member(row) : this.intent.bonus(row)) > 0) {
          intentRestricted = 1; break;
        }
      if (intentRestricted) this.intentMembershipRootCount += 1;
    }
    for (let row = 0; row < count; row += 1) {
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) {
        this.membershipStage[row] = MEMBERSHIP_STAGE.HARD_BLOCKED; continue;
      }
      if (this.riskFrontierMode !== "off" && !risk.acceptable[row]) {
        let softAllowed = 0;
        if (this.riskSoftBandMode === "intent-known") {
          this.softRiskCandidateCount += 1;
          if (!risk.immediateFatalMass || risk.immediateFatalMass[row] !== 0)
            this.softRiskImmediateBlockedCount += 1;
          else if (!risk.unknownMass || risk.unknownMass[row] !== 0)
            this.softRiskUnknownBlockedCount += 1;
          else if (risk.dominated && risk.dominated[row])
            this.softRiskDominatedBlockedCount += 1;
          else if (!this.intent || this.intent.member(row) <= 0)
            this.softRiskIntentBlockedCount += 1;
          else {
            softAllowed = 1; this.softRiskIntentAllowedCount += 1;
          }
        }
        if (!softAllowed) {
          this.membershipStage[row] = MEMBERSHIP_STAGE.RISK_REJECTED;
          this.riskRejectedCount += 1; continue;
        }
      }
      if (this.riskFrontierMode === "pareto" && risk.dominated[row]) {
        this.membershipStage[row] = MEMBERSHIP_STAGE.RISK_PARETO_BLOCKED;
        this.riskDominatedCount += 1; continue;
      }
      if (committedSearch && (!escape.member[row] ||
          escape.successorProof[row] !== SUCCESSOR_PROOF.PROVEN_VIABLE)) {
        this.membershipStage[row] = MEMBERSHIP_STAGE.COMMITTED_BLOCKED;
        this.committedSearchMemberBlockedCount += 1; continue;
      }
      if (source.rootDomainRestricted && !source.rootDomainMask[row]) {
        if (stunWindow && engine.ourActions[row] === ACTION.FIRE)
          this.stunWindowFireSourceDomainBlockedCount += 1;
        this.membershipStage[row] = MEMBERSHIP_STAGE.SOURCE_DOMAIN_BLOCKED;
        this.domainBlockedCount += 1; continue;
      }
      if (this.domain && !this.domain.allows(engine, row)) {
        if (stunWindow && engine.ourActions[row] === ACTION.FIRE)
          this.stunWindowFireOwnerDomainBlockedCount += 1;
        if (this.exactFireDomainBypass && engine.ourActions[row] === ACTION.FIRE &&
            this.backedUpValue(source, row, engine.enemyCount, nominalReady) >
              rejectedFireValue) {
          rejectedFire = row; rejectedFireValue = this.backedUpValue(source, row,
            engine.enemyCount, nominalReady);
        }
        this.membershipStage[row] = MEMBERSHIP_STAGE.OWNER_DOMAIN_BLOCKED;
        this.domainBlockedCount += 1; continue;
      }
      if (intentRestricted && (typeof this.intent.member === "function" ?
        this.intent.member(row) : this.intent.bonus(row)) <= 0) {
        if (stunWindow && engine.ourActions[row] === ACTION.FIRE)
          this.stunWindowFireIntentBlockedCount += 1;
        this.membershipStage[row] = MEMBERSHIP_STAGE.INTENT_BLOCKED;
        this.intentMembershipBlockedCount += 1; continue;
      }
      const value = this.backedUpValue(source, row, engine.enemyCount, nominalReady) +
        this.intentAdjustment(row);
      const nominalValue = this.backedUpPathNominalValue(source, row,
        engine.enemyCount, nominalReady) +
        this.intentAdjustment(row);
      this.allowedRow[row] = 1; this.backedValue[row] = value;
      this.membershipStage[row] = MEMBERSHIP_STAGE.ALLOWED;
      this.nominalBackedValue[row] = nominalValue;
      if (this.poisonProposalMode !== "off" &&
          engine.ourActions[row] === ACTION.CAST_POISON) continue;
      if (this.requiresResourceDominance(engine.ourActions[row])) continue;
      const priority = actionPriority(engine.ourActions[row]);
      if (best < 0 || value > bestValue ||
          value === bestValue && nominalValue > bestNominalValue ||
          value === bestValue && nominalValue === bestNominalValue &&
            this.intentTiePrefers(row, best) ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(best, row) &&
            this.jointRiskTiePrefers(engine, row, best) ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(row, best) &&
            !this.intentTiePrefers(best, row) &&
            !this.jointRiskTiePrefers(engine, best, row) &&
            priority > bestPriority ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(row, best) &&
            !this.intentTiePrefers(best, row) &&
            !this.jointRiskTiePrefers(engine, row, best) &&
            !this.jointRiskTiePrefers(engine, best, row) &&
            priority === bestPriority && row < best) {
        if (best >= 0 && value === bestValue && nominalValue > bestNominalValue)
          this.pathNominalTieBreakCount += 1;
        best = row; bestValue = value; bestNominalValue = nominalValue;
        bestPriority = priority;
      }
    }
    if (this.resourceCellwiseDominanceScope !== "none")
      for (let row = 0; row < count; row += 1) {
      if (!this.allowedRow[row] ||
          !this.requiresResourceDominance(engine.ourActions[row])) continue;
      if (this.poisonProposalMode !== "off" &&
          engine.ourActions[row] === ACTION.CAST_POISON) continue;
      if (best >= 0 && !this.cellwiseDominates(source, row, best, engine.enemyCount)) continue;
      const value = this.backedValue[row];
      const nominalValue = this.nominalBackedValue[row];
      const priority = actionPriority(engine.ourActions[row]);
      if (best < 0 || value > bestValue ||
          value === bestValue && nominalValue > bestNominalValue ||
          value === bestValue && nominalValue === bestNominalValue &&
            this.intentTiePrefers(row, best) ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(best, row) &&
            this.jointRiskTiePrefers(engine, row, best) ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(row, best) &&
            !this.intentTiePrefers(best, row) &&
            !this.jointRiskTiePrefers(engine, best, row) &&
            priority > bestPriority ||
          value === bestValue && nominalValue === bestNominalValue &&
            !this.intentTiePrefers(row, best) &&
            !this.intentTiePrefers(best, row) &&
            !this.jointRiskTiePrefers(engine, row, best) &&
            !this.jointRiskTiePrefers(engine, best, row) &&
            priority === bestPriority && row < best) {
        if (best >= 0 && value === bestValue && nominalValue > bestNominalValue)
          this.pathNominalTieBreakCount += 1;
        best = row; bestValue = value; bestNominalValue = nominalValue;
        bestPriority = priority;
      }
    }
    if (rejectedFire >= 0 && rejectedFireValue > bestValue) {
      best = rejectedFire; bestValue = rejectedFireValue;
      bestPriority = actionPriority(ACTION.FIRE); this.exactFireBypassCount += 1;
    }
    if (best < 0) { this.noCompleteValueCount += 1; return null; }
    if (committedSearch && (!escape.member[best] ||
        escape.successorProof[best] !== SUCCESSOR_PROOF.PROVEN_VIABLE)) {
      this.committedSearchSelectionViolationCount += 1; return null;
    }
    const minimaxBest = best; const minimaxBestValue = bestValue;
    this.auditQualifiedFire(engine, count, minimaxBest, minimaxBestValue,
      nominalReady);
    const qualifiedFireOwner = this.qualifiedFireOwnerRow(engine, minimaxBest);
    if (qualifiedFireOwner >= 0) {
      best = qualifiedFireOwner; bestValue = this.backedValue[best];
    }
    if (stunWindow) {
      if (engine.ourActions[minimaxBest] >= 0 &&
          engine.ourActions[minimaxBest] < this.stunWindowMinimaxActionCount.length)
        this.stunWindowMinimaxActionCount[engine.ourActions[minimaxBest]] += 1;
      if (engine.ourActions[minimaxBest] === ACTION.FIRE)
        this.stunWindowFireMinimaxBestCount += 1;
      let firePresent = 0; let fireHardAllowed = 0;
      let fireEvidenceRow = -1; let fireRow = -1;
      for (let row = 0; row < count; row += 1) {
        if (engine.ourActions[row] !== ACTION.FIRE) continue;
        firePresent = 1;
        if (engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
        fireHardAllowed = 1;
        if (fireEvidenceRow < 0) fireEvidenceRow = row;
        if (!this.allowedRow[row]) continue;
        if (fireRow < 0 || this.backedValue[row] > this.backedValue[fireRow])
          fireRow = row;
      }
      if (!firePresent) this.stunWindowFireMissingCount += 1;
      else if (!fireHardAllowed) this.stunWindowFireHardBlockedCount += 1;
      else if (fireRow < 0) this.stunWindowFireDomainBlockedCount += 1;
      else {
        this.stunWindowFireEligibleCount += 1;
        this.stunWindowFireGapHistogram[this.fireGapBucket(
          minimaxBestValue - this.backedValue[fireRow])] += 1;
      }
      const combat = engine.combat?.vector;
      if (combat && fireEvidenceRow >= 0 && fireEvidenceRow < combat.count) {
        const direct = combat.directKill[fireEvidenceRow] ? 1 : 0;
        const possible = combat.possibleHit[fireEvidenceRow] ? 1 : 0;
        const intercept = combat.intercept[fireEvidenceRow] ? 1 : 0;
        const aim = combat.aimSetup[fireEvidenceRow] ? 1 : 0;
        const escape = combat.postFireEscape[fireEvidenceRow] ? 1 : 0;
        const purpose = combat.purposeCompleteness[fireEvidenceRow] >= 4500 ? 1 : 0;
        this.stunWindowFireDirectKillCount += direct;
        this.stunWindowFirePossibleHitCount += possible;
        this.stunWindowFireInterceptCount += intercept;
        this.stunWindowFireAimSetupCount += aim;
        this.stunWindowFirePostEscapeCount += escape;
        this.stunWindowFirePurposeCompleteCount += purpose;
        if ((direct || possible || intercept || aim) && escape && purpose)
          this.stunWindowFireVerifiedOpportunityCount += 1;
      }
    }
    let poseBest = -1;
    if (poseReady) {
      if (this.attackPosePolicySearch) {
        poseBest = this.attackPosePolicySearch.select(engine,
          this.attackPoseOption, count, source, best, bestValue, this.allowedRow);
      } else if (this.attackPoseOptionFirst && bestValue >= 30000)
        this.attackPoseTerminalProtectedCount += 1;
      else for (let row = 0; row < count; row += 1) {
        const terminalLoss = this.attackPoseOptionFirst &&
          this.backedValue[row] <= -30000;
        if (terminalLoss) this.attackPoseTerminalLossRejectedCount += 1;
        if (!this.allowedRow[row] ||
            terminalLoss || !this.attackPoseOptionFirst &&
              this.backedValue[row] < bestValue - this.attackPoseBand ||
            !this.attackPoseOption.supports(row) ||
            typeof this.attackPoseOption.uncoveredNonRegressing === "function" &&
            !this.attackPoseOption.uncoveredNonRegressing(source, row, best,
              engine.enemyCount)) continue;
        if (this.attackPoseOption.betterRow(engine, row, poseBest)) poseBest = row;
      }
      if (poseBest >= 0) {
        this.attackPoseEvidenceCount += 1;
        if (poseBest !== best) this.attackPoseOverrideCount += 1;
        else this.attackPoseSameCount += 1;
        best = poseBest; bestValue = this.backedValue[best];
      }
    }
    let basePolicyRow = -1;
    if ((this.basePolicyVerifierMode !== "off" || this.terminalTradeAudit) &&
        this.intent) {
      const verifyBasePolicy = this.basePolicyVerifierMode !== "off";
      if (verifyBasePolicy) this.basePolicyVerifierCheckCount += 1;
      const baseAction = this.intent.currentCommittedAction ?? ACTION.NONE;
      let baseRow = -1; let baseValue = -2147483648;
      for (let row = 0; row < count; row += 1)
        if (this.allowedRow[row] && engine.ourActions[row] === baseAction &&
            this.backedValue[row] > baseValue) {
          baseRow = row; baseValue = this.backedValue[row];
        }
      if (baseAction === ACTION.CAST_POISON && this.poisonProposalMode !== "off") {
        if (baseRow >= 0) this.poisonProposalBasePolicyBlockedCount += 1;
        baseRow = -1;
      }
      if (baseRow >= 0 && this.requiresResourceDominance(baseAction) &&
          best >= 0 && baseRow !== best &&
          !this.cellwiseDominates(source, baseRow, best, engine.enemyCount)) {
        this.basePolicyVerifierResourceBlockedCount += 1; baseRow = -1;
      }
      if (baseRow >= 0) {
        basePolicyRow = baseRow;
        if (verifyBasePolicy) {
          this.basePolicyVerifierAvailableCount += 1;
          const searchWins = best >= 0 && best !== baseRow &&
            (this.basePolicyVerifierMode === "cellwise" ?
              this.matrixDominates(source, best, baseRow, engine.enemyCount) :
              bestValue > baseValue + this.basePolicyVerifierMargin);
          if (searchWins) this.basePolicyVerifierSearchOverrideCount += 1;
          else {
            best = baseRow; bestValue = baseValue;
            this.basePolicyVerifierKeptCount += 1;
          }
        }
      }
    }
    if (this.poisonProposalMode !== "off" && best >= 0) {
      const poison = this.verifiedPoisonProposal(engine, source, best, count);
      if (poison >= 0) {
        this.lastPoisonProposal = poison;
        if (poison !== best) this.poisonProposalWouldOverrideCount += 1;
        if (this.poisonProposalMode === "active" && poison !== best) {
          best = poison; bestValue = this.backedValue[poison];
          this.poisonProposalOverrideCount += 1;
        }
      }
    }
    if (this.verifiedInterceptMode !== "off" && best >= 0) {
      this.verifiedInterceptCheckCount += 1;
      const combat = engine.combat?.vector;
      if (combat && best < combat.count && bestValue < 30000) {
        let fireRow = -1;
        for (let row = 0; row < count; row += 1) {
          if (!this.allowedRow[row] || engine.ourActions[row] !== ACTION.FIRE ||
              row >= combat.count) continue;
          this.verifiedInterceptFireRowCount += 1;
          if (this.backedValue[row] <= -30000 ||
              this.backedValue[row] < bestValue - this.verifiedInterceptBand) {
            this.verifiedInterceptValueBlockedCount += 1; continue;
          }
          if (combat.attackClosureStatus[row] !== PAC_STATUS.COMPLETE) {
            this.verifiedInterceptClosureBlockedCount += 1; continue;
          }
          if (!combat.enemyDoomedFirstActions[row]) {
            this.verifiedInterceptNoDoomedResponseCount += 1; continue;
          }
          if (combat.enemyUnknownFirstActions[row]) {
            this.verifiedInterceptUnknownResponseCount += 1; continue;
          }
          if (!combat.postFireEscape[row]) {
            this.verifiedInterceptEscapeBlockedCount += 1; continue;
          }
          if (combat.purposeCompleteness[row] < 4500) {
            this.verifiedInterceptPurposeBlockedCount += 1; continue;
          }
          if (combat.ownCounterExposure[row] >= 10000) {
            this.verifiedInterceptExposureBlockedCount += 1; continue;
          }
          if (fireRow < 0 ||
              combat.enemyDoomedFirstActions[row] >
                combat.enemyDoomedFirstActions[fireRow] ||
              combat.enemyDoomedFirstActions[row] ===
                combat.enemyDoomedFirstActions[fireRow] &&
                combat.enemySurvivingFirstActions[row] <
                  combat.enemySurvivingFirstActions[fireRow] ||
              combat.enemyDoomedFirstActions[row] ===
                combat.enemyDoomedFirstActions[fireRow] &&
                combat.enemySurvivingFirstActions[row] ===
                  combat.enemySurvivingFirstActions[fireRow] &&
                combat.hitDeadline[row] < combat.hitDeadline[fireRow] ||
              combat.enemyDoomedFirstActions[row] ===
                combat.enemyDoomedFirstActions[fireRow] &&
                combat.enemySurvivingFirstActions[row] ===
                  combat.enemySurvivingFirstActions[fireRow] &&
                combat.hitDeadline[row] === combat.hitDeadline[fireRow] &&
                combat.ownCounterExposure[row] <
                  combat.ownCounterExposure[fireRow] ||
              combat.enemyDoomedFirstActions[row] ===
                combat.enemyDoomedFirstActions[fireRow] &&
                combat.enemySurvivingFirstActions[row] ===
                  combat.enemySurvivingFirstActions[fireRow] &&
                combat.hitDeadline[row] === combat.hitDeadline[fireRow] &&
                combat.ownCounterExposure[row] ===
                  combat.ownCounterExposure[fireRow] &&
                this.backedValue[row] > this.backedValue[fireRow]) fireRow = row;
        }
        if (fireRow >= 0) {
          this.verifiedInterceptEvidenceCount += 1;
          if (fireRow !== best) {
            this.verifiedInterceptWouldOverrideCount += 1;
            if (this.verifiedInterceptMode === "active") {
              best = fireRow; bestValue = this.backedValue[fireRow];
              this.verifiedInterceptOverrideCount += 1;
            }
          }
        }
      }
    }
    if (this.terminalTradeAudit) {
      best = this.terminalTradeAudit.select(engine, source, this.allowedRow,
        this.backedValue, best, count, basePolicyRow);
      bestValue = this.backedValue[best];
    }
    if (this.fireEvidenceSelection && best >= 0 &&
        engine.ourActions[best] === ACTION.FIRE) {
      this.fireEvidenceCheckCount += 1;
      const combat = engine.combat?.vector;
      if (!combat || best >= combat.count) this.fireEvidenceIncompleteCount += 1;
      else {
        const supported = bestValue >= 30000 || combat.directKill[best] ||
          combat.enemyDoomedFirstActions[best] || combat.possibleHit[best] ||
          combat.intercept[best] || combat.aimSetup[best];
        if (supported) this.fireEvidenceSupportedCount += 1;
        else {
          let alternative = -1; let alternativeValue = -2147483648;
          let alternativePriority = -1;
          for (let row = 0; row < count; row += 1) {
            const candidateAction = engine.ourActions[row];
            if (!this.allowedRow[row] || candidateAction === ACTION.FIRE ||
                this.requiresResourceDominance(candidateAction)) continue;
            const value = this.backedValue[row];
            const priority = actionPriority(candidateAction);
            if (alternative < 0 || value > alternativeValue ||
                value === alternativeValue && priority > alternativePriority ||
                value === alternativeValue && priority === alternativePriority &&
                  row < alternative) {
              alternative = row; alternativeValue = value;
              alternativePriority = priority;
            }
          }
          if (alternative >= 0) {
            best = alternative; bestValue = alternativeValue;
            this.fireEvidenceDemotionCount += 1;
          } else this.fireEvidenceNoAlternativeCount += 1;
        }
      }
    }
    if (risk && best >= 0 && best < risk.count) {
      if (risk.dominated[best]) this.selectedRiskOnlyDominatedCount += 1;
      if (this.riskFrontierMode === "joint" &&
          typeof engine.riskController.strictlyDominates === "function")
        for (let row = 0; row < count; row += 1) {
          if (row === best || !this.allowedRow[row] ||
              this.backedValue[row] < this.backedValue[best]) continue;
          if (engine.riskController.strictlyDominates(row, best)) {
            this.selectedJointDominatedCount += 1; break;
          }
        }
    }
    this.captureRoot(engine, selected, action, source, minimaxBest,
      minimaxBestValue, poseBest, best, count);
    this.proposalCount += 1;
    const proposed = engine.ourActions[best];
    if (stunWindow) {
      if (proposed >= 0 && proposed < this.stunWindowFinalActionCount.length)
        this.stunWindowFinalActionCount[proposed] += 1;
      if (proposed === ACTION.FIRE) this.stunWindowFireFinalSelectedCount += 1;
    }
    if (this.lastQualifiedFireRow >= 0 && proposed === ACTION.FIRE)
      this.qualifiedFireFinalSelectedCount += 1;
    if (this.directAttackBasePolicy === "shadow" && directAttackRow >= 0 &&
        engine.hardStatus[directAttackRow] === HARD_STATUS.ALLOW) {
      if (proposed === directAttack) this.directAttackShadowSearchSameCount += 1;
      else this.directAttackShadowSearchDifferentCount += 1;
    }
    if (this.preemptiveSafetyBasePolicy === "shadow" && preemptiveRow >= 0 &&
        engine.hardStatus[preemptiveRow] === HARD_STATUS.ALLOW) {
      if (proposed === preemptive) this.preemptiveShadowSearchSameCount += 1;
      else this.preemptiveShadowSearchDifferentCount += 1;
    }
    if (this.intent && typeof this.intent.commitSelection === "function")
      this.intent.commitSelection(proposed);
    if (proposed === action) { this.sameActionCount += 1; return null; }
    this.overrideCount += 1;
    if (proposed === ACTION.GO) this.goOverrideCount += 1;
    else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
      this.turnOverrideCount += 1;
    else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
    else this.otherOverrideCount += 1;
    const result = { action: proposed, argument: engine.ourArguments[best] };
    // Keep the public POC result shape stable while letting the diagnostic
    // emitter audit the exact row when duplicate action/argument pairs exist.
    Object.defineProperty(result, "row", { value: best, enumerable: false });
    return result;
  }

  summary() {
    return { enabled: true, checkCount: this.checkCount,
      nonContactSkipCount: this.nonContactSkipCount,
      nonContactBasePolicy: this.nonContactBasePolicy,
      nonContactBaseTerminalOnly: this.nonContactBaseTerminalOnly,
      nonContactBaseCheckCount: this.nonContactBaseCheckCount,
      nonContactBaseProposalCount: this.nonContactBaseProposalCount,
      nonContactBaseOverrideCount: this.nonContactBaseOverrideCount,
      nonContactBaseMissingCount: this.nonContactBaseMissingCount,
      directAttackBasePolicy: this.directAttackBasePolicy,
      directAttackCheckCount: this.directAttackCheckCount,
      directAttackProposalCount: this.directAttackProposalCount,
      directAttackSameCount: this.directAttackSameCount,
      directAttackOverrideCount: this.directAttackOverrideCount,
      directAttackMissingCount: this.directAttackMissingCount,
      directAttackHardBlockedCount: this.directAttackHardBlockedCount,
      directAttackShadowSearchSameCount: this.directAttackShadowSearchSameCount,
      directAttackShadowSearchDifferentCount:
        this.directAttackShadowSearchDifferentCount,
      preemptiveSafetyBasePolicy: this.preemptiveSafetyBasePolicy,
      preemptiveCheckCount: this.preemptiveCheckCount,
      preemptiveProposalCount: this.preemptiveProposalCount,
      preemptiveContinuationCheckCount: this.preemptiveContinuationCheckCount,
      preemptiveContinuationProposalCount:
        this.preemptiveContinuationProposalCount,
      preemptiveSameCount: this.preemptiveSameCount,
      preemptiveOverrideCount: this.preemptiveOverrideCount,
      preemptiveMissingCount: this.preemptiveMissingCount,
      preemptiveHardBlockedCount: this.preemptiveHardBlockedCount,
      preemptiveShadowSearchSameCount: this.preemptiveShadowSearchSameCount,
      preemptiveShadowSearchDifferentCount:
        this.preemptiveShadowSearchDifferentCount,
      strictOwnerSkipCount: this.strictOwnerSkipCount,
      committedSkipCount: this.committedSkipCount,
      committedSearchMode: this.committedSearchMode,
      committedSearchCount: this.committedSearchCount,
      committedSearchCompleteCount: this.committedSearchCompleteCount,
      committedSearchIncompleteCount: this.committedSearchIncompleteCount,
      committedSearchNoMemberCount: this.committedSearchNoMemberCount,
      committedSearchMemberBlockedCount:
        this.committedSearchMemberBlockedCount,
      committedSearchSelectionViolationCount:
        this.committedSearchSelectionViolationCount,
      noCompleteValueCount: this.noCompleteValueCount,
      riskFrontierMode: this.riskFrontierMode,
      riskSoftBandMode: this.riskSoftBandMode,
      intentValueMode: this.intentValueMode,
      physicalOwnerCount: this.physicalOwnerCount,
      informationOwnerCount: this.informationOwnerCount,
      proposalCount: this.proposalCount, sameActionCount: this.sameActionCount,
      policySearchSupportMode: this.policySearchSupportMode,
      policySearchStrictSupportBlockedCount:
        this.policySearchStrictSupportBlockedCount,
      policySearchExactSupportBlockedCount:
        this.policySearchExactSupportBlockedCount,
      candidateForcedWin: this.candidateForcedWin ?
        this.candidateForcedWin.summary() : null,
      overrideCount: this.overrideCount, goOverrideCount: this.goOverrideCount,
      turnOverrideCount: this.turnOverrideCount, fireOverrideCount: this.fireOverrideCount,
      otherOverrideCount: this.otherOverrideCount, domainBlockedCount: this.domainBlockedCount,
      riskSupportMissingCount: this.riskSupportMissingCount,
      riskRejectedCount: this.riskRejectedCount,
      riskDominatedCount: this.riskDominatedCount,
      softRiskCandidateCount: this.softRiskCandidateCount,
      softRiskIntentAllowedCount: this.softRiskIntentAllowedCount,
      softRiskImmediateBlockedCount: this.softRiskImmediateBlockedCount,
      softRiskUnknownBlockedCount: this.softRiskUnknownBlockedCount,
      softRiskDominatedBlockedCount: this.softRiskDominatedBlockedCount,
      softRiskIntentBlockedCount: this.softRiskIntentBlockedCount,
      selectedRiskOnlyDominatedCount: this.selectedRiskOnlyDominatedCount,
      selectedJointDominatedCount: this.selectedJointDominatedCount,
      exactFireBypassCount: this.exactFireBypassCount,
      opponentBlendBasisPoints: this.opponentBlendBasisPoints,
      nominalBackupCount: this.nominalBackupCount,
      nominalBackupSkipCount: this.nominalBackupSkipCount,
      pathNominalTieBreakCount: this.pathNominalTieBreakCount,
      resourceRequiresCellwiseDominance: this.resourceRequiresCellwiseDominance,
      resourceCellwiseDominanceScope: this.resourceCellwiseDominanceScope,
      intentMembership: this.intentMembership,
      basePolicyVerifierMode: this.basePolicyVerifierMode,
      basePolicyVerifierMargin: this.basePolicyVerifierMargin,
      resourceDominanceCheckCount: this.resourceDominanceCheckCount,
      resourceDominanceAcceptedCount: this.resourceDominanceAcceptedCount,
      resourceDominanceRejectedCount: this.resourceDominanceRejectedCount,
      intentMembershipRootCount: this.intentMembershipRootCount,
      intentMembershipBlockedCount: this.intentMembershipBlockedCount,
      basePolicyVerifierCheckCount: this.basePolicyVerifierCheckCount,
      basePolicyVerifierAvailableCount: this.basePolicyVerifierAvailableCount,
      basePolicyVerifierKeptCount: this.basePolicyVerifierKeptCount,
      basePolicyVerifierSearchOverrideCount:
        this.basePolicyVerifierSearchOverrideCount,
      basePolicyVerifierResourceBlockedCount:
        this.basePolicyVerifierResourceBlockedCount,
      verifiedInterceptMode: this.verifiedInterceptMode,
      verifiedInterceptBand: this.verifiedInterceptBand,
      verifiedInterceptCheckCount: this.verifiedInterceptCheckCount,
      verifiedInterceptFireRowCount: this.verifiedInterceptFireRowCount,
      verifiedInterceptValueBlockedCount: this.verifiedInterceptValueBlockedCount,
      verifiedInterceptClosureBlockedCount:
        this.verifiedInterceptClosureBlockedCount,
      verifiedInterceptNoDoomedResponseCount:
        this.verifiedInterceptNoDoomedResponseCount,
      verifiedInterceptUnknownResponseCount:
        this.verifiedInterceptUnknownResponseCount,
      verifiedInterceptEscapeBlockedCount:
        this.verifiedInterceptEscapeBlockedCount,
      verifiedInterceptPurposeBlockedCount:
        this.verifiedInterceptPurposeBlockedCount,
      verifiedInterceptExposureBlockedCount:
        this.verifiedInterceptExposureBlockedCount,
      verifiedInterceptEvidenceCount: this.verifiedInterceptEvidenceCount,
      verifiedInterceptWouldOverrideCount:
        this.verifiedInterceptWouldOverrideCount,
      verifiedInterceptOverrideCount: this.verifiedInterceptOverrideCount,
      fireEvidenceSelection: this.fireEvidenceSelection,
      fireEvidenceCheckCount: this.fireEvidenceCheckCount,
      fireEvidenceSupportedCount: this.fireEvidenceSupportedCount,
      fireEvidenceIncompleteCount: this.fireEvidenceIncompleteCount,
      fireEvidenceDemotionCount: this.fireEvidenceDemotionCount,
      fireEvidenceNoAlternativeCount: this.fireEvidenceNoAlternativeCount,
      poisonProposalMode: this.poisonProposalMode,
      poisonProposalPolicy: this.poisonProposalPolicy,
      poisonProposalCheckCount: this.poisonProposalCheckCount,
      poisonProposalRowCount: this.poisonProposalRowCount,
      poisonProposalVisibilityBlockedCount:
        this.poisonProposalVisibilityBlockedCount,
      poisonProposalAlreadyActiveBlockedCount:
        this.poisonProposalAlreadyActiveBlockedCount,
      poisonProposalEnemyEffectBlockedCount:
        this.poisonProposalEnemyEffectBlockedCount,
      poisonProposalCadenceBlockedCount: this.poisonProposalCadenceBlockedCount,
      poisonProposalRelevanceBlockedCount: this.poisonProposalRelevanceBlockedCount,
      poisonProposalPolicyBlockedCount: this.poisonProposalPolicyBlockedCount,
      poisonProposalRiskBlockedCount: this.poisonProposalRiskBlockedCount,
      poisonProposalCommittedBlockedCount: this.poisonProposalCommittedBlockedCount,
      poisonProposalValueBlockedCount: this.poisonProposalValueBlockedCount,
      poisonProposalCellwiseBlockedCount: this.poisonProposalCellwiseBlockedCount,
      poisonProposalBasePolicyBlockedCount:
        this.poisonProposalBasePolicyBlockedCount,
      poisonProposalEvidenceCount: this.poisonProposalEvidenceCount,
      poisonProposalWouldOverrideCount: this.poisonProposalWouldOverrideCount,
      poisonProposalOverrideCount: this.poisonProposalOverrideCount,
      attackPoseBand: this.attackPoseBand,
      attackPoseOptionFirst: this.attackPoseOptionFirst,
      attackPoseRequiredAimTurns: this.attackPoseRequiredAimTurns,
      attackPosePrepareCount: this.attackPosePrepareCount,
      attackPoseEvidenceCount: this.attackPoseEvidenceCount,
      attackPoseOverrideCount: this.attackPoseOverrideCount,
      attackPoseSameCount: this.attackPoseSameCount,
      attackPoseTerminalProtectedCount: this.attackPoseTerminalProtectedCount,
      attackPoseTerminalLossRejectedCount: this.attackPoseTerminalLossRejectedCount,
      attackPoseAimTurnAcceptedCount: this.attackPoseAimTurnAcceptedCount,
      attackPoseAimTurnRejectedCount: this.attackPoseAimTurnRejectedCount,
      stunWindowRootCount: this.stunWindowRootCount,
      stunWindowStrictSkipCount: this.stunWindowStrictSkipCount,
      stunWindowCommittedSkipCount: this.stunWindowCommittedSkipCount,
      stunWindowCompleteSearchCount: this.stunWindowCompleteSearchCount,
      stunWindowIncompleteSearchCount: this.stunWindowIncompleteSearchCount,
      stunWindowFireMissingCount: this.stunWindowFireMissingCount,
      stunWindowFireHardBlockedCount: this.stunWindowFireHardBlockedCount,
      stunWindowFireDomainBlockedCount: this.stunWindowFireDomainBlockedCount,
      stunWindowFireSourceDomainBlockedCount:
        this.stunWindowFireSourceDomainBlockedCount,
      stunWindowFireOwnerDomainBlockedCount:
        this.stunWindowFireOwnerDomainBlockedCount,
      stunWindowFireIntentBlockedCount: this.stunWindowFireIntentBlockedCount,
      stunWindowOwnProjectileCount: this.stunWindowOwnProjectileCount,
      stunWindowFireLockCount: this.stunWindowFireLockCount,
      stunWindowFireEligibleCount: this.stunWindowFireEligibleCount,
      stunWindowFireMinimaxBestCount: this.stunWindowFireMinimaxBestCount,
      stunWindowFireFinalSelectedCount: this.stunWindowFireFinalSelectedCount,
      stunWindowFireDirectKillCount: this.stunWindowFireDirectKillCount,
      stunWindowFirePossibleHitCount: this.stunWindowFirePossibleHitCount,
      stunWindowFireInterceptCount: this.stunWindowFireInterceptCount,
      stunWindowFireAimSetupCount: this.stunWindowFireAimSetupCount,
      stunWindowFirePostEscapeCount: this.stunWindowFirePostEscapeCount,
      stunWindowFirePurposeCompleteCount:
        this.stunWindowFirePurposeCompleteCount,
      stunWindowFireVerifiedOpportunityCount:
        this.stunWindowFireVerifiedOpportunityCount,
      stunWindowIncumbentActionCount:
        Array.from(this.stunWindowIncumbentActionCount),
      stunWindowMinimaxActionCount:
        Array.from(this.stunWindowMinimaxActionCount),
      stunWindowFinalActionCount: Array.from(this.stunWindowFinalActionCount),
      stunWindowFireGapHistogram:
        Array.from(this.stunWindowFireGapHistogram),
      qualifiedFireRootCount: this.qualifiedFireRootCount,
      qualifiedFirePresentCount: this.qualifiedFirePresentCount,
      qualifiedFireAllowedCount: this.qualifiedFireAllowedCount,
      qualifiedFireRiskRejectedCount: this.qualifiedFireRiskRejectedCount,
      qualifiedFireRiskDominatedCount: this.qualifiedFireRiskDominatedCount,
      qualifiedFirePurposeCount: this.qualifiedFirePurposeCount,
      qualifiedFireDirectKillCount: this.qualifiedFireDirectKillCount,
      qualifiedFirePossibleHitCount: this.qualifiedFirePossibleHitCount,
      qualifiedFireInterceptCount: this.qualifiedFireInterceptCount,
      qualifiedFireAimSetupCount: this.qualifiedFireAimSetupCount,
      qualifiedFireEnemyDoomedCount: this.qualifiedFireEnemyDoomedCount,
      qualifiedFireUnknownResponseCount:
        this.qualifiedFireUnknownResponseCount,
      qualifiedFirePostEscapeCount: this.qualifiedFirePostEscapeCount,
      qualifiedFireClosureCompleteCount:
        this.qualifiedFireClosureCompleteCount,
      qualifiedFireVerifiedCount: this.qualifiedFireVerifiedCount,
      qualifiedFireMinimaxSelectedCount:
        this.qualifiedFireMinimaxSelectedCount,
      qualifiedFireFinalSelectedCount: this.qualifiedFireFinalSelectedCount,
      qualifiedFireValueLossCount: this.qualifiedFireValueLossCount,
      qualifiedFireTieLossCount: this.qualifiedFireTieLossCount,
      qualifiedFireRawWorstLossCount: this.qualifiedFireRawWorstLossCount,
      qualifiedFireRawWorstTieCount: this.qualifiedFireRawWorstTieCount,
      qualifiedFireRawWorstWinCount: this.qualifiedFireRawWorstWinCount,
      qualifiedFireNominalFlipCount: this.qualifiedFireNominalFlipCount,
      qualifiedFireIntentFlipCount: this.qualifiedFireIntentFlipCount,
      qualifiedFireIntentGapSum: this.qualifiedFireIntentGapSum,
      qualifiedFireTerminalLossCount: this.qualifiedFireTerminalLossCount,
      qualifiedFireDominatesBestCount: this.qualifiedFireDominatesBestCount,
      qualifiedFireDominatedByBestCount:
        this.qualifiedFireDominatedByBestCount,
      qualifiedFireMatrixTradeoffCount:
        this.qualifiedFireMatrixTradeoffCount,
      qualifiedFireValueGapSum: this.qualifiedFireValueGapSum,
      qualifiedFireValueGapMax: this.qualifiedFireValueGapMax,
      qualifiedFireBestActionCount:
        Array.from(this.qualifiedFireBestActionCount),
      qualifiedFireReasonCount: Array.from(this.qualifiedFireReasonCount),
      qualifiedFireGapHistogram: Array.from(this.qualifiedFireGapHistogram),
      qualifiedFireOwnerMode: this.qualifiedFireOwnerMode,
      qualifiedFireOwnerCheckCount: this.qualifiedFireOwnerCheckCount,
      qualifiedFireOwnerIntentProposalCount:
        this.qualifiedFireOwnerIntentProposalCount,
      qualifiedFireOwnerResponseProposalCount:
        this.qualifiedFireOwnerResponseProposalCount,
      qualifiedFireOwnerClosureBlockedCount:
        this.qualifiedFireOwnerClosureBlockedCount,
      qualifiedFireOwnerWouldOverrideCount:
        this.qualifiedFireOwnerWouldOverrideCount,
      qualifiedFireOwnerOverrideCount: this.qualifiedFireOwnerOverrideCount,
      qualifiedFireOwnerSameCount: this.qualifiedFireOwnerSameCount,
      qualifiedFireOracleAuditCount: this.qualifiedFireOracleAuditCount,
      qualifiedFireOracleMissingCount: this.qualifiedFireOracleMissingCount,
      qualifiedFireOraclePairComparedCount:
        this.qualifiedFireOraclePairComparedCount,
      qualifiedFireOracleFireLowerCount:
        this.qualifiedFireOracleFireLowerCount,
      qualifiedFireOracleFireTieCount: this.qualifiedFireOracleFireTieCount,
      qualifiedFireOracleFireHigherCount:
        this.qualifiedFireOracleFireHigherCount,
      qualifiedFireOracleBestAgreementCount:
        this.qualifiedFireOracleBestAgreementCount,
      qualifiedFireOracleBestFireCount: this.qualifiedFireOracleBestFireCount,
      qualifiedFireOracleGapSum: this.qualifiedFireOracleGapSum,
      qualifiedFireOracleGapMax: this.qualifiedFireOracleGapMax,
      qualifiedFireOneStepFireComparedCount:
        this.qualifiedFireOneStepFireComparedCount,
      qualifiedFireOneStepFireMismatchCount:
        this.qualifiedFireOneStepFireMismatchCount,
      qualifiedFireOneStepFireUnsupportedCount:
        this.qualifiedFireOneStepFireUnsupportedCount,
      qualifiedFireOneStepBestComparedCount:
        this.qualifiedFireOneStepBestComparedCount,
      qualifiedFireOneStepBestMismatchCount:
        this.qualifiedFireOneStepBestMismatchCount,
      qualifiedFireOneStepBestUnsupportedCount:
        this.qualifiedFireOneStepBestUnsupportedCount,
      qualifiedFireDeepFireComparedCount:
        this.qualifiedFireDeepFireComparedCount,
      qualifiedFireDeepFireMismatchCount:
        this.qualifiedFireDeepFireMismatchCount,
      qualifiedFireDeepFireUnsupportedCount:
        this.qualifiedFireDeepFireUnsupportedCount,
      qualifiedFireDeepBestComparedCount:
        this.qualifiedFireDeepBestComparedCount,
      qualifiedFireDeepBestMismatchCount:
        this.qualifiedFireDeepBestMismatchCount,
      qualifiedFireDeepBestUnsupportedCount:
        this.qualifiedFireDeepBestUnsupportedCount,
      qualifiedFireOneStepFireComponentSignedDifference: Array.from(
        this.qualifiedFireOneStepFireComponentSignedDifference),
      qualifiedFireOneStepFireComponentAbsDifference: Array.from(
        this.qualifiedFireOneStepFireComponentAbsDifference),
      qualifiedFireOneStepBestComponentSignedDifference: Array.from(
        this.qualifiedFireOneStepBestComponentSignedDifference),
      qualifiedFireOneStepBestComponentAbsDifference: Array.from(
        this.qualifiedFireOneStepBestComponentAbsDifference),
      qualifiedFireDeepFireComponentSignedDifference: Array.from(
        this.qualifiedFireDeepFireComponentSignedDifference),
      qualifiedFireDeepFireComponentAbsDifference: Array.from(
        this.qualifiedFireDeepFireComponentAbsDifference),
      qualifiedFireDeepBestComponentSignedDifference: Array.from(
        this.qualifiedFireDeepBestComponentSignedDifference),
      qualifiedFireDeepBestComponentAbsDifference: Array.from(
        this.qualifiedFireDeepBestComponentAbsDifference),
      qualifiedFireMismatchOneStepFireComponentSignedDifference: Array.from(
        this.qualifiedFireMismatchOneStepFireComponentSignedDifference),
      qualifiedFireMismatchOneStepFireComponentAbsDifference: Array.from(
        this.qualifiedFireMismatchOneStepFireComponentAbsDifference),
      qualifiedFireMismatchOneStepBestComponentSignedDifference: Array.from(
        this.qualifiedFireMismatchOneStepBestComponentSignedDifference),
      qualifiedFireMismatchOneStepBestComponentAbsDifference: Array.from(
        this.qualifiedFireMismatchOneStepBestComponentAbsDifference),
      qualifiedFireMismatchDeepFireComponentSignedDifference: Array.from(
        this.qualifiedFireMismatchDeepFireComponentSignedDifference),
      qualifiedFireMismatchDeepFireComponentAbsDifference: Array.from(
        this.qualifiedFireMismatchDeepFireComponentAbsDifference),
      qualifiedFireMismatchDeepBestComponentSignedDifference: Array.from(
        this.qualifiedFireMismatchDeepBestComponentSignedDifference),
      qualifiedFireMismatchDeepBestComponentAbsDifference: Array.from(
        this.qualifiedFireMismatchDeepBestComponentAbsDifference),
      qualifiedFireMismatchOneStepFireComparedCount:
        this.qualifiedFireMismatchOneStepFireComparedCount,
      qualifiedFireMismatchOneStepFireMismatchCount:
        this.qualifiedFireMismatchOneStepFireMismatchCount,
      qualifiedFireMismatchOneStepFireUnsupportedCount:
        this.qualifiedFireMismatchOneStepFireUnsupportedCount,
      qualifiedFireMismatchOneStepBestComparedCount:
        this.qualifiedFireMismatchOneStepBestComparedCount,
      qualifiedFireMismatchOneStepBestMismatchCount:
        this.qualifiedFireMismatchOneStepBestMismatchCount,
      qualifiedFireMismatchOneStepBestUnsupportedCount:
        this.qualifiedFireMismatchOneStepBestUnsupportedCount,
      qualifiedFireMismatchDeepFireComparedCount:
        this.qualifiedFireMismatchDeepFireComparedCount,
      qualifiedFireMismatchDeepFireMismatchCount:
        this.qualifiedFireMismatchDeepFireMismatchCount,
      qualifiedFireMismatchDeepFireUnsupportedCount:
        this.qualifiedFireMismatchDeepFireUnsupportedCount,
      qualifiedFireMismatchDeepBestComparedCount:
        this.qualifiedFireMismatchDeepBestComparedCount,
      qualifiedFireMismatchDeepBestMismatchCount:
        this.qualifiedFireMismatchDeepBestMismatchCount,
      qualifiedFireMismatchDeepBestUnsupportedCount:
        this.qualifiedFireMismatchDeepBestUnsupportedCount,
      attackPosePolicySearch: this.attackPosePolicySearch ?
        this.attackPosePolicySearch.summary() : null,
      policySearch: this.policySearch ? this.policySearch.summary() : null,
      hotAllocationCount: this.hotAllocationCount,
      ...(this.rootSamples ? { rootSamples: this.rootSamples } : {}) };
  }
}

module.exports = { MEMBERSHIP_STAGE, QUALIFIED_FIRE_CLASS, actionPriority,
  NativeTacticalActionOwnerPoc };
