"use strict";

const { ACTION, NONE_CELL } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { PLAN_KIND, PLAN_PURPOSE, NONE_HANDLE } = require("../abi/policy-codes");

const RESPONSE_OPTION_KIND = Object.freeze({ NONE: 0, STAR: 1, CONTACT: 2 });
const RESPONSE_OPTION_REASON = Object.freeze({ NONE: 0, CONTINUE_STAR: 1,
  CONTINUE_CONTACT: 2, TARGET_GONE: 3, DEADLINE: 4, COMMITTED_OVERRIDE: 5,
  NO_VIABLE_RESPONSE: 6, VERIFIED_ATTACK: 7 });

function isNavigationAction(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT;
}

function isSkillAction(action) {
  return action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST;
}

// Stores an objective, not a fixed action sequence. Every next action is
// regenerated from the current Hard/Risk frontier.
class ResponseOptionController {
  constructor() {
    this.enabled = 0; this.active = 0; this.kind = RESPONSE_OPTION_KIND.NONE;
    this.targetCell = NONE_CELL; this.deadline = 0xffff; this.startedFrame = 0xffff;
    this.lastFrame = 0xffff; this.lastReason = RESPONSE_OPTION_REASON.NONE;
    this.lastProposal = -1; this.captureCount = 0; this.evaluationCount = 0;
    this.proposalCount = 0; this.overrideCount = 0; this.skillOverrideCount = 0;
    this.turnOverrideCount = 0; this.goOverrideCount = 0; this.attackYieldCount = 0;
    this.committedYieldCount = 0; this.expireCount = 0; this.targetGoneCount = 0;
    this.noResponseCount = 0; this.hotAllocationCount = 0;
  }
  configure(enabled) { this.enabled = enabled ? 1 : 0; return this; }
  resetMatch() {
    this.active = 0; this.kind = RESPONSE_OPTION_KIND.NONE;
    this.targetCell = NONE_CELL; this.deadline = 0xffff;
    this.startedFrame = 0xffff; this.lastFrame = 0xffff;
    this.lastReason = RESPONSE_OPTION_REASON.NONE; this.lastProposal = -1;
  }
  cancel(reason) {
    this.active = 0; this.kind = RESPONSE_OPTION_KIND.NONE;
    this.targetCell = NONE_CELL; this.deadline = 0xffff; this.lastReason = reason;
  }
  purposeKind(purpose) {
    if (purpose === PLAN_PURPOSE.STAR_COLLECT || purpose === PLAN_PURPOSE.COMEBACK ||
        purpose === PLAN_PURPOSE.PRESERVE) return RESPONSE_OPTION_KIND.STAR;
    if (purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.INTERCEPT ||
        purpose === PLAN_PURPOSE.ESCAPE_FORCING || purpose === PLAN_PURPOSE.SHIELD_BREAK)
      return RESPONSE_OPTION_KIND.CONTACT;
    // REPOSITION has no target identity. Treating it as "approach enemy"
    // caused one local pose to own unrelated maps and star streams.
    return RESPONSE_OPTION_KIND.NONE;
  }
  targetFor(kind, state) {
    const a = state.arrays;
    return kind === RESPONSE_OPTION_KIND.STAR ? a[ARRAY.SCALAR][SCALAR.STAR_CELL] :
      a[ARRAY.TANK_CELL][1];
  }
  distance(state, left, right) {
    if (left === NONE_CELL || right === NONE_CELL) return 0x7fff;
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }
  alignment(state, cell, direction, target) {
    if (cell === NONE_CELL || target === NONE_CELL) return 0;
    const dx = state.x(target) - state.x(cell), dy = state.y(target) - state.y(cell);
    if (!dx && !dy) return 2;
    return direction === 0 && dy < 0 || direction === 1 && dx > 0 ||
      direction === 2 && dy > 0 || direction === 3 && dx < 0 ? 1 : 0;
  }
  eligible(outcome, envelope, row) {
    return outcome.acceptable[row] && !outcome.dominated[row] &&
      (!envelope || !envelope.refuted(row));
  }
  verifiedAttack(actions, outcome, row) {
    return row >= 0 && actions[row] === ACTION.FIRE &&
      outcome.purposeCompleteness[row] >= 4500 && outcome.postFireEscape[row] &&
      outcome.ownCounterExposure[row] < 10000;
  }
  rowKind(handles, sketches, row) {
    const handle = handles[row];
    if (handle === NONE_HANDLE || handle >= sketches.used ||
        sketches.kind[handle] !== PLAN_KIND.NAVIGATION) return RESPONSE_OPTION_KIND.NONE;
    return this.purposeKind(sketches.purpose[handle]);
  }
  rowProgress(state, projectedCell, row, target, rootDistance) {
    return rootDistance - this.distance(state, projectedCell[row], target);
  }
  rowRaw(handles, sketches, row) {
    const handle = handles[row];
    return handle === NONE_HANDLE || handle >= sketches.used ? 0 : sketches.rawScore[handle];
  }
  qualified(state, projectedCell, projectedDirection, handles, sketches, row,
      target, rootDistance, targetKind) {
    return this.rowKind(handles, sketches, row) === targetKind &&
      (this.rowProgress(state, projectedCell, row, target, rootDistance) > 0 ||
       this.alignment(state, projectedCell[row], projectedDirection[row], target) > 0 ||
       this.rowRaw(handles, sketches, row) > 0);
  }
  better(state, outcome, projectedCell, projectedDirection, handles, sketches,
      left, right, target, rootDistance, targetKind) {
    if (right < 0) return 1;
    const leftKind = this.rowKind(handles, sketches, left) === targetKind ? 1 : 0;
    const rightKind = this.rowKind(handles, sketches, right) === targetKind ? 1 : 0;
    if (leftKind !== rightKind) return leftKind > rightKind;
    const leftProgress = this.rowProgress(state, projectedCell, left, target, rootDistance);
    const rightProgress = this.rowProgress(state, projectedCell, right, target, rootDistance);
    if (leftProgress !== rightProgress) return leftProgress > rightProgress;
    const leftAlignment = this.alignment(state, projectedCell[left],
      projectedDirection[left], target);
    const rightAlignment = this.alignment(state, projectedCell[right],
      projectedDirection[right], target);
    if (leftAlignment !== rightAlignment) return leftAlignment > rightAlignment;
    const leftRaw = this.rowRaw(handles, sketches, left);
    const rightRaw = this.rowRaw(handles, sketches, right);
    if (leftRaw !== rightRaw) return leftRaw > rightRaw;
    if (outcome.horizonFatalMass[left] !== outcome.horizonFatalMass[right])
      return outcome.horizonFatalMass[left] < outcome.horizonFatalMass[right];
    if (outcome.unknownMass[left] !== outcome.unknownMass[right])
      return outcome.unknownMass[left] < outcome.unknownMass[right];
    if (outcome.robustLower[left] !== outcome.robustLower[right])
      return outcome.robustLower[left] > outcome.robustLower[right];
    return left < right;
  }
  select(preferred, committedOwns, controller, actions, projectedCell,
      projectedDirection, handles, sketches, envelope, state) {
    this.lastProposal = -1;
    if (!this.enabled || !this.active || preferred < 0) return preferred;
    this.evaluationCount += 1;
    if (committedOwns) {
      this.committedYieldCount += 1;
      this.lastReason = RESPONSE_OPTION_REASON.COMMITTED_OVERRIDE; return preferred;
    }
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame > this.deadline) {
      this.expireCount += 1; this.cancel(RESPONSE_OPTION_REASON.DEADLINE); return preferred;
    }
    const target = this.targetFor(this.kind, state);
    if (target === NONE_CELL || this.kind === RESPONSE_OPTION_KIND.STAR &&
        target !== this.targetCell) {
      this.targetGoneCount += 1; this.cancel(RESPONSE_OPTION_REASON.TARGET_GONE);
      return preferred;
    }
    if (this.kind === RESPONSE_OPTION_KIND.CONTACT) this.targetCell = target;
    const outcome = controller.outcome;
    if (this.verifiedAttack(actions, outcome, preferred)) {
      this.attackYieldCount += 1; this.lastReason = RESPONSE_OPTION_REASON.VERIFIED_ATTACK;
      return preferred;
    }
    if (actions[preferred] === ACTION.FIRE || actions[preferred] === ACTION.THROW_BOMB)
      return preferred;
    const rootDistance = this.distance(state, state.arrays[ARRAY.TANK_CELL][0], target);
    let best = -1;
    for (let row = 0; row < outcome.count; row += 1) {
      if (!isNavigationAction(actions[row]) || !this.eligible(outcome, envelope, row)) continue;
      if (!this.qualified(state, projectedCell, projectedDirection, handles,
          sketches, row, target, rootDistance, this.kind)) continue;
      if (this.better(state, outcome, projectedCell, projectedDirection, handles,
          sketches, row, best, target, rootDistance, this.kind)) best = row;
    }
    if (best < 0) {
      this.noResponseCount += 1; this.lastReason = RESPONSE_OPTION_REASON.NO_VIABLE_RESPONSE;
      return preferred;
    }
    if (isNavigationAction(actions[preferred]) && this.eligible(outcome, envelope, preferred) &&
        this.qualified(state, projectedCell, projectedDirection, handles, sketches,
          preferred, target, rootDistance, this.kind) &&
        !this.better(state, outcome, projectedCell, projectedDirection, handles,
          sketches, best, preferred, target, rootDistance, this.kind)) return preferred;
    if (best === preferred) return preferred;
    this.lastProposal = best; this.proposalCount += 1; this.overrideCount += 1;
    if (isSkillAction(actions[preferred])) this.skillOverrideCount += 1;
    else if (actions[preferred] === ACTION.GO) this.goOverrideCount += 1;
    else if (actions[preferred] === ACTION.TURN_LEFT ||
        actions[preferred] === ACTION.TURN_RIGHT) this.turnOverrideCount += 1;
    this.lastReason = this.kind === RESPONSE_OPTION_KIND.STAR ?
      RESPONSE_OPTION_REASON.CONTINUE_STAR : RESPONSE_OPTION_REASON.CONTINUE_CONTACT;
    return best;
  }
  observeSelection(selected, committedOwns, actions, handles, sketches, state) {
    if (!this.enabled || selected < 0) return;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME]; this.lastFrame = frame;
    if (committedOwns || !isNavigationAction(actions[selected])) return;
    const handle = handles[selected];
    if (handle === NONE_HANDLE || handle >= sketches.used ||
        sketches.kind[handle] !== PLAN_KIND.NAVIGATION) return;
    const kind = this.purposeKind(sketches.purpose[handle]);
    if (kind === RESPONSE_OPTION_KIND.NONE) return;
    const target = this.targetFor(kind, state); if (target === NONE_CELL) return;
    const wasActive = this.active, previousKind = this.kind;
    this.active = 1; this.kind = kind; this.targetCell = target;
    this.deadline = Math.min(sketches.deadline[handle], frame + 8);
    if (!wasActive || previousKind !== kind) this.startedFrame = frame;
    this.captureCount += 1;
  }
  summary() {
    return { enabled: Boolean(this.enabled), active: Boolean(this.active), kind: this.kind,
      targetCell: this.targetCell, deadline: this.deadline, lastReason: this.lastReason,
      lastProposal: this.lastProposal, captureCount: this.captureCount,
      evaluationCount: this.evaluationCount, proposalCount: this.proposalCount,
      overrideCount: this.overrideCount, skillOverrideCount: this.skillOverrideCount,
      turnOverrideCount: this.turnOverrideCount, goOverrideCount: this.goOverrideCount,
      attackYieldCount: this.attackYieldCount, committedYieldCount: this.committedYieldCount,
      expireCount: this.expireCount, targetGoneCount: this.targetGoneCount,
      noResponseCount: this.noResponseCount, hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { RESPONSE_OPTION_KIND, RESPONSE_OPTION_REASON,
  isNavigationAction, isSkillAction, ResponseOptionController };
