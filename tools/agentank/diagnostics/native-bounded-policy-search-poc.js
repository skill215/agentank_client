"use strict";

// Diagnostic-only bounded policy search. Unlike the strict physical search,
// exhausting a per-root budget settles the remaining branch at the current
// heuristic leaf. The result is therefore policy evidence, never Proof/Hard.
// Every root action receives the same continuation allowance.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { CAPACITY, RULE } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, TERRAIN, SKILL, PHASE,
  NONE_FRAME, DX, DY } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { FastKernel } = require("../../../engine-v2/src/fast/kernel");
const { OPPONENT_EVENT, OPPONENT_CONTEXT } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { HazardKernel } = require("../../../engine-v2/src/fast/hazard");
const { HardGate } = require("../../../engine-v2/src/fast/hard-gate");

const VALUE_MIN = -32000;
const VALUE_MAX = 32000;
const DEEP_WIDTH = 6;
const ACTION_WIDTH = ACTION.BOOST_RIGHT_BOMB + 1;
const DOMAIN_BUCKET_COUNT = 8;
const EXACT_BLOCK = Object.freeze({
  BUDGET: 1,
  FAST_INCOMPLETE: 2,
  HARD_INCOMPLETE: 4,
  DEPTH_LEAF: 8,
  TOP_LEAF: 16,
  POLICY_REJECT_LEAF: 32,
  NO_ACTION_LEAF: 64
});
const EXACT_BLOCK_BUCKETS = 128;
const V1_ENEMY_ROOT_ORDER = Object.freeze([
  ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, ACTION.CAST_STUN
]);
const ROOT_ENEMY_DOMAIN = Object.freeze({
  DROP_PASSIVE: 1,
  QUALIFY_FIRE: 2,
  QUALIFY_MOTION_SKILL: 4
});
const EVENT_QUIESCENCE = Object.freeze({ OFF: "off", PROJECTILE_BOMB:
  "projectile-bomb" });
const CONTINUATION_POLICY = Object.freeze({ BASE: 0, ATTACK_TARGET: 1 });
const ACTION_NAME = Object.freeze(["NONE", "GO", "TURN_LEFT", "TURN_RIGHT",
  "FIRE", "BOMB", "SHIELD", "FREEZE", "STUN", "OVERLOAD", "CLOAK",
  "POISON", "TELEPORT", "BOOST", "BOOST_LEFT_GO", "BOOST_LEFT_TURN_LEFT",
  "BOOST_LEFT_TURN_RIGHT", "BOOST_LEFT_FIRE", "BOOST_LEFT_BOMB",
  "BOOST_RIGHT_GO", "BOOST_RIGHT_TURN_LEFT", "BOOST_RIGHT_TURN_RIGHT",
  "BOOST_RIGHT_FIRE", "BOOST_RIGHT_BOMB"]);
const LEGACY_DIRECTION = Object.freeze({ up: 0, right: 1, down: 2, left: 3 });
const LEGACY_ACTION = Object.freeze({ WAIT: ACTION.NONE, NONE: ACTION.NONE,
  GO: ACTION.GO, LEFT: ACTION.TURN_LEFT, RIGHT: ACTION.TURN_RIGHT,
  FIRE: ACTION.FIRE, BOMB: ACTION.THROW_BOMB,
  SHIELD: ACTION.CAST_SHIELD, FREEZE: ACTION.CAST_FREEZE,
  STUN: ACTION.CAST_STUN, ENEMY_STUN: ACTION.CAST_STUN,
  OVERLOAD: ACTION.CAST_OVERLOAD, CLOAK: ACTION.CAST_CLOAK,
  POISON: ACTION.CAST_POISON, TELEPORT: ACTION.CAST_TELEPORT,
  BOOST: ACTION.CAST_BOOST,
  LEFT_GO: ACTION.BOOST_LEFT_GO,
  LEFT_LEFT: ACTION.BOOST_LEFT_TURN_LEFT,
  LEFT_RIGHT: ACTION.BOOST_LEFT_TURN_RIGHT,
  LEFT_FIRE: ACTION.BOOST_LEFT_FIRE,
  LEFT_BOMB: ACTION.BOOST_LEFT_BOMB,
  RIGHT_GO: ACTION.BOOST_RIGHT_GO,
  RIGHT_LEFT: ACTION.BOOST_RIGHT_TURN_LEFT,
  RIGHT_RIGHT: ACTION.BOOST_RIGHT_TURN_RIGHT,
  RIGHT_FIRE: ACTION.BOOST_RIGHT_FIRE,
  RIGHT_BOMB: ACTION.BOOST_RIGHT_BOMB });

class V1EntryCollisionKernel extends FastKernel {
  advanceProjectiles() {
    const a = this.state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot]) continue;
      const target = a[ARRAY.PROJECTILE_OWNER][slot] ^ 1;
      if (a[ARRAY.PROJECTILE_CELL][slot] !== a[ARRAY.TANK_CELL][target]) continue;
      if (!a[ARRAY.TANK_CRASH][target] &&
          !this.projectileHitTank(slot, target, PHASE.PROJECTILE0, 0)) return 0;
      if (!this.destroyProjectile(slot, 20)) return 0;
    }
    return super.advanceProjectiles();
  }
}

class NativeBoundedPolicySearchPoc {
  constructor(options = {}) {
    this.targetDepth = Math.max(1, Math.min(4,
      Number.isSafeInteger(options.targetDepth) ? options.targetDepth : 3));
    this.depthSchedule = options.depthSchedule === "v1-state" ? "v1-state" : "fixed";
    this.currentDepth = this.targetDepth;
    this.scheduledDepthCount = new Uint32Array(5);
    this.nodeBudget = Math.max(32, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 128));
    this.hardBudgetInterrupt = options.hardBudgetInterrupt === true ? 1 : 0;
    this.iterationBudgetInterrupted = 0;
    this.hardBudgetInterruptCount = 0;
    this.blendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.blendBasisPoints) ?
        options.blendBasisPoints : 2000));
    this.blendSchedule = options.blendSchedule === "star-state" ?
      "star-state" : "fixed";
    this.leadingBlendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.leadingBlendBasisPoints) ?
        options.leadingBlendBasisPoints : 0));
    this.trailingBlendBasisPoints = Math.max(0, Math.min(5000,
      Number.isSafeInteger(options.trailingBlendBasisPoints) ?
        options.trailingBlendBasisPoints : this.blendBasisPoints * 2));
    this.blendScheduleCount = new Uint32Array(3);
    this.fullPrimitiveDomain = options.fullPrimitiveDomain === true;
    this.deepFireMode = options.deepFireMode === "v1-own" ? "v1-own" : "simple";
    this.deepFireDomain = options.deepFireDomain || null;
    this.deepSkillMode = options.deepSkillMode === "own" ? 1 :
      options.deepSkillMode === "enemy" ? 2 :
      options.deepSkillMode === "both" ? 3 : 0;
    this.deepDomainMode = options.deepDomainMode === "v1-shaped" ?
      "v1-shaped" : "primitive";
    this.deepBombMode = options.deepBombMode === "qualified" ?
      "qualified" : "off";
    this.leafEvaluator = options.leafEvaluator || null;
    this.eventQuiescenceMode = options.eventQuiescenceMode ===
      EVENT_QUIESCENCE.PROJECTILE_BOMB ? EVENT_QUIESCENCE.PROJECTILE_BOMB :
      EVENT_QUIESCENCE.OFF;
    this.eventQuiescenceContinuationMode =
      options.eventQuiescenceContinuationMode === "base-policy" ?
        "base-policy" : "full";
    this.eventQuiescenceContinuation =
      options.eventQuiescenceContinuation || null;
    this.ownContinuationMode = options.ownContinuationMode === "base-policy" ?
      "base-policy" : options.ownContinuationMode === "combat-first" ?
        "combat-first" : options.ownContinuationMode === "portfolio" ?
          "portfolio" : options.ownContinuationMode === "root-policy" ?
            "root-policy" : options.ownContinuationMode ===
              "root-policy-direct" ? "root-policy-direct" : "full";
    this.ownContinuation = options.ownContinuation || null;
    this.ownContinuationSecondary = options.ownContinuationSecondary || null;
    this.currentOwnContinuation = this.ownContinuation;
    this.ownContinuationRouteCount = 0;
    this.ownContinuationRouteIncompleteCount = 0;
    this.ownContinuationDomainFallbackCount = 0;
    this.ownContinuationSecondaryRouteCount = 0;
    this.ownContinuationSecondaryIncompleteCount = 0;
    this.ownContinuationPortfolioDedupCount = 0;
    this.ownContinuationPortfolioWidthCount = new Uint32Array(3);
    this.ownContinuationActionCount = new Uint32Array(ACTION_WIDTH);
    this.rootPolicyPrepareCount = 0;
    this.rootPolicyPrimaryIncompleteCount = 0;
    this.rootPolicySecondaryIncompleteCount = 0;
    this.rootPolicySecondaryFilteredCount = 0;
    this.rootPolicyDistinctCount = 0;
    this.rootPolicyPrimaryRowCount = 0;
    this.rootPolicySecondaryRowCount = 0;
    this.eventQuiescenceMaximumPly = Math.max(1, Math.min(3,
      Number.isSafeInteger(options.eventQuiescenceMaximumPly) ?
        options.eventQuiescenceMaximumPly : 3));
    this.eventQuiescenceCheckCount = 0;
    this.eventQuiescenceExpansionCount = 0;
    this.eventQuiescenceQuietLeafCount = 0;
    this.eventQuiescenceCappedLeafCount = 0;
    this.eventQuiescenceProjectileLeafCount = 0;
    this.eventQuiescenceBombLeafCount = 0;
    this.eventQuiescenceExpansionByPly = new Uint32Array(4);
    this.eventQuiescenceRoutingTop = -1;
    this.eventQuiescenceRoutedAction = ACTION.NONE;
    this.eventQuiescencePolicyRouteCount = 0;
    this.eventQuiescencePolicyRouteIncompleteCount = 0;
    this.eventQuiescencePolicyDomainMissCount = 0;
    this.pathUtility = options.pathUtility || null;
    this.pathEvidenceMode = options.pathEvidenceMode === "split-nominal" ?
      "split-nominal" : "single";
    this.historyEvaluator = options.historyEvaluator || null;
    this.superkoMode = options.superkoMode === "v1" ? "v1" : "off";
    this.collectTerminalTrade = options.collectTerminalTrade === true;
    this.opponentMode = options.opponentMode === "v1-exact" ? "v1-exact" :
      options.opponentWeighted === true ? "v2-weighted" : "uniform";
    this.opponentWeighted = this.opponentMode !== "uniform";
    this.currentBlendBasisPoints = this.blendBasisPoints;
    this.oracleOpponentReady = 0;
    this.oracleOpponentCounts = new Uint32Array(4);
    this.oracleOpponentObservations = 0; this.oracleOpponentGoStreak = 0;
    this.oracleEnemyStationaryStreak = 0;
    this.v1StunCountdown = options.v1StunCountdown === true;
    this.v1EntryProjectileCollision = options.v1EntryProjectileCollision === true;
    this.deepHardMode = options.deepHardMode === "terminal-only" ? "terminal-only" :
      options.deepHardMode === "proof-only" ? "proof-only" : "full";
    this.rootDomainMode = options.rootDomainMode === "v1-actions" ?
      "v1-actions" : options.rootDomainMode === "v1-shaped" ? "v1-shaped" :
      options.rootDomainMode === "primitive" ? "primitive" : "all";
    // Diagnostic-only extra root. It is evaluated with the same per-root
    // allowance as the frozen V1-shaped domain, but does not reduce the
    // allowance of the original roots. This lets a resource proposal be
    // audited without changing the incumbent action values in Shadow mode.
    this.rootExtraPoison = options.rootExtraPoison === true;
    this.terminalMode = options.terminalMode === "v1" ? "v1" : "platform";
    this.ownChanceMode = options.ownChanceMode === "v1-deterministic" ?
      "v1-deterministic" : options.ownChanceMode === "worst" ?
        "worst" : "expected";
    switch (options.rootEnemyDomainMode) {
      case "v1-shaped":
      case "tactical":
      case "drop-passive":
      case "qualify-fire":
      case "qualify-motion-skill":
      case "drop-passive-fire":
      case "drop-passive-motion-skill":
      case "qualify-fire-motion-skill":
        this.rootEnemyDomainMode = options.rootEnemyDomainMode; break;
      default: this.rootEnemyDomainMode = "all";
    }
    this.rootEnemyDomainFlags = this.rootEnemyDomainMode === "tactical" ||
      this.rootEnemyDomainMode === "v1-shaped" ? 7 :
      (this.rootEnemyDomainMode.includes("drop-passive") ?
        ROOT_ENEMY_DOMAIN.DROP_PASSIVE : 0) |
      (this.rootEnemyDomainMode.includes("qualify-fire") ?
        ROOT_ENEMY_DOMAIN.QUALIFY_FIRE : 0) |
      (this.rootEnemyDomainMode.includes("motion-skill") ?
        ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL : 0);
    this.rootColumnOrder = options.rootColumnOrder === "reverse" ? "reverse" :
      options.rootColumnOrder === "v1" ? "v1" : "forward";
    this.rootBudgetMode = options.rootBudgetMode === "cell-equal" ?
      "cell-equal" : "row-shared";
    this.oracleRootActionMask = new Uint8Array(ACTION_WIDTH);
    this.oracleRootActionReady = 0;
    this.deepOurActions = new Uint8Array(5 * DEEP_WIDTH);
    this.deepOurArguments = new Uint16Array(5 * DEEP_WIDTH);
    this.deepEnemyActions = new Uint8Array(5 * DEEP_WIDTH);
    this.deepEnemyArguments = new Uint16Array(5 * DEEP_WIDTH);
    this.deepOurCount = new Uint8Array(5);
    this.deepEnemyCount = new Uint8Array(5);
    this.rootScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootNominalScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootNominalCellScore = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.lastNominalValue = VALUE_MIN;
    // One fixed slot for a diagnostic action that is deliberately absent from
    // the production root domain.  Resource ownership experiments can compare
    // this row against an already-searched incumbent without inserting the
    // action into ProductionRoot.ourActions or rebuilding production slabs.
    this.syntheticRootCellScore = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.syntheticRootCellScore.fill(VALUE_MIN);
    this.syntheticRootAction = ACTION.NONE;
    this.syntheticRootArgument = 0xffff;
    this.syntheticRootValue = VALUE_MIN;
    this.syntheticRootWorst = VALUE_MIN;
    this.syntheticRootSupportCount = 0;
    this.syntheticRootEvaluationCount = 0;
    this.syntheticRootCompleteCount = 0;
    this.syntheticRootIncompleteCount = 0;
    this.syntheticRootNodeCount = 0;
    this.syntheticRootMaximumNodes = 0;
    this.syntheticRootRestoreFailureCount = 0;
    // Paired, deadline-bounded resource policy audit.  Both policies use the
    // same enemy root columns and the same receding continuation generator.
    // A completed cell has a collapsed [lower, upper] interval.  Any budget or
    // transition incompleteness leaves the interval open and cannot own an
    // action.
    this.resourceBaseCellLower = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.resourceBaseCellUpper = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.resourceCandidateCellLower = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.resourceCandidateCellUpper = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.resourceBaseCellLower.fill(VALUE_MIN);
    this.resourceBaseCellUpper.fill(VALUE_MAX);
    this.resourceCandidateCellLower.fill(VALUE_MIN);
    this.resourceCandidateCellUpper.fill(VALUE_MAX);
    this.resourceOptionEvaluationCount = 0;
    this.resourceOptionCompleteCount = 0;
    this.resourceOptionIncompleteCount = 0;
    this.resourceOptionBudgetIncompleteCount = 0;
    this.resourceOptionNodeCount = 0;
    this.resourceOptionMaximumNodes = 0;
    this.resourceOptionRestoreFailureCount = 0;
    this.resourceOptionBaseWorst = VALUE_MIN;
    this.resourceOptionCandidateWorst = VALUE_MIN;
    this.resourceOptionBaseValue = VALUE_MIN;
    this.resourceOptionCandidateValue = VALUE_MIN;
    this.resourceOptionDepth = 0;
    this.resourceOptionNodeBudget = 0;
    this.resourceOptionFeedbackMode = "representative";
    // BP18 paired continuation-policy audit.  This shares the exact same
    // FastState, root enemy columns, transition kernel, Hard classifier, leaf
    // and backup.  Only later own-node action generation changes.  The result
    // is finite-horizon evidence and is never an action/Proof/Hard owner.
    this.policyEnvelopeBaseCellLower = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.policyEnvelopeBaseCellUpper = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.policyEnvelopeCandidateCellLower = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.policyEnvelopeCandidateCellUpper = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.policyEnvelopeCandidateEventComplete = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.policyEnvelopeBaseCellLower.fill(VALUE_MIN);
    this.policyEnvelopeBaseCellUpper.fill(VALUE_MAX);
    this.policyEnvelopeCandidateCellLower.fill(VALUE_MIN);
    this.policyEnvelopeCandidateCellUpper.fill(VALUE_MAX);
    this.policyEnvelopeCandidateEventComplete.fill(0);
    this.policyEnvelopeEvaluationCount = 0;
    this.policyEnvelopeCompleteCount = 0;
    this.policyEnvelopeIncompleteCount = 0;
    this.policyEnvelopeBudgetIncompleteCount = 0;
    this.policyEnvelopeContinuationIncompleteCount = 0;
    this.policyEnvelopeRescueFallbackCount = 0;
    this.policyEnvelopeAbortFallbackCount = 0;
    this.policyEnvelopeCompletionFallbackCount = 0;
    this.policyEnvelopeInjectedActionCount = 0;
    this.policyEnvelopeNodeCount = 0;
    this.policyEnvelopeMaximumNodes = 0;
    this.policyEnvelopeRestoreFailureCount = 0;
    this.policyEnvelopePreparedBaseReuseCount = 0;
    this.policyEnvelopePreparedBaseBlockedCount = 0;
    this.policyEnvelopePreparedBaseDepthMismatchCount = 0;
    this.policyEnvelopePreparedBaseDomainMissingCount = 0;
    this.policyEnvelopePreparedBaseBlockMaskCount = new Uint32Array(
      EXACT_BLOCK_BUCKETS);
    this.policyEnvelopeEventLeafCount = 0;
    this.policyEnvelopeNoEventLeafCount = 0;
    this.policyEnvelopeAbortLeafCount = 0;
    this.policyEnvelopeRescueLeafCount = 0;
    this.policyEnvelopeEventCompleteColumnCount = 0;
    this.policyEnvelopeEventIncompleteColumnCount = 0;
    this.policyEnvelopeBaseWorst = VALUE_MIN;
    this.policyEnvelopeCandidateWorst = VALUE_MIN;
    this.policyEnvelopeBaseValue = VALUE_MIN;
    this.policyEnvelopeCandidateValue = VALUE_MIN;
    this.policyEnvelopeDepth = 0;
    this.policyEnvelopeNodeBudget = 0;
    this.policyEnvelopePolicyId = CONTINUATION_POLICY.BASE;
    this.policyEnvelopeTargetSignature = 0;
    this.currentContinuationPolicy = CONTINUATION_POLICY.BASE;
    this.currentContinuationGenerator = null;
    this.currentContinuationIncomplete = 0;
    this.currentPolicyEnvelopeEventLeafCount = 0;
    this.currentPolicyEnvelopeNoEventLeafCount = 0;
    this.currentPolicyEnvelopeAbortLeafCount = 0;
    this.currentPolicyEnvelopeRescueLeafCount = 0;
    this.rootTradeClass = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.currentRootMatrixIndex = -1;
    this.pairedTerminalSelectedWorst = VALUE_MIN;
    this.pairedTerminalBaseWorst = VALUE_MIN;
    this.pairedTerminalAuditCount = 0;
    this.pairedTerminalNodeCount = 0;
    this.pairedTerminalMaximumNodes = 0;
    this.pairedTerminalRestoreFailures = 0;
    this.pairedTerminalIncompleteCount = 0;
    this.rootDomainMask = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rootDomainOracleCompareCount = 0; this.rootDomainOracleBothCount = 0;
    this.rootDomainNativeOnlyCount = 0; this.rootDomainOracleOnlyCount = 0;
    this.rootEnemyDomainMask = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootColumnSequence = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.rootColumnUsed = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.pathAction = new Uint8Array(5);
    this.pathTurnStreak = new Uint8Array(5);
    this.pathPolicyEvent = new Uint8Array(5);
    this.pathPolicyAbort = new Uint8Array(5);
    this.pathPolicyRescue = new Uint8Array(5);
    this.policyEnvelopeAbortNode = new Uint8Array(5);
    this.policyEnvelopeRescueNode = new Uint8Array(5);
    this.pathPoseKey = new Uint16Array(5);
    this.pathRepeatLastPenalty = new Uint16Array(5);
    this.pathRepeatCumulative = new Uint16Array(5);
    this.pathRepeatReference = new Int32Array(5);
    this.rootHistoryKey = new Uint16Array(8);
    this.rootHistoryEpoch = new Uint16Array(8);
    this.rootHistoryValue = new Int32Array(8);
    this.rootHistoryCursor = 0; this.rootHistoryCount = 0;
    this.lastObservedHistoryFrame = -1; this.historyContextEpoch = 0;
    this.superkoCheckCount = 0; this.superkoPenaltyCount = 0;
    this.superkoPenaltyTotal = 0; this.superkoPathMatchCount = 0;
    this.superkoRootMatchCount = 0; this.superkoReliefCount = 0;
    this.rootDomainRestricted = 0;
    this.externalRootRestrictionCount = 0;
    this.externalRootRestrictedRowCount = 0;
    this.preparedRootCount = 0;
    this.completedDepth = 0;
    this.representativeSupportDepth = 0;
    this.representativeSupportComplete = 0;
    this.lastOwnershipSupportComplete = 0;
    this.lastValueExact = 0;
    this.lastBudgetLeafCount = 0;
    this.lastFastIncompleteCount = 0;
    this.lastHardIncompleteCount = 0;
    this.lastDepthLeafCount = 0; this.lastTopLeafCount = 0;
    this.lastPolicyRejectCount = 0; this.lastNoActionLeafCount = 0;
    this.lastExactBlockMask = 0;
    this.rowExactBlockMask = new Uint8Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowExactBlockMask.fill(127);
    this.rowExactBlockMaskCount = new Uint32Array(EXACT_BLOCK_BUCKETS);
    this.lastExactRowCount = 0; this.exactRowCount = 0;
    this.blockedRowCount = 0;
    this.exactBlockMaskCount = new Uint32Array(EXACT_BLOCK_BUCKETS);
    this.exactBlockedRootCount = 0;
    this.budgetCompleteHeuristicRootCount = 0;
    this.depthOnlyHeuristicRootCount = 0;
    this.noActionLeafCount = 0; this.exactOwnershipRootCount = 0;
    this.strictOwnershipRootCount = 0;
    this.heuristicOwnershipRootCount = 0;
    this.approximate = 1;
    this.prepareCount = 0; this.completeCount = 0;
    this.rootCount = 0; this.nodes = 0; this.totalNodes = 0;
    this.maximumNodes = 0; this.leafBudgetCount = 0;
    this.fastIncompleteCount = 0; this.hardIncompleteCount = 0;
    this.hardAllowCount = 0; this.hardRejectProvenCount = 0;
    this.hardRejectPolicyCount = 0;
    this.terminalCount = 0; this.rootRestoreFailureCount = 0;
    this.recordTerminalCount = 0; this.combatTerminalCount = 0;
    this.mutualCombatTerminalCount = 0;
    this.policyNodeDepthCount = new Uint32Array(5);
    this.depthLeafCount = 0; this.topLeafCount = 0;
    this.ownExpansionCount = 0; this.enemyExpansionCount = 0;
    this.jointTransitionCount = 0; this.chanceOutcomeCount = 0;
    this.v1OwnChanceCheckCount = 0; this.v1OwnReversedCount = 0;
    this.invocationCompareCount = 0; this.invocationBothCount = 0;
    this.invocationNativeOnlyCount = 0; this.invocationOracleOnlyCount = 0;
    this.invocationNeitherCount = 0;
    this.invocationNativeOnlyByResult = new Uint32Array(6);
    this.invocationOracleOnlyByResult = new Uint32Array(6);
    this.deepActionCount = new Uint32Array(ACTION_WIDTH * 2);
    this.oracleRecursionRootCount = 0; this.oracleRecursionNodeCount = 0;
    this.oracleRecursionRootActionCount = 0;
    this.oracleRecursionRootEnemyActionCount = 0;
    this.oracleRecursionDepthLeafCount = 0;
    this.oracleRecursionBudgetLeafCount = 0;
    this.oracleRecursionTerminalLeafCount = 0;
    this.oracleRecursionOwnExpansionCount = 0;
    this.oracleRecursionEnemyExpansionCount = 0;
    this.oracleRecursionTransitionCount = 0;
    this.oracleRecursionOutcomeCount = 0;
    this.oracleRecursionActionCount = new Uint32Array(ACTION_WIDTH * 2);
    this.nativeRootActionCount = new Uint32Array(ACTION_WIDTH * 2);
    this.oracleRootEnemyActionCount = new Uint32Array(ACTION_WIDTH);
    // Ordered action-domain differential. Buckets are ply*2+seat: root uses
    // 0/1 and sampled deep plies use 4/5 and 6/7. Set equality and order
    // equality are separate because V1 keeps the first action on value ties.
    this.domainCompareCount = new Uint32Array(DOMAIN_BUCKET_COUNT);
    this.domainSetAgreementCount = new Uint32Array(DOMAIN_BUCKET_COUNT);
    this.domainOrderAgreementCount = new Uint32Array(DOMAIN_BUCKET_COUNT);
    this.domainNativeOnlyActionCount = new Uint32Array(
      DOMAIN_BUCKET_COUNT * ACTION_WIDTH);
    this.domainOracleOnlyActionCount = new Uint32Array(
      DOMAIN_BUCKET_COUNT * ACTION_WIDTH);
    this.domainNativeMask = new Uint8Array(ACTION_WIDTH);
    this.domainOracleMask = new Uint8Array(ACTION_WIDTH);
    // The native V1-shaped audit domain is independent from ProductionRoot's
    // candidate rows. This is essential for comparing skill/NONE semantics
    // without installing a diagnostic emitter that changes the played tank.
    this.auditRootOwnActions = new Uint8Array(ACTION_WIDTH);
    this.auditRootEnemyActions = new Uint8Array(ACTION_WIDTH);
    this.auditRootOwnCount = 0; this.auditRootEnemyCount = 0;
    this.weightedReplyCount = 0;
    this.deepOwnSkillCount = 0; this.deepEnemySkillCount = 0;
    this.deepV1FireCheckCount = 0;
    this.transitionCensusRootCount = 0; this.transitionComparedCount = 0;
    this.transitionRootSnapshotCount = 0; this.transitionRootAnyMismatchCount = 0;
    this.transitionRootFrameMismatchCount = 0; this.transitionRootPoseMismatchCount = 0;
    this.transitionRootDirectionMismatchCount = 0; this.transitionRootStarMismatchCount = 0;
    this.transitionRootCrashMismatchCount = 0;
    this.transitionRootProjectileMismatchCount = 0; this.transitionRootBombMismatchCount = 0;
    this.transitionRootTerrainMismatchCount = 0; this.transitionRootStatusMismatchCount = 0;
    this.transitionSkippedRootMismatchCount = 0;
    this.transitionUnsupportedCount = 0; this.transitionMissingActionCount = 0;
    this.transitionAnyMismatchCount = 0; this.transitionFrameMismatchCount = 0;
    this.transitionPoseMismatchCount = 0; this.transitionDirectionMismatchCount = 0;
    this.transitionStarMismatchCount = 0; this.transitionCrashMismatchCount = 0;
    this.transitionProjectileMismatchCount = 0; this.transitionBombMismatchCount = 0;
    this.transitionTerrainMismatchCount = 0; this.transitionStatusMismatchCount = 0;
    this.transitionLeafSignedDifference = 0; this.transitionLeafAbsDifference = 0;
    this.transitionStatusFieldMismatch = new Uint32Array(14);
    this.transitionRootStatusFieldMismatch = new Uint32Array(14);
    this.transitionPairCompared = new Uint32Array(ACTION_WIDTH * ACTION_WIDTH);
    this.transitionPairMismatch = new Uint32Array(ACTION_WIDTH * ACTION_WIDTH);
    // BP9 keeps one root-local attribution slab.  The cumulative transition
    // census can prove that the two engines differ somewhere, but cannot say
    // whether the qualified FIRE row or its selected competitor owns that
    // difference.  These arrays are reset before every comparison and never
    // participate in search or selection.
    this.lastTransitionPairCompared = new Uint16Array(
      ACTION_WIDTH * ACTION_WIDTH);
    this.lastTransitionPairMismatch = new Uint16Array(
      ACTION_WIDTH * ACTION_WIDTH);
    this.lastTransitionOwnCompared = new Uint16Array(ACTION_WIDTH);
    this.lastTransitionOwnMismatch = new Uint16Array(ACTION_WIDTH);
    this.lastTransitionOwnUnsupported = new Uint16Array(ACTION_WIDTH);
    this.lastTransitionOwnExactLeafCount = new Uint16Array(ACTION_WIDTH);
    this.lastTransitionOwnComponentSignedDifference = new Int32Array(
      ACTION_WIDTH * 8);
    this.lastTransitionOwnComponentAbsDifference = new Uint32Array(
      ACTION_WIDTH * 8);
    this.transitionExactLeafCount = 0;
    this.transitionExactComponentSignedDifference = new Int32Array(8);
    this.transitionExactComponentAbsDifference = new Uint32Array(8);
    this.deepTransitionComparedByPly = new Uint32Array(4);
    this.deepTransitionUnsupportedByPly = new Uint32Array(4);
    this.deepTransitionAnyMismatchByPly = new Uint32Array(4);
    this.deepTransitionFieldMismatchByPly = new Uint32Array(4 * 9);
    this.deepExactLeafCountByPly = new Uint32Array(4);
    this.deepLeafSignedDifferenceByPly = new Int32Array(4);
    this.deepLeafAbsDifferenceByPly = new Uint32Array(4);
    this.deepExactComponentSignedDifferenceByPly = new Int32Array(4 * 8);
    this.deepExactComponentAbsDifferenceByPly = new Uint32Array(4 * 8);
    this.lastDeepRootCompared = new Uint16Array(ACTION_WIDTH);
    this.lastDeepRootMismatch = new Uint16Array(ACTION_WIDTH);
    this.lastDeepRootUnsupported = new Uint16Array(ACTION_WIDTH);
    this.lastDeepRootExactLeafCount = new Uint16Array(ACTION_WIDTH);
    this.lastDeepRootComponentSignedDifference = new Int32Array(
      ACTION_WIDTH * 8);
    this.lastDeepRootComponentAbsDifference = new Uint32Array(
      ACTION_WIDTH * 8);
    this.lastOneStepRootComparable = 0;
    this.lastOneStepComparedCount = 0;
    this.lastOneStepMismatchCount = 0;
    this.lastOneStepUnsupportedCount = 0;
    this.lastOneStepMissingActionCount = 0;
    this.lastDeepTransitionComparedCount = 0;
    this.lastDeepTransitionMismatchCount = 0;
    this.lastDeepTransitionUnsupportedCount = 0;
    this.lastSearchOwnDomainResult = 0;
    this.lastSearchEnemyDomainResult = 0;
    this.rootValueAuditCount = 0;
    this.rootValueDomainExactCount = 0;
    this.rootValueTransitionExactCount = 0;
    this.rootValueStrictCount = 0;
    this.rootValueCommonActionCount = new Uint32Array(3);
    this.rootValuePairComparedCount = new Uint32Array(3);
    this.rootValuePairOrderAgreementCount = new Uint32Array(3);
    this.rootValueBestComparedCount = new Uint32Array(3);
    this.rootValueBestAgreementCount = new Uint32Array(3);
    this.diagnosticState = null; this.diagnosticKernel = null;
    this.diagnosticHazard = null;
    this.diagnosticHard = null; this.isolationAllocationCount = 0;
    this.hotAllocationCount = 0;
  }

  leafComponentsAvailable() {
    const components = this.leafEvaluator && this.leafEvaluator.lastComponents;
    return components && components.length >= 6 ? 1 : 0;
  }

  compareInvocation(nativeExecuted, oracleExecuted, nativeResult = 5) {
    this.invocationCompareCount += 1;
    if (nativeExecuted && oracleExecuted) this.invocationBothCount += 1;
    else if (nativeExecuted) {
      this.invocationNativeOnlyCount += 1;
      const reason = Math.max(0, Math.min(5, nativeResult | 0));
      this.invocationNativeOnlyByResult[reason] += 1;
    } else if (oracleExecuted) {
      this.invocationOracleOnlyCount += 1;
      const reason = Math.max(0, Math.min(5, nativeResult | 0));
      this.invocationOracleOnlyByResult[reason] += 1;
    }
    else this.invocationNeitherCount += 1;
  }

  bindIsolatedHard(bundle) {
    if (this.diagnosticState === bundle.state && this.diagnosticHard) return;
    this.diagnosticState = bundle.state;
    const Kernel = this.v1EntryProjectileCollision ?
      V1EntryCollisionKernel : FastKernel;
    this.diagnosticKernel = new Kernel(bundle.state, {
      stationaryOccupiedBlock: Boolean(bundle.kernel.stationaryOccupiedBlockEnabled)
    });
    this.diagnosticHazard = new HazardKernel(bundle.state, {
      reverseViabilityCacheEntries: 16,
      reverseLatticeCacheEntries: 4,
      reverseLatticeIncludesOwnProjectiles: true,
      reverseLatticeLayerCache: false,
      hazardSignatureCache: true
    });
    this.diagnosticHard = new HardGate(this.diagnosticKernel,
      this.diagnosticHazard, 0);
    this.isolationAllocationCount += 1;
  }

  poseKey(state) {
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    return ((state.x(cell) * 64 + state.y(cell)) * 4 +
      a[ARRAY.TANK_DIR][0]) & 0xffff;
  }

  observeRoot(engine, contextEpoch = 0) {
    if (this.superkoMode !== "v1" || !engine.adapter?.state) return;
    const state = engine.adapter.state;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame === this.lastObservedHistoryFrame) return;
    this.lastObservedHistoryFrame = frame;
    this.historyContextEpoch = contextEpoch & 0xffff;
    const at = this.rootHistoryCursor;
    this.rootHistoryKey[at] = this.poseKey(state);
    this.rootHistoryEpoch[at] = this.historyContextEpoch;
    if (this.leafEvaluator && typeof this.leafEvaluator.beginRoot === "function")
      this.leafEvaluator.beginRoot(state);
    this.rootHistoryValue[at] = this.leafEvaluator ?
      this.leafEvaluator.evaluate(state) : 0;
    this.rootHistoryCursor = (at + 1) & 7;
    if (this.rootHistoryCount < 8) this.rootHistoryCount += 1;
  }

  repetitionPenalty(distance) {
    return distance === 2 ? 240 : distance === 3 ? 170 :
      distance === 4 ? 120 : distance >= 5 && distance <= 8 ? 60 : 0;
  }

  superkoPenalty(state, top) {
    if (this.superkoMode !== "v1") return 0;
    this.superkoCheckCount += 1;
    const key = this.poseKey(state); let penalty = 0;
    let reference = -2147483648;
    if (top >= 3 && this.pathPoseKey[top - 2] === key) {
      penalty = 240; this.superkoPathMatchCount += 1;
    } else if (top >= 4 && this.pathPoseKey[top - 3] === key) {
      penalty = 170; this.superkoPathMatchCount += 1;
    } else for (let offset = 0; offset < this.rootHistoryCount; offset += 1) {
      const distance = top + offset;
      if (distance > 8) break;
      let index = this.rootHistoryCursor - 1 - offset;
      if (index < 0) index += 8;
      if (this.rootHistoryKey[index] !== key) continue;
      penalty = this.repetitionPenalty(distance);
      if (penalty && this.rootHistoryEpoch[index] !== this.historyContextEpoch)
        penalty >>= 1;
      if (penalty) {
        this.superkoRootMatchCount += 1;
        reference = this.rootHistoryValue[index];
      }
      break;
    }
    this.pathPoseKey[top] = key;
    this.pathRepeatLastPenalty[top] = penalty;
    this.pathRepeatCumulative[top] =
      (top > 1 ? this.pathRepeatCumulative[top - 1] : 0) + penalty;
    this.pathRepeatReference[top] = reference;
    if (penalty) {
      this.superkoPenaltyCount += 1; this.superkoPenaltyTotal += penalty;
    }
    return penalty;
  }

  extendV1StunCountdown(state, action0, action1, beforeFrame) {
    if (!this.v1StunCountdown ||
        state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== beforeFrame + 1) return;
    const a = state.arrays;
    if (action0 === ACTION.CAST_STUN && a[ARRAY.TANK_SKILL][0] === SKILL.STUN &&
        a[ARRAY.TANK_SKILL_READY][0] > beforeFrame &&
        a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME)
      state.write(ARRAY.TANK_STUN_UNTIL, 1, a[ARRAY.TANK_STUN_UNTIL][1] + 1);
    if (action1 === ACTION.CAST_STUN && a[ARRAY.TANK_SKILL][1] === SKILL.STUN &&
        a[ARRAY.TANK_SKILL_READY][1] > beforeFrame &&
        a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME)
      state.write(ARRAY.TANK_STUN_UNTIL, 0, a[ARRAY.TANK_STUN_UNTIL][0] + 1);
  }

  remaining(state, arrayId, seat) {
    const until = state.arrays[arrayId][seat];
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    return until === NONE_FRAME || until <= frame ? 0 : until - frame;
  }

  legacyAction(token) {
    return Object.prototype.hasOwnProperty.call(LEGACY_ACTION, token) ?
      LEGACY_ACTION[token] : -1;
  }

  setOracleRootActions(evaluated) {
    this.oracleRootActionMask.fill(0);
    this.oracleRootActionReady = Array.isArray(evaluated) ? 1 : 0;
    if (!this.oracleRootActionReady) return;
    for (let index = 0; index < evaluated.length; index += 1) {
      const action = this.legacyAction(evaluated[index]?.action);
      if (action >= 0) this.oracleRootActionMask[action] = 1;
    }
  }

  compareOrderedDomain(nativeActions, offset, count, oracleActions, bucket,
      include = null, oracleEntries = false) {
    if (!Array.isArray(oracleActions) || bucket < 0 ||
        bucket >= DOMAIN_BUCKET_COUNT) return 0;
    const nativeMask = this.domainNativeMask;
    const oracleMask = this.domainOracleMask;
    nativeMask.fill(0); oracleMask.fill(0);
    let nativeCount = 0;
    for (let index = 0; index < count; index += 1) {
      if (include && !include[index]) continue;
      const action = nativeActions[offset + index];
      if (action >= 0 && action < ACTION_WIDTH) nativeMask[action] = 1;
      nativeCount += 1;
    }
    for (let index = 0; index < oracleActions.length; index += 1) {
      const token = oracleEntries ? oracleActions[index]?.action : oracleActions[index];
      const action = this.legacyAction(token);
      if (action >= 0) oracleMask[action] = 1;
    }
    let setEqual = 1;
    const base = bucket * ACTION_WIDTH;
    for (let action = 0; action < ACTION_WIDTH; action += 1) {
      if (nativeMask[action] === oracleMask[action]) continue;
      setEqual = 0;
      if (nativeMask[action]) this.domainNativeOnlyActionCount[base + action] += 1;
      else this.domainOracleOnlyActionCount[base + action] += 1;
    }
    let orderEqual = nativeCount === oracleActions.length ? 1 : 0;
    if (orderEqual) {
      let nativeIndex = 0;
      for (let oracleIndex = 0; oracleIndex < oracleActions.length;
          oracleIndex += 1) {
        while (include && nativeIndex < count && !include[nativeIndex])
          nativeIndex += 1;
        if (nativeIndex >= count ||
            nativeActions[offset + nativeIndex] !==
              this.legacyAction(oracleEntries ? oracleActions[oracleIndex]?.action :
                oracleActions[oracleIndex])) {
          orderEqual = 0; break;
        }
        nativeIndex += 1;
      }
    }
    this.domainCompareCount[bucket] += 1;
    this.domainSetAgreementCount[bucket] += setEqual;
    this.domainOrderAgreementCount[bucket] += orderEqual;
    return setEqual | (orderEqual << 1);
  }

  compareRootActionDomains(engine, evaluated, recursion) {
    this.lastSearchOwnDomainResult = 0;
    this.lastSearchEnemyDomainResult = 0;
    if (!engine || !Array.isArray(evaluated)) return;
    const ownInclude = this.rootDomainRestricted ? this.rootDomainMask : null;
    this.lastSearchOwnDomainResult = this.compareOrderedDomain(
      engine.ourActions, 0, this.preparedRootCount,
      evaluated, 0, ownInclude, true);
    if (Array.isArray(recursion?.rootEnemyActions))
      this.lastSearchEnemyDomainResult = this.compareOrderedDomain(
        engine.enemyActions, 0, engine.enemyCount,
        recursion.rootEnemyActions, 1, this.rootEnemyDomainMask);
    if (this.deepDomainMode !== "v1-shaped") return;
    this.generateAuditRootDomain(engine, 0);
    this.compareOrderedDomain(this.auditRootOwnActions, 0,
      this.auditRootOwnCount, evaluated, 2, null, true);
    if (Array.isArray(recursion?.rootEnemyActions)) {
      this.generateAuditRootDomain(engine, 1);
      this.compareOrderedDomain(this.auditRootEnemyActions, 0,
        this.auditRootEnemyCount, recursion.rootEnemyActions, 3);
    }
  }

  pushAuditRoot(seat, action) {
    const actions = seat ? this.auditRootEnemyActions : this.auditRootOwnActions;
    const count = seat ? this.auditRootEnemyCount : this.auditRootOwnCount;
    if (count >= actions.length) return;
    actions[count] = action;
    if (seat) this.auditRootEnemyCount = count + 1;
    else this.auditRootOwnCount = count + 1;
  }

  generateAuditRootDomain(engine, seat) {
    if (seat) this.auditRootEnemyCount = 0;
    else this.auditRootOwnCount = 0;
    const adapter = engine.adapter; const state = adapter.state; const a = state.arrays;
    const canAct = seat ? adapter.enemyCanAct : adapter.ownCanAct;
    if (!canAct) { this.pushAuditRoot(seat, ACTION.NONE); return; }
    const cell = a[ARRAY.TANK_CELL][seat]; const other = a[ARRAY.TANK_CELL][seat ^ 1];
    const direction = a[ARRAY.TANK_DIR][seat];
    const next = engine.depthSearch.target(state, cell, direction);
    if (engine.depthSearch.walkable(state, next) && next !== other)
      this.pushAuditRoot(seat, ACTION.GO);
    const motion = seat ? 10000 : this.v1EnemyMotionBasisPoints();
    const fire = this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
      this.deepFireDomain.qualifiedFireForSeat(state, seat, motion) :
      this.usefulFire(state, seat);
    if (fire) this.pushAuditRoot(seat, ACTION.FIRE);
    if (!seat && this.v1ShapedStun(state, 0))
      this.pushAuditRoot(0, ACTION.CAST_STUN);
    if (!seat && adapter.ownBombReady && this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedBomb === "function" &&
        this.deepFireDomain.qualifiedBomb(state))
      this.pushAuditRoot(0, ACTION.THROW_BOMB);
    this.pushAuditRoot(seat, ACTION.TURN_LEFT);
    this.pushAuditRoot(seat, ACTION.TURN_RIGHT);
    // V1 appends the opponent skill after ordinary turns. The current fixed
    // cohort is symmetric stun, but the ordering contract matters on ties.
    if (seat && adapter.enemySkillReady &&
        a[ARRAY.TANK_SKILL][1] === SKILL.STUN && this.v1ShapedStun(state, 1))
      this.pushAuditRoot(1, ACTION.CAST_STUN);
  }

  rootV1ShapedAllowed(engine, action) {
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const frozen = a[ARRAY.TANK_FROZEN_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_FROZEN_UNTIL][0] > frame;
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][0];
    const poisonApplied = a[ARRAY.TANK_POISON_APPLIED][0];
    const poisonHold = poisonUntil !== NONE_FRAME && poisonUntil > frame &&
      poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0;
    if (frozen || poisonHold)
      return action === ACTION.NONE ? 1 : 0;
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 1;
    if (action === ACTION.GO) {
      const cell = a[ARRAY.TANK_CELL][0]; const direction = a[ARRAY.TANK_DIR][0];
      const next = engine.depthSearch.target(state, cell, direction);
      return engine.depthSearch.walkable(state, next) &&
        next !== a[ARRAY.TANK_CELL][1] ? 1 : 0;
    }
    if (action === ACTION.FIRE)
      return this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
        this.deepFireDomain.qualifiedFireForSeat(state, 0) : this.usefulFire(state, 0);
    if (action === ACTION.CAST_STUN) return this.v1ShapedStun(state, 0);
    if (action === ACTION.THROW_BOMB)
      return this.deepFireDomain && a[ARRAY.TANK_BOMB_READY][0] <= frame &&
        typeof this.deepFireDomain.qualifiedBomb === "function" &&
        this.deepFireDomain.qualifiedBomb(state) ? 1 : 0;
    return 0;
  }

  nativeProjectileCount(state, owner, x, y, direction) {
    const a = state.arrays; let count = 0;
    const wantedDirection = LEGACY_DIRECTION[direction];
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === owner &&
          state.x(a[ARRAY.PROJECTILE_CELL][slot]) === x &&
          state.y(a[ARRAY.PROJECTILE_CELL][slot]) === y &&
          a[ARRAY.PROJECTILE_DIR][slot] === wantedDirection) count += 1;
    return count;
  }

  projectileMismatch(state, expected) {
    let active = 0; const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      active += a[ARRAY.PROJECTILE_ACTIVE][slot];
    if (active !== expected.length) return 1;
    for (let index = 0; index < expected.length; index += 1) {
      const item = expected[index]; let occurrences = 0;
      for (let prior = 0; prior < expected.length; prior += 1) {
        const other = expected[prior];
        if (other.owner === item.owner && other.x === item.x && other.y === item.y &&
            other.direction === item.direction) occurrences += 1;
      }
      if (this.nativeProjectileCount(state, item.owner, item.x, item.y,
          item.direction) !== occurrences) return 1;
    }
    return 0;
  }

  bombMismatch(state, expected) {
    const a = state.arrays; let active = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      active += a[ARRAY.BOMB_ACTIVE][slot];
    if (active !== expected.length) return 1;
    for (let index = 0; index < expected.length; index += 1) {
      const item = expected[index]; let found = 0;
      for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
        if (a[ARRAY.BOMB_ACTIVE][slot] &&
            state.x(a[ARRAY.BOMB_CELL][slot]) === item.x &&
            state.y(a[ARRAY.BOMB_CELL][slot]) === item.y &&
            a[ARRAY.BOMB_EXPLODE][slot] === item.explodeFrame) found += 1;
      if (!found) return 1;
    }
    return 0;
  }

  dirtCount(state) {
    let count = 0; const terrain = state.arrays[ARRAY.TERRAIN];
    for (let cell = 0; cell < state.cells; cell += 1)
      if (terrain[cell] === TERRAIN.DIRT) count += 1;
    return count;
  }

  statusMismatch(state, expected, target = null) {
    const a = state.arrays;
    let mismatch = 0;
    const check = (index, actual, wanted) => {
      if (actual === wanted) return;
      mismatch = 1; if (target) target[index] += 1;
    };
    check(0, this.remaining(state, ARRAY.TANK_STUN_UNTIL, 0), expected.myStunned);
    check(1, this.remaining(state, ARRAY.TANK_STUN_UNTIL, 1), expected.enemyStunned);
    check(2, this.remaining(state, ARRAY.TANK_FROZEN_UNTIL, 0), expected.myFrozen);
    check(3, this.remaining(state, ARRAY.TANK_FROZEN_UNTIL, 1), expected.enemyFrozen);
    check(4, this.remaining(state, ARRAY.TANK_POISON_UNTIL, 0), expected.myPoisoned);
    check(5, this.remaining(state, ARRAY.TANK_POISON_UNTIL, 1), expected.enemyPoisoned);
    check(6, a[ARRAY.TANK_SHIELD_HITS][0], expected.myShieldHits);
    check(7, a[ARRAY.TANK_SHIELD_HITS][1], expected.enemyShieldHits);
    check(8, this.remaining(state, ARRAY.TANK_OVERLOAD_UNTIL, 0),
      expected.myOverloadFrames);
    check(9, this.remaining(state, ARRAY.TANK_OVERLOAD_UNTIL, 1),
      expected.enemyOverloadFrames);
    check(10, this.remaining(state, ARRAY.TANK_BOOST_UNTIL, 0),
      expected.myBoostFrames);
    check(11, this.remaining(state, ARRAY.TANK_BOOST_UNTIL, 1),
      expected.enemyBoostFrames);
    check(12, this.remaining(state, ARRAY.TANK_CLOAK_UNTIL, 0), expected.myCloaked);
    check(13, this.remaining(state, ARRAY.TANK_CLOAK_UNTIL, 1), expected.enemyCloaked);
    return mismatch;
  }

  compareRootSnapshot(engine, expected) {
    if (!expected) return 0;
    this.transitionRootSnapshotCount += 1;
    const state = engine.adapter.state; const a = state.arrays;
    let mismatch = 0;
    if (a[ARRAY.SCALAR][SCALAR.FRAME] !== expected.frame) {
      this.transitionRootFrameMismatchCount += 1; mismatch = 1;
    }
    if (state.x(a[ARRAY.TANK_CELL][0]) !== expected.myX ||
        state.y(a[ARRAY.TANK_CELL][0]) !== expected.myY ||
        state.x(a[ARRAY.TANK_CELL][1]) !== expected.enemyX ||
        state.y(a[ARRAY.TANK_CELL][1]) !== expected.enemyY) {
      this.transitionRootPoseMismatchCount += 1; mismatch = 1;
    }
    if (a[ARRAY.TANK_DIR][0] !== LEGACY_DIRECTION[expected.myDir] ||
        a[ARRAY.TANK_DIR][1] !== LEGACY_DIRECTION[expected.enemyDir]) {
      this.transitionRootDirectionMismatchCount += 1; mismatch = 1;
    }
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starX = star === 0xffff ? -1 : state.x(star);
    const starY = star === 0xffff ? -1 : state.y(star);
    if (a[ARRAY.TANK_STARS][0] !== expected.myStars ||
        a[ARRAY.TANK_STARS][1] !== expected.enemyStars ||
        starX !== expected.starX || starY !== expected.starY) {
      this.transitionRootStarMismatchCount += 1; mismatch = 1;
    }
    if (!!a[ARRAY.TANK_CRASH][0] !== !!expected.myDead ||
        !!a[ARRAY.TANK_CRASH][1] !== !!expected.enemyDead) {
      this.transitionRootCrashMismatchCount += 1; mismatch = 1;
    }
    if (this.projectileMismatch(state, expected.projectiles)) {
      this.transitionRootProjectileMismatchCount += 1; mismatch = 1;
    }
    if (this.bombMismatch(state, expected.bombs)) {
      this.transitionRootBombMismatchCount += 1; mismatch = 1;
    }
    if (this.dirtCount(state) !== expected.dirtCount) {
      this.transitionRootTerrainMismatchCount += 1; mismatch = 1;
    }
    if (this.statusMismatch(state, expected,
        this.transitionRootStatusFieldMismatch)) {
      this.transitionRootStatusMismatchCount += 1; mismatch = 1;
    }
    this.transitionRootAnyMismatchCount += mismatch;
    return mismatch;
  }

  compareAppliedTransition(engine, expected, ownAction = -1,
    sampledPathScore = 0, sampledRepeatComponent = 0) {
    const state = engine.adapter.state; const a = state.arrays;
    let mismatch = 0;
    if (a[ARRAY.SCALAR][SCALAR.FRAME] !== expected.frame) {
      this.transitionFrameMismatchCount += 1; mismatch = 1;
    }
    if (state.x(a[ARRAY.TANK_CELL][0]) !== expected.myX ||
        state.y(a[ARRAY.TANK_CELL][0]) !== expected.myY ||
        state.x(a[ARRAY.TANK_CELL][1]) !== expected.enemyX ||
        state.y(a[ARRAY.TANK_CELL][1]) !== expected.enemyY) {
      this.transitionPoseMismatchCount += 1; mismatch = 1;
    }
    if (a[ARRAY.TANK_DIR][0] !== LEGACY_DIRECTION[expected.myDir] ||
        a[ARRAY.TANK_DIR][1] !== LEGACY_DIRECTION[expected.enemyDir]) {
      this.transitionDirectionMismatchCount += 1; mismatch = 1;
    }
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starX = star === 0xffff ? -1 : state.x(star);
    const starY = star === 0xffff ? -1 : state.y(star);
    if (a[ARRAY.TANK_STARS][0] !== expected.myStars ||
        a[ARRAY.TANK_STARS][1] !== expected.enemyStars ||
        starX !== expected.starX || starY !== expected.starY) {
      this.transitionStarMismatchCount += 1; mismatch = 1;
    }
    if (!!a[ARRAY.TANK_CRASH][0] !== !!expected.myDead ||
        !!a[ARRAY.TANK_CRASH][1] !== !!expected.enemyDead) {
      this.transitionCrashMismatchCount += 1; mismatch = 1;
    }
    if (this.projectileMismatch(state, expected.projectiles)) {
      this.transitionProjectileMismatchCount += 1; mismatch = 1;
    }
    if (this.bombMismatch(state, expected.bombs)) {
      this.transitionBombMismatchCount += 1; mismatch = 1;
    }
    if (this.dirtCount(state) !== expected.dirtCount) {
      this.transitionTerrainMismatchCount += 1; mismatch = 1;
    }
    if (this.statusMismatch(state, expected, this.transitionStatusFieldMismatch)) {
      this.transitionStatusMismatchCount += 1; mismatch = 1;
    }
    if (this.leafEvaluator) {
      const nativeValue = this.leafEvaluator.evaluate(state);
      const difference = Math.trunc(nativeValue - expected.value);
      this.transitionLeafSignedDifference += difference;
      this.transitionLeafAbsDifference += Math.abs(difference);
      const native = this.leafEvaluator.lastComponents;
      if (!mismatch && expected.components && this.leafComponentsAvailable()) {
        this.transitionExactLeafCount += 1;
        if (ownAction >= 0 && ownAction < ACTION_WIDTH)
          this.lastTransitionOwnExactLeafCount[ownAction] += 1;
        const v1 = expected.components;
        const differences = [native[0] + native[1] - v1.objective,
          native[2] - v1.projectile, native[3] - v1.attack,
          native[4] - v1.position, native[5] - v1.status,
          sampledPathScore - v1.action,
          sampledRepeatComponent - v1.repetition, -v1.survival];
        for (let component = 0; component < differences.length; component += 1) {
          const componentDifference = Math.trunc(differences[component]);
          this.transitionExactComponentSignedDifference[component] +=
            componentDifference;
          this.transitionExactComponentAbsDifference[component] +=
            Math.abs(componentDifference);
          if (ownAction >= 0 && ownAction < ACTION_WIDTH) {
            const at = ownAction * 8 + component;
            this.lastTransitionOwnComponentSignedDifference[at] +=
              componentDifference;
            this.lastTransitionOwnComponentAbsDifference[at] +=
              Math.abs(componentDifference);
          }
        }
      }
    }
    this.transitionAnyMismatchCount += mismatch;
    return mismatch;
  }

  appliedMismatchMask(state, expected) {
    const a = state.arrays; let mask = 0;
    if (a[ARRAY.SCALAR][SCALAR.FRAME] !== expected.frame) mask |= 1;
    if (state.x(a[ARRAY.TANK_CELL][0]) !== expected.myX ||
        state.y(a[ARRAY.TANK_CELL][0]) !== expected.myY ||
        state.x(a[ARRAY.TANK_CELL][1]) !== expected.enemyX ||
        state.y(a[ARRAY.TANK_CELL][1]) !== expected.enemyY) mask |= 2;
    if (a[ARRAY.TANK_DIR][0] !== LEGACY_DIRECTION[expected.myDir] ||
        a[ARRAY.TANK_DIR][1] !== LEGACY_DIRECTION[expected.enemyDir]) mask |= 4;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starX = star === 0xffff ? -1 : state.x(star);
    const starY = star === 0xffff ? -1 : state.y(star);
    if (a[ARRAY.TANK_STARS][0] !== expected.myStars ||
        a[ARRAY.TANK_STARS][1] !== expected.enemyStars ||
        starX !== expected.starX || starY !== expected.starY) mask |= 8;
    if (!!a[ARRAY.TANK_CRASH][0] !== !!expected.myDead ||
        !!a[ARRAY.TANK_CRASH][1] !== !!expected.enemyDead) mask |= 16;
    if (this.projectileMismatch(state, expected.projectiles)) mask |= 32;
    if (this.bombMismatch(state, expected.bombs)) mask |= 64;
    if (this.dirtCount(state) !== expected.dirtCount) mask |= 128;
    if (this.statusMismatch(state, expected)) mask |= 256;
    return mask;
  }

  compareOneStep(engine, census, rootSnapshot = null) {
    this.lastOneStepRootComparable = 0;
    this.lastOneStepComparedCount = 0;
    this.lastOneStepMismatchCount = 0;
    this.lastOneStepUnsupportedCount = 0;
    this.lastOneStepMissingActionCount = 0;
    this.lastTransitionPairCompared.fill(0);
    this.lastTransitionPairMismatch.fill(0);
    this.lastTransitionOwnCompared.fill(0);
    this.lastTransitionOwnMismatch.fill(0);
    this.lastTransitionOwnUnsupported.fill(0);
    this.lastTransitionOwnExactLeafCount.fill(0);
    this.lastTransitionOwnComponentSignedDifference.fill(0);
    this.lastTransitionOwnComponentAbsDifference.fill(0);
    if (!Array.isArray(census) || !census.length) return;
    const bundle = engine.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state) return;
    this.bindIsolatedHard(bundle); this.transitionCensusRootCount += 1;
    if (this.compareRootSnapshot(engine, rootSnapshot)) {
      this.transitionSkippedRootMismatchCount += census.length;
      return;
    }
    this.lastOneStepRootComparable = 1;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta; const highWaterEvent = state.highWaterEvent;
    const comparedBefore = this.transitionComparedCount;
    const mismatchBefore = this.transitionAnyMismatchCount;
    const unsupportedBefore = this.transitionUnsupportedCount;
    const missingBefore = this.transitionMissingActionCount;
    for (let index = 0; index < census.length; index += 1) {
      const expected = census[index];
      const action0 = this.legacyAction(expected.myAction);
      const action1 = this.legacyAction(expected.enemyAction);
      if (action0 < 0 || action1 < 0) {
        if (action0 >= 0) this.lastTransitionOwnUnsupported[action0] += 1;
        this.transitionMissingActionCount += 1; continue;
      }
      let argument1 = 0xffff;
      if (action1 === ACTION.CAST_TELEPORT && expected.teleportTarget)
        argument1 = state.cell(expected.teleportTarget[0], expected.teleportTarget[1]);
      const compound = action1 >= ACTION.BOOST_LEFT_GO &&
        action1 <= ACTION.BOOST_RIGHT_BOMB;
      const chance0 = expected.myReversed ? CHANCE.REVERSED : CHANCE.NORMAL;
      const chance1 = expected.reversed ?
        (compound ? CHANCE.BOTH_REVERSED : CHANCE.REVERSED) : CHANCE.NORMAL;
      const sampledPathScore = this.pathUtility ?
        this.pathUtility.scoreTransition(state, action0, action1,
          engine.lastAction ?? ACTION.NONE, engine.turnStreak | 0, 1) : 0;
      const appliedPathToken = this.pathUtility &&
          typeof this.pathUtility.prepareAppliedTransition === "function" ?
        this.pathUtility.prepareAppliedTransition(state, action0) : 0xffffffff;
      const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
      const status = kernel.applyFrame(action0, 0xffff, action1, argument1,
        chance0, chance1);
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        this.lastTransitionOwnUnsupported[action0] += 1;
        this.transitionUnsupportedCount += 1;
      } else {
        this.extendV1StunCountdown(state, action0, action1, beforeFrame);
        const appliedPathScore = this.pathUtility &&
            typeof this.pathUtility.scoreAppliedTransition === "function" ?
          this.pathUtility.scoreAppliedTransition(state, action0, action1,
            chance1, appliedPathToken) : 0;
        this.transitionComparedCount += 1;
        const pair = action0 * ACTION_WIDTH + action1;
        this.transitionPairCompared[pair] += 1;
        this.lastTransitionPairCompared[pair] += 1;
        this.lastTransitionOwnCompared[action0] += 1;
        if (this.compareAppliedTransition(engine, expected, action0,
          sampledPathScore + appliedPathScore)) {
          this.transitionPairMismatch[pair] += 1;
          this.lastTransitionPairMismatch[pair] += 1;
          this.lastTransitionOwnMismatch[action0] += 1;
        }
      }
      state.undoTo(mark);
    }
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    this.lastOneStepComparedCount = this.transitionComparedCount - comparedBefore;
    this.lastOneStepMismatchCount =
      this.transitionAnyMismatchCount - mismatchBefore;
    this.lastOneStepUnsupportedCount =
      this.transitionUnsupportedCount - unsupportedBefore;
    this.lastOneStepMissingActionCount =
      this.transitionMissingActionCount - missingBefore;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi)
      this.rootRestoreFailureCount += 1;
  }

  compareDeepActionDomain(engine, expected, ply, seat) {
    const oracleActions = seat ? expected.enemyTacticalActions :
      expected.ownTacticalActions;
    if (!Array.isArray(oracleActions)) return;
    const priorFireChecks = this.deepV1FireCheckCount;
    const priorOwnSkills = this.deepOwnSkillCount;
    const priorEnemySkills = this.deepEnemySkillCount;
    const count = this.generate(engine, ply, seat);
    const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const offset = ply * DEEP_WIDTH;
    this.compareOrderedDomain(actions, offset, count, oracleActions,
      ply * 2 + seat);
    // Domain comparison is an audit over an already reconstructed state, not
    // another search expansion. Keep production-search work counters pure.
    const actionBase = seat * ACTION_WIDTH;
    for (let index = 0; index < count; index += 1)
      this.deepActionCount[actionBase + actions[offset + index]] -= 1;
    if (seat) this.enemyExpansionCount -= 1;
    else this.ownExpansionCount -= 1;
    this.deepV1FireCheckCount = priorFireChecks;
    this.deepOwnSkillCount = priorOwnSkills;
    this.deepEnemySkillCount = priorEnemySkills;
  }

  compareDeepTransitions(engine, recursion) {
    this.lastDeepTransitionComparedCount = 0;
    this.lastDeepTransitionMismatchCount = 0;
    this.lastDeepTransitionUnsupportedCount = 0;
    this.lastDeepRootCompared.fill(0);
    this.lastDeepRootMismatch.fill(0);
    this.lastDeepRootUnsupported.fill(0);
    this.lastDeepRootExactLeafCount.fill(0);
    this.lastDeepRootComponentSignedDifference.fill(0);
    this.lastDeepRootComponentAbsDifference.fill(0);
    const samples = recursion?.deepTransitions;
    if (!this.lastOneStepRootComparable || !Array.isArray(samples) ||
        !samples.length) return;
    const state = engine.adapter.state; const kernel = this.diagnosticKernel;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta; const highWaterEvent = state.highWaterEvent;
    const comparedBefore = this.deepTransitionComparedByPly[2] +
      this.deepTransitionComparedByPly[3];
    const mismatchBefore = this.deepTransitionAnyMismatchByPly[2] +
      this.deepTransitionAnyMismatchByPly[3];
    const unsupportedBefore = this.deepTransitionUnsupportedByPly[2] +
      this.deepTransitionUnsupportedByPly[3];
    for (let index = 0; index < samples.length; index += 1) {
      kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
      const expected = samples[index]; const ply = Math.max(0,
        Math.min(3, expected.ply | 0)); let supported = 1;
      const rootAction = expected.path?.length ?
        this.legacyAction(expected.path[0].myAction) : -1;
      let sampledPathScore = 0;
      let sampledRepetitionPenalty = 0;
      let sampledPreviousAction = engine.lastAction ?? ACTION.NONE;
      let sampledTurnStreak = engine.turnStreak | 0;
      for (let stepIndex = 0; stepIndex < expected.path.length; stepIndex += 1) {
        const step = expected.path[stepIndex];
        const action0 = this.legacyAction(step.myAction);
        const action1 = this.legacyAction(step.enemyAction);
        if (action0 < 0 || action1 < 0) { supported = 0; break; }
        if (this.pathUtility)
          sampledPathScore += this.pathUtility.scoreTransition(state, action0,
            action1, sampledPreviousAction, sampledTurnStreak, stepIndex + 1);
        const sampledTurning = action0 === ACTION.TURN_LEFT ||
          action0 === ACTION.TURN_RIGHT;
        sampledTurnStreak = sampledTurning ?
          Math.min(255, sampledTurnStreak + 1) : 0;
        sampledPreviousAction = action0;
        let argument1 = 0xffff;
        if (action1 === ACTION.CAST_TELEPORT && step.teleportTarget)
          argument1 = state.cell(step.teleportTarget[0], step.teleportTarget[1]);
        const compound = action1 >= ACTION.BOOST_LEFT_GO &&
          action1 <= ACTION.BOOST_RIGHT_BOMB;
        const chance0 = step.myReversed ? CHANCE.REVERSED : CHANCE.NORMAL;
        const chance1 = step.reversed ?
          (compound ? CHANCE.BOTH_REVERSED : CHANCE.REVERSED) : CHANCE.NORMAL;
        const appliedPathToken = this.pathUtility &&
            typeof this.pathUtility.prepareAppliedTransition === "function" ?
          this.pathUtility.prepareAppliedTransition(state, action0) : 0xffffffff;
        const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        const status = kernel.applyFrame(action0, 0xffff, action1, argument1,
          chance0, chance1);
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          supported = 0; break;
        }
        this.extendV1StunCountdown(state, action0, action1, beforeFrame);
        if (this.pathUtility &&
            typeof this.pathUtility.scoreAppliedTransition === "function")
          sampledPathScore += this.pathUtility.scoreAppliedTransition(state,
            action0, action1, chance1, appliedPathToken);
        sampledRepetitionPenalty += this.superkoPenalty(state, stepIndex + 1);
      }
      if (!supported) {
        this.deepTransitionUnsupportedByPly[ply] += 1;
        if (rootAction >= 0) this.lastDeepRootUnsupported[rootAction] += 1;
      }
      else {
        this.deepTransitionComparedByPly[ply] += 1;
        if (rootAction >= 0) this.lastDeepRootCompared[rootAction] += 1;
        const mask = this.appliedMismatchMask(state, expected);
        if (mask) {
          this.deepTransitionAnyMismatchByPly[ply] += 1;
          if (rootAction >= 0) this.lastDeepRootMismatch[rootAction] += 1;
        }
        for (let field = 0; field < 9; field += 1)
          if (mask & (1 << field))
            this.deepTransitionFieldMismatchByPly[ply * 9 + field] += 1;
        if (!mask) {
          this.compareDeepActionDomain(engine, expected, ply, 0);
          this.compareDeepActionDomain(engine, expected, ply, 1);
        }
        if (!mask && this.leafEvaluator && expected.components) {
          const nativeValue = this.leafEvaluator.evaluate(state);
          const difference = Math.trunc(nativeValue - expected.value);
          this.deepExactLeafCountByPly[ply] += 1;
          if (rootAction >= 0)
            this.lastDeepRootExactLeafCount[rootAction] += 1;
          this.deepLeafSignedDifferenceByPly[ply] += difference;
          this.deepLeafAbsDifferenceByPly[ply] += Math.abs(difference);
          const native = this.leafEvaluator.lastComponents; const v1 = expected.components;
          const sampledTop = expected.path.length;
          let sampledRepeatComponent = -sampledRepetitionPenalty;
          if (this.superkoMode === "v1" && sampledTop > 0 &&
              this.pathRepeatReference[sampledTop] !== -2147483648 &&
              this.pathRepeatLastPenalty[sampledTop] > 0 &&
              nativeValue + sampledPathScore >
                this.pathRepeatReference[sampledTop] + 150)
            sampledRepeatComponent += this.pathRepeatLastPenalty[sampledTop] >> 1;
          if (this.leafComponentsAvailable()) {
            const differences = [native[0] + native[1] - v1.objective,
              native[2] - v1.projectile, native[3] - v1.attack,
              native[4] - v1.position, native[5] - v1.status,
              sampledPathScore - v1.action,
              sampledRepeatComponent - v1.repetition, -v1.survival];
            for (let component = 0; component < differences.length; component++) {
              const componentDifference = Math.trunc(differences[component]);
              const at = ply * 8 + component;
              this.deepExactComponentSignedDifferenceByPly[at] += componentDifference;
              this.deepExactComponentAbsDifferenceByPly[at] +=
                Math.abs(componentDifference);
              if (rootAction >= 0) {
                const rootAt = rootAction * 8 + component;
                this.lastDeepRootComponentSignedDifference[rootAt] +=
                  componentDifference;
                this.lastDeepRootComponentAbsDifference[rootAt] +=
                  Math.abs(componentDifference);
              }
            }
          }
        }
      }
      state.undoTo(rootMark);
    }
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    this.lastDeepTransitionComparedCount =
      this.deepTransitionComparedByPly[2] +
      this.deepTransitionComparedByPly[3] - comparedBefore;
    this.lastDeepTransitionMismatchCount =
      this.deepTransitionAnyMismatchByPly[2] +
      this.deepTransitionAnyMismatchByPly[3] - mismatchBefore;
    this.lastDeepTransitionUnsupportedCount =
      this.deepTransitionUnsupportedByPly[2] +
      this.deepTransitionUnsupportedByPly[3] - unsupportedBefore;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi)
      this.rootRestoreFailureCount += 1;
  }

  nativeRootRow(engine, action) {
    for (let row = 0; row < this.preparedRootCount; row += 1)
      if ((!this.rootDomainRestricted || this.rootDomainMask[row]) &&
          engine.ourActions[row] === action) return row;
    return -1;
  }

  compareRootValueOrdering(engine, recursion) {
    this.rootValueAuditCount += 1;
    const roots = recursion?.roots;
    if (!engine || !Array.isArray(roots) || roots.length < 1 ||
        !this.lastOneStepRootComparable) return;
    // Search-domain equality, including order, is required because V1 keeps
    // the first root action on equal values. The independent audit domain is
    // reported separately and must not make the production search look exact.
    if (this.lastSearchOwnDomainResult !== 3 ||
        this.lastSearchEnemyDomainResult !== 3) return;
    this.rootValueDomainExactCount += 1;
    const transitionExact = this.lastOneStepComparedCount > 0 &&
      !this.lastOneStepMismatchCount && !this.lastOneStepUnsupportedCount &&
      !this.lastOneStepMissingActionCount &&
      this.lastDeepTransitionComparedCount > 0 &&
      !this.lastDeepTransitionMismatchCount &&
      !this.lastDeepTransitionUnsupportedCount;
    if (transitionExact) this.rootValueTransitionExactCount += 1;
    const strict = transitionExact && this.lastOwnershipSupportComplete;
    if (strict) this.rootValueStrictCount += 1;
    const tierCount = strict ? 3 : transitionExact ? 2 : 1;
    let bestOracle = -1; let bestOracleValue = -Infinity;
    let bestNative = -1; let bestNativeValue = VALUE_MIN;
    for (let first = 0; first < roots.length; first += 1) {
      const firstAction = this.legacyAction(roots[first]?.action);
      const firstRow = firstAction < 0 ? -1 :
        this.nativeRootRow(engine, firstAction);
      if (firstRow < 0 || !Number.isFinite(roots[first]?.value)) continue;
      for (let tier = 0; tier < tierCount; tier += 1)
        this.rootValueCommonActionCount[tier] += 1;
      const oracleValue = roots[first].value;
      const nativeValue = this.rootScore[firstRow];
      if (bestOracle < 0 || oracleValue > bestOracleValue) {
        bestOracle = firstAction; bestOracleValue = oracleValue;
      }
      if (bestNative < 0 || nativeValue > bestNativeValue) {
        bestNative = firstAction; bestNativeValue = nativeValue;
      }
      for (let second = first + 1; second < roots.length; second += 1) {
        const secondAction = this.legacyAction(roots[second]?.action);
        const secondRow = secondAction < 0 ? -1 :
          this.nativeRootRow(engine, secondAction);
        if (secondRow < 0 || !Number.isFinite(roots[second]?.value)) continue;
        const oracleDifference = oracleValue - roots[second].value;
        const nativeDifference = nativeValue - this.rootScore[secondRow];
        const agrees = oracleDifference === 0 ? nativeDifference === 0 :
          oracleDifference > 0 ? nativeDifference > 0 : nativeDifference < 0;
        for (let tier = 0; tier < tierCount; tier += 1) {
          this.rootValuePairComparedCount[tier] += 1;
          if (agrees) this.rootValuePairOrderAgreementCount[tier] += 1;
        }
      }
    }
    if (bestOracle < 0 || bestNative < 0) return;
    for (let tier = 0; tier < tierCount; tier += 1) {
      this.rootValueBestComparedCount[tier] += 1;
      if (bestOracle === bestNative) this.rootValueBestAgreementCount[tier] += 1;
    }
  }

  blended(worst, sum, count) {
    if (!count || !this.currentBlendBasisPoints) return worst;
    const expected = Math.trunc(sum / count);
    return worst + Math.trunc((expected - worst) *
      this.currentBlendBasisPoints / 10000);
  }

  leaf(engine, pathScore = 0, top = 0) {
    const state = engine.adapter.state;
    const value = this.leafEvaluator ? this.leafEvaluator.evaluate(state) :
      engine.depthSearch.heuristic(state);
    let adjusted = value + pathScore;
    if (this.superkoMode === "v1" && top > 0 &&
        this.pathRepeatReference[top] !== -2147483648 &&
        this.pathRepeatLastPenalty[top] > 0 &&
        adjusted + this.pathRepeatCumulative[top] >
          this.pathRepeatReference[top] + 150) {
      adjusted += this.pathRepeatLastPenalty[top] >> 1;
      this.superkoReliefCount += 1;
    }
    return this.historyEvaluator ? this.historyEvaluator.adjustOwn(state, adjusted) : adjusted;
  }

  terminalUtility(engine, terminal, depth, pathScore, top = 0) {
    if (this.terminalMode !== "v1")
      return engine.depthSearch.terminalValue(terminal, depth);
    const state = engine.adapter.state; const a = state.arrays;
    const crash0 = a[ARRAY.TANK_CRASH][0] !== 0;
    const crash1 = a[ARRAY.TANK_CRASH][1] !== 0;
    if (!crash0 && !crash1) return this.leaf(engine, pathScore, top);
    const stars0 = a[ARRAY.TANK_STARS][0]; const stars1 = a[ARRAY.TANK_STARS][1];
    if (crash0 && crash1) {
      if (stars0 > stars1) return 100000;
      if (stars0 < stars1) return -100000;
      return -60000;
    }
    return crash1 ? 100000 : -100000;
  }

  pairedLeaf(engine, robustPathScore, nominalPathScore, top = 0) {
    const value = this.leaf(engine, robustPathScore, top);
    this.lastNominalValue = value + nominalPathScore - robustPathScore;
    return value;
  }

  pairedTerminalUtility(engine, terminal, depth, robustPathScore,
    nominalPathScore, top = 0) {
    const value = this.terminalUtility(engine, terminal, depth,
      robustPathScore, top);
    const a = engine.adapter.state.arrays;
    const fixedTerminal = this.terminalMode !== "v1" ||
      a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1];
    this.lastNominalValue = fixedTerminal ? value :
      value + nominalPathScore - robustPathScore;
    return value;
  }

  eventInstabilityMask(state) {
    if (this.eventQuiescenceMode === EVENT_QUIESCENCE.OFF || !state) return 0;
    const a = state.arrays; let mask = 0;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot]) { mask |= 1; break; }
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot]) { mask |= 2; break; }
    return mask;
  }

  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

  canFire(state, seat) {
    const a = state.arrays; const lock = a[ARRAY.TANK_FIRE_LOCK][seat];
    return !this.activeProjectile(state, seat) &&
      (lock === NONE_FRAME || lock <= a[ARRAY.SCALAR][SCALAR.FRAME]);
  }

  projectileArrivalFrames(state, seat, targetSeat) {
    const a = state.arrays; const target = a[ARRAY.TANK_CELL][targetSeat];
    let best = 99;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1) {
      if (!a[ARRAY.PROJECTILE_ACTIVE][slot] ||
          a[ARRAY.PROJECTILE_OWNER][slot] !== seat) continue;
      const cell = a[ARRAY.PROJECTILE_CELL][slot];
      const direction = a[ARRAY.PROJECTILE_DIR][slot];
      if (this.directionTo(state, cell, target) !== direction ||
          !this.clearLine(state, cell, target)) continue;
      const frames = Math.max(1, Math.trunc((this.distance(state, cell, target) +
        RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS));
      if (frames < best) best = frames;
    }
    return best;
  }

  earliestAttackFrames(state, seat, targetSeat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const shieldUntil = a[ARRAY.TANK_SHIELD_UNTIL][targetSeat];
    if (a[ARRAY.TANK_SHIELD_HITS][targetSeat] > 0 &&
        shieldUntil !== NONE_FRAME && shieldUntil > frame) return 99;
    let best = this.projectileArrivalFrames(state, seat, targetSeat);
    if (!this.canFire(state, seat)) return best;
    const from = a[ARRAY.TANK_CELL][seat]; const to = a[ARRAY.TANK_CELL][targetSeat];
    const wanted = this.directionTo(state, from, to);
    if (wanted < 0 || !this.clearLine(state, from, to)) return best;
    const delta = (wanted - a[ARRAY.TANK_DIR][seat]) & 3;
    let turns = delta === 3 ? 1 : delta;
    if (delta === 2) turns = 2;
    const boostUntil = a[ARRAY.TANK_BOOST_UNTIL][seat];
    if (boostUntil !== NONE_FRAME && boostUntil > frame)
      turns = Math.max(0, turns - 1);
    const frames = turns + Math.max(1, Math.trunc((this.distance(state, from, to) +
      RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS));
    return frames < best ? frames : best;
  }

  terminalTradeClass(state) {
    if (!this.collectTerminalTrade) return 0;
    const a = state.arrays;
    if (a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1]) return 0;
    const ownFrames = this.earliestAttackFrames(state, 0, 1);
    if (ownFrames >= 99) return 0;
    const enemyFrames = this.earliestAttackFrames(state, 1, 0);
    if (ownFrames < enemyFrames) return 1;
    if (ownFrames === enemyFrames)
      return a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1] ? 1 : 2;
    return 3;
  }

  usefulFire(state, seat) {
    if (!this.canFire(state, seat)) return 0;
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const direction = a[ARRAY.TANK_DIR][seat];
    let x = state.x(cell) + DX[direction];
    let y = state.y(cell) + DY[direction];
    while (x >= 0 && x < state.width && y >= 0 && y < state.height) {
      const next = state.cell(x, y);
      if (next === enemy) return 1;
      const tile = a[ARRAY.TERRAIN][next];
      if (tile === TERRAIN.WALL) return 0;
      if (tile === TERRAIN.DIRT) return 1;
      x += DX[direction]; y += DY[direction];
    }
    return 0;
  }

  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  context(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (RULE.FRAME_RECORD_LIMIT - 1 - frame <= 16) return OPPONENT_CONTEXT.TERMINAL;
    const cell = a[ARRAY.TANK_CELL][1]; const other = a[ARRAY.TANK_CELL][0];
    let mobility = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.targetCell(state, cell, direction);
      if (next === 0xffff || next === other) continue;
      const tile = a[ARRAY.TERRAIN][next];
      if (tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT) mobility += 1;
    }
    return mobility <= 1 ? OPPONENT_CONTEXT.PRESSURED : OPPONENT_CONTEXT.OPEN;
  }

  targetCell(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? 0xffff :
      state.cell(x, y);
  }

  directionTo(state, from, to) {
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1;
    return -1;
  }

  clearLine(state, from, to) {
    const direction = this.directionTo(state, from, to);
    if (direction < 0) return 0;
    let cell = this.targetCell(state, from, direction);
    while (cell !== 0xffff && cell !== to) {
      const tile = state.arrays[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      cell = this.targetCell(state, cell, direction);
    }
    return cell === to ? 1 : 0;
  }

  usefulStun(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_SKILL][seat] !== SKILL.STUN ||
        a[ARRAY.TANK_SKILL_READY][seat] > frame) return 0;
    const otherStun = a[ARRAY.TANK_STUN_UNTIL][seat ^ 1];
    if (otherStun !== NONE_FRAME && otherStun > frame) return 0;
    const own = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const distance = this.distance(state, own, enemy);
    if (distance > (seat ? 8 : 9)) return 0;
    if (distance <= 4 || this.clearLine(state, own, enemy)) return 1;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    return star !== 0xffff && this.distance(state, enemy, star) <=
      this.distance(state, own, star) + 3 ? 1 : 0;
  }

  v1ShapedStun(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_SKILL][seat] !== SKILL.STUN ||
        a[ARRAY.TANK_SKILL_READY][seat] > frame) return 0;
    const own = a[ARRAY.TANK_CELL][seat]; const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    const distance = this.distance(state, own, enemy);
    if (seat) {
      if (distance <= 8) return 1;
      return this.leafEvaluator &&
        typeof this.leafEvaluator.bombPressure === "function" &&
        this.leafEvaluator.bombPressure(state, 0) >= 1200 ? 1 : 0;
    }
    const enemyStun = a[ARRAY.TANK_STUN_UNTIL][1];
    if (enemyStun !== NONE_FRAME && enemyStun > frame || distance > 9) return 0;
    if (this.oracleEnemyStationaryStreak >= 6) {
      const wanted = this.directionTo(state, enemy, own);
      const immediate = wanted === a[ARRAY.TANK_DIR][1] &&
        this.clearLine(state, enemy, own) && this.canFire(state, 1);
      const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
      const contested = star !== 0xffff &&
        this.distance(state, enemy, star) <= this.distance(state, own, star) + 1 &&
        this.v1EnemyMotionBasisPoints() > 2500;
      if (!immediate && distance > 3 && !contested) return 0;
    }
    if (distance <= 4 || this.clearLine(state, own, enemy)) return 1;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    return star !== 0xffff && this.distance(state, enemy, star) <=
      this.distance(state, own, star) + 3 ? 1 : 0;
  }

  v1EnemyMotionBasisPoints() {
    let streak = 10000;
    if (this.oracleEnemyStationaryStreak >= 12) streak = 600;
    else if (this.oracleEnemyStationaryStreak >= 8) streak = 1200;
    else if (this.oracleEnemyStationaryStreak >= 5) streak = 3000;
    else if (this.oracleEnemyStationaryStreak >= 3) streak = 6000;
    const total = this.oracleOpponentCounts[0] + this.oracleOpponentCounts[1] +
      this.oracleOpponentCounts[2] + this.oracleOpponentCounts[3];
    const observed = Math.max(800, Math.min(10000,
      Math.trunc(this.oracleOpponentCounts[0] * 40000 / Math.max(1, total))));
    return Math.min(streak, observed);
  }

  rootEnemyActionAllowed(engine, action) {
    const flags = this.rootEnemyDomainFlags;
    if (!flags) return 1;
    const state = engine.adapter.state; const a = state.arrays;
    if ((flags & ROOT_ENEMY_DOMAIN.DROP_PASSIVE) &&
        (action === ACTION.NONE || action === ACTION.THROW_BOMB)) return 0;
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_FIRE) &&
        action === ACTION.FIRE)
      return this.rootEnemyDomainMode === "v1-shaped" &&
        this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
        this.deepFireDomain.qualifiedFireForSeat(state, 1, 10000) :
        this.usefulFire(state, 1);
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL) &&
        action === ACTION.GO) {
      const next = this.targetCell(state, a[ARRAY.TANK_CELL][1],
        a[ARRAY.TANK_DIR][1]);
      return next !== 0xffff && next !== a[ARRAY.TANK_CELL][0] &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.WALL &&
        a[ARRAY.TERRAIN][next] !== TERRAIN.DIRT ? 1 : 0;
    }
    if ((flags & ROOT_ENEMY_DOMAIN.QUALIFY_MOTION_SKILL) &&
        action === ACTION.CAST_STUN)
      return this.rootEnemyDomainMode === "v1-shaped" ?
        this.v1ShapedStun(state, 1) : this.usefulStun(state, 1);
    if (this.rootEnemyDomainMode !== "tactical") return 1;
    return action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ? 1 : 0;
  }

  scheduledDepth(engine) {
    if (this.depthSchedule !== "v1-state" || this.targetDepth < 3) return this.targetDepth;
    const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    if (this.distance(state, own, enemy) <= 6) return 3;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot]) return 3;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] &&
          (!this.leafEvaluator || this.leafEvaluator.bombHits(state,
            a[ARRAY.BOMB_CELL][slot], own))) return 3;
    const x = state.x(own); const y = state.y(own);
    if (Math.min(x - 1, state.width - 2 - x, y - 1, state.height - 2 - y) <= 2)
      return 3;
    const stun = a[ARRAY.TANK_STUN_UNTIL][1];
    if (stun !== NONE_FRAME && stun > frame && stun - frame <= 2) return 3;
    return 2;
  }

  opponentWeight(engine, state, action) {
    if (this.opponentMode === "v1-exact" && this.oracleOpponentReady)
      return this.v1OpponentWeight(state, action);
    if (!this.opponentWeighted || !engine.policy?.opponent) return 1000;
    const model = engine.policy.opponent; const context = this.context(state);
    let weight = 1000;
    if (action === ACTION.FIRE || action === ACTION.BOOST_LEFT_FIRE ||
        action === ACTION.BOOST_RIGHT_FIRE)
      weight += model.propensity(OPPONENT_EVENT.FIRE, context) * 2;
    else if (action === ACTION.THROW_BOMB || action === ACTION.BOOST_LEFT_BOMB ||
        action === ACTION.BOOST_RIGHT_BOMB)
      weight += model.propensity(OPPONENT_EVENT.BOMB, context);
    else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST)
      weight += model.propensity(OPPONENT_EVENT.SKILL, context);
    else if (action === ACTION.GO || action === ACTION.BOOST_LEFT_GO ||
        action === ACTION.BOOST_RIGHT_GO)
      weight += model.propensity(OPPONENT_EVENT.ADVANCE, context);
    else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ||
        action === ACTION.BOOST_LEFT_TURN_LEFT ||
        action === ACTION.BOOST_LEFT_TURN_RIGHT ||
        action === ACTION.BOOST_RIGHT_TURN_LEFT ||
        action === ACTION.BOOST_RIGHT_TURN_RIGHT)
      weight += model.propensity(OPPONENT_EVENT.TURN_EXTRA, context);
    else weight += 5000 - model.riskPreference * 50;

    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const own = a[ARRAY.TANK_CELL][0]; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (action === ACTION.GO) {
      const next = this.targetCell(state, enemy, a[ARRAY.TANK_DIR][1]);
      if (star !== 0xffff && next !== 0xffff &&
          this.distance(state, next, star) < this.distance(state, enemy, star))
        weight = Math.trunc(weight * 3 / 2);
    } else if (action === ACTION.FIRE &&
        this.usefulFire(state, 1)) weight = Math.trunc(weight * 5 / 2);
    else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const direction = (a[ARRAY.TANK_DIR][1] +
        (action === ACTION.TURN_LEFT ? 3 : 1)) & 3;
      const dx = state.x(own) - state.x(enemy); const dy = state.y(own) - state.y(enemy);
      const wanted = !dx ? (dy < 0 ? 0 : 2) : !dy ? (dx > 0 ? 1 : 3) : -1;
      if (direction === wanted) weight = Math.trunc(weight * 17 / 10);
      if (star !== 0xffff) {
        const sx = state.x(star) - state.x(enemy); const sy = state.y(star) - state.y(enemy);
        const starDirection = Math.abs(sx) >= Math.abs(sy) && sx ?
          (sx > 0 ? 1 : 3) : sy ? (sy > 0 ? 2 : 0) : -1;
        if (direction === starDirection) weight = Math.trunc(weight * 13 / 10);
      }
    }
    this.weightedReplyCount += 1;
    return Math.max(1, weight);
  }

  v1OpponentWeight(state, action) {
    const actionIndex = action === ACTION.GO ? 0 : action === ACTION.TURN_LEFT ? 1 :
      action === ACTION.TURN_RIGHT ? 2 : action === ACTION.FIRE ? 3 : -1;
    let weight = (actionIndex >= 0 ? this.oracleOpponentCounts[actionIndex] : 1) * 1000;
    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const own = a[ARRAY.TANK_CELL][0]; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (action === ACTION.GO) {
      const next = this.targetCell(state, enemy, a[ARRAY.TANK_DIR][1]);
      if (next === 0xffff || next === own ||
          a[ARRAY.TERRAIN][next] === TERRAIN.WALL ||
          a[ARRAY.TERRAIN][next] === TERRAIN.DIRT) return 50;
      weight = Math.trunc(weight * (10 + Math.min(5,
        this.oracleOpponentGoStreak) * 3) / 10);
      let streakFactor = 10000;
      if (this.oracleEnemyStationaryStreak >= 12) streakFactor = 600;
      else if (this.oracleEnemyStationaryStreak >= 8) streakFactor = 1200;
      else if (this.oracleEnemyStationaryStreak >= 5) streakFactor = 3000;
      else if (this.oracleEnemyStationaryStreak >= 3) streakFactor = 6000;
      const total = this.oracleOpponentCounts[0] + this.oracleOpponentCounts[1] +
        this.oracleOpponentCounts[2] + this.oracleOpponentCounts[3];
      const observedMove = Math.max(800, Math.min(10000,
        Math.trunc(this.oracleOpponentCounts[0] * 40000 / Math.max(1, total))));
      weight = Math.trunc(weight * Math.min(streakFactor, observedMove) / 10000);
      if (star !== 0xffff && this.distance(state, next, star) <
          this.distance(state, enemy, star)) weight = Math.trunc(weight * 3 / 2);
    } else if (action === ACTION.FIRE) {
      const wanted = this.directionTo(state, enemy, own);
      if (wanted === a[ARRAY.TANK_DIR][1] && this.clearLine(state, enemy, own))
        weight = Math.trunc(weight * 5 / 2);
    } else if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) {
      const direction = (a[ARRAY.TANK_DIR][1] +
        (action === ACTION.TURN_LEFT ? 3 : 1)) & 3;
      const wanted = this.directionTo(state, enemy, own);
      if (wanted === direction) weight = Math.trunc(weight * 17 / 10);
      if (star !== 0xffff) {
        const starDirection = this.directionTo(state, enemy, star);
        if (starDirection === direction) weight = Math.trunc(weight * 13 / 10);
      }
    }
    this.weightedReplyCount += 1;
    return Math.max(10, weight);
  }

  push(top, seat, action, argument = 0) {
    const counts = seat ? this.deepEnemyCount : this.deepOurCount;
    const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
    const count = counts[top]; if (count >= DEEP_WIDTH) return;
    const at = top * DEEP_WIDTH + count;
    actions[at] = action; arguments_[at] = argument; counts[top] = count + 1;
  }

  generatePrimitive(engine, top, seat) {
    const counts = seat ? this.deepEnemyCount : this.deepOurCount;
    counts[top] = 0; const state = engine.adapter.state; const a = state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.deepDomainMode === "v1-shaped") {
      const frozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][seat];
      const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][seat];
      const poisonApplied = a[ARRAY.TANK_POISON_APPLIED][seat];
      const poisonHold = poisonUntil !== NONE_FRAME && poisonUntil > frame &&
        poisonApplied !== NONE_FRAME && ((frame - poisonApplied) & 1) !== 0;
      if (frozenUntil !== NONE_FRAME && frozenUntil > frame ||
          poisonHold) {
        this.push(top, seat, ACTION.NONE);
        return counts[top];
      }
    }
    const cell = a[ARRAY.TANK_CELL][seat]; const other = a[ARRAY.TANK_CELL][seat ^ 1];
    const direction = a[ARRAY.TANK_DIR][seat];
    const next = engine.depthSearch.target(state, cell, direction);
    if (engine.depthSearch.walkable(state, next) && next !== other)
      this.push(top, seat, ACTION.GO);
    const fire = this.deepDomainMode === "v1-shaped" && this.deepFireDomain &&
        typeof this.deepFireDomain.qualifiedFireForSeat === "function" ?
      this.deepFireDomain.qualifiedFireForSeat(state, seat,
        seat ? 10000 : this.v1EnemyMotionBasisPoints()) :
      !seat && this.deepFireMode === "v1-own" && this.deepFireDomain ?
      (this.deepV1FireCheckCount += 1, this.deepFireDomain.qualifiedFire(state)) :
      this.usefulFire(state, seat);
    if (fire) this.push(top, seat, ACTION.FIRE);
    const stun = this.deepDomainMode === "v1-shaped" ?
      this.v1ShapedStun(state, seat) :
      (this.deepSkillMode & (seat ? 2 : 1)) && this.usefulStun(state, seat);
    // V1 inserts our stun before turns, but appends the opponent skill after
    // LEFT/RIGHT. Preserve this ordering because equal minimax values keep the
    // first action.
    if (stun && !seat) {
      this.push(top, seat, ACTION.CAST_STUN);
      this.deepOwnSkillCount += 1;
    }
    if (this.deepDomainMode === "v1-shaped" &&
        this.deepBombMode === "qualified" && !seat && this.deepFireDomain &&
        a[ARRAY.TANK_BOMB_READY][0] <= frame &&
        typeof this.deepFireDomain.qualifiedBomb === "function" &&
        this.deepFireDomain.qualifiedBomb(state))
      this.push(top, seat, ACTION.THROW_BOMB);
    this.push(top, seat, ACTION.TURN_LEFT);
    this.push(top, seat, ACTION.TURN_RIGHT);
    if (stun && seat) {
      this.push(top, seat, ACTION.CAST_STUN);
      this.deepEnemySkillCount += 1;
    }
    if (!counts[top]) this.push(top, seat, ACTION.NONE);
    return counts[top];
  }

  generate(engine, top, seat) {
    let count;
    if (this.fullPrimitiveDomain) count = this.generatePrimitive(engine, top, seat);
    else {
      const search = engine.depthSearch;
      search.generateDeep(top, engine.adapter.state, seat);
      const sourceActions = seat ? search.deepEnemyActions : search.deepOurActions;
      const sourceArguments = seat ? search.deepEnemyArguments : search.deepOurArguments;
      const sourceCount = seat ? search.frameEnemyCount[top] : search.frameOurCount[top];
      const actions = seat ? this.deepEnemyActions : this.deepOurActions;
      const arguments_ = seat ? this.deepEnemyArguments : this.deepOurArguments;
      const counts = seat ? this.deepEnemyCount : this.deepOurCount;
      counts[top] = sourceCount;
      for (let index = 0; index < sourceCount; index += 1) {
        const from = top * 4 + index; const to = top * DEEP_WIDTH + index;
        actions[to] = sourceActions[from]; arguments_[to] = sourceArguments[from];
      }
      count = sourceCount;
    }
    if (!seat) {
      this.policyEnvelopeAbortNode[top] = 0;
      this.policyEnvelopeRescueNode[top] = 0;
    }
    if (!seat && this.currentContinuationPolicy !== CONTINUATION_POLICY.BASE) {
      const state = engine.adapter.state; const a = state.arrays;
      let committed = 0;
      for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
        if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
            a[ARRAY.PROJECTILE_OWNER][slot] === 1) {
          committed = 1; break;
        }
      if (!committed)
        for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
          if (a[ARRAY.BOMB_ACTIVE][slot]) { committed = 1; break; }
      if (committed) {
        // Safety owns committed danger.  Keep the ordinary legal domain so
        // the search may find a rescue instead of forcing attack progress.
        this.policyEnvelopeRescueFallbackCount += 1;
        this.policyEnvelopeRescueNode[top] = 1;
      } else if (this.pathPolicyEvent[top]) {
        // FIRE is the terminal event of ATTACK_TARGET.  Once emitted, the
        // option hands control back to the baseline policy for positioning
        // and escape instead of circling the already-completed firing pose.
        this.policyEnvelopeCompletionFallbackCount += 1;
      } else {
        const wanted = this.currentContinuationGenerator &&
            typeof this.currentContinuationGenerator.routeAction === "function" ?
          this.currentContinuationGenerator.routeAction(state) : ACTION.NONE;
        let found = -1;
        for (let index = 0; index < count; index += 1)
          if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
            found = index; break;
          }
        if (wanted === ACTION.NONE) {
          // A long policy has an explicit abort condition.  Losing contact or
          // finding no viable firing pose returns control to the baseline
          // policy; it is not fake exactness and not a stuck plan.
          this.policyEnvelopeAbortFallbackCount += 1;
          this.policyEnvelopeAbortNode[top] = 1;
        } else {
          const offset = top * DEEP_WIDTH;
          if (found < 0) this.policyEnvelopeInjectedActionCount += 1;
          this.deepOurActions[offset] = wanted;
          this.deepOurArguments[offset] = found < 0 ? 0xffff :
            this.deepOurArguments[offset + found];
          this.deepOurCount[top] = 1; count = 1;
        }
      }
    }
    if (!seat && this.eventQuiescenceContinuationMode === "base-policy" &&
        this.eventQuiescenceRoutingTop === top) {
      const wanted = this.eventQuiescenceRoutedAction;
      let found = -1;
      for (let index = 0; index < count; index += 1)
        if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
          found = index; break;
        }
      if (found >= 0) {
        const offset = top * DEEP_WIDTH;
        this.deepOurActions[offset] = this.deepOurActions[offset + found];
        this.deepOurArguments[offset] = this.deepOurArguments[offset + found];
        this.deepOurCount[top] = 1; count = 1;
      } else this.eventQuiescencePolicyDomainMissCount += 1;
    }
    if (!seat && this.ownContinuationMode !== "full" && count > 0) {
      const continuation = this.currentOwnContinuation || this.ownContinuation;
      const wanted = continuation &&
          typeof continuation.routeAction === "function" ?
        continuation.routeAction(engine.adapter.state) : -1;
      let found = -1; let secondaryFound = -1; let secondaryWanted = -1;
      if (wanted > ACTION.NONE && wanted <= ACTION.BOOST_RIGHT_BOMB) {
        this.ownContinuationRouteCount += 1;
        for (let index = 0; index < count; index += 1)
          if (this.deepOurActions[top * DEEP_WIDTH + index] === wanted) {
            found = index; break;
          }
      } else this.ownContinuationRouteIncompleteCount += 1;
      if (this.ownContinuationMode === "portfolio") {
        const secondary = this.ownContinuationSecondary;
        secondaryWanted = secondary &&
            typeof secondary.routeAction === "function" ?
          secondary.routeAction(engine.adapter.state) : -1;
        if (secondaryWanted > ACTION.NONE &&
            secondaryWanted <= ACTION.BOOST_RIGHT_BOMB) {
          this.ownContinuationSecondaryRouteCount += 1;
          if (secondaryWanted === wanted)
            this.ownContinuationPortfolioDedupCount += 1;
          else for (let index = 0; index < count; index += 1)
            if (this.deepOurActions[top * DEEP_WIDTH + index] ===
                secondaryWanted) { secondaryFound = index; break; }
        } else this.ownContinuationSecondaryIncompleteCount += 1;
      }
      // A policy must remain total over the legal domain.  If its preferred
      // action is unavailable, use the generator's stable first legal action
      // instead of silently reopening the full Minimax branch.
      if (found < 0) {
        found = 0; this.ownContinuationDomainFallbackCount += 1;
      }
      const offset = top * DEEP_WIDTH;
      const selectedAction = this.deepOurActions[offset + found];
      const selectedArgument = this.deepOurArguments[offset + found];
      const secondaryAction = secondaryFound >= 0 ?
        this.deepOurActions[offset + secondaryFound] : ACTION.NONE;
      const secondaryArgument = secondaryFound >= 0 ?
        this.deepOurArguments[offset + secondaryFound] : 0xffff;
      this.deepOurActions[offset] = selectedAction;
      this.deepOurArguments[offset] = selectedArgument;
      count = 1;
      if (secondaryFound >= 0 && secondaryAction !== selectedAction) {
        this.deepOurActions[offset + 1] = secondaryAction;
        this.deepOurArguments[offset + 1] = secondaryArgument;
        count = 2;
      }
      this.deepOurCount[top] = count;
      this.ownContinuationPortfolioWidthCount[count] += 1;
      this.ownContinuationActionCount[this.deepOurActions[offset]] += 1;
      if (count === 2)
        this.ownContinuationActionCount[this.deepOurActions[offset + 1]] += 1;
    }
    if (seat) this.enemyExpansionCount += 1;
    else this.ownExpansionCount += 1;
    const actions = seat ? this.deepEnemyActions : this.deepOurActions;
    const offset = top * DEEP_WIDTH; const actionBase = seat * ACTION_WIDTH;
    for (let index = 0; index < count; index += 1)
      this.deepActionCount[actionBase + actions[offset + index]] += 1;
    return count;
  }

  recordPolicyEnvelopeLeaf(top) {
    if (this.currentContinuationPolicy === CONTINUATION_POLICY.BASE) return;
    if (this.pathPolicyAbort[top]) {
      this.currentPolicyEnvelopeAbortLeafCount += 1;
      this.policyEnvelopeAbortLeafCount += 1;
    } else if (this.pathPolicyEvent[top]) {
      this.currentPolicyEnvelopeEventLeafCount += 1;
      this.policyEnvelopeEventLeafCount += 1;
    } else if (this.pathPolicyRescue[top]) {
      this.currentPolicyEnvelopeRescueLeafCount += 1;
      this.policyEnvelopeRescueLeafCount += 1;
    } else {
      this.currentPolicyEnvelopeNoEventLeafCount += 1;
      this.policyEnvelopeNoEventLeafCount += 1;
    }
  }

  positionWalkable(state, cell, blocked = 0xffff) {
    if (cell === 0xffff || cell === blocked) return 0;
    const tile = state.arrays[ARRAY.TERRAIN][cell];
    return tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT ? 1 : 0;
  }

  positionAdvance(state, cell, direction, speed, blocked = 0xffff) {
    let result = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.targetCell(state, result, direction);
      if (!this.positionWalkable(state, next, blocked)) break;
      result = next;
    }
    return result;
  }

  positionBombHit(state, center, candidate) {
    const cx = state.x(center); const cy = state.y(center);
    const tx = state.x(candidate); const ty = state.y(candidate);
    if (cx === tx && cy === ty) return 1;
    if (cx !== tx && cy !== ty) return 0;
    const distance = Math.abs(cx - tx) + Math.abs(cy - ty);
    if (distance > RULE.BOMB_RANGE) return 0;
    const dx = tx === cx ? 0 : tx > cx ? 1 : -1;
    const dy = ty === cy ? 0 : ty > cy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN];
    for (let step = 1; step <= distance; step += 1) {
      const tile = terrain[state.cell(cx + dx * step, cy + dy * step)];
      if (tile === TERRAIN.WALL) return 0;
      if (tile === TERRAIN.DIRT) return step === distance ? 1 : 0;
    }
    return 1;
  }

  positionProjectileEscape(state, cell, direction, speed, bulletDirection) {
    const forward = this.positionAdvance(state, cell, direction, speed);
    if (forward !== cell && ((bulletDirection & 1) ?
      state.y(forward) !== state.y(cell) : state.x(forward) !== state.x(cell)))
      return 1;
    const left = this.positionAdvance(state, cell, (direction + 3) & 3, speed);
    const right = this.positionAdvance(state, cell, (direction + 1) & 3, speed);
    if (left !== cell && ((bulletDirection & 1) ?
      state.y(left) !== state.y(cell) : state.x(left) !== state.x(cell))) return 2;
    if (right !== cell && ((bulletDirection & 1) ?
      state.y(right) !== state.y(cell) : state.x(right) !== state.x(cell))) return 2;
    return 99;
  }

  positionSingleMuzzleRisk(state, shooter, shooterDirection, target,
    targetDirection, targetSpeed, canFire, boosted) {
    if (!canFire || shooter === 0xffff) return 0;
    const wanted = this.directionTo(state, shooter, target);
    const distance = this.distance(state, shooter, target);
    const lineOpen = wanted >= 0 && this.clearLine(state, shooter, target);
    if (wanted >= 0 && lineOpen) {
      const delta = Math.abs(shooterDirection - wanted);
      const turns = Math.min(delta, 4 - delta);
      if (turns === 0 && distance <= 2)
        return this.positionProjectileEscape(state, target, targetDirection,
          targetSpeed, shooterDirection) <= 1 ? 1200 : 50000;
      if (turns === 0 && distance <= 4) {
        const frames = (distance + 1) >> 1;
        const escape = this.positionProjectileEscape(state, target,
          targetDirection, targetSpeed, shooterDirection) <= frames;
        if (distance === 3) return escape ? 4000 : 22000;
        return escape ? 1800 : 10000;
      }
      if (boosted && turns === 1 && distance <= 2) return 35000;
      if (distance === 1) return 1200;
    }
    if (distance <= 2) return 650;
    if (distance === 3) return 400;
    return 0;
  }

  positionMuzzleRisk(state, target, targetDirection, targetSpeed) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const shooter = a[ARRAY.TANK_CELL][1];
    const shooterDirection = a[ARRAY.TANK_DIR][1];
    const canFire = this.canFire(state, 1);
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
    let risk = this.positionSingleMuzzleRisk(state, shooter, shooterDirection,
      target, targetDirection, targetSpeed, canFire, boosted);
    const overloaded = a[ARRAY.TANK_OVERLOAD_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_OVERLOAD_UNTIL][1] > frame;
    if (!overloaded || !canFire) return risk;
    const horizontal = shooterDirection === 1 || shooterDirection === 3;
    const x = state.x(shooter) + (horizontal ? 0 : 1);
    const y = state.y(shooter) + (horizontal ? 1 : 0);
    const secondary = x < 0 || x >= state.width || y < 0 || y >= state.height ?
      0xffff : state.cell(x, y);
    return Math.max(risk, this.positionSingleMuzzleRisk(state, secondary,
      shooterDirection, target, targetDirection, targetSpeed, canFire, boosted));
  }

  positionEdgePenalty(state, cell, direction) {
    const a = state.arrays; const enemy = a[ARRAY.TANK_CELL][1];
    const x = state.x(cell); const y = state.y(cell);
    const ring = Math.max(0, Math.min(x - 1, state.width - 2 - x,
      y - 1, state.height - 2 - y));
    let exits = 0;
    for (let axis = 0; axis < 4; axis += 1)
      exits += this.positionWalkable(state,
        this.targetCell(state, cell, axis), 0xffff);
    let penalty = ring <= 1 ? 105 : ring === 2 ? 48 : ring === 3 ? 16 : 0;
    if (exits <= 1) penalty += 145;
    else if (exits === 2) penalty += ring <= 2 ? 58 : 26;
    if (ring <= 2 && !this.positionWalkable(state,
      this.targetCell(state, cell, direction), 0xffff)) penalty += 34;
    const pressureDistance = this.distance(state, cell, enemy);
    if (pressureDistance <= 3) penalty *= 1.65;
    else if (pressureDistance <= 5) penalty *= 1.3;
    if (a[ARRAY.TANK_STARS][0] > a[ARRAY.TANK_STARS][1]) penalty *= 1.35;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star !== 0xffff && this.distance(state, cell, star) <= 2) penalty *= 0.5;
    return penalty;
  }

  positionImmediateRisk(state, cell, direction) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let risk = 0;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1) {
      if (!a[ARRAY.BOMB_ACTIVE][slot] ||
          !this.positionBombHit(state, a[ARRAY.BOMB_CELL][slot], cell)) continue;
      const remaining = a[ARRAY.BOMB_EXPLODE][slot] - frame;
      if (remaining <= 0) return 100000;
      risk = Math.max(risk, Math.max(250, 9000 / (remaining + 1)));
    }
    const speed = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][0] > frame ? 2 : 1;
    risk += this.positionMuzzleRisk(state, cell, direction, speed);
    return risk + this.positionEdgePenalty(state, cell, direction) * 0.2;
  }

  v1OwnChance(state, action) {
    this.v1OwnChanceCheckCount += 1;
    if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
        action !== ACTION.TURN_RIGHT) return CHANCE.NORMAL;
    const a = state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    const direction = a[ARRAY.TANK_DIR][0];
    let normalCell = cell; let reverseCell = cell;
    let normalDirection = direction; let reverseDirection = direction;
    if (action === ACTION.GO) {
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const speed = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_BOOST_UNTIL][0] > frame ? 2 : 1;
      normalCell = this.positionAdvance(state, cell, direction, speed,
        a[ARRAY.TANK_CELL][1]);
      reverseCell = this.positionAdvance(state, cell, (direction + 2) & 3,
        speed, a[ARRAY.TANK_CELL][1]);
    } else {
      const amount = action === ACTION.TURN_LEFT ? 3 : 1;
      normalDirection = (direction + amount) & 3;
      reverseDirection = (direction + (4 - amount)) & 3;
    }
    const normalRisk = this.positionImmediateRisk(state, normalCell,
      normalDirection);
    const reverseRisk = this.positionImmediateRisk(state, reverseCell,
      reverseDirection);
    if (reverseRisk >= normalRisk) {
      this.v1OwnReversedCount += 1; return CHANCE.REVERSED;
    }
    return CHANCE.NORMAL;
  }

  transitionValue(engine, action0, argument0, action1, argument1, depth, top,
    pathScore = 0, nominalPathScore = pathScore) {
    this.jointTransitionCount += 1;
    const bundle = engine.adapter.bundle; const state = bundle.state;
    const previousAction = top > 1 ? this.pathAction[top - 1] :
      (engine.lastAction ?? ACTION.NONE);
    const previousTurnStreak = top > 1 ? this.pathTurnStreak[top - 1] :
      (engine.turnStreak | 0);
    const turning = action0 === ACTION.TURN_LEFT || action0 === ACTION.TURN_RIGHT;
    this.pathAction[top] = action0;
    this.pathTurnStreak[top] = turning ? Math.min(255, previousTurnStreak + 1) : 0;
    this.pathPolicyEvent[top] = ((top > 1 ? this.pathPolicyEvent[top - 1] : 0) ||
      action0 === ACTION.FIRE) ? 1 : 0;
    this.pathPolicyAbort[top] = top > 1 &&
      (this.pathPolicyAbort[top - 1] || this.policyEnvelopeAbortNode[top - 1]) ?
      1 : 0;
    this.pathPolicyRescue[top] = top > 1 &&
      (this.pathPolicyRescue[top - 1] || this.policyEnvelopeRescueNode[top - 1]) ?
      1 : 0;
    const actionScore = this.pathUtility ? this.pathUtility.scoreTransition(state,
      action0, action1, previousAction, previousTurnStreak, top) : 0;
    const baseNextPathScore = pathScore + actionScore;
    const baseNextNominalPathScore = nominalPathScore + actionScore;
    let ownChance = engine.depthSearch.chanceAlternatives(state, 0, action0);
    let ownDeterministicChance = CHANCE.NORMAL;
    if (this.ownChanceMode === "v1-deterministic" && ownChance > 1) {
      ownDeterministicChance = this.v1OwnChance(state, action0);
      ownChance = 1;
    }
    const enemyChance = engine.depthSearch.chanceAlternatives(state, 1, action1);
    let sum = 0; let nominalSum = 0; let count = 0;
    let worstOwn = VALUE_MAX; let worstOwnNominal = VALUE_MAX;
    for (let own = 0; own < ownChance; own += 1) {
      let ownSum = 0; let ownNominalSum = 0; let ownCount = 0;
      for (let enemy = 0; enemy < enemyChance; enemy += 1) {
        this.chanceOutcomeCount += 1;
        const mark = state.deltaUsed * 1024 + state.eventUsed;
        const appliedPathToken = this.pathUtility &&
            typeof this.pathUtility.prepareAppliedTransition === "function" ?
          this.pathUtility.prepareAppliedTransition(state, action0) : 0xffffffff;
        const beforeFrame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        const status = this.diagnosticKernel.applyFrame(action0, argument0,
          action1, argument1, ownChance === 1 ? ownDeterministicChance : own,
          enemyChance === 1 ? CHANCE.NORMAL : enemy);
        let value; let nominalValue; let leaf = 0;
        let nextPathScore = baseNextPathScore;
        let nextNominalPathScore = baseNextNominalPathScore;
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          value = -22000; nominalValue = value; this.fastIncompleteCount += 1;
          leaf = 1;
        } else {
          this.extendV1StunCountdown(state, action0, action1, beforeFrame);
          if (this.pathUtility &&
              typeof this.pathUtility.scoreAppliedTransition === "function") {
            const appliedScore = this.pathUtility.scoreAppliedTransition(state,
              action0, action1, enemyChance === 1 ? CHANCE.NORMAL : enemy,
              appliedPathToken);
            nextNominalPathScore += appliedScore;
            if (this.pathEvidenceMode !== "split-nominal")
              nextPathScore += appliedScore;
          }
          if (top === 1 && this.currentRootMatrixIndex >= 0)
            this.rootTradeClass[this.currentRootMatrixIndex] =
              this.terminalTradeClass(state);
          const superko = this.superkoPenalty(state, top);
          nextPathScore -= superko; nextNominalPathScore -= superko;
          const terminal = state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
          const hard = this.deepHardMode === "terminal-only" ? HARD_STATUS.ALLOW :
            this.diagnosticHard.classifyApplied();
          if (hard === HARD_STATUS.ALLOW) this.hardAllowCount += 1;
          else if (hard === HARD_STATUS.REJECT_PROVEN)
            this.hardRejectProvenCount += 1;
          else if (hard === HARD_STATUS.REJECT_POLICY)
            this.hardRejectPolicyCount += 1;
          else if (hard === HARD_STATUS.INCOMPLETE) this.hardIncompleteCount += 1;
          if (terminal && terminal !== TERMINAL.INCOMPLETE) {
            const a = state.arrays;
            const combat = a[ARRAY.TANK_CRASH][0] || a[ARRAY.TANK_CRASH][1];
            if (combat) {
              this.combatTerminalCount += 1;
              if (a[ARRAY.TANK_CRASH][0] && a[ARRAY.TANK_CRASH][1])
                this.mutualCombatTerminalCount += 1;
            } else this.recordTerminalCount += 1;
            value = this.pairedTerminalUtility(engine, terminal, depth,
              nextPathScore, nextNominalPathScore, top);
            nominalValue = this.lastNominalValue;
            this.terminalCount += 1;
            leaf = 1;
          } else if (hard === HARD_STATUS.REJECT_PROVEN) {
            value = -30000; nominalValue = value; leaf = 1;
          } else if (hard === HARD_STATUS.REJECT_POLICY && this.deepHardMode === "full") {
            value = -29000; nominalValue = value; leaf = 1;
          }
          else if (hard === HARD_STATUS.INCOMPLETE) {
            value = this.pairedLeaf(engine, nextPathScore,
              nextNominalPathScore, top) -
              (this.deepHardMode === "full" ? 6000 : 0);
            nominalValue = this.lastNominalValue -
              (this.deepHardMode === "full" ? 6000 : 0);
            leaf = 1;
          } else {
            value = this.policyValue(engine, depth - 1, top, nextPathScore,
              nextNominalPathScore);
            nominalValue = this.lastNominalValue;
          }
        }
        if (leaf) this.recordPolicyEnvelopeLeaf(top);
        state.undoTo(mark); sum += value; nominalSum += nominalValue; count += 1;
        ownSum += value; ownNominalSum += nominalValue; ownCount += 1;
        if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
      }
      if (ownCount) {
        const ownValue = Math.trunc(ownSum / ownCount);
        const ownNominal = Math.trunc(ownNominalSum / ownCount);
        if (count === ownCount || ownValue < worstOwn || ownValue === worstOwn &&
            ownNominal < worstOwnNominal) {
          worstOwn = ownValue; worstOwnNominal = ownNominal;
        }
      }
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      this.recordPolicyEnvelopeLeaf(top);
      return this.pairedLeaf(engine, baseNextPathScore,
        baseNextNominalPathScore, top);
    }
    if (this.ownChanceMode === "worst") {
      this.lastNominalValue = worstOwnNominal; return worstOwn;
    }
    this.lastNominalValue = Math.trunc(nominalSum / count);
    return Math.trunc(sum / count);
  }

  worstReply(engine, action0, argument0, depth, top, pathScore,
    nominalPathScore) {
    const count = this.generate(engine, top, 1); const offset = top * DEEP_WIDTH;
    let worst = VALUE_MAX; let nominalWorst = VALUE_MAX;
    let sum = 0; let nominalSum = 0; let weightTotal = 0;
    for (let column = 0; column < count; column += 1) {
      const weight = this.opponentWeight(engine, engine.adapter.state,
        this.deepEnemyActions[offset + column]);
      const value = this.transitionValue(engine, action0, argument0,
        this.deepEnemyActions[offset + column],
        this.deepEnemyArguments[offset + column], depth, top + 1, pathScore,
        nominalPathScore);
      const nominal = this.lastNominalValue;
      if (column === 0 || value < worst || value === worst && nominal < nominalWorst) {
        worst = value; nominalWorst = nominal;
      }
      sum += value * weight; nominalSum += nominal * weight; weightTotal += weight;
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      this.noActionLeafCount += 1;
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    this.lastNominalValue = this.blended(nominalWorst, nominalSum, weightTotal);
    return this.blended(worst, sum, weightTotal);
  }

  policyValue(engine, depth, top, pathScore, nominalPathScore) {
    this.nodes += 1;
    let routedEventExtension = 0;
    if (depth <= 0 &&
        this.eventQuiescenceMode !== EVENT_QUIESCENCE.OFF) {
      this.eventQuiescenceCheckCount += 1;
      const eventMask = this.eventInstabilityMask(engine.adapter.state);
      if (!eventMask) this.eventQuiescenceQuietLeafCount += 1;
      else {
        if (eventMask & 1) this.eventQuiescenceProjectileLeafCount += 1;
        if (eventMask & 2) this.eventQuiescenceBombLeafCount += 1;
        const extraPly = Math.max(0, top - this.currentDepth);
        if (extraPly < this.eventQuiescenceMaximumPly && top < 4 &&
            this.nodes < this.perRootBudget) {
          let continuationReady = 1;
          if (this.eventQuiescenceContinuationMode === "base-policy") {
            const continuation = this.eventQuiescenceContinuation;
            const action = continuation &&
                typeof continuation.routeAction === "function" ?
              continuation.routeAction(engine.adapter.state) : -1;
            if (action > ACTION.NONE && action <= ACTION.BOOST_RIGHT_BOMB) {
              this.eventQuiescencePolicyRouteCount += 1;
              this.eventQuiescenceRoutedAction = action;
              routedEventExtension = 1;
            } else {
              continuationReady = 0;
              this.eventQuiescencePolicyRouteIncompleteCount += 1;
            }
          }
          if (continuationReady) {
            depth = 1;
            this.eventQuiescenceExpansionCount += 1;
            this.eventQuiescenceExpansionByPly[extraPly + 1] += 1;
          } else this.eventQuiescenceCappedLeafCount += 1;
        } else this.eventQuiescenceCappedLeafCount += 1;
      }
    }
    this.policyNodeDepthCount[Math.max(0, Math.min(4, depth))] += 1;
    if (depth <= 0 || this.nodes >= this.perRootBudget || top >= 4) {
      if (depth <= 0 && this.hardBudgetInterrupt) {
        this.depthLeafCount += 1;
        if (this.nodes >= this.perRootBudget) {
          // The current leaf is valid, but evaluating any sibling would exceed
          // the shared allowance.  Mark the attempted layer incomplete rather
          // than publishing a matrix whose final cells depend on loop order.
          this.leafBudgetCount += 1;
          this.iterationBudgetInterrupted = 1;
          this.hardBudgetInterruptCount += 1;
        }
      }
      else if (this.nodes >= this.perRootBudget) {
        this.leafBudgetCount += 1;
        if (this.hardBudgetInterrupt) {
          this.iterationBudgetInterrupted = 1;
          this.hardBudgetInterruptCount += 1;
        }
      }
      else if (depth <= 0) this.depthLeafCount += 1;
      else this.topLeafCount += 1;
      this.recordPolicyEnvelopeLeaf(top);
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    if (routedEventExtension) this.eventQuiescenceRoutingTop = top;
    const count = this.generate(engine, top, 0); const offset = top * DEEP_WIDTH;
    this.eventQuiescenceRoutingTop = -1;
    let best = VALUE_MIN; let nominalBest = VALUE_MIN;
    for (let row = 0; row < count; row += 1) {
      const value = this.worstReply(engine, this.deepOurActions[offset + row],
        this.deepOurArguments[offset + row], depth, top, pathScore,
        nominalPathScore);
      const nominal = this.lastNominalValue;
      if (row === 0 || value > best || value === best && nominal > nominalBest) {
        best = value; nominalBest = nominal;
      }
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (!count) {
      this.noActionLeafCount += 1;
      this.recordPolicyEnvelopeLeaf(top);
      return this.pairedLeaf(engine, pathScore, nominalPathScore, top);
    }
    this.lastNominalValue = nominalBest; return best;
  }

  rootCell(engine, row, column) {
    this.currentRootMatrixIndex = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
    const value = this.transitionValue(engine, engine.ourActions[row],
      engine.ourArguments[row], engine.enemyActions[column],
      engine.enemyArguments[column], this.currentDepth, 1, 0, 0);
    this.currentRootMatrixIndex = -1;
    return value;
  }

  rootColumnIndex(step, count) {
    if (this.rootColumnOrder === "v1") return this.rootColumnSequence[step];
    return this.rootColumnOrder === "reverse" ? count - 1 - step : step;
  }

  buildRootColumnSequence(engine) {
    const count = engine.enemyCount;
    this.rootColumnUsed.fill(0, 0, count);
    let output = 0;
    if (this.rootColumnOrder === "v1")
      for (let order = 0; order < V1_ENEMY_ROOT_ORDER.length; order += 1)
        for (let column = 0; column < count; column += 1)
          if (!this.rootColumnUsed[column] && this.rootEnemyDomainMask[column] &&
              engine.enemyActions[column] === V1_ENEMY_ROOT_ORDER[order]) {
            this.rootColumnSequence[output++] = column;
            this.rootColumnUsed[column] = 1;
          }
    for (let column = 0; column < count; column += 1)
      if (!this.rootColumnUsed[column]) {
        this.rootColumnSequence[output++] = column;
        this.rootColumnUsed[column] = 1;
      }
    return output;
  }

  evaluateSyntheticRoot(engine, action, argument, incumbentRow) {
    this.syntheticRootEvaluationCount += 1;
    this.syntheticRootAction = action;
    this.syntheticRootArgument = argument;
    this.syntheticRootValue = VALUE_MIN;
    this.syntheticRootWorst = VALUE_MIN;
    this.syntheticRootSupportCount = 0;
    this.syntheticRootCellScore.fill(VALUE_MIN);
    const bundle = engine?.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || !this.representativeSupportComplete ||
        incumbentRow < 0 || incumbentRow >= engine.ourCount ||
        !this.diagnosticKernel || !this.diagnosticHard) {
      this.syntheticRootIncompleteCount += 1; return 0;
    }
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    const savedNodes = this.nodes; const savedIndex = this.currentRootMatrixIndex;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    let worst = VALUE_MAX; let sum = 0; let weightTotal = 0;
    this.nodes = 0; this.currentRootMatrixIndex = -1;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (!this.rootEnemyDomainMask[column]) continue;
      const weight = this.opponentWeight(engine, state,
        engine.enemyActions[column]);
      const value = this.transitionValue(engine, action, argument,
        engine.enemyActions[column], engine.enemyArguments[column],
        this.currentDepth, 1, 0);
      this.syntheticRootCellScore[column] = value;
      if (value < worst) worst = value;
      sum += value * weight; weightTotal += weight;
      this.syntheticRootSupportCount += 1;
    }
    const runNodes = this.nodes;
    state.undoTo(mark);
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    this.nodes = savedNodes; this.currentRootMatrixIndex = savedIndex;
    this.syntheticRootNodeCount += runNodes;
    this.totalNodes += runNodes;
    if (runNodes > this.syntheticRootMaximumNodes)
      this.syntheticRootMaximumNodes = runNodes;
    const restored = state.hashLo === hashLo && state.hashHi === hashHi &&
      state.deltaUsed * 1024 + state.eventUsed === mark;
    if (!restored) {
      this.syntheticRootRestoreFailureCount += 1;
      this.rootRestoreFailureCount += 1;
    }
    const complete = restored && this.syntheticRootSupportCount > 0 &&
      this.fastIncompleteCount === fastIncompleteBefore &&
      this.hardIncompleteCount === hardIncompleteBefore;
    if (!complete) {
      this.syntheticRootIncompleteCount += 1; return 0;
    }
    this.syntheticRootWorst = worst;
    this.syntheticRootValue = this.blended(worst, sum, weightTotal);
    this.syntheticRootCompleteCount += 1;
    return 1;
  }

  evaluateSyntheticResourceOption(engine, action, argument, incumbentRow,
      depth = 4, nodeBudget = 2048, feedbackMode = "representative") {
    this.resourceOptionEvaluationCount += 1;
    this.resourceOptionDepth = Math.max(2, Math.min(4, depth | 0));
    this.resourceOptionNodeBudget = Math.max(64,
      Math.min(4096, nodeBudget | 0));
    this.resourceOptionFeedbackMode = feedbackMode === "v1-shaped" ?
      "v1-shaped" : "representative";
    this.resourceOptionBaseWorst = VALUE_MIN;
    this.resourceOptionCandidateWorst = VALUE_MIN;
    this.resourceOptionBaseValue = VALUE_MIN;
    this.resourceOptionCandidateValue = VALUE_MIN;
    this.resourceBaseCellLower.fill(VALUE_MIN);
    this.resourceBaseCellUpper.fill(VALUE_MAX);
    this.resourceCandidateCellLower.fill(VALUE_MIN);
    this.resourceCandidateCellUpper.fill(VALUE_MAX);
    const bundle = engine?.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || !this.representativeSupportComplete ||
        incumbentRow < 0 || incumbentRow >= engine.ourCount ||
        !this.diagnosticKernel || !this.diagnosticHard) {
      this.resourceOptionIncompleteCount += 1; return 0;
    }
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    const savedDepth = this.currentDepth; const savedBudget = this.perRootBudget;
    const savedFullPrimitiveDomain = this.fullPrimitiveDomain;
    const savedDeepDomainMode = this.deepDomainMode;
    const savedDeepFireMode = this.deepFireMode;
    const savedNodes = this.nodes; const savedIndex = this.currentRootMatrixIndex;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    const budgetLeafBefore = this.leafBudgetCount;
    this.currentDepth = this.resourceOptionDepth;
    this.perRootBudget = this.resourceOptionNodeBudget;
    if (this.resourceOptionFeedbackMode === "v1-shaped") {
      this.fullPrimitiveDomain = true;
      this.deepDomainMode = "v1-shaped";
      this.deepFireMode = "v1-own";
    }
    this.currentRootMatrixIndex = -1;
    let totalNodes = 0; let supportedColumns = 0;
    let baseWorst = VALUE_MAX; let baseSum = 0; let baseWeightTotal = 0;
    let candidateWorst = VALUE_MAX; let candidateSum = 0;
    let candidateWeightTotal = 0;
    for (let policy = 0; policy < 2; policy += 1) {
      this.nodes = 0;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        if (!this.rootEnemyDomainMask[column]) continue;
        const weight = this.opponentWeight(engine, state,
          engine.enemyActions[column]);
        const ownAction = policy ? action : engine.ourActions[incumbentRow];
        const ownArgument = policy ? argument : engine.ourArguments[incumbentRow];
        const value = this.transitionValue(engine, ownAction, ownArgument,
          engine.enemyActions[column], engine.enemyArguments[column],
          this.currentDepth, 1, 0);
        if (policy) {
          this.resourceCandidateCellLower[column] = value;
          this.resourceCandidateCellUpper[column] = value;
          if (value < candidateWorst) candidateWorst = value;
          candidateSum += value * weight; candidateWeightTotal += weight;
        } else {
          this.resourceBaseCellLower[column] = value;
          this.resourceBaseCellUpper[column] = value;
          if (value < baseWorst) baseWorst = value;
          baseSum += value * weight; baseWeightTotal += weight;
          supportedColumns += 1;
        }
      }
      totalNodes += this.nodes;
      state.undoTo(mark);
      kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
      kernel.appliedActionCount = kernelApplied;
      kernel.hardCheckedActionCount = kernelHardChecked;
      state.transitionDeltaBase = transitionDeltaBase;
      state.transitionEventBase = transitionEventBase;
      state.highWaterDelta = highWaterDelta;
      state.highWaterEvent = highWaterEvent;
    }
    this.currentDepth = savedDepth; this.perRootBudget = savedBudget;
    this.fullPrimitiveDomain = savedFullPrimitiveDomain;
    this.deepDomainMode = savedDeepDomainMode;
    this.deepFireMode = savedDeepFireMode;
    this.nodes = savedNodes; this.currentRootMatrixIndex = savedIndex;
    this.resourceOptionNodeCount += totalNodes;
    if (totalNodes > this.resourceOptionMaximumNodes)
      this.resourceOptionMaximumNodes = totalNodes;
    const restored = state.hashLo === hashLo && state.hashHi === hashHi &&
      state.deltaUsed * 1024 + state.eventUsed === mark;
    if (!restored) {
      this.resourceOptionRestoreFailureCount += 1;
      this.rootRestoreFailureCount += 1;
    }
    const budgetIncomplete = this.leafBudgetCount !== budgetLeafBefore;
    if (budgetIncomplete) this.resourceOptionBudgetIncompleteCount += 1;
    const complete = restored && supportedColumns > 0 && !budgetIncomplete &&
      this.fastIncompleteCount === fastIncompleteBefore &&
      this.hardIncompleteCount === hardIncompleteBefore;
    if (!complete) {
      // Do not expose heuristic point estimates as exact option intervals.
      this.resourceBaseCellLower.fill(VALUE_MIN);
      this.resourceBaseCellUpper.fill(VALUE_MAX);
      this.resourceCandidateCellLower.fill(VALUE_MIN);
      this.resourceCandidateCellUpper.fill(VALUE_MAX);
      this.resourceOptionIncompleteCount += 1; return 0;
    }
    this.resourceOptionBaseWorst = baseWorst;
    this.resourceOptionCandidateWorst = candidateWorst;
    this.resourceOptionBaseValue = this.blended(baseWorst, baseSum,
      baseWeightTotal);
    this.resourceOptionCandidateValue = this.blended(candidateWorst,
      candidateSum, candidateWeightTotal);
    this.resourceOptionCompleteCount += 1;
    return 1;
  }

  evaluatePolicyResponseEnvelope(engine, baseAction, baseArgument,
      candidateAction, candidateArgument,
      continuationGenerator, policyId, targetSignature, depth = 3,
      nodeBudget = 768, preparedBaseRow = -1,
      requirePreparedBase = false) {
    this.policyEnvelopeEvaluationCount += 1;
    this.policyEnvelopeDepth = Math.max(2, Math.min(4, depth | 0));
    this.policyEnvelopeNodeBudget = Math.max(64,
      Math.min(4096, nodeBudget | 0));
    this.policyEnvelopePolicyId = policyId | 0;
    this.policyEnvelopeTargetSignature = targetSignature >>> 0;
    this.policyEnvelopeBaseWorst = VALUE_MIN;
    this.policyEnvelopeCandidateWorst = VALUE_MIN;
    this.policyEnvelopeBaseValue = VALUE_MIN;
    this.policyEnvelopeCandidateValue = VALUE_MIN;
    this.policyEnvelopeBaseCellLower.fill(VALUE_MIN);
    this.policyEnvelopeBaseCellUpper.fill(VALUE_MAX);
    this.policyEnvelopeCandidateCellLower.fill(VALUE_MIN);
    this.policyEnvelopeCandidateCellUpper.fill(VALUE_MAX);
    const bundle = engine?.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || !this.representativeSupportComplete ||
        baseAction < ACTION.NONE || baseAction > ACTION.BOOST_RIGHT_BOMB ||
        candidateAction < ACTION.NONE ||
        candidateAction > ACTION.BOOST_RIGHT_BOMB || !continuationGenerator ||
        policyId === CONTINUATION_POLICY.BASE || !targetSignature ||
        !this.diagnosticKernel || !this.diagnosticHard ||
        requirePreparedBase && preparedBaseRow < 0) {
      this.policyEnvelopeIncompleteCount += 1; return 0;
    }
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    const savedDepth = this.currentDepth; const savedBudget = this.perRootBudget;
    const savedNodes = this.nodes; const savedIndex = this.currentRootMatrixIndex;
    const savedPolicy = this.currentContinuationPolicy;
    const savedGenerator = this.currentContinuationGenerator;
    const savedContinuationIncomplete = this.currentContinuationIncomplete;
    const savedEventLeafCount = this.currentPolicyEnvelopeEventLeafCount;
    const savedNoEventLeafCount = this.currentPolicyEnvelopeNoEventLeafCount;
    const savedAbortLeafCount = this.currentPolicyEnvelopeAbortLeafCount;
    const savedRescueLeafCount = this.currentPolicyEnvelopeRescueLeafCount;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    const budgetLeafBefore = this.leafBudgetCount;
    this.currentDepth = this.policyEnvelopeDepth;
    this.perRootBudget = this.policyEnvelopeNodeBudget;
    this.currentRootMatrixIndex = -1;
    let totalNodes = 0; let supportedColumns = 0;
    let baseWorst = VALUE_MAX; let baseSum = 0; let baseWeightTotal = 0;
    let candidateWorst = VALUE_MAX; let candidateSum = 0;
    let candidateWeightTotal = 0; let continuationIncomplete = 0;
    let firstPolicy = 0;
    if (preparedBaseRow >= 0) {
      const block = preparedBaseRow < this.rowExactBlockMask.length ?
        this.rowExactBlockMask[preparedBaseRow] : EXACT_BLOCK.NO_ACTION_LEAF;
      const nonHorizonBlock = block & ~EXACT_BLOCK.DEPTH_LEAF;
      const depthMatches = savedDepth === this.policyEnvelopeDepth;
      const domainPresent = preparedBaseRow < engine.ourCount &&
        this.rootDomainMask[preparedBaseRow];
      if (block >= 0 && block < this.policyEnvelopePreparedBaseBlockMaskCount.length)
        this.policyEnvelopePreparedBaseBlockMaskCount[block] += 1;
      if (!depthMatches) this.policyEnvelopePreparedBaseDepthMismatchCount += 1;
      if (!domainPresent) this.policyEnvelopePreparedBaseDomainMissingCount += 1;
      if (!depthMatches || !domainPresent || nonHorizonBlock) {
        this.policyEnvelopePreparedBaseBlockedCount += 1;
        if (requirePreparedBase) {
          this.currentDepth = savedDepth; this.perRootBudget = savedBudget;
          this.nodes = savedNodes; this.currentRootMatrixIndex = savedIndex;
          this.currentContinuationPolicy = savedPolicy;
          this.currentContinuationGenerator = savedGenerator;
          this.currentContinuationIncomplete = savedContinuationIncomplete;
          this.currentPolicyEnvelopeEventLeafCount = savedEventLeafCount;
          this.currentPolicyEnvelopeNoEventLeafCount = savedNoEventLeafCount;
          this.currentPolicyEnvelopeAbortLeafCount = savedAbortLeafCount;
          this.currentPolicyEnvelopeRescueLeafCount = savedRescueLeafCount;
          this.policyEnvelopeIncompleteCount += 1; return 0;
        }
      } else {
        firstPolicy = 1; this.policyEnvelopePreparedBaseReuseCount += 1;
        const offset = preparedBaseRow *
          SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
        for (let column = 0; column < engine.enemyCount; column += 1) {
          if (!this.rootEnemyDomainMask[column]) continue;
          const value = this.rootCellScore[offset + column];
          const weight = this.opponentWeight(engine, state,
            engine.enemyActions[column]);
          this.policyEnvelopeBaseCellLower[column] = value;
          this.policyEnvelopeBaseCellUpper[column] = value;
          if (value < baseWorst) baseWorst = value;
          baseSum += value * weight; baseWeightTotal += weight;
          supportedColumns += 1;
        }
      }
    }
    for (let policy = firstPolicy; policy < 2; policy += 1) {
      this.nodes = 0;
      this.currentContinuationPolicy = policy ? policyId : CONTINUATION_POLICY.BASE;
      this.currentContinuationGenerator = policy ? continuationGenerator : null;
      this.currentContinuationIncomplete = 0;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        if (!this.rootEnemyDomainMask[column]) continue;
        this.currentPolicyEnvelopeEventLeafCount = 0;
        this.currentPolicyEnvelopeNoEventLeafCount = 0;
        this.currentPolicyEnvelopeAbortLeafCount = 0;
        this.currentPolicyEnvelopeRescueLeafCount = 0;
        const weight = this.opponentWeight(engine, state,
          engine.enemyActions[column]);
        const ownAction = policy ? candidateAction : baseAction;
        const ownArgument = policy ? candidateArgument : baseArgument;
        const value = this.transitionValue(engine, ownAction,
          ownArgument, engine.enemyActions[column],
          engine.enemyArguments[column], this.currentDepth, 1, 0);
        if (policy) {
          this.policyEnvelopeCandidateCellLower[column] = value;
          this.policyEnvelopeCandidateCellUpper[column] = value;
          if (value < candidateWorst) candidateWorst = value;
          candidateSum += value * weight; candidateWeightTotal += weight;
          const covered = !this.currentPolicyEnvelopeNoEventLeafCount &&
            !this.currentPolicyEnvelopeAbortLeafCount &&
            this.currentPolicyEnvelopeEventLeafCount +
              this.currentPolicyEnvelopeRescueLeafCount > 0;
          this.policyEnvelopeCandidateEventComplete[column] = covered ? 1 : 0;
          if (covered) this.policyEnvelopeEventCompleteColumnCount += 1;
          else this.policyEnvelopeEventIncompleteColumnCount += 1;
        } else {
          this.policyEnvelopeBaseCellLower[column] = value;
          this.policyEnvelopeBaseCellUpper[column] = value;
          if (value < baseWorst) baseWorst = value;
          baseSum += value * weight; baseWeightTotal += weight;
          supportedColumns += 1;
        }
      }
      continuationIncomplete |= this.currentContinuationIncomplete;
      totalNodes += this.nodes;
      state.undoTo(mark);
      kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
      kernel.appliedActionCount = kernelApplied;
      kernel.hardCheckedActionCount = kernelHardChecked;
      state.transitionDeltaBase = transitionDeltaBase;
      state.transitionEventBase = transitionEventBase;
      state.highWaterDelta = highWaterDelta;
      state.highWaterEvent = highWaterEvent;
    }
    this.currentDepth = savedDepth; this.perRootBudget = savedBudget;
    this.nodes = savedNodes; this.currentRootMatrixIndex = savedIndex;
    this.currentContinuationPolicy = savedPolicy;
    this.currentContinuationGenerator = savedGenerator;
    this.currentContinuationIncomplete = savedContinuationIncomplete;
    this.currentPolicyEnvelopeEventLeafCount = savedEventLeafCount;
    this.currentPolicyEnvelopeNoEventLeafCount = savedNoEventLeafCount;
    this.currentPolicyEnvelopeAbortLeafCount = savedAbortLeafCount;
    this.currentPolicyEnvelopeRescueLeafCount = savedRescueLeafCount;
    this.policyEnvelopeNodeCount += totalNodes;
    if (totalNodes > this.policyEnvelopeMaximumNodes)
      this.policyEnvelopeMaximumNodes = totalNodes;
    const restored = state.hashLo === hashLo && state.hashHi === hashHi &&
      state.deltaUsed * 1024 + state.eventUsed === mark;
    if (!restored) {
      this.policyEnvelopeRestoreFailureCount += 1;
      this.rootRestoreFailureCount += 1;
    }
    const budgetIncomplete = this.leafBudgetCount !== budgetLeafBefore;
    if (budgetIncomplete) this.policyEnvelopeBudgetIncompleteCount += 1;
    if (continuationIncomplete)
      this.policyEnvelopeContinuationIncompleteCount += 1;
    const complete = restored && supportedColumns > 0 && !budgetIncomplete &&
      !continuationIncomplete &&
      this.fastIncompleteCount === fastIncompleteBefore &&
      this.hardIncompleteCount === hardIncompleteBefore;
    if (!complete) {
      this.policyEnvelopeBaseCellLower.fill(VALUE_MIN);
      this.policyEnvelopeBaseCellUpper.fill(VALUE_MAX);
      this.policyEnvelopeCandidateCellLower.fill(VALUE_MIN);
      this.policyEnvelopeCandidateCellUpper.fill(VALUE_MAX);
      this.policyEnvelopeIncompleteCount += 1; return 0;
    }
    this.policyEnvelopeBaseWorst = baseWorst;
    this.policyEnvelopeCandidateWorst = candidateWorst;
    this.policyEnvelopeBaseValue = this.blended(baseWorst, baseSum,
      baseWeightTotal);
    this.policyEnvelopeCandidateValue = this.blended(candidateWorst,
      candidateSum, candidateWeightTotal);
    this.policyEnvelopeCompleteCount += 1;
    return 1;
  }

  compareTerminalRows(engine, selected, baseRow, depth = 4, nodeBudget = 512) {
    const bundle = engine?.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || selected < 0 || baseRow < 0 ||
        selected >= engine.ourCount || baseRow >= engine.ourCount) return 0;
    this.pairedTerminalAuditCount += 1;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta;
    const highWaterEvent = state.highWaterEvent;
    const savedDepth = this.currentDepth; const savedBudget = this.perRootBudget;
    const savedNodes = this.nodes; const savedIndex = this.currentRootMatrixIndex;
    const budgetLeafBefore = this.leafBudgetCount;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    this.currentDepth = Math.max(2, Math.min(8, depth | 0));
    this.perRootBudget = Math.max(32, Math.min(8192, nodeBudget | 0));
    this.currentRootMatrixIndex = -1;
    let totalNodes = 0; let selectedWorst = VALUE_MAX; let baseWorst = VALUE_MAX;
    for (let pair = 0; pair < 2; pair += 1) {
      const row = pair ? baseRow : selected; this.nodes = 0;
      let worst = VALUE_MAX; let supported = 0;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        if (this.rootEnemyDomainMask && !this.rootEnemyDomainMask[column]) continue;
        const value = this.transitionValue(engine, engine.ourActions[row],
          engine.ourArguments[row], engine.enemyActions[column],
          engine.enemyArguments[column], this.currentDepth, 1, 0);
        supported = 1; if (value < worst) worst = value;
      }
      if (!supported) worst = VALUE_MIN;
      if (pair) baseWorst = worst; else selectedWorst = worst;
      totalNodes += this.nodes;
    }
    state.undoTo(mark);
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    this.currentDepth = savedDepth; this.perRootBudget = savedBudget;
    this.nodes = savedNodes; this.currentRootMatrixIndex = savedIndex;
    this.pairedTerminalNodeCount += totalNodes;
    if (totalNodes > this.pairedTerminalMaximumNodes)
      this.pairedTerminalMaximumNodes = totalNodes;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) {
      this.pairedTerminalRestoreFailures += 1; return 0;
    }
    if (this.leafBudgetCount !== budgetLeafBefore ||
        this.fastIncompleteCount !== fastIncompleteBefore ||
        this.hardIncompleteCount !== hardIncompleteBefore) {
      this.pairedTerminalIncompleteCount += 1; return 0;
    }
    this.pairedTerminalSelectedWorst = selectedWorst;
    this.pairedTerminalBaseWorst = baseWorst;
    return 1;
  }

  compareRecursion(census) {
    if (!census) return;
    this.oracleRecursionRootCount += 1;
    this.oracleRecursionRootActionCount += census.rootActionCount || 0;
    this.oracleRecursionRootEnemyActionCount += census.rootEnemyActionCount || 0;
    this.oracleRecursionNodeCount += census.nodeCount || 0;
    this.oracleRecursionDepthLeafCount += census.depthLeafCount || 0;
    this.oracleRecursionBudgetLeafCount += census.budgetLeafCount || 0;
    this.oracleRecursionTerminalLeafCount += census.terminalLeafCount || 0;
    this.oracleRecursionOwnExpansionCount += census.ownExpansionCount || 0;
    this.oracleRecursionEnemyExpansionCount += census.enemyExpansionCount || 0;
    this.oracleRecursionTransitionCount += census.transitionCount || 0;
    this.oracleRecursionOutcomeCount += census.outcomeCount || 0;
    for (const [name, count] of Object.entries(census.ownActions || {})) {
      const action = this.legacyAction(name);
      if (action >= 0) this.oracleRecursionActionCount[action] += count || 0;
    }
    for (const [name, count] of Object.entries(census.enemyActions || {})) {
      const action = this.legacyAction(name);
      if (action >= 0) this.oracleRecursionActionCount[ACTION_WIDTH + action] += count || 0;
    }
    for (const name of census.rootEnemyActions || []) {
      const action = this.legacyAction(name);
      if (action >= 0) this.oracleRootEnemyActionCount[action] += 1;
    }
  }

  setOracleOpponentContext(census) {
    this.oracleOpponentReady = census?.opponentCounts ? 1 : 0;
    this.currentBlendBasisPoints = this.blendBasisPoints;
    if (!this.oracleOpponentReady) return;
    this.oracleOpponentCounts[0] = census.opponentCounts.GO || 1;
    this.oracleOpponentCounts[1] = census.opponentCounts.LEFT || 1;
    this.oracleOpponentCounts[2] = census.opponentCounts.RIGHT || 1;
    this.oracleOpponentCounts[3] = census.opponentCounts.FIRE || 1;
    this.oracleOpponentObservations = census.opponentObservations || 0;
    this.oracleOpponentGoStreak = census.opponentGoStreak || 0;
    this.oracleEnemyStationaryStreak = census.enemyStationaryStreak || 0;
    if (this.pathUtility &&
        typeof this.pathUtility.setOpponentContext === "function")
      this.pathUtility.setOpponentContext(this.oracleOpponentCounts[0],
        this.oracleOpponentCounts[1], this.oracleOpponentCounts[2],
        this.oracleOpponentCounts[3], this.oracleEnemyStationaryStreak);
    if (this.opponentMode === "v1-exact")
      this.currentBlendBasisPoints = Math.max(0, Math.min(5000,
        Number.isSafeInteger(census.expectationBlendBasisPoints) ?
          census.expectationBlendBasisPoints :
          Math.round((census.expectationBlend || 0) * 10000)));
  }

  scheduleBlend(state) {
    if (this.blendSchedule !== "star-state") return this.currentBlendBasisPoints;
    const stars = state.arrays[ARRAY.TANK_STARS];
    const bucket = stars[0] > stars[1] ? 2 : stars[0] < stars[1] ? 0 : 1;
    this.blendScheduleCount[bucket] += 1;
    this.currentBlendBasisPoints = bucket === 2 ?
      this.leadingBlendBasisPoints : bucket === 0 ?
        this.trailingBlendBasisPoints : this.blendBasisPoints;
    return this.currentBlendBasisPoints;
  }

  exactMask(budget, fast, hard, depth, top, policy, noAction) {
    let mask = 0;
    if (budget) mask |= EXACT_BLOCK.BUDGET;
    if (fast) mask |= EXACT_BLOCK.FAST_INCOMPLETE;
    if (hard) mask |= EXACT_BLOCK.HARD_INCOMPLETE;
    if (depth) mask |= EXACT_BLOCK.DEPTH_LEAF;
    if (top) mask |= EXACT_BLOCK.TOP_LEAF;
    if (policy) mask |= EXACT_BLOCK.POLICY_REJECT_LEAF;
    if (noAction) mask |= EXACT_BLOCK.NO_ACTION_LEAF;
    return mask;
  }

  classifyExactBlock() {
    const mask = this.exactMask(this.lastBudgetLeafCount,
      this.lastFastIncompleteCount, this.lastHardIncompleteCount,
      this.lastDepthLeafCount, this.lastTopLeafCount,
      this.lastPolicyRejectCount, this.lastNoActionLeafCount);
    this.lastExactBlockMask = mask;
    this.exactBlockMaskCount[mask] += 1;
    if (mask) this.exactBlockedRootCount += 1;
    if (this.lastOwnershipSupportComplete && mask) {
      this.budgetCompleteHeuristicRootCount += 1;
      if (mask === EXACT_BLOCK.DEPTH_LEAF)
        this.depthOnlyHeuristicRootCount += 1;
    }
    return mask;
  }

  qualifyRootPolicySecondary(action) {
    if (this.ownContinuationMode !== "root-policy-direct" ||
        action === ACTION.FIRE) return action;
    if (action > ACTION.NONE && action <= ACTION.BOOST_RIGHT_BOMB)
      this.rootPolicySecondaryFilteredCount += 1;
    return ACTION.NONE;
  }

  prepare(engine, count, rootEligibility = null) {
    this.prepareCount += 1; this.completedDepth = 0;
    this.preparedRootCount = 0;
    this.representativeSupportDepth = 0; this.representativeSupportComplete = 0;
    this.lastOwnershipSupportComplete = 0;
    this.lastValueExact = 0;
    this.lastBudgetLeafCount = 0;
    this.lastFastIncompleteCount = 0;
    this.lastHardIncompleteCount = 0;
    this.lastDepthLeafCount = 0; this.lastTopLeafCount = 0;
    this.lastPolicyRejectCount = 0; this.lastNoActionLeafCount = 0;
    this.lastExactBlockMask = 0;
    this.lastExactRowCount = 0; this.rowExactBlockMask.fill(127);
    const bundle = engine.adapter?.bundle; const state = bundle?.state;
    if (!bundle || !state || !engine.adapter.enemyVisible || count < 1 ||
        engine.enemyCount < 1) return 0;
    if (this.eventQuiescenceContinuation)
      this.eventQuiescenceContinuation.engine = engine;
    if (this.ownContinuation) this.ownContinuation.engine = engine;
    if (this.ownContinuationSecondary &&
        Object.prototype.hasOwnProperty.call(this.ownContinuationSecondary,
          "engine")) this.ownContinuationSecondary.engine = engine;
    this.currentOwnContinuation = this.ownContinuation;
    let rootPolicyPrimaryAction = ACTION.NONE;
    let rootPolicySecondaryAction = ACTION.NONE;
    if (this.ownContinuationMode === "root-policy" ||
        this.ownContinuationMode === "root-policy-direct") {
      this.rootPolicyPrepareCount += 1;
      rootPolicyPrimaryAction = this.ownContinuation &&
          typeof this.ownContinuation.routeAction === "function" ?
        this.ownContinuation.routeAction(state) : ACTION.NONE;
      rootPolicySecondaryAction = this.ownContinuationSecondary &&
          typeof this.ownContinuationSecondary.routeAction === "function" ?
        this.ownContinuationSecondary.routeAction(state) : ACTION.NONE;
      rootPolicySecondaryAction = this.qualifyRootPolicySecondary(
        rootPolicySecondaryAction);
      if (rootPolicyPrimaryAction <= ACTION.NONE ||
          rootPolicyPrimaryAction > ACTION.BOOST_RIGHT_BOMB)
        this.rootPolicyPrimaryIncompleteCount += 1;
      if (rootPolicySecondaryAction <= ACTION.NONE ||
          rootPolicySecondaryAction > ACTION.BOOST_RIGHT_BOMB)
        this.rootPolicySecondaryIncompleteCount += 1;
      else if (rootPolicySecondaryAction !== rootPolicyPrimaryAction)
        this.rootPolicyDistinctCount += 1;
    }
    this.preparedRootCount = Math.min(count, engine.ourCount);
    this.scheduleBlend(state);
    for (let row = 0; row < count; row += 1)
      this.nativeRootActionCount[engine.ourActions[row]] += 1;
    for (let column = 0; column < engine.enemyCount; column += 1)
      this.nativeRootActionCount[ACTION_WIDTH + engine.enemyActions[column]] += 1;
    this.bindIsolatedHard(bundle);
    this.currentDepth = this.scheduledDepth(engine);
    this.scheduledDepthCount[this.currentDepth] += 1;
    if (this.leafEvaluator && typeof this.leafEvaluator.beginRoot === "function")
      this.leafEvaluator.beginRoot(state);
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const kernel = this.diagnosticKernel;
    const kernelFailure = kernel.failure; const kernelLastMark = kernel.lastMark;
    const kernelApplied = kernel.appliedActionCount;
    const kernelHardChecked = kernel.hardCheckedActionCount;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const highWaterDelta = state.highWaterDelta; const highWaterEvent = state.highWaterEvent;
    this.rootScore.fill(VALUE_MIN, 0, count);
    this.rootNominalScore.fill(VALUE_MIN, 0, count);
    if (this.collectTerminalTrade) this.rootTradeClass.fill(0);
    const restrictRoot = this.rootDomainMode === "primitive" ||
      this.rootDomainMode === "v1-shaped" ||
      this.rootDomainMode === "v1-actions" && this.oracleRootActionReady;
    let searchedCount = 0; let extraPoisonCount = 0;
    for (let row = 0; row < count; row += 1) {
      const action = engine.ourActions[row];
      let included = 1;
      if (this.rootDomainMode === "primitive")
        included = action >= ACTION.GO && action <= ACTION.FIRE ? 1 : 0;
      else if (this.rootDomainMode === "v1-shaped")
        included = this.rootV1ShapedAllowed(engine, action);
      else if (this.rootDomainMode === "v1-actions" && this.oracleRootActionReady)
        included = this.oracleRootActionMask[action];
      if (this.rootExtraPoison && action === ACTION.CAST_POISON) {
        if (!included) included = 1;
        extraPoisonCount += 1;
      }
      if (included && rootEligibility && !rootEligibility[row]) {
        included = 0;
        this.externalRootRestrictedRowCount += 1;
      }
      this.rootDomainMask[row] = included ? 1 : 0;
      if (this.oracleRootActionReady) {
        const oracle = this.oracleRootActionMask[action] ? 1 : 0;
        this.rootDomainOracleCompareCount += 1;
        if (included && oracle) this.rootDomainOracleBothCount += 1;
        else if (included) this.rootDomainNativeOnlyCount += 1;
        else if (oracle) this.rootDomainOracleOnlyCount += 1;
      }
      if (included) searchedCount += 1;
    }
    if (!searchedCount) return 0;
    let searchedEnemyCount = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const included = this.rootEnemyActionAllowed(engine,
        engine.enemyActions[column]);
      this.rootEnemyDomainMask[column] = included ? 1 : 0;
      if (included) searchedEnemyCount += 1;
    }
    this.buildRootColumnSequence(engine);
    if (!searchedEnemyCount) return 0;
    if (rootEligibility) this.externalRootRestrictionCount += 1;
    this.rootDomainRestricted = restrictRoot || rootEligibility ? 1 : 0;
    const budgetLeafBefore = this.leafBudgetCount;
    const fastIncompleteBefore = this.fastIncompleteCount;
    const hardIncompleteBefore = this.hardIncompleteCount;
    const depthLeafBefore = this.depthLeafCount;
    const topLeafBefore = this.topLeafCount;
    const policyRejectBefore = this.hardRejectPolicyCount;
    const noActionLeafBefore = this.noActionLeafCount;
    this.iterationBudgetInterrupted = 0;
    this.perRootBudget = this.hardBudgetInterrupt ? Math.max(1, this.nodeBudget) :
      Math.max(12, Math.trunc(this.nodeBudget /
        Math.max(1, searchedCount - extraPoisonCount)));
    const rowBudget = this.perRootBudget;
    const cellBudget = Math.max(1, Math.trunc(this.nodeBudget /
      Math.max(1, (searchedCount - extraPoisonCount) * searchedEnemyCount)));
    let runNodes = 0;
    if (this.hardBudgetInterrupt) this.nodes = 0;
    for (let row = 0; row < count; row += 1) {
      if (!this.rootDomainMask[row]) continue;
      if ((this.ownContinuationMode === "root-policy" ||
           this.ownContinuationMode === "root-policy-direct") &&
          rootPolicySecondaryAction > ACTION.NONE &&
          rootPolicySecondaryAction <= ACTION.BOOST_RIGHT_BOMB &&
          rootPolicySecondaryAction !== rootPolicyPrimaryAction &&
          engine.ourActions[row] === rootPolicySecondaryAction) {
        this.currentOwnContinuation = this.ownContinuationSecondary;
        this.rootPolicySecondaryRowCount += 1;
      } else {
        this.currentOwnContinuation = this.ownContinuation;
        if (this.ownContinuationMode === "root-policy" ||
            this.ownContinuationMode === "root-policy-direct")
          this.rootPolicyPrimaryRowCount += 1;
      }
      const rowBudgetBefore = this.leafBudgetCount;
      const rowFastBefore = this.fastIncompleteCount;
      const rowHardBefore = this.hardIncompleteCount;
      const rowDepthBefore = this.depthLeafCount;
      const rowTopBefore = this.topLeafCount;
      const rowPolicyBefore = this.hardRejectPolicyCount;
      const rowNoActionBefore = this.noActionLeafCount;
      const rootOffset = row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
      this.rootCellScore.fill(VALUE_MAX, rootOffset,
        rootOffset + engine.enemyCount);
      this.rootNominalCellScore.fill(VALUE_MAX, rootOffset,
        rootOffset + engine.enemyCount);
      if (!this.hardBudgetInterrupt) this.nodes = 0;
      let rowNodes = 0;
      let worst = VALUE_MAX; let nominalWorst = VALUE_MAX;
      let hasResponse = false;
      let sum = 0; let nominalSum = 0; let weightTotal = 0;
      for (let step = 0; step < engine.enemyCount; step += 1) {
        const column = this.rootColumnIndex(step, engine.enemyCount);
        if (!this.rootEnemyDomainMask[column]) continue;
        if (!this.hardBudgetInterrupt && this.rootBudgetMode === "cell-equal") {
          this.nodes = 0; this.perRootBudget = cellBudget;
        }
        const weight = this.opponentWeight(engine, state, engine.enemyActions[column]);
        const value = this.rootCell(engine, row, column);
        const nominalValue = this.lastNominalValue;
        if (!this.hardBudgetInterrupt && this.rootBudgetMode === "cell-equal")
          rowNodes += this.nodes;
        this.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = value;
        this.rootNominalCellScore[
          row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column] = nominalValue;
        if (!hasResponse || value < worst || value === worst && nominalValue < nominalWorst) {
          worst = value; nominalWorst = nominalValue;
        }
        hasResponse = true;
        sum += value * weight; nominalSum += nominalValue * weight;
        weightTotal += weight;
        if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
      }
      this.rootScore[row] = this.blended(worst, sum, weightTotal);
      this.rootNominalScore[row] = this.blended(nominalWorst, nominalSum,
        weightTotal);
      const rowMask = this.exactMask(
        this.leafBudgetCount - rowBudgetBefore,
        this.fastIncompleteCount - rowFastBefore,
        this.hardIncompleteCount - rowHardBefore,
        this.depthLeafCount - rowDepthBefore,
        this.topLeafCount - rowTopBefore,
        this.hardRejectPolicyCount - rowPolicyBefore,
        this.noActionLeafCount - rowNoActionBefore);
      this.rowExactBlockMask[row] = rowMask;
      this.rowExactBlockMaskCount[rowMask] += 1;
      if (rowMask === 0) {
        this.lastExactRowCount += 1; this.exactRowCount += 1;
      } else this.blockedRowCount += 1;
      if (!this.hardBudgetInterrupt)
        runNodes += this.rootBudgetMode === "cell-equal" ? rowNodes : this.nodes;
      if (this.hardBudgetInterrupt && this.iterationBudgetInterrupted) break;
    }
    if (this.hardBudgetInterrupt) runNodes = this.nodes;
    this.currentOwnContinuation = this.ownContinuation;
    this.perRootBudget = rowBudget;
    state.undoTo(mark);
    kernel.failure = kernelFailure; kernel.lastMark = kernelLastMark;
    kernel.appliedActionCount = kernelApplied;
    kernel.hardCheckedActionCount = kernelHardChecked;
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    state.highWaterDelta = highWaterDelta; state.highWaterEvent = highWaterEvent;
    if (state.hashLo !== hashLo || state.hashHi !== hashHi) {
      this.rootRestoreFailureCount += 1; return 0;
    }
    this.nodes = runNodes; this.totalNodes += runNodes;
    if (runNodes > this.maximumNodes) this.maximumNodes = runNodes;
    this.rootCount += searchedCount; this.completeCount += 1;
    this.completedDepth = this.currentDepth;
    this.representativeSupportDepth = this.currentDepth;
    this.representativeSupportComplete = 1;
    this.lastBudgetLeafCount = this.leafBudgetCount - budgetLeafBefore;
    this.lastFastIncompleteCount =
      this.fastIncompleteCount - fastIncompleteBefore;
    this.lastHardIncompleteCount =
      this.hardIncompleteCount - hardIncompleteBefore;
    this.lastDepthLeafCount = this.depthLeafCount - depthLeafBefore;
    this.lastTopLeafCount = this.topLeafCount - topLeafBefore;
    this.lastPolicyRejectCount = this.hardRejectPolicyCount - policyRejectBefore;
    this.lastNoActionLeafCount = this.noActionLeafCount - noActionLeafBefore;
    this.lastOwnershipSupportComplete = !this.lastBudgetLeafCount &&
      !this.lastFastIncompleteCount && !this.lastHardIncompleteCount ? 1 : 0;
    this.lastValueExact = this.classifyExactBlock() === 0 ? 1 : 0;
    if (this.lastOwnershipSupportComplete) this.strictOwnershipRootCount += 1;
    else this.heuristicOwnershipRootCount += 1;
    if (this.lastValueExact) this.exactOwnershipRootCount += 1;
    return 1;
  }

  summary() {
    const transitionPairs = {};
    for (let own = 0; own < ACTION_WIDTH; own += 1)
      for (let enemy = 0; enemy < ACTION_WIDTH; enemy += 1) {
        const at = own * ACTION_WIDTH + enemy;
        if (this.transitionPairCompared[at])
          transitionPairs[`${ACTION_NAME[own]}:${ACTION_NAME[enemy]}`] = {
            compared: this.transitionPairCompared[at],
            mismatched: this.transitionPairMismatch[at]
          };
      }
    return { semantics: "BOUNDED_POLICY_EVIDENCE_NOT_PROOF",
      targetDepth: this.targetDepth, nodeBudget: this.nodeBudget,
      depthSchedule: this.depthSchedule,
      scheduledDepthCount: Array.from(this.scheduledDepthCount),
      blendBasisPoints: this.blendBasisPoints, prepareCount: this.prepareCount,
      blendSchedule: this.blendSchedule,
      leadingBlendBasisPoints: this.leadingBlendBasisPoints,
      trailingBlendBasisPoints: this.trailingBlendBasisPoints,
      blendScheduleCount: Array.from(this.blendScheduleCount),
      fullPrimitiveDomain: this.fullPrimitiveDomain,
      deepFireMode: this.deepFireMode,
      deepV1FireCheckCount: this.deepV1FireCheckCount,
      deepSkillMode: this.deepSkillMode,
      deepDomainMode: this.deepDomainMode,
      deepBombMode: this.deepBombMode,
      ownContinuationMode: this.ownContinuationMode,
      ownContinuationRouteCount: this.ownContinuationRouteCount,
      ownContinuationRouteIncompleteCount:
        this.ownContinuationRouteIncompleteCount,
      ownContinuationDomainFallbackCount:
        this.ownContinuationDomainFallbackCount,
      ownContinuationSecondaryRouteCount:
        this.ownContinuationSecondaryRouteCount,
      ownContinuationSecondaryIncompleteCount:
        this.ownContinuationSecondaryIncompleteCount,
      ownContinuationPortfolioDedupCount:
        this.ownContinuationPortfolioDedupCount,
      ownContinuationPortfolioWidthCount:
        Array.from(this.ownContinuationPortfolioWidthCount),
      ownContinuationActionCount: Array.from(this.ownContinuationActionCount),
      rootPolicyPrepareCount: this.rootPolicyPrepareCount,
      rootPolicyPrimaryIncompleteCount: this.rootPolicyPrimaryIncompleteCount,
      rootPolicySecondaryIncompleteCount:
        this.rootPolicySecondaryIncompleteCount,
      rootPolicySecondaryFilteredCount:
        this.rootPolicySecondaryFilteredCount,
      rootPolicyDistinctCount: this.rootPolicyDistinctCount,
      rootPolicyPrimaryRowCount: this.rootPolicyPrimaryRowCount,
      rootPolicySecondaryRowCount: this.rootPolicySecondaryRowCount,
      eventQuiescenceMode: this.eventQuiescenceMode,
      eventQuiescenceContinuationMode:
        this.eventQuiescenceContinuationMode,
      eventQuiescenceMaximumPly: this.eventQuiescenceMaximumPly,
      eventQuiescenceCheckCount: this.eventQuiescenceCheckCount,
      eventQuiescenceExpansionCount: this.eventQuiescenceExpansionCount,
      eventQuiescenceQuietLeafCount: this.eventQuiescenceQuietLeafCount,
      eventQuiescenceCappedLeafCount: this.eventQuiescenceCappedLeafCount,
      eventQuiescenceProjectileLeafCount:
        this.eventQuiescenceProjectileLeafCount,
      eventQuiescenceBombLeafCount: this.eventQuiescenceBombLeafCount,
      eventQuiescenceExpansionByPly:
        Array.from(this.eventQuiescenceExpansionByPly),
      eventQuiescencePolicyRouteCount:
        this.eventQuiescencePolicyRouteCount,
      eventQuiescencePolicyRouteIncompleteCount:
        this.eventQuiescencePolicyRouteIncompleteCount,
      eventQuiescencePolicyDomainMissCount:
        this.eventQuiescencePolicyDomainMissCount,
      deepHardMode: this.deepHardMode,
      rootDomainMode: this.rootDomainMode,
      rootExtraPoison: this.rootExtraPoison,
      syntheticRootAction: this.syntheticRootAction,
      syntheticRootArgument: this.syntheticRootArgument,
      syntheticRootValue: this.syntheticRootValue,
      syntheticRootWorst: this.syntheticRootWorst,
      syntheticRootSupportCount: this.syntheticRootSupportCount,
      syntheticRootEvaluationCount: this.syntheticRootEvaluationCount,
      syntheticRootCompleteCount: this.syntheticRootCompleteCount,
      syntheticRootIncompleteCount: this.syntheticRootIncompleteCount,
      syntheticRootNodeCount: this.syntheticRootNodeCount,
      syntheticRootMaximumNodes: this.syntheticRootMaximumNodes,
      syntheticRootRestoreFailureCount:
        this.syntheticRootRestoreFailureCount,
      resourceOptionEvaluationCount: this.resourceOptionEvaluationCount,
      resourceOptionCompleteCount: this.resourceOptionCompleteCount,
      resourceOptionIncompleteCount: this.resourceOptionIncompleteCount,
      resourceOptionBudgetIncompleteCount:
        this.resourceOptionBudgetIncompleteCount,
      resourceOptionNodeCount: this.resourceOptionNodeCount,
      resourceOptionMaximumNodes: this.resourceOptionMaximumNodes,
      resourceOptionRestoreFailureCount:
        this.resourceOptionRestoreFailureCount,
      resourceOptionBaseWorst: this.resourceOptionBaseWorst,
      resourceOptionCandidateWorst: this.resourceOptionCandidateWorst,
      resourceOptionBaseValue: this.resourceOptionBaseValue,
      resourceOptionCandidateValue: this.resourceOptionCandidateValue,
      resourceOptionDepth: this.resourceOptionDepth,
      resourceOptionNodeBudget: this.resourceOptionNodeBudget,
      resourceOptionFeedbackMode: this.resourceOptionFeedbackMode,
      policyEnvelopeSemantics: "HORIZON_POLICY_ENVELOPE",
      policyEnvelopeEvaluationCount: this.policyEnvelopeEvaluationCount,
      policyEnvelopeCompleteCount: this.policyEnvelopeCompleteCount,
      policyEnvelopeIncompleteCount: this.policyEnvelopeIncompleteCount,
      policyEnvelopeBudgetIncompleteCount:
        this.policyEnvelopeBudgetIncompleteCount,
      policyEnvelopeContinuationIncompleteCount:
        this.policyEnvelopeContinuationIncompleteCount,
      policyEnvelopeRescueFallbackCount:
        this.policyEnvelopeRescueFallbackCount,
      policyEnvelopeAbortFallbackCount:
        this.policyEnvelopeAbortFallbackCount,
      policyEnvelopeCompletionFallbackCount:
        this.policyEnvelopeCompletionFallbackCount,
      policyEnvelopeInjectedActionCount:
        this.policyEnvelopeInjectedActionCount,
      policyEnvelopeNodeCount: this.policyEnvelopeNodeCount,
      policyEnvelopeMaximumNodes: this.policyEnvelopeMaximumNodes,
      policyEnvelopeRestoreFailureCount:
        this.policyEnvelopeRestoreFailureCount,
      policyEnvelopePreparedBaseReuseCount:
        this.policyEnvelopePreparedBaseReuseCount,
      policyEnvelopePreparedBaseBlockedCount:
        this.policyEnvelopePreparedBaseBlockedCount,
      policyEnvelopePreparedBaseDepthMismatchCount:
        this.policyEnvelopePreparedBaseDepthMismatchCount,
      policyEnvelopePreparedBaseDomainMissingCount:
        this.policyEnvelopePreparedBaseDomainMissingCount,
      policyEnvelopePreparedBaseBlockMaskCount:
        Array.from(this.policyEnvelopePreparedBaseBlockMaskCount),
      policyEnvelopeEventLeafCount: this.policyEnvelopeEventLeafCount,
      policyEnvelopeNoEventLeafCount: this.policyEnvelopeNoEventLeafCount,
      policyEnvelopeAbortLeafCount: this.policyEnvelopeAbortLeafCount,
      policyEnvelopeRescueLeafCount: this.policyEnvelopeRescueLeafCount,
      policyEnvelopeEventCompleteColumnCount:
        this.policyEnvelopeEventCompleteColumnCount,
      policyEnvelopeEventIncompleteColumnCount:
        this.policyEnvelopeEventIncompleteColumnCount,
      policyEnvelopeBaseWorst: this.policyEnvelopeBaseWorst,
      policyEnvelopeCandidateWorst: this.policyEnvelopeCandidateWorst,
      policyEnvelopeBaseValue: this.policyEnvelopeBaseValue,
      policyEnvelopeCandidateValue: this.policyEnvelopeCandidateValue,
      policyEnvelopeDepth: this.policyEnvelopeDepth,
      policyEnvelopeNodeBudget: this.policyEnvelopeNodeBudget,
      policyEnvelopePolicyId: this.policyEnvelopePolicyId,
      policyEnvelopeTargetSignature: this.policyEnvelopeTargetSignature,
      rootDomainOracleCompareCount: this.rootDomainOracleCompareCount,
      rootDomainOracleBothCount: this.rootDomainOracleBothCount,
      rootDomainNativeOnlyCount: this.rootDomainNativeOnlyCount,
      rootDomainOracleOnlyCount: this.rootDomainOracleOnlyCount,
      externalRootRestrictionCount: this.externalRootRestrictionCount,
      externalRootRestrictedRowCount: this.externalRootRestrictedRowCount,
      rootEnemyDomainMode: this.rootEnemyDomainMode,
      rootColumnOrder: this.rootColumnOrder,
      rootBudgetMode: this.rootBudgetMode,
      terminalMode: this.terminalMode,
      ownChanceMode: this.ownChanceMode,
      v1OwnChanceCheckCount: this.v1OwnChanceCheckCount,
      v1OwnReversedCount: this.v1OwnReversedCount,
      invocationCompareCount: this.invocationCompareCount,
      invocationBothCount: this.invocationBothCount,
      invocationNativeOnlyCount: this.invocationNativeOnlyCount,
      invocationOracleOnlyCount: this.invocationOracleOnlyCount,
      invocationNeitherCount: this.invocationNeitherCount,
      invocationNativeOnlyByResult:
        Array.from(this.invocationNativeOnlyByResult),
      invocationOracleOnlyByResult:
        Array.from(this.invocationOracleOnlyByResult),
      superkoMode: this.superkoMode,
      collectTerminalTrade: this.collectTerminalTrade,
      pairedTerminalAuditCount: this.pairedTerminalAuditCount,
      pairedTerminalNodeCount: this.pairedTerminalNodeCount,
      pairedTerminalMaximumNodes: this.pairedTerminalMaximumNodes,
      pairedTerminalRestoreFailures: this.pairedTerminalRestoreFailures,
      pairedTerminalIncompleteCount: this.pairedTerminalIncompleteCount,
      superkoCheckCount: this.superkoCheckCount,
      superkoPenaltyCount: this.superkoPenaltyCount,
      superkoPenaltyTotal: this.superkoPenaltyTotal,
      superkoPathMatchCount: this.superkoPathMatchCount,
      superkoRootMatchCount: this.superkoRootMatchCount,
      superkoReliefCount: this.superkoReliefCount,
      deepOwnSkillCount: this.deepOwnSkillCount,
      deepEnemySkillCount: this.deepEnemySkillCount,
      transitionCensusRootCount: this.transitionCensusRootCount,
      transitionRootSnapshotCount: this.transitionRootSnapshotCount,
      transitionRootAnyMismatchCount: this.transitionRootAnyMismatchCount,
      transitionRootFrameMismatchCount: this.transitionRootFrameMismatchCount,
      transitionRootPoseMismatchCount: this.transitionRootPoseMismatchCount,
      transitionRootDirectionMismatchCount: this.transitionRootDirectionMismatchCount,
      transitionRootStarMismatchCount: this.transitionRootStarMismatchCount,
      transitionRootCrashMismatchCount: this.transitionRootCrashMismatchCount,
      transitionRootProjectileMismatchCount: this.transitionRootProjectileMismatchCount,
      transitionRootBombMismatchCount: this.transitionRootBombMismatchCount,
      transitionRootTerrainMismatchCount: this.transitionRootTerrainMismatchCount,
      transitionRootStatusMismatchCount: this.transitionRootStatusMismatchCount,
      transitionSkippedRootMismatchCount: this.transitionSkippedRootMismatchCount,
      transitionComparedCount: this.transitionComparedCount,
      transitionUnsupportedCount: this.transitionUnsupportedCount,
      transitionMissingActionCount: this.transitionMissingActionCount,
      transitionAnyMismatchCount: this.transitionAnyMismatchCount,
      transitionFrameMismatchCount: this.transitionFrameMismatchCount,
      transitionPoseMismatchCount: this.transitionPoseMismatchCount,
      transitionDirectionMismatchCount: this.transitionDirectionMismatchCount,
      transitionStarMismatchCount: this.transitionStarMismatchCount,
      transitionCrashMismatchCount: this.transitionCrashMismatchCount,
      transitionProjectileMismatchCount: this.transitionProjectileMismatchCount,
      transitionBombMismatchCount: this.transitionBombMismatchCount,
      transitionTerrainMismatchCount: this.transitionTerrainMismatchCount,
      transitionStatusMismatchCount: this.transitionStatusMismatchCount,
      transitionLeafSignedDifference: this.transitionLeafSignedDifference,
      transitionLeafAbsDifference: this.transitionLeafAbsDifference,
      transitionExactLeafCount: this.transitionExactLeafCount,
      transitionExactComponentNames: ["OBJECTIVE", "PROJECTILE", "ATTACK",
        "POSITION", "STATUS", "ACTION", "REPETITION",
        "SURVIVAL"],
      transitionExactComponentSignedDifference:
        Array.from(this.transitionExactComponentSignedDifference),
      transitionExactComponentAbsDifference:
        Array.from(this.transitionExactComponentAbsDifference),
      deepTransitionComparedByPly: Array.from(this.deepTransitionComparedByPly),
      deepTransitionUnsupportedByPly:
        Array.from(this.deepTransitionUnsupportedByPly),
      deepTransitionAnyMismatchByPly:
        Array.from(this.deepTransitionAnyMismatchByPly),
      deepTransitionFieldNames: ["FRAME", "POSE", "DIRECTION", "STAR", "CRASH",
        "PROJECTILE", "BOMB", "TERRAIN", "STATUS"],
      deepTransitionFieldMismatchByPly:
        Array.from(this.deepTransitionFieldMismatchByPly),
      deepExactLeafCountByPly: Array.from(this.deepExactLeafCountByPly),
      deepLeafSignedDifferenceByPly:
        Array.from(this.deepLeafSignedDifferenceByPly),
      deepLeafAbsDifferenceByPly: Array.from(this.deepLeafAbsDifferenceByPly),
      deepExactComponentNames: ["OBJECTIVE", "PROJECTILE", "ATTACK", "POSITION",
        "STATUS", "ACTION", "REPETITION", "SURVIVAL"],
      deepExactComponentSignedDifferenceByPly:
        Array.from(this.deepExactComponentSignedDifferenceByPly),
      deepExactComponentAbsDifferenceByPly:
        Array.from(this.deepExactComponentAbsDifferenceByPly),
      transitionStatusFieldMismatch: Array.from(this.transitionStatusFieldMismatch),
      transitionRootStatusFieldMismatch:
        Array.from(this.transitionRootStatusFieldMismatch),
      transitionPairs,
      isolationAllocationCount: this.isolationAllocationCount,
      pathUtility: this.pathUtility !== null,
      pathEvidenceMode: this.pathEvidenceMode,
      opponentWeighted: this.opponentWeighted,
      opponentMode: this.opponentMode,
      v1StunCountdown: this.v1StunCountdown,
      v1EntryProjectileCollision: this.v1EntryProjectileCollision,
      historyAdjusted: this.historyEvaluator !== null,
      completeCount: this.completeCount, rootCount: this.rootCount,
      strictOwnershipRootCount: this.strictOwnershipRootCount,
      exactOwnershipRootCount: this.exactOwnershipRootCount,
      heuristicOwnershipRootCount: this.heuristicOwnershipRootCount,
      lastOwnershipSupportComplete: this.lastOwnershipSupportComplete,
      lastValueExact: this.lastValueExact,
      lastDepthLeafCount: this.lastDepthLeafCount,
      lastTopLeafCount: this.lastTopLeafCount,
      lastPolicyRejectCount: this.lastPolicyRejectCount,
      lastNoActionLeafCount: this.lastNoActionLeafCount,
      lastExactBlockMask: this.lastExactBlockMask,
      lastExactRowCount: this.lastExactRowCount,
      exactRowCount: this.exactRowCount,
      blockedRowCount: this.blockedRowCount,
      rowExactBlockMaskCount: Array.from(this.rowExactBlockMaskCount),
      exactBlockMaskCount: Array.from(this.exactBlockMaskCount),
      exactBlockedRootCount: this.exactBlockedRootCount,
      budgetCompleteHeuristicRootCount:
        this.budgetCompleteHeuristicRootCount,
      depthOnlyHeuristicRootCount: this.depthOnlyHeuristicRootCount,
      noActionLeafCount: this.noActionLeafCount,
      totalNodes: this.totalNodes, maximumNodes: this.maximumNodes,
      leafBudgetCount: this.leafBudgetCount,
      hardBudgetInterrupt: Boolean(this.hardBudgetInterrupt),
      hardBudgetInterruptCount: this.hardBudgetInterruptCount,
      fastIncompleteCount: this.fastIncompleteCount,
      hardIncompleteCount: this.hardIncompleteCount,
      hardAllowCount: this.hardAllowCount,
      hardRejectProvenCount: this.hardRejectProvenCount,
      hardRejectPolicyCount: this.hardRejectPolicyCount,
      terminalCount: this.terminalCount,
      recordTerminalCount: this.recordTerminalCount,
      combatTerminalCount: this.combatTerminalCount,
      mutualCombatTerminalCount: this.mutualCombatTerminalCount,
      policyNodeDepthCount: Array.from(this.policyNodeDepthCount),
      depthLeafCount: this.depthLeafCount, topLeafCount: this.topLeafCount,
      ownExpansionCount: this.ownExpansionCount,
      enemyExpansionCount: this.enemyExpansionCount,
      jointTransitionCount: this.jointTransitionCount,
      chanceOutcomeCount: this.chanceOutcomeCount,
      deepActionCount: Array.from(this.deepActionCount),
      oracleRecursionRootCount: this.oracleRecursionRootCount,
      oracleRecursionRootActionCount: this.oracleRecursionRootActionCount,
      oracleRecursionRootEnemyActionCount:
        this.oracleRecursionRootEnemyActionCount,
      oracleRecursionNodeCount: this.oracleRecursionNodeCount,
      oracleRecursionDepthLeafCount: this.oracleRecursionDepthLeafCount,
      oracleRecursionBudgetLeafCount: this.oracleRecursionBudgetLeafCount,
      oracleRecursionTerminalLeafCount: this.oracleRecursionTerminalLeafCount,
      oracleRecursionOwnExpansionCount: this.oracleRecursionOwnExpansionCount,
      oracleRecursionEnemyExpansionCount: this.oracleRecursionEnemyExpansionCount,
      oracleRecursionTransitionCount: this.oracleRecursionTransitionCount,
      oracleRecursionOutcomeCount: this.oracleRecursionOutcomeCount,
      oracleRecursionActionCount: Array.from(this.oracleRecursionActionCount),
      nativeRootActionCount: Array.from(this.nativeRootActionCount),
      oracleRootEnemyActionCount: Array.from(this.oracleRootEnemyActionCount),
      domainBucketNames: ["ROOT_SEARCH_OWN", "ROOT_SEARCH_ENEMY",
        "ROOT_NATIVE_OWN", "ROOT_NATIVE_ENEMY",
        "PLY2_OWN", "PLY2_ENEMY", "PLY3_OWN", "PLY3_ENEMY"],
      domainCompareCount: Array.from(this.domainCompareCount),
      domainSetAgreementCount: Array.from(this.domainSetAgreementCount),
      domainOrderAgreementCount: Array.from(this.domainOrderAgreementCount),
      domainNativeOnlyActionCount: Array.from(this.domainNativeOnlyActionCount),
      domainOracleOnlyActionCount: Array.from(this.domainOracleOnlyActionCount),
      rootValueTierNames: ["ROOT_DOMAIN_EXACT", "SAMPLED_TRANSITION_EXACT",
        "SEARCH_SUPPORT_COMPLETE"],
      rootValueAuditCount: this.rootValueAuditCount,
      rootValueDomainExactCount: this.rootValueDomainExactCount,
      rootValueTransitionExactCount: this.rootValueTransitionExactCount,
      rootValueStrictCount: this.rootValueStrictCount,
      rootValueCommonActionCount: Array.from(this.rootValueCommonActionCount),
      rootValuePairComparedCount: Array.from(this.rootValuePairComparedCount),
      rootValuePairOrderAgreementCount:
        Array.from(this.rootValuePairOrderAgreementCount),
      rootValueBestComparedCount: Array.from(this.rootValueBestComparedCount),
      rootValueBestAgreementCount: Array.from(this.rootValueBestAgreementCount),
      weightedReplyCount: this.weightedReplyCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

// Diagnostic-only anytime wrapper.  The original bounded search publishes a
// scalar even when different root cells stop at different effective depths.
// That is useful for measuring heuristic evidence, but it is not a stable
// Minimax owner: increasing the budget can replace a leaf in only one branch
// and reverse the root order.  This wrapper spends one shared budget from
// shallow to deep and publishes only the last horizon for which every root
// cell completed without a budget/Fast/Hard interruption.
class NativeIterativeCompletePolicySearchPoc extends NativeBoundedPolicySearchPoc {
  constructor(options = {}) {
    super({ ...options, depthSchedule: "fixed", rootBudgetMode: "cell-equal",
      hardBudgetInterrupt: true });
    this.depthSchedule = "iterative-complete";
    this.iterationDepth = 1;
    this.configuredNodeBudget = this.nodeBudget;
    this.publishedRootScore = new Int32Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.publishedRootNominalScore = new Int32Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.publishedRootCellScore = new Int32Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.publishedRootNominalCellScore = new Int32Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.publishedRowExactBlockMask = new Uint8Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.publishedRootTradeClass = new Uint8Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS * SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.iterativeRootCount = 0;
    this.iterativeAttemptCount = 0;
    this.iterativePublishedCount = 0;
    this.iterativeNoCompleteLayerCount = 0;
    this.iterativeDeeperIncompleteCount = 0;
    this.iterativeBudgetStopCount = 0;
    this.iterativeSpentNodes = 0;
    this.iterativePublishedDepthCount = new Uint32Array(5);
    this.lastIterativeAttemptedDepth = 0;
    this.lastIterativePublishedDepth = 0;
    this.lastIterativeSpentNodes = 0;
    this.lastIterativeRemainingNodes = 0;
  }

  scheduledDepth() { return this.iterationDepth; }

  prepareLayer(engine, count, rootEligibility) {
    return super.prepare(engine, count, rootEligibility);
  }

  savePublishedLayer() {
    this.publishedRootScore.set(this.rootScore);
    this.publishedRootNominalScore.set(this.rootNominalScore);
    this.publishedRootCellScore.set(this.rootCellScore);
    this.publishedRootNominalCellScore.set(this.rootNominalCellScore);
    this.publishedRowExactBlockMask.set(this.rowExactBlockMask);
    if (this.collectTerminalTrade)
      this.publishedRootTradeClass.set(this.rootTradeClass);
    this.publishedLastValueExact = this.lastValueExact;
    this.publishedLastDepthLeafCount = this.lastDepthLeafCount;
    this.publishedLastTopLeafCount = this.lastTopLeafCount;
    this.publishedLastPolicyRejectCount = this.lastPolicyRejectCount;
    this.publishedLastNoActionLeafCount = this.lastNoActionLeafCount;
    this.publishedLastExactBlockMask = this.lastExactBlockMask;
    this.publishedLastExactRowCount = this.lastExactRowCount;
  }

  restorePublishedLayer(depth) {
    this.rootScore.set(this.publishedRootScore);
    this.rootNominalScore.set(this.publishedRootNominalScore);
    this.rootCellScore.set(this.publishedRootCellScore);
    this.rootNominalCellScore.set(this.publishedRootNominalCellScore);
    this.rowExactBlockMask.set(this.publishedRowExactBlockMask);
    if (this.collectTerminalTrade)
      this.rootTradeClass.set(this.publishedRootTradeClass);
    this.currentDepth = depth;
    this.completedDepth = depth;
    this.representativeSupportDepth = depth;
    this.representativeSupportComplete = 1;
    this.lastOwnershipSupportComplete = 1;
    this.lastValueExact = this.publishedLastValueExact;
    this.lastBudgetLeafCount = 0;
    this.lastFastIncompleteCount = 0;
    this.lastHardIncompleteCount = 0;
    this.lastDepthLeafCount = this.publishedLastDepthLeafCount;
    this.lastTopLeafCount = this.publishedLastTopLeafCount;
    this.lastPolicyRejectCount = this.publishedLastPolicyRejectCount;
    this.lastNoActionLeafCount = this.publishedLastNoActionLeafCount;
    this.lastExactBlockMask = this.publishedLastExactBlockMask;
    this.lastExactRowCount = this.publishedLastExactRowCount;
  }

  prepare(engine, count, rootEligibility = null) {
    const prepareBefore = this.prepareCount;
    const configuredBudget = this.configuredNodeBudget;
    let remaining = configuredBudget;
    let publishedDepth = 0;
    let spentTotal = 0;
    this.iterativeRootCount += 1;
    this.lastIterativeAttemptedDepth = 0;
    this.lastIterativePublishedDepth = 0;
    this.lastIterativeSpentNodes = 0;
    this.lastIterativeRemainingNodes = configuredBudget;
    for (let depth = 1; depth <= this.targetDepth; depth += 1) {
      if (depth > 1 && remaining <= 0) {
        this.iterativeBudgetStopCount += 1; break;
      }
      this.iterationDepth = depth;
      this.nodeBudget = Math.max(1, remaining);
      const nodesBefore = this.totalNodes;
      const prepared = this.prepareLayer(engine, count, rootEligibility);
      const spent = Math.max(0, this.totalNodes - nodesBefore);
      spentTotal += spent;
      remaining = Math.max(0, remaining - spent);
      this.iterativeAttemptCount += 1;
      this.lastIterativeAttemptedDepth = depth;
      if (!prepared || !this.lastOwnershipSupportComplete) {
        if (publishedDepth) this.iterativeDeeperIncompleteCount += 1;
        break;
      }
      publishedDepth = depth;
      this.savePublishedLayer();
      if (depth < this.targetDepth && remaining <= 0) {
        this.iterativeBudgetStopCount += 1; break;
      }
    }
    this.nodeBudget = configuredBudget;
    // One external root invocation may contain several internal iterations.
    // Preserve the public invocation counter used by the arena owner.
    this.prepareCount = prepareBefore + 1;
    this.iterativeSpentNodes += spentTotal;
    this.lastIterativeSpentNodes = spentTotal;
    this.lastIterativeRemainingNodes = remaining;
    if (!publishedDepth) {
      this.iterativeNoCompleteLayerCount += 1;
      this.representativeSupportComplete = 0;
      this.lastOwnershipSupportComplete = 0;
      return 0;
    }
    this.restorePublishedLayer(publishedDepth);
    this.iterativePublishedCount += 1;
    this.iterativePublishedDepthCount[publishedDepth] += 1;
    this.lastIterativePublishedDepth = publishedDepth;
    return 1;
  }

  summary() {
    return { ...super.summary(),
      semantics: "ITERATIVE_COMPLETE_POLICY_EVIDENCE_NOT_PROOF",
      depthSchedule: this.depthSchedule,
      nodeBudget: this.configuredNodeBudget,
      rootBudgetMode: "cell-equal",
      iterativeRootCount: this.iterativeRootCount,
      iterativeAttemptCount: this.iterativeAttemptCount,
      iterativePublishedCount: this.iterativePublishedCount,
      iterativeNoCompleteLayerCount: this.iterativeNoCompleteLayerCount,
      iterativeDeeperIncompleteCount: this.iterativeDeeperIncompleteCount,
      iterativeBudgetStopCount: this.iterativeBudgetStopCount,
      iterativeSpentNodes: this.iterativeSpentNodes,
      iterativePublishedDepthCount:
        Array.from(this.iterativePublishedDepthCount),
      lastIterativeAttemptedDepth: this.lastIterativeAttemptedDepth,
      lastIterativePublishedDepth: this.lastIterativePublishedDepth,
      lastIterativeSpentNodes: this.lastIterativeSpentNodes,
      lastIterativeRemainingNodes: this.lastIterativeRemainingNodes };
  }
}

module.exports = { NativeBoundedPolicySearchPoc, EXACT_BLOCK,
  NativeIterativeCompletePolicySearchPoc, CONTINUATION_POLICY,
  EVENT_QUIESCENCE };
