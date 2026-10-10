"use strict";

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { ProductionCacheBank } = require(
  "../../../engine-v2/src/cache/production-cache");
const { ProductionDepthSearch } = require(
  "../../../engine-v2/src/search/production-depth-search");

const PROBE_NODE_BUDGET = 2048;

class RiskFrontierPhysicalSearchProbe {
  constructor(engine) {
    this.full = new ProductionDepthSearch(new ProductionCacheBank(),
      engine.runtime.runtimeConfig, null, { selectiveContinuationEnabled: true,
        windowedBoundsEnabled: true, diagnosticNodeCapacity: PROBE_NODE_BUDGET });
    this.compact = new ProductionDepthSearch(new ProductionCacheBank(),
      engine.runtime.runtimeConfig, null, { selectiveContinuationEnabled: true,
        windowedBoundsEnabled: true, diagnosticNodeCapacity: PROBE_NODE_BUDGET });
    this.compactActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.compactArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.rowMap = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.attempts = 0; this.singleRowSkips = 0; this.fullComplete = 0;
    this.compactComplete = 0; this.fullRows = 0; this.compactRows = 0;
    this.fullNodes = 0; this.compactNodes = 0; this.rowValueComparisons = 0;
    this.rowValueMismatches = 0; this.cellValueComparisons = 0;
    this.cellValueMismatches = 0; this.winnerComparisons = 0;
    this.winnerMismatches = 0; this.rootRestoreFailures = 0;
    this.widthCounts = new Uint32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS + 1);
    this.hotAllocationCount = 0;
  }

  frontier(engine, count) {
    const outcome = engine.riskController.outcome; let compactCount = 0;
    for (let row = 0; row < count; row += 1)
      if (outcome.acceptable[row] && !outcome.dominated[row]) {
        this.rowMap[compactCount] = row;
        this.compactActions[compactCount] = engine.ourActions[row];
        this.compactArguments[compactCount] = engine.ourArguments[row];
        compactCount += 1;
      }
    return compactCount;
  }

  bestFrontierFull(engine, compactCount) {
    let best = -1;
    for (let compactRow = 0; compactRow < compactCount; compactRow += 1) {
      const row = this.rowMap[compactRow];
      if (best < 0 || this.full.rootScore[row] > this.full.rootScore[best] ||
          this.full.rootScore[row] === this.full.rootScore[best] && row < best) best = row;
    }
    return best;
  }

  bestCompact(compactCount) {
    let best = -1;
    for (let row = 0; row < compactCount; row += 1)
      if (best < 0 || this.compact.rootScore[row] > this.compact.rootScore[best] ||
          this.compact.rootScore[row] === this.compact.rootScore[best] &&
          this.rowMap[row] < this.rowMap[best]) best = row;
    return best;
  }

  capture(engine) {
    const production = engine.depthSearch; const bundle = engine.adapter.bundle;
    if (!bundle || !production.representativeSupportComplete ||
        production.representativeSupportDepth < 2 || engine.enemyCount < 1) return 0;
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    const compactCount = this.frontier(engine, count);
    if (compactCount < 1) return 0;
    this.attempts += 1; this.fullRows += count; this.compactRows += compactCount;
    this.widthCounts[compactCount] += 1;
    if (compactCount < 2) this.singleRowSkips += 1;
    const state = engine.adapter.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    this.full.search(bundle, engine.ourActions, engine.ourArguments, count,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount, 2,
      PROBE_NODE_BUDGET, engine.policy.baseRisk);
    this.fullNodes += this.full.nodes;
    const fullExact = this.full.representativeSupportComplete &&
      this.full.representativeSupportDepth === 2;
    if (fullExact) this.fullComplete += 1;
    state.undoTo(mark);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark)
      this.rootRestoreFailures += 1;
    this.compact.search(bundle, this.compactActions, this.compactArguments, compactCount,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount, 2,
      PROBE_NODE_BUDGET, engine.policy.baseRisk);
    this.compactNodes += this.compact.nodes;
    const compactExact = this.compact.representativeSupportComplete &&
      this.compact.representativeSupportDepth === 2;
    if (compactExact) this.compactComplete += 1;
    if (fullExact && compactExact) {
      for (let compactRow = 0; compactRow < compactCount; compactRow += 1) {
        const fullRow = this.rowMap[compactRow]; this.rowValueComparisons += 1;
        if (this.compact.rootScore[compactRow] !== this.full.rootScore[fullRow])
          this.rowValueMismatches += 1;
        for (let column = 0; column < engine.enemyCount; column += 1) {
          const compactAt = compactRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
          const fullAt = fullRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES + column;
          this.cellValueComparisons += 1;
          if (this.compact.rootCellScore[compactAt] !== this.full.rootCellScore[fullAt])
            this.cellValueMismatches += 1;
        }
      }
      const fullWinner = this.bestFrontierFull(engine, compactCount);
      const compactWinner = this.bestCompact(compactCount);
      this.winnerComparisons += 1;
      if (compactWinner < 0 || this.rowMap[compactWinner] !== fullWinner)
        this.winnerMismatches += 1;
    }
    state.undoTo(mark);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark)
      this.rootRestoreFailures += 1;
    return 1;
  }

  summary() {
    return { attempts: this.attempts, singleRowSkips: this.singleRowSkips,
      fullComplete: this.fullComplete, compactComplete: this.compactComplete,
      fullRows: this.fullRows, compactRows: this.compactRows,
      fullNodes: this.fullNodes, compactNodes: this.compactNodes,
      nodeRatioBasisPoints: this.fullNodes > 0 ?
        Math.floor(this.compactNodes * 10000 / this.fullNodes) : 0,
      rowValueComparisons: this.rowValueComparisons,
      rowValueMismatches: this.rowValueMismatches,
      cellValueComparisons: this.cellValueComparisons,
      cellValueMismatches: this.cellValueMismatches,
      winnerComparisons: this.winnerComparisons,
      winnerMismatches: this.winnerMismatches,
      rootRestoreFailures: this.rootRestoreFailures,
      widthCounts: Array.from(this.widthCounts), hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { PROBE_NODE_BUDGET, RiskFrontierPhysicalSearchProbe };
