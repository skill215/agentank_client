"use strict";

// Diagnostic policy-level Minimax.  The incumbent keeps the already-computed
// native Physical search.  Challenging root rows are re-evaluated in an
// independent cache namespace whose own continuation is the receding
// AttackPose policy.  This preserves policy identity instead of adding the
// same primitive representative to every root branch.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION, FAST_STATUS, HARD_STATUS, SKILL, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ProductionCacheBank } = require(
  "../../../engine-v2/src/cache/production-cache");
const { ProductionDepthSearch, ROOT_INTERVAL_STATUS } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { NativeTacticalLeafEvaluatorPoc, NativeTacticalLeafAblationPoc,
  NativeTacticalRepresentativePoc,
  NativeAttackPoseFeedbackSearchPoc, NativeTacticalHistoryPoc,
  NativePolicyOutcomeLexicographicPoc,
  NativeProjectileSettlementLexicographicPoc } = require(
  "./native-tactical-domain-evaluator-poc");

const PAIR_RELATION = Object.freeze({ INCOMPLETE: 0, CANDIDATE_HIGHER: 1,
  EQUAL: 2, CANDIDATE_LOWER: 3 });
const PAIR_SUPPORT_REASON = Object.freeze({ NONE: 0, SOURCE: 1 << 0,
  DOMAIN: 1 << 1, ROOT_RESTORE: 1 << 2, BUDGET: 1 << 3,
  WIDTH: 1 << 4, TRANSITION: 1 << 5, TRAVERSAL: 1 << 6,
  REPRESENTATIVE_DEPTH: 1 << 7, OTHER: 1 << 8,
  FAST_ABORT: 1 << 9, HARD_ABORT: 1 << 10 });
const PAIR_REASON_CAPACITY = 2048;
const DIAGNOSTIC_ACTION_CAPACITY = ACTION.BOOST_RIGHT_BOMB + 1;
const DIAGNOSTIC_FAST_STATUS_CAPACITY = FAST_STATUS.EXECUTION_ERROR + 1;
const DIAGNOSTIC_HARD_STATUS_CAPACITY = HARD_STATUS.INCOMPLETE + 1;
const DIAGNOSTIC_FAST_REASON_CAPACITY = 9;
const DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY = 5;
const DIAGNOSTIC_DEPTH_CAPACITY = 8;

class DiagnosticExpansionDepthSearch extends ProductionDepthSearch {
  constructor(cacheBank, runtimeConfig, rootTransitions, options = {}) {
    super(cacheBank, runtimeConfig, rootTransitions, options);
    this.diagnosticDeepExpansionLimit = Math.max(2, Math.min(4,
      options.diagnosticDeepExpansionLimit | 0 || 2));
    // BP132: diagnostic-only transition attribution.  The wrapper functions
    // are allocated once and temporarily installed only while this diagnostic
    // search runs.  ProductionDepthSearch and the production bundle remain
    // untouched.
    this.diagnosticFastStatusCounts = new Uint32Array(
      DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.diagnosticFastReasonCounts = new Uint32Array(
      DIAGNOSTIC_FAST_REASON_CAPACITY * 2);
    this.diagnosticRelocationDetailCounts = new Uint32Array(
      DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY * 2);
    this.diagnosticFastActionPairCounts = new Uint32Array(
      DIAGNOSTIC_ACTION_CAPACITY * DIAGNOSTIC_ACTION_CAPACITY * 2);
    this.diagnosticHardStatusCounts = new Uint32Array(
      DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.diagnosticHardIncompleteActionPairCounts = new Uint32Array(
      DIAGNOSTIC_ACTION_CAPACITY * DIAGNOSTIC_ACTION_CAPACITY);
    this.diagnosticFastDepthStatusCounts = new Uint32Array(
      DIAGNOSTIC_DEPTH_CAPACITY * DIAGNOSTIC_FAST_STATUS_CAPACITY * 2);
    this.diagnosticHardDepthStatusCounts = new Uint32Array(
      DIAGNOSTIC_DEPTH_CAPACITY * DIAGNOSTIC_HARD_STATUS_CAPACITY);
    this.diagnosticRootFrame = 0; this.diagnosticInsideHard = 0;
    this.diagnosticKernel = null; this.diagnosticHard = null;
    this.diagnosticOriginalApplyFrame = null;
    this.diagnosticOriginalClassifyApplied = null;
    this.diagnosticLastAction0 = ACTION.NONE;
    this.diagnosticLastAction1 = ACTION.NONE;
    this.diagnosticLastArgument0 = 0xffff;
    this.diagnosticLastArgument1 = 0xffff;
    this.diagnosticLastChance0 = 0; this.diagnosticLastChance1 = 0;
    this.diagnosticLastPly = 0; this.diagnosticLastFastStatus = 0;
    this.diagnosticLastFastReason = 0; this.diagnosticLastFastDetail = 0;
    this.diagnosticLastFastInsideHard = 0;
    this.diagnosticFirstFastStatus = 0; this.diagnosticFirstFastReason = 0;
    this.diagnosticFirstFastDetail = 0; this.diagnosticFirstFastInsideHard = 0;
    this.diagnosticFirstFastAction0 = ACTION.NONE;
    this.diagnosticFirstFastAction1 = ACTION.NONE;
    this.diagnosticFirstFastArgument0 = 0xffff;
    this.diagnosticFirstFastArgument1 = 0xffff;
    this.diagnosticFirstFastChance0 = 0; this.diagnosticFirstFastChance1 = 0;
    this.diagnosticFirstFastPly = 0;
    this.diagnosticFirstFastStartCell0 = 0xffff;
    this.diagnosticFirstFastStartCell1 = 0xffff;
    this.diagnosticFirstFastPreparedTarget0 = 0xffff;
    this.diagnosticFirstFastPreparedTarget1 = 0xffff;
    this.diagnosticFirstFastConfirmedVacatingMask = 0;
    this.diagnosticFirstFastEffectMask0 = 0;
    this.diagnosticFirstFastEffectMask1 = 0;
    this.diagnosticLastHardStatus = 0;
    this.diagnosticLastHardAction0 = ACTION.NONE;
    this.diagnosticLastHardAction1 = ACTION.NONE;
    this.diagnosticLastHardArgument0 = 0xffff;
    this.diagnosticLastHardArgument1 = 0xffff;
    this.diagnosticLastHardChance0 = 0;
    this.diagnosticLastHardChance1 = 0;
    this.diagnosticLastHardPly = 0;
    this.diagnosticFirstHardStatus = 0;
    this.diagnosticFirstHardAction0 = ACTION.NONE;
    this.diagnosticFirstHardAction1 = ACTION.NONE;
    this.diagnosticFirstHardArgument0 = 0xffff;
    this.diagnosticFirstHardArgument1 = 0xffff;
    this.diagnosticFirstHardChance0 = 0;
    this.diagnosticFirstHardChance1 = 0;
    this.diagnosticFirstHardPly = 0;
    this.diagnosticFirstHardViableCode = 0;
    this.diagnosticFirstHardHazardComplete = 0;
    this.diagnosticFirstHardNarrowProofComplete = 0;
    this.diagnosticFirstHardHorizonTick = 0;
    this.diagnosticFirstHardShieldEscape = 0;
    this.diagnosticFirstHardBoostEscape = 0;
    this.diagnosticFirstHardTeleportEscape = 0;
    this.diagnosticApplyFrameWrapper = this.captureDiagnosticApplyFrame.bind(this);
    this.diagnosticClassifyAppliedWrapper =
      this.captureDiagnosticClassifyApplied.bind(this);
  }

  resetDiagnosticTransitionTelemetry(bundle) {
    this.diagnosticFastStatusCounts.fill(0);
    this.diagnosticFastReasonCounts.fill(0);
    this.diagnosticRelocationDetailCounts.fill(0);
    this.diagnosticFastActionPairCounts.fill(0);
    this.diagnosticHardStatusCounts.fill(0);
    this.diagnosticHardIncompleteActionPairCounts.fill(0);
    this.diagnosticFastDepthStatusCounts.fill(0);
    this.diagnosticHardDepthStatusCounts.fill(0);
    this.diagnosticRootFrame = bundle.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] | 0;
    this.diagnosticInsideHard = 0;
    this.diagnosticLastFastStatus = 0; this.diagnosticLastFastReason = 0;
    this.diagnosticLastFastDetail = 0; this.diagnosticLastFastInsideHard = 0;
    this.diagnosticLastHardStatus = 0;
    this.diagnosticFirstFastStatus = 0; this.diagnosticFirstFastReason = 0;
    this.diagnosticFirstFastDetail = 0; this.diagnosticFirstFastInsideHard = 0;
    this.diagnosticFirstFastStartCell0 = 0xffff;
    this.diagnosticFirstFastStartCell1 = 0xffff;
    this.diagnosticFirstFastPreparedTarget0 = 0xffff;
    this.diagnosticFirstFastPreparedTarget1 = 0xffff;
    this.diagnosticFirstFastConfirmedVacatingMask = 0;
    this.diagnosticFirstFastEffectMask0 = 0;
    this.diagnosticFirstFastEffectMask1 = 0;
    this.diagnosticFirstHardStatus = 0; this.diagnosticFirstHardViableCode = 0;
    this.diagnosticFirstHardHazardComplete = 0;
    this.diagnosticFirstHardNarrowProofComplete = 0;
    this.diagnosticFirstHardHorizonTick = 0;
    this.diagnosticFirstHardShieldEscape = 0;
    this.diagnosticFirstHardBoostEscape = 0;
    this.diagnosticFirstHardTeleportEscape = 0;
  }

  diagnosticPly() {
    const frame = this.diagnosticKernel.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] | 0;
    const ply = frame - this.diagnosticRootFrame - (this.diagnosticInsideHard ? 1 : 0);
    return Math.max(0, Math.min(DIAGNOSTIC_DEPTH_CAPACITY - 1, ply));
  }

  diagnosticEffectMask(seat) {
    const a = this.diagnosticKernel.state.arrays;
    let mask = 0;
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL];
    const stun = a[ARRAY.TANK_STUN_UNTIL];
    const poison = a[ARRAY.TANK_POISON_UNTIL];
    const boost = a[ARRAY.TANK_BOOST_UNTIL];
    if (frozen && this.diagnosticKernel.active(frozen[seat])) mask |= 1;
    if (stun && this.diagnosticKernel.active(stun[seat])) mask |= 2;
    if (poison && this.diagnosticKernel.active(poison[seat])) mask |= 4;
    if (boost && this.diagnosticKernel.active(boost[seat])) mask |= 8;
    return mask;
  }

  captureDiagnosticApplyFrame(action0, argument0, action1, argument1,
      chance0, chance1) {
    const insideHard = this.diagnosticInsideHard ? 1 : 0;
    const ply = this.diagnosticPly();
    this.diagnosticLastAction0 = action0; this.diagnosticLastAction1 = action1;
    this.diagnosticLastArgument0 = argument0; this.diagnosticLastArgument1 = argument1;
    this.diagnosticLastChance0 = chance0; this.diagnosticLastChance1 = chance1;
    this.diagnosticLastPly = ply;
    const status = this.diagnosticOriginalApplyFrame.call(this.diagnosticKernel,
      action0, argument0, action1, argument1, chance0, chance1);
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      const phaseOffset = insideHard * DIAGNOSTIC_FAST_STATUS_CAPACITY;
      if (status >= 0 && status < DIAGNOSTIC_FAST_STATUS_CAPACITY) {
        this.diagnosticFastStatusCounts[phaseOffset + status] += 1;
        this.diagnosticFastDepthStatusCounts[(insideHard * DIAGNOSTIC_DEPTH_CAPACITY + ply) *
          DIAGNOSTIC_FAST_STATUS_CAPACITY + status] += 1;
      }
      const reason = this.diagnosticKernel.failureReason | 0;
      const detail = this.diagnosticKernel.failureDetail | 0;
      if (reason >= 0 && reason < DIAGNOSTIC_FAST_REASON_CAPACITY)
        this.diagnosticFastReasonCounts[insideHard * DIAGNOSTIC_FAST_REASON_CAPACITY +
          reason] += 1;
      if (detail >= 0 && detail < DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY)
        this.diagnosticRelocationDetailCounts[insideHard *
          DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY + detail] += 1;
      if (action0 >= 0 && action0 < DIAGNOSTIC_ACTION_CAPACITY &&
          action1 >= 0 && action1 < DIAGNOSTIC_ACTION_CAPACITY)
        this.diagnosticFastActionPairCounts[(insideHard * DIAGNOSTIC_ACTION_CAPACITY +
          action0) * DIAGNOSTIC_ACTION_CAPACITY + action1] += 1;
      this.diagnosticLastFastStatus = status | 0;
      this.diagnosticLastFastReason = reason;
      this.diagnosticLastFastDetail = detail;
      this.diagnosticLastFastInsideHard = insideHard;
      if (!this.diagnosticFirstFastStatus) {
        this.diagnosticFirstFastStatus = status | 0;
        this.diagnosticFirstFastReason = reason;
        this.diagnosticFirstFastDetail = detail;
        this.diagnosticFirstFastInsideHard = insideHard;
        this.diagnosticFirstFastAction0 = action0;
        this.diagnosticFirstFastAction1 = action1;
        this.diagnosticFirstFastArgument0 = argument0;
        this.diagnosticFirstFastArgument1 = argument1;
        this.diagnosticFirstFastChance0 = chance0;
        this.diagnosticFirstFastChance1 = chance1;
        this.diagnosticFirstFastPly = ply;
        this.diagnosticFirstFastStartCell0 =
          this.diagnosticKernel.frameStartCell0 | 0;
        this.diagnosticFirstFastStartCell1 =
          this.diagnosticKernel.frameStartCell1 | 0;
        this.diagnosticFirstFastPreparedTarget0 =
          this.diagnosticKernel.preparedTarget0 | 0;
        this.diagnosticFirstFastPreparedTarget1 =
          this.diagnosticKernel.preparedTarget1 | 0;
        this.diagnosticFirstFastConfirmedVacatingMask =
          this.diagnosticKernel.confirmedVacatingMask | 0;
        this.diagnosticFirstFastEffectMask0 = this.diagnosticEffectMask(0);
        this.diagnosticFirstFastEffectMask1 = this.diagnosticEffectMask(1);
      }
    }
    return status;
  }

  captureDiagnosticClassifyApplied() {
    // ReverseViability may itself apply transitions. Preserve the outer pair
    // before entering Hard so its INCOMPLETE verdict is attributed correctly.
    const action0 = this.diagnosticLastAction0;
    const action1 = this.diagnosticLastAction1;
    const argument0 = this.diagnosticLastArgument0;
    const argument1 = this.diagnosticLastArgument1;
    const chance0 = this.diagnosticLastChance0;
    const chance1 = this.diagnosticLastChance1;
    const ply = this.diagnosticLastPly;
    this.diagnosticInsideHard = 1;
    const status = this.diagnosticOriginalClassifyApplied.call(this.diagnosticHard);
    this.diagnosticInsideHard = 0;
    if (status >= 0 && status < DIAGNOSTIC_HARD_STATUS_CAPACITY) {
      this.diagnosticHardStatusCounts[status] += 1;
      this.diagnosticHardDepthStatusCounts[ply * DIAGNOSTIC_HARD_STATUS_CAPACITY +
        status] += 1;
    }
    if (status === HARD_STATUS.INCOMPLETE && action0 >= 0 &&
        action0 < DIAGNOSTIC_ACTION_CAPACITY && action1 >= 0 &&
        action1 < DIAGNOSTIC_ACTION_CAPACITY)
      this.diagnosticHardIncompleteActionPairCounts[action0 *
        DIAGNOSTIC_ACTION_CAPACITY + action1] += 1;
    if (status === HARD_STATUS.INCOMPLETE) {
      this.diagnosticLastHardStatus = status;
      this.diagnosticLastHardAction0 = action0;
      this.diagnosticLastHardAction1 = action1;
      this.diagnosticLastHardArgument0 = argument0;
      this.diagnosticLastHardArgument1 = argument1;
      this.diagnosticLastHardChance0 = chance0;
      this.diagnosticLastHardChance1 = chance1;
      this.diagnosticLastHardPly = ply;
      if (!this.diagnosticFirstHardStatus) {
        this.diagnosticFirstHardStatus = status;
        this.diagnosticFirstHardAction0 = action0;
        this.diagnosticFirstHardAction1 = action1;
        this.diagnosticFirstHardArgument0 = argument0;
        this.diagnosticFirstHardArgument1 = argument1;
        this.diagnosticFirstHardChance0 = chance0;
        this.diagnosticFirstHardChance1 = chance1;
        this.diagnosticFirstHardPly = ply;
        const hazard = this.diagnosticHard.hazard;
        const arrays = this.diagnosticKernel.state.arrays;
        const seat = this.diagnosticHard.perspectiveSeat | 0;
        const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME] | 0;
        this.diagnosticFirstHardViableCode =
          (this.diagnosticHard.lastViable | 0) + 1;
        this.diagnosticFirstHardHazardComplete = hazard?.complete ? 1 : 0;
        this.diagnosticFirstHardNarrowProofComplete =
          hazard?.narrowProofComplete ? 1 : 0;
        this.diagnosticFirstHardHorizonTick = hazard?.horizonTick | 0;
        this.diagnosticFirstHardShieldEscape =
          arrays[ARRAY.TANK_SHIELD_HITS]?.[seat] > 0 &&
          arrays[ARRAY.TANK_SHIELD_UNTIL]?.[seat] !== NONE_FRAME ? 1 : 0;
        this.diagnosticFirstHardBoostEscape =
          arrays[ARRAY.TANK_BOOST_UNTIL]?.[seat] !== NONE_FRAME ? 1 : 0;
        this.diagnosticFirstHardTeleportEscape =
          arrays[ARRAY.TANK_SKILL]?.[seat] === SKILL.TELEPORT &&
          arrays[ARRAY.TANK_SKILL_READY]?.[seat] <= frame ? 1 : 0;
      }
    }
    return status;
  }

  search(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments,
      enemyCount, targetDepth, nodeBudget, baseRisk = 0, workUnitBudget = 0,
      rootDomainRows = null, rootDomainCount = 0) {
    this.resetDiagnosticTransitionTelemetry(bundle);
    const kernel = bundle.kernel; const hard = bundle.hard;
    const kernelOwned = Object.prototype.hasOwnProperty.call(kernel, "applyFrame");
    const hardOwned = Object.prototype.hasOwnProperty.call(hard, "classifyApplied");
    this.diagnosticKernel = kernel; this.diagnosticHard = hard;
    this.diagnosticOriginalApplyFrame = kernel.applyFrame;
    this.diagnosticOriginalClassifyApplied = hard.classifyApplied;
    kernel.applyFrame = this.diagnosticApplyFrameWrapper;
    hard.classifyApplied = this.diagnosticClassifyAppliedWrapper;
    try {
      return super.search(bundle, ourActions, ourArguments, ourCount,
        enemyActions, enemyArguments, enemyCount, targetDepth, nodeBudget,
        baseRisk, workUnitBudget, rootDomainRows, rootDomainCount);
    } finally {
      if (kernelOwned) kernel.applyFrame = this.diagnosticOriginalApplyFrame;
      else delete kernel.applyFrame;
      if (hardOwned) hard.classifyApplied = this.diagnosticOriginalClassifyApplied;
      else delete hard.classifyApplied;
      this.diagnosticKernel = null; this.diagnosticHard = null;
      this.diagnosticOriginalApplyFrame = null;
      this.diagnosticOriginalClassifyApplied = null;
      this.diagnosticInsideHard = 0;
    }
  }

  runScheduledIteration(bundle, depth, budget, expansionLimit, ourCount) {
    return super.runScheduledIteration(bundle, depth, budget,
      depth >= 3 ? this.diagnosticDeepExpansionLimit : expansionLimit,
      ourCount);
  }
}

class NativeAttackPosePolicySearchPoc {
  constructor(runtimeConfig, options = {}) {
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 768));
    this.pairedDepth = Number.isSafeInteger(options.pairedDepth) ?
      Math.max(0, Math.min(4, options.pairedDepth)) : 0;
    this.requireSourceSupport = options.requireSourceSupport === true;
    this.stationaryRootPolicy = options.stationaryRootPolicy === true;
    this.commonContinuation = options.commonContinuation === true;
    this.outcomeVectorEnabled = options.outcomeVector === true;
    this.eventSettlementEnabled = options.eventSettlement === true;
    this.domainRows = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.lastDomainMask = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.baselineRows = new Uint8Array(1);
    const SearchClass = options.deepExpansionLimit ?
      DiagnosticExpansionDepthSearch : ProductionDepthSearch;
    const searchOptions = {
      selectiveContinuationEnabled: false,
      windowedBoundsEnabled: false,
      crossFramePVEnabled: false,
      crossFrameRootPVEnabled: false,
      diagnosticNodeCapacity: this.nodeBudget,
      diagnosticDeepExpansionLimit: options.deepExpansionLimit || 2
    };
    this.searchEngine = options.search || new SearchClass(
      new ProductionCacheBank(), runtimeConfig, null, {
        ...searchOptions
      });
    this.leaf = null; this.representative = null; this.history = null;
    this.outcomeVector = null;
    this.eventSettlement = null;
    this.feedback = null;
    if (!options.search) {
      this.searchEngine.rootTransitions.setEnabled(false);
      this.leaf = options.leafMask === undefined ?
        new NativeTacticalLeafEvaluatorPoc().install(this.searchEngine) :
        new NativeTacticalLeafAblationPoc(options.leafMask)
          .install(this.searchEngine);
      this.representative = new NativeTacticalRepresentativePoc().install(this.searchEngine);
      if (options.historyEnabled !== false)
        this.history = new NativeTacticalHistoryPoc().install(this.searchEngine);
      if (this.outcomeVectorEnabled)
        this.outcomeVector = new NativePolicyOutcomeLexicographicPoc()
          .install(this.searchEngine);
      if (this.eventSettlementEnabled)
        this.eventSettlement = new NativeProjectileSettlementLexicographicPoc()
          .install(this.searchEngine);
      if (!this.commonContinuation)
        this.feedback = new NativeAttackPoseFeedbackSearchPoc({ forcePolicy: true,
          fixedOption: options.fixedOption === true })
          .install(this.searchEngine);
    }
    this.baselineSearch = options.baselineSearch || (this.pairedDepth ?
      new SearchClass(new ProductionCacheBank(), runtimeConfig, null,
        { ...searchOptions }) : null);
    this.baselineLeaf = null; this.baselineRepresentative = null;
    this.baselineHistory = null; this.baselineOutcomeVector = null;
    this.baselineEventSettlement = null;
    if (this.baselineSearch && !options.baselineSearch) {
      this.baselineSearch.rootTransitions.setEnabled(false);
      this.baselineLeaf = options.leafMask === undefined ?
        new NativeTacticalLeafEvaluatorPoc().install(this.baselineSearch) :
        new NativeTacticalLeafAblationPoc(options.leafMask)
          .install(this.baselineSearch);
      this.baselineRepresentative = new NativeTacticalRepresentativePoc()
        .install(this.baselineSearch);
      if (options.historyEnabled !== false)
        this.baselineHistory = new NativeTacticalHistoryPoc()
          .install(this.baselineSearch);
      if (this.outcomeVectorEnabled)
        this.baselineOutcomeVector = new NativePolicyOutcomeLexicographicPoc()
          .install(this.baselineSearch);
      if (this.eventSettlementEnabled)
        this.baselineEventSettlement = new NativeProjectileSettlementLexicographicPoc()
          .install(this.baselineSearch);
    }
    this.attemptCount = 0; this.depthOneSkipCount = 0;
    this.informationSkipCount = 0; this.noDomainCount = 0;
    this.sourceExcludedCount = 0;
    this.completeCount = 0; this.incompleteCount = 0;
    this.pairedAttemptCount = 0; this.pairedCompleteCount = 0;
    this.pairedIncompleteCount = 0; this.baselineTotalNodes = 0;
    this.baselineMaximumNodes = 0;
    this.strictDominanceCount = 0; this.nonDominanceCount = 0;
    this.rootRestoreFailureCount = 0; this.totalNodes = 0;
    this.maximumNodes = 0; this.lastBestRow = -1;
    this.lastBestValue = -2147483648; this.lastBaselineValue = -2147483648;
    this.lastBaselineNodes = 0; this.lastCandidateNodes = 0;
    this.lastRunReasonMask = 0; this.lastRunCompletedDepth = 0;
    this.lastRunAttemptedDepth = 0; this.lastRunSupportDepth = 0;
    this.lastRunTruncatedCount = 0; this.lastRunIncompleteTransitions = 0;
    this.lastRunInterrupted = 0; this.lastRunAbortReason = 0;
    this.lastBaselineReasonMask = 0;
    this.lastCandidateReasonMask = 0; this.lastBaselineCompletedDepth = 0;
    this.lastCandidateCompletedDepth = 0; this.lastBaselineSupportDepth = 0;
    this.lastCandidateSupportDepth = 0; this.lastBaselineTruncatedCount = 0;
    this.lastCandidateTruncatedCount = 0;
    this.lastBaselineIncompleteTransitions = 0;
    this.lastCandidateIncompleteTransitions = 0;
    this.lastBaselineInterrupted = 0; this.lastCandidateInterrupted = 0;
    this.lastBaselineAbortReason = 0; this.lastCandidateAbortReason = 0;
    this.lastDepth = 0; this.lastComplete = 0; this.lastRootPolicyAction = ACTION.NONE;
    this.hotAllocationCount = 0;
  }

  run(search, engine, count, depth, rows, rowCount) {
    const beforeRestore = search.rootRestoreFailures;
    const beforeIncomplete = search.incompleteTransitions;
    const beforeInterrupted = search.interruptedCount;
    const beforeNonExactAbort = search.exactOwnerEarlyAbortCount;
    search.search(engine.adapter.bundle,
      engine.ourActions, engine.ourArguments, count,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      depth, this.nodeBudget, engine.policy.baseRisk, 0,
      rowCount < count ? rows : null, rowCount);
    search.expandRootDomain();
    const restoreDelta = search.rootRestoreFailures - beforeRestore;
    if (restoreDelta > 0) this.rootRestoreFailureCount += restoreDelta;
    const incompleteDelta = search.incompleteTransitions - beforeIncomplete;
    const interruptedDelta = search.interruptedCount - beforeInterrupted;
    const nonExactAbortDelta = search.exactOwnerEarlyAbortCount -
      beforeNonExactAbort;
    const abortReason = nonExactAbortDelta > 0 ?
      search.lastNonExactAbortReason | 0 : 0;
    const complete = !restoreDelta && search.representativeSupportComplete &&
      search.representativeSupportDepth >= depth ? 1 : 0;
    this.lastRunCompletedDepth = search.completedDepth | 0;
    this.lastRunAttemptedDepth = search.attemptedDepth | 0;
    this.lastRunSupportDepth = search.representativeSupportDepth | 0;
    this.lastRunTruncatedCount = search.iterationTruncatedCount | 0;
    this.lastRunIncompleteTransitions = Math.max(0, incompleteDelta) | 0;
    this.lastRunInterrupted = interruptedDelta > 0 ? 1 : 0;
    this.lastRunAbortReason = abortReason;
    let reason = PAIR_SUPPORT_REASON.NONE;
    if (!complete) {
      if (restoreDelta > 0) reason |= PAIR_SUPPORT_REASON.ROOT_RESTORE;
      if (interruptedDelta > 0) reason |= PAIR_SUPPORT_REASON.BUDGET;
      if ((search.iterationTruncatedCount | 0) > 0 || abortReason === 1)
        reason |= PAIR_SUPPORT_REASON.WIDTH;
      if (abortReason === 2)
        reason |= PAIR_SUPPORT_REASON.TRANSITION |
          PAIR_SUPPORT_REASON.FAST_ABORT;
      if (abortReason === 3)
        reason |= PAIR_SUPPORT_REASON.TRANSITION |
          PAIR_SUPPORT_REASON.HARD_ABORT;
      if (incompleteDelta > 0)
        reason |= PAIR_SUPPORT_REASON.TRANSITION;
      if (search.attemptIntervalStatus === ROOT_INTERVAL_STATUS.INCOMPLETE &&
          !(reason & (PAIR_SUPPORT_REASON.BUDGET | PAIR_SUPPORT_REASON.WIDTH |
            PAIR_SUPPORT_REASON.TRANSITION | PAIR_SUPPORT_REASON.ROOT_RESTORE)))
        reason |= PAIR_SUPPORT_REASON.OTHER;
      if ((search.completedDepth | 0) < depth)
        reason |= PAIR_SUPPORT_REASON.TRAVERSAL;
      if ((search.representativeSupportDepth | 0) < depth)
        reason |= PAIR_SUPPORT_REASON.REPRESENTATIVE_DEPTH;
      if (!reason) reason = PAIR_SUPPORT_REASON.OTHER;
    }
    this.lastRunReasonMask = reason;
    return complete;
  }

  captureBaselineRun() {
    this.lastBaselineReasonMask = this.lastRunReasonMask;
    this.lastBaselineCompletedDepth = this.lastRunCompletedDepth;
    this.lastBaselineSupportDepth = this.lastRunSupportDepth;
    this.lastBaselineTruncatedCount = this.lastRunTruncatedCount;
    this.lastBaselineIncompleteTransitions = this.lastRunIncompleteTransitions;
    this.lastBaselineInterrupted = this.lastRunInterrupted;
    this.lastBaselineAbortReason = this.lastRunAbortReason;
  }

  captureCandidateRun() {
    this.lastCandidateReasonMask = this.lastRunReasonMask;
    this.lastCandidateCompletedDepth = this.lastRunCompletedDepth;
    this.lastCandidateSupportDepth = this.lastRunSupportDepth;
    this.lastCandidateTruncatedCount = this.lastRunTruncatedCount;
    this.lastCandidateIncompleteTransitions = this.lastRunIncompleteTransitions;
    this.lastCandidateInterrupted = this.lastRunInterrupted;
    this.lastCandidateAbortReason = this.lastRunAbortReason;
  }

  select(engine, pose, count, source, baselineRow, baselineValue, allowedRows) {
    this.attemptCount += 1; this.lastBestRow = -1;
    this.lastBestValue = -2147483648; this.lastBaselineValue = baselineValue;
    this.lastDepth = 0; this.lastComplete = 0;
    this.lastRootPolicyAction = ACTION.NONE;
    this.lastDomainMask.fill(0, 0, count);
    if (source !== engine.depthSearch) {
      this.informationSkipCount += 1; return -1;
    }
    let depth = source.representativeSupportDepth | 0;
    if (this.pairedDepth) depth = this.pairedDepth;
    else if (depth < 2) { this.depthOneSkipCount += 1; return -1; }
    this.lastDepth = depth;
    if (this.stationaryRootPolicy) {
      if (!this.feedback) { this.noDomainCount += 1; return -1; }
      this.lastRootPolicyAction = this.feedback.routeAction(engine.adapter.state);
      if (this.lastRootPolicyAction === ACTION.NONE) {
        this.noDomainCount += 1; return -1;
      }
    }
    let domainCount = 0;
    for (let row = 0; row < count; row += 1) {
      if (this.requireSourceSupport && source.rootDomainRestricted &&
          !source.rootDomainMask[row]) {
        if (allowedRows[row] && pose.supports(row)) this.sourceExcludedCount += 1;
        continue;
      }
      const policySupports = this.stationaryRootPolicy ?
        engine.ourActions[row] === this.lastRootPolicyAction : pose.supports(row);
      if (allowedRows[row] && engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          policySupports) {
        this.domainRows[domainCount++] = row; this.lastDomainMask[row] = 1;
      }
    }
    if (!domainCount) { this.noDomainCount += 1; return -1; }
    if (typeof this.feedback?.bind === "function") this.feedback.bind(pose);
    if (this.pairedDepth) {
      this.pairedAttemptCount += 1; this.baselineRows[0] = baselineRow;
      if (!this.run(this.baselineSearch, engine, count, depth, this.baselineRows, 1)) {
        this.pairedIncompleteCount += 1; this.incompleteCount += 1; return -1;
      }
      this.baselineTotalNodes += this.baselineSearch.nodes;
      if (this.baselineSearch.nodes > this.baselineMaximumNodes)
        this.baselineMaximumNodes = this.baselineSearch.nodes;
      baselineValue = this.baselineSearch.rootScore[baselineRow];
      this.lastBaselineValue = baselineValue;
    }
    const attackComplete = this.run(this.searchEngine, engine, count, depth,
      this.domainRows, domainCount);
    this.totalNodes += this.searchEngine.nodes;
    if (this.searchEngine.nodes > this.maximumNodes)
      this.maximumNodes = this.searchEngine.nodes;
    if (!attackComplete) {
      if (this.pairedDepth) this.pairedIncompleteCount += 1;
      this.incompleteCount += 1; return -1;
    }
    if (this.pairedDepth) this.pairedCompleteCount += 1;
    this.completeCount += 1;
    this.lastComplete = 1;
    for (let at = 0; at < domainCount; at += 1) {
      const row = this.domainRows[at]; const value = this.searchEngine.rootScore[row];
      if (this.lastBestRow < 0 || value > this.lastBestValue ||
          value === this.lastBestValue && pose.betterRow(engine, row, this.lastBestRow)) {
        this.lastBestRow = row; this.lastBestValue = value;
      }
    }
    if (this.lastBestRow >= 0 && this.lastBestValue > baselineValue) {
      this.strictDominanceCount += 1; return this.lastBestRow;
    }
    this.nonDominanceCount += 1; return -1;
  }

  comparePair(engine, pose, count, source, baselineRow, candidateRow,
      allowedRows) {
    this.attemptCount += 1; this.lastBestRow = -1;
    this.lastBestValue = -2147483648;
    this.lastBaselineValue = -2147483648;
    this.lastBaselineNodes = 0; this.lastCandidateNodes = 0;
    this.lastBaselineReasonMask = 0; this.lastCandidateReasonMask = 0;
    this.lastBaselineCompletedDepth = 0; this.lastCandidateCompletedDepth = 0;
    this.lastBaselineSupportDepth = 0; this.lastCandidateSupportDepth = 0;
    this.lastBaselineTruncatedCount = 0; this.lastCandidateTruncatedCount = 0;
    this.lastBaselineIncompleteTransitions = 0;
    this.lastCandidateIncompleteTransitions = 0;
    this.lastBaselineInterrupted = 0; this.lastCandidateInterrupted = 0;
    this.lastBaselineAbortReason = 0; this.lastCandidateAbortReason = 0;
    this.lastDepth = this.pairedDepth | 0; this.lastComplete = 0;
    this.lastRootPolicyAction = ACTION.NONE;
    this.lastDomainMask.fill(0, 0, count);
    if (source !== engine.depthSearch) {
      this.informationSkipCount += 1;
      this.lastBaselineReasonMask = PAIR_SUPPORT_REASON.SOURCE;
      return PAIR_RELATION.INCOMPLETE;
    }
    if (this.lastDepth < 1 || baselineRow < 0 || baselineRow >= count ||
        candidateRow < 0 || candidateRow >= count ||
        !allowedRows[baselineRow] || !allowedRows[candidateRow] ||
        engine.hardStatus[baselineRow] !== HARD_STATUS.ALLOW ||
        engine.hardStatus[candidateRow] !== HARD_STATUS.ALLOW ||
        !pose.supports(candidateRow)) {
      this.noDomainCount += 1;
      this.lastBaselineReasonMask = PAIR_SUPPORT_REASON.DOMAIN;
      return PAIR_RELATION.INCOMPLETE;
    }
    this.pairedAttemptCount += 1;
    this.baselineRows[0] = baselineRow;
    this.domainRows[0] = candidateRow;
    this.lastDomainMask[candidateRow] = 1;
    if (typeof this.feedback?.bind === "function") this.feedback.bind(pose);
    const baselineComplete = this.run(this.baselineSearch, engine, count,
      this.lastDepth, this.baselineRows, 1);
    this.captureBaselineRun();
    this.lastBaselineNodes = this.baselineSearch.nodes;
    if (!baselineComplete) {
      this.pairedIncompleteCount += 1; this.incompleteCount += 1;
      return PAIR_RELATION.INCOMPLETE;
    }
    this.baselineTotalNodes += this.lastBaselineNodes;
    if (this.lastBaselineNodes > this.baselineMaximumNodes)
      this.baselineMaximumNodes = this.lastBaselineNodes;
    this.lastBaselineValue = this.baselineSearch.rootScore[baselineRow];
    const candidateComplete = this.run(this.searchEngine, engine, count,
      this.lastDepth, this.domainRows, 1);
    this.captureCandidateRun();
    this.lastCandidateNodes = this.searchEngine.nodes;
    if (!candidateComplete) {
      this.pairedIncompleteCount += 1; this.incompleteCount += 1;
      return PAIR_RELATION.INCOMPLETE;
    }
    this.totalNodes += this.lastCandidateNodes;
    if (this.lastCandidateNodes > this.maximumNodes)
      this.maximumNodes = this.lastCandidateNodes;
    this.lastBestRow = candidateRow;
    this.lastBestValue = this.searchEngine.rootScore[candidateRow];
    this.lastComplete = 1; this.completeCount += 1;
    this.pairedCompleteCount += 1;
    if (this.lastBestValue > this.lastBaselineValue) {
      this.strictDominanceCount += 1; return PAIR_RELATION.CANDIDATE_HIGHER;
    }
    this.nonDominanceCount += 1;
    return this.lastBestValue === this.lastBaselineValue ?
      PAIR_RELATION.EQUAL : PAIR_RELATION.CANDIDATE_LOWER;
  }

  rowValue(row) {
    return this.lastComplete && row >= 0 && row < this.lastDomainMask.length &&
      this.lastDomainMask[row] ? this.searchEngine.rootScore[row] : null;
  }

  summary() {
    return { nodeBudget: this.nodeBudget, pairedDepth: this.pairedDepth,
      requireSourceSupport: this.requireSourceSupport,
      stationaryRootPolicy: this.stationaryRootPolicy,
      commonContinuation: this.commonContinuation,
      outcomeVectorEnabled: this.outcomeVectorEnabled,
      eventSettlementEnabled: this.eventSettlementEnabled,
      attemptCount: this.attemptCount,
      depthOneSkipCount: this.depthOneSkipCount,
      informationSkipCount: this.informationSkipCount,
      noDomainCount: this.noDomainCount, sourceExcludedCount: this.sourceExcludedCount,
      completeCount: this.completeCount,
      incompleteCount: this.incompleteCount,
      pairedAttemptCount: this.pairedAttemptCount,
      pairedCompleteCount: this.pairedCompleteCount,
      pairedIncompleteCount: this.pairedIncompleteCount,
      baselineTotalNodes: this.baselineTotalNodes,
      baselineMaximumNodes: this.baselineMaximumNodes,
      strictDominanceCount: this.strictDominanceCount,
      nonDominanceCount: this.nonDominanceCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      totalNodes: this.totalNodes, maximumNodes: this.maximumNodes,
      lastBestRow: this.lastBestRow, lastBestValue: this.lastBestValue,
      lastBaselineValue: this.lastBaselineValue,
      lastBaselineNodes: this.lastBaselineNodes,
      lastCandidateNodes: this.lastCandidateNodes,
      lastBaselineReasonMask: this.lastBaselineReasonMask,
      lastCandidateReasonMask: this.lastCandidateReasonMask,
      lastBaselineCompletedDepth: this.lastBaselineCompletedDepth,
      lastCandidateCompletedDepth: this.lastCandidateCompletedDepth,
      lastBaselineSupportDepth: this.lastBaselineSupportDepth,
      lastCandidateSupportDepth: this.lastCandidateSupportDepth,
      lastBaselineTruncatedCount: this.lastBaselineTruncatedCount,
      lastCandidateTruncatedCount: this.lastCandidateTruncatedCount,
      lastBaselineIncompleteTransitions:
        this.lastBaselineIncompleteTransitions,
      lastCandidateIncompleteTransitions:
        this.lastCandidateIncompleteTransitions,
      lastBaselineInterrupted: this.lastBaselineInterrupted,
      lastCandidateInterrupted: this.lastCandidateInterrupted,
      lastBaselineAbortReason: this.lastBaselineAbortReason,
      lastCandidateAbortReason: this.lastCandidateAbortReason,
      lastDepth: this.lastDepth, lastComplete: this.lastComplete,
      lastRootPolicyAction: this.lastRootPolicyAction,
      feedback: this.feedback ? this.feedback.summary() : null,
      leaf: this.leaf ? this.leaf.summary() : null,
      representative: this.representative ? this.representative.summary() : null,
      history: this.history ? this.history.summary() : null,
      outcomeVector: this.outcomeVector ? this.outcomeVector.summary() : null,
      eventSettlement: this.eventSettlement ? this.eventSettlement.summary() : null,
      baselineLeaf: this.baselineLeaf ? this.baselineLeaf.summary() : null,
      baselineRepresentative: this.baselineRepresentative ?
        this.baselineRepresentative.summary() : null,
      baselineHistory: this.baselineHistory ? this.baselineHistory.summary() : null,
      baselineOutcomeVector: this.baselineOutcomeVector ?
        this.baselineOutcomeVector.summary() : null,
      baselineEventSettlement: this.baselineEventSettlement ?
        this.baselineEventSettlement.summary() : null,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativeAttackPosePolicySearchPoc, PAIR_RELATION,
  PAIR_SUPPORT_REASON, PAIR_REASON_CAPACITY,
  DIAGNOSTIC_ACTION_CAPACITY, DIAGNOSTIC_FAST_STATUS_CAPACITY,
  DIAGNOSTIC_HARD_STATUS_CAPACITY, DIAGNOSTIC_FAST_REASON_CAPACITY,
  DIAGNOSTIC_RELOCATION_DETAIL_CAPACITY, DIAGNOSTIC_DEPTH_CAPACITY,
  DiagnosticExpansionDepthSearch };
