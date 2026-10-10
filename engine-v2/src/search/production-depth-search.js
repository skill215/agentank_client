"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { RUNTIME_CONFIG } = require("../generated/runtime-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, TERRAIN, TERMINAL, FAST_STATUS, HARD_STATUS, CHANCE,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, BOOST_COMPOUND_END,
  NONE_FRAME, NONE_CELL, DX, DY } = require("../abi/fast-codes");
const { CACHE_ID, CACHE_FLAG, CACHE_MISS, CACHE_DEPENDENCY, WORK_KIND } =
  require("../abi/cache-runtime-codes");
const { RootTransitionSlab } = require("./root-transition-slab");
const { FRONTIER_STATUS, ContenderFrontier } = require("./contender-frontier");

const DEPTH_VALUE_MIN = -32000;
const DEPTH_VALUE_MAX = 32000;
const DEPTH_CACHE_VERSION = 3;
const DEEP_WIDTH = 4;
const DIRECT_FIRE_TRAP_NODE_CAP = SEARCH_CAPACITY.MAX_OUR_ACTIONS * 2;
const DIRECT_DEPTH_TWO_MIN_BUDGET = 250;
const DIRECT_STUN_ROOT_NODE_LIMIT = 48;
const SEARCH_SCHEDULE = Object.freeze({ LEGACY_ITERATIVE: 0, DIRECT_DEPTH_TWO: 1 });
const ROOT_INTERVAL_STATUS = Object.freeze({ NONE: 0, COMPLETE: 1, INCOMPLETE: 2 });
const NONEXACT_ABORT_REASON = Object.freeze({ NONE: 0, WIDTH: 1, FAST: 2, HARD: 3 });
const VALUE_BOUND = Object.freeze({ EXACT: 0, LOWER: 1, UPPER: 2 });

function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

function packProgram(action, argument) {
  return ((action & 0xff) | ((argument & 0xffff) << 8)) >>> 0;
}
function programAction(packed) { return packed & 0xff; }
function programArgument(packed) { return (packed >>> 8) & 0xffff; }

class ProductionDepthSearch {
  constructor(cacheBank, runtimeConfig = RUNTIME_CONFIG, rootTransitions = null, options = null) {
    const frames = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 1;
    this.windowedBoundsEnabled = options && options.windowedBoundsEnabled ? 1 : 0;
    this.windowedBoundsActive = 0;
    this.cacheBank = cacheBank; this.cache = cacheBank.get(CACHE_ID.PHYSICAL_VALUE_TT);
    this.runtimeConfig = runtimeConfig;
    this.rootTransitions = rootTransitions || new RootTransitionSlab();
    this.activeRootTransitions = null;
    this.directDepthTwoMinBudget = Number.isInteger(runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET) ?
      runtimeConfig.DIRECT_DEPTH_TWO_MIN_NODE_BUDGET : DIRECT_DEPTH_TWO_MIN_BUDGET;
    // Calibration-only capacity override. Production remains bounded by the
    // generated MAX_NODES contract; this exposes the untruncated depth curve
    // without changing any runtime profile or allocating per-node storage.
    this.diagnosticNodeCapacity = options &&
      Number.isSafeInteger(options.diagnosticNodeCapacity) &&
      options.diagnosticNodeCapacity > SEARCH_CAPACITY.MAX_NODES ?
      options.diagnosticNodeCapacity : SEARCH_CAPACITY.MAX_NODES;
    this.frameInitialized = new Uint8Array(frames); this.frameRoot = new Uint8Array(frames);
    this.frameAwaiting = new Uint8Array(frames); this.frameDepth = new Uint8Array(frames);
    this.frameRow = new Uint8Array(frames); this.frameColumn = new Uint8Array(frames);
    this.frameOurCount = new Uint8Array(frames); this.frameEnemyCount = new Uint8Array(frames);
    this.frameOurGeneratedCount = new Uint8Array(frames);
    this.frameEnemyGeneratedCount = new Uint8Array(frames);
    this.frameBestRow = new Uint8Array(frames); this.frameCacheable = new Uint8Array(frames);
    this.frameWorstColumn = new Uint8Array(frames);
    this.frameBestEnemyColumn = new Uint8Array(frames);
    this.framePrincipalEntry = new Uint16Array(frames);
    this.frameChanceIndex = new Uint8Array(frames); this.frameChanceCount = new Uint8Array(frames);
    this.frameOwnChanceCount = new Uint8Array(frames);
    this.frameEnemyChanceCount = new Uint8Array(frames);
    this.frameBest = new Int32Array(frames); this.frameWorst = new Int32Array(frames);
    this.frameChanceSum = new Int32Array(frames); this.frameChanceWorst = new Int32Array(frames);
    this.frameAlpha = this.windowedBoundsEnabled ? new Int32Array(frames) : null;
    this.frameBeta = this.windowedBoundsEnabled ? new Int32Array(frames) : null;
    this.frameMark = new Uint32Array(frames); this.deepOurActions = new Uint8Array(frames * DEEP_WIDTH);
    this.deepOurArguments = new Uint16Array(frames * DEEP_WIDTH);
    this.deepEnemyActions = new Uint8Array(frames * DEEP_WIDTH);
    this.deepEnemyArguments = new Uint16Array(frames * DEEP_WIDTH);
    this.iterationScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootRowOrder = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootEnemyOrder = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.iterationCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.iterationCellComplete = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.iterationCellBound = this.windowedBoundsEnabled ?
      new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
        SEARCH_CAPACITY.MAX_ENEMY_POLICIES) : null;
    this.attemptCellLower = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attemptCellUpper = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attemptRowLower = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.attemptRowUpper = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.contender = new ContenderFrontier(); this.selectiveRootActive = 0;
    this.selectiveContinuationEnabled = options && options.selectiveContinuationEnabled ? 1 : 0;
    this.exactOwnerEarlyAbort = !options || options.exactOwnerEarlyAbort !== false ? 1 : 0;
    this.selectiveCompletedDepth = 0; this.selectiveAttemptedDepth = 0;
    this.selectiveBestRow = 255; this.selectiveBestValue = DEPTH_VALUE_MIN;
    this.selectivePrunedCells = 0; this.lastSelectiveNodes = 0;
    this.selectiveNodeCount = 0; this.selectiveResolvedCount = 0;
    this.windowBoundCutoffCount = 0; this.windowBoundReturnCount = 0;
    this.depthTwoPreflightEnabled = options && options.depthTwoPreflightEnabled ? 1 : 0;
    // Diagnostic schedule used to measure whether the exact P2 matrix is the
    // limiting cost for deeper selective proofs. P1 remains the exact fallback;
    // this flag never publishes a partial/deeper matrix as an exact owner.
    this.diagnosticDirectSelectiveDepth = options &&
      options.diagnosticDirectSelectiveDepth ? 1 : 0;
    this.depthTwoPreflightActive = 0;
    this.depthTwoPreflightProjectedNodes = 0;
    this.depthTwoPreflightStateCount = 0;
    this.depthTwoPreflightAvailableNodes = 0;
    this.depthTwoPreflightImpossible = 0;
    this.depthTwoPreflightRootCount = 0;
    this.depthTwoPreflightImpossibleCount = 0;
    this.depthTwoPreflightStateCountTotal = 0;
    this.depthTwoPreflightProjectedNodesTotal = 0;
    this.depthTwoPreflightAvailableNodesTotal = 0;
    this.depthTwoPreflightP2Attempts = 0;
    this.depthTwoPreflightP2Completed = 0;
    this.depthTwoPreflightP2ExactCompleted = 0;
    this.depthTwoPreflightP2CompletedNonExact = 0;
    this.depthTwoPreflightP2WithExactP1 = 0;
    this.depthTwoPreflightP2WithoutExactP1 = 0;
    this.depthTwoPreflightP2NonExactWithoutExactP1 = 0;
    this.depthTwoPreflightP2BudgetInterrupted = 0;
    this.depthTwoPreflightP2SupportAborted = 0;
    this.depthTwoPreflightP2WidthAborted = 0;
    this.depthTwoPreflightP2FastAborted = 0;
    this.depthTwoPreflightP2HardAborted = 0;
    this.depthTwoPreflightP2UnclassifiedAborted = 0;
    this.depthTwoPreflightP2PrincipalBlockedWidth = 0;
    this.depthTwoPreflightP2PrincipalBlockedFast = 0;
    this.depthTwoPreflightP2PrincipalBlockedHard = 0;
    this.depthTwoPreflightP2TransitionIncomplete = 0;
    this.depthTwoPreflightP2OtherFailure = 0;
    this.depthTwoPreflightScheduleEligible = 0;
    this.depthTwoPreflightScheduleBudgetBlocked = 0;
    this.depthTwoPreflightScheduleStunBlocked = 0;
    this.depthTwoPreflightScheduleFireContactBlocked = 0;
    this.depthTwoPreflightP2FastActive = 0;
    this.depthTwoPreflightP2FastStatusCounts = this.depthTwoPreflightEnabled ?
      new Uint32Array(FAST_STATUS.EXECUTION_ERROR + 1) : null;
    this.depthTwoPreflightP2FastActionPairCounts = this.depthTwoPreflightEnabled ?
      new Uint32Array((ACTION.BOOST_RIGHT_BOMB + 1) * (ACTION.BOOST_RIGHT_BOMB + 1)) : null;
    this.directDepthTwoDuringStunEnabled = options &&
      options.directDepthTwoDuringStunEnabled ? 1 : 0;
    this.directDepthTwoStunMaxRootNodes = options &&
      Number.isSafeInteger(options.directDepthTwoStunMaxRootNodes) &&
      options.directDepthTwoStunMaxRootNodes > 0 ?
      options.directDepthTwoStunMaxRootNodes : DIRECT_STUN_ROOT_NODE_LIMIT;
    this.directStunRootCount = 0;
    this.directStunSizeBlockedCount = 0;
    this.directStunP1Completed = 0;
    this.directStunP2Completed = 0;
    this.directStunP2Failed = 0;
    this.trapActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.trapArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.continuationOurActions = new Uint8Array(DEEP_WIDTH);
    this.continuationOurArguments = new Uint16Array(DEEP_WIDTH);
    this.continuationEnemyActions = new Uint8Array(DEEP_WIDTH);
    this.continuationEnemyArguments = new Uint16Array(DEEP_WIDTH);
    this.lastContinuationNodes = 0;
    this.lastContinuationUsable = 0;
    this.lastContinuationComplete = 0;
    this.lastContinuationCompletedDepth = 0;
    this.lastContinuationAttemptedDepth = 0;
    this.lastContinuationIncompleteTransitions = 0;
    this.lastContinuationGeneratedMax = 0;
    this.lastContinuationTruncatedCount = 0;
    this.continuationCallCount = 0; this.continuationSearchCount = 0;
    this.continuationTrapCount = 0;
    this.completedDepth = 0; this.attemptedDepth = 0; this.bestRow = 0;
    this.bestValue = DEPTH_VALUE_MIN; this.nodes = 0; this.cacheProbes = 0; this.baseRisk = 0;
    this.cacheHits = 0; this.cacheWrites = 0; this.interruptedCount = 0;
    this.rootRestoreFailures = 0; this.incompleteTransitions = 0; this.hotAllocationCount = 0;
    this.rootActions = null; this.rootArguments = null; this.rootOurCount = 0;
    this.rootActionCount = 0; this.rootDomainRows = null; this.rootDomainActive = 0;
    this.rootDomainRestricted = 0; this.rootDomainOriginalCount = 0;
    this.rootDomainEvaluatedCount = 0;
    this.rootDomainMask = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootEnemyActions = null; this.rootEnemyArguments = null; this.rootEnemyCount = 0;
    this.lastTrapProbeNodes = 0; this.directFireTrapProbeCount = 0;
    this.directFireTrapProofCount = 0; this.directFireTrapBudgetSkipCount = 0;
    this.trapProbeBudget = 0;
    this.iterationExpansionLimit = 2; this.attemptedExpansionLimit = 0;
    this.completedExpansionLimit = 0; this.iterationGeneratedMax = 0;
    this.iterationTruncatedCount = 0; this.completedGeneratedMax = 0;
    this.completedTruncatedCount = 0; this.representativeSupportComplete = 0;
    this.representativeSupportDepth = 0; this.representativeSupportExpansionLimit = 0;
    this.representativeBestRow = 255; this.representativeBestValue = DEPTH_VALUE_MIN;
    this.rootDomainRestricted = 0; this.rootDomainOriginalCount = 0;
    this.rootDomainEvaluatedCount = 0; this.rootDomainActive = 0; this.rootDomainRows = null;
    this.lastSchedule = SEARCH_SCHEDULE.LEGACY_ITERATIVE;
    this.workUnitLimit = 0; this.workUnits = 0; this.classifiedNodes = 0;
    this.reverseBuilds = 0; this.workClassifyStart = 0; this.workBuildStart = 0;
    this.workInterruptedCount = 0;
    this.exactOwnerEarlyAbortCount = 0;
    this.lastNonExactAbortReason = NONEXACT_ABORT_REASON.NONE;
    this.nonExactPrincipalBlockedMask = 0;
    this.workRootHitStart = 0; this.rootTransitionHits = 0;
    this.attemptIntervalStatus = ROOT_INTERVAL_STATUS.NONE;
    this.attemptIntervalDepth = 0; this.attemptIntervalExpansionLimit = 0;
    this.attemptRootLower = DEPTH_VALUE_MIN; this.attemptRootUpper = DEPTH_VALUE_MAX;
    this.crossFramePVEnabled = !options || options.crossFramePVEnabled !== false ? 1 : 0;
    // A previous-frame root action can be stale after the horizon shifts.  It
    // remains observable, but only an explicit diagnostic enables root
    // ownership.  Exact lower-depth Successor-TT programs remain enabled.
    this.crossFrameRootPVEnabled = options && options.crossFrameRootPVEnabled ? 1 : 0;
    this.crossFramePVPrepared = 0; this.crossFramePVActive = 0;
    this.publishedRootOrderActive = 0;
    this.crossFramePVHashLo = 0; this.crossFramePVHashHi = 0;
    this.crossFramePVAction = ACTION.NONE; this.crossFramePVArgument = NONE_CELL;
    this.crossFramePVEnemyAction = ACTION.NONE;
    this.crossFramePVEnemyArgument = NONE_CELL; this.crossFramePVDepth = 0;
    this.crossFramePVRow = 255; this.crossFramePVEnemyColumn = 255;
    this.crossFramePVLookupCount = 0; this.crossFramePVHitCount = 0;
    this.crossFramePVRootPromoteCount = 0; this.crossFramePVDeepPromoteCount = 0;
    // Optional one-root ordering hint. It changes traversal order only and is
    // never published as a value, interval, Hard result, or selected row.
    this.diagnosticRootPriorPrepared = 0; this.diagnosticRootPriorActive = 0;
    this.diagnosticRootPriorAction = ACTION.NONE;
    this.diagnosticRootPriorArgument = NONE_CELL;
    this.diagnosticRootPriorArgumentExact = 0;
    this.diagnosticRootPriorSeedOnly = 0;
    this.diagnosticRootPriorRow = 255;
    this.diagnosticRootPriorPrepareCount = 0;
    this.diagnosticRootPriorPromoteCount = 0;
    this.diagnosticRootPriorMissingCount = 0;
    this.diagnosticRootPriorAmbiguousCount = 0;
  }

  resetRoot() {
    this.completedDepth = 0; this.attemptedDepth = 0; this.nodes = 0;
    // Root-domain metadata is evidence for exactly one decision root.  Leaving
    // it live after a no-search frame makes the next root look as though it was
    // evaluated against the previous root's sparse mask.
    this.rootDomainActive = 0; this.rootDomainRows = null;
    this.rootDomainRestricted = 0; this.rootDomainOriginalCount = 0;
    this.rootDomainEvaluatedCount = 0;
    this.bestValue = DEPTH_VALUE_MIN; this.rootScore.fill(0);
    this.rootCellScore.fill(DEPTH_VALUE_MIN);
    this.iterationExpansionLimit = 2; this.attemptedExpansionLimit = 0;
    this.completedExpansionLimit = 0; this.iterationGeneratedMax = 0;
    this.iterationTruncatedCount = 0; this.completedGeneratedMax = 0;
    this.completedTruncatedCount = 0; this.representativeSupportComplete = 0;
    this.representativeSupportDepth = 0; this.representativeSupportExpansionLimit = 0;
    this.representativeBestRow = 255; this.representativeBestValue = DEPTH_VALUE_MIN;
    this.lastSchedule = SEARCH_SCHEDULE.LEGACY_ITERATIVE;
    this.workUnitLimit = 0; this.workUnits = 0; this.classifiedNodes = 0;
    this.reverseBuilds = 0; this.workClassifyStart = 0; this.workBuildStart = 0;
    this.workInterruptedCount = 0;
    this.exactOwnerEarlyAbortCount = 0;
    this.lastNonExactAbortReason = NONEXACT_ABORT_REASON.NONE;
    this.nonExactPrincipalBlockedMask = 0;
    this.workRootHitStart = 0; this.rootTransitionHits = 0;
    this.attemptIntervalStatus = ROOT_INTERVAL_STATUS.NONE;
    this.attemptIntervalDepth = 0; this.attemptIntervalExpansionLimit = 0;
    this.attemptRootLower = DEPTH_VALUE_MIN; this.attemptRootUpper = DEPTH_VALUE_MAX;
    this.selectiveRootActive = 0; this.selectiveCompletedDepth = 0;
    this.selectiveAttemptedDepth = 0; this.selectiveBestRow = 255;
    this.selectiveBestValue = DEPTH_VALUE_MIN; this.selectivePrunedCells = 0;
    this.lastSelectiveNodes = 0; this.selectiveNodeCount = 0; this.selectiveResolvedCount = 0;
    this.depthTwoPreflightActive = 0;
    this.depthTwoPreflightProjectedNodes = 0;
    this.depthTwoPreflightStateCount = 0;
    this.depthTwoPreflightAvailableNodes = 0;
    this.depthTwoPreflightImpossible = 0;
    this.depthTwoPreflightP2FastActive = 0;
    this.crossFramePVActive = 0; this.crossFramePVRow = 255;
    this.crossFramePVEnemyColumn = 255;
    this.publishedRootOrderActive = 0;
    this.diagnosticRootPriorActive = 0; this.diagnosticRootPriorRow = 255;
  }

  setDiagnosticRootPrior(action, argument = NONE_CELL, argumentExact = 0,
      seedOnly = 0) {
    this.diagnosticRootPriorPrepared = 1;
    this.diagnosticRootPriorAction = action;
    this.diagnosticRootPriorArgument = argument;
    this.diagnosticRootPriorArgumentExact = argumentExact ? 1 : 0;
    this.diagnosticRootPriorSeedOnly = seedOnly ? 1 : 0;
    this.diagnosticRootPriorPrepareCount += 1;
  }

  clearDiagnosticRootPrior() {
    this.diagnosticRootPriorPrepared = 0; this.diagnosticRootPriorActive = 0;
    this.diagnosticRootPriorAction = ACTION.NONE;
    this.diagnosticRootPriorArgument = NONE_CELL;
    this.diagnosticRootPriorArgumentExact = 0;
    this.diagnosticRootPriorSeedOnly = 0;
    this.diagnosticRootPriorRow = 255;
  }

  clearCrossFramePV() {
    this.crossFramePVPrepared = 0; this.crossFramePVActive = 0;
    this.crossFramePVHashLo = 0; this.crossFramePVHashHi = 0;
    this.crossFramePVAction = ACTION.NONE; this.crossFramePVArgument = NONE_CELL;
    this.crossFramePVEnemyAction = ACTION.NONE;
    this.crossFramePVEnemyArgument = NONE_CELL; this.crossFramePVDepth = 0;
    this.crossFramePVRow = 255; this.crossFramePVEnemyColumn = 255;
  }
  prepareCrossFramePV(state, baseRisk, width = DEEP_WIDTH) {
    this.clearCrossFramePV(); this.crossFramePVLookupCount += 1;
    if (!this.crossFramePVEnabled || !state || !this.rootTransitions ||
        !this.rootTransitions.lookupPrincipal(state, baseRisk, width)) return 0;
    this.crossFramePVPrepared = 1; this.crossFramePVHashLo = state.hashLo;
    this.crossFramePVHashHi = state.hashHi;
    this.crossFramePVAction = this.rootTransitions.lastPVAction;
    this.crossFramePVArgument = this.rootTransitions.lastPVArgument;
    this.crossFramePVEnemyAction = this.rootTransitions.lastPVEnemyAction;
    this.crossFramePVEnemyArgument = this.rootTransitions.lastPVEnemyArgument;
    this.crossFramePVDepth = this.rootTransitions.lastPVDepth;
    this.crossFramePVHitCount += 1; return 1;
  }
  commitActualAction(action, argument = NONE_CELL) {
    if (!this.rootTransitions) return 0;
    return this.rootTransitions.commitPrincipalAction(action, argument);
  }
  resetPrincipalMatch() {
    this.clearCrossFramePV();
    if (this.rootTransitions) this.rootTransitions.resetPrincipal();
  }

  beginWorkMeter(bundle, workUnitBudget) {
    this.workUnitLimit = Number.isSafeInteger(workUnitBudget) && workUnitBudget > 0 ?
      workUnitBudget : 0;
    this.workClassifyStart = bundle && bundle.hard ? bundle.hard.classifyCount : 0;
    this.workBuildStart = bundle && bundle.hard ? bundle.hard.reverseBuildCount : 0;
    this.workRootHitStart = this.activeRootTransitions ?
      this.activeRootTransitions.replayHitCount : 0;
    this.workUnits = 0; this.classifiedNodes = 0; this.reverseBuilds = 0;
  }
  updateWorkMeter(bundle) {
    const hard = bundle && bundle.hard; const charges = this.runtimeConfig.WORK_CHARGES;
    this.classifiedNodes = hard ? Math.max(0, hard.classifyCount - this.workClassifyStart) : 0;
    this.reverseBuilds = hard ? Math.max(0, hard.reverseBuildCount - this.workBuildStart) : 0;
    this.rootTransitionHits = this.activeRootTransitions ? Math.max(0,
      this.activeRootTransitions.replayHitCount - this.workRootHitStart) : 0;
    const hardPremium = Math.max(0, charges[WORK_KIND.HARD] - charges[WORK_KIND.CACHE]);
    const replayed = Math.min(this.nodes, this.rootTransitionHits);
    this.workUnits = this.nodes * charges[WORK_KIND.VALUE_NODE] +
      (this.nodes - replayed) * charges[WORK_KIND.FAST_TRANSITION] +
      replayed * charges[WORK_KIND.CACHE] +
      this.classifiedNodes * charges[WORK_KIND.CACHE] + this.reverseBuilds * hardPremium;
    return this.workUnits;
  }
  canConsumeWork(bundle) {
    if (!this.workUnitLimit) return 1;
    const charges = this.runtimeConfig.WORK_CHARGES;
    const nextWorstCase = charges[WORK_KIND.VALUE_NODE] +
      charges[WORK_KIND.FAST_TRANSITION] + charges[WORK_KIND.HARD];
    return this.updateWorkMeter(bundle) + nextWorstCase <= this.workUnitLimit ? 1 : 0;
  }

  configureIteration(depth, expansionLimit = 2) {
    const boundedWidth = Number.isInteger(expansionLimit) ? expansionLimit : 2;
    this.iterationExpansionLimit = Math.max(2, Math.min(DEEP_WIDTH, boundedWidth));
    this.attemptedExpansionLimit = this.iterationExpansionLimit;
    this.iterationGeneratedMax = 0; this.iterationTruncatedCount = 0;
    return this.iterationExpansionLimit;
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  walkable(state, cell) {
    return cell !== NONE_CELL && state.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.WALL &&
      state.arrays[ARRAY.TERRAIN][cell] !== TERRAIN.DIRT;
  }
  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) + Math.abs(state.y(left) - state.y(right));
  }
  desiredDirection(state, from, to) {
    const dx = state.x(to) - state.x(from); const dy = state.y(to) - state.y(from);
    if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 1 : 3;
    if (dy) return dy > 0 ? 2 : 0; return -1;
  }
  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }
  pushTrap(count, action, argument = NONE_CELL) {
    for (let index = 0; index < count; index += 1)
      if (this.trapActions[index] === action && this.trapArguments[index] === argument) return count;
    if (count >= this.trapActions.length) return count;
    this.trapActions[count] = action; this.trapArguments[count] = argument; return count + 1;
  }
  directFireThreat(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1] || this.activeProjectile(state, 1) ||
        (a[ARRAY.TANK_FIRE_LOCK][1] !== NONE_FRAME && a[ARRAY.TANK_FIRE_LOCK][1] > frame)) return 0;
    const enemy = a[ARRAY.TANK_CELL][1]; const own = a[ARRAY.TANK_CELL][0];
    return this.desiredDirection(state, enemy, own) === a[ARRAY.TANK_DIR][1] &&
      this.clearLine(state, enemy, own) ? 1 : 0;
  }
  prepareTrapActions(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; let count = 0;
    count = this.pushTrap(count, ACTION.NONE); count = this.pushTrap(count, ACTION.GO);
    count = this.pushTrap(count, ACTION.TURN_LEFT); count = this.pushTrap(count, ACTION.TURN_RIGHT);
    if (!this.activeProjectile(state, 0) &&
        (a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][0] <= frame))
      count = this.pushTrap(count, ACTION.FIRE);
    const skill = a[ARRAY.TANK_SKILL][0];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][0] <= frame) {
      const argument = skill === SKILL.TELEPORT ? this.teleportArgument(state, 0) : NONE_CELL;
      if (skill !== SKILL.TELEPORT || argument !== NONE_CELL)
        count = this.pushTrap(count, ACTION.CAST_SHIELD + skill - SKILL.SHIELD, argument);
    }
    return count;
  }
  probeDirectFireTrap(bundle, nodeBudget) {
    this.lastTrapProbeNodes = 0;
    const state = bundle && bundle.state;
    if (!state || nodeBudget < 1 || !this.directFireThreat(state)) return 0;
    this.directFireTrapProbeCount += 1;
    const count = this.prepareTrapActions(state);
    for (let index = 0; index < count; index += 1) {
      const action = this.trapActions[index];
      const cost = bundle.hard.chanceAlternativeCount(0, action);
      if (this.lastTrapProbeNodes + cost > nodeBudget) {
        this.directFireTrapBudgetSkipCount += 1; return -1;
      }
      const hard = bundle.hard.evaluateAllOwnChance(action, this.trapArguments[index], ACTION.FIRE);
      this.lastTrapProbeNodes += cost;
      if (hard !== HARD_STATUS.REJECT_PROVEN) return 0;
    }
    this.directFireTrapProofCount += 1; return 1;
  }
  hostileProjectileSlot(state, seat) {
    const a = state.arrays; const tank = a[ARRAY.TANK_CELL][seat];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] || a[ARRAY.PROJECTILE_OWNER][slot] === seat) continue;
      const projectile = a[ARRAY.PROJECTILE_CELL][slot]; const direction = a[ARRAY.PROJECTILE_DIR][slot];
      const px = state.x(projectile); const py = state.y(projectile);
      const tx = state.x(tank); const ty = state.y(tank);
      const approaching = direction === 0 ? px === tx && py > ty :
        direction === 1 ? py === ty && px < tx : direction === 2 ? px === tx && py < ty :
          py === ty && px > tx;
      if (approaching && this.clearLine(state, projectile, tank)) return slot;
    }
    return -1;
  }
  pushProjectileEvasion(top, state, seat, slot) {
    const a = state.arrays; const current = a[ARRAY.TANK_DIR][seat];
    const projectileDirection = a[ARRAY.PROJECTILE_DIR][slot]; const cell = a[ARRAY.TANK_CELL][seat];
    if ((current & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, current))) this.pushDeep(top, seat, ACTION.GO);
    let count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count >= 2) return;
    const leftDirection = (current + 3) & 3; const rightDirection = (current + 1) & 3;
    if ((leftDirection & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, leftDirection)))
      this.pushDeep(top, seat, ACTION.TURN_LEFT);
    count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count >= 2) return;
    if ((rightDirection & 1) !== (projectileDirection & 1) &&
        this.walkable(state, this.target(state, cell, rightDirection)))
      this.pushDeep(top, seat, ACTION.TURN_RIGHT);
  }
  pushDeep(top, seat, action, argument = NONE_CELL) {
    const count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    const offset = top * DEEP_WIDTH; const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
    for (let index = 0; index < count; index += 1) if (actions[offset + index] === action &&
        arguments_[offset + index] === argument) return count;
    if (count >= DEEP_WIDTH) return count; actions[offset + count] = action;
    arguments_[offset + count] = argument;
    if (seat) this.frameEnemyCount[top] = count + 1; else this.frameOurCount[top] = count + 1;
    return count + 1;
  }
  teleportArgument(state, seat) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return NONE_CELL;
    for (let direction = 0; direction < 4; direction += 1) {
      const cell = this.target(state, star, direction);
      if (this.walkable(state, cell) && cell !== a[ARRAY.TANK_CELL][seat ^ 1]) return cell;
    }
    return NONE_CELL;
  }
  pushDeepSkill(top, state, seat, skill) {
    const action = ACTION.CAST_SHIELD + skill - SKILL.SHIELD;
    const argument = skill === SKILL.TELEPORT ? this.teleportArgument(state, seat) : NONE_CELL;
    if (skill !== SKILL.TELEPORT || argument !== NONE_CELL) this.pushDeep(top, seat, action, argument);
  }
  finishDeepRepresentatives(top, seat, expansionLimit = DEEP_WIDTH) {
    const count = seat ? this.frameEnemyCount[top] : this.frameOurCount[top];
    if (count > this.iterationGeneratedMax) this.iterationGeneratedMax = count;
    if (count > expansionLimit) this.iterationTruncatedCount += count - expansionLimit;
    if (seat) { this.frameEnemyGeneratedCount[top] = count;
      if (count > expansionLimit) this.frameEnemyCount[top] = expansionLimit; }
    else { this.frameOurGeneratedCount[top] = count;
      if (count > expansionLimit) this.frameOurCount[top] = expansionLimit; }
  }
  generateDeep(top, state, seat) {
    if (seat) this.frameEnemyCount[top] = 0; else this.frameOurCount[top] = 0;
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const cell = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const current = a[ARRAY.TANK_DIR][seat]; const attackDirection = this.desiredDirection(state, cell, enemy);
    const skill = a[ARRAY.TANK_SKILL][seat]; const skillReady = skill !== SKILL.NONE &&
      a[ARRAY.TANK_SKILL_READY][seat] <= frame;
    const hostileSlot = this.hostileProjectileSlot(state, seat);
    if (hostileSlot >= 0) {
      this.pushProjectileEvasion(top, state, seat, hostileSlot);
      if (skillReady && (skill === SKILL.SHIELD || skill === SKILL.TELEPORT || skill === SKILL.BOOST))
        this.pushDeepSkill(top, state, seat, skill);
      if ((seat ? this.frameEnemyCount[top] : this.frameOurCount[top]) === 0)
        this.pushDeep(top, seat, ACTION.NONE);
      this.finishDeepRepresentatives(top, seat);
      return;
    }
    const canFire = !this.activeProjectile(state, seat) &&
      (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][seat] <= frame);
    const directFire = canFire && attackDirection === current && this.clearLine(state, cell, enemy);
    const tacticalSkill = skillReady && (skill === SKILL.SHIELD || skill === SKILL.BOOST ||
      skill === SKILL.OVERLOAD || skill === SKILL.TELEPORT ||
      this.distance(state, cell, enemy) <= 6 || this.clearLine(state, cell, enemy));
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const target = star !== NONE_CELL ? star : enemy;
    const wanted = this.desiredDirection(state, cell, target);
    const left = (current + 3) & 3;
    const targetAction = wanted === current ? ACTION.GO :
      wanted === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
    const contact = this.distance(state, cell, enemy) <= 6 || this.clearLine(state, cell, enemy);
    if (contact) {
      if (directFire) this.pushDeep(top, seat, ACTION.FIRE);
      this.pushDeep(top, seat, targetAction);
      if (attackDirection !== current) this.pushDeep(top, seat,
        attackDirection === left ? ACTION.TURN_LEFT : ACTION.TURN_RIGHT);
      if (tacticalSkill) this.pushDeepSkill(top, state, seat, skill);
      if ((seat ? this.frameEnemyCount[top] : this.frameOurCount[top]) < DEEP_WIDTH)
        this.pushDeep(top, seat, ACTION.GO);
      this.finishDeepRepresentatives(top, seat, this.iterationExpansionLimit);
    } else {
      this.pushDeep(top, seat, targetAction);
      if (targetAction !== ACTION.GO && this.walkable(state, this.target(state, cell, current)))
        this.pushDeep(top, seat, ACTION.GO);
      else this.pushDeep(top, seat, targetAction === ACTION.TURN_LEFT ?
        ACTION.TURN_RIGHT : ACTION.TURN_LEFT);
      this.finishDeepRepresentatives(top, seat);
    }
  }
  moveProgramFirst(actions, arguments_, offset, count, action, argument) {
    let at = 0;
    while (at < count && (actions[offset + at] !== action ||
        arguments_[offset + at] !== argument)) at += 1;
    if (at <= 0 || at >= count) return at === 0 ? 1 : 0;
    const selectedAction = actions[offset + at]; const selectedArgument = arguments_[offset + at];
    for (; at > 0; at -= 1) {
      actions[offset + at] = actions[offset + at - 1];
      arguments_[offset + at] = arguments_[offset + at - 1];
    }
    actions[offset] = selectedAction; arguments_[offset] = selectedArgument; return 1;
  }
  prepareRootOrder(state) {
    for (let row = 0; row < this.rootOurCount; row += 1) this.rootRowOrder[row] = row;
    for (let column = 0; column < this.rootEnemyCount; column += 1)
      this.rootEnemyOrder[column] = column;
    this.crossFramePVActive = 0; this.crossFramePVRow = 255;
    this.crossFramePVEnemyColumn = 255;
    this.publishedRootOrderActive = 0;
    this.diagnosticRootPriorActive = 0; this.diagnosticRootPriorRow = 255;
    if (this.diagnosticRootPriorPrepared) {
      let found = 255; let matches = 0;
      for (let row = 0; row < this.rootOurCount; row += 1) {
        const physical = this.physicalRootRow(row);
        if (this.rootActions[physical] !== this.diagnosticRootPriorAction ||
            this.diagnosticRootPriorArgumentExact &&
            this.rootArguments[physical] !== this.diagnosticRootPriorArgument) continue;
        found = row; matches += 1;
      }
      if (matches === 1) {
        for (let at = found; at > 0; at -= 1)
          this.rootRowOrder[at] = this.rootRowOrder[at - 1];
        this.rootRowOrder[0] = found;
        this.diagnosticRootPriorRow = found;
        this.diagnosticRootPriorActive = 1;
        this.diagnosticRootPriorPromoteCount += 1;
        return 1;
      }
      if (matches > 1) this.diagnosticRootPriorAmbiguousCount += 1;
      else this.diagnosticRootPriorMissingCount += 1;
    }
    if (!this.crossFramePVEnabled || !this.crossFrameRootPVEnabled ||
        !this.crossFramePVPrepared || !state ||
        this.crossFramePVHashLo !== state.hashLo || this.crossFramePVHashHi !== state.hashHi)
      return 0;
    for (let row = 0; row < this.rootOurCount; row += 1)
      if (this.rootActions[this.physicalRootRow(row)] === this.crossFramePVAction &&
          this.rootArguments[this.physicalRootRow(row)] === this.crossFramePVArgument) {
        this.crossFramePVRow = row; break;
      }
    if (this.crossFramePVRow === 255) return 0;
    for (let column = 0; column < this.rootEnemyCount; column += 1)
      if (this.rootEnemyActions[column] === this.crossFramePVEnemyAction &&
          this.rootEnemyArguments[column] === this.crossFramePVEnemyArgument) {
        this.crossFramePVEnemyColumn = column; break;
      }
    for (let at = this.crossFramePVRow; at > 0; at -= 1)
      this.rootRowOrder[at] = this.rootRowOrder[at - 1];
    this.rootRowOrder[0] = this.crossFramePVRow;
    if (this.crossFramePVEnemyColumn !== 255) {
      for (let at = this.crossFramePVEnemyColumn; at > 0; at -= 1)
        this.rootEnemyOrder[at] = this.rootEnemyOrder[at - 1];
      this.rootEnemyOrder[0] = this.crossFramePVEnemyColumn;
    }
    this.crossFramePVActive = 1; this.crossFramePVRootPromoteCount += 1; return 1;
  }
  preparePublishedOwnerOrder() {
    if (this.crossFramePVActive ||
        this.diagnosticRootPriorActive && !this.diagnosticRootPriorSeedOnly ||
        !this.representativeSupportComplete ||
        this.representativeBestRow >= this.rootOurCount) return 0;
    if (this.diagnosticRootPriorActive) {
      this.diagnosticRootPriorActive = 0;
      this.diagnosticRootPriorRow = 255;
    }
    let at = 0;
    while (at < this.rootOurCount &&
        this.rootRowOrder[at] !== this.representativeBestRow) at += 1;
    if (at >= this.rootOurCount) return 0;
    const selected = this.rootRowOrder[at];
    for (; at > 0; at -= 1) this.rootRowOrder[at] = this.rootRowOrder[at - 1];
    this.rootRowOrder[0] = selected; this.publishedRootOrderActive = 1; return 1;
  }
  actualRootRow(orderIndex) {
    if (this.selectiveRootActive) return this.contender.actualRow(orderIndex);
    return this.crossFramePVActive || this.diagnosticRootPriorActive ||
      this.publishedRootOrderActive ?
      this.rootRowOrder[orderIndex] : orderIndex;
  }
  physicalRootRow(row) {
    return this.rootDomainActive ? this.rootDomainRows[row] : row;
  }
  actualRootColumn(actualRow, orderIndex) {
    if (this.selectiveRootActive) return this.contender.actualColumn(actualRow, orderIndex);
    return this.crossFramePVActive ? this.rootEnemyOrder[orderIndex] : orderIndex;
  }
  promoteFrameFromTT(top, state) {
    if (!this.crossFramePVEnabled || top < 1 || this.frameDepth[top] <= 1) return 0;
    const requested = this.frameDepth[top];
    for (let depth = requested - 1; depth >= 1; depth -= 1) {
      const slot = this.cache.probe(this.cacheKey(state, depth), this.cacheKeyHi(state, depth),
        this.cacheSignature(state, depth), mix(state.hashHi ^ state.hashLo,
          depth + this.baseRisk * 8191 + this.iterationExpansionLimit * 65537 + 0x7f4a),
        DEPTH_CACHE_VERSION);
      this.cacheProbes += 1;
      if (slot === CACHE_MISS || !(this.cache.flags[slot] & CACHE_FLAG.COMPLETE)) continue;
      const own = this.cache.value2[slot]; const enemy = this.cache.value3[slot];
      const offset = top * DEEP_WIDTH;
      const ownMoved = this.moveProgramFirst(this.deepOurActions, this.deepOurArguments,
        offset, this.frameOurCount[top], programAction(own), programArgument(own));
      const enemyMoved = this.moveProgramFirst(this.deepEnemyActions, this.deepEnemyArguments,
        offset, this.frameEnemyCount[top], programAction(enemy), programArgument(enemy));
      if (ownMoved || enemyMoved) { this.crossFramePVDeepPromoteCount += 1; return 1; }
    }
    return 0;
  }
  actionAt(top, seat, index) {
    if (this.frameRoot[top]) {
      const row = this.actualRootRow(this.frameRow[top]);
      const actual = seat ? this.actualRootColumn(row, index) : this.physicalRootRow(row);
      return seat ? this.rootEnemyActions[actual] : this.rootActions[actual];
    }
    return (seat ? this.deepEnemyActions : this.deepOurActions)[top * DEEP_WIDTH + index];
  }
  argumentAt(top, seat, index) {
    if (this.frameRoot[top]) {
      const row = this.actualRootRow(this.frameRow[top]);
      const actual = seat ? this.actualRootColumn(row, index) : this.physicalRootRow(row);
      return seat ? this.rootEnemyArguments[actual] : this.rootArguments[actual];
    }
    return (seat ? this.deepEnemyArguments : this.deepOurArguments)[top * DEEP_WIDTH + index];
  }
  mobility(state, seat) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.target(state, cell, direction);
      if (this.walkable(state, next) && next !== a[ARRAY.TANK_CELL][seat ^ 1]) count += 1;
    }
    return count;
  }
  clearLine(state, from, to) {
    const fromX = state.x(from); const fromY = state.y(from);
    const toX = state.x(to); const toY = state.y(to); if (fromX !== toX && fromY !== toY) return 0;
    const dx = toX === fromX ? 0 : toX > fromX ? 1 : -1;
    const dy = toY === fromY ? 0 : toY > fromY ? 1 : -1; const terrain = state.arrays[ARRAY.TERRAIN];
    let x = fromX + dx; let y = fromY + dy;
    while (x !== toX || y !== toY) { const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0; x += dx; y += dy; }
    return 1;
  }
  chanceAlternatives(state, seat, action) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_STUN_UNTIL][seat] === NONE_FRAME ||
        a[ARRAY.TANK_STUN_UNTIL][seat] <= frame) return 1;
    if (action >= BOOST_COMPOUND_BASE && action <= BOOST_COMPOUND_END)
      return (action - BOOST_COMPOUND_BASE) % BOOST_COMPOUND_STRIDE <= 2 ? 4 : 2;
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 2 : 1;
  }
  projectDepthTwoChildNodes(state, top = 1) {
    // HP19 Shadow: P1 already owns this exact successor. Reuse the existing
    // deep representative slabs to count the minimum P2 child matrix without
    // applying another transition or allocating scratch state. All iteration
    // support counters are restored before returning, so the projection cannot
    // change P1/P2 completeness or search ownership.
    const generatedMax = this.iterationGeneratedMax;
    const truncated = this.iterationTruncatedCount;
    const ourCount = this.frameOurCount[top];
    const enemyCount = this.frameEnemyCount[top];
    const ourGenerated = this.frameOurGeneratedCount[top];
    const enemyGenerated = this.frameEnemyGeneratedCount[top];
    this.generateDeep(top, state, 0); this.generateDeep(top, state, 1);
    let nodes = 0; const offset = top * DEEP_WIDTH;
    for (let row = 0; row < this.frameOurCount[top]; row += 1)
      for (let column = 0; column < this.frameEnemyCount[top]; column += 1)
        nodes += this.chanceAlternatives(state, 0, this.deepOurActions[offset + row]) *
          this.chanceAlternatives(state, 1, this.deepEnemyActions[offset + column]);
    this.frameOurCount[top] = ourCount; this.frameEnemyCount[top] = enemyCount;
    this.frameOurGeneratedCount[top] = ourGenerated;
    this.frameEnemyGeneratedCount[top] = enemyGenerated;
    this.iterationGeneratedMax = generatedMax;
    this.iterationTruncatedCount = truncated;
    this.depthTwoPreflightStateCount += 1;
    return nodes;
  }
  prepareChance(top, state, action0, action1) {
    if (this.frameChanceCount[top]) return;
    const own = this.chanceAlternatives(state, 0, action0);
    const enemy = this.chanceAlternatives(state, 1, action1);
    this.frameOwnChanceCount[top] = own; this.frameEnemyChanceCount[top] = enemy;
    this.frameChanceCount[top] = own * enemy; this.frameChanceIndex[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
  }
  chanceCode(top, state, seat, action) {
    const alternatives = seat ? this.frameEnemyChanceCount[top] : this.frameOwnChanceCount[top];
    if (alternatives === 1) return CHANCE.NORMAL;
    const ownAlternatives = this.frameOwnChanceCount[top];
    const variant = seat === 0 ? this.frameChanceIndex[top] % ownAlternatives :
      Math.floor(this.frameChanceIndex[top] / ownAlternatives);
    return variant;
  }
  rootMatrixNodeCount(state) {
    let count = 0;
    for (let row = 0; row < this.rootOurCount; row += 1)
      for (let column = 0; column < this.rootEnemyCount; column += 1)
        count += this.chanceAlternatives(state, 0,
          this.rootActions[this.physicalRootRow(row)]) *
          this.chanceAlternatives(state, 1, this.rootEnemyActions[column]);
    return count;
  }
  robustChance(sum, worst, count) {
    const expected = Math.floor(sum / count); const lambda = 99 * this.baseRisk;
    return Math.floor((lambda * expected + (10000 - lambda) * worst) / 10000);
  }
  heuristic(state) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    let value = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 3500;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== NONE_CELL) value += (this.distance(state, enemy, star) -
      this.distance(state, own, star)) * 350;
    value += (this.mobility(state, 0) - this.mobility(state, 1)) * 300;
    const ownWanted = this.desiredDirection(state, own, enemy);
    const enemyWanted = this.desiredDirection(state, enemy, own);
    if (this.clearLine(state, own, enemy)) {
      if (ownWanted === a[ARRAY.TANK_DIR][0]) value += 1200;
      if (enemyWanted === a[ARRAY.TANK_DIR][1]) value -= 1200;
    }
    if (a[ARRAY.TANK_SKILL_READY][0] <= a[ARRAY.SCALAR][SCALAR.FRAME]) value += 250;
    if (a[ARRAY.TANK_SKILL_READY][1] <= a[ARRAY.SCALAR][SCALAR.FRAME]) value -= 250;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]);
    if (remaining <= 16) {
      const starDelta = a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1];
      if (starDelta <= 0) value -= (16 - remaining) * (starDelta < 0 ? 650 : 350);
      else value += (16 - remaining) * 350;
    }
    return Math.max(-25000, Math.min(25000, value));
  }
  terminalValue(terminal, remainingDepth) {
    if (terminal === TERMINAL.DRAW) return 0;
    if (terminal === TERMINAL.WIN0) return 30000 + remainingDepth * 100;
    return -30000 - remainingDepth * 100;
  }
  cacheKey(state, depth) {
    return mix(state.hashLo, depth * 257 + this.baseRisk * 65537 +
      this.iterationExpansionLimit * 4099 + 0x51f15e);
  }
  cacheKeyHi(state, depth) {
    return mix(state.hashHi, depth * 65537 + this.baseRisk * 257 +
      this.iterationExpansionLimit * 8191 + 0x9e37);
  }
  cacheSignature(state, depth) {
    const scalar = state.arrays[ARRAY.SCALAR];
    return mix(state.hashLo ^ state.hashHi,
      depth + scalar[SCALAR.FRAME] * 17 + this.baseRisk * 4099 +
      this.iterationExpansionLimit * 131071);
  }
  dependencySignature(state) {
    const scalar = state.arrays[ARRAY.SCALAR];
    return mix(scalar[SCALAR.TOPOLOGY_VERSION], scalar[SCALAR.NEXT_ENTITY]);
  }
  initializeFrame(top, depth, root, state) {
    this.frameInitialized[top] = 1; this.frameRoot[top] = root ? 1 : 0;
    this.frameAwaiting[top] = 0; this.frameDepth[top] = depth; this.frameRow[top] = 0;
    this.frameColumn[top] = 0; this.frameBestRow[top] = 0; this.frameBest[top] = DEPTH_VALUE_MIN;
    this.frameWorst[top] = DEPTH_VALUE_MAX; this.frameCacheable[top] = 1;
    this.frameWorstColumn[top] = 0; this.frameBestEnemyColumn[top] = 0;
    this.frameChanceIndex[top] = 0; this.frameChanceCount[top] = 0;
    this.frameOwnChanceCount[top] = 0; this.frameEnemyChanceCount[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
    if (root) { this.frameOurCount[top] = this.rootOurCount;
      this.frameEnemyCount[top] = this.rootEnemyCount; }
    else { this.generateDeep(top, state, 0); this.generateDeep(top, state, 1); }
  }
  probeFrame(top, state) {
    if (this.frameRoot[top]) return CACHE_MISS;
    const depth = this.frameDepth[top];
    const keyLo = this.cacheKey(state, depth); const keyHi = this.cacheKeyHi(state, depth);
    const signatureLo = this.cacheSignature(state, depth); const signatureHi =
      mix(state.hashHi ^ state.hashLo, depth + this.baseRisk * 8191 +
        this.iterationExpansionLimit * 65537 + 0x7f4a);
    this.cacheProbes += 1;
    const slot = this.cache.probe(keyLo, keyHi, signatureLo, signatureHi, DEPTH_CACHE_VERSION);
    if (slot !== CACHE_MISS) this.cacheHits += 1; return slot;
  }
  writeFrame(top, state, value) {
    if (this.frameRoot[top] || !this.frameCacheable[top]) return CACHE_MISS;
    const bestRow = this.frameBestRow[top]; const enemyColumn = this.frameBestEnemyColumn[top];
    const ownProgram = packProgram(this.actionAt(top, 0, bestRow),
      this.argumentAt(top, 0, bestRow));
    const enemyProgram = packProgram(this.actionAt(top, 1, enemyColumn),
      this.argumentAt(top, 1, enemyColumn));
    const depth = this.frameDepth[top]; const slot = this.cache.write(this.cacheKey(state, depth),
      this.cacheKeyHi(state, depth), this.cacheSignature(state, depth),
      mix(state.hashHi ^ state.hashLo, depth + this.baseRisk * 8191 +
        this.iterationExpansionLimit * 65537 + 0x7f4a), DEPTH_CACHE_VERSION,
      this.cache.currentGeneration, CACHE_DEPENDENCY.PHYSICAL | CACHE_DEPENDENCY.TERRAIN |
      CACHE_DEPENDENCY.ENTITY | CACHE_DEPENDENCY.PROFILE | CACHE_DEPENDENCY.ACTION_SET,
      this.dependencySignature(state), CACHE_FLAG.COMPLETE, depth, value,
      bestRow, ownProgram, enemyProgram);
    if (slot !== CACHE_MISS) this.cacheWrites += 1;
    return slot;
  }
  consume(top, value, cacheable, bound = VALUE_BOUND.EXACT) {
    if (!cacheable) this.frameCacheable[top] = 0;
    if (this.frameRoot[top]) {
      const row = this.actualRootRow(this.frameRow[top]);
      const column = this.actualRootColumn(row, this.frameColumn[top]);
      const cell = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
      this.iterationCellScore[cell] = value;
      if (this.windowedBoundsActive) this.iterationCellBound[cell] = bound;
    }
    if (value < this.frameWorst[top]) {
      this.frameWorst[top] = value; this.frameWorstColumn[top] = this.frameColumn[top];
    }
    this.frameColumn[top] += 1;
    const cutoff = this.windowedBoundsActive && !this.frameRoot[top] ?
      Math.max(this.frameBest[top], this.frameAlpha[top]) : this.frameBest[top];
    if (!this.frameRoot[top] && this.frameWorst[top] <= cutoff) {
      if (this.windowedBoundsActive && cutoff > this.frameBest[top])
        this.windowBoundCutoffCount += 1;
      this.frameColumn[top] = this.frameEnemyCount[top];
    }
    else if (this.frameRoot[top] && this.selectiveRootActive && this.frameRow[top] > 0) {
      const row = this.contender.actualRow(this.frameRow[top]);
      if (this.contender.canPrune(row, this.frameWorst[top], this.frameBest[top],
          this.frameBestRow[top])) {
        this.selectivePrunedCells += this.frameEnemyCount[top] - this.frameColumn[top];
        this.frameColumn[top] = this.frameEnemyCount[top];
      }
    }
  }
  recordPrincipalFromSlot(top, state, slot) {
    const entry = this.framePrincipalEntry[top];
    if (top !== 1 || entry === CACHE_MISS || slot === CACHE_MISS || !this.rootTransitions ||
        !(this.cache.flags[slot] & CACHE_FLAG.COMPLETE)) return 0;
    const own = this.cache.value2[slot]; const enemy = this.cache.value3[slot];
    return this.rootTransitions.storePrincipal(entry, state, this.cache.depth[slot],
      programAction(own), programArgument(own), programAction(enemy), programArgument(enemy),
      this.baseRisk, this.iterationExpansionLimit);
  }
  consumeOutcome(top, value, cacheable, bound = VALUE_BOUND.EXACT) {
    if (!cacheable) this.frameCacheable[top] = 0;
    this.frameChanceSum[top] += value;
    if (value < this.frameChanceWorst[top]) this.frameChanceWorst[top] = value;
    this.frameChanceIndex[top] += 1;
    if (this.frameChanceIndex[top] < this.frameChanceCount[top]) return 0;
    const chanceCount = this.frameChanceCount[top];
    const robust = this.robustChance(this.frameChanceSum[top], this.frameChanceWorst[top],
      chanceCount);
    this.frameChanceIndex[top] = 0; this.frameChanceCount[top] = 0;
    this.frameOwnChanceCount[top] = 0; this.frameEnemyChanceCount[top] = 0;
    this.frameChanceSum[top] = 0; this.frameChanceWorst[top] = DEPTH_VALUE_MAX;
    this.consume(top, robust, this.frameCacheable[top],
      this.windowedBoundsActive && chanceCount === 1 ? bound : VALUE_BOUND.EXACT); return 1;
  }
  publishIterationInterval(depth, interrupted) {
    let rootLower = DEPTH_VALUE_MIN; let rootUpper = DEPTH_VALUE_MIN;
    let allComplete = interrupted ? 0 : 1;
    for (let row = 0; row < this.rootOurCount; row += 1) {
      let rowLower = DEPTH_VALUE_MAX; let rowUpper = DEPTH_VALUE_MAX;
      for (let column = 0; column < this.rootEnemyCount; column += 1) {
        const cell = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
        const present = this.iterationCellScore[cell] !== DEPTH_VALUE_MIN &&
          this.iterationCellComplete[cell] !== 2;
        const bound = present && this.windowedBoundsActive ?
          this.iterationCellBound[cell] : VALUE_BOUND.EXACT;
        const complete = present && bound === VALUE_BOUND.EXACT;
        this.iterationCellComplete[cell] = complete ? 1 : 0;
        const lower = !present || bound === VALUE_BOUND.UPPER ? DEPTH_VALUE_MIN :
          this.iterationCellScore[cell];
        const upper = !present || bound === VALUE_BOUND.LOWER ? DEPTH_VALUE_MAX :
          this.iterationCellScore[cell];
        this.attemptCellLower[cell] = lower; this.attemptCellUpper[cell] = upper;
        if (lower < rowLower) rowLower = lower;
        if (upper < rowUpper) rowUpper = upper;
        if (!complete) allComplete = 0;
      }
      this.attemptRowLower[row] = rowLower; this.attemptRowUpper[row] = rowUpper;
      if (rowLower > rootLower) rootLower = rowLower;
      if (rowUpper > rootUpper) rootUpper = rowUpper;
    }
    this.attemptRootLower = rootLower; this.attemptRootUpper = rootUpper;
    this.attemptIntervalDepth = depth;
    this.attemptIntervalExpansionLimit = this.iterationExpansionLimit;
    this.attemptIntervalStatus = allComplete ? ROOT_INTERVAL_STATUS.COMPLETE :
      ROOT_INTERVAL_STATUS.INCOMPLETE;
    if (this.selectiveRootActive)
      this.contender.update(this.attemptCellLower, this.attemptCellUpper,
        this.rootOurCount, this.rootEnemyCount);
    return this.attemptIntervalStatus;
  }
  abortNonExactAttempt(bundle, state, depth, rootMark, rootLo, rootHi, reason) {
    this.exactOwnerEarlyAbortCount += 1;
    this.lastNonExactAbortReason = reason;
    this.publishIterationInterval(depth, 1); this.updateWorkMeter(bundle);
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark)
      this.rootRestoreFailures += 1;
    return 0;
  }
  canAbortNonExactAttempt() {
    if (!this.activeRootTransitions) return 1;
    return this.activeRootTransitions.hasPrincipalRow(
      this.physicalRootRow(this.representativeBestRow));
  }
  runIteration(bundle, depth, nodeBudget, expansionLimit = 2, selectiveRoot = 0,
      abortOnNonExactSupport = 0) {
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed; let top = 0;
    let hasReturn = 0; let returnValue = 0; let returnCacheable = 1;
    let returnBound = VALUE_BOUND.EXACT;
    this.configureIteration(depth, expansionLimit);
    this.selectiveRootActive = selectiveRoot ? 1 : 0;
    this.windowedBoundsActive = this.windowedBoundsEnabled && this.selectiveRootActive ? 1 : 0;
    if (this.selectiveRootActive) this.contender.prepareOrder(this.rootScore,
      this.rootCellScore, this.rootOurCount, this.rootEnemyCount,
      this.crossFramePVActive ? this.crossFramePVRow : 255,
      this.crossFramePVActive ? this.crossFramePVEnemyColumn : 255);
    this.frameInitialized.fill(0); this.iterationScore.fill(DEPTH_VALUE_MIN);
    this.framePrincipalEntry.fill(CACHE_MISS);
    this.iterationCellScore.fill(DEPTH_VALUE_MIN);
    this.iterationCellComplete.fill(0);
    if (this.windowedBoundsActive) {
      this.iterationCellBound.fill(VALUE_BOUND.EXACT);
      this.frameAlpha[0] = DEPTH_VALUE_MIN; this.frameBeta[0] = DEPTH_VALUE_MAX;
    }
    this.trapProbeBudget = depth === 1 ? Math.min(DIRECT_FIRE_TRAP_NODE_CAP,
      Math.max(0, nodeBudget - this.nodes - this.rootMatrixNodeCount(state))) : 0;
    this.initializeFrame(0, depth, 1, state);
    while (top >= 0) {
      if (hasReturn) {
        if (top < 0) break;
        if (this.frameAwaiting[top]) { state.undoTo(this.frameMark[top]);
          this.frameAwaiting[top] = 0;
          this.consumeOutcome(top, returnValue, returnCacheable, returnBound);
          hasReturn = 0; continue; }
      }
      if (!this.frameInitialized[top]) {
        this.initializeFrame(top, this.frameDepth[top], 0, state);
        // When an earlier exact matrix already owns the root, the first support
        // loss (width truncation, unsupported transition, or incomplete Hard)
        // proves this attempt can never replace it. Stop before spending the
        // remaining budget on diagnostic-only approximate values; completed
        // child TT entries remain individually sound.
        if (abortOnNonExactSupport && this.iterationTruncatedCount > 0) {
          if (this.canAbortNonExactAttempt())
            return this.abortNonExactAttempt(bundle, state, depth, rootMark, rootLo, rootHi,
              NONEXACT_ABORT_REASON.WIDTH);
          this.nonExactPrincipalBlockedMask |= 1 << NONEXACT_ABORT_REASON.WIDTH;
        }
        const hit = this.probeFrame(top, state);
        if (hit !== CACHE_MISS) { this.recordPrincipalFromSlot(top, state, hit);
          returnValue = this.cache.value0[hit]; returnCacheable = 1;
          returnBound = VALUE_BOUND.EXACT;
          this.frameInitialized[top] = 0; top -= 1; hasReturn = 1; continue; }
        this.promoteFrameFromTT(top, state);
      }
      if (this.frameRow[top] >= this.frameOurCount[top]) {
        const value = this.frameBest[top]; const cacheable = this.frameCacheable[top];
        const bound = this.windowedBoundsActive && !this.frameRoot[top] ?
          value <= this.frameAlpha[top] ? VALUE_BOUND.UPPER :
            value >= this.frameBeta[top] ? VALUE_BOUND.LOWER : VALUE_BOUND.EXACT :
          VALUE_BOUND.EXACT;
        const slot = bound === VALUE_BOUND.EXACT ? this.writeFrame(top, state, value) : CACHE_MISS;
        this.recordPrincipalFromSlot(top, state, slot);
        if (this.frameRoot[top]) { this.bestRow = this.frameBestRow[top]; this.bestValue = value; }
        this.frameInitialized[top] = 0; top -= 1; returnValue = value;
        returnCacheable = cacheable; returnBound = bound;
        if (bound !== VALUE_BOUND.EXACT) this.windowBoundReturnCount += 1;
        hasReturn = 1; continue;
      }
      if (this.frameColumn[top] >= this.frameEnemyCount[top]) {
        const row = this.frameRow[top]; const value = this.frameWorst[top];
        const actualRow = this.frameRoot[top] ? this.actualRootRow(row) : row;
        if (this.frameRoot[top]) this.iterationScore[actualRow] = value;
        if (value > this.frameBest[top] || value === this.frameBest[top] &&
            actualRow < this.frameBestRow[top]) {
          this.frameBest[top] = value; this.frameBestRow[top] = actualRow;
          this.frameBestEnemyColumn[top] = this.frameWorstColumn[top];
        }
        if (this.windowedBoundsActive && !this.frameRoot[top] &&
            this.frameBest[top] >= this.frameBeta[top]) {
          this.windowBoundCutoffCount += 1;
          this.frameRow[top] = this.frameOurCount[top]; continue;
        }
        this.frameRow[top] = row + 1; this.frameColumn[top] = 0;
        this.frameWorst[top] = DEPTH_VALUE_MAX; this.frameWorstColumn[top] = 0; continue;
      }
      if (this.nodes >= nodeBudget || !this.canConsumeWork(bundle)) {
        this.interruptedCount += 1;
        if (this.workUnitLimit && this.nodes < nodeBudget) this.workInterruptedCount += 1;
        this.publishIterationInterval(depth, 1);
        this.updateWorkMeter(bundle); state.undoTo(rootMark);
        if (state.hashLo !== rootLo || state.hashHi !== rootHi) this.rootRestoreFailures += 1;
        return 0; }
      const row = this.frameRow[top]; const column = this.frameColumn[top];
      const actualRow = this.frameRoot[top] ? this.actualRootRow(row) : row;
      const actualColumn = this.frameRoot[top] ? this.actualRootColumn(actualRow, column) : column;
      const action0 = this.actionAt(top, 0, row); const argument0 = this.argumentAt(top, 0, row);
      const action1 = this.actionAt(top, 1, column); const argument1 = this.argumentAt(top, 1, column);
      this.prepareChance(top, state, action0, action1);
      const chance0 = this.chanceCode(top, state, 0, action0);
      const chance1 = this.chanceCode(top, state, 1, action1);
      let usedRootTransition = 0; let status = 0;
      if (this.frameRoot[top] && this.activeRootTransitions) {
        status = this.activeRootTransitions.apply(bundle,
          this.physicalRootRow(actualRow), actualColumn,
          chance0, chance1, 1);
        usedRootTransition = status ? 1 : 0;
      }
      if (!usedRootTransition) status = bundle.kernel.applyFrame(action0, argument0,
        action1, argument1, chance0, chance1);
      this.nodes += 1;
      if (this.depthTwoPreflightActive && top === 0 && this.frameDepth[top] === 1)
        this.depthTwoPreflightProjectedNodes += 1;
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        if (this.depthTwoPreflightP2FastActive && this.depthTwoPreflightP2FastStatusCounts) {
          this.depthTwoPreflightP2FastStatusCounts[status] += 1;
          const stride = ACTION.BOOST_RIGHT_BOMB + 1;
          this.depthTwoPreflightP2FastActionPairCounts[action0 * stride + action1] += 1;
        }
        this.incompleteTransitions += 1;
        const failedRow = this.actualRootRow(this.frameRow[0]);
        const failedColumn = this.actualRootColumn(failedRow, this.frameColumn[0]);
        this.iterationCellComplete[failedRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES +
          failedColumn] = 2;
        if (abortOnNonExactSupport) {
          if (this.canAbortNonExactAttempt())
            return this.abortNonExactAttempt(bundle, state, depth, rootMark, rootLo, rootHi,
              NONEXACT_ABORT_REASON.FAST);
          this.nonExactPrincipalBlockedMask |= 1 << NONEXACT_ABORT_REASON.FAST;
        }
        this.consumeOutcome(top, -22000, 0); continue;
      }
      const mark = bundle.kernel.lastMark; const hard = usedRootTransition ?
        bundle.hard.lastStatus : bundle.hard.classifyApplied();
      const terminal = bundle.hard.lastTerminal; let value = 0; let cacheable = 1;
      if (this.depthTwoPreflightActive && top === 0 && this.frameDepth[top] === 1 &&
          hard === HARD_STATUS.ALLOW && (!terminal || terminal === TERMINAL.INCOMPLETE))
        this.depthTwoPreflightProjectedNodes += this.projectDepthTwoChildNodes(state);
      if (hard === HARD_STATUS.REJECT_POLICY) { value = -27500; cacheable = 0; }
      else if (terminal && terminal !== TERMINAL.INCOMPLETE)
        value = this.terminalValue(terminal, this.frameDepth[top]);
      else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000 - this.frameDepth[top] * 50;
      else if (hard === HARD_STATUS.INCOMPLETE) {
        value = this.heuristic(state) - 6000; cacheable = 0;
        const failedRow = this.actualRootRow(this.frameRow[0]);
        const failedColumn = this.actualRootColumn(failedRow, this.frameColumn[0]);
        this.iterationCellComplete[failedRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES +
          failedColumn] = 2;
        if (abortOnNonExactSupport) {
          if (this.canAbortNonExactAttempt())
            return this.abortNonExactAttempt(bundle, state, depth, rootMark, rootLo, rootHi,
              NONEXACT_ABORT_REASON.HARD);
          this.nonExactPrincipalBlockedMask |= 1 << NONEXACT_ABORT_REASON.HARD;
        }
      }
      else if (this.frameDepth[top] <= 1) {
        let trapBudget = this.trapProbeBudget; let workTrapTruncated = 0;
        if (this.workUnitLimit) {
          const perNode = this.runtimeConfig.WORK_CHARGES[WORK_KIND.VALUE_NODE] +
            this.runtimeConfig.WORK_CHARGES[WORK_KIND.FAST_TRANSITION] +
            this.runtimeConfig.WORK_CHARGES[WORK_KIND.HARD];
          const workTrapBudget = Math.max(0,
            Math.floor((this.workUnitLimit - this.updateWorkMeter(bundle)) / perNode));
          if (workTrapBudget < trapBudget) workTrapTruncated = 1;
          trapBudget = Math.min(trapBudget, workTrapBudget);
        }
        const trap = this.probeDirectFireTrap(bundle, trapBudget);
        this.trapProbeBudget -= this.lastTrapProbeNodes;
        this.nodes += this.lastTrapProbeNodes;
        if (trap < 0 && workTrapTruncated) {
          this.interruptedCount += 1;
          if (this.workUnitLimit && this.nodes < nodeBudget) this.workInterruptedCount += 1;
          state.undoTo(mark); this.publishIterationInterval(depth, 1);
          this.updateWorkMeter(bundle); state.undoTo(rootMark);
          if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
              state.deltaUsed * 1024 + state.eventUsed !== rootMark)
            this.rootRestoreFailures += 1;
          return 0;
        }
        value = trap === 1 ? -29900 : this.heuristic(state);
      }
      else {
        this.frameMark[top] = mark; this.frameAwaiting[top] = 1; const child = top + 1;
        this.frameDepth[child] = this.frameDepth[top] - 1; this.frameInitialized[child] = 0;
        if (this.windowedBoundsActive) {
          if (this.frameChanceCount[top] === 1) {
            this.frameAlpha[child] = Math.max(this.frameAlpha[top], this.frameBest[top]);
            this.frameBeta[child] = Math.min(this.frameBeta[top], this.frameWorst[top]);
          } else {
            this.frameAlpha[child] = DEPTH_VALUE_MIN;
            this.frameBeta[child] = DEPTH_VALUE_MAX;
          }
        }
        if (top === 0 && usedRootTransition && this.rootTransitions)
          this.framePrincipalEntry[child] = this.rootTransitions.entryIndex(
            this.physicalRootRow(actualRow), actualColumn, chance0, chance1);
        top = child; continue;
      }
      state.undoTo(mark); this.consumeOutcome(top, value, cacheable);
    }
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi || state.deltaUsed * 1024 +
        state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.publishIterationInterval(depth, 1); return 0;
    }
    this.publishIterationInterval(depth, 0);
    this.updateWorkMeter(bundle);
    return 1;
  }
  runSelectiveIteration(bundle, depth, nodeBudget, expansionLimit = 2) {
    const before = this.nodes; this.selectiveAttemptedDepth = depth;
    this.selectivePrunedCells = 0;
    const traversed = this.runIteration(bundle, depth, nodeBudget, expansionLimit, 1);
    this.lastSelectiveNodes = Math.max(0, this.nodes - before);
    this.selectiveNodeCount += this.lastSelectiveNodes;
    if (!traversed || this.contender.status !== FRONTIER_STATUS.ACTION_RESOLVED) return 0;
    this.selectiveResolvedCount += 1;
    this.selectiveCompletedDepth = depth; this.selectiveBestRow = this.contender.provenRow;
    this.selectiveBestValue = this.contender.provenValue; return 1;
  }
  runScheduledIteration(bundle, depth, budget, expansionLimit, ourCount) {
    if (!this.selectiveContinuationEnabled || depth <= 2) {
      const abortOnTruncation = this.exactOwnerEarlyAbort &&
        this.representativeSupportComplete ? 1 : 0;
      if (!this.runIteration(bundle, depth, budget, expansionLimit, 0, abortOnTruncation)) {
        this.restorePublishedBest(); return 0;
      }
      this.commitIteration(ourCount, depth); return 1;
    }
    if (!this.runSelectiveIteration(bundle, depth, budget, expansionLimit)) return 0;
    // A selective proof may resolve the root action while deliberately leaving
    // dominated cells broad.  Only a genuinely full matrix may replace the
    // scalar cells consumed by Risk/StageMatrix.
    if (this.attemptIntervalStatus === ROOT_INTERVAL_STATUS.COMPLETE)
      this.commitIteration(ourCount, depth);
    return 1;
  }
  commitIteration(ourCount, depth) {
    this.completedDepth = depth;
    this.completedExpansionLimit = this.iterationExpansionLimit;
    this.completedGeneratedMax = this.iterationGeneratedMax;
    this.completedTruncatedCount = this.iterationTruncatedCount;
    // Width completeness and value completeness are independent. A Fast/Hard
    // INCOMPLETE root cell leaves a sound interval even when every generated
    // representative fitted in the requested width; such a matrix is evidence,
    // not an exact value owner.
    const exact = this.iterationTruncatedCount === 0 &&
      this.attemptIntervalStatus === ROOT_INTERVAL_STATUS.COMPLETE ? 1 : 0;
    // completedDepth describes traversal progress.  The published root values
    // have a separate owner: a deeper but truncated/INCOMPLETE iteration may
    // improve ordering evidence, but cannot replace the last exact matrix.
    if (exact || !this.representativeSupportComplete) {
      for (let row = 0; row < ourCount; row += 1)
        this.rootScore[row] = this.iterationScore[row];
      this.rootCellScore.set(this.iterationCellScore);
    }
    if (exact) {
      this.representativeSupportComplete = 1;
      this.representativeSupportDepth = depth;
      this.representativeSupportExpansionLimit = this.iterationExpansionLimit;
      this.representativeBestRow = this.bestRow;
      this.representativeBestValue = this.bestValue;
    }
    this.restorePublishedBest();
  }
  restorePublishedBest() {
    if (!this.representativeSupportComplete) return 0;
    this.bestRow = this.representativeBestRow;
    this.bestValue = this.representativeBestValue;
    return 1;
  }
  rootStunActive(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    return (a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][0] > frame) ||
      (a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][1] > frame) ? 1 : 0;
  }
  rootImmediateFireContact(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    for (let seat = 0; seat < 2; seat += 1) {
      if (a[ARRAY.TANK_CRASH][seat] || this.activeProjectile(state, seat) ||
          a[ARRAY.TANK_FIRE_LOCK][seat] !== NONE_FRAME &&
          a[ARRAY.TANK_FIRE_LOCK][seat] > frame) continue;
      const own = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
      if (this.desiredDirection(state, own, enemy) === a[ARRAY.TANK_DIR][seat] &&
          this.clearLine(state, own, enemy)) return 1;
    }
    return 0;
  }
  // Budgeted Physical continuation used as an Information depth-2 leaf. Does not
  // commit completedDepth — InformationSearch owns the published depth.
  continuationValue(bundle, depth, nodeBudget, baseRisk = 0, trapAlreadyChecked = 0) {
    this.continuationCallCount += 1;
    this.lastContinuationNodes = 0;
    this.lastContinuationUsable = 0;
    this.lastContinuationComplete = 0;
    this.lastContinuationCompletedDepth = 0;
    this.lastContinuationAttemptedDepth = 0;
    this.lastContinuationIncompleteTransitions = 0;
    this.lastContinuationGeneratedMax = 0;
    this.lastContinuationTruncatedCount = 0;
    const state = bundle && bundle.state;
    if (!state || !Number.isInteger(depth) || depth < 1 ||
        !Number.isInteger(nodeBudget) || nodeBudget < 4) {
      return this.heuristic(state);
    }
    // Physical root iterations may leave valid but unpublished child entries
    // before their root budget is interrupted.  Information continuation has
    // its own canonical namespace so those partial root writes cannot change
    // which hidden-world continuation fits the Information budget.
    const savedCache = this.cache;
    this.cache = this.cacheBank.get(CACHE_ID.INFORMATION_VALUE_TT);
    // This root is an Information leaf, not the production root represented by
    // RootTransitionSlab. Avoid paying a failed root-identity probe per node.
    const savedRootTransitions = this.activeRootTransitions;
    this.activeRootTransitions = null;
    const before = this.nodes;
    // InformationSearch can reserve and run this proof before value
    // continuation. Standalone callers retain the same cheap proof here.
    if (!trapAlreadyChecked) {
      const trap = this.probeDirectFireTrap(bundle, Math.min(8, nodeBudget));
      this.nodes += this.lastTrapProbeNodes;
      if (trap === 1) {
        this.continuationTrapCount += 1;
        this.lastContinuationUsable = 1;
        this.lastContinuationComplete = 1;
        this.lastContinuationNodes = Math.max(0, this.nodes - before);
        this.cache = savedCache;
        this.activeRootTransitions = savedRootTransitions;
        return -29900;
      }
    }
    if (nodeBudget - (this.nodes - before) < 8) {
      this.lastContinuationNodes = Math.max(0, this.nodes - before);
      this.cache = savedCache;
      this.activeRootTransitions = savedRootTransitions;
      return this.heuristic(state);
    }
    const savedCompleted = this.completedDepth;
    const savedAttempted = this.attemptedDepth;
    this.baseRisk = Math.max(0, Math.min(100, baseRisk | 0));
    const targetDepth = Math.min(depth, SEARCH_CAPACITY.MAX_DECISION_DEPTH);
    this.configureIteration(1, 2);
    this.generateDeep(0, state, 0); this.generateDeep(0, state, 1);
    this.lastContinuationGeneratedMax = this.iterationGeneratedMax;
    this.lastContinuationTruncatedCount = this.iterationTruncatedCount;
    let ourCount = this.frameOurCount[0]; let enemyCount = this.frameEnemyCount[0];
    if (ourCount < 1) { this.pushDeep(0, 0, ACTION.NONE); ourCount = 1; }
    if (enemyCount < 1) { this.pushDeep(0, 1, ACTION.NONE); enemyCount = 1; }
    for (let index = 0; index < ourCount; index += 1) {
      this.continuationOurActions[index] = this.deepOurActions[index];
      this.continuationOurArguments[index] = this.deepOurArguments[index];
    }
    for (let index = 0; index < enemyCount; index += 1) {
      this.continuationEnemyActions[index] = this.deepEnemyActions[index];
      this.continuationEnemyArguments[index] = this.deepEnemyArguments[index];
    }
    this.rootActions = this.continuationOurActions;
    this.rootArguments = this.continuationOurArguments;
    this.rootOurCount = ourCount; this.rootActionCount = ourCount;
    this.rootDomainActive = 0; this.rootDomainRows = null;
    this.rootEnemyActions = this.continuationEnemyActions;
    this.rootEnemyArguments = this.continuationEnemyArguments;
    this.rootEnemyCount = enemyCount;
    this.bestValue = DEPTH_VALUE_MIN;
    const incompleteBefore = this.incompleteTransitions;
    let completedValue = this.heuristic(state);
    for (let iterationDepth = 1; iterationDepth <= targetDepth; iterationDepth += 1) {
      this.lastContinuationAttemptedDepth = iterationDepth;
      if (!this.runIteration(bundle, iterationDepth, before + nodeBudget, 2)) break;
      this.continuationSearchCount += 1;
      this.lastContinuationCompletedDepth = iterationDepth;
      completedValue = this.bestValue;
      this.lastContinuationGeneratedMax = this.iterationGeneratedMax;
      this.lastContinuationTruncatedCount = this.iterationTruncatedCount;
    }
    this.lastContinuationIncompleteTransitions =
      Math.max(0, this.incompleteTransitions - incompleteBefore);
    this.lastContinuationUsable =
      this.lastContinuationCompletedDepth > 0 &&
      this.lastContinuationIncompleteTransitions === 0 ? 1 : 0;
    this.lastContinuationComplete =
      this.lastContinuationUsable && this.lastContinuationCompletedDepth >= targetDepth &&
      this.lastContinuationTruncatedCount === 0 ? 1 : 0;
    this.lastContinuationNodes = Math.max(0, this.nodes - before);
    this.completedDepth = savedCompleted;
    this.attemptedDepth = savedAttempted;
    this.cache = savedCache;
    this.activeRootTransitions = savedRootTransitions;
    return this.lastContinuationCompletedDepth > 0 ? completedValue : this.heuristic(state);
  }
  expandRootDomain() {
    if (!this.rootDomainActive) return 0;
    const localCount = this.rootOurCount; const fullCount = this.rootActionCount;
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    this.rootDomainMask.fill(0, 0, fullCount);
    for (let local = 0; local < localCount; local += 1)
      this.rootDomainMask[this.rootDomainRows[local]] = 1;
    for (let local = localCount - 1; local >= 0; local -= 1) {
      const physical = this.rootDomainRows[local];
      this.rootScore[physical] = this.rootScore[local];
      this.iterationScore[physical] = this.iterationScore[local];
      this.attemptRowLower[physical] = this.attemptRowLower[local];
      this.attemptRowUpper[physical] = this.attemptRowUpper[local];
      for (let column = 0; column < this.rootEnemyCount; column += 1) {
        const source = local * stride + column; const target = physical * stride + column;
        this.rootCellScore[target] = this.rootCellScore[source];
        this.iterationCellScore[target] = this.iterationCellScore[source];
        this.iterationCellComplete[target] = this.iterationCellComplete[source];
        if (this.iterationCellBound)
          this.iterationCellBound[target] = this.iterationCellBound[source];
        this.attemptCellLower[target] = this.attemptCellLower[source];
        this.attemptCellUpper[target] = this.attemptCellUpper[source];
      }
    }
    for (let row = 0; row < fullCount; row += 1) if (!this.rootDomainMask[row]) {
      this.rootScore[row] = DEPTH_VALUE_MIN; this.iterationScore[row] = DEPTH_VALUE_MIN;
      this.attemptRowLower[row] = DEPTH_VALUE_MIN; this.attemptRowUpper[row] = DEPTH_VALUE_MAX;
      for (let column = 0; column < this.rootEnemyCount; column += 1) {
        const cell = row * stride + column;
        this.rootCellScore[cell] = DEPTH_VALUE_MIN;
        this.iterationCellScore[cell] = DEPTH_VALUE_MIN;
        this.iterationCellComplete[cell] = 2;
        if (this.iterationCellBound) this.iterationCellBound[cell] = VALUE_BOUND.EXACT;
        this.attemptCellLower[cell] = DEPTH_VALUE_MIN;
        this.attemptCellUpper[cell] = DEPTH_VALUE_MAX;
      }
    }
    if (this.bestRow < localCount) this.bestRow = this.rootDomainRows[this.bestRow];
    if (this.representativeBestRow < localCount)
      this.representativeBestRow = this.rootDomainRows[this.representativeBestRow];
    if (this.selectiveBestRow < localCount)
      this.selectiveBestRow = this.rootDomainRows[this.selectiveBestRow];
    this.rootOurCount = fullCount; this.rootDomainActive = 0; this.rootDomainRows = null;
    return 1;
  }
  search(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments,
      enemyCount, targetDepth, nodeBudget, baseRisk = 0, workUnitBudget = 0,
      rootDomainRows = null, rootDomainCount = 0) {
    this.rootActions = ourActions; this.rootArguments = ourArguments;
    this.rootActionCount = ourCount;
    this.rootEnemyActions = enemyActions; this.rootEnemyArguments = enemyArguments;
    this.rootEnemyCount = enemyCount; this.resetRoot();
    if (!bundle || !Number.isInteger(ourCount) || !Number.isInteger(enemyCount) ||
        ourCount < 1 || enemyCount < 1 || !Number.isInteger(targetDepth) || targetDepth < 1 ||
        !Number.isInteger(nodeBudget) || nodeBudget < 1) return 0;
    const restricted = rootDomainRows && Number.isInteger(rootDomainCount) &&
      rootDomainCount > 0 && rootDomainCount < ourCount;
    if (restricted) {
      let previous = -1;
      for (let row = 0; row < rootDomainCount; row += 1) {
        const physical = rootDomainRows[row];
        if (!Number.isInteger(physical) || physical <= previous || physical >= ourCount) return 0;
        previous = physical;
      }
      this.rootDomainRows = rootDomainRows; this.rootDomainActive = 1;
      this.rootDomainRestricted = 1; this.rootDomainOriginalCount = ourCount;
      this.rootDomainEvaluatedCount = rootDomainCount; this.rootOurCount = rootDomainCount;
    } else {
      this.rootDomainRows = null; this.rootDomainActive = 0; this.rootOurCount = ourCount;
      this.rootDomainOriginalCount = ourCount; this.rootDomainEvaluatedCount = ourCount;
    }
    const searchedOurCount = this.rootOurCount;
    this.baseRisk = Math.max(0, Math.min(100, baseRisk | 0));
    const state = bundle.state;
    const preparedForRoot = this.crossFramePVPrepared &&
      this.crossFramePVHashLo === state.hashLo && this.crossFramePVHashHi === state.hashHi;
    if (!preparedForRoot && this.rootTransitions && !this.rootTransitions.currentRoot(state))
      this.prepareCrossFramePV(state, this.baseRisk, DEEP_WIDTH);
    let hadSharedEntries = 0;
    if (this.rootTransitions && this.rootTransitions.enabled) {
      this.rootTransitions.prepare(bundle, ourActions, ourArguments,
        this.rootActionCount, enemyActions, enemyArguments, enemyCount);
      hadSharedEntries = this.rootTransitions.deltaUsed > 0 ? 1 : 0;
    }
    this.prepareRootOrder(state);
    const repeatedRoot = targetDepth !== 2 || this.rootImmediateFireContact(bundle.state);
    this.activeRootTransitions = this.rootTransitions && this.rootTransitions.enabled &&
      (hadSharedEntries || repeatedRoot) ? this.rootTransitions : null;
    this.beginWorkMeter(bundle, workUnitBudget);
    const budget = Math.min(nodeBudget, this.diagnosticNodeCapacity);
    const limit = Math.min(targetDepth, SEARCH_CAPACITY.MAX_DECISION_DEPTH);
    const scheduleBudgetEligible = limit >= 2 && budget >= this.directDepthTwoMinBudget;
    let rootStun = 0; let rootFireContact = 0;
    // Preserve the production short circuit. Shadow may inspect every depth-2
    // root, but default search pays no stun/ray probe when the direct schedule
    // is already impossible by target depth or node budget.
    if (limit >= 2 && (scheduleBudgetEligible || this.depthTwoPreflightEnabled)) {
      rootStun = this.rootStunActive(bundle.state);
      if (!rootStun || this.depthTwoPreflightEnabled ||
          this.directDepthTwoDuringStunEnabled)
        rootFireContact = this.rootImmediateFireContact(bundle.state);
    }
    if (this.depthTwoPreflightEnabled && limit >= 2) {
      if (budget < this.directDepthTwoMinBudget)
        this.depthTwoPreflightScheduleBudgetBlocked += 1;
      else if (rootStun) this.depthTwoPreflightScheduleStunBlocked += 1;
      else if (rootFireContact) this.depthTwoPreflightScheduleFireContactBlocked += 1;
      else this.depthTwoPreflightScheduleEligible += 1;
    }
    let directStunRoot = 0;
    if (rootStun && this.directDepthTwoDuringStunEnabled) {
      if (this.rootMatrixNodeCount(bundle.state) <= this.directDepthTwoStunMaxRootNodes)
        directStunRoot = 1;
      else this.directStunSizeBlockedCount += 1;
    }
    if (scheduleBudgetEligible &&
        (!rootStun || directStunRoot) && !rootFireContact) {
      this.lastSchedule = SEARCH_SCHEDULE.DIRECT_DEPTH_TWO;
      if (directStunRoot) this.directStunRootCount += 1;
      // Establish the cheapest full representative certificate first.  P2
      // then consumes the same cumulative budget and replaces P1 only when its
      // own full-width matrix is exact.
      this.attemptedDepth = 1;
      this.depthTwoPreflightActive = this.depthTwoPreflightEnabled;
      const p1Complete = this.runIteration(bundle, 1, budget, DEEP_WIDTH);
      this.depthTwoPreflightActive = 0;
      if (p1Complete) {
        if (directStunRoot) this.directStunP1Completed += 1;
        this.commitIteration(searchedOurCount, 1);
      }
      else { this.restorePublishedBest(); return this.completedDepth; }
      if (this.diagnosticDirectSelectiveDepth && limit > 2) {
        this.preparePublishedOwnerOrder();
        for (let depth = 3; depth <= limit && this.nodes < budget; depth += 1) {
          this.attemptedDepth = depth;
          if (!this.runScheduledIteration(bundle, depth, budget, 2, searchedOurCount)) break;
        }
        this.restorePublishedBest(); this.updateWorkMeter(bundle); return this.completedDepth;
      }
      if (this.depthTwoPreflightEnabled) {
        this.depthTwoPreflightAvailableNodes = Math.max(0, budget - this.nodes);
        this.depthTwoPreflightImpossible = this.depthTwoPreflightProjectedNodes >
          this.depthTwoPreflightAvailableNodes ? 1 : 0;
        this.depthTwoPreflightRootCount += 1;
        this.depthTwoPreflightImpossibleCount += this.depthTwoPreflightImpossible;
        this.depthTwoPreflightStateCountTotal += this.depthTwoPreflightStateCount;
        this.depthTwoPreflightProjectedNodesTotal += this.depthTwoPreflightProjectedNodes;
        this.depthTwoPreflightAvailableNodesTotal += this.depthTwoPreflightAvailableNodes;
      }
      this.preparePublishedOwnerOrder();
      this.attemptedDepth = 2;
      const p2HadExactP1 = this.representativeSupportComplete ? 1 : 0;
      if (this.depthTwoPreflightEnabled) {
        if (p2HadExactP1) this.depthTwoPreflightP2WithExactP1 += 1;
        else this.depthTwoPreflightP2WithoutExactP1 += 1;
      }
      const p2AbortBefore = this.exactOwnerEarlyAbortCount;
      const p2InterruptedBefore = this.interruptedCount;
      const p2WorkInterruptedBefore = this.workInterruptedCount;
      const p2IncompleteBefore = this.incompleteTransitions;
      this.depthTwoPreflightP2FastActive = this.depthTwoPreflightEnabled;
      const p2Complete = this.runIteration(bundle, 2, budget, DEEP_WIDTH, 0,
        this.exactOwnerEarlyAbort && this.representativeSupportComplete ? 1 : 0);
      this.depthTwoPreflightP2FastActive = 0;
      if (this.depthTwoPreflightEnabled) {
        this.depthTwoPreflightP2Attempts += 1;
        const p2Exact = p2Complete && this.iterationTruncatedCount === 0 &&
          this.attemptIntervalStatus === ROOT_INTERVAL_STATUS.COMPLETE;
        if (p2Complete) {
          this.depthTwoPreflightP2Completed += 1;
          if (p2Exact) this.depthTwoPreflightP2ExactCompleted += 1;
          else {
            this.depthTwoPreflightP2CompletedNonExact += 1;
            if (!p2HadExactP1) this.depthTwoPreflightP2NonExactWithoutExactP1 += 1;
          }
        } else if (this.exactOwnerEarlyAbortCount > p2AbortBefore) {
          this.depthTwoPreflightP2SupportAborted += 1;
          if (this.lastNonExactAbortReason === NONEXACT_ABORT_REASON.WIDTH)
            this.depthTwoPreflightP2WidthAborted += 1;
          else if (this.lastNonExactAbortReason === NONEXACT_ABORT_REASON.FAST)
            this.depthTwoPreflightP2FastAborted += 1;
          else if (this.lastNonExactAbortReason === NONEXACT_ABORT_REASON.HARD)
            this.depthTwoPreflightP2HardAborted += 1;
          else this.depthTwoPreflightP2UnclassifiedAborted += 1;
        } else if (this.workInterruptedCount > p2WorkInterruptedBefore ||
            this.interruptedCount > p2InterruptedBefore)
          this.depthTwoPreflightP2BudgetInterrupted += 1;
        else if (this.incompleteTransitions > p2IncompleteBefore)
          this.depthTwoPreflightP2TransitionIncomplete += 1;
        else this.depthTwoPreflightP2OtherFailure += 1;
        if (this.nonExactPrincipalBlockedMask & (1 << NONEXACT_ABORT_REASON.WIDTH))
          this.depthTwoPreflightP2PrincipalBlockedWidth += 1;
        if (this.nonExactPrincipalBlockedMask & (1 << NONEXACT_ABORT_REASON.FAST))
          this.depthTwoPreflightP2PrincipalBlockedFast += 1;
        if (this.nonExactPrincipalBlockedMask & (1 << NONEXACT_ABORT_REASON.HARD))
          this.depthTwoPreflightP2PrincipalBlockedHard += 1;
      }
      if (p2Complete) {
        if (directStunRoot) this.directStunP2Completed += 1;
        this.commitIteration(searchedOurCount, 2);
      } else {
        if (directStunRoot) this.directStunP2Failed += 1;
        this.restorePublishedBest(); return this.completedDepth;
      }
      this.preparePublishedOwnerOrder();
      for (let depth = 3; depth <= limit && this.nodes < budget; depth += 1) {
        this.attemptedDepth = depth;
        if (!this.runScheduledIteration(bundle, depth, budget, 2, searchedOurCount)) break;
      }
      this.restorePublishedBest(); this.updateWorkMeter(bundle); return this.completedDepth;
    }
    for (let depth = 1; depth <= limit && this.nodes < budget; depth += 1) {
      this.attemptedDepth = depth;
      if (!this.runScheduledIteration(bundle, depth, budget, 2, searchedOurCount)) break;
    }
    if (this.completedDepth === limit) {
      for (let width = 3; width <= DEEP_WIDTH && this.nodes < budget; width += 1) {
        this.attemptedDepth = limit;
        if (!this.runIteration(bundle, limit, budget, width)) break;
        this.commitIteration(searchedOurCount, limit);
      }
    }
    this.restorePublishedBest(); this.updateWorkMeter(bundle); return this.completedDepth;
  }
}

module.exports = { DEPTH_VALUE_MIN, DEPTH_VALUE_MAX, DEEP_WIDTH, DIRECT_DEPTH_TWO_MIN_BUDGET,
  DIRECT_STUN_ROOT_NODE_LIMIT, SEARCH_SCHEDULE, ROOT_INTERVAL_STATUS, NONEXACT_ABORT_REASON,
  VALUE_BOUND, ProductionDepthSearch };
