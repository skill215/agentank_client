"use strict";

const { ACTION, HARD_STATUS } = require("../abi/fast-codes");
const { COMBAT_PURPOSE, NONE_HANDLE } = require("../abi/policy-codes");

const INITIATIVE_REASON = Object.freeze({
  NONE: 0,
  COMMITTED_ESCAPE: 1,
  VERIFIED_DIRECT_FIRE: 2,
  VERIFIED_INTERCEPT_FIRE: 3,
  TACTICAL_VALUE: 4,
  STRATEGIC_PROGRESS: 5,
  RISK_FALLBACK: 6,
  STABILITY_GO: 7
});

const DIRECT_FIRE_PURPOSE = COMBAT_PURPOSE.DIRECT_KILL |
  COMBAT_PURPOSE.SHIELD_BREAK;
const INTERCEPT_FIRE_PURPOSE = COMBAT_PURPOSE.INTERCEPT |
  COMBAT_PURPOSE.ESCAPE_DENIAL;

// This arbiter changes only root ownership. Hard, Risk, committed escape,
// Proof, search and StageMatrix keep producing the same evidence slabs.
// It deliberately mirrors the successful staged shape of V1 without loading
// or executing any V1 implementation.
class NativeInitiativeArbiter {
  constructor() {
    this.selectCount = 0;
    this.escapeCount = 0;
    this.directFireCount = 0;
    this.interceptFireCount = 0;
    this.tacticalCount = 0;
    this.navigationCount = 0;
    this.stabilityGoCount = 0;
    this.riskFallbackCount = 0;
    this.bombSuppressedCount = 0;
    this.lastReason = INITIATIVE_REASON.NONE;
    this.lastSelected = -1;
    this.hotAllocationCount = 0;
  }

  eligible(outcome, envelope, row) {
    return outcome.acceptable[row] && !outcome.dominated[row] &&
      (!envelope || !envelope.refuted(row));
  }

  valueBetter(outcome, left, right) {
    if (right < 0) return 1;
    if (outcome.robustLower[left] !== outcome.robustLower[right])
      return outcome.robustLower[left] > outcome.robustLower[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    if (outcome.purposeCompleteness[left] !== outcome.purposeCompleteness[right])
      return outcome.purposeCompleteness[left] > outcome.purposeCompleteness[right];
    if (outcome.searchEstimateEnabled &&
        outcome.searchEstimate[left] !== outcome.searchEstimate[right])
      return outcome.searchEstimate[left] > outcome.searchEstimate[right];
    return left < right;
  }

  fireBetter(outcome, attack, left, right) {
    if (right < 0) return 1;
    const leftDirect = outcome.combatPurpose[left] & DIRECT_FIRE_PURPOSE ? 1 : 0;
    const rightDirect = outcome.combatPurpose[right] & DIRECT_FIRE_PURPOSE ? 1 : 0;
    if (leftDirect !== rightDirect) return leftDirect > rightDirect;
    if (attack.doomedEnemyColumns[left] !== attack.doomedEnemyColumns[right])
      return attack.doomedEnemyColumns[left] > attack.doomedEnemyColumns[right];
    if (outcome.hitDeadline[left] !== outcome.hitDeadline[right])
      return outcome.hitDeadline[left] < outcome.hitDeadline[right];
    if (outcome.enemySafeSuccessors[left] !== outcome.enemySafeSuccessors[right])
      return outcome.enemySafeSuccessors[left] < outcome.enemySafeSuccessors[right];
    if (outcome.ownCounterExposure[left] !== outcome.ownCounterExposure[right])
      return outcome.ownCounterExposure[left] < outcome.ownCounterExposure[right];
    return this.valueBetter(outcome, left, right);
  }

  verifiedFire(actions, outcome, attack, row, allowIntercept) {
    if (actions[row] !== ACTION.FIRE || outcome.postFireEscape[row] === 0 ||
        outcome.ownCounterExposure[row] >= 10000 ||
        outcome.purposeCompleteness[row] < 4500) return 0;
    if (outcome.combatPurpose[row] & DIRECT_FIRE_PURPOSE) return 2;
    if (!allowIntercept || !(outcome.combatPurpose[row] & INTERCEPT_FIRE_PURPOSE))
      return 0;
    // A possible-hit ray remains soft, but it may own initiative when the
    // complete attack closure removes an enemy first action. It never becomes
    // Hard or strict Proof.
    return 1;
  }

  bestVerifiedFire(actions, controller, envelope, attack, allowIntercept) {
    const outcome = controller.outcome;
    let best = -1;
    for (let row = 0; row < outcome.count; row += 1) {
      if (!this.eligible(outcome, envelope, row) ||
          !this.verifiedFire(actions, outcome, attack, row, allowIntercept))
        continue;
      if (this.fireBetter(outcome, attack, row, best)) best = row;
    }
    return best;
  }

  tacticalAllowed(actions, outcome, attack, row) {
    const action = actions[row];
    if (action === ACTION.FIRE)
      return this.verifiedFire(actions, outcome, attack, row, 1) ? 1 : 0;
    if (action !== ACTION.THROW_BOMB) return 1;
    // Zone denial currently has no post-bomb escape certificate. Keep its
    // tactical evidence, but do not let it own the root until that contract
    // exists.
    this.bombSuppressedCount += 1;
    return 0;
  }

  bestTactical(actions, controller, envelope, attack) {
    const outcome = controller.outcome;
    let best = -1;
    for (let row = 0; row < outcome.count; row += 1)
      if (this.eligible(outcome, envelope, row) &&
          this.tacticalAllowed(actions, outcome, attack, row) &&
          this.valueBetter(outcome, row, best)) best = row;
    return best;
  }

  progress(sketches, handles, row) {
    const handle = handles[row];
    return handle === NONE_HANDLE ? 0 : sketches.rawScore[handle];
  }

  deadline(sketches, handles, row) {
    const handle = handles[row];
    return handle === NONE_HANDLE ? 0xffff : sketches.deadline[handle];
  }

  actionPriority(action, moves = 1) {
    if (action === ACTION.GO && !moves) return 6;
    if (action === ACTION.GO) return 0;
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) return 1;
    if (action === ACTION.FIRE) return 2;
    if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) return 3;
    if (action === ACTION.THROW_BOMB) return 4;
    return 5;
  }

  navigationBetter(actions, projectedCell, ownCell, outcome, sketches, handles,
      left, right) {
    if (right < 0) return 1;
    const leftProgress = this.progress(sketches, handles, left);
    const rightProgress = this.progress(sketches, handles, right);
    if (leftProgress !== rightProgress) return leftProgress > rightProgress;
    if (outcome.unknownMass[left] !== outcome.unknownMass[right])
      return outcome.unknownMass[left] < outcome.unknownMass[right];
    if (outcome.horizonFatalMass[left] !== outcome.horizonFatalMass[right])
      return outcome.horizonFatalMass[left] < outcome.horizonFatalMass[right];
    const leftPriority = this.actionPriority(actions[left],
      actions[left] !== ACTION.GO || !projectedCell ||
        projectedCell[left] !== ownCell);
    const rightPriority = this.actionPriority(actions[right],
      actions[right] !== ACTION.GO || !projectedCell ||
        projectedCell[right] !== ownCell);
    if (leftPriority !== rightPriority) return leftPriority < rightPriority;
    const leftDeadline = this.deadline(sketches, handles, left);
    const rightDeadline = this.deadline(sketches, handles, right);
    if (leftDeadline !== rightDeadline) return leftDeadline < rightDeadline;
    return this.valueBetter(outcome, left, right);
  }

  bestNavigation(actions, projectedCell, ownCell, controller, envelope, handles,
      sketches) {
    const outcome = controller.outcome;
    let best = -1;
    for (let row = 0; row < outcome.count; row += 1) {
      const action = actions[row];
      if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
          action !== ACTION.TURN_RIGHT) continue;
      if (action === ACTION.GO && projectedCell &&
          projectedCell[row] === ownCell) continue;
      if (this.eligible(outcome, envelope, row) &&
          this.navigationBetter(actions, projectedCell, ownCell, outcome, sketches,
            handles, row, best))
        best = row;
    }
    return best;
  }

  riskDimensionBetter(outcome, left, right) {
    if (right < 0) return 1;
    if (outcome.immediateFatalMass[left] !== outcome.immediateFatalMass[right])
      return outcome.immediateFatalMass[left] < outcome.immediateFatalMass[right];
    if (outcome.horizonFatalMass[left] !== outcome.horizonFatalMass[right])
      return outcome.horizonFatalMass[left] < outcome.horizonFatalMass[right];
    if (outcome.unknownMass[left] !== outcome.unknownMass[right])
      return outcome.unknownMass[left] < outcome.unknownMass[right];
    if (outcome.earliestFatalFrame[left] !== outcome.earliestFatalFrame[right])
      return outcome.earliestFatalFrame[left] > outcome.earliestFatalFrame[right];
    if (outcome.escapeSlack[left] !== outcome.escapeSlack[right])
      return outcome.escapeSlack[left] > outcome.escapeSlack[right];
    return 0;
  }

  sameRiskTuple(outcome, left, right) {
    return outcome.immediateFatalMass[left] === outcome.immediateFatalMass[right] &&
      outcome.horizonFatalMass[left] === outcome.horizonFatalMass[right] &&
      outcome.unknownMass[left] === outcome.unknownMass[right] &&
      outcome.earliestFatalFrame[left] === outcome.earliestFatalFrame[right] &&
      outcome.escapeSlack[left] === outcome.escapeSlack[right];
  }

  fallbackAllowed(mode, actions, outcome, attack, row) {
    const action = actions[row];
    if (action === ACTION.THROW_BOMB) return 0;
    if (action !== ACTION.FIRE) return 1;
    return this.verifiedFire(actions, outcome, attack, row, mode === 2) ? 1 : 0;
  }

  minimumRiskFallback(mode, actions, projectedCell, ownCell, controller, attack) {
    const outcome = controller.outcome;
    let minimum = -1;
    for (let row = 0; row < outcome.count; row += 1) {
      if (outcome.hard[row] === HARD_STATUS.REJECT_PROVEN ||
          outcome.hard[row] === HARD_STATUS.REJECT_POLICY) continue;
      if (this.riskDimensionBetter(outcome, row, minimum)) minimum = row;
    }
    if (minimum < 0) return -1;
    let best = -1;
    for (let row = 0; row < outcome.count; row += 1)
      if (outcome.hard[row] !== HARD_STATUS.REJECT_PROVEN &&
          outcome.hard[row] !== HARD_STATUS.REJECT_POLICY &&
          this.sameRiskTuple(outcome, row, minimum) &&
          this.fallbackAllowed(mode, actions, outcome, attack, row)) {
        if (best < 0) { best = row; continue; }
        const priority = this.actionPriority(actions[row],
          actions[row] !== ACTION.GO || !projectedCell ||
            projectedCell[row] !== ownCell);
        const bestPriority = this.actionPriority(actions[best],
          actions[best] !== ACTION.GO || !projectedCell ||
            projectedCell[best] !== ownCell);
        if (priority < bestPriority ||
            (priority === bestPriority && this.valueBetter(outcome, row, best)))
          best = row;
      }
    // Never trade a strictly safer tuple merely to suppress an action type.
    return best >= 0 ? best : minimum;
  }

  select(mode, strategicArbiter, controller, actions, envelope, attack,
      handles, sketches, seed, turnStreak = 0, projectedCell = null,
      ownCell = -1) {
    this.selectCount += 1;
    const outcome = controller.outcome;
    let selected = -1;
    if (mode === 1) {
      selected = strategicArbiter.selectEscape(controller, null, envelope);
      if (selected >= 0) {
        this.escapeCount += 1;
        this.lastReason = INITIATIVE_REASON.COMMITTED_ESCAPE;
        this.lastSelected = selected;
        return selected;
      }
    }

    selected = this.bestVerifiedFire(actions, controller, envelope, attack,
      mode === 2);
    if (selected >= 0) {
      const direct = outcome.combatPurpose[selected] & DIRECT_FIRE_PURPOSE;
      if (direct) {
        this.directFireCount += 1;
        this.lastReason = INITIATIVE_REASON.VERIFIED_DIRECT_FIRE;
      } else {
        this.interceptFireCount += 1;
        this.lastReason = INITIATIVE_REASON.VERIFIED_INTERCEPT_FIRE;
      }
      this.lastSelected = selected;
      return selected;
    }

    if (turnStreak >= 3) {
      for (let row = 0; row < outcome.count; row += 1)
        if (actions[row] === ACTION.GO &&
            (!projectedCell || projectedCell[row] !== ownCell) &&
            this.eligible(outcome, envelope, row)) {
          this.stabilityGoCount += 1;
          this.lastReason = INITIATIVE_REASON.STABILITY_GO;
          this.lastSelected = row;
          return row;
        }
    }

    if (mode === 2) {
      selected = this.bestTactical(actions, controller, envelope, attack);
      if (selected >= 0) {
        this.tacticalCount += 1;
        this.lastReason = INITIATIVE_REASON.TACTICAL_VALUE;
        this.lastSelected = selected;
        return selected;
      }
    } else {
      selected = this.bestNavigation(actions, projectedCell, ownCell, controller,
        envelope, handles, sketches);
      if (selected >= 0) {
        this.navigationCount += 1;
        this.lastReason = INITIATIVE_REASON.STRATEGIC_PROGRESS;
        this.lastSelected = selected;
        return selected;
      }
    }

    selected = this.minimumRiskFallback(mode, actions, projectedCell, ownCell,
      controller, attack);
    if (selected < 0) selected = controller.select(seed, null, null);
    this.riskFallbackCount += 1;
    this.lastReason = INITIATIVE_REASON.RISK_FALLBACK;
    this.lastSelected = selected;
    return selected;
  }

  summary() {
    return {
      selectCount: this.selectCount,
      escapeCount: this.escapeCount,
      directFireCount: this.directFireCount,
      interceptFireCount: this.interceptFireCount,
      tacticalCount: this.tacticalCount,
      navigationCount: this.navigationCount,
      stabilityGoCount: this.stabilityGoCount,
      riskFallbackCount: this.riskFallbackCount,
      bombSuppressedCount: this.bombSuppressedCount,
      lastReason: this.lastReason,
      lastSelected: this.lastSelected,
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { INITIATIVE_REASON, NativeInitiativeArbiter };
