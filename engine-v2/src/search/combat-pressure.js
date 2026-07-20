"use strict";

const { RULE } = require("../generated/fast-config");
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
    this.beliefSweep = new Uint8Array(maxActions); this.hitDeadline = new Uint8Array(maxActions);
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
    this.beliefSweep.fill(0, 0, count); this.hitDeadline.fill(NO_HIT_DEADLINE, 0, count);
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
      beliefCoverage = null, tactical = null) {
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
