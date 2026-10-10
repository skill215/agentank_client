"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { actionFromLegacy } = require("../../../engine-v3/src/contracts");
const { OWNERSHIP_STAGE_NAMES } = require("../../../engine-v3/src/ownership-trace");
const { MEMBERSHIP_STAGE } = require("./native-tactical-action-owner-poc");

const FAMILY_COUNT = 5;
const ACTION_NAME = Object.freeze([
  "NONE", "GO", "TURN_LEFT", "TURN_RIGHT", "FIRE", "THROW_BOMB",
  "CAST_SHIELD", "CAST_FREEZE", "CAST_STUN", "CAST_OVERLOAD",
  "CAST_CLOAK", "CAST_POISON", "CAST_TELEPORT", "CAST_BOOST",
  "BOOST_LEFT_GO", "BOOST_LEFT_TURN_LEFT", "BOOST_LEFT_TURN_RIGHT",
  "BOOST_LEFT_FIRE", "BOOST_LEFT_BOMB", "BOOST_RIGHT_GO",
  "BOOST_RIGHT_TURN_LEFT", "BOOST_RIGHT_TURN_RIGHT",
  "BOOST_RIGHT_FIRE", "BOOST_RIGHT_BOMB"
]);
const INTENT_NAME = Object.freeze([
  "NONE", "ATTACK", "CHASE_STAR", "EXIT_EDGE", "FACE_ENEMY", "EVADE"
]);
const VERIFIER_MARGIN = Object.freeze([0, 50, 100, 200, 400, 800, 1600]);
const FIRE_GAP_LIMIT = Object.freeze([0, 50, 100, 200, 400, 800, 1600, 3200, 6400]);

const NATIVE_RESULT = Object.freeze({
  PROPOSED: 0,
  NON_CONTACT: 1,
  STRICT_OWNER: 2,
  COMMITTED: 3,
  NO_COMPLETE_VALUE: 4,
  OTHER_FALLBACK: 5
});

function family(action) {
  if (action === ACTION.GO) return 1;
  if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 2;
  if (action === ACTION.FIRE) return 3;
  if (action === ACTION.NONE) return 0;
  return 4;
}

class NativeBasePolicyDifferentialPoc {
  constructor(options = {}) {
    this.activeOwner = options.activeOwner === "native" ? "native" :
      options.activeOwner === "hybrid" ? "hybrid" :
      options.activeOwner === "v3-base" ? "v3-base" :
      options.activeOwner === "v3-only" ? "v3-only" : "oracle";
    this.compareCount = 0; this.actionAgreementCount = 0;
    this.actionDisagreementCount = 0; this.nativeProposalCount = 0;
    this.oracleProposalCount = 0; this.bothProposalCount = 0;
    this.nativeFallbackCount = 0; this.oracleFallbackCount = 0;
    this.nativeProposalAgreementCount = 0;
    this.nativeProposalDisagreementCount = 0;
    this.nativeFallbackAgreementCount = 0;
    this.nativeFallbackDisagreementCount = 0;
    this.fallbackByReason = new Uint32Array(6);
    this.fallbackDisagreementByReason = new Uint32Array(6);
    this.compareByNativeDepth = new Uint32Array(5);
    this.agreementByNativeDepth = new Uint32Array(5);
    this.disagreementByNativeDepth = new Uint32Array(5);
    this.depthRoundPairs = new Uint32Array(5 * 5);
    this.monteCarloCompareCount = 0;
    this.monteCarloAgreementCount = 0;
    this.monteCarloDisagreementCount = 0;
    this.v1RawBestCompareCount = 0; this.v1RawBestAgreementCount = 0;
    this.v1PreMonteCarloBestCompareCount = 0;
    this.v1PreMonteCarloBestAgreementCount = 0;
    this.v1EvaluatedFinalBestCompareCount = 0;
    this.v1EvaluatedFinalBestAgreementCount = 0;
    this.v1InstrumentedChosenCompareCount = 0;
    this.v1InstrumentedChosenAgreementCount = 0;
    this.v1StageActionCompareCount = 0; this.v1StageActionAgreementCount = 0;
    this.nativeRawV1RawCompareCount = 0; this.nativeRawV1RawAgreementCount = 0;
    this.nativeAdjustedV1PreCompareCount = 0;
    this.nativeAdjustedV1PreAgreementCount = 0;
    this.v1RawToFinalDifferenceCount = 0;
    this.v1PreMonteCarloToFinalDifferenceCount = 0;
    this.pairwiseOrderCount = 0;
    this.pairwiseConcordantCount = 0;
    this.pairwiseDiscordantCount = 0;
    this.pairwiseTieCount = 0;
    this.rawPairwiseOrderCount = 0;
    this.rawPairwiseConcordantCount = 0;
    this.rawPairwiseDiscordantCount = 0;
    this.rawPairwiseTieCount = 0;
    this.oracleActionMissingCount = 0;
    this.oracleActionHardBlockedCount = 0;
    this.oracleActionDomainBlockedCount = 0;
    this.oracleActionRiskRejectedCount = 0;
    this.oracleActionRiskParetoBlockedCount = 0;
    this.oracleActionCommittedBlockedCount = 0;
    this.oracleActionSourceDomainBlockedCount = 0;
    this.oracleActionOwnerDomainBlockedCount = 0;
    this.oracleActionIntentBlockedCount = 0;
    this.oracleActionOtherMembershipBlockedCount = 0;
    this.oracleActionAllowedCount = 0;
    this.oracleActionRankedLowerCount = 0;
    this.oracleActionRankedEqualCount = 0;
    this.oracleActionRankedHigherCount = 0;
    this.nativeActionV1UnsafeCount = 0;
    this.nativeActionV1OverloadTrapCount = 0;
    this.nativeActionV1StunnedContactTrapCount = 0;
    this.nativeActionV1TurnThenFireTrapCount = 0;
    this.pairCount = new Uint32Array(FAMILY_COUNT * FAMILY_COUNT);
    this.exactPairCount = new Uint32Array((ACTION.BOOST_RIGHT_BOMB + 1) *
      (ACTION.BOOST_RIGHT_BOMB + 1));
    this.intentPairCount = new Uint32Array(INTENT_NAME.length *
      (ACTION.BOOST_RIGHT_BOMB + 1) * (ACTION.BOOST_RIGHT_BOMB + 1));
    // One search run evaluates the whole ownership curve.  This is diagnostic
    // evidence only: it does not change the selected action or production
    // semantics.  The baseline is the native V1-shaped committed intent
    // action; minimax may replace it only when its value lead clears a margin.
    this.basePolicyVerifierCompareCount = new Uint32Array(VERIFIER_MARGIN.length);
    this.basePolicyVerifierAgreementCount = new Uint32Array(VERIFIER_MARGIN.length);
    this.basePolicyStageCompareCount = 0; this.basePolicyStageAgreementCount = 0;
    this.searchStageCommonCompareCount = 0; this.searchStageCommonAgreementCount = 0;
    this.cellwiseVerifierCompareCount = 0; this.cellwiseVerifierAgreementCount = 0;
    this.cellwiseVerifierOverrideCount = 0;
    this.fullControllerCompareCount = 0;
    this.fullControllerAgreementCount = 0;
    this.fullControllerStageCount = new Uint32Array(OWNERSHIP_STAGE_NAMES.length);
    this.fullControllerStageAgreementCount =
      new Uint32Array(OWNERSHIP_STAGE_NAMES.length);
    this.missedV1FireCount = 0; this.missedV1FireMissingRowCount = 0;
    this.missedV1FireAllowedCount = 0;
    this.missedV1FireGapBuckets = new Uint32Array(FIRE_GAP_LIMIT.length + 2);
    this.missedV1FireDirectKillCount = 0; this.missedV1FireAimSetupCount = 0;
    this.missedV1FireInterceptCount = 0; this.missedV1FirePossibleHitCount = 0;
    this.missedV1FirePostEscapeCount = 0;
    this.missedV1FirePurposeCompleteCount = 0;
    this.missedV1FireCounterExposureTotal = 0;
    this.missedV1FireEnemySafeSuccessorTotal = 0;
    this.nativeFireCount = 0; this.nativeFireV1Count = 0;
    this.nativeFireInterceptCount = 0; this.nativeFireV1InterceptCount = 0;
    this.nativeFirePossibleHitCount = 0; this.nativeFireV1PossibleHitCount = 0;
    this.nativeFirePostEscapeCount = 0; this.nativeFireV1PostEscapeCount = 0;
    this.nativeFirePurposeCompleteCount = 0;
    this.nativeFireV1PurposeCompleteCount = 0;
    this.nativeFireCounterExposureTotal = 0;
    this.nativeFireV1CounterExposureTotal = 0;
    this.hotAllocationCount = 0;
  }

  observe(incumbentAction, nativeOverride, nativeProposed,
      oracleOverride, oracleProposed, engine = null, owner = null,
      nativeResult = NATIVE_RESULT.OTHER_FALLBACK, v1Rounds = 0,
      v1Evaluated = null, monteCarloUsed = 0,
      oracleStageAction = ACTION.NONE, fullControllerStage = -1,
      fullControllerAction = ACTION.NONE) {
    const nativeFinalAction = nativeOverride ? nativeOverride.action : incumbentAction;
    if (fullControllerAction !== ACTION.NONE && fullControllerStage >= 0 &&
        fullControllerStage < this.fullControllerStageCount.length) {
      this.fullControllerCompareCount += 1;
      this.fullControllerStageCount[fullControllerStage] += 1;
      if (nativeFinalAction === fullControllerAction) {
        this.fullControllerAgreementCount += 1;
        this.fullControllerStageAgreementCount[fullControllerStage] += 1;
      }
    }
    if (!oracleProposed) return oracleOverride;
    this.compareCount += 1;
    if (nativeProposed) this.nativeProposalCount += 1;
    else {
      this.nativeFallbackCount += 1;
      this.fallbackByReason[nativeResult] += 1;
    }
    this.oracleProposalCount += 1;
    if (nativeProposed) this.bothProposalCount += 1;
    const nativeAction = nativeOverride ? nativeOverride.action : incumbentAction;
    const oracleAction = oracleOverride ? oracleOverride.action : incumbentAction;
    if (oracleStageAction !== ACTION.NONE) {
      this.v1StageActionCompareCount += 1;
      if (nativeAction === oracleStageAction) this.v1StageActionAgreementCount += 1;
    }
    if (Array.isArray(v1Evaluated)) {
      const rawBest = this.bestV1Action(v1Evaluated, "rawValue");
      const preMonteCarloBest = this.bestV1Action(v1Evaluated,
        "preMonteCarloValue");
      const evaluatedFinalBest = this.bestV1Action(v1Evaluated, "value");
      const instrumentedChosen = actionFromLegacy(v1Evaluated._v3ChosenAction);
      if (nativeProposed && engine && owner) {
        const nativeRawBest = this.bestNativeAction(engine, owner, true);
        const nativeAdjustedBest = this.bestNativeAction(engine, owner, false);
        if (nativeRawBest !== ACTION.NONE && rawBest !== ACTION.NONE) {
          this.nativeRawV1RawCompareCount += 1;
          if (nativeRawBest === rawBest) this.nativeRawV1RawAgreementCount += 1;
        }
        if (nativeAdjustedBest !== ACTION.NONE &&
            preMonteCarloBest !== ACTION.NONE) {
          this.nativeAdjustedV1PreCompareCount += 1;
          if (nativeAdjustedBest === preMonteCarloBest)
            this.nativeAdjustedV1PreAgreementCount += 1;
        }
        if (oracleStageAction !== ACTION.NONE)
          this.compareBasePolicyVerifier(engine, owner, nativeAdjustedBest,
            oracleStageAction);
      }
      if (rawBest !== ACTION.NONE) {
        this.v1RawBestCompareCount += 1;
        if (nativeAction === rawBest) this.v1RawBestAgreementCount += 1;
        if (rawBest !== oracleStageAction) this.v1RawToFinalDifferenceCount += 1;
      }
      if (preMonteCarloBest !== ACTION.NONE) {
        this.v1PreMonteCarloBestCompareCount += 1;
        if (nativeAction === preMonteCarloBest)
          this.v1PreMonteCarloBestAgreementCount += 1;
        if (preMonteCarloBest !== oracleStageAction)
          this.v1PreMonteCarloToFinalDifferenceCount += 1;
      }
      if (evaluatedFinalBest !== ACTION.NONE) {
        this.v1EvaluatedFinalBestCompareCount += 1;
        if (evaluatedFinalBest === oracleStageAction)
          this.v1EvaluatedFinalBestAgreementCount += 1;
      }
      if (instrumentedChosen !== ACTION.NONE) {
        this.v1InstrumentedChosenCompareCount += 1;
        if (instrumentedChosen === oracleStageAction)
          this.v1InstrumentedChosenAgreementCount += 1;
      }
    }
    if (nativeProposed && nativeAction !== oracleAction && Array.isArray(v1Evaluated)) {
      for (let index = 0; index < v1Evaluated.length; index += 1) {
        const entry = v1Evaluated[index];
        if (actionFromLegacy(entry?.action) !== nativeAction) continue;
        if (entry.unsafe) this.nativeActionV1UnsafeCount += 1;
        if (entry.overloadTrap) this.nativeActionV1OverloadTrapCount += 1;
        if (entry.stunnedContactTrap) this.nativeActionV1StunnedContactTrapCount += 1;
        if (entry.turnThenFireTrap) this.nativeActionV1TurnThenFireTrapCount += 1;
        break;
      }
    }
    if (nativeAction === oracleAction) {
      this.actionAgreementCount += 1;
      if (nativeProposed) this.nativeProposalAgreementCount += 1;
      else this.nativeFallbackAgreementCount += 1;
    } else {
      this.actionDisagreementCount += 1;
      if (nativeProposed) this.nativeProposalDisagreementCount += 1;
      else {
        this.nativeFallbackDisagreementCount += 1;
        this.fallbackDisagreementByReason[nativeResult] += 1;
      }
      if (nativeProposed)
        this.classifyDisagreement(engine, owner, nativeAction, oracleAction);
    }
    if (nativeProposed && engine) {
      this.observeMissedFire(engine, owner, nativeAction, oracleStageAction);
      this.observeNativeFire(engine, owner, nativeAction, oracleStageAction);
      const source = owner?.lastSource || (engine.informationSearch?.completedDepth > 0 &&
        engine.informationSearch.supportComplete === 1 &&
        engine.informationSearch.approximate === 0 ? engine.informationSearch :
        engine.depthSearch);
      const depth = Math.max(0, Math.min(4,
        (source?.representativeSupportDepth ?? source?.completedDepth ?? 0) | 0));
      const rounds = Math.max(0, Math.min(4, v1Rounds | 0));
      this.compareByNativeDepth[depth] += 1;
      if (nativeAction === oracleAction) this.agreementByNativeDepth[depth] += 1;
      else this.disagreementByNativeDepth[depth] += 1;
      this.depthRoundPairs[depth * 5 + rounds] += 1;
      this.compareOrdering(engine, owner, v1Evaluated);
    }
    if (monteCarloUsed) {
      this.monteCarloCompareCount += 1;
      if (nativeAction === oracleAction) this.monteCarloAgreementCount += 1;
      else this.monteCarloDisagreementCount += 1;
    }
    this.pairCount[family(nativeAction) * FAMILY_COUNT + family(oracleAction)] += 1;
    const width = ACTION.BOOST_RIGHT_BOMB + 1;
    if (nativeAction >= 0 && nativeAction < width && oracleAction >= 0 &&
        oracleAction < width) {
      this.exactPairCount[nativeAction * width + oracleAction] += 1;
      const intent = Math.max(0, Math.min(INTENT_NAME.length - 1,
        owner?.intent?.committed | 0));
      this.intentPairCount[(intent * width + nativeAction) * width + oracleAction] += 1;
    }
    return oracleOverride;
  }

  bestValueForAction(engine, owner, action) {
    let value = -2147483648;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && owner.allowedRow[row] &&
          owner.backedValue[row] > value) value = owner.backedValue[row];
    return value;
  }

  observeMissedFire(engine, owner, nativeAction, oracleStageAction) {
    if (!engine || !owner || oracleStageAction !== ACTION.FIRE ||
        nativeAction === ACTION.FIRE) return;
    this.missedV1FireCount += 1;
    let fireRow = -1; let fireValue = -2147483648;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === ACTION.FIRE && owner.allowedRow[row] &&
          owner.backedValue[row] > fireValue) {
        fireRow = row; fireValue = owner.backedValue[row];
      }
    if (fireRow < 0) { this.missedV1FireMissingRowCount += 1; return; }
    this.missedV1FireAllowedCount += 1;
    const selectedValue = this.bestValueForAction(engine, owner, nativeAction);
    const gap = selectedValue === -2147483648 ? 2147483647 : selectedValue - fireValue;
    let bucket = gap < 0 ? 0 : FIRE_GAP_LIMIT.length + 1;
    if (gap >= 0)
      for (let index = 0; index < FIRE_GAP_LIMIT.length; index += 1)
        if (gap <= FIRE_GAP_LIMIT[index]) { bucket = index + 1; break; }
    this.missedV1FireGapBuckets[bucket] += 1;
    const combat = engine.combat?.vector;
    if (!combat || fireRow >= combat.count) return;
    this.missedV1FireDirectKillCount += combat.directKill[fireRow] ? 1 : 0;
    this.missedV1FireAimSetupCount += combat.aimSetup[fireRow] ? 1 : 0;
    this.missedV1FireInterceptCount += combat.intercept[fireRow] ? 1 : 0;
    this.missedV1FirePossibleHitCount += combat.possibleHit[fireRow] ? 1 : 0;
    this.missedV1FirePostEscapeCount += combat.postFireEscape[fireRow] ? 1 : 0;
    this.missedV1FirePurposeCompleteCount +=
      combat.purposeCompleteness[fireRow] >= 4500 ? 1 : 0;
    this.missedV1FireCounterExposureTotal += combat.ownCounterExposure[fireRow] || 0;
    this.missedV1FireEnemySafeSuccessorTotal +=
      combat.enemySafeSuccessors[fireRow] || 0;
  }

  observeNativeFire(engine, owner, nativeAction, oracleStageAction) {
    if (!engine || !owner || nativeAction !== ACTION.FIRE) return;
    let row = -1;
    for (let index = 0; index < engine.ourCount; index += 1)
      if (engine.ourActions[index] === ACTION.FIRE && owner.allowedRow[index]) {
        row = index; break;
      }
    if (row < 0) return;
    const combat = engine.combat?.vector;
    if (!combat || row >= combat.count) return;
    const agrees = oracleStageAction === ACTION.FIRE;
    this.nativeFireCount += 1; this.nativeFireV1Count += agrees ? 1 : 0;
    this.nativeFireInterceptCount += combat.intercept[row] ? 1 : 0;
    this.nativeFireV1InterceptCount += agrees && combat.intercept[row] ? 1 : 0;
    this.nativeFirePossibleHitCount += combat.possibleHit[row] ? 1 : 0;
    this.nativeFireV1PossibleHitCount += agrees && combat.possibleHit[row] ? 1 : 0;
    this.nativeFirePostEscapeCount += combat.postFireEscape[row] ? 1 : 0;
    this.nativeFireV1PostEscapeCount += agrees && combat.postFireEscape[row] ? 1 : 0;
    const purpose = combat.purposeCompleteness[row] >= 4500;
    this.nativeFirePurposeCompleteCount += purpose ? 1 : 0;
    this.nativeFireV1PurposeCompleteCount += agrees && purpose ? 1 : 0;
    this.nativeFireCounterExposureTotal += combat.ownCounterExposure[row] || 0;
    this.nativeFireV1CounterExposureTotal +=
      agrees ? combat.ownCounterExposure[row] || 0 : 0;
  }

  cellwiseDominatesAction(engine, owner, candidateAction, baselineAction) {
    const source = owner?.lastSource;
    if (!source?.rootCellScore || candidateAction === baselineAction) return 0;
    const stride = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    let strict = 0; let compared = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      let candidate = -2147483648; let baseline = -2147483648;
      for (let row = 0; row < engine.ourCount; row += 1) {
        if (!owner.allowedRow[row] || source.rootDomainRestricted &&
            !source.rootDomainMask[row]) continue;
        const value = source.rootCellScore[row * stride + column];
        if (engine.ourActions[row] === candidateAction && value > candidate)
          candidate = value;
        if (engine.ourActions[row] === baselineAction && value > baseline)
          baseline = value;
      }
      if (candidate === -2147483648 || baseline === -2147483648 ||
          candidate < baseline) return 0;
      if (candidate > baseline) strict = 1;
      compared += 1;
    }
    return compared === engine.enemyCount && strict ? 1 : 0;
  }

  compareBasePolicyVerifier(engine, owner, searchAction, oracleStageAction) {
    const baseAction = owner?.intent?.currentCommittedAction ?? ACTION.NONE;
    const baseValue = this.bestValueForAction(engine, owner, baseAction);
    const searchValue = this.bestValueForAction(engine, owner, searchAction);
    if (baseAction === ACTION.NONE || baseValue === -2147483648 ||
        searchAction === ACTION.NONE || searchValue === -2147483648) return;
    this.basePolicyStageCompareCount += 1;
    if (baseAction === oracleStageAction) this.basePolicyStageAgreementCount += 1;
    this.searchStageCommonCompareCount += 1;
    if (searchAction === oracleStageAction) this.searchStageCommonAgreementCount += 1;
    const lead = searchValue - baseValue;
    for (let index = 0; index < VERIFIER_MARGIN.length; index += 1) {
      const selected = searchAction !== baseAction &&
        lead > VERIFIER_MARGIN[index] ? searchAction : baseAction;
      this.basePolicyVerifierCompareCount[index] += 1;
      if (selected === oracleStageAction)
        this.basePolicyVerifierAgreementCount[index] += 1;
    }
    const dominated = this.cellwiseDominatesAction(engine, owner,
      searchAction, baseAction);
    const selected = dominated ? searchAction : baseAction;
    this.cellwiseVerifierCompareCount += 1;
    this.cellwiseVerifierOverrideCount += dominated;
    if (selected === oracleStageAction) this.cellwiseVerifierAgreementCount += 1;
  }

  bestNativeAction(engine, owner, raw) {
    const source = owner.lastSource;
    if (!source) return ACTION.NONE;
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    let bestAction = ACTION.NONE; let bestValue = -2147483648;
    for (let row = 0; row < count; row += 1) {
      if (!owner.allowedRow[row] || source.rootDomainRestricted &&
          !source.rootDomainMask[row]) continue;
      const value = raw ? source.rootScore[row] : owner.backedValue[row];
      const action = engine.ourActions[row];
      if (value > bestValue || value === bestValue &&
          this.actionPriority(action) > this.actionPriority(bestAction)) {
        bestValue = value; bestAction = action;
      }
    }
    return bestAction;
  }

  actionPriority(action) {
    if (action === ACTION.GO) return 5;
    if (action === ACTION.FIRE) return 4;
    if (action === ACTION.THROW_BOMB || action === ACTION.CAST_STUN) return 3;
    if (action === ACTION.TURN_LEFT) return 2;
    if (action === ACTION.TURN_RIGHT) return 1;
    return action === ACTION.NONE ? -1 : 0;
  }

  bestV1Action(evaluated, valueField) {
    let hasSafe = false;
    for (let index = 0; index < evaluated.length; index += 1)
      if (!evaluated[index]?.unsafe) { hasSafe = true; break; }
    let bestAction = ACTION.NONE; let bestValue = -Infinity;
    for (let index = 0; index < evaluated.length; index += 1) {
      const entry = evaluated[index];
      if (!entry || hasSafe && entry.unsafe ||
          typeof entry[valueField] !== "number") continue;
      const action = actionFromLegacy(entry.action);
      const value = entry[valueField];
      if (value > bestValue || value === bestValue &&
          this.actionPriority(action) > this.actionPriority(bestAction)) {
        bestValue = value; bestAction = action;
      }
    }
    return bestAction;
  }

  bestRawValueForAction(engine, owner, action) {
    const source = owner?.lastSource; let value = -2147483648;
    if (!source) return value;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && owner.allowedRow[row] &&
          (!source.rootDomainRestricted || source.rootDomainMask[row]) &&
          source.rootScore[row] > value) value = source.rootScore[row];
    return value;
  }

  compareOrdering(engine, owner, evaluated) {
    if (!Array.isArray(evaluated)) return;
    for (let left = 0; left < evaluated.length; left += 1) {
      const leftAction = actionFromLegacy(evaluated[left]?.action);
      const leftValue = this.bestValueForAction(engine, owner, leftAction);
      if (leftAction === ACTION.NONE || leftValue === -2147483648) continue;
      for (let right = left + 1; right < evaluated.length; right += 1) {
        const rightAction = actionFromLegacy(evaluated[right]?.action);
        const rightValue = this.bestValueForAction(engine, owner, rightAction);
        const leftRaw = this.bestRawValueForAction(engine, owner, leftAction);
        const rightRaw = this.bestRawValueForAction(engine, owner, rightAction);
        if (rightAction === ACTION.NONE || rightAction === leftAction ||
            rightValue === -2147483648) continue;
        const v1 = Math.sign(evaluated[left].value - evaluated[right].value);
        const v2 = Math.sign(leftValue - rightValue);
        this.pairwiseOrderCount += 1;
        if (!v1 || !v2) this.pairwiseTieCount += 1;
        else if (v1 === v2) this.pairwiseConcordantCount += 1;
        else this.pairwiseDiscordantCount += 1;
        if (leftRaw !== -2147483648 && rightRaw !== -2147483648) {
          const v1Raw = Math.sign(evaluated[left].rawValue -
            evaluated[right].rawValue);
          const nativeRaw = Math.sign(leftRaw - rightRaw);
          this.rawPairwiseOrderCount += 1;
          if (!v1Raw || !nativeRaw) this.rawPairwiseTieCount += 1;
          else if (v1Raw === nativeRaw) this.rawPairwiseConcordantCount += 1;
          else this.rawPairwiseDiscordantCount += 1;
        }
      }
    }
  }

  classifyDisagreement(engine, owner, nativeAction, oracleAction) {
    if (!engine || !owner) return;
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    let matching = 0; let hardAllowed = 0; let domainAllowed = 0;
    let deepestStage = MEMBERSHIP_STAGE.UNSEEN;
    let oracleValue = -2147483648; let nativeValue = -2147483648;
    for (let row = 0; row < count; row += 1) {
      const action = engine.ourActions[row];
      if (action === oracleAction) {
        matching += 1;
        if (engine.hardStatus[row] === HARD_STATUS.ALLOW) hardAllowed += 1;
        deepestStage = Math.max(deepestStage,
          owner.membershipStage?.[row] || MEMBERSHIP_STAGE.UNSEEN);
        if (owner.allowedRow[row]) {
          domainAllowed += 1;
          if (owner.backedValue[row] > oracleValue)
            oracleValue = owner.backedValue[row];
        }
      }
      if (action === nativeAction && owner.allowedRow[row] &&
          owner.backedValue[row] > nativeValue)
        nativeValue = owner.backedValue[row];
    }
    if (!matching) this.oracleActionMissingCount += 1;
    else if (!hardAllowed) this.oracleActionHardBlockedCount += 1;
    else if (!domainAllowed) {
      this.oracleActionDomainBlockedCount += 1;
      if (deepestStage === MEMBERSHIP_STAGE.RISK_REJECTED)
        this.oracleActionRiskRejectedCount += 1;
      else if (deepestStage === MEMBERSHIP_STAGE.RISK_PARETO_BLOCKED)
        this.oracleActionRiskParetoBlockedCount += 1;
      else if (deepestStage === MEMBERSHIP_STAGE.COMMITTED_BLOCKED)
        this.oracleActionCommittedBlockedCount += 1;
      else if (deepestStage === MEMBERSHIP_STAGE.SOURCE_DOMAIN_BLOCKED)
        this.oracleActionSourceDomainBlockedCount += 1;
      else if (deepestStage === MEMBERSHIP_STAGE.OWNER_DOMAIN_BLOCKED)
        this.oracleActionOwnerDomainBlockedCount += 1;
      else if (deepestStage === MEMBERSHIP_STAGE.INTENT_BLOCKED)
        this.oracleActionIntentBlockedCount += 1;
      else this.oracleActionOtherMembershipBlockedCount += 1;
    }
    else {
      this.oracleActionAllowedCount += 1;
      if (oracleValue < nativeValue) this.oracleActionRankedLowerCount += 1;
      else if (oracleValue === nativeValue) this.oracleActionRankedEqualCount += 1;
      else this.oracleActionRankedHigherCount += 1;
    }
  }

  summary() {
    const names = ["NONE", "GO", "TURN", "FIRE", "RESOURCE"];
    const familyPairs = {};
    const exactPairs = {};
    const intentPairs = {};
    for (let left = 0; left < FAMILY_COUNT; left += 1)
      for (let right = 0; right < FAMILY_COUNT; right += 1) {
        const count = this.pairCount[left * FAMILY_COUNT + right];
        if (count) familyPairs[`${names[left]}->${names[right]}`] = count;
      }
    const width = ACTION.BOOST_RIGHT_BOMB + 1;
    for (let native = 0; native < width; native += 1)
      for (let oracle = 0; oracle < width; oracle += 1) {
        const count = this.exactPairCount[native * width + oracle];
        if (count) exactPairs[`${ACTION_NAME[native]}->${ACTION_NAME[oracle]}`] = count;
      }
    for (let intent = 0; intent < INTENT_NAME.length; intent += 1)
      for (let native = 0; native < width; native += 1)
        for (let oracle = 0; oracle < width; oracle += 1) {
          const count = this.intentPairCount[(intent * width + native) * width + oracle];
          if (count) intentPairs[`${INTENT_NAME[intent]}:${
            ACTION_NAME[native]}->${ACTION_NAME[oracle]}`] = count;
        }
    return { enabled: true, semantics: "SAME_ROOT_NATIVE_V1_POLICY_DIFFERENTIAL",
      activeOwner: this.activeOwner,
      compareCount: this.compareCount, actionAgreementCount: this.actionAgreementCount,
      actionDisagreementCount: this.actionDisagreementCount,
      agreementBasisPoints: this.compareCount ?
        Math.round(this.actionAgreementCount * 10000 / this.compareCount) : 0,
      nativeProposalCount: this.nativeProposalCount,
      oracleProposalCount: this.oracleProposalCount,
      bothProposalCount: this.bothProposalCount,
      nativeFallbackCount: this.nativeFallbackCount,
      nativeProposalAgreementCount: this.nativeProposalAgreementCount,
      nativeProposalDisagreementCount: this.nativeProposalDisagreementCount,
      nativeFallbackAgreementCount: this.nativeFallbackAgreementCount,
      nativeFallbackDisagreementCount: this.nativeFallbackDisagreementCount,
      fallbackByReason: Array.from(this.fallbackByReason),
      fallbackDisagreementByReason: Array.from(this.fallbackDisagreementByReason),
      compareByNativeDepth: Array.from(this.compareByNativeDepth),
      agreementByNativeDepth: Array.from(this.agreementByNativeDepth),
      disagreementByNativeDepth: Array.from(this.disagreementByNativeDepth),
      depthRoundPairs: Array.from(this.depthRoundPairs),
      monteCarloCompareCount: this.monteCarloCompareCount,
      monteCarloAgreementCount: this.monteCarloAgreementCount,
      monteCarloDisagreementCount: this.monteCarloDisagreementCount,
      v1RawBestCompareCount: this.v1RawBestCompareCount,
      v1RawBestAgreementCount: this.v1RawBestAgreementCount,
      v1PreMonteCarloBestCompareCount: this.v1PreMonteCarloBestCompareCount,
      v1PreMonteCarloBestAgreementCount:
        this.v1PreMonteCarloBestAgreementCount,
      v1EvaluatedFinalBestCompareCount: this.v1EvaluatedFinalBestCompareCount,
      v1EvaluatedFinalBestAgreementCount:
        this.v1EvaluatedFinalBestAgreementCount,
      v1InstrumentedChosenCompareCount: this.v1InstrumentedChosenCompareCount,
      v1InstrumentedChosenAgreementCount:
        this.v1InstrumentedChosenAgreementCount,
      v1StageActionCompareCount: this.v1StageActionCompareCount,
      v1StageActionAgreementCount: this.v1StageActionAgreementCount,
      nativeRawV1RawCompareCount: this.nativeRawV1RawCompareCount,
      nativeRawV1RawAgreementCount: this.nativeRawV1RawAgreementCount,
      nativeAdjustedV1PreCompareCount: this.nativeAdjustedV1PreCompareCount,
      nativeAdjustedV1PreAgreementCount:
        this.nativeAdjustedV1PreAgreementCount,
      v1RawToFinalDifferenceCount: this.v1RawToFinalDifferenceCount,
      v1PreMonteCarloToFinalDifferenceCount:
        this.v1PreMonteCarloToFinalDifferenceCount,
      pairwiseOrderCount: this.pairwiseOrderCount,
      pairwiseConcordantCount: this.pairwiseConcordantCount,
      pairwiseDiscordantCount: this.pairwiseDiscordantCount,
      pairwiseTieCount: this.pairwiseTieCount,
      rawPairwiseOrderCount: this.rawPairwiseOrderCount,
      rawPairwiseConcordantCount: this.rawPairwiseConcordantCount,
      rawPairwiseDiscordantCount: this.rawPairwiseDiscordantCount,
      rawPairwiseTieCount: this.rawPairwiseTieCount,
      oracleActionMissingCount: this.oracleActionMissingCount,
      oracleActionHardBlockedCount: this.oracleActionHardBlockedCount,
      oracleActionDomainBlockedCount: this.oracleActionDomainBlockedCount,
      oracleActionRiskRejectedCount: this.oracleActionRiskRejectedCount,
      oracleActionRiskParetoBlockedCount:
        this.oracleActionRiskParetoBlockedCount,
      oracleActionCommittedBlockedCount: this.oracleActionCommittedBlockedCount,
      oracleActionSourceDomainBlockedCount:
        this.oracleActionSourceDomainBlockedCount,
      oracleActionOwnerDomainBlockedCount:
        this.oracleActionOwnerDomainBlockedCount,
      oracleActionIntentBlockedCount: this.oracleActionIntentBlockedCount,
      oracleActionOtherMembershipBlockedCount:
        this.oracleActionOtherMembershipBlockedCount,
      oracleActionAllowedCount: this.oracleActionAllowedCount,
      oracleActionRankedLowerCount: this.oracleActionRankedLowerCount,
      oracleActionRankedEqualCount: this.oracleActionRankedEqualCount,
      oracleActionRankedHigherCount: this.oracleActionRankedHigherCount,
      nativeActionV1UnsafeCount: this.nativeActionV1UnsafeCount,
      nativeActionV1OverloadTrapCount: this.nativeActionV1OverloadTrapCount,
      nativeActionV1StunnedContactTrapCount:
        this.nativeActionV1StunnedContactTrapCount,
      nativeActionV1TurnThenFireTrapCount:
        this.nativeActionV1TurnThenFireTrapCount,
      oracleFallbackCount: this.oracleFallbackCount,
      familyPairs, exactPairs, intentPairs,
      verifierMargins: Array.from(VERIFIER_MARGIN),
      basePolicyStageCompareCount: this.basePolicyStageCompareCount,
      basePolicyStageAgreementCount: this.basePolicyStageAgreementCount,
      searchStageCommonCompareCount: this.searchStageCommonCompareCount,
      searchStageCommonAgreementCount: this.searchStageCommonAgreementCount,
      basePolicyVerifierCompareCount: Array.from(this.basePolicyVerifierCompareCount),
      basePolicyVerifierAgreementCount: Array.from(this.basePolicyVerifierAgreementCount),
      cellwiseVerifierCompareCount: this.cellwiseVerifierCompareCount,
      cellwiseVerifierAgreementCount: this.cellwiseVerifierAgreementCount,
      cellwiseVerifierOverrideCount: this.cellwiseVerifierOverrideCount,
      fullControllerCompareCount: this.fullControllerCompareCount,
      fullControllerAgreementCount: this.fullControllerAgreementCount,
      fullControllerAgreementBasisPoints: this.fullControllerCompareCount ?
        Math.round(this.fullControllerAgreementCount * 10000 /
          this.fullControllerCompareCount) : 0,
      fullControllerStageNames: Array.from(OWNERSHIP_STAGE_NAMES),
      fullControllerStageCount: Array.from(this.fullControllerStageCount),
      fullControllerStageAgreementCount:
        Array.from(this.fullControllerStageAgreementCount),
      missedV1FireCount: this.missedV1FireCount,
      missedV1FireMissingRowCount: this.missedV1FireMissingRowCount,
      missedV1FireAllowedCount: this.missedV1FireAllowedCount,
      missedV1FireGapLimits: Array.from(FIRE_GAP_LIMIT),
      missedV1FireGapBuckets: Array.from(this.missedV1FireGapBuckets),
      missedV1FireDirectKillCount: this.missedV1FireDirectKillCount,
      missedV1FireAimSetupCount: this.missedV1FireAimSetupCount,
      missedV1FireInterceptCount: this.missedV1FireInterceptCount,
      missedV1FirePossibleHitCount: this.missedV1FirePossibleHitCount,
      missedV1FirePostEscapeCount: this.missedV1FirePostEscapeCount,
      missedV1FirePurposeCompleteCount: this.missedV1FirePurposeCompleteCount,
      missedV1FireCounterExposureTotal: this.missedV1FireCounterExposureTotal,
      missedV1FireEnemySafeSuccessorTotal:
        this.missedV1FireEnemySafeSuccessorTotal,
      nativeFireCount: this.nativeFireCount,
      nativeFireV1Count: this.nativeFireV1Count,
      nativeFireInterceptCount: this.nativeFireInterceptCount,
      nativeFireV1InterceptCount: this.nativeFireV1InterceptCount,
      nativeFirePossibleHitCount: this.nativeFirePossibleHitCount,
      nativeFireV1PossibleHitCount: this.nativeFireV1PossibleHitCount,
      nativeFirePostEscapeCount: this.nativeFirePostEscapeCount,
      nativeFireV1PostEscapeCount: this.nativeFireV1PostEscapeCount,
      nativeFirePurposeCompleteCount: this.nativeFirePurposeCompleteCount,
      nativeFireV1PurposeCompleteCount: this.nativeFireV1PurposeCompleteCount,
      nativeFireCounterExposureTotal: this.nativeFireCounterExposureTotal,
      nativeFireV1CounterExposureTotal: this.nativeFireV1CounterExposureTotal,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { family, NATIVE_RESULT, NativeBasePolicyDifferentialPoc };
