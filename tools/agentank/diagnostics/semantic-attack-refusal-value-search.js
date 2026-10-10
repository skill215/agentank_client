"use strict";

// BP140-Q1 diagnostic-only refusal-aware finite-horizon value search.
// The packed integer is an exact mixed-radix lexicographic tuple, not a
// weighted heuristic.  Search recursion allocates no temporary objects.

const { CAPACITY } = require("../../../engine-v2/src/generated/fast-config");
const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN,
  NONE_FRAME, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { SETTLEMENT } = require("./native-tactical-domain-evaluator-poc");
const { SafeFireEventHorizonSearch } = require(
  "./semantic-attack-event-horizon-shadow");

const INCOMPLETE_VALUE = -2147483648;
const VALUE_RELATION = Object.freeze({ INCOMPLETE: 0, CANDIDATE_HIGHER: 1,
  EQUAL: 2, CANDIDATE_LOWER: 3 });
const POINTWISE_RELATION = Object.freeze({ INCOMPLETE: 0,
  CANDIDATE_DOMINATES: 1, EQUAL: 2, INCUMBENT_DOMINATES: 3, MIXED: 4 });
const POLICY_KIND = Object.freeze({ DIRECT_PURSUIT: 0, FLANKING_LINE: 1,
  COUNTER_SAFE_PRESSURE: 2, COUNT: 3 });
const POLICY_KIND_NAME = Object.freeze(["DIRECT_PURSUIT", "FLANKING_LINE",
  "COUNTER_SAFE_PRESSURE"]);
const RADIX = Object.freeze({
  COMMITTED_SAFETY: 4,
  ATTACK_STAGE: 4,
  COUNTER_SAFETY: 2,
  LINE_CONTROL: 3,
  MOBILITY_PRESSURE: 5,
  PROXIMITY: 13,
  STAR_DELTA: 9,
  STAR_RACE: 17,
  RESOURCE_BALANCE: 7
});

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function packVector(terminal, committedSafety, attackStage, counterSafety,
    lineControl, mobilityPressure, proximity, starDelta, starRace,
    resourceBalance) {
  let value = terminal;
  value = value * RADIX.COMMITTED_SAFETY + committedSafety;
  value = value * RADIX.ATTACK_STAGE + attackStage;
  value = value * RADIX.COUNTER_SAFETY + counterSafety;
  value = value * RADIX.LINE_CONTROL + lineControl;
  value = value * RADIX.MOBILITY_PRESSURE + mobilityPressure;
  value = value * RADIX.PROXIMITY + proximity;
  value = value * RADIX.STAR_DELTA + starDelta;
  value = value * RADIX.STAR_RACE + starRace;
  return value * RADIX.RESOURCE_BALANCE + resourceBalance;
}

function unpackVector(value) {
  if (value === INCOMPLETE_VALUE) return null;
  const output = {}; let rest = value;
  output.resourceBalance = rest % RADIX.RESOURCE_BALANCE;
  rest = Math.floor(rest / RADIX.RESOURCE_BALANCE);
  output.starRace = rest % RADIX.STAR_RACE;
  rest = Math.floor(rest / RADIX.STAR_RACE);
  output.starDelta = rest % RADIX.STAR_DELTA;
  rest = Math.floor(rest / RADIX.STAR_DELTA);
  output.proximity = rest % RADIX.PROXIMITY;
  rest = Math.floor(rest / RADIX.PROXIMITY);
  output.mobilityPressure = rest % RADIX.MOBILITY_PRESSURE;
  rest = Math.floor(rest / RADIX.MOBILITY_PRESSURE);
  output.lineControl = rest % RADIX.LINE_CONTROL;
  rest = Math.floor(rest / RADIX.LINE_CONTROL);
  output.counterSafety = rest % RADIX.COUNTER_SAFETY;
  rest = Math.floor(rest / RADIX.COUNTER_SAFETY);
  output.attackStage = rest % RADIX.ATTACK_STAGE;
  rest = Math.floor(rest / RADIX.ATTACK_STAGE);
  output.committedSafety = rest % RADIX.COMMITTED_SAFETY;
  output.terminal = Math.floor(rest / RADIX.COMMITTED_SAFETY);
  return output;
}

function valueRelation(incumbent, candidate, supportComplete = true) {
  if (!supportComplete || incumbent === INCOMPLETE_VALUE ||
      candidate === INCOMPLETE_VALUE) return VALUE_RELATION.INCOMPLETE;
  return candidate > incumbent ? VALUE_RELATION.CANDIDATE_HIGHER :
    candidate < incumbent ? VALUE_RELATION.CANDIDATE_LOWER :
      VALUE_RELATION.EQUAL;
}

function pointwiseRelation(incumbent, candidate, count) {
  let higher = 0; let lower = 0;
  for (let at = 0; at < count; at += 1) {
    if (incumbent[at] === INCOMPLETE_VALUE ||
        candidate[at] === INCOMPLETE_VALUE)
      return POINTWISE_RELATION.INCOMPLETE;
    if (candidate[at] > incumbent[at]) higher = 1;
    else if (candidate[at] < incumbent[at]) lower = 1;
  }
  if (higher && lower) return POINTWISE_RELATION.MIXED;
  if (higher) return POINTWISE_RELATION.CANDIDATE_DOMINATES;
  if (lower) return POINTWISE_RELATION.INCUMBENT_DOMINATES;
  return POINTWISE_RELATION.EQUAL;
}

class RefusalAwareEventValueSearch extends SafeFireEventHorizonSearch {
  constructor(nodeBudget = 4096, policyKind = POLICY_KIND.DIRECT_PURSUIT) {
    super(0, nodeBudget);
    this.policyKind = policyKind >= 0 && policyKind < POLICY_KIND.COUNT ?
      policyKind : POLICY_KIND.DIRECT_PURSUIT;
    this.ttValue = new Int32Array(this.ttDepth.length);
    this.rootColumnValue = new Int32Array(
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.lastValue = INCOMPLETE_VALUE; this.lastEnemyCount = 0;
    this.leafCount = 0; this.terminalLeafCount = 0;
    this.committedUnknownCount = 0; this.attackUnknownCount = 0;
    this.absoluteLowerBoundCutoffCount = 0;
    this.policyDecisionCount = 0; this.directRayDecisionCount = 0;
    this.flankingDecisionCount = 0; this.counterEscapeDecisionCount = 0;
    this.fallbackDecisionCount = 0;
  }

  resetValue(nodeBudget) {
    this.resetEvent(nodeBudget); this.rootColumnValue.fill(INCOMPLETE_VALUE);
    this.lastValue = INCOMPLETE_VALUE; this.lastEnemyCount = 0;
    this.leafCount = 0; this.terminalLeafCount = 0;
    this.committedUnknownCount = 0; this.attackUnknownCount = 0;
    this.absoluteLowerBoundCutoffCount = 0;
    this.policyDecisionCount = 0; this.directRayDecisionCount = 0;
    this.flankingDecisionCount = 0; this.counterEscapeDecisionCount = 0;
    this.fallbackDecisionCount = 0;
  }

  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] &&
          a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

  canFire(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    return !this.activeProjectile(state, seat) &&
      (a[ARRAY.TANK_FIRE_LOCK][seat] === NONE_FRAME ||
       a[ARRAY.TANK_FIRE_LOCK][seat] <= frame) ? 1 : 0;
  }

  lineDirection(state, seat) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][seat];
    const enemy = a[ARRAY.TANK_CELL][seat ^ 1];
    if (own >= state.cells || enemy >= state.cells) return -1;
    const ox = state.x(own); const oy = state.y(own);
    const ex = state.x(enemy); const ey = state.y(enemy);
    let direction = -1; let step = 0;
    if (ox === ex) {
      direction = ey < oy ? 0 : 2; step = ey < oy ? -state.width : state.width;
    } else if (oy === ey) {
      direction = ex < ox ? 3 : 1; step = ex < ox ? -1 : 1;
    } else return -1;
    for (let cell = own + step; cell !== enemy; cell += step) {
      const tile = a[ARRAY.TERRAIN][cell];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return -1;
    }
    return direction;
  }

  aimedReady(state, seat) {
    const direction = this.lineDirection(state, seat);
    return direction >= 0 && this.canFire(state, seat) &&
      state.arrays[ARRAY.TANK_DIR][seat] === direction ? 1 : 0;
  }

  turnToward(current, desired) {
    return ((desired - current + 4) & 3) === 3 ?
      ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  }

  counterEscapeAction(state) {
    if (!this.aimedReady(state, 1)) return ACTION.NONE;
    const a = state.arrays; const current = a[ARRAY.TANK_DIR][0];
    const enemyDirection = a[ARRAY.TANK_DIR][1];
    if ((current & 1) !== (enemyDirection & 1) && !this.forwardBlocked(state))
      return ACTION.GO;
    const left = (current + 3) & 3; const right = (current + 1) & 3;
    if ((left & 1) !== (enemyDirection & 1)) return ACTION.TURN_LEFT;
    if ((right & 1) !== (enemyDirection & 1)) return ACTION.TURN_RIGHT;
    return ACTION.NONE;
  }

  policyAction(state) {
    this.policyDecisionCount += 1;
    if (this.policyKind === POLICY_KIND.COUNTER_SAFE_PRESSURE) {
      const escape = this.counterEscapeAction(state);
      if (escape !== ACTION.NONE) {
        this.counterEscapeDecisionCount += 1; return escape;
      }
    }
    const fireDirection = this.firingDirection(state);
    const facing = state.arrays[ARRAY.TANK_DIR][0];
    if (fireDirection >= 0) {
      this.directRayDecisionCount += 1;
      if (facing === fireDirection) return ACTION.FIRE;
      return this.turnToward(facing, fireDirection);
    }
    if (this.policyKind === POLICY_KIND.FLANKING_LINE) {
      const secondary = this.pursuitAction(state, 1);
      if (secondary !== ACTION.NONE &&
          (secondary !== ACTION.GO || !this.forwardBlocked(state))) {
        this.flankingDecisionCount += 1;
        return secondary;
      }
    }
    this.fallbackDecisionCount += 1;
    return super.policyAction(state);
  }

  mobility(state, seat) {
    const a = state.arrays; const own = a[ARRAY.TANK_CELL][seat];
    const other = a[ARRAY.TANK_CELL][seat ^ 1]; const x = state.x(own);
    const y = state.y(own); let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const nx = x + (direction === 1 ? 1 : direction === 3 ? -1 : 0);
      const ny = y + (direction === 2 ? 1 : direction === 0 ? -1 : 0);
      if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) continue;
      const target = state.cell(nx, ny); const tile = a[ARRAY.TERRAIN][target];
      if (target !== other && tile !== TERRAIN.WALL && tile !== TERRAIN.DIRT)
        count += 1;
    }
    return count;
  }

  resourceCount(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    let count = this.canFire(state, seat);
    if (a[ARRAY.TANK_BOMB_READY][seat] <= frame) count += 1;
    if (a[ARRAY.TANK_SKILL_READY][seat] <= frame) count += 1;
    return count;
  }

  terminalRank(state) {
    const a = state.arrays; const terminal = a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    if (a[ARRAY.TANK_CRASH][0] || terminal === TERMINAL.WIN1) return 0;
    if (a[ARRAY.TANK_CRASH][1] || terminal === TERMINAL.WIN0) return 2;
    return 1;
  }

  evaluateState(state) {
    this.leafCount += 1; const a = state.arrays;
    const terminal = this.terminalRank(state);
    if (a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE]) this.terminalLeafCount += 1;
    const incoming = this.settlement.classifyThreat(state, 1);
    const outgoing = this.settlement.classifyThreat(state, 0);
    if (incoming === SETTLEMENT.UNKNOWN) this.committedUnknownCount += 1;
    if (outgoing === SETTLEMENT.UNKNOWN) this.attackUnknownCount += 1;
    const committedSafety = incoming === SETTLEMENT.NONE ? 3 :
      incoming === SETTLEMENT.SURVIVES ? 2 :
        incoming === SETTLEMENT.UNKNOWN ? 1 : 0;
    const attackStage = outgoing === SETTLEMENT.DOOMED ? 3 :
      outgoing === SETTLEMENT.SURVIVES ? 2 :
        outgoing === SETTLEMENT.UNKNOWN ? 1 : 0;
    const ownLine = this.lineDirection(state, 0) >= 0 ? 1 : 0;
    const enemyLine = this.lineDirection(state, 1) >= 0 ? 1 : 0;
    const lineControl = ownLine === enemyLine ? 1 : ownLine ? 2 : 0;
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const distance = Math.abs(state.x(own) - state.x(enemy)) +
      Math.abs(state.y(own) - state.y(enemy));
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    let starRace = 8;
    if (star !== NONE_CELL) {
      const ownStar = Math.abs(state.x(own) - state.x(star)) +
        Math.abs(state.y(own) - state.y(star));
      const enemyStar = Math.abs(state.x(enemy) - state.x(star)) +
        Math.abs(state.y(enemy) - state.y(star));
      starRace = clamp(enemyStar - ownStar, -8, 8) + 8;
    }
    return packVector(terminal, committedSafety, attackStage,
      this.aimedReady(state, 1) ? 0 : 1, lineControl,
      4 - this.mobility(state, 1), 12 - Math.min(12, distance),
      clamp(a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1], -4, 4) + 4,
      starRace,
      clamp(this.resourceCount(state, 0) - this.resourceCount(state, 1),
        -3, 3) + 3);
  }

  valueOutcome(bundle, depth, top, action0, argument0, action1, argument1,
      chance0, chance1) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return INCOMPLETE_VALUE;
    }
    const status = bundle.kernel.applyFrame(action0, argument0,
      action1, argument1, chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; this.fastIncompleteCount += 1;
      this.supportLossCount += 1; return INCOMPLETE_VALUE;
    }
    const mark = bundle.kernel.lastMark;
    const hard = bundle.hard.classifyApplied(); let value;
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.incompleteCount += 1; this.hardIncompleteCount += 1;
      this.supportLossCount += 1; value = INCOMPLETE_VALUE;
    } else if (hard !== HARD_STATUS.ALLOW ||
        bundle.state.arrays[ARRAY.TANK_CRASH][0]) {
      value = 0;
    } else if (depth <= 1 ||
        bundle.state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE]) {
      value = this.evaluateState(bundle.state);
    } else value = this.valueState(bundle, depth - 1, top + 1);
    bundle.state.undoTo(mark); return value;
  }

  valueColumn(bundle, depth, top, row, column) {
    const action0 = this.actionAt(top, 0, row);
    const argument0 = this.argumentAt(top, 0, row);
    const action1 = this.actionAt(top, 1, column);
    const argument1 = this.argumentAt(top, 1, column);
    const ownChance = bundle.hard.chanceAlternativeCount(0, action0);
    const enemyChance = bundle.hard.chanceAlternativeCount(1, action1);
    let worst = 2147483647;
    for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
      const value = this.valueOutcome(bundle, depth, top, action0, argument0,
        action1, argument1, chance % ownChance,
        Math.floor(chance / ownChance));
      if (value === INCOMPLETE_VALUE) return INCOMPLETE_VALUE;
      if (value < worst) worst = value;
      if (value === 0) {
        this.absoluteLowerBoundCutoffCount += 1; return 0;
      }
    }
    return worst;
  }

  valueRow(bundle, depth, top, row) {
    let worst = 2147483647;
    for (let column = 0; column < this.enemyCount[top]; column += 1) {
      const value = this.valueColumn(bundle, depth, top, row, column);
      if (value === INCOMPLETE_VALUE) return INCOMPLETE_VALUE;
      if (value < worst) worst = value;
      if (value === 0) {
        this.absoluteLowerBoundCutoffCount += 1; return 0;
      }
    }
    return worst;
  }

  valueState(bundle, depth, top) {
    const cached = this.lookupValue(bundle.state, depth);
    if (cached !== INCOMPLETE_VALUE) return cached;
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generate(top, bundle.state, 0) ||
        !this.generate(top, bundle.state, 1) || this.ourCount[top] !== 1) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return INCOMPLETE_VALUE;
    }
    const value = this.valueRow(bundle, depth, top, 0);
    if (value !== INCOMPLETE_VALUE) this.storeValue(bundle.state, depth, value);
    return value;
  }

  lookupValue(state, depth) {
    const slot = this.ttSlot(state, depth);
    if (slot < 0 || !this.ttDepth[slot]) return INCOMPLETE_VALUE;
    this.ttHits += 1; return this.ttValue[slot];
  }

  storeValue(state, depth, value) {
    const slot = this.ttSlot(state, depth); if (slot < 0) return;
    this.ttLo[slot] = state.hashLo; this.ttHi[slot] = state.hashHi;
    this.ttDepth[slot] = depth; this.ttValue[slot] = value;
    this.ttStores += 1;
  }

  evaluateRoot(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4,
      nodeBudget = this.defaultNodeBudget) {
    this.resetValue(nodeBudget);
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 1 ||
        maximumDepth > SEARCH_CAPACITY.MAX_DECISION_DEPTH || nodeBudget < 1) {
      this.supportLossCount += 1; return this.lastValue;
    }
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument; this.enemyCount[0] = enemyCount;
    this.lastEnemyCount = enemyCount;
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments[column];
    }
    const state = bundle.state; const rootLo = state.hashLo;
    const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    let worst = 2147483647;
    for (let column = 0; column < enemyCount; column += 1) {
      const value = this.valueColumn(bundle, maximumDepth, 0, 0, column);
      this.rootColumnValue[column] = value;
      if (value === INCOMPLETE_VALUE) { worst = INCOMPLETE_VALUE; break; }
      if (value < worst) worst = value;
    }
    this.lastValue = worst;
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.supportLossCount += 1;
      this.lastValue = INCOMPLETE_VALUE;
    }
    this.lastSupportComplete = this.lastValue !== INCOMPLETE_VALUE &&
      this.supportLossCount === 0 && this.budgetStopCount === 0 &&
      this.rootRestoreFailures === 0 && this.unsupportedGenerationStops === 0 ?
      1 : 0;
    if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    return this.lastValue;
  }
}

module.exports = { INCOMPLETE_VALUE, VALUE_RELATION, POINTWISE_RELATION,
  POLICY_KIND, POLICY_KIND_NAME, RADIX, packVector, unpackVector,
  valueRelation, pointwiseRelation,
  RefusalAwareEventValueSearch };
