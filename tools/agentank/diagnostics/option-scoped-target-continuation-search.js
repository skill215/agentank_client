"use strict";

const { ARRAY } = require("../../../engine-v2/src/state/fast-state");
const { HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { RUNTIME_MODE } = require(
  "../../../engine-v2/src/abi/cache-runtime-codes");
const { ProductionCacheBank } = require(
  "../../../engine-v2/src/cache/production-cache");
const { OPTION_KIND, OPTION_EVIDENCE, OptionPortfolioSlab } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { OPTION_SEARCH_STATUS } = require(
  "../../../engine-v2/src/search/option-aware-depth-search");
const { ObjectiveConditionedDepthSearch } = require(
  "../../../engine-v2/src/search/action-continuation-envelope");

const CONTINUATION_SEARCH_STATUS = Object.freeze({ NONE: 0, COMPLETE: 1,
  INCOMPLETE: 2, DOMINATES: 3 });
const OPTION_PRIORITY = Object.freeze([
  OPTION_KIND.COMMITTED_RESCUE, OPTION_KIND.DIRECT_KILL,
  OPTION_KIND.ATTACK_SETUP, OPTION_KIND.STAR_CONTROL, OPTION_KIND.TERMINAL,
  OPTION_KIND.RESOURCE, OPTION_KIND.POSITION
]);

// A deliberately tiny diagnostic Minimax. It runs only after a persistent
// ATTACK target has produced a safe, different primitive. The root contains
// exactly the incumbent and that target candidate, while every enemy column
// remains present. It is evidence-only unless a complete bounded search gives
// the target candidate a strictly larger maximin value.
class OptionScopedTargetContinuationSearch {
  constructor(runtimeConfig = {}, options = {}) {
    this.active = options.active ? 1 : 0;
    this.depth = Math.max(1, Math.min(4,
      Number.isSafeInteger(options.depth) ? options.depth : 2));
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 768));
    this.search = options.search || new ObjectiveConditionedDepthSearch(
      new ProductionCacheBank(), runtimeConfig, null, {
        selectiveContinuationEnabled: true, windowedBoundsEnabled: true,
        crossFramePVEnabled: false, crossFrameRootPVEnabled: false,
        diagnosticNodeCapacity: this.nodeBudget, dynamicPositionTarget: true
      });
    if (this.search.rootTransitions && this.search.rootTransitions.setEnabled)
      this.search.rootTransitions.setEnabled(false);
    this.portfolio = new OptionPortfolioSlab(2);
    this.actions = new Uint8Array(2);
    this.arguments = new Uint16Array(2);
    this.attemptCount = 0; this.triggerCount = 0; this.completeCount = 0;
    this.incompleteCount = 0; this.supportSkipCount = 0;
    this.runtimeSkipCount = 0; this.safetySkipCount = 0;
    this.strictDominanceCount = 0; this.shadowDominanceCount = 0;
    this.candidateWorseCount = 0; this.equalValueCount = 0;
    this.proposalCount = 0; this.totalNodes = 0; this.maximumNodes = 0;
    this.rootRestoreFailureCount = 0; this.hotAllocationCount = 0;
    this.lastStatus = CONTINUATION_SEARCH_STATUS.NONE;
    this.lastSelectedScore = 0; this.lastCandidateScore = 0;
    this.lastCompletedDepth = 0; this.lastNodes = 0;
  }

  incumbentOption(engine, selected) {
    const source = engine.optionPortfolio;
    if (!source) return -1;
    for (const kind of OPTION_PRIORITY)
      for (let at = 0; at < source.count; at += 1)
        if (source.primitiveRow[at] === selected && source.kind[at] === kind &&
            source.supportComplete[at]) return at;
    return -1;
  }

  exactPhysicalSupport(engine) {
    if (!engine.adapter || !engine.adapter.enemyVisible || engine.enemyCount < 1)
      return 0;
    // Possible-projectile/soft observation uncertainty remains owned by the
    // already-applied Risk non-regression gate. Requiring the independent
    // ObservationSafety closure here would duplicate that owner and suppress
    // the same bounded Physical search that production already accepts.
    if (Number.isSafeInteger(engine.hiddenWorldCount) &&
        (engine.hiddenWorldCount !== 1 || !engine.hiddenWorldMass ||
          engine.hiddenWorldMass[0] !== 10000)) return 0;
    return 1;
  }

  rootOption(search, primitive) {
    let best = -1;
    for (let option = 0; option < search.optionCount; option += 1)
      if (search.optionPrimitiveRow[option] === primitive &&
          (best < 0 || search.rootScore[option] > search.rootScore[best])) best = option;
    return best;
  }

  evaluate(engine, bundle, selected, candidate, targetCell, deadline = 0xffff,
      signature = 0, candidateKind = OPTION_KIND.ATTACK_SETUP) {
    this.attemptCount += 1; this.lastStatus = CONTINUATION_SEARCH_STATUS.NONE;
    this.lastCompletedDepth = 0; this.lastNodes = 0;
    if (!bundle || selected < 0 || candidate < 0 || selected === candidate ||
        selected >= engine.ourCount || candidate >= engine.ourCount) {
      this.supportSkipCount += 1; return 0;
    }
    if (!engine.runtime || engine.runtime.runtimeMode !== RUNTIME_MODE.NORMAL) {
      this.runtimeSkipCount += 1; return 0;
    }
    if (!this.exactPhysicalSupport(engine)) {
      this.supportSkipCount += 1; return 0;
    }
    const outcome = engine.riskController && engine.riskController.outcome;
    if (!outcome || engine.hardStatus[selected] !== HARD_STATUS.ALLOW ||
        engine.hardStatus[candidate] !== HARD_STATUS.ALLOW ||
        !outcome.acceptable[selected] || !outcome.acceptable[candidate]) {
      this.safetySkipCount += 1; return 0;
    }
    const incumbent = this.incumbentOption(engine, selected);
    const source = engine.optionPortfolio;
    if (incumbent < 0 || targetCell === NONE_CELL) {
      this.supportSkipCount += 1; return 0;
    }
    this.portfolio.reset();
    this.portfolio.add(0, source.kind[incumbent], source.targetCell[incumbent],
      source.targetSignature[incumbent], source.deadline[incumbent],
      source.evidence[incumbent], 1);
    this.portfolio.add(1, candidateKind, targetCell, signature,
      deadline, OPTION_EVIDENCE.COMBAT | OPTION_EVIDENCE.TARGET |
        OPTION_EVIDENCE.COMPLETE, 1);
    this.actions[0] = engine.ourActions[selected];
    this.arguments[0] = engine.ourArguments[selected];
    this.actions[1] = engine.ourActions[candidate];
    this.arguments[1] = engine.ourArguments[candidate];
    const state = engine.adapter.state;
    const hashLo = state.hashLo; const hashHi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    this.triggerCount += 1;
    const complete = this.search.searchPortfolio(bundle, this.portfolio,
      this.actions, this.arguments, 2, engine.enemyActions, engine.enemyArguments,
      engine.enemyCount, this.depth, this.nodeBudget, engine.policy.baseRisk, 0);
    this.lastNodes = this.search.nodes; this.totalNodes += this.lastNodes;
    if (this.lastNodes > this.maximumNodes) this.maximumNodes = this.lastNodes;
    const restored = state.hashLo === hashLo && state.hashHi === hashHi &&
      state.deltaUsed * 1024 + state.eventUsed === mark;
    if (!restored)
      this.rootRestoreFailureCount += 1;
    const supportComplete = complete &&
      this.search.lastStatus === OPTION_SEARCH_STATUS.COMPLETE &&
      this.search.representativeSupportComplete === 1 &&
      this.search.rootEnemyCount === engine.enemyCount &&
      this.search.rootRestoreFailures === 0 && restored;
    if (!supportComplete) {
      this.incompleteCount += 1;
      this.lastStatus = CONTINUATION_SEARCH_STATUS.INCOMPLETE; return 0;
    }
    const selectedOption = this.rootOption(this.search, 0);
    const candidateOption = this.rootOption(this.search, 1);
    if (selectedOption < 0 || candidateOption < 0) {
      this.incompleteCount += 1;
      this.lastStatus = CONTINUATION_SEARCH_STATUS.INCOMPLETE; return 0;
    }
    this.completeCount += 1; this.lastCompletedDepth = this.search.completedDepth;
    this.lastSelectedScore = this.search.rootScore[selectedOption];
    this.lastCandidateScore = this.search.rootScore[candidateOption];
    this.lastStatus = CONTINUATION_SEARCH_STATUS.COMPLETE;
    if (this.lastCandidateScore < this.lastSelectedScore) {
      this.candidateWorseCount += 1; return 0;
    }
    if (this.lastCandidateScore === this.lastSelectedScore) {
      this.equalValueCount += 1; return 0;
    }
    this.strictDominanceCount += 1;
    this.lastStatus = CONTINUATION_SEARCH_STATUS.DOMINATES;
    if (!this.active) { this.shadowDominanceCount += 1; return 0; }
    this.proposalCount += 1; return 1;
  }

  summary() {
    return { enabled: true, active: Boolean(this.active), depth: this.depth,
      nodeBudget: this.nodeBudget, attemptCount: this.attemptCount,
      triggerCount: this.triggerCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, supportSkipCount: this.supportSkipCount,
      runtimeSkipCount: this.runtimeSkipCount, safetySkipCount: this.safetySkipCount,
      strictDominanceCount: this.strictDominanceCount,
      candidateWorseCount: this.candidateWorseCount,
      equalValueCount: this.equalValueCount,
      shadowDominanceCount: this.shadowDominanceCount,
      proposalCount: this.proposalCount, totalNodes: this.totalNodes,
      maximumNodes: this.maximumNodes,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      lastStatus: this.lastStatus, lastSelectedScore: this.lastSelectedScore,
      lastCandidateScore: this.lastCandidateScore,
      lastCompletedDepth: this.lastCompletedDepth, lastNodes: this.lastNodes,
      hotAllocationCount: this.hotAllocationCount + this.search.hotAllocationCount };
  }
}

module.exports = { CONTINUATION_SEARCH_STATUS,
  OptionScopedTargetContinuationSearch };
