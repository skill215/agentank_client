"use strict";

const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { NativeStunTurnDomainCompactionPoc } = require(
  "./native-stun-turn-domain-compaction-poc");

const DEPTH_SLOTS = 10;
const POLICY_SLOTS = 3;
const ACTION_SLOTS = ACTION.BOOST_RIGHT_BOMB + 1;

class NativeBudgetFrontierCensusPoc extends NativeStunTurnDomainCompactionPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.budgetObserver = this;
    this.stateEntryByDepth = new Uint32Array(DEPTH_SLOTS);
    this.stateLeafByDepth = new Uint32Array(DEPTH_SLOTS);
    this.branchLeafByDepth = new Uint32Array(DEPTH_SLOTS);
    this.ttHitByDepth = new Uint32Array(DEPTH_SLOTS);
    this.domainVisitByDepth = new Uint32Array(DEPTH_SLOTS);
    this.domainActionTotalByDepth = new Uint32Array(DEPTH_SLOTS);
    this.transitionBudgetStopByDepth = new Uint32Array(DEPTH_SLOTS);
    this.nodeBudgetStopByDepth = new Uint32Array(DEPTH_SLOTS);
    this.budgetStopByPolicy = new Uint32Array(POLICY_SLOTS);
    this.budgetStopByOwnAction = new Uint32Array(ACTION_SLOTS);
    this.budgetStopByEnemyAction = new Uint32Array(ACTION_SLOTS);
    this.frontierCensusHotAllocationCount = 0;
  }

  observeBudgetStop(kind, depth, ownAction, enemyAction, policyId) {
    if (kind === 1) this.transitionBudgetStopByDepth[depth] += 1;
    else this.nodeBudgetStopByDepth[depth] += 1;
    if (policyId < POLICY_SLOTS) this.budgetStopByPolicy[policyId] += 1;
    if (ownAction < ACTION_SLOTS) this.budgetStopByOwnAction[ownAction] += 1;
    if (enemyAction < ACTION_SLOTS)
      this.budgetStopByEnemyAction[enemyAction] += 1;
  }

  expandMassState(engine, search, depth) {
    this.stateEntryByDepth[depth] += 1;
    return super.expandMassState(engine, search, depth);
  }

  setStateLeaf(depth, mask) {
    this.stateLeafByDepth[depth] += 1;
    return super.setStateLeaf(depth, mask);
  }

  setBranchLeaf(depth, mask) {
    this.branchLeafByDepth[depth] += 1;
    return super.setBranchLeaf(depth, mask);
  }

  copyTtToState(index, depth) {
    this.ttHitByDepth[depth] += 1;
    return super.copyTtToState(index, depth);
  }

  copyEnemyDomain(engine, search, depth) {
    const count = super.copyEnemyDomain(engine, search, depth);
    this.domainVisitByDepth[depth] += 1;
    this.domainActionTotalByDepth[depth] += count;
    return count;
  }

  summary() {
    return { ...super.summary(),
      semantics: "DUAL_POLICY_BUDGET_FRONTIER_CENSUS",
      budgetFrontierCensus: true,
      stateEntryByDepth: Array.from(this.stateEntryByDepth),
      stateLeafByDepth: Array.from(this.stateLeafByDepth),
      branchLeafByDepth: Array.from(this.branchLeafByDepth),
      ttHitByDepth: Array.from(this.ttHitByDepth),
      domainVisitByDepth: Array.from(this.domainVisitByDepth),
      domainActionTotalByDepth: Array.from(this.domainActionTotalByDepth),
      transitionBudgetStopByDepth:
        Array.from(this.transitionBudgetStopByDepth),
      nodeBudgetStopByDepth: Array.from(this.nodeBudgetStopByDepth),
      budgetStopByPolicy: Array.from(this.budgetStopByPolicy),
      budgetStopByOwnAction: Array.from(this.budgetStopByOwnAction),
      budgetStopByEnemyAction: Array.from(this.budgetStopByEnemyAction),
      frontierCensusHotAllocationCount:
        this.frontierCensusHotAllocationCount };
  }
}

module.exports = { NativeBudgetFrontierCensusPoc };
