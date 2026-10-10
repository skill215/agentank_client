"use strict";

const { CAPACITY, RULE } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION, TERRAIN, NONE_CELL, NONE_FRAME, DX, DY } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { PLAN_PURPOSE, COMBAT_PURPOSE } = require("../abi/policy-codes");

const NO_HIT_DEADLINE = 255;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

// A bounded, allocation-free combat description for every root action.  It is
// deliberately separate from generic evaluation: callers may consume it only
// after RiskAcceptanceController has formed the acceptable set.
class CombatVectorSlab {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.maxActions = maxActions; this.count = 0;
    this.purpose = new Uint8Array(maxActions); this.purposeFlags = new Uint8Array(maxActions);
    this.purposePriority = new Uint8Array(maxActions);
    this.directKill = new Uint8Array(maxActions); this.aimSetup = new Uint8Array(maxActions);
    this.intercept = new Uint8Array(maxActions); this.escapeDenial = new Uint8Array(maxActions);
    this.shieldBreak = new Uint8Array(maxActions); this.zoneDenial = new Uint8Array(maxActions);
    this.beliefSweep = new Uint8Array(maxActions); this.possibleHit = new Uint8Array(maxActions);
    this.attackClosureStatus = new Uint8Array(maxActions);
    this.enemyDoomedFirstActions = new Uint8Array(maxActions);
    this.enemySurvivingFirstActions = new Uint8Array(maxActions);
    this.enemyUnknownFirstActions = new Uint8Array(maxActions);
    this.attackDoomedByFrame = new Uint8Array(maxActions);
    this.attackPressureContribution = new Int16Array(maxActions);
    this.enemyFrontierColumns = new Uint8Array(maxActions);
    this.enemyCounterfireDelay = new Uint8Array(maxActions);
    this.enemyMobilityLoss = new Uint8Array(maxActions);
    this.enemyEndpointReduction = new Uint16Array(maxActions);
    this.hitDeadline = new Uint8Array(maxActions);
    this.enemySafeSuccessors = new Uint8Array(maxActions);
    this.ownCounterExposure = new Uint16Array(maxActions);
    this.resourceOccupancy = new Uint8Array(maxActions); this.blockadeValue = new Uint16Array(maxActions);
    this.purposeCompleteness = new Uint16Array(maxActions); this.postFireEscape = new Uint8Array(maxActions);
    this.pressureValue = new Int16Array(maxActions); this.robustPressure = new Int16Array(maxActions);
    this.hotAllocationCount = 0;
  }
  reset(count) {
    this.count = count; this.purpose.fill(0, 0, count); this.purposeFlags.fill(0, 0, count);
    this.purposePriority.fill(0, 0, count);
    this.directKill.fill(0, 0, count); this.aimSetup.fill(0, 0, count);
    this.intercept.fill(0, 0, count); this.escapeDenial.fill(0, 0, count);
    this.shieldBreak.fill(0, 0, count); this.zoneDenial.fill(0, 0, count);
    this.beliefSweep.fill(0, 0, count); this.possibleHit.fill(0, 0, count);
    this.attackClosureStatus.fill(0, 0, count);
    this.enemyDoomedFirstActions.fill(0, 0, count);
    this.enemySurvivingFirstActions.fill(0, 0, count);
    this.enemyUnknownFirstActions.fill(0, 0, count);
    this.attackDoomedByFrame.fill(NO_HIT_DEADLINE, 0, count);
    this.attackPressureContribution.fill(0, 0, count);
    this.enemyFrontierColumns.fill(0, 0, count);
    this.enemyCounterfireDelay.fill(0, 0, count);
    this.enemyMobilityLoss.fill(0, 0, count);
    this.enemyEndpointReduction.fill(0, 0, count);
    this.hitDeadline.fill(NO_HIT_DEADLINE, 0, count);
    this.enemySafeSuccessors.fill(0, 0, count); this.ownCounterExposure.fill(0, 0, count);
    this.resourceOccupancy.fill(0, 0, count); this.blockadeValue.fill(0, 0, count);
    this.purposeCompleteness.fill(0, 0, count); this.postFireEscape.fill(0, 0, count);
    this.pressureValue.fill(0, 0, count); this.robustPressure.fill(0, 0, count);
  }
  mark(row, flag, purpose, priority = 1) {
    this.purposeFlags[row] |= flag;
    if (priority >= this.purposePriority[row]) {
      this.purposePriority[row] = priority; this.purpose[row] = purpose;
    }
    if (flag === COMBAT_PURPOSE.DIRECT_KILL) this.directKill[row] = 1;
    else if (flag === COMBAT_PURPOSE.AIM_SETUP) this.aimSetup[row] = 1;
    else if (flag === COMBAT_PURPOSE.INTERCEPT) this.intercept[row] = 1;
    else if (flag === COMBAT_PURPOSE.ESCAPE_DENIAL) this.escapeDenial[row] = 1;
    else if (flag === COMBAT_PURPOSE.SHIELD_BREAK) this.shieldBreak[row] = 1;
    else if (flag === COMBAT_PURPOSE.ZONE_DENIAL) this.zoneDenial[row] = 1;
    else if (flag === COMBAT_PURPOSE.BELIEF_SWEEP) this.beliefSweep[row] = 1;
  }
}

class CombatPressure {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.vector = new CombatVectorSlab(maxActions); this.evaluationCount = 0;
    this.possibleHitQueue = new Uint16Array(CAPACITY.MAX_CELLS);
    this.possibleHitVisited = new Uint16Array(CAPACITY.MAX_CELLS);
    this.possibleHitVisitDepth = new Uint8Array(CAPACITY.MAX_CELLS);
    this.possibleHitRayCells = new Uint16Array(CAPACITY.MAX_CELLS);
    this.possibleHitRayArrival = new Uint8Array(CAPACITY.MAX_CELLS);
    this.possibleHitGeneration = 0; this.possibleHitEnabled = 1;
    this.possibleHitReachBuilds = 0;
    this.possibleHitEvaluationCount = 0; this.possibleHitFoundCount = 0;
    this.possibleHitQueryCacheHits = 0;
    this.possibleHitQuerySource = NONE_CELL; this.possibleHitQueryDirection = 0xff;
    this.possibleHitQueryEnemy = NONE_CELL; this.possibleHitQueryTopology = 0xffffffff;
    this.possibleHitQueryWidth = 0; this.possibleHitQueryHeight = 0;
    this.possibleHitQueryEnemyCanAct = 0; this.possibleHitQueryResult = 0;
    this.possibleHitQueryDeadline = NO_HIT_DEADLINE;
    this.possibleHitQueryCompleteness = 0;
    this.lastPossibleHitDeadline = NO_HIT_DEADLINE;
    this.lastPossibleHitCompleteness = 0;
    this.hotAllocationCount = 0;
  }
  target(state, cell, direction) {
    const x = state.x(cell) + DX[direction]; const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ? NONE_CELL : state.cell(x, y);
  }
  walkable(state, cell) {
    if (cell === NONE_CELL) return 0; const terrain = state.arrays[ARRAY.TERRAIN][cell];
    return terrain !== TERRAIN.WALL && terrain !== TERRAIN.DIRT;
  }
  directionTo(state, from, to) {
    const fx = state.x(from); const fy = state.y(from); const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : 3; return -1;
  }
  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) + Math.abs(state.y(left) - state.y(right));
  }
  clearLine(state, from, to) {
    const direction = this.directionTo(state, from, to); if (direction < 0) return 0;
    let cell = this.target(state, from, direction);
    while (cell !== NONE_CELL && cell !== to) {
      const terrain = state.arrays[ARRAY.TERRAIN][cell];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) return 0;
      cell = this.target(state, cell, direction);
    }
    return cell === to ? 1 : 0;
  }
  nextPossibleHitGeneration() {
    this.possibleHitGeneration = (this.possibleHitGeneration + 1) & 0xffff;
    if (this.possibleHitGeneration === 0) {
      this.possibleHitVisited.fill(0);
      this.possibleHitGeneration = 1;
    }
    return this.possibleHitGeneration;
  }
  findPossibleHit(state, source, direction, enemyCell, enemyCanAct = 1) {
    this.lastPossibleHitDeadline = NO_HIT_DEADLINE;
    this.lastPossibleHitCompleteness = 0;
    this.possibleHitEvaluationCount += 1;
    if (!this.possibleHitEnabled) return 0;
    const topology = state.arrays[ARRAY.SCALAR][SCALAR.TOPOLOGY_VERSION];
    const canAct = enemyCanAct ? 1 : 0;
    if (this.possibleHitQuerySource === source &&
        this.possibleHitQueryDirection === direction &&
        this.possibleHitQueryEnemy === enemyCell &&
        this.possibleHitQueryTopology === topology &&
        this.possibleHitQueryWidth === state.width &&
        this.possibleHitQueryHeight === state.height &&
        this.possibleHitQueryEnemyCanAct === canAct) {
      this.lastPossibleHitDeadline = this.possibleHitQueryDeadline;
      this.lastPossibleHitCompleteness = this.possibleHitQueryCompleteness;
      this.possibleHitQueryCacheHits += 1;
      if (this.possibleHitQueryResult) this.possibleHitFoundCount += 1;
      return this.possibleHitQueryResult;
    }
    let found = 0; let rayCount = 0; let maxArrival = 0;
    let cell = source;
    for (let distance = 1; distance <= state.cells; distance += 1) {
      cell = this.target(state, cell, direction);
      if (cell === NONE_CELL) break;
      const terrain = state.arrays[ARRAY.TERRAIN][cell];
      if (terrain === TERRAIN.WALL || terrain === TERRAIN.DIRT) break;
      const arrival = Math.max(1, Math.floor(
        (distance + RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS));
      this.possibleHitRayCells[rayCount] = cell;
      this.possibleHitRayArrival[rayCount] = arrival;
      rayCount += 1; maxArrival = arrival;
    }
    const delay = canAct ? 0 : 1;
    if (rayCount > 0 && this.walkable(state, enemyCell) && maxArrival >= delay) {
      const generation = this.nextPossibleHitGeneration();
      let head = 0; let tail = 1; let depth = 0; let levelEnd = 1;
      const maximumDepth = maxArrival - delay;
      this.possibleHitQueue[0] = enemyCell;
      this.possibleHitVisited[enemyCell] = generation;
      this.possibleHitVisitDepth[enemyCell] = 0;
      while (head < tail && depth <= maximumDepth) {
        const currentEnd = levelEnd;
        while (head < currentEnd) {
          const current = this.possibleHitQueue[head++];
          if (depth < maximumDepth) {
            for (let move = 0; move < 4; move += 1) {
              const next = this.target(state, current, move);
              if (this.walkable(state, next) &&
                  this.possibleHitVisited[next] !== generation) {
                this.possibleHitVisited[next] = generation;
                this.possibleHitVisitDepth[next] = depth + 1;
                this.possibleHitQueue[tail++] = next;
              }
            }
          }
        }
        depth += 1; levelEnd = tail;
      }
      this.possibleHitReachBuilds += 1;
      for (let ray = 0; ray < rayCount; ray += 1) {
        const rayCell = this.possibleHitRayCells[ray];
        if (this.possibleHitVisited[rayCell] !== generation) continue;
        const arrival = this.possibleHitRayArrival[ray];
        const required = this.possibleHitVisitDepth[rayCell] + delay;
        if (required > arrival) continue;
        const slack = arrival - required;
        this.lastPossibleHitDeadline = Math.min(NO_HIT_DEADLINE - 1, arrival);
        this.lastPossibleHitCompleteness = clamp(4500 + Math.min(2000, slack * 500),
          3500, 6500);
        found = 1; break;
      }
    }
    this.possibleHitQuerySource = source; this.possibleHitQueryDirection = direction;
    this.possibleHitQueryEnemy = enemyCell; this.possibleHitQueryTopology = topology;
    this.possibleHitQueryWidth = state.width; this.possibleHitQueryHeight = state.height;
    this.possibleHitQueryEnemyCanAct = canAct; this.possibleHitQueryResult = found;
    this.possibleHitQueryDeadline = this.lastPossibleHitDeadline;
    this.possibleHitQueryCompleteness = this.lastPossibleHitCompleteness;
    if (found) this.possibleHitFoundCount += 1;
    return found;
  }
  mobility(state, seat, cell) {
    const opposing = state.arrays[ARRAY.TANK_CELL][seat ^ 1]; let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.target(state, cell, direction);
      if (this.walkable(state, next) && next !== opposing) count += 1;
    }
    return count;
  }
  lineContains(state, source, direction, cell) {
    return this.directionTo(state, source, cell) === direction && this.clearLine(state, source, cell);
  }
  safeSuccessors(state, source, direction, enemyCell) {
    const own = state.arrays[ARRAY.TANK_CELL][0]; let safe = 0;
    for (let move = 0; move < 4; move += 1) {
      const next = this.target(state, enemyCell, move);
      if (!this.walkable(state, next) || next === own) continue;
      if (!this.lineContains(state, source, direction, next)) safe += 1;
    }
    return safe;
  }
  safeOwnSuccessors(state, ownCell, enemyCell, enemyDirection, enemyVisible) {
    const enemy = state.arrays[ARRAY.TANK_CELL][1]; let safe = 0;
    for (let move = 0; move < 4; move += 1) {
      const next = this.target(state, ownCell, move);
      if (!this.walkable(state, next) || next === enemy) continue;
      if (!enemyVisible || !this.lineContains(state, enemyCell, enemyDirection, next)) safe += 1;
    }
    return safe;
  }
  bombHits(state, source, target) {
    if (source === target) return 1;
    const direction = this.directionTo(state, source, target);
    if (direction < 0 || this.distance(state, source, target) > RULE.BOMB_RANGE) return 0;
    let cell = source;
    for (let step = 0; step < RULE.BOMB_RANGE; step += 1) {
      cell = this.target(state, cell, direction); if (cell === NONE_CELL) return 0;
      const terrain = state.arrays[ARRAY.TERRAIN][cell];
      if (terrain === TERRAIN.WALL) return 0; if (cell === target) return 1;
      if (terrain === TERRAIN.DIRT) return 0;
    }
    return 0;
  }
  evaluate(bundle, actions, count, projectedCell, projectedDirection, enemyVisible,
      beliefCoverage = null, tactical = null, enemyCanAct = 1) {
    const state = bundle.state; const a = state.arrays; const vector = this.vector; vector.reset(count);
    const enemyCell = a[ARRAY.TANK_CELL][1]; const enemyDirection = a[ARRAY.TANK_DIR][1];
    const enemyMobility = this.mobility(state, 1, enemyCell); const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const enemyCanFire = a[ARRAY.TANK_FIRE_LOCK][1] === NONE_FRAME ||
      a[ARRAY.TANK_FIRE_LOCK][1] <= frame;
    for (let row = 0; row < count; row += 1) {
      const action = actions[row]; const ownCell = projectedCell[row]; const ownDirection = projectedDirection[row];
      if (ownCell === NONE_CELL) continue;
      const ownEscape = this.safeOwnSuccessors(state, ownCell, enemyCell, enemyDirection, enemyVisible);
      vector.postFireEscape[row] = ownEscape;
      const enemyAimed = enemyVisible && enemyCanFire &&
        this.lineContains(state, enemyCell, enemyDirection, ownCell);
      vector.ownCounterExposure[row] = enemyAimed ? clamp(10000 - ownEscape * 2200, 1200, 10000) : 0;
      if (action === ACTION.FIRE) {
        vector.resourceOccupancy[row] = 1;
        if (!enemyVisible) {
          const coverage = beliefCoverage ? beliefCoverage[row] : 0;
          if (coverage > 0) { vector.mark(row, COMBAT_PURPOSE.BELIEF_SWEEP, PLAN_PURPOSE.BELIEF_SWEEP);
            vector.purposeCompleteness[row] = coverage;
            vector.pressureValue[row] = tactical &&
              Number.isSafeInteger(tactical.FIRE_HIDDEN_SCORE) ?
              Math.trunc(coverage * tactical.FIRE_HIDDEN_SCORE / 10000) :
              Math.trunc(coverage / 8); }
          else vector.pressureValue[row] = 0;
          vector.robustPressure[row] = vector.pressureValue[row];
          continue;
        }
        if (this.directionTo(state, ownCell, enemyCell) !== ownDirection ||
            !this.clearLine(state, ownCell, enemyCell)) {
          if (this.findPossibleHit(state, ownCell, ownDirection, enemyCell, enemyCanAct)) {
            vector.mark(row, COMBAT_PURPOSE.INTERCEPT, PLAN_PURPOSE.INTERCEPT, 3);
            vector.possibleHit[row] = 1;
            vector.hitDeadline[row] = this.lastPossibleHitDeadline;
            vector.resourceOccupancy[row] = this.lastPossibleHitDeadline;
            vector.enemySafeSuccessors[row] = enemyMobility;
            vector.purposeCompleteness[row] = this.lastPossibleHitCompleteness;
            const pressure = 400 + Math.trunc(this.lastPossibleHitCompleteness / 4) -
              enemyMobility * 150 - Math.trunc(vector.ownCounterExposure[row] / 10);
            vector.pressureValue[row] = clamp(pressure, -500, 2500);
            // The enemy can choose not to enter the ray. This is tactical
            // possibility, never committed/proven lower-bound pressure.
            vector.robustPressure[row] = 0;
            continue;
          }
          vector.pressureValue[row] = tactical &&
            Number.isSafeInteger(tactical.FIRE_VISIBLE_MISS_SCORE) ?
            tactical.FIRE_VISIBLE_MISS_SCORE : -2500;
          vector.robustPressure[row] = vector.pressureValue[row];
          continue;
        }
        const distance = this.distance(state, ownCell, enemyCell);
        const deadline = Math.max(1, Math.floor((distance + RULE.PROJECTILE_STEPS - 1) /
          RULE.PROJECTILE_STEPS)); const safe = this.safeSuccessors(state, ownCell, ownDirection, enemyCell);
        vector.hitDeadline[row] = Math.min(NO_HIT_DEADLINE - 1, deadline);
        vector.resourceOccupancy[row] = vector.hitDeadline[row]; vector.enemySafeSuccessors[row] = safe;
        vector.blockadeValue[row] = clamp((enemyMobility - safe) * 2500, 0, 10000);
        if (deadline <= 1 || safe === 0) {
          vector.mark(row, COMBAT_PURPOSE.DIRECT_KILL, PLAN_PURPOSE.DIRECT_KILL, 7);
          vector.purposeCompleteness[row] = 10000;
        } else {
          vector.mark(row, COMBAT_PURPOSE.INTERCEPT, PLAN_PURPOSE.INTERCEPT, 4);
          vector.purposeCompleteness[row] = clamp(9000 - deadline * 500, 4500, 8500);
        }
        if (safe < enemyMobility) vector.mark(row, COMBAT_PURPOSE.ESCAPE_DENIAL,
          PLAN_PURPOSE.ESCAPE_FORCING, 5);
        if (a[ARRAY.TANK_SHIELD_HITS][1] > 0) vector.mark(row,
          COMBAT_PURPOSE.SHIELD_BREAK, PLAN_PURPOSE.SHIELD_BREAK, 6);
        const directWindow = deadline <= 1 ? 10000 : safe === 0 ?
          Math.max(2500, 9500 - distance * 550) :
          Math.max(500, 7500 - distance * 650 - safe * 1100);
        const multiplier = tactical && Number.isSafeInteger(tactical.FIRE_DIRECT_MULTIPLIER) ?
          tactical.FIRE_DIRECT_MULTIPLIER : 1;
        const committedValue = directWindow * multiplier;
        let pressure = committedValue;
        pressure += Math.trunc(vector.blockadeValue[row] / 4);
        if (vector.shieldBreak[row]) pressure += 900;
        pressure -= Math.trunc(vector.ownCounterExposure[row] / 5);
        if (enemyAimed && ownEscape === 0) pressure = Math.min(-1000, pressure - 9000);
        vector.pressureValue[row] = clamp(pressure, -10000, 10000);
        vector.robustPressure[row] = enemyAimed && ownEscape === 0 ?
          vector.pressureValue[row] : committedValue;
      } else if (action === ACTION.THROW_BOMB) {
        vector.resourceOccupancy[row] = RULE.BOMB_FUSE;
        if (enemyVisible && this.bombHits(state, ownCell, enemyCell)) {
          vector.mark(row, COMBAT_PURPOSE.ZONE_DENIAL, PLAN_PURPOSE.ZONE_DENIAL, 3);
          vector.enemySafeSuccessors[row] = Math.max(0, enemyMobility - 1);
          vector.blockadeValue[row] = clamp((5 - enemyMobility) * 1800, 1000, 9000);
          vector.purposeCompleteness[row] = clamp(9000 - enemyMobility * 1000, 4000, 9000);
          vector.pressureValue[row] = clamp(900 + Math.trunc(vector.blockadeValue[row] / 2) -
            Math.trunc(vector.ownCounterExposure[row] / 8), -10000, 10000);
        } else if (!enemyVisible) {
          const coverage = beliefCoverage ? beliefCoverage[row] : 0;
          if (coverage > 0) { vector.mark(row, COMBAT_PURPOSE.BELIEF_SWEEP, PLAN_PURPOSE.BELIEF_SWEEP);
            vector.purposeCompleteness[row] = coverage; vector.pressureValue[row] = Math.trunc(coverage / 10); }
        }
      } else if (enemyVisible && this.directionTo(state, ownCell, enemyCell) === ownDirection &&
          this.clearLine(state, ownCell, enemyCell)) {
        const deadline = 1 + Math.max(1, Math.floor((this.distance(state, ownCell, enemyCell) +
          RULE.PROJECTILE_STEPS - 1) / RULE.PROJECTILE_STEPS));
        vector.mark(row, COMBAT_PURPOSE.AIM_SETUP, PLAN_PURPOSE.INTERCEPT, 2);
        vector.hitDeadline[row] = Math.min(NO_HIT_DEADLINE - 1, deadline);
        vector.enemySafeSuccessors[row] = this.safeSuccessors(state, ownCell, ownDirection, enemyCell);
        vector.blockadeValue[row] = clamp((enemyMobility - vector.enemySafeSuccessors[row]) * 1800,
          0, 8000); vector.purposeCompleteness[row] = 7000;
        vector.pressureValue[row] = clamp(1400 + Math.trunc(vector.blockadeValue[row] / 4) -
          Math.trunc(vector.ownCounterExposure[row] / 10), -10000, 10000);
      }
    }
    this.evaluationCount += 1; return vector;
  }
}

module.exports = { NO_HIT_DEADLINE, CombatVectorSlab, CombatPressure };
