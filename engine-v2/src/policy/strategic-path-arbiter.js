"use strict";

const { ACTION, HARD_STATUS, NONE_CELL } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ROOT_CONTROL_MODE } = require("../runtime/root-control-mode");

// Non-contact objective owner. It deliberately consumes only physical path
// progress and Risk eligibility. Combat/Plan/search scores cannot rewrite the
// meaning of a move toward the current star.
class StrategicPathArbiter {
  constructor(verifyProposal = 0) {
    this.verifyProposal = verifyProposal ? 1 : 0;
    this.selectCount = 0; this.proposalCount = 0; this.overrideCount = 0;
    this.noStarCount = 0; this.noProgressCount = 0; this.hotAllocationCount = 0;
    this.verificationRejectCount = 0;
    this.lastProposal = -1;
  }
  notWorseThanCurrent(engine, proposal, selected) {
    if (!this.verifyProposal || selected < 0 || selected >= engine.riskController.outcome.count)
      return 1;
    const o = engine.riskController.outcome;
    if (o.committedFatalMass[proposal] > o.committedFatalMass[selected] ||
        o.immediateFatalMass[proposal] > o.immediateFatalMass[selected] ||
        o.horizonFatalMass[proposal] > o.horizonFatalMass[selected] ||
        o.unknownMass[proposal] > o.unknownMass[selected] ||
        o.escapeSlack[proposal] < o.escapeSlack[selected] ||
        o.robustLower[proposal] < o.robustLower[selected] - 800 ||
        o.expectedValue[proposal] < o.expectedValue[selected] - 1200) return 0;
    return 1;
  }
  eligible(engine, row) {
    const outcome = engine.riskController.outcome;
    return engine.hardStatus[row] === HARD_STATUS.ALLOW &&
      outcome.acceptable[row] && !outcome.dominated[row];
  }
  progressClass(engine, row, ownCell, currentDistance) {
    const action = engine.ourActions[row]; const cell = engine.projectedCell[row];
    if (action === ACTION.GO) {
      if (cell === ownCell) return 0;
      return engine.starDistance(cell) < currentDistance ? 3 : 0;
    }
    if (action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT)
      return engine.starDirectionHelpful(cell, engine.projectedDirection[row]) ? 2 : 0;
    return 0;
  }
  riskBetter(outcome, left, right) {
    if (right < 0) return 1;
    if (outcome.immediateFatalMass[left] !== outcome.immediateFatalMass[right])
      return outcome.immediateFatalMass[left] < outcome.immediateFatalMass[right];
    if (outcome.horizonFatalMass[left] !== outcome.horizonFatalMass[right])
      return outcome.horizonFatalMass[left] < outcome.horizonFatalMass[right];
    if (outcome.unknownMass[left] !== outcome.unknownMass[right])
      return outcome.unknownMass[left] < outcome.unknownMass[right];
    if (outcome.escapeSlack[left] !== outcome.escapeSlack[right])
      return outcome.escapeSlack[left] > outcome.escapeSlack[right];
    return left < right;
  }
  better(engine, row, best, ownCell, currentDistance) {
    if (best < 0) return 1;
    const leftClass = this.progressClass(engine, row, ownCell, currentDistance);
    const rightClass = this.progressClass(engine, best, ownCell, currentDistance);
    if (leftClass !== rightClass) return leftClass > rightClass;
    const leftDistance = engine.starDistance(engine.projectedCell[row]);
    const rightDistance = engine.starDistance(engine.projectedCell[best]);
    if (leftDistance !== rightDistance) return leftDistance < rightDistance;
    // Avoid oscillating turns only after objective progress ties.
    const leftReverse = (engine.ourActions[row] === ACTION.TURN_LEFT &&
      engine.lastAction === ACTION.TURN_RIGHT) ||
      (engine.ourActions[row] === ACTION.TURN_RIGHT &&
       engine.lastAction === ACTION.TURN_LEFT) ? 1 : 0;
    const rightReverse = (engine.ourActions[best] === ACTION.TURN_LEFT &&
      engine.lastAction === ACTION.TURN_RIGHT) ||
      (engine.ourActions[best] === ACTION.TURN_RIGHT &&
       engine.lastAction === ACTION.TURN_LEFT) ? 1 : 0;
    if (leftReverse !== rightReverse) return leftReverse < rightReverse;
    return this.riskBetter(engine.riskController.outcome, row, best);
  }
  select(engine, selected, count) {
    this.selectCount += 1; this.lastProposal = -1;
    if (engine.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION)
      return selected;
    const state = engine.adapter.state; const a = state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) { this.noStarCount += 1; return selected; }
    const ownCell = a[ARRAY.TANK_CELL][0]; const currentDistance = engine.starDistance(ownCell);
    let best = -1;
    for (let row = 0; row < count; row += 1)
      if (this.eligible(engine, row) &&
          this.progressClass(engine, row, ownCell, currentDistance) > 0 &&
          this.better(engine, row, best, ownCell, currentDistance)) best = row;
    if (best < 0) { this.noProgressCount += 1; return selected; }
    this.proposalCount += 1; this.lastProposal = best;
    if (!this.notWorseThanCurrent(engine, best, selected)) {
      this.verificationRejectCount += 1; return selected;
    }
    if (best !== selected) this.overrideCount += 1;
    return best;
  }
  summary() {
    return { selectCount: this.selectCount, proposalCount: this.proposalCount,
      overrideCount: this.overrideCount, noStarCount: this.noStarCount,
      noProgressCount: this.noProgressCount,
      verificationRejectCount: this.verificationRejectCount,
      lastProposal: this.lastProposal,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { StrategicPathArbiter };
