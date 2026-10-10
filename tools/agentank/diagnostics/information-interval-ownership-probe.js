"use strict";

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");

const VALUE_MIN = -32000;
const VALUE_MAX = 32000;

const INFORMATION_INTERVAL_LOSS = Object.freeze({
  INPUT_SUPPORT: 1,
  WORLD_SELECTION: 2,
  WORLD_MASS: 4,
  DIRECTION_SUPPORT: 8,
  ENEMY_COLUMNS: 16,
  OBSERVATION_POLICY: 32,
  WORK_INTERRUPTED: 64,
  NO_RESULT: 128,
  ROOT_RESTORE: 256
});

const LOSS_NAMES = Object.freeze(Object.entries(INFORMATION_INTERVAL_LOSS));

// Diagnostic consumer contract for Information values. Point estimates remain
// useful for ordering, but only a separated interval may own an action:
// candidate.lower > incumbent.upper. Missing support must never be converted
// into a narrow interval merely because a scalar search returned a value.
class InformationDominanceIntervals {
  constructor(maxActions = SEARCH_CAPACITY.MAX_OUR_ACTIONS) {
    this.lower = new Int32Array(maxActions);
    this.upper = new Int32Array(maxActions);
    this.ordering = new Int32Array(maxActions);
    this.reason = new Uint16Array(maxActions);
    this.count = 0;
    this.hotAllocationCount = 0;
  }

  reset(count) {
    this.count = Math.max(0, Math.min(this.lower.length, count | 0));
    this.lower.fill(VALUE_MIN, 0, this.count);
    this.upper.fill(VALUE_MAX, 0, this.count);
    this.ordering.fill(0, 0, this.count);
    this.reason.fill(0, 0, this.count);
  }

  importPointEstimates(score, count, supportComplete, reasonMask = 0) {
    this.reset(count);
    for (let row = 0; row < this.count; row += 1) {
      const value = score && Number.isSafeInteger(score[row]) ?
        Math.max(VALUE_MIN, Math.min(VALUE_MAX, score[row])) : 0;
      this.ordering[row] = value;
      this.reason[row] = reasonMask;
      if (supportComplete && reasonMask === 0) {
        this.lower[row] = value;
        this.upper[row] = value;
      }
    }
    return this.count;
  }

  setInterval(row, lower, upper, reasonMask = 0) {
    if (row < 0 || row >= this.count || !Number.isSafeInteger(lower) ||
        !Number.isSafeInteger(upper) || lower < VALUE_MIN || upper > VALUE_MAX ||
        lower > upper) return 0;
    this.lower[row] = lower;
    this.upper[row] = upper;
    this.reason[row] = reasonMask;
    return 1;
  }

  strictlyDominates(candidate, incumbent) {
    if (candidate < 0 || candidate >= this.count || incumbent < 0 ||
        incumbent >= this.count || candidate === incumbent) return 0;
    return this.lower[candidate] > this.upper[incumbent] ? 1 : 0;
  }

  bestStrictCandidate(incumbent, eligible = null) {
    if (incumbent < 0 || incumbent >= this.count) return -1;
    let best = -1;
    for (let row = 0; row < this.count; row += 1) {
      if (row === incumbent || eligible && !eligible[row] ||
          !this.strictlyDominates(row, incumbent)) continue;
      if (best < 0 || this.lower[row] > this.lower[best] ||
          this.lower[row] === this.lower[best] &&
          (this.upper[row] > this.upper[best] ||
           this.upper[row] === this.upper[best] && row < best)) best = row;
    }
    return best;
  }
}

class InformationIntervalOwnershipProbe {
  constructor() {
    this.intervals = new InformationDominanceIntervals();
    this.attempts = 0;
    this.exactAttempts = 0;
    this.inexactAttempts = 0;
    this.fullRangeRows = 0;
    this.resolvedRows = 0;
    this.pointEstimateDisagreements = 0;
    this.policyOnlyRepairableAttempts = 0;
    this.policyOnlyRepairableDisagreements = 0;
    this.policyOnlyRepairableRows = 0;
    this.hiddenSupportIncompleteAttempts = 0;
    this.observationFactIncompleteAttempts = 0;
    this.geometryCompleteAttempts = 0;
    this.geometryCompleteDisagreements = 0;
    this.geometryCompleteRows = 0;
    this.strictDominanceProposals = 0;
    this.strictDominanceSelected = 0;
    this.maskCounts = new Uint32Array(512);
    this.lossCounts = new Uint32Array(LOSS_NAMES.length);
    this.hotAllocationCount = 0;
  }

  rowFor(engine, action, argument) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument)
        return row;
    // Some legacy actions have no argument while V2 stores NONE_CELL. Action
    // identity is still a useful incumbent fallback when it is unique.
    let found = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action) {
        if (found >= 0) return -1;
        found = row;
      }
    return found;
  }

  bestOrderingRow(count) {
    let best = -1;
    for (let row = 0; row < count; row += 1)
      if (best < 0 || this.intervals.ordering[row] > this.intervals.ordering[best])
        best = row;
    return best;
  }

  reasonMask(engine, search) {
    let mask = 0;
    if (!engine.hiddenSupportComplete || !engine.adapter.informationComplete)
      mask |= INFORMATION_INTERVAL_LOSS.INPUT_SUPPORT;
    if (search.lastSelectedWorldCount !== engine.hiddenWorldCount)
      mask |= INFORMATION_INTERVAL_LOSS.WORLD_SELECTION;
    let mass = 0;
    for (let world = 0; world < engine.hiddenWorldCount; world += 1)
      mass += engine.hiddenWorldMass[world];
    if (mass !== 10000) mask |= INFORMATION_INTERVAL_LOSS.WORLD_MASS;
    if (!engine.adapter.enemyVisible)
      mask |= INFORMATION_INTERVAL_LOSS.DIRECTION_SUPPORT;
    if (search.lastEffectiveEnemyCount !== engine.enemyCount)
      mask |= INFORMATION_INTERVAL_LOSS.ENEMY_COLUMNS;
    // A Physical continuation selected independently inside each hidden world
    // is not a common Information policy before ObservationSplit. It is an
    // ordering estimate, not a lower bound.
    if (search.lastContinuationPool > 0 || search.completedDepth > 1)
      mask |= INFORMATION_INTERVAL_LOSS.OBSERVATION_POLICY;
    if (search.workInterruptedCount > 0)
      mask |= INFORMATION_INTERVAL_LOSS.WORK_INTERRUPTED;
    if (search.completedDepth < 1)
      mask |= INFORMATION_INTERVAL_LOSS.NO_RESULT;
    if (search.rootRestoreFailures > 0)
      mask |= INFORMATION_INTERVAL_LOSS.ROOT_RESTORE;
    return mask;
  }

  capture(engine, selectedAction, selectedArgument) {
    const search = engine && engine.informationSearch;
    if (!search || search.completedDepth < 1 || engine.ourCount < 1) return 0;
    const count = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === 0 ?
      engine.ourCount - 1 : engine.ourCount;
    if (count < 1) return 0;
    const mask = this.reasonMask(engine, search);
    const exact = search.supportComplete === 1 && search.approximate === 0 && mask === 0;
    this.intervals.importPointEstimates(search.rootScore, count, exact, mask);
    this.attempts += 1;
    if (exact) this.exactAttempts += 1;
    else this.inexactAttempts += 1;
    if (!engine.hiddenSupportComplete) this.hiddenSupportIncompleteAttempts += 1;
    if (!engine.adapter.informationComplete)
      this.observationFactIncompleteAttempts += 1;
    this.maskCounts[mask] += 1;
    for (let index = 0; index < LOSS_NAMES.length; index += 1)
      if (mask & LOSS_NAMES[index][1]) this.lossCounts[index] += 1;
    for (let row = 0; row < count; row += 1) {
      if (this.intervals.lower[row] === VALUE_MIN &&
          this.intervals.upper[row] === VALUE_MAX) this.fullRangeRows += 1;
      else this.resolvedRows += 1;
    }
    const incumbent = this.rowFor(engine, selectedAction, selectedArgument);
    if (incumbent < 0) return 1;
    const orderingWinner = this.bestOrderingRow(count);
    if (orderingWinner >= 0 && orderingWinner !== incumbent)
      this.pointEstimateDisagreements += 1;
    const policyOnlyMask = INFORMATION_INTERVAL_LOSS.INPUT_SUPPORT |
      INFORMATION_INTERVAL_LOSS.OBSERVATION_POLICY;
    if (mask === policyOnlyMask) {
      this.policyOnlyRepairableAttempts += 1;
      this.policyOnlyRepairableRows += count;
      if (orderingWinner >= 0 && orderingWinner !== incumbent)
        this.policyOnlyRepairableDisagreements += 1;
    }
    // Potential finite-horizon geometry support. INPUT_SUPPORT currently
    // couples enemy-pose geometry to unrelated observation facts. This count
    // deliberately does not publish an interval or proposal.
    const nonInputMask = mask & ~INFORMATION_INTERVAL_LOSS.INPUT_SUPPORT;
    if (engine.hiddenSupportComplete && nonInputMask === 0) {
      this.geometryCompleteAttempts += 1;
      this.geometryCompleteRows += count;
      if (orderingWinner >= 0 && orderingWinner !== incumbent)
        this.geometryCompleteDisagreements += 1;
    }
    const strict = this.intervals.bestStrictCandidate(incumbent);
    if (strict >= 0) {
      this.strictDominanceProposals += 1;
      if (strict === orderingWinner) this.strictDominanceSelected += 1;
    }
    return 1;
  }

  summary() {
    const lossCounts = {};
    for (let index = 0; index < LOSS_NAMES.length; index += 1)
      lossCounts[LOSS_NAMES[index][0]] = this.lossCounts[index];
    const maskCounts = {};
    for (let mask = 0; mask < this.maskCounts.length; mask += 1)
      if (this.maskCounts[mask]) maskCounts[mask] = this.maskCounts[mask];
    return {
      attempts: this.attempts,
      exactAttempts: this.exactAttempts,
      inexactAttempts: this.inexactAttempts,
      fullRangeRows: this.fullRangeRows,
      resolvedRows: this.resolvedRows,
      pointEstimateDisagreements: this.pointEstimateDisagreements,
      policyOnlyRepairableAttempts: this.policyOnlyRepairableAttempts,
      policyOnlyRepairableDisagreements: this.policyOnlyRepairableDisagreements,
      policyOnlyRepairableRows: this.policyOnlyRepairableRows,
      hiddenSupportIncompleteAttempts: this.hiddenSupportIncompleteAttempts,
      observationFactIncompleteAttempts: this.observationFactIncompleteAttempts,
      geometryCompleteAttempts: this.geometryCompleteAttempts,
      geometryCompleteDisagreements: this.geometryCompleteDisagreements,
      geometryCompleteRows: this.geometryCompleteRows,
      strictDominanceProposals: this.strictDominanceProposals,
      strictDominanceSelected: this.strictDominanceSelected,
      lossCounts,
      maskCounts,
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { VALUE_MIN, VALUE_MAX, INFORMATION_INTERVAL_LOSS,
  InformationDominanceIntervals, InformationIntervalOwnershipProbe };
