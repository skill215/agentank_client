"use strict";

const VALUE_MIN = -32000;
const VALUE_MAX = 32000;
const NONE_ACTION = 255;

const COMMON_POLICY_STATUS = Object.freeze({
  INCOMPLETE: 0,
  COMPLETE: 1,
  CAPACITY: 2,
  INVALID: 3
});

// A compact, diagnostic-only imperfect-information maximin oracle. A branch
// represents one fully enumerated HiddenWorld x EnemyAction x ChanceOutcome.
// Branches with the same observation id must use one common continuation
// action. This is the non-anticipativity condition missing from the old
// per-world Physical continuation.
class CommonPolicyIntervalOracle {
  constructor(maxRootActions = 12, maxBranches = 32,
      maxObservations = 16, maxContinuationActions = 16,
      maxEnemyContinuations = 16) {
    this.maxRootActions = maxRootActions;
    this.maxBranches = maxBranches;
    this.maxObservations = maxObservations;
    this.maxContinuationActions = maxContinuationActions;
    this.maxEnemyContinuations = maxEnemyContinuations;
    this.observation = new Uint8Array(maxRootActions * maxBranches);
    this.validActionMask = new Uint16Array(maxRootActions * maxBranches);
    this.utility = new Int16Array(maxRootActions * maxBranches *
      maxContinuationActions * maxEnemyContinuations);
    this.lower = new Int32Array(maxRootActions);
    this.upper = new Int32Array(maxRootActions);
    this.ordering = new Int32Array(maxRootActions);
    this.bestContinuation = new Uint8Array(maxRootActions * maxObservations);
    this.observationSeen = new Uint8Array(maxObservations);
    this.rootActions = 0; this.branches = 0; this.observations = 0;
    this.continuationActions = 0; this.enemyContinuations = 0;
    this.supportComplete = 0; this.status = COMMON_POLICY_STATUS.INCOMPLETE;
    this.bestRootAction = NONE_ACTION; this.bestValue = VALUE_MIN;
    this.fusedBestValue = VALUE_MIN; this.strategyFusionGap = 0;
    this.hotAllocationCount = 0;
  }

  utilityIndex(root, branch, action, enemy) {
    return (((root * this.maxBranches + branch) * this.maxContinuationActions +
      action) * this.maxEnemyContinuations + enemy);
  }

  configure(rootActions, branches, observations, continuationActions,
      enemyContinuations, supportComplete = 1) {
    if (!Number.isInteger(rootActions) || !Number.isInteger(branches) ||
        !Number.isInteger(observations) || !Number.isInteger(continuationActions) ||
        !Number.isInteger(enemyContinuations) || rootActions < 1 || branches < 1 ||
        observations < 1 || continuationActions < 1 || enemyContinuations < 1)
      return this.status = COMMON_POLICY_STATUS.INVALID;
    if (rootActions > this.maxRootActions || branches > this.maxBranches ||
        observations > this.maxObservations ||
        continuationActions > this.maxContinuationActions ||
        enemyContinuations > this.maxEnemyContinuations)
      return this.status = COMMON_POLICY_STATUS.CAPACITY;
    this.rootActions = rootActions; this.branches = branches;
    this.observations = observations; this.continuationActions = continuationActions;
    this.enemyContinuations = enemyContinuations;
    this.supportComplete = supportComplete ? 1 : 0;
    this.lower.fill(VALUE_MIN, 0, rootActions);
    this.upper.fill(VALUE_MAX, 0, rootActions);
    this.ordering.fill(0, 0, rootActions);
    this.bestContinuation.fill(NONE_ACTION, 0, rootActions * observations);
    this.status = COMMON_POLICY_STATUS.INCOMPLETE;
    this.bestRootAction = NONE_ACTION; this.bestValue = VALUE_MIN;
    this.fusedBestValue = VALUE_MIN; this.strategyFusionGap = 0;
    return this.status;
  }

  setBranch(root, branch, observation, validActionMask) {
    if (root < 0 || root >= this.rootActions || branch < 0 || branch >= this.branches ||
        observation < 0 || observation >= this.observations ||
        !Number.isInteger(validActionMask) || validActionMask < 0 ||
        validActionMask > 0xffff) return 0;
    const at = root * this.maxBranches + branch;
    this.observation[at] = observation;
    this.validActionMask[at] = validActionMask;
    return 1;
  }

  setUtility(root, branch, action, enemy, value) {
    if (root < 0 || root >= this.rootActions || branch < 0 || branch >= this.branches ||
        action < 0 || action >= this.continuationActions || enemy < 0 ||
        enemy >= this.enemyContinuations || !Number.isInteger(value) ||
        value < VALUE_MIN || value > VALUE_MAX) return 0;
    this.utility[this.utilityIndex(root, branch, action, enemy)] = value;
    return 1;
  }

  actionValue(root, observation, action) {
    let value = VALUE_MAX; let members = 0;
    for (let branch = 0; branch < this.branches; branch += 1) {
      const branchAt = root * this.maxBranches + branch;
      if (this.observation[branchAt] !== observation) continue;
      members += 1;
      if (!(this.validActionMask[branchAt] & (1 << action))) return VALUE_MIN;
      for (let enemy = 0; enemy < this.enemyContinuations; enemy += 1) {
        const utility = this.utility[this.utilityIndex(root, branch, action, enemy)];
        if (utility < value) value = utility;
      }
    }
    return members ? value : VALUE_MAX;
  }

  commonPolicyValue(root) {
    this.observationSeen.fill(0, 0, this.observations);
    for (let branch = 0; branch < this.branches; branch += 1)
      this.observationSeen[this.observation[root * this.maxBranches + branch]] = 1;
    let rootValue = VALUE_MAX;
    for (let observation = 0; observation < this.observations; observation += 1) {
      if (!this.observationSeen[observation]) continue;
      let best = VALUE_MIN; let bestAction = NONE_ACTION;
      for (let action = 0; action < this.continuationActions; action += 1) {
        const value = this.actionValue(root, observation, action);
        if (bestAction === NONE_ACTION || value > best) {
          best = value; bestAction = action;
        }
      }
      this.bestContinuation[root * this.maxObservations + observation] = bestAction;
      if (best < rootValue) rootValue = best;
    }
    return rootValue;
  }

  fusedPerBranchValue(root) {
    let rootValue = VALUE_MAX;
    for (let branch = 0; branch < this.branches; branch += 1) {
      const branchAt = root * this.maxBranches + branch; let best = VALUE_MIN;
      for (let action = 0; action < this.continuationActions; action += 1) {
        if (!(this.validActionMask[branchAt] & (1 << action))) continue;
        let value = VALUE_MAX;
        for (let enemy = 0; enemy < this.enemyContinuations; enemy += 1) {
          const utility = this.utility[this.utilityIndex(root, branch, action, enemy)];
          if (utility < value) value = utility;
        }
        if (value > best) best = value;
      }
      if (best < rootValue) rootValue = best;
    }
    return rootValue;
  }

  solve() {
    if (this.rootActions < 1 || this.branches < 1 || this.observations < 1 ||
        this.continuationActions < 1 || this.enemyContinuations < 1)
      return this.status = COMMON_POLICY_STATUS.INVALID;
    this.bestRootAction = NONE_ACTION; this.bestValue = VALUE_MIN;
    this.fusedBestValue = VALUE_MIN;
    for (let root = 0; root < this.rootActions; root += 1) {
      const common = this.commonPolicyValue(root);
      const fused = this.fusedPerBranchValue(root);
      this.ordering[root] = common;
      if (this.supportComplete) this.lower[root] = this.upper[root] = common;
      else { this.lower[root] = VALUE_MIN; this.upper[root] = VALUE_MAX; }
      if (this.bestRootAction === NONE_ACTION || common > this.bestValue) {
        this.bestRootAction = root; this.bestValue = common;
      }
      if (fused > this.fusedBestValue) this.fusedBestValue = fused;
    }
    this.strategyFusionGap = Math.max(0, this.fusedBestValue - this.bestValue);
    this.status = this.supportComplete ? COMMON_POLICY_STATUS.COMPLETE :
      COMMON_POLICY_STATUS.INCOMPLETE;
    return this.status;
  }
}

module.exports = { VALUE_MIN, VALUE_MAX, NONE_ACTION, COMMON_POLICY_STATUS,
  CommonPolicyIntervalOracle };
