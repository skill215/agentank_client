"use strict";

// BP143 diagnostic-only one-deviation attack-event AND/OR proof.  Positive
// results export a finite continuation policy.  Horizon exhaustion is UNKNOWN.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require(
  "../../../engine-v2/src/abi/search-codes");
const { AttackEventPolicySearch } = require(
  "../../../engine-v2/src/search/attack-event-policy-search");
const { SETTLEMENT } = require("./native-tactical-domain-evaluator-poc");
const { EVENT_GOAL, fireEventStatus, SafeFireEventHorizonSearch } = require(
  "./semantic-attack-event-horizon-shadow");
const { deviationCacheKey } = require(
  "./semantic-attack-one-deviation-value-search");

class OneDeviationAttackEventProof extends SafeFireEventHorizonSearch {
  constructor(goal = EVENT_GOAL.SAFE_THREAT_FIRE, nodeBudget = 32768,
      ttCapacity = 8192) {
    super(goal, nodeBudget);
    if (ttCapacity < 2048 || (ttCapacity & (ttCapacity - 1)) !== 0)
      throw new Error("BP143_TT_CAPACITY_POWER_OF_TWO_REQUIRED");
    if (ttCapacity !== this.ttDepth.length) {
      this.ttLo = new Uint32Array(ttCapacity);
      this.ttHi = new Uint32Array(ttCapacity);
      this.ttSemanticLo = new Uint32Array(ttCapacity);
      this.ttSemanticHi = new Uint32Array(ttCapacity);
      this.ttDepth = new Uint8Array(ttCapacity);
      this.ttStatus = new Uint8Array(ttCapacity);
      this.ttPolicyAction = new Uint8Array(ttCapacity);
      this.ttPolicyArgument = new Uint16Array(ttCapacity);
    }
    this.ttConsumesDeviation = new Uint8Array(ttCapacity);
    this.deviationStateCount = 0; this.deviationRowCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.exportedPolicyCount = 0;
  }

  resetDeviationProof(nodeBudget) {
    this.resetEvent(nodeBudget); this.ttConsumesDeviation.fill(0);
    this.deviationStateCount = 0; this.deviationRowCount = 0;
    this.deviationSelectedCount = 0; this.baselineMissingCount = 0;
    this.exportedPolicyCount = 0;
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

  generateFull(top, state, seat) {
    return AttackEventPolicySearch.prototype.generate.call(
      this, top, state, seat);
  }

  lookupDeviationState(state, depth, available) {
    return this.lookupState(state, deviationCacheKey(depth, available));
  }

  storeDeviationState(state, depth, available, status, action, argument,
      consumesDeviation) {
    if (status === PROOF_STATUS.UNKNOWN) return;
    const key = deviationCacheKey(depth, available);
    this.storeState(state, key, status, action, argument);
    if (status !== PROOF_STATUS.PROVEN) return;
    const slot = this.ttSlot(state, key);
    if (slot >= 0) this.ttConsumesDeviation[slot] = consumesDeviation ? 1 : 0;
  }

  baselineRow(top, state) {
    const wanted = this.policyAction(state);
    let row = wanted === ACTION.NONE ? -1 :
      this.actionIndex(top, wanted, this.ourCount[top]);
    if (row < 0) row = this.actionIndex(top, ACTION.NONE, this.ourCount[top]);
    if (row < 0) this.baselineMissingCount += 1;
    return row;
  }

  proveDeviationOutcome(bundle, depth, top, action0, argument0,
      action1, argument1, chance0, chance1, availableAfterAction) {
    if (this.nodes >= this.nodeBudget) {
      this.budgetStopCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const beforeProjectile = this.projectileCount(bundle.state, 0);
    const status = bundle.kernel.applyFrame(action0, argument0,
      action1, argument1, chance0, chance1);
    this.nodes += 1;
    if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
      this.incompleteCount += 1; this.fastIncompleteCount += 1;
      this.supportLossCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const mark = bundle.kernel.lastMark;
    const hard = bundle.hard.classifyApplied();
    const terminal = bundle.state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
    let result;
    if (hard === HARD_STATUS.INCOMPLETE) {
      this.incompleteCount += 1; this.hardIncompleteCount += 1;
      this.supportLossCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else if (hard !== HARD_STATUS.ALLOW ||
        bundle.state.arrays[ARRAY.TANK_CRASH][0]) {
      result = PROOF_STATUS.DISPROVEN;
    } else if (terminal) {
      result = terminal === TERMINAL.WIN0 ?
        PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
    } else if (action0 === ACTION.FIRE &&
        this.projectileCount(bundle.state, 0) > beforeProjectile) {
      this.fireEventCount += 1;
      const incoming = this.settlement.classifyThreat(bundle.state, 1);
      const outgoing = this.settlement.classifyThreat(bundle.state, 0);
      if (incoming === SETTLEMENT.DOOMED) this.counterUnsafeCount += 1;
      if (outgoing === SETTLEMENT.SURVIVES || outgoing === SETTLEMENT.DOOMED)
        this.threatFireCount += 1;
      if (outgoing === SETTLEMENT.DOOMED) this.doomedFireCount += 1;
      result = fireEventStatus(this.goal, outgoing, incoming);
    } else if (depth <= 1) {
      this.horizonStopCount += 1; result = PROOF_STATUS.UNKNOWN;
    } else result = this.proveDeviationState(bundle, depth - 1, top + 1,
      availableAfterAction);
    bundle.state.undoTo(mark); return result;
  }

  proveDeviationColumn(bundle, depth, top, row, column,
      availableAfterAction) {
    const action0 = this.actionAt(top, 0, row);
    const argument0 = this.argumentAt(top, 0, row);
    const action1 = this.actionAt(top, 1, column);
    const argument1 = this.argumentAt(top, 1, column);
    const ownChance = bundle.hard.chanceAlternativeCount(0, action0);
    const enemyChance = bundle.hard.chanceAlternativeCount(1, action1);
    let unknown = 0;
    for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
      const result = this.proveDeviationOutcome(bundle, depth, top,
        action0, argument0, action1, argument1,
        chance % ownChance, Math.floor(chance / ownChance),
        availableAfterAction);
      if (result === PROOF_STATUS.DISPROVEN) return result;
      if (result === PROOF_STATUS.UNKNOWN) unknown = 1;
    }
    return unknown ? PROOF_STATUS.UNKNOWN : PROOF_STATUS.PROVEN;
  }

  proveDeviationRow(bundle, depth, top, row, availableAfterAction) {
    for (let column = 0; column < this.enemyCount[top]; column += 1) {
      const result = this.proveDeviationColumn(bundle, depth, top, row,
        column, availableAfterAction);
      if (result !== PROOF_STATUS.PROVEN) return result;
    }
    return PROOF_STATUS.PROVEN;
  }

  proveDeviationState(bundle, depth, top, deviationAvailable) {
    const state = bundle.state;
    const cached = this.lookupDeviationState(state, depth, deviationAvailable);
    if (cached) return cached;
    if (top > SEARCH_CAPACITY.MAX_DECISION_DEPTH ||
        !this.generateFull(top, state, 0) ||
        !this.generateFull(top, state, 1)) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return PROOF_STATUS.UNKNOWN;
    }
    const baseline = this.baselineRow(top, state);
    if (baseline < 0) {
      this.incompleteCount += 1; this.supportLossCount += 1;
      return PROOF_STATUS.UNKNOWN;
    }
    this.deviationStateCount += 1;
    let result = this.proveDeviationRow(bundle, depth, top, baseline,
      deviationAvailable);
    let selectedRow = result === PROOF_STATUS.PROVEN ? baseline : -1;
    let sawUnknown = result === PROOF_STATUS.UNKNOWN ? 1 : 0;
    if (selectedRow < 0 && deviationAvailable) {
      for (let row = 0; row < this.ourCount[top]; row += 1) {
        if (row === baseline) continue;
        this.deviationRowCount += 1;
        const rowResult = this.proveDeviationRow(bundle, depth, top, row, 0);
        if (rowResult === PROOF_STATUS.PROVEN) {
          selectedRow = row; result = rowResult; break;
        }
        if (rowResult === PROOF_STATUS.UNKNOWN) sawUnknown = 1;
      }
    }
    if (selectedRow < 0) result = sawUnknown ?
      PROOF_STATUS.UNKNOWN : PROOF_STATUS.DISPROVEN;
    const action = selectedRow < 0 ? ACTION.NONE :
      this.actionAt(top, 0, selectedRow);
    const argument = selectedRow < 0 ? NONE_CELL :
      this.argumentAt(top, 0, selectedRow);
    const consumes = selectedRow >= 0 && selectedRow !== baseline;
    if (consumes) this.deviationSelectedCount += 1;
    this.storeDeviationState(state, depth, deviationAvailable, result,
      action, argument, consumes);
    return result;
  }

  evaluateCandidate(bundle, rootAction, rootArgument, enemyActions,
      enemyArguments, enemyCount, maximumDepth = 4,
      nodeBudget = this.defaultNodeBudget) {
    this.resetDeviationProof(nodeBudget);
    if (!bundle || !enemyActions || !enemyArguments || enemyCount < 1 ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES || maximumDepth < 2 ||
        maximumDepth > SEARCH_CAPACITY.MAX_DECISION_DEPTH || nodeBudget < 1 ||
        !this.visiblePhysical(bundle.state)) {
      this.lastStatus = PROOF_STATUS.UNKNOWN; return this.lastStatus;
    }
    this.ourCount[0] = 1; this.ourActions[0] = rootAction;
    this.ourArguments[0] = rootArgument; this.enemyCount[0] = enemyCount;
    for (let column = 0; column < enemyCount; column += 1) {
      this.enemyActions[column] = enemyActions[column];
      this.enemyArguments[column] = enemyArguments[column];
    }
    const state = bundle.state; const rootLo = state.hashLo;
    const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    this.lastStatus = this.proveDeviationRow(bundle, maximumDepth, 0, 0, 1);
    if (this.lastStatus !== PROOF_STATUS.UNKNOWN)
      this.completedDepth = maximumDepth;
    state.undoTo(rootMark);
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; this.supportLossCount += 1;
      this.lastStatus = PROOF_STATUS.UNKNOWN; this.completedDepth = 0;
    }
    this.lastSupportComplete = this.supportLossCount === 0 &&
      this.budgetStopCount === 0 && this.rootRestoreFailures === 0 &&
      this.ttCapacityStops === 0 && this.unsupportedGenerationStops === 0 ?
      1 : 0;
    if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    return this.lastStatus;
  }

  exportPolicyEntries() {
    const output = [];
    for (let slot = 0; slot < this.ttDepth.length; slot += 1) {
      if (!this.ttDepth[slot] ||
          this.ttStatus[slot] !== PROOF_STATUS.PROVEN) continue;
      const key = this.ttDepth[slot];
      output.push({ semanticLo: this.ttSemanticLo[slot],
        semanticHi: this.ttSemanticHi[slot], depth: key >> 1,
        deviationAvailable: key & 1,
        action: this.ttPolicyAction[slot],
        argument: this.ttPolicyArgument[slot],
        consumesDeviation: this.ttConsumesDeviation[slot] });
    }
    this.exportedPolicyCount = output.length;
    return output;
  }
}

module.exports = { OneDeviationAttackEventProof };
