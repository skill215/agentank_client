"use strict";

// Sparse behavior-neutral policy comparison.  At a stable ATTACK-vs-STAR
// conflict it enumerates every supported enemy first response, then lets both
// semantic Options continue with state-conditioned policies.  Enemy response
// probabilities come from the per-match OpponentModel and are backed up with
// the same epsilon-contamination rule as Risk.  The result stays a vector and
// never owns an action.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { PROBABILITY_SCALE, RISK_DIMENSION } = require(
  "../../../engine-v2/src/abi/search-codes");
const { contaminatedLower } = require(
  "../../../engine-v2/src/search/fixed-math");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { StatefulOptionRollout, OPTION_KIND, ROLLOUT_INCOMPLETE_REASON,
  ROLLOUT_UNSUPPORTED_SITE } = require("./stateful-option-rollout");
const { MOVE_CONTEST_VARIANT } = require("./move-contest-variant-kernel");

const ENEMY_CAPABILITY_CADENCE_MISMATCH = 32;
const ROLLOUT_PHASE = Object.freeze({ PHYSICAL: 0, POSSIBLE_ABSENCE: 1,
  POSSIBLE_PRESENCE: 2, COUNT: 3 });
const ROLLOUT_OPTION_ROLE = Object.freeze({ STAR: 0, ATTACK: 1, COUNT: 2 });
const ACTION_COUNT = ACTION.BOOST_RIGHT_BOMB + 1;

const RISK_POINTS = Object.freeze([0, 25, 50, 65, 75, 100]);
const POLICY_DIMENSION = Object.freeze({
  NONLOSS: 0,
  TERMINAL: 1,
  ENEMY_CRASH: 2,
  PROJECTILE_THREAT: 3,
  ENEMY_MOBILITY: 4,
  STAR_GAIN: 5,
  STAR_DISTANCE: 6,
  OWN_MOBILITY: 7,
  OWN_FIRE_LANE: 8,
  ENEMY_FIRE_LANE: 9,
  RESOURCE_COMMITMENT: 10,
  COUNT: 11
});
const TEMPORAL_DIMENSION = Object.freeze({
  PROJECTILE_THREAT_FRAMES: 0,
  ENEMY_MOBILITY_FLOOR: 1,
  ENEMY_MOBILITY_INTEGRAL: 2,
  OWN_FIRE_LANE_FRAMES: 3,
  ENEMY_FIRE_LANE_FRAMES: 4,
  COUNT: 5
});
const POLICY_RELATION = Object.freeze({
  EQUAL: 0,
  ATTACK_DOMINATES: 1,
  STAR_DOMINATES: 2,
  TRADEOFF: 3
});
const POLICY_EVALUATION_STATUS = Object.freeze({
  NONE: 0,
  COMPLETE: 1,
  HIDDEN: 2,
  TRACKING_INCOMPLETE: 3,
  POSSIBLE_PROJECTILE: 4,
  SUPPORT_INCOMPLETE: 5,
  INVALID_ROW: 6,
  PROBABILITY_INCOMPLETE: 7,
  ROLLOUT_INCOMPLETE: 8,
  POSSIBLE_WORLD_INCOMPLETE: 9,
  POSSIBLE_WORLD_RESTORE: 10,
  POSSIBLE_WORLD_CADENCE: 11
});

function clamp(value) {
  return value < -10000 ? -10000 : value > 10000 ? 10000 : value;
}

class ResponseConditionedOptionPolicyShadow {
  constructor(interval, horizon = 4, options = {}) {
    options = options || {};
    this.interval = interval;
    this.possibleProjectileWorlds = options.possibleProjectileWorlds ? 1 : 0;
    this.moveContestVariant = options.moveContestVariant ||
      MOVE_CONTEST_VARIANT.FAIL_CLOSED;
    this.rollout = new StatefulOptionRollout(2, horizon, {
      moveContestVariant: this.moveContestVariant
    });
    this.enemyProbability = new Uint16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.worldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * POLICY_DIMENSION.COUNT);
    this.absenceWorldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * POLICY_DIMENSION.COUNT);
    this.presentWorldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * POLICY_DIMENSION.COUNT);
    this.temporalWorldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * TEMPORAL_DIMENSION.COUNT);
    this.temporalAbsenceWorldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * TEMPORAL_DIMENSION.COUNT);
    this.temporalPresentWorldDelta = new Int16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * TEMPORAL_DIMENSION.COUNT);
    this.commonSequenceAction = new Uint8Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * 2 * horizon);
    this.commonSequenceArgument = new Uint16Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES * 2 * horizon);
    this.expected = new Int16Array(POLICY_DIMENSION.COUNT);
    this.worst = new Int16Array(POLICY_DIMENSION.COUNT);
    this.robust = new Int16Array(RISK_POINTS.length * POLICY_DIMENSION.COUNT);
    this.temporalExpected = new Int16Array(TEMPORAL_DIMENSION.COUNT);
    this.temporalWorst = new Int16Array(TEMPORAL_DIMENSION.COUNT);
    this.temporalRobust = new Int16Array(
      RISK_POINTS.length * TEMPORAL_DIMENSION.COUNT);
    this.relationByRisk = new Uint32Array(RISK_POINTS.length * 4);
    this.observationCount = 0; this.evaluationCount = 0;
    this.duplicateSkipCount = 0; this.hiddenSkipCount = 0;
    this.trackingSkipCount = 0; this.possibleProjectileSkipCount = 0;
    this.possibleProjectileCount = new Uint32Array(9);
    this.possibleProjectilePoolCompleteCount = 0;
    this.possibleProjectilePoolIncompleteCount = 0;
    this.possibleProjectileEnemyOnlyCount = 0;
    this.possibleProjectileMixedOwnerCount = 0;
    this.possibleWorldAttemptCount = 0;
    this.possibleWorldCompleteCount = 0;
    this.possibleWorldIncompleteCount = 0;
    this.possibleWorldUnsupportedCount = 0;
    this.possibleWorldInjectionFailureCount = 0;
    this.possibleWorldRootRestoreFailureCount = 0;
    this.possibleWorldCadenceRephaseCount = 0;
    this.possibleWorldCommonSequenceCount = 0;
    this.possibleWorldReducedDimensionCount = 0;
    this.rolloutFailureByReason = new Uint32Array(
      ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutFailureByPhaseReason = new Uint32Array(
      ROLLOUT_PHASE.COUNT * ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutFailureByOptionReason = new Uint32Array(
      ROLLOUT_OPTION_ROLE.COUNT * ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutFailureByStepReason = new Uint32Array(
      horizon * ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutFailureByEnemyActionReason = new Uint32Array(
      ACTION_COUNT * ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutIncompleteRootByReason = new Uint32Array(
      ROLLOUT_INCOMPLETE_REASON.COUNT);
    this.rolloutFailureByUnsupportedSite = new Uint32Array(
      ROLLOUT_UNSUPPORTED_SITE.COUNT);
    this.rolloutIncompleteRootByUnsupportedSite = new Uint32Array(
      ROLLOUT_UNSUPPORTED_SITE.COUNT);
    this.rolloutFailureByAppliedActionPair = new Uint32Array(
      ACTION_COUNT * ACTION_COUNT);
    this.physicalIncompleteRootCount = 0;
    this.possibleAbsenceIncompleteRootCount = 0;
    this.possiblePresenceIncompleteRootCount = 0;
    this.lastIncompleteReason = ROLLOUT_INCOMPLETE_REASON.NONE;
    this.lastIncompletePhase = ROLLOUT_PHASE.PHYSICAL;
    this.lastIncompleteUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    this.supportSkipCount = 0; this.probabilityIncompleteCount = 0;
    this.rolloutIncompleteCount = 0; this.worldCount = 0;
    this.transitionCount = 0; this.rootRestoreFailureCount = 0;
    this.currentRiskAttackDominatesCount = 0;
    this.currentRiskStarDominatesCount = 0;
    this.currentRiskTradeoffCount = 0; this.currentRiskEqualCount = 0;
    this.currentRiskCombatPositiveCount = 0;
    this.currentRiskStarCostCount = 0;
    this.currentRiskSafetyRegressionCount = 0;
    this.rowEvaluationRequestCount = 0;
    this.qualificationCheckCount = 0; this.qualificationCompleteCount = 0;
    this.qualificationSafetyBlockedCount = 0;
    this.qualificationCombatBlockedCount = 0; this.qualificationCount = 0;
    this.lastEvaluationSerial = 0; this.lastAttackRow = -1;
    this.lastSelectedRow = -1; this.lastCurrentRiskIndex = -1;
    this.lastRelation = POLICY_RELATION.EQUAL;
    this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.NONE;
    this.replaySequenceAction = null; this.replaySequenceArgument = null;
    this.moveContestVariantEnvelope = options.moveContestVariantEnvelope ? 1 : 0;
    this.variantPolicies = null;
    this.variantEnvelopeRobust = new Int16Array(
      RISK_POINTS.length * POLICY_DIMENSION.COUNT);
    this.variantEnvelopeRelationByRisk = new Uint32Array(RISK_POINTS.length * 4);
    this.variantEnvelopeCompleteByVariant = new Uint32Array(
      MOVE_CONTEST_VARIANT.COUNT);
    this.variantEnvelopeIncompleteByVariant = new Uint32Array(
      MOVE_CONTEST_VARIANT.COUNT);
    this.variantEnvelopeStatusByVariant = new Uint32Array(
      MOVE_CONTEST_VARIANT.COUNT * (POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_CADENCE + 1));
    this.variantEnvelopeAttemptCount = 0; this.variantEnvelopeCompleteCount = 0;
    this.variantEnvelopeIncompleteCount = 0; this.variantEnvelopeRecoveredCount = 0;
    this.variantEnvelopeRelationAgreementCount = 0;
    this.variantEnvelopeRelationDisagreementCount = 0;
    this.variantEnvelopeReducedDimensionCount = 0;
    this.variantEnvelopeCommonSequenceReplayCount = 0;
    this.variantEnvelopeTransitionCount = 0;
    this.variantEnvelopeRootRestoreFailureCount = 0;
    this.variantEnvelopeLastCurrentRiskIndex = -1;
    this.variantEnvelopeLastRelation = POLICY_RELATION.EQUAL;
    if (this.moveContestVariantEnvelope) {
      const shared = { possibleProjectileWorlds: this.possibleProjectileWorlds };
      const sequential = new ResponseConditionedOptionPolicyShadow(null,
        horizon, { ...shared,
          moveContestVariant: MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK });
      const intent = new ResponseConditionedOptionPolicyShadow(null, horizon,
        { ...shared, moveContestVariant: MOVE_CONTEST_VARIANT.INTENT_BLOCK });
      const collision = new ResponseConditionedOptionPolicyShadow(null,
        horizon, { ...shared,
          moveContestVariant: MOVE_CONTEST_VARIANT.COLLISION_CRASH });
      intent.replaySequenceAction = sequential.commonSequenceAction;
      intent.replaySequenceArgument = sequential.commonSequenceArgument;
      collision.replaySequenceAction = sequential.commonSequenceAction;
      collision.replaySequenceArgument = sequential.commonSequenceArgument;
      this.variantPolicies = [sequential, intent, collision];
    }
    this.hotAllocationCount = 0;
  }

  delta(dimension) {
    const attack = 1; const star = 0; const r = this.rollout;
    if (dimension === POLICY_DIMENSION.NONLOSS)
      return clamp(((r.hardFatal[star] + r.ownCrashed[star]) -
        (r.hardFatal[attack] + r.ownCrashed[attack])) * 10000);
    if (dimension === POLICY_DIMENSION.TERMINAL)
      return (r.terminalUtility[attack] - r.terminalUtility[star]) * 5000;
    if (dimension === POLICY_DIMENSION.ENEMY_CRASH)
      return (r.enemyCrashed[attack] - r.enemyCrashed[star]) * 10000;
    if (dimension === POLICY_DIMENSION.PROJECTILE_THREAT)
      return (r.projectileThreat[attack] - r.projectileThreat[star]) * 2500;
    if (dimension === POLICY_DIMENSION.ENEMY_MOBILITY)
      return clamp((r.enemyMobility[star] - r.enemyMobility[attack]) * 1000);
    if (dimension === POLICY_DIMENSION.STAR_GAIN)
      return clamp((r.starGain[attack] - r.starGain[star]) * 10000);
    if (dimension === POLICY_DIMENSION.STAR_DISTANCE)
      return clamp((r.starDistance[star] - r.starDistance[attack]) * 1000);
    if (dimension === POLICY_DIMENSION.OWN_MOBILITY)
      return clamp((r.mobility[attack] - r.mobility[star]) * 1000);
    if (dimension === POLICY_DIMENSION.OWN_FIRE_LANE)
      return (r.ownFireLane[attack] - r.ownFireLane[star]) * 2500;
    if (dimension === POLICY_DIMENSION.ENEMY_FIRE_LANE)
      return (r.enemyFireLane[star] - r.enemyFireLane[attack]) * 2500;
    const attackResource = r.ownProjectileCount[attack] + r.ownBombCount[attack];
    const starResource = r.ownProjectileCount[star] + r.ownBombCount[star];
    return clamp((starResource - attackResource) * 1000);
  }

  relation(values, offset) {
    let positive = 0; let negative = 0;
    for (let dimension = 0; dimension < POLICY_DIMENSION.COUNT; dimension += 1) {
      const value = values[offset + dimension];
      if (value > 0) positive = 1;
      else if (value < 0) negative = 1;
    }
    return positive && negative ? POLICY_RELATION.TRADEOFF :
      positive ? POLICY_RELATION.ATTACK_DOMINATES :
        negative ? POLICY_RELATION.STAR_DOMINATES : POLICY_RELATION.EQUAL;
  }

  writeDelta(target, offset) {
    for (let dimension = 0; dimension < POLICY_DIMENSION.COUNT; dimension += 1)
      target[offset + dimension] = this.delta(dimension);
  }

  temporalDelta(dimension) {
    const attack = 1; const star = 0; const r = this.rollout;
    if (dimension === TEMPORAL_DIMENSION.PROJECTILE_THREAT_FRAMES)
      return clamp((r.projectileThreatFrames[attack] -
        r.projectileThreatFrames[star]) * 2500);
    if (dimension === TEMPORAL_DIMENSION.ENEMY_MOBILITY_FLOOR)
      return clamp((r.minimumEnemyMobility[star] -
        r.minimumEnemyMobility[attack]) * 1000);
    if (dimension === TEMPORAL_DIMENSION.ENEMY_MOBILITY_INTEGRAL)
      return clamp((r.enemyMobilityIntegral[star] -
        r.enemyMobilityIntegral[attack]) * 500);
    if (dimension === TEMPORAL_DIMENSION.OWN_FIRE_LANE_FRAMES)
      return clamp((r.ownFireLaneFrames[attack] -
        r.ownFireLaneFrames[star]) * 1000);
    return clamp((r.enemyFireLaneFrames[star] -
      r.enemyFireLaneFrames[attack]) * 1000);
  }

  writeTemporalDelta(target, offset) {
    for (let dimension = 0; dimension < TEMPORAL_DIMENSION.COUNT;
      dimension += 1) target[offset + dimension] =
        this.temporalDelta(dimension);
  }

  copySequence(row, offset) {
    const source = row * this.rollout.horizon;
    for (let step = 0; step < this.rollout.horizon; step += 1) {
      this.commonSequenceAction[offset + step] =
        this.rollout.sequenceAction[source + step];
      this.commonSequenceArgument[offset + step] =
        this.rollout.sequenceArgument[source + step];
    }
  }

  recordRolloutFailure(row, optionRole, enemyAction, phase) {
    let reason = this.rollout.incompleteReason[row];
    if (!reason || reason >= ROLLOUT_INCOMPLETE_REASON.COUNT)
      reason = ROLLOUT_INCOMPLETE_REASON.UNKNOWN;
    const step = this.rollout.incompleteStep[row];
    this.rolloutFailureByReason[reason] += 1;
    this.rolloutFailureByPhaseReason[
      phase * ROLLOUT_INCOMPLETE_REASON.COUNT + reason] += 1;
    this.rolloutFailureByOptionReason[
      optionRole * ROLLOUT_INCOMPLETE_REASON.COUNT + reason] += 1;
    if (step < this.rollout.horizon)
      this.rolloutFailureByStepReason[
        step * ROLLOUT_INCOMPLETE_REASON.COUNT + reason] += 1;
    if (enemyAction >= 0 && enemyAction < ACTION_COUNT)
      this.rolloutFailureByEnemyActionReason[
        enemyAction * ROLLOUT_INCOMPLETE_REASON.COUNT + reason] += 1;
    if (reason === ROLLOUT_INCOMPLETE_REASON.APPLY_UNSUPPORTED_RULE) {
      let site = this.rollout.incompleteUnsupportedSite[row];
      if (!site || site >= ROLLOUT_UNSUPPORTED_SITE.COUNT)
        site = ROLLOUT_UNSUPPORTED_SITE.UNKNOWN;
      this.rolloutFailureByUnsupportedSite[site] += 1;
      const ownAction = this.rollout.incompleteOwnAction[row];
      const appliedEnemyAction = this.rollout.incompleteEnemyAction[row];
      if (ownAction < ACTION_COUNT && appliedEnemyAction < ACTION_COUNT)
        this.rolloutFailureByAppliedActionPair[
          ownAction * ACTION_COUNT + appliedEnemyAction] += 1;
    }
    return reason;
  }

  recordIncompleteRoot(reason, phase,
      unsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE) {
    const normalized = reason > 0 && reason < ROLLOUT_INCOMPLETE_REASON.COUNT ?
      reason : ROLLOUT_INCOMPLETE_REASON.UNKNOWN;
    this.rolloutIncompleteRootByReason[normalized] += 1;
    if (normalized === ROLLOUT_INCOMPLETE_REASON.APPLY_UNSUPPORTED_RULE) {
      let site = unsupportedSite;
      if (!site || site >= ROLLOUT_UNSUPPORTED_SITE.COUNT)
        site = ROLLOUT_UNSUPPORTED_SITE.UNKNOWN;
      this.rolloutIncompleteRootByUnsupportedSite[site] += 1;
    }
    this.lastIncompleteReason = normalized; this.lastIncompletePhase = phase;
    this.lastIncompleteUnsupportedSite = unsupportedSite;
    if (phase === ROLLOUT_PHASE.PHYSICAL) this.physicalIncompleteRootCount += 1;
    else if (phase === ROLLOUT_PHASE.POSSIBLE_ABSENCE)
      this.possibleAbsenceIncompleteRootCount += 1;
    else this.possiblePresenceIncompleteRootCount += 1;
  }

  recordPossibleProjectile(tracker, count) {
    this.possibleProjectileCount[Math.min(8, count)] += 1;
    const pool = tracker && tracker.pool;
    if (pool && pool.complete) this.possibleProjectilePoolCompleteCount += 1;
    else this.possibleProjectilePoolIncompleteCount += 1;
    let enemy = 0; let other = 0; let slot = -1;
    if (pool) for (let index = 0; index < pool.active.length; index += 1)
      if (pool.active[index]) {
        slot = index;
        if (pool.owner[index] === 1) enemy += 1; else other += 1;
      }
    if (enemy === count && !other) this.possibleProjectileEnemyOnlyCount += 1;
    else this.possibleProjectileMixedOwnerCount += 1;
    return count === 1 && enemy === 1 && !other && pool && pool.complete ? slot : -1;
  }

  evaluatePhysicalColumns(engine, selected, attack) {
    let complete = 1; let firstReason = ROLLOUT_INCOMPLETE_REASON.NONE;
    let firstSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const enemyAction = engine.enemyActions[column];
      const enemyArgument = engine.enemyArguments[column];
      const sequenceBase = column * 2 * this.rollout.horizon;
      const starComplete = this.replaySequenceAction ?
        this.rollout.evaluatePolicySequence(engine.adapter.bundle,
          this.replaySequenceAction, this.replaySequenceArgument, sequenceBase,
          OPTION_KIND.POSITION, enemyAction, enemyArgument, 0) :
        this.rollout.evaluatePolicy(engine.adapter.bundle,
          engine.ourActions[selected], engine.ourArguments[selected],
          OPTION_KIND.POSITION, enemyAction, enemyArgument, 0);
      if (!this.replaySequenceAction) this.copySequence(0, sequenceBase);
      const attackComplete = this.replaySequenceAction ?
        this.rollout.evaluatePolicySequence(engine.adapter.bundle,
          this.replaySequenceAction, this.replaySequenceArgument,
          sequenceBase + this.rollout.horizon, OPTION_KIND.ATTACK,
          enemyAction, enemyArgument, 1) :
        this.rollout.evaluatePolicy(engine.adapter.bundle,
          engine.ourActions[attack], engine.ourArguments[attack],
          OPTION_KIND.ATTACK, enemyAction, enemyArgument, 1);
      if (!this.replaySequenceAction)
        this.copySequence(1, sequenceBase + this.rollout.horizon);
      if (!starComplete) {
        const reason = this.recordRolloutFailure(0, ROLLOUT_OPTION_ROLE.STAR,
          enemyAction, ROLLOUT_PHASE.PHYSICAL);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[0]; } complete = 0;
      }
      if (!attackComplete) {
        const reason = this.recordRolloutFailure(1, ROLLOUT_OPTION_ROLE.ATTACK,
          enemyAction, ROLLOUT_PHASE.PHYSICAL);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[1]; } complete = 0;
      }
      this.writeDelta(this.worldDelta, column * POLICY_DIMENSION.COUNT);
      this.writeTemporalDelta(this.temporalWorldDelta,
        column * TEMPORAL_DIMENSION.COUNT);
    }
    if (!complete)
      this.recordIncompleteRoot(firstReason, ROLLOUT_PHASE.PHYSICAL, firstSite);
    return complete;
  }

  evaluatePossibleColumns(engine, selected, attack, slot) {
    const bundle = engine.adapter.bundle; const state = bundle && bundle.state;
    const kernel = bundle && bundle.kernel; const tracker = engine.possibleProjectiles;
    const pool = tracker && tracker.pool;
    if (!state || !kernel || !pool || slot < 0) return 0;
    let complete = 1; let firstReason = ROLLOUT_INCOMPLETE_REASON.NONE;
    let firstSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const enemyAction = engine.enemyActions[column];
      const enemyArgument = engine.enemyArguments[column];
      const sequenceBase = column * 2 * this.rollout.horizon;
      const starComplete = this.replaySequenceAction ?
        this.rollout.evaluatePolicySequence(bundle, this.replaySequenceAction,
          this.replaySequenceArgument, sequenceBase, OPTION_KIND.POSITION,
          enemyAction, enemyArgument, 0) :
        this.rollout.evaluatePolicy(bundle,
          engine.ourActions[selected], engine.ourArguments[selected],
          OPTION_KIND.POSITION, enemyAction, enemyArgument, 0);
      this.copySequence(0, sequenceBase);
      const attackComplete = this.replaySequenceAction ?
        this.rollout.evaluatePolicySequence(bundle, this.replaySequenceAction,
          this.replaySequenceArgument, sequenceBase + this.rollout.horizon,
          OPTION_KIND.ATTACK, enemyAction, enemyArgument, 1) :
        this.rollout.evaluatePolicy(bundle,
          engine.ourActions[attack], engine.ourArguments[attack],
          OPTION_KIND.ATTACK, enemyAction, enemyArgument, 1);
      this.copySequence(1, sequenceBase + this.rollout.horizon);
      if (!starComplete) {
        const reason = this.recordRolloutFailure(0, ROLLOUT_OPTION_ROLE.STAR,
          enemyAction, ROLLOUT_PHASE.POSSIBLE_ABSENCE);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[0]; } complete = 0;
      }
      if (!attackComplete) {
        const reason = this.recordRolloutFailure(1, ROLLOUT_OPTION_ROLE.ATTACK,
          enemyAction, ROLLOUT_PHASE.POSSIBLE_ABSENCE);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[1]; } complete = 0;
      }
      this.writeDelta(this.absenceWorldDelta,
        column * POLICY_DIMENSION.COUNT);
      this.writeTemporalDelta(this.temporalAbsenceWorldDelta,
        column * TEMPORAL_DIMENSION.COUNT);
    }
    if (!complete) {
      this.recordIncompleteRoot(firstReason, ROLLOUT_PHASE.POSSIBLE_ABSENCE,
        firstSite);
      return 0;
    }

    const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootDelta = state.deltaUsed; const rootEvent = state.eventUsed;
    const rootMark = rootDelta * 1024 + rootEvent;
    const savedDeltaBase = state.transitionDeltaBase;
    const savedEventBase = state.transitionEventBase;
    const savedKernelFailure = kernel.failure; const savedKernelMark = kernel.lastMark;
    const mark = state.beginTransition(); kernel.failure = 0;
    let injected = 1;
    if (engine.adapter.enemyCapabilityReason ===
        ENEMY_CAPABILITY_CADENCE_MISMATCH) {
      const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const until = a[ARRAY.TANK_POISON_UNTIL][1];
      const applied = a[ARRAY.TANK_POISON_APPLIED][1];
      const phaseAnchor = frame - (engine.adapter.enemyCanAct ? 0 : 1);
      if (until === NONE_FRAME || until <= frame || applied === NONE_FRAME ||
          phaseAnchor < 0 || !kernel.set(ARRAY.TANK_POISON_APPLIED, 1, phaseAnchor)) {
        injected = 0; this.lastEvaluationStatus =
          POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_CADENCE;
      } else this.possibleWorldCadenceRephaseCount += 1;
    }
    const group = pool.group[slot] || pool.id[slot];
    if (injected && !kernel.allocateProjectile(pool.owner[slot], pool.cell[slot],
        pool.direction[slot], group, pool.member[slot])) {
      injected = 0; this.possibleWorldInjectionFailureCount += 1;
    }
    let presentComplete = 1; firstReason = ROLLOUT_INCOMPLETE_REASON.NONE;
    firstSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    if (injected) for (let column = 0; column < engine.enemyCount; column += 1) {
      const enemyAction = engine.enemyActions[column];
      const enemyArgument = engine.enemyArguments[column];
      const sequenceBase = column * 2 * this.rollout.horizon;
      const starComplete = this.rollout.evaluatePolicySequence(bundle,
        this.commonSequenceAction, this.commonSequenceArgument, sequenceBase,
        OPTION_KIND.POSITION, enemyAction, enemyArgument, 0);
      const attackComplete = this.rollout.evaluatePolicySequence(bundle,
        this.commonSequenceAction, this.commonSequenceArgument,
        sequenceBase + this.rollout.horizon, OPTION_KIND.ATTACK,
        enemyAction, enemyArgument, 1);
      if (!starComplete) {
        const reason = this.recordRolloutFailure(0, ROLLOUT_OPTION_ROLE.STAR,
          enemyAction, ROLLOUT_PHASE.POSSIBLE_PRESENCE);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[0]; }
        presentComplete = 0;
      }
      if (!attackComplete) {
        const reason = this.recordRolloutFailure(1, ROLLOUT_OPTION_ROLE.ATTACK,
          enemyAction, ROLLOUT_PHASE.POSSIBLE_PRESENCE);
        if (!firstReason) { firstReason = reason;
          firstSite = this.rollout.incompleteUnsupportedSite[1]; }
        presentComplete = 0;
      }
      const offset = column * POLICY_DIMENSION.COUNT;
      this.writeDelta(this.presentWorldDelta, offset);
      for (let dimension = 0; dimension < POLICY_DIMENSION.COUNT; dimension += 1) {
        const absent = this.absenceWorldDelta[offset + dimension];
        const present = this.presentWorldDelta[offset + dimension];
        if (present < absent) this.possibleWorldReducedDimensionCount += 1;
        this.worldDelta[offset + dimension] = Math.min(absent, present);
      }
      const temporalOffset = column * TEMPORAL_DIMENSION.COUNT;
      this.writeTemporalDelta(this.temporalPresentWorldDelta, temporalOffset);
      for (let dimension = 0; dimension < TEMPORAL_DIMENSION.COUNT;
        dimension += 1)
        this.temporalWorldDelta[temporalOffset + dimension] = Math.min(
          this.temporalAbsenceWorldDelta[temporalOffset + dimension],
          this.temporalPresentWorldDelta[temporalOffset + dimension]);
      this.possibleWorldCommonSequenceCount += 2;
    }
    state.undoTo(mark);
    state.transitionDeltaBase = savedDeltaBase;
    state.transitionEventBase = savedEventBase;
    kernel.failure = savedKernelFailure; kernel.lastMark = savedKernelMark;
    const restored = state.hashLo === rootLo && state.hashHi === rootHi &&
      state.deltaUsed === rootDelta && state.eventUsed === rootEvent;
    if (!restored) {
      state.undoTo(rootMark); state.transitionDeltaBase = savedDeltaBase;
      state.transitionEventBase = savedEventBase;
      this.possibleWorldRootRestoreFailureCount += 1;
      this.rootRestoreFailureCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_RESTORE;
    }
    if (injected && !presentComplete)
      this.recordIncompleteRoot(firstReason, ROLLOUT_PHASE.POSSIBLE_PRESENCE,
        firstSite);
    return injected && presentComplete && restored ? 1 : 0;
  }

  evaluateMoveContestEnvelope(engine, selected, attack) {
    if (!this.variantPolicies) return 0;
    this.variantEnvelopeAttemptCount += 1;
    let complete = 1; let transitions = 0; let restores = 0;
    for (let index = 0; index < this.variantPolicies.length; index += 1) {
      const policy = this.variantPolicies[index];
      const beforeTransitions = policy.transitionCount;
      const beforeRestores = policy.rootRestoreFailureCount;
      const supported = policy.evaluateRows(engine, selected, attack);
      transitions += policy.transitionCount - beforeTransitions;
      restores += policy.rootRestoreFailureCount - beforeRestores;
      const variant = policy.moveContestVariant;
      const status = policy.lastEvaluationStatus;
      if (status >= 0 && status <=
          POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_CADENCE)
        this.variantEnvelopeStatusByVariant[variant *
          (POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_CADENCE + 1) + status] += 1;
      if (supported) this.variantEnvelopeCompleteByVariant[variant] += 1;
      else {
        this.variantEnvelopeIncompleteByVariant[variant] += 1; complete = 0;
      }
    }
    this.variantEnvelopeTransitionCount += transitions;
    this.variantEnvelopeRootRestoreFailureCount += restores;
    if (!complete) { this.variantEnvelopeIncompleteCount += 1; return 0; }
    this.variantEnvelopeCompleteCount += 1;
    this.variantEnvelopeRecoveredCount += 1;
    // Sequential generated both option sequences. Intent and collision replay
    // those exact own commands; only their physical RuleVariant differs.
    this.variantEnvelopeCommonSequenceReplayCount +=
      engine.enemyCount * 2 * 2;
    const first = this.variantPolicies[0];
    for (let offset = 0; offset < this.variantEnvelopeRobust.length;
      offset += 1) {
      let minimum = first.robust[offset]; let maximum = minimum;
      for (let index = 1; index < this.variantPolicies.length; index += 1) {
        const value = this.variantPolicies[index].robust[offset];
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
      this.variantEnvelopeRobust[offset] = minimum;
      if (minimum < maximum) this.variantEnvelopeReducedDimensionCount += 1;
    }
    let relationsAgree = 1;
    for (let risk = 0; risk < RISK_POINTS.length; risk += 1) {
      const offset = risk * POLICY_DIMENSION.COUNT;
      const relation = this.relation(this.variantEnvelopeRobust, offset);
      this.variantEnvelopeRelationByRisk[risk * 4 + relation] += 1;
      const reference = this.variantPolicies[0].relation(
        this.variantPolicies[0].robust, offset);
      for (let index = 1; index < this.variantPolicies.length; index += 1)
        if (this.variantPolicies[index].relation(
          this.variantPolicies[index].robust, offset) !== reference)
          relationsAgree = 0;
    }
    if (relationsAgree) this.variantEnvelopeRelationAgreementCount += 1;
    else this.variantEnvelopeRelationDisagreementCount += 1;
    this.variantEnvelopeLastCurrentRiskIndex = first.lastCurrentRiskIndex;
    const current = this.variantEnvelopeLastCurrentRiskIndex < 0 ? 3 :
      this.variantEnvelopeLastCurrentRiskIndex;
    this.variantEnvelopeLastRelation = this.relation(
      this.variantEnvelopeRobust, current * POLICY_DIMENSION.COUNT);
    return 1;
  }

  evaluateRows(engine, selected, attack) {
    this.rowEvaluationRequestCount += 1;
    this.lastAttackRow = attack; this.lastSelectedRow = selected;
    this.lastCurrentRiskIndex = -1;
    this.lastRelation = POLICY_RELATION.EQUAL;
    this.lastIncompleteReason = ROLLOUT_INCOMPLETE_REASON.NONE;
    this.lastIncompletePhase = ROLLOUT_PHASE.PHYSICAL;
    this.lastIncompleteUnsupportedSite = ROLLOUT_UNSUPPORTED_SITE.NONE;
    this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.NONE;
    if (!engine.adapter.enemyVisible) {
      this.hiddenSkipCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.HIDDEN; return 0;
    }
    if (!engine.adapter.tracker || !engine.adapter.tracker.complete) {
      this.trackingSkipCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.TRACKING_INCOMPLETE;
      return 0;
    }
    let possibleWorld = 0; let possibleSlot = -1;
    if (engine.possibleProjectiles && engine.possibleProjectiles.count() > 0) {
      const tracker = engine.possibleProjectiles; const count = tracker.count();
      possibleSlot = this.recordPossibleProjectile(tracker, count);
      const capabilityComplete = engine.adapter.enemyCapabilitySupportComplete ||
        engine.adapter.enemyCapabilityReason ===
          ENEMY_CAPABILITY_CADENCE_MISMATCH;
      if (!this.possibleProjectileWorlds || possibleSlot < 0 || !capabilityComplete) {
        this.possibleProjectileSkipCount += 1;
        if (this.possibleProjectileWorlds) this.possibleWorldUnsupportedCount += 1;
        this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.POSSIBLE_PROJECTILE;
        return 0;
      }
      possibleWorld = 1; this.possibleWorldAttemptCount += 1;
    }
    if (!engine.hiddenSupportComplete || engine.hiddenWorldCount !== 1 ||
        engine.hiddenWorldMass[0] !== PROBABILITY_SCALE || engine.enemyCount < 1 ||
        engine.enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) {
      this.supportSkipCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.SUPPORT_INCOMPLETE;
      return 0;
    }
    if (attack < 0 || selected < 0 || attack >= engine.ourCount ||
        selected >= engine.ourCount || attack === selected) {
      this.supportSkipCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.INVALID_ROW; return 0;
    }
    for (let column = 0; column < engine.enemyCount; column += 1)
      engine.enemyActionFamilies[column] = engine.actionFamilyForShadow(
        engine.enemyActions[column]);
    const probabilityCount = engine.policy.opponent.buildNominalPolicy(
      engine.enemyActionFamilies, engine.enemyCount, engine.opponentContext(),
      this.enemyProbability);
    if (probabilityCount !== engine.enemyCount) {
      this.probabilityIncompleteCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.PROBABILITY_INCOMPLETE;
      return 0;
    }
    let probabilitySum = 0;
    for (let column = 0; column < engine.enemyCount; column += 1)
      probabilitySum += this.enemyProbability[column];
    if (probabilitySum !== PROBABILITY_SCALE) {
      this.probabilityIncompleteCount += 1;
      this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.PROBABILITY_INCOMPLETE;
      return 0;
    }
    const beforeTransitions = this.rollout.transitionCount;
    const beforeRestores = this.rollout.rootRestoreFailureCount;
    const complete = possibleWorld ?
      this.evaluatePossibleColumns(engine, selected, attack, possibleSlot) :
      this.evaluatePhysicalColumns(engine, selected, attack);
    this.transitionCount += this.rollout.transitionCount - beforeTransitions;
    this.rootRestoreFailureCount +=
      this.rollout.rootRestoreFailureCount - beforeRestores;
    if (!complete) {
      this.rolloutIncompleteCount += 1;
      if (possibleWorld) {
        this.possibleWorldIncompleteCount += 1;
        if (this.lastEvaluationStatus !==
            POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_RESTORE &&
            this.lastEvaluationStatus !==
              POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_CADENCE)
          this.lastEvaluationStatus =
            POLICY_EVALUATION_STATUS.POSSIBLE_WORLD_INCOMPLETE;
      } else this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.ROLLOUT_INCOMPLETE;
      if (this.lastIncompleteReason ===
          ROLLOUT_INCOMPLETE_REASON.APPLY_UNSUPPORTED_RULE &&
          this.lastIncompleteUnsupportedSite ===
            ROLLOUT_UNSUPPORTED_SITE.MOVE_CONTEST)
        this.evaluateMoveContestEnvelope(engine, selected, attack);
      return 0;
    }
    if (possibleWorld) this.possibleWorldCompleteCount += 1;
    this.evaluationCount += 1;
    this.worldCount += engine.enemyCount * (possibleWorld ? 2 : 1);
    for (let dimension = 0; dimension < POLICY_DIMENSION.COUNT; dimension += 1) {
      let sum = 0; let worst = 10000;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        const value = this.worldDelta[column * POLICY_DIMENSION.COUNT + dimension];
        sum += this.enemyProbability[column] * value;
        if (value < worst) worst = value;
      }
      this.expected[dimension] = Math.floor(sum / PROBABILITY_SCALE);
      this.worst[dimension] = worst;
    }
    for (let dimension = 0; dimension < TEMPORAL_DIMENSION.COUNT;
      dimension += 1) {
      let sum = 0; let worst = 10000;
      for (let column = 0; column < engine.enemyCount; column += 1) {
        const value = this.temporalWorldDelta[
          column * TEMPORAL_DIMENSION.COUNT + dimension];
        sum += this.enemyProbability[column] * value;
        if (value < worst) worst = value;
      }
      this.temporalExpected[dimension] = Math.floor(sum / PROBABILITY_SCALE);
      this.temporalWorst[dimension] = worst;
    }
    const baseRisk = engine.policy.baseRisk | 0;
    let currentIndex = -1;
    for (let index = 0; index < RISK_POINTS.length; index += 1) {
      const riskPoint = RISK_POINTS[index];
      const lambda = engine.riskController.riskProfile.lambda(riskPoint,
        engine.riskController.stateRiskClass, RISK_DIMENSION.ENEMY_ACTION);
      const offset = index * POLICY_DIMENSION.COUNT;
      for (let dimension = 0; dimension < POLICY_DIMENSION.COUNT; dimension += 1)
        this.robust[offset + dimension] = contaminatedLower(lambda,
          this.expected[dimension], this.worst[dimension]);
      const temporalOffset = index * TEMPORAL_DIMENSION.COUNT;
      for (let dimension = 0; dimension < TEMPORAL_DIMENSION.COUNT;
        dimension += 1)
        this.temporalRobust[temporalOffset + dimension] = contaminatedLower(
          lambda, this.temporalExpected[dimension], this.temporalWorst[dimension]);
      const relation = this.relation(this.robust, offset);
      this.relationByRisk[index * 4 + relation] += 1;
      if (riskPoint === baseRisk) currentIndex = index;
    }
    if (currentIndex < 0) currentIndex = 3;
    this.lastCurrentRiskIndex = currentIndex;
    const offset = currentIndex * POLICY_DIMENSION.COUNT;
    const relation = this.relation(this.robust, offset); this.lastRelation = relation;
    if (relation === POLICY_RELATION.ATTACK_DOMINATES)
      this.currentRiskAttackDominatesCount += 1;
    else if (relation === POLICY_RELATION.STAR_DOMINATES)
      this.currentRiskStarDominatesCount += 1;
    else if (relation === POLICY_RELATION.TRADEOFF)
      this.currentRiskTradeoffCount += 1;
    else this.currentRiskEqualCount += 1;
    if (this.robust[offset + POLICY_DIMENSION.ENEMY_CRASH] > 0 ||
        this.robust[offset + POLICY_DIMENSION.PROJECTILE_THREAT] > 0 ||
        this.robust[offset + POLICY_DIMENSION.ENEMY_MOBILITY] > 0 ||
        this.robust[offset + POLICY_DIMENSION.OWN_FIRE_LANE] > 0)
      this.currentRiskCombatPositiveCount += 1;
    if (this.robust[offset + POLICY_DIMENSION.STAR_GAIN] < 0 ||
        this.robust[offset + POLICY_DIMENSION.STAR_DISTANCE] < 0)
      this.currentRiskStarCostCount += 1;
    if (this.robust[offset + POLICY_DIMENSION.NONLOSS] < 0 ||
        this.robust[offset + POLICY_DIMENSION.TERMINAL] < 0)
      this.currentRiskSafetyRegressionCount += 1;
    this.lastEvaluationStatus = POLICY_EVALUATION_STATUS.COMPLETE;
    return 1;
  }

  observe(engine) {
    this.observationCount += 1;
    const interval = this.interval;
    if (!interval || interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateSkipCount += 1; return 0;
    }
    this.lastEvaluationSerial = interval.evaluationSerial;
    return this.evaluateRows(engine, interval.lastSelectedRow,
      interval.lastAttackRow);
  }

  qualifiesCurrentRisk() {
    this.qualificationCheckCount += 1;
    if (this.lastEvaluationStatus !== POLICY_EVALUATION_STATUS.COMPLETE ||
        this.lastCurrentRiskIndex < 0) return 0;
    this.qualificationCompleteCount += 1;
    const offset = this.lastCurrentRiskIndex * POLICY_DIMENSION.COUNT;
    if (this.robust[offset + POLICY_DIMENSION.NONLOSS] < 0 ||
        this.robust[offset + POLICY_DIMENSION.TERMINAL] < 0 ||
        this.robust[offset + POLICY_DIMENSION.ENEMY_CRASH] < 0) {
      this.qualificationSafetyBlockedCount += 1; return 0;
    }
    if (this.robust[offset + POLICY_DIMENSION.ENEMY_CRASH] <= 0 &&
        this.robust[offset + POLICY_DIMENSION.PROJECTILE_THREAT] <= 0 &&
        this.robust[offset + POLICY_DIMENSION.ENEMY_MOBILITY] <= 0 &&
        this.robust[offset + POLICY_DIMENSION.OWN_MOBILITY] <= 0 &&
        this.robust[offset + POLICY_DIMENSION.OWN_FIRE_LANE] <= 0 &&
        this.robust[offset + POLICY_DIMENSION.ENEMY_FIRE_LANE] <= 0) {
      this.qualificationCombatBlockedCount += 1; return 0;
    }
    this.qualificationCount += 1; return 1;
  }

  // Cold capture only.  The evaluator itself remains fixed-array and this is
  // called only for the bounded diagnostic root sample.
  sample() {
    const complete = this.lastEvaluationStatus ===
      POLICY_EVALUATION_STATUS.COMPLETE;
    return { schemaVersion: 1, complete,
      status: this.lastEvaluationStatus,
      selectedRow: this.lastSelectedRow, attackRow: this.lastAttackRow,
      currentRiskIndex: this.lastCurrentRiskIndex,
      relation: this.lastRelation,
      incompleteReason: this.lastIncompleteReason,
      incompletePhase: this.lastIncompletePhase,
      expected: complete ? Array.from(this.expected) : null,
      worst: complete ? Array.from(this.worst) : null,
      robust: complete ? Array.from(this.robust) : null };
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, actionOwnership: false,
      responseConditioned: true, horizon: this.rollout.horizon,
      possibleProjectileWorlds: Boolean(this.possibleProjectileWorlds),
      commonOwnPolicyAcrossPossibleWorlds: true,
      riskPoints: Array.from(RISK_POINTS), dimensionCount: POLICY_DIMENSION.COUNT,
      temporalDimensionCount: TEMPORAL_DIMENSION.COUNT,
      observationCount: this.observationCount,
      rowEvaluationRequestCount: this.rowEvaluationRequestCount,
      qualificationCheckCount: this.qualificationCheckCount,
      qualificationCompleteCount: this.qualificationCompleteCount,
      qualificationSafetyBlockedCount: this.qualificationSafetyBlockedCount,
      qualificationCombatBlockedCount: this.qualificationCombatBlockedCount,
      qualificationCount: this.qualificationCount,
      evaluationCount: this.evaluationCount,
      duplicateSkipCount: this.duplicateSkipCount,
      hiddenSkipCount: this.hiddenSkipCount,
      trackingSkipCount: this.trackingSkipCount,
      possibleProjectileSkipCount: this.possibleProjectileSkipCount,
      possibleProjectileCount: Array.from(this.possibleProjectileCount),
      possibleProjectilePoolCompleteCount: this.possibleProjectilePoolCompleteCount,
      possibleProjectilePoolIncompleteCount: this.possibleProjectilePoolIncompleteCount,
      possibleProjectileEnemyOnlyCount: this.possibleProjectileEnemyOnlyCount,
      possibleProjectileMixedOwnerCount: this.possibleProjectileMixedOwnerCount,
      possibleWorldAttemptCount: this.possibleWorldAttemptCount,
      possibleWorldCompleteCount: this.possibleWorldCompleteCount,
      possibleWorldIncompleteCount: this.possibleWorldIncompleteCount,
      possibleWorldUnsupportedCount: this.possibleWorldUnsupportedCount,
      possibleWorldInjectionFailureCount: this.possibleWorldInjectionFailureCount,
      possibleWorldRootRestoreFailureCount:
        this.possibleWorldRootRestoreFailureCount,
      possibleWorldCadenceRephaseCount: this.possibleWorldCadenceRephaseCount,
      possibleWorldCommonSequenceCount: this.possibleWorldCommonSequenceCount,
      possibleWorldReducedDimensionCount: this.possibleWorldReducedDimensionCount,
      physicalIncompleteRootCount: this.physicalIncompleteRootCount,
      possibleAbsenceIncompleteRootCount: this.possibleAbsenceIncompleteRootCount,
      possiblePresenceIncompleteRootCount: this.possiblePresenceIncompleteRootCount,
      rolloutIncompleteReasonCount: ROLLOUT_INCOMPLETE_REASON.COUNT,
      rolloutFailureByReason: Array.from(this.rolloutFailureByReason),
      rolloutFailureByPhaseReason: Array.from(this.rolloutFailureByPhaseReason),
      rolloutFailureByOptionReason: Array.from(this.rolloutFailureByOptionReason),
      rolloutFailureByStepReason: Array.from(this.rolloutFailureByStepReason),
      rolloutFailureByEnemyActionReason:
        Array.from(this.rolloutFailureByEnemyActionReason),
      rolloutIncompleteRootByReason:
        Array.from(this.rolloutIncompleteRootByReason),
      rolloutUnsupportedSiteCount: ROLLOUT_UNSUPPORTED_SITE.COUNT,
      rolloutFailureByUnsupportedSite:
        Array.from(this.rolloutFailureByUnsupportedSite),
      rolloutIncompleteRootByUnsupportedSite:
        Array.from(this.rolloutIncompleteRootByUnsupportedSite),
      rolloutFailureByAppliedActionPair:
        Array.from(this.rolloutFailureByAppliedActionPair),
      diagnosticFailureStackAllocationCount:
        this.rollout.diagnosticFailureStackAllocationCount,
      supportSkipCount: this.supportSkipCount,
      probabilityIncompleteCount: this.probabilityIncompleteCount,
      rolloutIncompleteCount: this.rolloutIncompleteCount,
      worldCount: this.worldCount, transitionCount: this.transitionCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      currentRiskAttackDominatesCount: this.currentRiskAttackDominatesCount,
      currentRiskStarDominatesCount: this.currentRiskStarDominatesCount,
      currentRiskTradeoffCount: this.currentRiskTradeoffCount,
      currentRiskEqualCount: this.currentRiskEqualCount,
      currentRiskCombatPositiveCount: this.currentRiskCombatPositiveCount,
      currentRiskStarCostCount: this.currentRiskStarCostCount,
      currentRiskSafetyRegressionCount: this.currentRiskSafetyRegressionCount,
      relationByRisk: Array.from(this.relationByRisk),
      lastEvaluationSerial: this.lastEvaluationSerial,
      lastAttackRow: this.lastAttackRow, lastSelectedRow: this.lastSelectedRow,
      lastCurrentRiskIndex: this.lastCurrentRiskIndex,
      lastRelation: this.lastRelation,
      lastEvaluationStatus: this.lastEvaluationStatus,
      lastIncompleteReason: this.lastIncompleteReason,
      lastIncompletePhase: this.lastIncompletePhase,
      lastIncompleteUnsupportedSite: this.lastIncompleteUnsupportedSite,
      moveContestVariantEnvelope: {
        enabled: Boolean(this.moveContestVariantEnvelope),
        diagnosticOnly: true, actionOwnership: false,
        commonOwnPolicyAcrossVariants: true,
        variants: [MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK,
          MOVE_CONTEST_VARIANT.INTENT_BLOCK,
          MOVE_CONTEST_VARIANT.COLLISION_CRASH],
        attemptCount: this.variantEnvelopeAttemptCount,
        completeCount: this.variantEnvelopeCompleteCount,
        incompleteCount: this.variantEnvelopeIncompleteCount,
        recoveredCount: this.variantEnvelopeRecoveredCount,
        completeByVariant: Array.from(this.variantEnvelopeCompleteByVariant),
        incompleteByVariant: Array.from(this.variantEnvelopeIncompleteByVariant),
        statusByVariant: Array.from(this.variantEnvelopeStatusByVariant),
        relationAgreementCount: this.variantEnvelopeRelationAgreementCount,
        relationDisagreementCount:
          this.variantEnvelopeRelationDisagreementCount,
        reducedDimensionCount: this.variantEnvelopeReducedDimensionCount,
        commonSequenceReplayCount:
          this.variantEnvelopeCommonSequenceReplayCount,
        transitionCount: this.variantEnvelopeTransitionCount,
        rootRestoreFailureCount:
          this.variantEnvelopeRootRestoreFailureCount,
        relationByRisk: Array.from(this.variantEnvelopeRelationByRisk),
        lastCurrentRiskIndex: this.variantEnvelopeLastCurrentRiskIndex,
        lastRelation: this.variantEnvelopeLastRelation,
        lastRobust: Array.from(this.variantEnvelopeRobust)
      },
      lastExpected: Array.from(this.expected),
      lastWorst: Array.from(this.worst),
      lastRobust: Array.from(this.robust),
      lastTemporalExpected: Array.from(this.temporalExpected),
      lastTemporalWorst: Array.from(this.temporalWorst),
      lastTemporalRobust: Array.from(this.temporalRobust),
      hotAllocationCount: this.hotAllocationCount + this.rollout.hotAllocationCount };
  }
}

module.exports = { RISK_POINTS, POLICY_DIMENSION, TEMPORAL_DIMENSION,
  POLICY_RELATION,
  POLICY_EVALUATION_STATUS, ROLLOUT_PHASE, ROLLOUT_OPTION_ROLE,
  ROLLOUT_UNSUPPORTED_SITE,
  ResponseConditionedOptionPolicyShadow };
