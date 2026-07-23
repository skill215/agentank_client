"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { HARD_STATUS, ACTION } = require("../abi/fast-codes");
const { VALUE_MIN, PROBABILITY_SCALE, RISK_DIMENSION } = require("../abi/search-codes");
const { SAFETY_STATUS, NONE_FATAL_FRAME } = require("./information-safety-closure");
const { contaminatedLower } = require("./fixed-math");
const { RiskProfile } = require("./risk");

const NO_ACCEPTABLE_ACTION = 1;
const MATERIAL_EXPECTED_GAIN = PROBABILITY_SCALE / 5;
// Under death pressure, tiny search/robust edges must not let FIRE/bombs
// dominate or outrank GO/TURN — that produced R22 SURVIVE→DIE flips.
const ESCAPE_ROBUST_SLACK = 80;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function deathPressure(outcome, row) {
  return outcome.immediateFatalMass[row] > 0 || outcome.horizonFatalMass[row] > 0 ||
    outcome.escapeSlack[row] < 0;
}

// Escape class: GO and turns share rank so mobility cannot demote a surviving
// GO in favor of a turning action with a near-tied robust. FIRE/bombs/skills
// share the non-escape rank — FIRE must not outrank CAST_POISON in emergency.
function escapeMobilityRank(action) {
  if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT ||
      action === ACTION.GO) return 2;
  return 0;
}

class ActionOutcomeSlab {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.maxActions = maxActions; this.hard = new Uint8Array(maxActions);
    this.safety = new Uint8Array(maxActions); this.immediateFatalMass = new Uint16Array(maxActions);
    this.horizonFatalMass = new Uint16Array(maxActions); this.unknownMass = new Uint16Array(maxActions);
    this.earliestFatalFrame = new Uint8Array(maxActions); this.escapeSlack = new Int8Array(maxActions);
    this.coverage = new Uint16Array(maxActions); this.worstValue = new Int16Array(maxActions);
    this.nominalRobustLower = new Int16Array(maxActions);
    this.robustLower = new Int16Array(maxActions); this.expectedValue = new Int16Array(maxActions);
    this.tacticalValue = new Int16Array(maxActions); this.acceptable = new Uint8Array(maxActions);
    this.dominated = new Uint8Array(maxActions); this.count = 0; this.hotAllocationCount = 0;
    this.combatPurpose = new Uint8Array(maxActions); this.hitDeadline = new Uint8Array(maxActions);
    this.enemySafeSuccessors = new Uint8Array(maxActions);
    this.ownCounterExposure = new Uint16Array(maxActions);
    this.resourceOccupancy = new Uint8Array(maxActions); this.blockadeValue = new Uint16Array(maxActions);
    this.purposeCompleteness = new Uint16Array(maxActions); this.postFireEscape = new Uint8Array(maxActions);
    this.combatPressure = new Int16Array(maxActions); this.combatRobustPressure = new Int16Array(maxActions);
    this.committedFatalMass = new Uint16Array(maxActions);
    this.possibleProjectileFatalMass = new Uint16Array(maxActions);
    this.futureFireFatalMass = new Uint16Array(maxActions);
    // Escape Quality from DeadlineKernel per-successor (not committedPressure).
    this.escapeSuccessorProof = new Uint8Array(maxActions);
    this.escapeSuccessorExposed = new Uint8Array(maxActions);
    this.escapeSuccessorSlack = new Int8Array(maxActions);
    this.escapeSuccessorBranches = new Uint8Array(maxActions);
    this.escapeSuccessorCoverage = new Uint8Array(maxActions);
    this.escapeSuccessorReady = 0;
  }
  reset(count) {
    this.count = count; this.hard.fill(0, 0, count); this.safety.fill(SAFETY_STATUS.UNKNOWN, 0, count);
    this.immediateFatalMass.fill(0, 0, count); this.horizonFatalMass.fill(0, 0, count);
    this.unknownMass.fill(0, 0, count); this.earliestFatalFrame.fill(NONE_FATAL_FRAME, 0, count);
    this.escapeSlack.fill(0, 0, count); this.coverage.fill(0, 0, count);
    this.worstValue.fill(-10000, 0, count); this.robustLower.fill(-10000, 0, count);
    this.nominalRobustLower.fill(-10000, 0, count);
    this.expectedValue.fill(-10000, 0, count); this.tacticalValue.fill(-10000, 0, count);
    this.acceptable.fill(0, 0, count); this.dominated.fill(0, 0, count);
    this.combatPurpose.fill(0, 0, count); this.hitDeadline.fill(255, 0, count);
    this.enemySafeSuccessors.fill(0, 0, count); this.ownCounterExposure.fill(0, 0, count);
    this.resourceOccupancy.fill(0, 0, count); this.blockadeValue.fill(0, 0, count);
    this.purposeCompleteness.fill(0, 0, count); this.postFireEscape.fill(0, 0, count);
    this.combatPressure.fill(0, 0, count); this.combatRobustPressure.fill(0, 0, count);
    this.committedFatalMass.fill(0, 0, count);
    this.possibleProjectileFatalMass.fill(0, 0, count);
    this.futureFireFatalMass.fill(0, 0, count);
    this.escapeSuccessorProof.fill(0, 0, count);
    this.escapeSuccessorExposed.fill(0, 0, count);
    this.escapeSuccessorSlack.fill(-128, 0, count);
    this.escapeSuccessorBranches.fill(0, 0, count);
    this.escapeSuccessorCoverage.fill(0, 0, count);
    this.escapeSuccessorReady = 0;
  }
  copySafety(row, hard, safety) {
    this.hard[row] = hard; this.safety[row] = safety.status[row];
    this.immediateFatalMass[row] = safety.immediateFatalMass[row];
    this.horizonFatalMass[row] = safety.horizonFatalMass[row];
    this.unknownMass[row] = safety.unknownMass[row];
    this.earliestFatalFrame[row] = safety.earliestFatalFrame[row];
    this.escapeSlack[row] = safety.escapeSlack[row]; this.coverage[row] = safety.coverage[row];
    if (safety.committedDeathMass && safety.possibleProjectileDeathMass &&
        safety.futureFireDeathMass) {
      const base = row * 4;
      for (let depth = 0; depth < 4; depth += 1) {
        this.committedFatalMass[row] = Math.min(PROBABILITY_SCALE,
          this.committedFatalMass[row] + safety.committedDeathMass[base + depth]);
        if (safety.possibleProjectileStrategyApplied &&
            safety.possibleProjectileStrategyApplied[row])
          this.possibleProjectileFatalMass[row] = Math.min(PROBABILITY_SCALE,
            this.possibleProjectileFatalMass[row] + safety.possibleProjectileDeathMass[base + depth]);
        if (safety.futureFireStrategyApplied && safety.futureFireStrategyApplied[row])
          this.futureFireFatalMass[row] = Math.min(PROBABILITY_SCALE,
            this.futureFireFatalMass[row] + safety.futureFireDeathMass[base + depth]);
      }
    }
  }
}

class RiskAcceptanceController {
  constructor() {
    this.outcome = new ActionOutcomeSlab(); this.risk = 0; this.stateRiskClass = 0;
    this.immediateLimit = 0; this.horizonLimit = 0; this.unknownLimit = 0;
    this.minimumEscapeSlack = 0; this.safeFloor = -10000; this.acceptableCount = 0;
    this.noAcceptableAction = 0; this.lastSelected = -1; this.stageMatrixUseCount = 0;
    this.combatAppliedCount = 0;
    this.continuationCommitCount = 0; this.continuationInvalidatedCount = 0;
    this.riskProfile = new RiskProfile(); this.safetyBackupCount = 0;
    this.searchDivisor = 2;
    this.gateCount = 0;
    this.hotAllocationCount = 0;
  }
  adjustedRisk(baseRisk, stateRiskClass) {
    const bounded = clamp(baseRisk | 0, 0, 100); const factor = stateRiskClass === 1 ? 50 :
      stateRiskClass === 3 ? 75 : 100;
    return Math.floor(bounded * factor / 100);
  }
  thresholds(baseRisk, stateRiskClass = 0) {
    const risk = this.adjustedRisk(baseRisk, stateRiskClass); this.risk = risk;
    this.stateRiskClass = stateRiskClass; this.immediateLimit = Math.floor(99 * risk * risk / 100);
    this.unknownLimit = this.immediateLimit; this.horizonLimit = 99 * risk;
    this.minimumEscapeSlack = risk === 0 ? 0 : -Math.floor(4 * risk / 100); return risk;
  }
  populate(count, hard, safety, tactical, depthSearch, informationSearch, enemyCount,
      combat = null, searchDivisor = 2, ourActions = null) {
    const outcome = this.outcome; outcome.reset(count);
    this.ourActions = ourActions;
    this.searchDivisor = Number.isSafeInteger(searchDivisor) && searchDivisor > 0 ?
      searchDivisor : 2;
    const information = informationSearch && informationSearch.completedDepth > 0;
    const physical = depthSearch && depthSearch.completedDepth > 0;
    const search = information ? informationSearch : physical ? depthSearch : null;
    for (let row = 0; row < count; row += 1) {
      outcome.copySafety(row, hard[row], safety);
      const committedPressure = combat ? combat.robustPressure[row] : 0;
      const tacticalValue = clamp(tactical[row] + committedPressure, -10000, 10000);
      outcome.tacticalValue[row] = tacticalValue;
      let worst = tacticalValue; let robust = tacticalValue; let expected = tacticalValue;
      if (search) {
        const searchPart = Math.trunc(search.rootScore[row] / this.searchDivisor);
        const blended = clamp(tacticalValue + searchPart, -10000, 10000);
        // Under Safety death pressure, shallow Information leaves must not let
        // tactical aggression outrank the search signal. Physical depth search
        // already owns multi-ply recursion — keep its blended robust.
        if (information && deathPressure(outcome, row)) {
          robust = clamp(searchPart, -10000, 10000);
          expected = blended;
        } else {
          robust = blended; expected = blended;
        }
        worst = 10000;
        for (let column = 0; column < enemyCount; column += 1) {
          const searchValue = search.rootCellScore[row * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column];
          const value = clamp(tacticalValue + Math.trunc(searchValue /
            this.searchDivisor), -10000, 10000);
          if (value < worst) worst = value;
        }
        if (enemyCount === 0) worst = robust;
      }
      outcome.worstValue[row] = worst; outcome.nominalRobustLower[row] = robust;
      outcome.robustLower[row] = robust;
      outcome.expectedValue[row] = expected;
    }
    return outcome;
  }
  binaryFatalBackup(value, mass, lambda) {
    if (mass <= 0) return value;
    const bounded = Math.min(PROBABILITY_SCALE, mass);
    const expected = Math.floor(((PROBABILITY_SCALE - bounded) * value +
      bounded * VALUE_MIN) / PROBABILITY_SCALE);
    return contaminatedLower(lambda, expected, VALUE_MIN);
  }
  applySafetyRobustBackup(baseRisk, stateRiskClass) {
    const o = this.outcome;
    const chance = this.riskProfile.lambda(baseRisk, stateRiskClass,
      RISK_DIMENSION.CHANCE_OUTCOME);
    const hidden = this.riskProfile.lambda(baseRisk, stateRiskClass,
      RISK_DIMENSION.HIDDEN_WORLD);
    const enemy = this.riskProfile.lambda(baseRisk, stateRiskClass,
      RISK_DIMENSION.ENEMY_ACTION);
    for (let row = 0; row < o.count; row += 1) {
      // Direct slab fixtures and diagnostic callers predate the explicit
      // nominal/robust split. Preserve that stable low-level API while normal
      // production populate() always owns both values.
      if (o.nominalRobustLower[row] === VALUE_MIN && o.robustLower[row] !== VALUE_MIN)
        o.nominalRobustLower[row] = o.robustLower[row];
      let value = o.nominalRobustLower[row];
      value = this.binaryFatalBackup(value, o.committedFatalMass[row], chance);
      value = this.binaryFatalBackup(value, o.possibleProjectileFatalMass[row], hidden);
      value = this.binaryFatalBackup(value, o.futureFireFatalMass[row], enemy);
      o.robustLower[row] = value;
      if (o.committedFatalMass[row] || o.possibleProjectileFatalMass[row] ||
          o.futureFireFatalMass[row]) o.worstValue[row] = VALUE_MIN;
    }
    this.safetyBackupCount += 1;
  }
  // Strict Escape Quality on committed discriminators only (proof + stillExposed).
  // Slack/branches are weaker pose hints and must not outrank Soft/search masses
  // when exposure is tied (that flipped f594 GO→TURN).
  escapeQualityBetter(left, right) {
    const o = this.outcome;
    if (!o.escapeSuccessorReady) return 0;
    if (o.escapeSuccessorProof[left] !== o.escapeSuccessorProof[right])
      return o.escapeSuccessorProof[left] > o.escapeSuccessorProof[right] ? 1 : 0;
    if (o.escapeSuccessorExposed[left] !== o.escapeSuccessorExposed[right])
      return o.escapeSuccessorExposed[left] < o.escapeSuccessorExposed[right] ? 1 : 0;
    return 0;
  }

  strictlyDominates(left, right) {
    const o = this.outcome;
    // Better Escape Quality cannot be dominated by a worse-quality peer.
    if (this.escapeQualityBetter(right, left)) return 0;
    const noMoreRisk = o.immediateFatalMass[left] <= o.immediateFatalMass[right] &&
      o.horizonFatalMass[left] <= o.horizonFatalMass[right] && o.unknownMass[left] <= o.unknownMass[right] &&
      o.earliestFatalFrame[left] >= o.earliestFatalFrame[right] &&
      o.escapeSlack[left] >= o.escapeSlack[right];
    const pressure = deathPressure(o, left) || deathPressure(o, right);
    // Under Safety death pressure, only search-backed robust may dominate on
    // value. Tactical/expected edges are not certificates at depth 1.
    if (pressure) {
      const riskStrict = o.immediateFatalMass[left] < o.immediateFatalMass[right] ||
        o.horizonFatalMass[left] < o.horizonFatalMass[right] ||
        o.unknownMass[left] < o.unknownMass[right] ||
        o.earliestFatalFrame[left] > o.earliestFatalFrame[right] ||
        o.escapeSlack[left] > o.escapeSlack[right];
      // Value-only domination needs a material robust gap so near-tied search
      // cannot mark the surviving escape row dominated.
      return noMoreRisk && o.robustLower[left] >= o.robustLower[right] &&
        (riskStrict || o.robustLower[left] > o.robustLower[right] + ESCAPE_ROBUST_SLACK);
    }
    const noLessValue = o.robustLower[left] >= o.robustLower[right] &&
      o.expectedValue[left] >= o.expectedValue[right] && o.tacticalValue[left] >= o.tacticalValue[right];
    const strict = o.immediateFatalMass[left] < o.immediateFatalMass[right] ||
      o.horizonFatalMass[left] < o.horizonFatalMass[right] || o.unknownMass[left] < o.unknownMass[right] ||
      o.earliestFatalFrame[left] > o.earliestFatalFrame[right] ||
      o.escapeSlack[left] > o.escapeSlack[right] || o.robustLower[left] > o.robustLower[right] ||
      o.expectedValue[left] > o.expectedValue[right] || o.tacticalValue[left] > o.tacticalValue[right];
    return noMoreRisk && noLessValue && strict;
  }
  gate(baseRisk, stateRiskClass = 0) {
    this.thresholds(baseRisk, stateRiskClass); this.gateCount += 1;
    this.applySafetyRobustBackup(baseRisk, stateRiskClass);
    const o = this.outcome; this.acceptableCount = 0;
    this.noAcceptableAction = 0; this.safeFloor = -10000;
    let completeSafeWitness = 0;
    for (let row = 0; row < o.count; row += 1)
      if (o.hard[row] === HARD_STATUS.ALLOW && o.safety[row] === SAFETY_STATUS.PROVEN_SAFE &&
          o.immediateFatalMass[row] === 0 && o.horizonFatalMass[row] === 0 &&
          o.unknownMass[row] === 0 && o.coverage[row] === 10000) completeSafeWitness = 1;
    for (let row = 0; row < o.count; row += 1) {
      const hardAllowed = o.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
        o.hard[row] !== HARD_STATUS.REJECT_POLICY;
      let accepted = hardAllowed && o.immediateFatalMass[row] <= this.immediateLimit &&
        o.horizonFatalMass[row] <= this.horizonLimit && o.unknownMass[row] <= this.unknownLimit &&
        o.escapeSlack[row] >= this.minimumEscapeSlack;
      if (this.risk === 0 && completeSafeWitness)
        accepted = accepted && o.safety[row] === SAFETY_STATUS.PROVEN_SAFE &&
          o.coverage[row] === 10000;
      o.acceptable[row] = accepted ? 1 : 0; if (accepted) this.acceptableCount += 1;
    }
    this.recomputeSelectionFrontier();
    if (this.acceptableCount === 0) this.noAcceptableAction = NO_ACCEPTABLE_ACTION;
    return this.acceptableCount;
  }
  recomputeSelectionFrontier() {
    const o = this.outcome; o.dominated.fill(0, 0, o.count); this.safeFloor = -10000;
    for (let right = 0; right < o.count; right += 1) if (o.acceptable[right])
      for (let left = 0; left < o.count; left += 1) if (left !== right && o.acceptable[left] &&
          this.strictlyDominates(left, right)) { o.dominated[right] = 1; break; }
    let maxRobust = -10000; let deathFrontier = 0;
    for (let row = 0; row < o.count; row += 1) {
      if (!o.acceptable[row] || o.dominated[row]) continue;
      if (o.robustLower[row] > maxRobust) maxRobust = o.robustLower[row];
      if (deathPressure(o, row)) deathFrontier = 1;
    }
    // Keep near-tied escape rows eligible: a tiny FIRE robust edge must not
    // raise the floor above surviving GO/TURN actions.
    this.safeFloor = deathFrontier ? maxRobust - ESCAPE_ROBUST_SLACK : maxRobust;
    // Escape Quality: never floor out the quality-best acceptable escape — Soft
    // robust gaps must not hide a clearing GO under a blast TURN.
    if (o.escapeSuccessorReady) {
      let bestQuality = -1;
      for (let row = 0; row < o.count; row += 1) {
        if (!o.acceptable[row] || o.dominated[row]) continue;
        if (bestQuality < 0 || this.escapeQualityBetter(row, bestQuality)) bestQuality = row;
      }
      if (bestQuality >= 0 && o.robustLower[bestQuality] < this.safeFloor)
        this.safeFloor = o.robustLower[bestQuality];
    }
    return this.safeFloor;
  }
  riskStrictlyDominates(left, right) {
    const o = this.outcome; const noMore =
      o.immediateFatalMass[left] <= o.immediateFatalMass[right] &&
      o.horizonFatalMass[left] <= o.horizonFatalMass[right] &&
      o.unknownMass[left] <= o.unknownMass[right] &&
      o.earliestFatalFrame[left] >= o.earliestFatalFrame[right] &&
      o.escapeSlack[left] >= o.escapeSlack[right];
    return noMore && (o.immediateFatalMass[left] < o.immediateFatalMass[right] ||
      o.horizonFatalMass[left] < o.horizonFatalMass[right] ||
      o.unknownMass[left] < o.unknownMass[right] ||
      o.earliestFatalFrame[left] > o.earliestFatalFrame[right] ||
      o.escapeSlack[left] > o.escapeSlack[right]);
  }
  commitContinuation(row) {
    const o = this.outcome;
    if (row < 0 || row >= o.count || !o.acceptable[row]) {
      this.continuationInvalidatedCount += 1; return 0;
    }
    for (let other = 0; other < o.count; other += 1)
      if (other !== row && o.acceptable[other] && this.riskStrictlyDominates(other, row)) {
        this.continuationInvalidatedCount += 1; return 0;
      }
    for (let other = 0; other < o.count; other += 1)
      if (other !== row && o.acceptable[other]) { o.acceptable[other] = 0;
        this.acceptableCount -= 1; }
    this.recomputeSelectionFrontier(); this.continuationCommitCount += 1; return 1;
  }
  applyCombatPressure(combat) {
    const o = this.outcome; if (!combat || combat.count !== o.count) return 0;
    let applied = 0;
    for (let row = 0; row < o.count; row += 1) {
      o.combatPurpose[row] = combat.purposeFlags[row]; o.hitDeadline[row] = combat.hitDeadline[row];
      o.enemySafeSuccessors[row] = combat.enemySafeSuccessors[row];
      o.ownCounterExposure[row] = combat.ownCounterExposure[row];
      o.resourceOccupancy[row] = combat.resourceOccupancy[row];
      o.blockadeValue[row] = combat.blockadeValue[row];
      o.purposeCompleteness[row] = combat.purposeCompleteness[row];
      o.postFireEscape[row] = combat.postFireEscape[row]; o.combatPressure[row] = combat.pressureValue[row];
      o.combatRobustPressure[row] = combat.robustPressure[row];
      if (o.acceptable[row]) {
        const residualPressure = combat.pressureValue[row] - combat.robustPressure[row];
        // CombatPressure is a gated tactical dimension. Keeping the adjusted
        // robust/expected values beside an unadjusted tactical value makes
        // Pareto dominance internally inconsistent.
        o.tacticalValue[row] = clamp(o.tacticalValue[row] + residualPressure,
          -10000, 10000);
        o.expectedValue[row] = clamp(o.expectedValue[row] + residualPressure, -10000, 10000);
        applied += 1;
      }
    }
    this.recomputeSelectionFrontier(); this.combatAppliedCount += applied; return applied;
  }
  lexicographicRiskLess(left, right) {
    if (right < 0) return 1; const o = this.outcome;
    // Escape Quality committed prefix (proof + exposed only) BEFORE Soft fatal
    // masses so clearing escapes beat blast peers. Slack/branches come later.
    if (o.escapeSuccessorReady) {
      if (o.escapeSuccessorProof[left] !== o.escapeSuccessorProof[right])
        return o.escapeSuccessorProof[left] > o.escapeSuccessorProof[right];
      if (o.escapeSuccessorExposed[left] !== o.escapeSuccessorExposed[right])
        return o.escapeSuccessorExposed[left] < o.escapeSuccessorExposed[right];
    }
    if (o.immediateFatalMass[left] !== o.immediateFatalMass[right])
      return o.immediateFatalMass[left] < o.immediateFatalMass[right];
    if (o.horizonFatalMass[left] !== o.horizonFatalMass[right])
      return o.horizonFatalMass[left] < o.horizonFatalMass[right];
    if (o.unknownMass[left] !== o.unknownMass[right]) return o.unknownMass[left] < o.unknownMass[right];
    if (o.earliestFatalFrame[left] !== o.earliestFatalFrame[right])
      return o.earliestFatalFrame[left] > o.earliestFatalFrame[right];
    if (o.escapeSlack[left] !== o.escapeSlack[right]) return o.escapeSlack[left] > o.escapeSlack[right];
    // Under death pressure, escape-class mobility (GO/TURN) outranks FIRE/bombs
    // unless the lower-mobility side has a material robust advantage.
    if ((deathPressure(o, left) || deathPressure(o, right)) && this.ourActions) {
      const leftRank = escapeMobilityRank(this.ourActions[left]);
      const rightRank = escapeMobilityRank(this.ourActions[right]);
      const robDiff = o.robustLower[left] - o.robustLower[right];
      if (leftRank !== rightRank) {
        if (leftRank > rightRank) return robDiff >= -ESCAPE_ROBUST_SLACK;
        return robDiff > ESCAPE_ROBUST_SLACK;
      }
      if (Math.abs(robDiff) <= ESCAPE_ROBUST_SLACK) {
        if (o.escapeSuccessorReady) {
          if (o.escapeSuccessorSlack[left] !== o.escapeSuccessorSlack[right])
            return o.escapeSuccessorSlack[left] > o.escapeSuccessorSlack[right];
          if (o.escapeSuccessorBranches[left] !== o.escapeSuccessorBranches[right])
            return o.escapeSuccessorBranches[left] > o.escapeSuccessorBranches[right];
        }
        if (o.expectedValue[left] !== o.expectedValue[right])
          return o.expectedValue[left] > o.expectedValue[right];
        if (o.tacticalValue[left] !== o.tacticalValue[right])
          return o.tacticalValue[left] > o.tacticalValue[right];
        return left < right;
      }
    }
    if (o.robustLower[left] !== o.robustLower[right]) return o.robustLower[left] > o.robustLower[right];
    if (deathPressure(o, left) || deathPressure(o, right)) {
      if (o.expectedValue[left] !== o.expectedValue[right])
        return o.expectedValue[left] > o.expectedValue[right];
      return left < right;
    }
    if (o.expectedValue[left] !== o.expectedValue[right])
      return o.expectedValue[left] > o.expectedValue[right];
    if (o.tacticalValue[left] !== o.tacticalValue[right])
      return o.tacticalValue[left] > o.tacticalValue[right];
    return left < right;
  }
  emergencyRiskLess(left, right) {
    if (right < 0) return 1; const o = this.outcome;
    // The gate has already declared every row outside the configured risk
    // budget. Preserve causal evidence order, then use the recursive robust
    // backup that already owns future EnemyAction risk. Comparing the combined
    // horizon again here would count future FIRE twice.
    if (o.committedFatalMass[left] !== o.committedFatalMass[right])
      return o.committedFatalMass[left] < o.committedFatalMass[right];
    if (o.possibleProjectileFatalMass[left] !== o.possibleProjectileFatalMass[right])
      return this.lexicographicRiskLess(left, right);
    // With no tracked projectile support, the legacy risk tuple remains the
    // conservative fallback. The causal override exists specifically for the
    // case where an already possible projectile is tied and an approximate
    // future-FIRE envelope would otherwise hide the Minimax escape value.
    if (o.possibleProjectileFatalMass[left] === 0)
      return this.lexicographicRiskLess(left, right);
    const sameCriticalRisk = o.unknownMass[left] === o.unknownMass[right] &&
      o.earliestFatalFrame[left] === o.earliestFatalFrame[right] &&
      o.escapeSlack[left] === o.escapeSlack[right];
    if (sameCriticalRisk && o.robustLower[left] > o.robustLower[right] &&
        o.expectedValue[left] >= o.expectedValue[right] + MATERIAL_EXPECTED_GAIN) return 1;
    if (sameCriticalRisk && o.robustLower[right] > o.robustLower[left] &&
        o.expectedValue[right] >= o.expectedValue[left] + MATERIAL_EXPECTED_GAIN) return 0;
    return this.lexicographicRiskLess(left, right);
  }
  select(seed, policyProbability = null) {
    const o = this.outcome; let fallback = -1; let total = 0;
    for (let row = 0; row < o.count; row += 1) {
      const hardAllowed = o.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
        o.hard[row] !== HARD_STATUS.REJECT_POLICY;
      if (hardAllowed && (this.acceptableCount === 0 ?
        this.emergencyRiskLess(row, fallback) : this.lexicographicRiskLess(row, fallback)))
        fallback = row;
      if (o.acceptable[row] && !o.dominated[row] && o.robustLower[row] >= this.safeFloor)
        total += policyProbability ? policyProbability[row] : 0;
    }
    if (this.acceptableCount === 0) {
      this.lastSelected = fallback; return fallback;
    }
    if (total > 0) {
      let target = (seed >>> 0) % total;
      for (let row = 0; row < o.count; row += 1)
        if (o.acceptable[row] && !o.dominated[row] && o.robustLower[row] >= this.safeFloor) {
          const weight = policyProbability[row]; if (target < weight) {
            this.lastSelected = row; return row; } target -= weight;
        }
    }
    let best = -1;
    for (let row = 0; row < o.count; row += 1)
      if (o.acceptable[row] && !o.dominated[row] && o.robustLower[row] >= this.safeFloor &&
          (best < 0 || this.lexicographicRiskLess(row, best))) best = row;
    this.lastSelected = best; return best;
  }
}

module.exports = { NO_ACCEPTABLE_ACTION, MATERIAL_EXPECTED_GAIN,
  ActionOutcomeSlab, RiskAcceptanceController };
