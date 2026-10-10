"use strict";

const { CAPACITY, RULE } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, TERRAIN, NONE_CELL, NONE_FRAME, DX, DY } =
  require("../../../engine-v2/src/abi/fast-codes");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");
const { SUPPORT_STATUS } = require("../../../engine-v2/src/runtime/escape-obligation");

const NO_COST = 0xffff;
const MAX_POSES = CAPACITY.MAX_CELLS * 4;

class AttackObjectiveFieldProposal {
  constructor(options = {}) {
    this.active = options.active ? 1 : 0;
    this.distance = new Uint16Array(MAX_POSES);
    this.queue = new Uint16Array(MAX_POSES);
    this.cacheEnemy = NONE_CELL;
    this.cacheTopology = 0xffffffff;
    this.cacheWidth = 0;
    this.cacheHeight = 0;
    this.cacheEnemyDirection = 0xff;
    this.cacheEnemyLockDelay = 0xffff;
    this.cacheEnemyCanAct = 0xff;
    this.cacheOwnStars = 0xff;
    this.cacheEnemyStars = 0xff;
    this.cacheOwnShield = 0xff;
    this.cacheEnemyShield = 0xff;
    this.cacheValid = 0;
    this.evaluationCount = 0;
    this.fieldBuildCount = 0;
    this.cacheHitCount = 0;
    this.goalPoseCount = 0;
    this.rejectedGoalPoseCount = 0;
    this.visitedPoseCount = 0;
    this.maximumVisitedPoses = 0;
    this.progressRootCount = 0;
    this.frontierDifferentCount = 0;
    this.noRegressionDifferentCount = 0;
    this.proposalCount = 0;
    this.sameSelectedCount = 0;
    this.overrideCount = 0;
    this.finalRejectCount = 0;
    this.hotAllocationCount = 0;
    this.lastProposal = -1;
    this.lastCurrentCost = NO_COST;
    this.lastProposalCost = NO_COST;
  }

  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  walkable(state, cell, enemy) {
    if (cell === NONE_CELL || cell === enemy) return 0;
    const terrain = state.arrays[ARRAY.TERRAIN][cell];
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT;
  }

  enqueue(pose, cost, tail) {
    if (this.distance[pose] !== NO_COST) return tail;
    this.distance[pose] = cost;
    this.queue[tail] = pose;
    return tail + 1;
  }

  turnDistance(from, to) {
    const clockwise = (to - from) & 3;
    return clockwise <= 2 ? clockwise : 4 - clockwise;
  }

  arrivalFrames(distance) {
    return Math.max(1, Math.floor((distance + RULE.PROJECTILE_STEPS - 1) /
      RULE.PROJECTILE_STEPS));
  }

  favorableGoal(engine, cell, direction, enemy) {
    const state = engine.adapter.state;
    const arrays = state.arrays;
    const enemyAim = engine.directionTo(enemy, cell);
    if (enemyAim < 0) return 0;
    const distance = Math.abs(state.x(cell) - state.x(enemy)) +
      Math.abs(state.y(cell) - state.y(enemy));
    const ownArrival = this.arrivalFrames(distance);
    const enemyDirection = arrays[ARRAY.TANK_DIR][1];
    const turns = this.turnDistance(enemyDirection, enemyAim);
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const lock = arrays[ARRAY.TANK_FIRE_LOCK][1];
    const lockDelay = lock === NONE_FRAME || lock <= frame ? 0 : lock - frame;
    const cadenceDelay = engine.adapter.enemyCanAct ? 0 : 1;
    const enemyArrival = Math.max(turns, lockDelay, cadenceDelay) +
      this.arrivalFrames(distance);
    if (ownArrival < enemyArrival) return 1;
    if (ownArrival > enemyArrival) return 0;
    const ownStars = arrays[ARRAY.TANK_STARS][0];
    const enemyStars = arrays[ARRAY.TANK_STARS][1];
    const ownShield = arrays[ARRAY.TANK_SHIELD_HITS][0];
    const enemyShield = arrays[ARRAY.TANK_SHIELD_HITS][1];
    return enemyShield === 0 && (ownStars > enemyStars || ownShield > 0) ? 1 : 0;
  }

  build(engine) {
    const state = engine.adapter.state;
    const arrays = state.arrays;
    const enemy = arrays[ARRAY.TANK_CELL][1];
    const topology = arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION];
    const enemyDirection = arrays[ARRAY.TANK_DIR][1];
    const frame = arrays[ARRAY.SCALAR][SCALAR.FRAME];
    const fireLock = arrays[ARRAY.TANK_FIRE_LOCK][1];
    const enemyLockDelay = fireLock === NONE_FRAME || fireLock <= frame ?
      0 : Math.min(0xffff, fireLock - frame);
    const enemyCanAct = engine.adapter.enemyCanAct ? 1 : 0;
    const ownStars = arrays[ARRAY.TANK_STARS][0];
    const enemyStars = arrays[ARRAY.TANK_STARS][1];
    const ownShield = arrays[ARRAY.TANK_SHIELD_HITS][0];
    const enemyShield = arrays[ARRAY.TANK_SHIELD_HITS][1];
    if (this.cacheValid && this.cacheEnemy === enemy &&
        this.cacheTopology === topology && this.cacheWidth === state.width &&
        this.cacheHeight === state.height &&
        this.cacheEnemyDirection === enemyDirection &&
        this.cacheEnemyLockDelay === enemyLockDelay &&
        this.cacheEnemyCanAct === enemyCanAct &&
        this.cacheOwnStars === ownStars &&
        this.cacheEnemyStars === enemyStars &&
        this.cacheOwnShield === ownShield &&
        this.cacheEnemyShield === enemyShield) {
      this.cacheHitCount += 1;
      return 1;
    }
    const poseCount = state.cells * 4;
    this.distance.fill(NO_COST, 0, poseCount);
    let head = 0; let tail = 0; let goals = 0; let rejectedGoals = 0;
    for (let cell = 0; cell < state.cells; cell += 1) {
      if (!this.walkable(state, cell, enemy)) continue;
      const direction = engine.directionTo(cell, enemy);
      if (direction < 0 || !engine.clearLine(cell, enemy)) continue;
      if (!this.favorableGoal(engine, cell, direction, enemy)) {
        rejectedGoals += 1; continue;
      }
      const pose = cell * 4 + direction;
      if (this.distance[pose] === NO_COST) {
        this.distance[pose] = 0;
        this.queue[tail++] = pose;
        goals += 1;
      }
    }
    while (head < tail) {
      const pose = this.queue[head++];
      const cell = (pose / 4) | 0;
      const direction = pose & 3;
      const nextCost = this.distance[pose] + 1;
      tail = this.enqueue(cell * 4 + ((direction + 1) & 3), nextCost, tail);
      tail = this.enqueue(cell * 4 + ((direction + 3) & 3), nextCost, tail);
      const predecessor = this.target(state, cell, direction ^ 2);
      if (this.walkable(state, predecessor, enemy))
        tail = this.enqueue(predecessor * 4 + direction, nextCost, tail);
    }
    this.cacheEnemy = enemy;
    this.cacheTopology = topology;
    this.cacheWidth = state.width;
    this.cacheHeight = state.height;
    this.cacheEnemyDirection = enemyDirection;
    this.cacheEnemyLockDelay = enemyLockDelay;
    this.cacheEnemyCanAct = enemyCanAct;
    this.cacheOwnStars = ownStars;
    this.cacheEnemyStars = enemyStars;
    this.cacheOwnShield = ownShield;
    this.cacheEnemyShield = enemyShield;
    this.cacheValid = 1;
    this.fieldBuildCount += 1;
    this.goalPoseCount += goals;
    this.rejectedGoalPoseCount += rejectedGoals;
    this.visitedPoseCount += tail;
    if (tail > this.maximumVisitedPoses) this.maximumVisitedPoses = tail;
    return goals > 0 ? 1 : 0;
  }

  cost(cell, direction) {
    return cell === NONE_CELL || direction < 0 || direction > 3 ?
      NO_COST : this.distance[cell * 4 + direction];
  }

  eligible(engine, row) {
    const action = engine.ourActions[row];
    const outcome = engine.riskController.outcome;
    return (action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT) &&
      engine.hardStatus[row] === HARD_STATUS.ALLOW &&
      outcome.acceptable[row] && !outcome.dominated[row];
  }

  riskNoWorse(outcome, row, preferred, requireValue = 1) {
    return outcome.immediateFatalMass[row] <= outcome.immediateFatalMass[preferred] &&
      outcome.horizonFatalMass[row] <= outcome.horizonFatalMass[preferred] &&
      outcome.unknownMass[row] <= outcome.unknownMass[preferred] &&
      outcome.earliestFatalFrame[row] >= outcome.earliestFatalFrame[preferred] &&
      outcome.escapeSlack[row] >= outcome.escapeSlack[preferred] &&
      (!requireValue || outcome.robustLower[row] >= outcome.robustLower[preferred]);
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const leftCost = this.cost(engine.projectedCell[left], engine.projectedDirection[left]);
    const rightCost = this.cost(engine.projectedCell[right], engine.projectedDirection[right]);
    if (leftCost !== rightCost) return leftCost < rightCost ? 1 : 0;
    const outcome = engine.riskController.outcome;
    if (outcome.robustLower[left] !== outcome.robustLower[right])
      return outcome.robustLower[left] > outcome.robustLower[right] ? 1 : 0;
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  evaluateInternal(engine, preferred, selectionCount, requireNavigation,
      requireValue) {
    this.evaluationCount += 1;
    this.lastProposal = -1;
    this.lastCurrentCost = NO_COST;
    this.lastProposalCost = NO_COST;
    if (!engine || preferred < 0 || preferred >= selectionCount ||
        requireNavigation &&
          engine.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION ||
        !engine.adapter.enemyVisible || !engine.escapeObligation ||
        engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE ||
        !this.build(engine)) return -1;
    const state = engine.adapter.state;
    const current = this.cost(state.arrays[ARRAY.TANK_CELL][0],
      state.arrays[ARRAY.TANK_DIR][0]);
    this.lastCurrentCost = current;
    if (current === 0 || current === NO_COST) return -1;
    let best = -1;
    let bestNoRegression = -1;
    for (let row = 0; row < selectionCount; row += 1) {
      if (!this.eligible(engine, row)) continue;
      const cost = this.cost(engine.projectedCell[row], engine.projectedDirection[row]);
      if (cost >= current) continue;
      if (this.better(engine, row, best)) best = row;
      if (this.riskNoWorse(engine.riskController.outcome, row, preferred,
          requireValue) &&
          this.better(engine, row, bestNoRegression)) bestNoRegression = row;
    }
    if (best < 0) return -1;
    this.progressRootCount += 1;
    if (best !== preferred) this.frontierDifferentCount += 1;
    if (bestNoRegression < 0) return -1;
    if (bestNoRegression !== preferred) this.noRegressionDifferentCount += 1;
    this.proposalCount += 1;
    if (bestNoRegression === preferred) this.sameSelectedCount += 1;
    this.lastProposal = bestNoRegression;
    this.lastProposalCost = this.cost(engine.projectedCell[bestNoRegression],
      engine.projectedDirection[bestNoRegression]);
    return bestNoRegression;
  }

  evaluate(engine, preferred, selectionCount) {
    return this.evaluateInternal(engine, preferred, selectionCount, 1, 1);
  }

  // A qualified persistent ATTACK target already owns the strategic intent.
  // Reuse the same cached pose field as its execution policy without requiring
  // the root to remain classified as STRATEGIC_NAVIGATION.
  evaluateOwnedTarget(engine, preferred, selectionCount) {
    return this.evaluateInternal(engine, preferred, selectionCount, 0, 0);
  }

  confirmOverride() { this.overrideCount += 1; }
  rejectFinal() { this.finalRejectCount += 1; }

  summary() {
    return {
      active: Boolean(this.active),
      evaluationCount: this.evaluationCount,
      fieldBuildCount: this.fieldBuildCount,
      cacheHitCount: this.cacheHitCount,
      goalPoseCount: this.goalPoseCount,
      rejectedGoalPoseCount: this.rejectedGoalPoseCount,
      visitedPoseCount: this.visitedPoseCount,
      maximumVisitedPoses: this.maximumVisitedPoses,
      progressRootCount: this.progressRootCount,
      frontierDifferentCount: this.frontierDifferentCount,
      noRegressionDifferentCount: this.noRegressionDifferentCount,
      proposalCount: this.proposalCount,
      sameSelectedCount: this.sameSelectedCount,
      overrideCount: this.overrideCount,
      finalRejectCount: this.finalRejectCount,
      hotAllocationCount: this.hotAllocationCount,
      lastProposal: this.lastProposal,
      lastCurrentCost: this.lastCurrentCost,
      lastProposalCost: this.lastProposalCost
    };
  }
}

module.exports = { NO_COST, AttackObjectiveFieldProposal };
