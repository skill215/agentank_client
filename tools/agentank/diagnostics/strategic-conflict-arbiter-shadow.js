"use strict";

// Behavior-neutral bridge from semantic target lifecycle to an Option-level
// ATTACK/STAR conflict decision. It proposes target generations, never primitive
// actions. Physical Hard/EO/Proof remain outside and above this observer.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { LONG_OPTION, OPTION_EVENT, OPTION_NAME } = require(
  "./event-driven-option-shadow");
const { SCORE_BAND, SCORE_BAND_NAME } = require(
  "./strategic-state-ledger-shadow");
const { POLICY_DIMENSION, POLICY_RELATION, POLICY_EVALUATION_STATUS } = require(
  "./response-conditioned-option-policy-shadow");

const STRATEGIC_DECISION = Object.freeze({
  NONE: 0,
  INCOMPLETE: 1,
  KEEP_INCUMBENT: 2,
  ATTACK_PARETO: 3,
  ATTACK_SCORE_CONDITIONED: 4,
  TRADEOFF: 5,
  EQUAL: 6,
  COUNT: 7
});
const STRATEGIC_DECISION_NAME = Object.freeze([
  "NONE", "INCOMPLETE", "KEEP_INCUMBENT", "ATTACK_PARETO",
  "ATTACK_SCORE_CONDITIONED", "TRADEOFF", "EQUAL"
]);
const REEVALUATION_EVENT_MASK = OPTION_EVENT.STAR_TARGET | OPTION_EVENT.STAR_SCORE |
  OPTION_EVENT.ENEMY_VISIBILITY | OPTION_EVENT.CONTACT_MODE |
  OPTION_EVENT.RESOURCE_READY | OPTION_EVENT.COMMITTED_DANGER |
  OPTION_EVENT.TERMINAL_OR_EFFECT;

function named(values, names) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

function bandDecision(values) {
  const output = {};
  for (let band = 0; band < SCORE_BAND.COUNT; band += 1) {
    const row = {}; const base = band * STRATEGIC_DECISION.COUNT;
    for (let decision = 0; decision < STRATEGIC_DECISION.COUNT; decision += 1)
      row[STRATEGIC_DECISION_NAME[decision]] = values[base + decision];
    output[SCORE_BAND_NAME[band]] = row;
  }
  return output;
}

class StrategicConflictArbiterShadow {
  constructor(ledger, strategicState, interval, responsePolicy) {
    if (!ledger || !strategicState || !interval || !responsePolicy)
      throw new Error("StrategicConflictArbiterShadow requires all evidence services");
    this.ledger = ledger; this.strategicState = strategicState;
    this.interval = interval; this.responsePolicy = responsePolicy;
    this.decisionByScore = new Uint32Array(
      SCORE_BAND.COUNT * STRATEGIC_DECISION.COUNT);
    this.actualSelectionByScore = new Uint32Array(
      SCORE_BAND.COUNT * LONG_OPTION.COUNT);
    this.proposalByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.starCostByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.deadlineAdvantageByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.durableCombatByScore = new Uint32Array(SCORE_BAND.COUNT);
    this.observationCount = 0; this.matchCount = 0;
    this.targetAdoptionCount = 0; this.targetContinuationCount = 0;
    this.targetSemanticAbortCount = 0; this.eventReevaluationCount = 0;
    this.unsignaledSwitchCount = 0; this.unsignaledWouldHoldCount = 0;
    this.conflictEvaluationCount = 0; this.duplicateConflictSkipCount = 0;
    this.incumbentKindBlockedCount = 0; this.deadlineIncompleteCount = 0;
    this.incompleteConflictCount = 0; this.attackParetoCount = 0;
    this.scoreConditionedAttackCount = 0; this.keepIncumbentCount = 0;
    this.tradeoffCount = 0; this.equalCount = 0;
    this.attackProposalContinuationCount = 0;
    this.proposalTargetAdoptionCount = 0;
    this.proposalTargetDeadlineExpiryCount = 0;
    this.counterfactualReleaseCount = 0;
    this.leadingAttackProposalCount = 0; this.tiedAttackProposalCount = 0;
    this.trailingAttackProposalCount = 0;
    this.hotAllocationCount = 0; this.initialized = 0; this.previousFrame = -1;
    this.shadowTargetSlot = -1; this.shadowTargetGeneration = 0;
    this.shadowTargetKind = LONG_OPTION.NONE; this.shadowTargetStartFrame = 0;
    this.shadowTargetProposalOwned = 0; this.shadowTargetDeadline = 0xffff;
    this.previousAttackProposalGeneration = 0; this.lastEvaluationSerial = 0;
    this.previousActualGeneration = 0;
    this.lastDecision = STRATEGIC_DECISION.NONE;
    this.lastAttackGeneration = 0; this.lastIncumbentGeneration = 0;
    this.lastAttackDeadline = 0xffff; this.lastIncumbentDeadline = 0xffff;
    this.lastSafetyPreserved = 0; this.lastStarPreserved = 0;
    this.lastCombatPositive = 0; this.lastDurableCombat = 0;
    this.lastDeadlineAdvantage = 0; this.maximumShadowTargetAge = 0;
  }

  generationSlot(generation) {
    if (!generation) return -1;
    for (let slot = 0; slot < this.ledger.capacity; slot += 1)
      if (this.ledger.active[slot] && this.ledger.generation[slot] === generation)
        return slot;
    return -1;
  }

  adopt(slot, generation, kind, frame, proposalOwned = 0) {
    this.shadowTargetSlot = slot; this.shadowTargetGeneration = generation;
    this.shadowTargetKind = kind; this.shadowTargetStartFrame = frame;
    this.shadowTargetProposalOwned = proposalOwned ? 1 : 0;
    this.shadowTargetDeadline = 0xffff;
    this.targetAdoptionCount += 1;
  }

  releaseCounterfactual() {
    if (!this.shadowTargetProposalOwned) return;
    this.shadowTargetSlot = -1; this.shadowTargetGeneration = 0;
    this.shadowTargetKind = LONG_OPTION.NONE;
    this.shadowTargetProposalOwned = 0; this.shadowTargetDeadline = 0xffff;
    this.counterfactualReleaseCount += 1;
  }

  observeTargetLifecycle(frame) {
    const generation = this.ledger.lastSelectedGeneration;
    const kind = this.ledger.lastSelectedKind; const event = this.ledger.lastEventMask;
    const selectedSlot = this.ledger.lastSelectedSlot;
    if (this.shadowTargetProposalOwned && frame > this.shadowTargetDeadline) {
      this.proposalTargetDeadlineExpiryCount += 1;
      this.shadowTargetSlot = -1; this.shadowTargetGeneration = 0;
      this.shadowTargetKind = LONG_OPTION.NONE;
      this.shadowTargetProposalOwned = 0; this.shadowTargetDeadline = 0xffff;
    }
    if (!this.shadowTargetGeneration) {
      if (generation) this.adopt(selectedSlot, generation, kind, frame);
      return;
    }
    const slot = this.generationSlot(this.shadowTargetGeneration);
    if (slot < 0) {
      this.targetSemanticAbortCount += 1;
      this.shadowTargetGeneration = 0; this.shadowTargetSlot = -1;
      this.shadowTargetKind = LONG_OPTION.NONE;
      this.shadowTargetProposalOwned = 0; this.shadowTargetDeadline = 0xffff;
      if (generation) this.adopt(selectedSlot, generation, kind, frame);
      return;
    }
    this.shadowTargetSlot = slot;
    const age = frame - this.shadowTargetStartFrame + 1;
    if (age > this.maximumShadowTargetAge) this.maximumShadowTargetAge = age;
    if (generation === this.shadowTargetGeneration) {
      this.targetContinuationCount += 1; return;
    }
    if (event & REEVALUATION_EVENT_MASK) {
      this.eventReevaluationCount += 1;
      if (generation) this.adopt(selectedSlot, generation, kind, frame);
      return;
    }
    if (generation !== this.previousActualGeneration) this.unsignaledSwitchCount += 1;
    // The previous semantic target remains alive. A durable target owner would
    // retain it and ask its execution policy for a new primitive this frame.
    this.unsignaledWouldHoldCount += 1;
  }

  classifyConflict(score) {
    const response = this.responsePolicy;
    this.lastSafetyPreserved = 0; this.lastStarPreserved = 0;
    this.lastCombatPositive = 0; this.lastDurableCombat = 0;
    this.lastDeadlineAdvantage = 0;
    if (response.lastEvaluationStatus !== POLICY_EVALUATION_STATUS.COMPLETE ||
        response.lastCurrentRiskIndex < 0 ||
        response.lastEvaluationSerial !== this.interval.evaluationSerial) {
      this.incompleteConflictCount += 1; return STRATEGIC_DECISION.INCOMPLETE;
    }
    const offset = response.lastCurrentRiskIndex * POLICY_DIMENSION.COUNT;
    const robust = response.robust;
    const safety = robust[offset + POLICY_DIMENSION.NONLOSS] >= 0 &&
      robust[offset + POLICY_DIMENSION.TERMINAL] >= 0 &&
      robust[offset + POLICY_DIMENSION.ENEMY_CRASH] >= 0;
    const starPreserved = robust[offset + POLICY_DIMENSION.STAR_GAIN] >= 0 &&
      robust[offset + POLICY_DIMENSION.STAR_DISTANCE] >= 0;
    const combatPositive = robust[offset + POLICY_DIMENSION.ENEMY_CRASH] > 0 ||
      robust[offset + POLICY_DIMENSION.PROJECTILE_THREAT] > 0 ||
      robust[offset + POLICY_DIMENSION.ENEMY_MOBILITY] > 0 ||
      robust[offset + POLICY_DIMENSION.OWN_MOBILITY] > 0 ||
      robust[offset + POLICY_DIMENSION.OWN_FIRE_LANE] > 0 ||
      robust[offset + POLICY_DIMENSION.ENEMY_FIRE_LANE] > 0;
    const durableCombat = robust[offset + POLICY_DIMENSION.ENEMY_CRASH] > 0 ||
      (robust[offset + POLICY_DIMENSION.PROJECTILE_THREAT] > 0 &&
        robust[offset + POLICY_DIMENSION.ENEMY_MOBILITY] > 0) ||
      (robust[offset + POLICY_DIMENSION.OWN_FIRE_LANE] > 0 &&
        robust[offset + POLICY_DIMENSION.ENEMY_FIRE_LANE] >= 0 &&
        robust[offset + POLICY_DIMENSION.OWN_MOBILITY] >= 0);
    const deadlineComplete = this.lastAttackDeadline < 255 &&
      this.lastIncumbentDeadline < 255;
    const deadline = deadlineComplete &&
      this.lastAttackDeadline <= this.lastIncumbentDeadline;
    this.lastSafetyPreserved = safety ? 1 : 0;
    this.lastStarPreserved = starPreserved ? 1 : 0;
    this.lastCombatPositive = combatPositive ? 1 : 0;
    this.lastDurableCombat = durableCombat ? 1 : 0;
    this.lastDeadlineAdvantage = deadline ? 1 : 0;
    if (!starPreserved) this.starCostByScore[score] += 1;
    if (deadline) this.deadlineAdvantageByScore[score] += 1;
    if (durableCombat) this.durableCombatByScore[score] += 1;
    if (!deadlineComplete) this.deadlineIncompleteCount += 1;

    if (response.lastRelation === POLICY_RELATION.ATTACK_DOMINATES) {
      this.attackParetoCount += 1; return STRATEGIC_DECISION.ATTACK_PARETO;
    }
    if (response.lastRelation === POLICY_RELATION.STAR_DOMINATES) {
      this.keepIncumbentCount += 1; return STRATEGIC_DECISION.KEEP_INCUMBENT;
    }
    if (response.lastRelation === POLICY_RELATION.EQUAL) {
      this.equalCount += 1; return STRATEGIC_DECISION.EQUAL;
    }
    const scoreQualified = safety && deadline && (
      score === SCORE_BAND.LEADING ? starPreserved && combatPositive :
      score === SCORE_BAND.TIED ? robust[offset + POLICY_DIMENSION.STAR_GAIN] >= 0 &&
        durableCombat : durableCombat);
    if (scoreQualified) {
      this.scoreConditionedAttackCount += 1;
      if (score === SCORE_BAND.LEADING) this.leadingAttackProposalCount += 1;
      else if (score === SCORE_BAND.TIED) this.tiedAttackProposalCount += 1;
      else this.trailingAttackProposalCount += 1;
      return STRATEGIC_DECISION.ATTACK_SCORE_CONDITIONED;
    }
    this.tradeoffCount += 1; return STRATEGIC_DECISION.TRADEOFF;
  }

  observe(engine) {
    if (!engine || !engine.adapter || !engine.adapter.state) return;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.initialized || frame <= this.previousFrame) {
      this.matchCount += 1; this.shadowTargetSlot = -1;
      this.shadowTargetGeneration = 0; this.shadowTargetKind = LONG_OPTION.NONE;
      this.shadowTargetProposalOwned = 0; this.shadowTargetDeadline = 0xffff;
      this.previousAttackProposalGeneration = 0; this.lastEvaluationSerial = 0;
      this.previousActualGeneration = 0;
    }
    this.initialized = 1; this.previousFrame = frame; this.observationCount += 1;
    const score = this.strategicState.lastScoreBand;
    this.actualSelectionByScore[score * LONG_OPTION.COUNT +
      this.ledger.lastSelectedKind] += 1;
    this.observeTargetLifecycle(frame);
    this.previousActualGeneration = this.ledger.lastSelectedGeneration;

    if (!this.interval.evaluationSerial ||
        this.interval.evaluationSerial === this.lastEvaluationSerial) {
      this.duplicateConflictSkipCount += 1; return;
    }
    this.lastEvaluationSerial = this.interval.evaluationSerial;
    if (this.ledger.lastSelectedKind !== LONG_OPTION.STAR_CONTROL) {
      this.incumbentKindBlockedCount += 1; return;
    }
    this.conflictEvaluationCount += 1;
    this.lastAttackGeneration = this.interval.lastAttackGeneration;
    this.lastIncumbentGeneration = this.ledger.lastSelectedGeneration;
    const attackRow = this.interval.lastAttackRow;
    const incumbentRow = this.interval.lastSelectedRow;
    const combat = engine.combat && engine.combat.vector;
    this.lastAttackDeadline = !combat || attackRow < 0 ? 255 :
      combat.hitDeadline[attackRow];
    this.lastIncumbentDeadline = incumbentRow < 0 || !engine.projectedCell ||
      typeof engine.starDistance !== "function" ? 255 :
        Math.min(254, Math.max(1,
          engine.starDistance(engine.projectedCell[incumbentRow]) + 1));
    const decision = this.classifyConflict(score); this.lastDecision = decision;
    this.decisionByScore[score * STRATEGIC_DECISION.COUNT + decision] += 1;
    if (decision === STRATEGIC_DECISION.ATTACK_PARETO ||
        decision === STRATEGIC_DECISION.ATTACK_SCORE_CONDITIONED) {
      this.proposalByScore[score] += 1;
      if (this.lastAttackGeneration && this.lastAttackGeneration ===
          this.previousAttackProposalGeneration)
        this.attackProposalContinuationCount += 1;
      this.previousAttackProposalGeneration = this.lastAttackGeneration;
      const attackSlot = this.generationSlot(this.lastAttackGeneration);
      if (attackSlot >= 0 && (!this.shadowTargetProposalOwned ||
          this.shadowTargetGeneration !== this.lastAttackGeneration)) {
        this.adopt(attackSlot, this.lastAttackGeneration, LONG_OPTION.ATTACK,
          frame, 1);
        this.proposalTargetAdoptionCount += 1;
      }
      this.shadowTargetProposalOwned = attackSlot >= 0 ? 1 : 0;
      this.shadowTargetDeadline = attackSlot < 0 ||
        this.lastAttackDeadline >= 255 ? 0xffff :
          Math.min(0xffff, frame + this.lastAttackDeadline);
    } else this.previousAttackProposalGeneration = 0;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, actionOwnership: false,
      proposalUnit: "TARGET_GENERATION", observationCount: this.observationCount,
      matchCount: this.matchCount, targetAdoptionCount: this.targetAdoptionCount,
      targetContinuationCount: this.targetContinuationCount,
      targetSemanticAbortCount: this.targetSemanticAbortCount,
      eventReevaluationCount: this.eventReevaluationCount,
      unsignaledSwitchCount: this.unsignaledSwitchCount,
      unsignaledWouldHoldCount: this.unsignaledWouldHoldCount,
      maximumShadowTargetAge: this.maximumShadowTargetAge,
      conflictEvaluationCount: this.conflictEvaluationCount,
      duplicateConflictSkipCount: this.duplicateConflictSkipCount,
      incumbentKindBlockedCount: this.incumbentKindBlockedCount,
      deadlineIncompleteCount: this.deadlineIncompleteCount,
      incompleteConflictCount: this.incompleteConflictCount,
      attackParetoCount: this.attackParetoCount,
      scoreConditionedAttackCount: this.scoreConditionedAttackCount,
      keepIncumbentCount: this.keepIncumbentCount,
      tradeoffCount: this.tradeoffCount, equalCount: this.equalCount,
      attackProposalContinuationCount: this.attackProposalContinuationCount,
      proposalTargetAdoptionCount: this.proposalTargetAdoptionCount,
      proposalTargetDeadlineExpiryCount:
        this.proposalTargetDeadlineExpiryCount,
      counterfactualReleaseCount: this.counterfactualReleaseCount,
      leadingAttackProposalCount: this.leadingAttackProposalCount,
      tiedAttackProposalCount: this.tiedAttackProposalCount,
      trailingAttackProposalCount: this.trailingAttackProposalCount,
      decisionByScore: bandDecision(this.decisionByScore),
      actualSelectionByScore: (() => {
        const output = {};
        for (let band = 0; band < SCORE_BAND.COUNT; band += 1) {
          const row = {}; const base = band * LONG_OPTION.COUNT;
          for (let kind = 0; kind < LONG_OPTION.COUNT; kind += 1)
            row[OPTION_NAME[kind]] = this.actualSelectionByScore[base + kind];
          output[SCORE_BAND_NAME[band]] = row;
        }
        return output;
      })(),
      proposalByScore: named(this.proposalByScore, SCORE_BAND_NAME),
      starCostByScore: named(this.starCostByScore, SCORE_BAND_NAME),
      deadlineAdvantageByScore: named(this.deadlineAdvantageByScore,
        SCORE_BAND_NAME),
      durableCombatByScore: named(this.durableCombatByScore, SCORE_BAND_NAME),
      lastDecision: STRATEGIC_DECISION_NAME[this.lastDecision],
      lastAttackGeneration: this.lastAttackGeneration,
      lastIncumbentGeneration: this.lastIncumbentGeneration,
      shadowTargetProposalOwned: this.shadowTargetProposalOwned,
      shadowTargetDeadline: this.shadowTargetDeadline,
      lastAttackDeadline: this.lastAttackDeadline,
      lastIncumbentDeadline: this.lastIncumbentDeadline,
      lastSafetyPreserved: this.lastSafetyPreserved,
      lastStarPreserved: this.lastStarPreserved,
      lastCombatPositive: this.lastCombatPositive,
      lastDurableCombat: this.lastDurableCombat,
      lastDeadlineAdvantage: this.lastDeadlineAdvantage,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { STRATEGIC_DECISION, STRATEGIC_DECISION_NAME,
  REEVALUATION_EVENT_MASK, StrategicConflictArbiterShadow };
