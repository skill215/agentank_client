"use strict";

// Diagnostic pre-final proposal.  Unlike the post-decision census, this runs
// inside selectFinalAction and therefore proves that the same evidence exists
// before ACTION_EMIT.  It is deliberately restricted to calibrated FIRE over
// STAR_CONTROL conflicts and remains optional/behavior-neutral by default.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require(
  "../../../engine-v2/src/runtime/escape-obligation");
const { GLOBAL_MODE } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { POLICY_DIMENSION, TEMPORAL_DIMENSION, POLICY_RELATION,
  POLICY_EVALUATION_STATUS,
  ResponseConditionedOptionPolicyShadow } = require(
  "./response-conditioned-option-policy-shadow");
const { SCORE_BAND } = require("./strategic-state-ledger-shadow");
const { OPTION_EVENT } = require("./event-driven-option-shadow");

const DURABLE_COMBAT_DIMENSIONS = Object.freeze([
  POLICY_DIMENSION.ENEMY_CRASH,
  POLICY_DIMENSION.PROJECTILE_THREAT,
  POLICY_DIMENSION.ENEMY_MOBILITY,
  POLICY_DIMENSION.OWN_MOBILITY,
  POLICY_DIMENSION.OWN_FIRE_LANE,
  POLICY_DIMENSION.ENEMY_FIRE_LANE
]);
const DURABLE_COMBAT_SIGN_PATTERN_COUNT = 729; // 3^6
const COMBAT_PHYSICAL_SIGNAL = Object.freeze({
  DIRECT_KILL: 1,
  DOOMED_FIRST_ACTION: 2,
  ENDPOINT_REDUCTION: 4,
  MOBILITY_LOSS: 8,
  COUNTERFIRE_DELAY: 16,
  POSSIBLE_HIT: 32,
  AIM_OR_INTERCEPT: 64,
  OTHER_PURPOSE: 128
});

class StrategicAttackOverStarProposal {
  constructor(options = {}) {
    this.active = options.active ? 1 : 0;
    this.response = options.responsePolicy ||
      new ResponseConditionedOptionPolicyShadow(null, 4, {
        possibleProjectileWorlds: options.possibleProjectileWorlds,
        moveContestVariantEnvelope: options.moveContestVariantEnvelope
      });
    this.checkCount = 0; this.conflictCount = 0; this.triggerCount = 0;
    this.steadySkipCount = 0; this.responseIncompleteCount = 0;
    this.safetyBlockedCount = 0; this.deadlineBlockedCount = 0;
    this.combatBlockedCount = 0; this.scoreBlockedCount = 0;
    this.proposalCount = 0; this.overrideCount = 0; this.finalRejectCount = 0;
    this.rootRestoreFailureCount = 0; this.hotAllocationCount = 0;
    this.proposalByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.combatBlockRelation = new Uint32Array(4);
    this.combatBlockByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.combatBlockPositiveDimensionCount = new Uint32Array(
      DURABLE_COMBAT_DIMENSIONS.length + 1);
    this.combatBlockRobustSignCount = new Uint32Array(
      DURABLE_COMBAT_DIMENSIONS.length * 3);
    this.combatBlockRobustSignPattern = new Uint32Array(
      DURABLE_COMBAT_SIGN_PATTERN_COUNT);
    this.combatBlockRobustSum = new Int32Array(
      DURABLE_COMBAT_DIMENSIONS.length);
    this.combatBlockPhysicalSignalMask = new Uint32Array(256);
    this.combatBlockStarCostMask = new Uint32Array(4);
    this.combatBlockTemporalPositiveDimensionCount = new Uint32Array(
      TEMPORAL_DIMENSION.COUNT + 1);
    this.combatBlockTemporalRobustSignCount = new Uint32Array(
      TEMPORAL_DIMENSION.COUNT * 3);
    this.combatBlockTemporalRobustSignPattern = new Uint32Array(243); // 3^5
    this.combatBlockTemporalRobustSum = new Int32Array(
      TEMPORAL_DIMENSION.COUNT);
    this.combatBlockNoPositiveDimensionCount = 0;
    this.combatBlockPhysicalSignalWithoutValueCount = 0;
    this.combatBlockTemporalRecoveryCount = 0;
    this.previousFrame = -1; this.initialized = 0; this.previousConflict = 0;
    this.previousStar = NONE_CELL; this.previousOwnStars = 0;
    this.previousEnemyStars = 0; this.previousVisible = 0;
    this.previousControlMode = 0; this.previousResourceReady = 0;
    this.previousCommittedState = 0; this.previousTerminalEffect = 0;
    this.lastProposal = -1; this.lastSelected = -1; this.lastEventMask = 0;
    this.lastScoreBand = SCORE_BAND.TIED; this.lastAttackDeadline = 255;
    this.lastStarDeadline = 255; this.lastSafety = 0;
    this.lastDurableCombat = 0; this.lastStarPreserved = 0;
  }

  combatValue(vector, field, row) {
    const values = vector[field]; return values ? values[row] : 0;
  }

  recordCombatBlock(engine, attack, robust, offset, relation, score) {
    let pattern = 0; let scale = 1; let positive = 0;
    for (let index = 0; index < DURABLE_COMBAT_DIMENSIONS.length;
      index += 1) {
      const value = robust[offset + DURABLE_COMBAT_DIMENSIONS[index]];
      const sign = value < 0 ? 0 : value > 0 ? 2 : 1;
      pattern += sign * scale; scale *= 3;
      this.combatBlockRobustSignCount[index * 3 + sign] += 1;
      this.combatBlockRobustSum[index] += value;
      if (value > 0) positive += 1;
    }
    this.combatBlockRobustSignPattern[pattern] += 1;
    this.combatBlockPositiveDimensionCount[positive] += 1;
    this.combatBlockRelation[relation] += 1;
    this.combatBlockByScore[score] += 1;
    if (!positive) this.combatBlockNoPositiveDimensionCount += 1;
    let signal = 0; const vector = engine.combat.vector;
    if (this.combatValue(vector, "directKill", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.DIRECT_KILL;
    if (this.combatValue(vector, "enemyDoomedFirstActions", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.DOOMED_FIRST_ACTION;
    if (this.combatValue(vector, "enemyEndpointReduction", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.ENDPOINT_REDUCTION;
    if (this.combatValue(vector, "enemyMobilityLoss", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.MOBILITY_LOSS;
    if (this.combatValue(vector, "enemyCounterfireDelay", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.COUNTERFIRE_DELAY;
    if (this.combatValue(vector, "possibleHit", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.POSSIBLE_HIT;
    if (this.combatValue(vector, "aimSetup", attack) ||
        this.combatValue(vector, "intercept", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.AIM_OR_INTERCEPT;
    if (this.combatValue(vector, "escapeDenial", attack) ||
        this.combatValue(vector, "shieldBreak", attack) ||
        this.combatValue(vector, "zoneDenial", attack) ||
        this.combatValue(vector, "beliefSweep", attack))
      signal |= COMBAT_PHYSICAL_SIGNAL.OTHER_PURPOSE;
    this.combatBlockPhysicalSignalMask[signal] += 1;
    if (signal && !positive)
      this.combatBlockPhysicalSignalWithoutValueCount += 1;
    const starCost = (robust[offset + POLICY_DIMENSION.STAR_GAIN] < 0 ? 1 : 0) |
      (robust[offset + POLICY_DIMENSION.STAR_DISTANCE] < 0 ? 2 : 0);
    this.combatBlockStarCostMask[starCost] += 1;
    const temporal = this.response.temporalRobust;
    const temporalOffset = this.response.lastCurrentRiskIndex *
      TEMPORAL_DIMENSION.COUNT;
    let temporalPattern = 0; let temporalScale = 1; let temporalPositive = 0;
    if (temporal && temporalOffset >= 0)
      for (let index = 0; index < TEMPORAL_DIMENSION.COUNT; index += 1) {
        const value = temporal[temporalOffset + index];
        const sign = value < 0 ? 0 : value > 0 ? 2 : 1;
        temporalPattern += sign * temporalScale; temporalScale *= 3;
        this.combatBlockTemporalRobustSignCount[index * 3 + sign] += 1;
        this.combatBlockTemporalRobustSum[index] += value;
        if (value > 0) temporalPositive += 1;
      }
    this.combatBlockTemporalPositiveDimensionCount[temporalPositive] += 1;
    this.combatBlockTemporalRobustSignPattern[temporalPattern] += 1;
    if (signal && !positive && temporalPositive)
      this.combatBlockTemporalRecoveryCount += 1;
  }

  optionComplete(engine, row, kind) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row &&
          portfolio.kind[at] === kind && portfolio.supportComplete[at]) return 1;
    return 0;
  }

  attackComplete(engine, row) {
    return this.optionComplete(engine, row, OPTION_KIND.DIRECT_KILL) ||
      this.optionComplete(engine, row, OPTION_KIND.ATTACK_SETUP) ? 1 : 0;
  }

  eligibleAttack(engine, row) {
    const risk = engine.riskController && engine.riskController.outcome;
    const combat = engine.combat && engine.combat.vector;
    return risk && combat && row >= 0 && row < engine.ourCount &&
      engine.ourActions[row] === ACTION.FIRE &&
      engine.hardStatus[row] === HARD_STATUS.ALLOW && row < risk.count &&
      risk.acceptable[row] && !risk.dominated[row] &&
      combat.purposeCompleteness[row] >= 4500 && combat.postFireEscape[row] > 0 &&
      this.attackComplete(engine, row) ? 1 : 0;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const combat = engine.combat.vector;
    if (combat.directKill[left] !== combat.directKill[right])
      return combat.directKill[left] > combat.directKill[right] ? 1 : 0;
    if (combat.enemyDoomedFirstActions[left] !==
        combat.enemyDoomedFirstActions[right])
      return combat.enemyDoomedFirstActions[left] >
        combat.enemyDoomedFirstActions[right] ? 1 : 0;
    if (combat.enemyEndpointReduction[left] !==
        combat.enemyEndpointReduction[right])
      return combat.enemyEndpointReduction[left] >
        combat.enemyEndpointReduction[right] ? 1 : 0;
    if (combat.ownCounterExposure[left] !== combat.ownCounterExposure[right])
      return combat.ownCounterExposure[left] <
        combat.ownCounterExposure[right] ? 1 : 0;
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  eventMask(engine, frame) {
    const a = engine.adapter.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const ownStars = a[ARRAY.TANK_STARS][0];
    const enemyStars = a[ARRAY.TANK_STARS][1];
    const visible = engine.adapter.enemyVisible ? 1 : 0;
    const control = engine.lastControlMode | 0;
    const resources = (engine.adapter.ownBombReady ? 1 : 0) |
      (engine.adapter.ownSkillReady ? 2 : 0);
    const escape = engine.escapeObligation;
    const committed = ((escape.supportStatus & 3) << 12) |
      ((escape.committedEntityCount & 0xff) << 4) |
      (escape.firstActionCount & 0xf);
    const enemyPoison = a[ARRAY.TANK_POISON_UNTIL] &&
      a[ARRAY.TANK_POISON_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_POISON_UNTIL][1] > frame ? 1 : 0;
    const enemyShield = a[ARRAY.TANK_SHIELD_HITS] ?
      a[ARRAY.TANK_SHIELD_HITS][1] : 0;
    const terminal = (engine.rootGlobalMode() & 0xf) |
      ((enemyPoison & 1) << 4) | ((enemyShield & 3) << 5);
    let event = 0;
    if (!this.initialized || frame <= this.previousFrame)
      event = OPTION_EVENT.MATCH_START;
    else {
      if (star !== this.previousStar) event |= OPTION_EVENT.STAR_TARGET;
      if (ownStars !== this.previousOwnStars || enemyStars !== this.previousEnemyStars)
        event |= OPTION_EVENT.STAR_SCORE;
      if (visible !== this.previousVisible) event |= OPTION_EVENT.ENEMY_VISIBILITY;
      if (control !== this.previousControlMode) event |= OPTION_EVENT.CONTACT_MODE;
      if (resources !== this.previousResourceReady) event |= OPTION_EVENT.RESOURCE_READY;
      if (committed !== this.previousCommittedState)
        event |= OPTION_EVENT.COMMITTED_DANGER;
      if (terminal !== this.previousTerminalEffect)
        event |= OPTION_EVENT.TERMINAL_OR_EFFECT;
    }
    this.initialized = 1; this.previousFrame = frame; this.previousStar = star;
    this.previousOwnStars = ownStars; this.previousEnemyStars = enemyStars;
    this.previousVisible = visible; this.previousControlMode = control;
    this.previousResourceReady = resources;
    this.previousCommittedState = committed;
    this.previousTerminalEffect = terminal; this.lastEventMask = event;
    return event;
  }

  classify(engine, selected, attack) {
    const response = this.response;
    if (response.lastEvaluationStatus !== POLICY_EVALUATION_STATUS.COMPLETE ||
        response.lastCurrentRiskIndex < 0) {
      this.responseIncompleteCount += 1; return 0;
    }
    const offset = response.lastCurrentRiskIndex * POLICY_DIMENSION.COUNT;
    const robust = response.robust;
    const safety = robust[offset + POLICY_DIMENSION.NONLOSS] >= 0 &&
      robust[offset + POLICY_DIMENSION.TERMINAL] >= 0 &&
      robust[offset + POLICY_DIMENSION.ENEMY_CRASH] >= 0;
    const starPreserved = robust[offset + POLICY_DIMENSION.STAR_GAIN] >= 0 &&
      robust[offset + POLICY_DIMENSION.STAR_DISTANCE] >= 0;
    const durableCombat = robust[offset + POLICY_DIMENSION.ENEMY_CRASH] > 0 ||
      (robust[offset + POLICY_DIMENSION.PROJECTILE_THREAT] > 0 &&
        robust[offset + POLICY_DIMENSION.ENEMY_MOBILITY] > 0) ||
      (robust[offset + POLICY_DIMENSION.OWN_FIRE_LANE] > 0 &&
        robust[offset + POLICY_DIMENSION.ENEMY_FIRE_LANE] >= 0 &&
        robust[offset + POLICY_DIMENSION.OWN_MOBILITY] >= 0);
    this.lastSafety = safety ? 1 : 0;
    this.lastStarPreserved = starPreserved ? 1 : 0;
    this.lastDurableCombat = durableCombat ? 1 : 0;
    if (!safety) { this.safetyBlockedCount += 1; return 0; }
    const combat = engine.combat.vector;
    this.lastAttackDeadline = combat.hitDeadline[attack];
    this.lastStarDeadline = Math.min(254, Math.max(1,
      engine.starDistance(engine.projectedCell[selected]) + 1));
    if (this.lastAttackDeadline >= 255 ||
        this.lastAttackDeadline > this.lastStarDeadline) {
      this.deadlineBlockedCount += 1; return 0;
    }
    if (response.lastRelation === POLICY_RELATION.ATTACK_DOMINATES) return 1;
    const a = engine.adapter.state.arrays;
    const own = a[ARRAY.TANK_STARS][0]; const enemy = a[ARRAY.TANK_STARS][1];
    const score = own > enemy ? SCORE_BAND.LEADING :
      own < enemy ? SCORE_BAND.TRAILING : SCORE_BAND.TIED;
    this.lastScoreBand = score;
    if (!durableCombat) {
      this.combatBlockedCount += 1;
      this.recordCombatBlock(engine, attack, robust, offset,
        response.lastRelation, score);
      return 0;
    }
    if (score === SCORE_BAND.LEADING ||
        score === SCORE_BAND.TIED && !starPreserved) {
      this.scoreBlockedCount += 1; return 0;
    }
    return 1;
  }

  evaluate(engine, selected, selectionCount) {
    this.checkCount += 1; this.lastProposal = -1; this.lastSelected = selected;
    if (!engine || selected < 0 || selected >= selectionCount ||
        engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL ||
        engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE ||
        !this.optionComplete(engine, selected, OPTION_KIND.STAR_CONTROL) ||
        this.attackComplete(engine, selected)) {
      this.previousConflict = 0; return -1;
    }
    let attack = -1;
    for (let row = 0; row < selectionCount; row += 1)
      if (row !== selected && this.eligibleAttack(engine, row) &&
          this.better(engine, row, attack)) attack = row;
    if (attack < 0) { this.previousConflict = 0; return -1; }
    this.conflictCount += 1;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const event = this.eventMask(engine, frame);
    const trigger = event || !this.previousConflict;
    this.previousConflict = 1;
    if (!trigger) { this.steadySkipCount += 1; return -1; }
    this.triggerCount += 1;
    const restores = this.response.rootRestoreFailureCount;
    this.response.evaluateRows(engine, selected, attack);
    this.rootRestoreFailureCount +=
      this.response.rootRestoreFailureCount - restores;
    if (!this.classify(engine, selected, attack)) return -1;
    this.proposalCount += 1; this.proposalByScore[this.lastScoreBand] += 1;
    this.lastProposal = attack; return attack;
  }

  confirmOverride() { this.overrideCount += 1; }
  rejectFinal() { this.finalRejectCount += 1; }

  summary() {
    return { active: Boolean(this.active), actionOwnership: Boolean(this.active),
      checkCount: this.checkCount, conflictCount: this.conflictCount,
      triggerCount: this.triggerCount, steadySkipCount: this.steadySkipCount,
      responseIncompleteCount: this.responseIncompleteCount,
      safetyBlockedCount: this.safetyBlockedCount,
      deadlineBlockedCount: this.deadlineBlockedCount,
      combatBlockedCount: this.combatBlockedCount,
      scoreBlockedCount: this.scoreBlockedCount,
      proposalCount: this.proposalCount, overrideCount: this.overrideCount,
      finalRejectCount: this.finalRejectCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      proposalByScore: { TIED: this.proposalByScore[SCORE_BAND.TIED],
        LEADING: this.proposalByScore[SCORE_BAND.LEADING],
        TRAILING: this.proposalByScore[SCORE_BAND.TRAILING] },
      durableCombatBlockCensus: {
        dimensionOrder: Array.from(DURABLE_COMBAT_DIMENSIONS),
        signOrder: ["NEGATIVE", "ZERO", "POSITIVE"],
        physicalSignalBits: COMBAT_PHYSICAL_SIGNAL,
        relation: Array.from(this.combatBlockRelation),
        byScore: Array.from(this.combatBlockByScore),
        positiveDimensionCount:
          Array.from(this.combatBlockPositiveDimensionCount),
        robustSignCount: Array.from(this.combatBlockRobustSignCount),
        robustSignPattern: Array.from(this.combatBlockRobustSignPattern),
        robustSum: Array.from(this.combatBlockRobustSum),
        temporalDimensionOrder: [
          TEMPORAL_DIMENSION.PROJECTILE_THREAT_FRAMES,
          TEMPORAL_DIMENSION.ENEMY_MOBILITY_FLOOR,
          TEMPORAL_DIMENSION.ENEMY_MOBILITY_INTEGRAL,
          TEMPORAL_DIMENSION.OWN_FIRE_LANE_FRAMES,
          TEMPORAL_DIMENSION.ENEMY_FIRE_LANE_FRAMES
        ],
        temporalPositiveDimensionCount:
          Array.from(this.combatBlockTemporalPositiveDimensionCount),
        temporalRobustSignCount:
          Array.from(this.combatBlockTemporalRobustSignCount),
        temporalRobustSignPattern:
          Array.from(this.combatBlockTemporalRobustSignPattern),
        temporalRobustSum: Array.from(this.combatBlockTemporalRobustSum),
        physicalSignalMask: Array.from(this.combatBlockPhysicalSignalMask),
        starCostMask: Array.from(this.combatBlockStarCostMask),
        noPositiveDimensionCount: this.combatBlockNoPositiveDimensionCount,
        physicalSignalWithoutValueCount:
          this.combatBlockPhysicalSignalWithoutValueCount,
        temporalRecoveryCount: this.combatBlockTemporalRecoveryCount
      },
      lastProposal: this.lastProposal, lastSelected: this.lastSelected,
      lastEventMask: this.lastEventMask, lastScoreBand: this.lastScoreBand,
      lastAttackDeadline: this.lastAttackDeadline,
      lastStarDeadline: this.lastStarDeadline,
      lastSafety: this.lastSafety, lastDurableCombat: this.lastDurableCombat,
      lastStarPreserved: this.lastStarPreserved,
      response: this.response.summary(), hotAllocationCount:
        this.hotAllocationCount + this.response.hotAllocationCount };
  }
}

module.exports = { DURABLE_COMBAT_DIMENSIONS, COMBAT_PHYSICAL_SIGNAL,
  StrategicAttackOverStarProposal };
