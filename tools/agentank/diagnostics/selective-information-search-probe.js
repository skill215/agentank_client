"use strict";

const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { ProductionDepthSearch } =
  require("../../../engine-v2/src/search/production-depth-search");
const { ProductionInformationSearch } =
  require("../../../engine-v2/src/search/production-information-search");

const VALUE_MIN = -32000;
const MARGIN_THRESHOLDS = Object.freeze([0, 250, 500, 1000, 2000, 4000, 8000,
  16000, 64000]);

class SelectiveInformationSearchProbe {
  constructor(engine, contenderCount = 3) {
    this.contenderCount = Math.max(1, Math.min(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS, contenderCount | 0));
    this.shallowCache = new ProductionCacheBank();
    this.deepCache = new ProductionCacheBank();
    this.shallowDepth = new ProductionDepthSearch(
      this.shallowCache, engine.runtime.runtimeConfig);
    this.deepDepth = new ProductionDepthSearch(
      this.deepCache, engine.runtime.runtimeConfig);
    // Production depth-2 already soft-tops to four enemy columns. Keep the
    // shallow pass on the identical response basis; otherwise a two-pass probe
    // measures extra breadth rather than selective continuation.
    this.shallow = new ProductionInformationSearch({ riskProfile: engine.riskProfile,
      maximumEnemyColumns: 4 });
    this.deep = new ProductionInformationSearch({ riskProfile: engine.riskProfile,
      maximumEnemyColumns: 4 });
    this.compactActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.compactArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.compactProjectedCell = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowMap = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.used = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.attempts = 0; this.shallowComplete = 0; this.compactComplete = 0;
    this.fullWinnerInTop1 = 0; this.fullWinnerInTop2 = 0;
    this.fullWinnerInTop3 = 0; this.selectedInTop3 = 0;
    this.fullWinnerInContenders = 0; this.selectedInContenders = 0;
    this.compactWinnerAgreement = 0; this.rootRestoreFailures = 0;
    this.fullWinnerRankCounts = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.selectedRankCounts = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.marginContenderTotal = new Uint32Array(MARGIN_THRESHOLDS.length);
    this.marginFullWinnerIncluded = new Uint32Array(MARGIN_THRESHOLDS.length);
    this.marginSelectedIncluded = new Uint32Array(MARGIN_THRESHOLDS.length);
    this.depthDeltaAbsoluteTotal = 0; this.depthDeltaAbsoluteMaximum = 0;
    this.fullNodes = 0; this.shallowNodes = 0; this.compactNodes = 0;
    this.estimatedSharedNodes = 0; this.hotAllocationCount = 0;
  }
  bestRow(score, count) {
    let best = -1;
    for (let row = 0; row < count; row += 1)
      if (best < 0 || score[row] > score[best]) best = row;
    return best;
  }
  selectedRow(engine, action, argument, count) {
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument) return row;
    return -1;
  }
  capture(engine, selectedAction, selectedArgument) {
    const production = engine.informationSearch;
    if (!engine.adapter.bundle || production.completedDepth < 1 ||
        production.nodes < 1 || engine.ourCount < 1 || engine.enemyCount < 1) return 0;
    const selectionCount = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === 0 ? engine.ourCount - 1 : engine.ourCount;
    if (selectionCount < 1) return 0;
    this.attempts += 1; this.fullNodes += production.nodes;
    const state = engine.adapter.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const budget = Math.max(1, production.nodes);
    const supportComplete = engine.hiddenSupportComplete && engine.adapter.informationComplete;
    const shallowOk = this.shallow.search(engine.adapter.bundle, this.shallowDepth,
      engine.ourActions, engine.ourArguments, selectionCount,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
      supportComplete, budget, engine.policy.baseRisk,
      engine.adapter.lastEnemyDirection, engine.adapter.enemyVisible,
      production.enemyProbability, 1);
    this.shallowNodes += this.shallow.nodes;
    if (!shallowOk || this.shallow.completedDepth < 1) {
      if (state.hashLo !== lo || state.hashHi !== hi ||
          state.deltaUsed * 1024 + state.eventUsed !== mark) this.rootRestoreFailures += 1;
      return 1;
    }
    this.shallow.applyRiskEnvelopes(engine.adapter.bundle, engine.ourActions,
      selectionCount, engine.enemyActions, engine.enemyCount,
      engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
      engine.possibleProjectiles, engine.projectedCell, engine.policy.baseRisk,
      engine.adapter.lastEnemyDirection, engine.adapter.enemyVisible,
      production.enemyProbability);
    this.shallowComplete += 1;
    const fullWinner = this.bestRow(production.rootScore, selectionCount);
    const selected = this.selectedRow(engine, selectedAction, selectedArgument, selectionCount);
    this.used.fill(0, 0, selectionCount);
    const compactCount = Math.min(this.contenderCount, selectionCount);
    let fullRank = -1; let selectedRank = -1;
    for (let rank = 0; rank < selectionCount; rank += 1) {
      let row = -1;
      for (let candidate = 0; candidate < selectionCount; candidate += 1)
        if (!this.used[candidate] && (row < 0 ||
            this.shallow.rootScore[candidate] > this.shallow.rootScore[row])) row = candidate;
      if (row < 0) break;
      this.used[row] = 1; this.rowMap[rank] = row;
      if (rank < compactCount) {
        this.compactActions[rank] = engine.ourActions[row];
        this.compactArguments[rank] = engine.ourArguments[row];
        this.compactProjectedCell[rank] = engine.projectedCell[row];
      }
      if (row === fullWinner) fullRank = rank;
      if (row === selected) selectedRank = rank;
    }
    if (fullRank >= 0) this.fullWinnerRankCounts[fullRank] += 1;
    if (selectedRank >= 0) this.selectedRankCounts[selectedRank] += 1;
    if (fullRank === 0) this.fullWinnerInTop1 += 1;
    if (fullRank >= 0 && fullRank < 2) this.fullWinnerInTop2 += 1;
    if (fullRank >= 0 && fullRank < 3) this.fullWinnerInTop3 += 1;
    if (selectedRank >= 0 && selectedRank < 3) this.selectedInTop3 += 1;
    if (fullRank >= 0 && fullRank < compactCount) this.fullWinnerInContenders += 1;
    if (selectedRank >= 0 && selectedRank < compactCount) this.selectedInContenders += 1;
    const shallowWinner = this.bestRow(this.shallow.rootScore, selectionCount);
    const shallowBest = shallowWinner >= 0 ? this.shallow.rootScore[shallowWinner] : VALUE_MIN;
    for (let thresholdIndex = 0; thresholdIndex < MARGIN_THRESHOLDS.length;
        thresholdIndex += 1) {
      const threshold = MARGIN_THRESHOLDS[thresholdIndex]; let marginCount = 0;
      for (let row = 0; row < selectionCount; row += 1)
        if (shallowBest - this.shallow.rootScore[row] <= threshold) marginCount += 1;
      this.marginContenderTotal[thresholdIndex] += marginCount;
      if (fullWinner >= 0 && shallowBest - this.shallow.rootScore[fullWinner] <= threshold)
        this.marginFullWinnerIncluded[thresholdIndex] += 1;
      if (selected >= 0 && shallowBest - this.shallow.rootScore[selected] <= threshold)
        this.marginSelectedIncluded[thresholdIndex] += 1;
    }
    for (let row = 0; row < selectionCount; row += 1) {
      const delta = Math.abs(production.rootScore[row] - this.shallow.rootScore[row]);
      this.depthDeltaAbsoluteTotal += delta;
      if (delta > this.depthDeltaAbsoluteMaximum) this.depthDeltaAbsoluteMaximum = delta;
    }
    const deepOk = this.deep.search(engine.adapter.bundle, this.deepDepth,
      this.compactActions, this.compactArguments, compactCount,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
      supportComplete, budget, engine.policy.baseRisk,
      engine.adapter.lastEnemyDirection, engine.adapter.enemyVisible,
      production.enemyProbability, 2);
    this.compactNodes += this.deep.nodes;
    this.estimatedSharedNodes += this.shallow.nodes +
      Math.max(0, this.deep.nodes - this.deep.lastMatrixCost);
    if (deepOk && this.deep.completedDepth === 2) {
      this.deep.applyRiskEnvelopes(engine.adapter.bundle, this.compactActions,
        compactCount, engine.enemyActions, engine.enemyCount,
        engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
        engine.possibleProjectiles, this.compactProjectedCell, engine.policy.baseRisk,
        engine.adapter.lastEnemyDirection, engine.adapter.enemyVisible,
        production.enemyProbability);
      this.compactComplete += 1;
      const compactWinner = this.bestRow(this.deep.rootScore, compactCount);
      if (compactWinner >= 0 && this.rowMap[compactWinner] === fullWinner)
        this.compactWinnerAgreement += 1;
    }
    state.undoTo(mark);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) this.rootRestoreFailures += 1;
    return 1;
  }
  summary() {
    return {
      contenderCount: this.contenderCount,
      attempts: this.attempts,
      shallowComplete: this.shallowComplete,
      compactComplete: this.compactComplete,
      fullWinnerInTop1: this.fullWinnerInTop1,
      fullWinnerInTop2: this.fullWinnerInTop2,
      fullWinnerInTop3: this.fullWinnerInTop3,
      selectedInTop3: this.selectedInTop3,
      fullWinnerInContenders: this.fullWinnerInContenders,
      selectedInContenders: this.selectedInContenders,
      compactWinnerAgreement: this.compactWinnerAgreement,
      fullWinnerRankCounts: Array.from(this.fullWinnerRankCounts),
      selectedRankCounts: Array.from(this.selectedRankCounts),
      marginThresholds: Array.from(MARGIN_THRESHOLDS),
      marginContenderTotal: Array.from(this.marginContenderTotal),
      marginFullWinnerIncluded: Array.from(this.marginFullWinnerIncluded),
      marginSelectedIncluded: Array.from(this.marginSelectedIncluded),
      depthDeltaAbsoluteTotal: this.depthDeltaAbsoluteTotal,
      depthDeltaAbsoluteMaximum: this.depthDeltaAbsoluteMaximum,
      rootRestoreFailures: this.rootRestoreFailures,
      fullNodes: this.fullNodes,
      shallowNodes: this.shallowNodes,
      compactNodes: this.compactNodes,
      estimatedSharedNodes: this.estimatedSharedNodes,
      nodeRatioBasisPoints: this.fullNodes > 0 ?
        Math.floor(this.estimatedSharedNodes * 10000 / this.fullNodes) : 0,
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { SelectiveInformationSearchProbe, VALUE_MIN, MARGIN_THRESHOLDS };
