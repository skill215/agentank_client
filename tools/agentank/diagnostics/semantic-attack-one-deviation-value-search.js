"use strict";

// BP142 diagnostic-only bounded policy improvement.  Along each observed
// world line, the own policy may choose at most one non-baseline action and
// then resumes DIRECT_PURSUIT.  This is adaptive to the current state but not
// to the simultaneous enemy action or chance outcome.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { AttackEventPolicySearch } = require(
  "../../../engine-v2/src/search/attack-event-policy-search");
const { INCOMPLETE_VALUE, POLICY_KIND, packVector,
  RefusalAwareEventValueSearch } = require(
  "./semantic-attack-refusal-value-search");

const MAX_PACKED_VALUE = packVector(2, 3, 3, 1, 2, 4, 12, 8, 16, 6);

function deviationCacheKey(depth, available) {
  return (depth << 1) | (available ? 1 : 0);
}

function preferDeviation(candidateValue, bestValue, candidateRow,
    bestRow, baselineRow) {
  if (candidateValue !== bestValue) return candidateValue > bestValue;
  if (bestRow === baselineRow) return false;
  if (candidateRow === baselineRow) return true;
  return candidateRow < bestRow;
}

class OneDeviationRefusalValueSearch extends RefusalAwareEventValueSearch {
  constructor(nodeBudget = 4096, ttCapacity = 8192) {
    super(nodeBudget, POLICY_KIND.DIRECT_PURSUIT);
    if (ttCapacity < 2048 || (ttCapacity & (ttCapacity - 1)) !== 0)
      throw new Error("BP142_TT_CAPACITY_POWER_OF_TWO_REQUIRED");
    if (ttCapacity !== this.ttDepth.length) {
      this.ttLo = new Uint32Array(ttCapacity);
      this.ttHi = new Uint32Array(ttCapacity);
      this.ttSemanticLo = new Uint32Array(ttCapacity);
      this.ttSemanticHi = new Uint32Array(ttCapacity);
      this.ttDepth = new Uint8Array(ttCapacity);
      this.ttStatus = new Uint8Array(ttCapacity);
      this.ttPolicyAction = new Uint8Array(ttCapacity);
      this.ttPolicyArgument = new Uint16Array(ttCapacity);
      this.ttValue = new Int32Array(ttCapacity);
    }
    this.deviationActionCount = new Uint32Array(ACTION.BOOST_RIGHT_BOMB + 1);
    this.deviationStateCount = 0; this.deviationCandidateCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.deviationUpperBoundCutoffCount = 0;
    this.deviationDominanceCutoffCount = 0;
  }

  resetDeviation(nodeBudget) {
    this.resetValue(nodeBudget); this.deviationActionCount.fill(0);
    this.deviationStateCount = 0; this.deviationCandidateCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.deviationUpperBoundCutoffCount = 0;
    this.deviationDominanceCutoffCount = 0;
  }

  generateFull(top, state, seat) {
    return AttackEventPolicySearch.prototype.generate.call(
      this, top, state, seat);
  }

  ttSlot(state, depth) {
    const capacity = this.ttDepth.length; const mask = capacity - 1;
    let slot = (state.hashLo ^
      ((state.hashHi << 7) | (state.hashHi >>> 25)) ^
      (depth * 0x9e3779b9)) & mask;
    for (let probe = 0; probe < capacity; probe += 1) {
      if (!this.ttDepth[slot] || (this.ttDepth[slot] === depth &&
          this.ttLo[slot] === state.hashLo &&
          this.ttHi[slot] === state.hashHi)) return slot;
      slot = (slot + 1) & mask;
    }
    this.ttCapacityStops += 1; return -1;
  }

  lookupDeviationValue(state, depth, available) {
    const key = deviationCacheKey(depth, available);
    const slot = this.ttSlot(state, key);
    if (slot < 0 || !this.ttDepth[slot]) return INCOMPLETE_VALUE;
    this.ttHits += 1; return this.ttValue[slot];
  }

  storeDeviationValue(state, depth, available, value) {
    const key = deviationCacheKey(depth, available);
    const slot = this.ttSlot(state, key); if (slot < 0) return;
    this.ttLo[slot] = state.hashLo; this.ttHi[slot] = state.hashHi;
    this.ttDepth[slot] = key; this.ttValue[slot] = value;
    this.ttStores += 1;
  }

  deviationOutcome(bundle, depth, top, action0, argument0,
      action1, argument1, chance0, chance1, availableAfterAction) {
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
    } else value = this.deviationState(bundle, depth - 1, top + 1,
      availableAfterAction);
    bundle.state.undoTo(mark); return value;
  }

  deviationColumn(bundle, depth, top, row, column,
      availableAfterAction, rejectAtOrBelow = -1) {
    const action0 = this.actionAt(top, 0, row);
    const argument0 = this.argumentAt(top, 0, row);
    const action1 = this.actionAt(top, 1, column);
    const argument1 = this.argumentAt(top, 1, column);
    const ownChance = bundle.hard.chanceAlternativeCount(0, action0);
    const enemyChance = bundle.hard.chanceAlternativeCount(1, action1);
    let worst = 2147483647;
    for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
      const value = this.deviationOutcome(bundle, depth, top,
        action0, argument0, action1, argument1,
        chance % ownChance, Math.floor(chance / ownChance),
        availableAfterAction);
      if (value === INCOMPLETE_VALUE) return INCOMPLETE_VALUE;
      if (value < worst) worst = value;
      if (worst <= rejectAtOrBelow) return worst;
      if (value === 0) {
        this.absoluteLowerBoundCutoffCount += 1; return 0;
      }
    }
    return worst;
  }

  deviationRow(bundle, depth, top, row, availableAfterAction,
      rejectAtOrBelow = -1) {
    let worst = 2147483647;
    for (let column = 0; column < this.enemyCount[top]; column += 1) {
      const value = this.deviationColumn(bundle, depth, top, row, column,
        availableAfterAction, rejectAtOrBelow);
      if (value === INCOMPLETE_VALUE) return INCOMPLETE_VALUE;
      if (value < worst) worst = value;
      if (worst <= rejectAtOrBelow) {
        this.deviationDominanceCutoffCount += 1; return worst;
      }
      if (value === 0) {
        this.absoluteLowerBoundCutoffCount += 1; return 0;
      }
    }
    return worst;
  }

  baselineRow(top, state) {
    const wanted = this.policyAction(state);
    let row = wanted === ACTION.NONE ? -1 :
      this.actionIndex(top, wanted, this.ourCount[top]);
    if (row < 0) row = this.actionIndex(top, ACTION.NONE, this.ourCount[top]);
    if (row < 0) this.baselineMissingCount += 1;
    return row;
  }

  deviationState(bundle, depth, top, deviationAvailable) {
    const state = bundle.state;
    const cached = this.lookupDeviationValue(state, depth,
      deviationAvailable);
    if (cached !== INCOMPLETE_VALUE) return cached;
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generateFull(top, state, 0) ||
        !this.generateFull(top, state, 1)) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return INCOMPLETE_VALUE;
    }
    const baseline = this.baselineRow(top, state);
    if (baseline < 0) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return INCOMPLETE_VALUE;
    }
    this.deviationStateCount += 1;
    let bestRow = baseline;
    let best = this.deviationRow(bundle, depth, top, baseline,
      deviationAvailable);
    if (best === INCOMPLETE_VALUE) return best;
    if (deviationAvailable && best !== MAX_PACKED_VALUE) {
      const count = this.ourCount[top];
      for (let row = 0; row < count; row += 1) {
        if (row === baseline) continue;
        this.deviationCandidateCount += 1;
        const value = this.deviationRow(bundle, depth, top, row, 0, best);
        if (value === INCOMPLETE_VALUE) return value;
        if (preferDeviation(value, best, row, bestRow, baseline)) {
          best = value; bestRow = row;
        }
      }
    } else if (deviationAvailable && best === MAX_PACKED_VALUE) {
      this.deviationUpperBoundCutoffCount += 1;
    }
    if (bestRow !== baseline) {
      this.deviationSelectedCount += 1;
      const action = this.actionAt(top, 0, bestRow);
      if (action < this.deviationActionCount.length)
        this.deviationActionCount[action] += 1;
    }
    this.storeDeviationValue(state, depth, deviationAvailable, best);
    return best;
  }

  evaluateRoot(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4,
      nodeBudget = this.defaultNodeBudget) {
    this.resetDeviation(nodeBudget);
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
      const value = this.deviationColumn(bundle, maximumDepth, 0, 0,
        column, 1);
      this.rootColumnValue[column] = value;
      if (value === INCOMPLETE_VALUE) { worst = INCOMPLETE_VALUE; break; }
      if (value < worst) worst = value;
    }
    this.lastValue = worst; state.undoTo(rootMark);
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

module.exports = { MAX_PACKED_VALUE, deviationCacheKey, preferDeviation,
  OneDeviationRefusalValueSearch };
