"use strict";

const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, NONE_CELL } = require("../abi/fast-codes");
const { ROOT_CONTROL_MODE } = require("../runtime/root-control-mode");

const OBJECTIVE_PROFILE = Object.freeze({ ATTACK_FIRST: 1, STAR_FIRST: 2 });
const OBJECTIVE_REASON = Object.freeze({ NONE: 0, ATTACK_APPROACH: 1,
  STAR_PROGRESS: 2, FALLBACK: 3 });

// Non-contact objective owner.  It does not score arbitrary primitives.  It
// asks whether a legal Risk-frontier movement makes strict progress toward a
// concrete target, then returns the corresponding primitive row.  All data is
// read from existing root slabs; the hot path allocates nothing.
class ObjectiveOptionRouter {
  constructor(profile = OBJECTIVE_PROFILE.ATTACK_FIRST) {
    this.profile = profile;
    this.selectCount = 0; this.attackCount = 0; this.starCount = 0;
    this.fallbackCount = 0; this.noProgressCount = 0; this.lastReason = 0;
    this.lastSelected = -1; this.hotAllocationCount = 0;
  }

  eligible(root, row) {
    const outcome = root.riskController.outcome;
    return outcome.acceptable[row] && !outcome.dominated[row] &&
      (root.ourActions[row] === ACTION.GO ||
       root.ourActions[row] === ACTION.TURN_LEFT ||
       root.ourActions[row] === ACTION.TURN_RIGHT);
  }

  approachDirection(state, from, to) {
    const dx = state.x(to) - state.x(from); const dy = state.y(to) - state.y(from);
    if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 1 : 3;
    if (dy) return dy > 0 ? 2 : 0;
    return -1;
  }

  attackTier(root, cell, direction, enemy) {
    const line = root.clearLine(cell, enemy);
    if (line && root.directionTo(cell, enemy) === direction) return 4;
    if (line) return 3;
    return this.approachDirection(root.adapter.state, cell, enemy) === direction ? 1 : 0;
  }

  attackBetter(root, left, right, enemy, originalDistance) {
    if (right < 0) return 1;
    const leftCell = root.projectedCell[left]; const rightCell = root.projectedCell[right];
    const leftTier = this.attackTier(root, leftCell, root.projectedDirection[left], enemy);
    const rightTier = this.attackTier(root, rightCell, root.projectedDirection[right], enemy);
    if (leftTier !== rightTier) return leftTier > rightTier;
    const leftDistance = root.manhattan(leftCell, enemy);
    const rightDistance = root.manhattan(rightCell, enemy);
    if (leftDistance !== rightDistance) return leftDistance < rightDistance;
    const outcome = root.riskController.outcome;
    if (root.riskController.lexicographicRiskLess(left, right)) return 1;
    if (root.riskController.lexicographicRiskLess(right, left)) return 0;
    if (outcome.escapeSlack[left] !== outcome.escapeSlack[right])
      return outcome.escapeSlack[left] > outcome.escapeSlack[right];
    // Avoid a no-effect GO when a turn has the same target progress.
    const own = root.adapter.state.arrays[ARRAY.TANK_CELL][0];
    const leftMoves = root.ourActions[left] !== ACTION.GO || leftCell !== own;
    const rightMoves = root.ourActions[right] !== ACTION.GO || rightCell !== own;
    if (leftMoves !== rightMoves) return leftMoves;
    return left < right;
  }

  bestAttack(root, count) {
    if (!root.adapter.enemyVisible) return -1;
    const a = root.adapter.state.arrays; const own = a[ARRAY.TANK_CELL][0];
    const enemy = a[ARRAY.TANK_CELL][1]; const originalDistance = root.manhattan(own, enemy);
    let best = -1;
    for (let row = 0; row < count; row += 1) {
      if (!this.eligible(root, row)) continue;
      const cell = root.projectedCell[row]; const direction = root.projectedDirection[row];
      const tier = this.attackTier(root, cell, direction, enemy);
      const distance = root.manhattan(cell, enemy);
      if (!tier && distance >= originalDistance) continue;
      if (this.attackBetter(root, row, best, enemy, originalDistance)) best = row;
    }
    return best;
  }

  starBetter(root, left, right) {
    if (right < 0) return 1;
    const leftDistance = root.starDistance(root.projectedCell[left]);
    const rightDistance = root.starDistance(root.projectedCell[right]);
    if (leftDistance !== rightDistance) return leftDistance < rightDistance;
    const leftHelpful = root.starDirectionHelpful(root.projectedCell[left],
      root.projectedDirection[left]);
    const rightHelpful = root.starDirectionHelpful(root.projectedCell[right],
      root.projectedDirection[right]);
    if (leftHelpful !== rightHelpful) return leftHelpful > rightHelpful;
    if (root.riskController.lexicographicRiskLess(left, right)) return 1;
    if (root.riskController.lexicographicRiskLess(right, left)) return 0;
    return left < right;
  }

  bestStar(root, count) {
    const star = root.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return -1;
    let best = -1;
    for (let row = 0; row < count; row += 1)
      if (this.eligible(root, row) && root.strategyBands.starPurpose[row] &&
          this.starBetter(root, row, best)) best = row;
    return best;
  }

  select(root, preferred, count) {
    this.selectCount += 1; this.lastSelected = preferred;
    if (root.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION) {
      this.fallbackCount += 1; this.lastReason = OBJECTIVE_REASON.FALLBACK;
      return preferred;
    }
    const attack = this.bestAttack(root, count); const star = this.bestStar(root, count);
    const selected = this.profile === OBJECTIVE_PROFILE.STAR_FIRST ?
      (star >= 0 ? star : attack) : (attack >= 0 ? attack : star);
    if (selected < 0) {
      this.noProgressCount += 1; this.lastReason = OBJECTIVE_REASON.FALLBACK;
      return preferred;
    }
    this.lastSelected = selected;
    if (selected === attack) {
      this.attackCount += 1; this.lastReason = OBJECTIVE_REASON.ATTACK_APPROACH;
    } else {
      this.starCount += 1; this.lastReason = OBJECTIVE_REASON.STAR_PROGRESS;
    }
    return selected;
  }

  summary() { return { profile: this.profile, selectCount: this.selectCount,
    attackCount: this.attackCount, starCount: this.starCount,
    fallbackCount: this.fallbackCount, noProgressCount: this.noProgressCount,
    lastReason: this.lastReason, lastSelected: this.lastSelected,
    hotAllocationCount: this.hotAllocationCount }; }
}

module.exports = { OBJECTIVE_PROFILE, OBJECTIVE_REASON, ObjectiveOptionRouter };
