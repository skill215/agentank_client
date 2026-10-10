"use strict";

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { ProductionCacheBank } = require(
  "../../../engine-v2/src/cache/production-cache");
const { ProductionDepthSearch } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionInformationSearch } = require(
  "../../../engine-v2/src/search/production-information-search");

const NONE_ROW = 255;

class SelectiveGeometrySearchProbe {
  constructor(engine, maximumRows = 3) {
    this.maximumRows = Math.max(2, Math.min(3, maximumRows | 0));
    this.fullDepth = new ProductionDepthSearch(new ProductionCacheBank(),
      engine.runtime.runtimeConfig);
    this.compactDepth = new ProductionDepthSearch(new ProductionCacheBank(),
      engine.runtime.runtimeConfig);
    this.full = new ProductionInformationSearch({ riskProfile: engine.riskProfile,
      runtimeConfig: engine.runtime.runtimeConfig,
      maximumEnemyColumns: SEARCH_CAPACITY.MAX_ENEMY_POLICIES });
    this.compact = new ProductionInformationSearch({ riskProfile: engine.riskProfile,
      runtimeConfig: engine.runtime.runtimeConfig,
      maximumEnemyColumns: SEARCH_CAPACITY.MAX_ENEMY_POLICIES });
    this.compactActions = new Uint8Array(3);
    this.compactArguments = new Uint16Array(3);
    this.rowMap = new Uint8Array(3);
    this.used = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyOrder = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.attempts = 0; this.geometrySupportSkips = 0;
    this.fullComplete = 0; this.compactComplete = 0;
    this.fullRows = 0; this.compactRows = 0;
    this.fullNodes = 0; this.compactNodes = 0;
    this.fullWinnerIncluded = 0; this.compactWinnerAgreement = 0;
    this.qualifiedFullWinners = 0; this.qualifiedFullWinnerIncluded = 0;
    this.qualifiedCompactWinnerAgreement = 0; this.globalWinnerOutsideRisk = 0;
    this.strictImprovementOpportunities = 0;
    this.strictImprovementAgreements = 0;
    this.strictImprovementFalsePositives = 0;
    this.rowValueComparisons = 0; this.rowValueMismatches = 0;
    this.cellValueComparisons = 0; this.cellValueMismatches = 0;
    this.noSelectedRow = 0; this.rootRestoreFailures = 0;
    this.singleRowSkips = 0;
    this.widthCounts = new Uint32Array(4);
    this.hotAllocationCount = 0;
  }

  selectedRow(engine, action, argument, count) {
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument)
        return row;
    let found = -1;
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === action) {
        if (found >= 0) return -1;
        found = row;
      }
    return found;
  }

  attack(engine, row) {
    const action = engine.ourActions[row]; const outcome = engine.riskController.outcome;
    return action === ACTION.FIRE || action === ACTION.THROW_BOMB ||
      action === ACTION.CAST_OVERLOAD || outcome.combatPurpose[row] !== 0;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const outcome = engine.riskController.outcome;
    if (outcome.tacticalValue[left] !== outcome.tacticalValue[right])
      return outcome.tacticalValue[left] > outcome.tacticalValue[right];
    if (outcome.expectedValue[left] !== outcome.expectedValue[right])
      return outcome.expectedValue[left] > outcome.expectedValue[right];
    return left < right;
  }

  addRow(engine, row, compactCount, totalCount) {
    if (row < 0 || row >= totalCount || this.used[row]) return compactCount;
    if (compactCount >= this.maximumRows) return compactCount;
    this.used[row] = 1; this.rowMap[compactCount] = row;
    this.compactActions[compactCount] = engine.ourActions[row];
    this.compactArguments[compactCount] = engine.ourArguments[row];
    return compactCount + 1;
  }

  selectCandidates(engine, selected, count) {
    this.used.fill(0, 0, count); let compactCount = 0;
    compactCount = this.addRow(engine, selected, compactCount, count);
    const outcome = engine.riskController.outcome; let ordinary = -1; let attack = -1;
    for (let row = 0; row < count; row += 1) {
      if (row === selected || !outcome.acceptable[row] || outcome.dominated[row]) continue;
      if (this.attack(engine, row)) {
        if (this.better(engine, row, attack)) attack = row;
      } else if (this.better(engine, row, ordinary)) ordinary = row;
    }
    compactCount = this.addRow(engine, ordinary, compactCount, count);
    compactCount = this.addRow(engine, attack, compactCount, count);
    // If one class is absent, retain the best remaining Risk/Pareto challenger.
    while (compactCount < this.maximumRows) {
      let best = -1;
      for (let row = 0; row < count; row += 1)
        if (!this.used[row] && outcome.acceptable[row] && !outcome.dominated[row] &&
            this.better(engine, row, best)) best = row;
      if (best < 0) break;
      compactCount = this.addRow(engine, best, compactCount, count);
    }
    return compactCount;
  }

  matrixBudget(search, bundle, actions, count, engine) {
    for (let column = 0; column < engine.enemyCount; column += 1)
      this.enemyOrder[column] = column;
    return search.matrixNodeCount(bundle, actions, count, engine.enemyActions,
      this.enemyOrder, engine.enemyCount) * Math.max(1, engine.hiddenWorldCount);
  }

  bestRow(score, count) {
    let best = -1;
    for (let row = 0; row < count; row += 1)
      if (best < 0 || score[row] > score[best]) best = row;
    return best;
  }

  bestQualifiedRow(engine, score, count, selected) {
    const outcome = engine.riskController.outcome; let best = -1;
    for (let row = 0; row < count; row += 1) {
      const qualified = row === selected ||
        outcome.acceptable[row] && !outcome.dominated[row];
      if (qualified && (best < 0 || score[row] > score[best])) best = row;
    }
    return best;
  }

  capture(engine, selectedAction, selectedArgument) {
    const production = engine.informationSearch; const bundle = engine.adapter.bundle;
    if (!bundle || production.completedDepth !== 1 || engine.ourCount < 2 ||
        engine.enemyCount < 1) return 0;
    const count = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    if (count < 2) return 0;
    this.attempts += 1;
    let mass = 0;
    for (let world = 0; world < engine.hiddenWorldCount; world += 1)
      mass += engine.hiddenWorldMass[world];
    const geometrySupport = engine.hiddenSupportComplete && engine.adapter.enemyVisible &&
      mass === 10000;
    if (!geometrySupport) { this.geometrySupportSkips += 1; return 1; }
    const selected = this.selectedRow(engine, selectedAction, selectedArgument, count);
    if (selected < 0) { this.noSelectedRow += 1; return 1; }
    const compactCount = this.selectCandidates(engine, selected, count);
    if (compactCount < 1) return 1;
    this.widthCounts[compactCount] += 1; this.fullRows += count;
    const state = engine.adapter.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    const fullBudget = this.matrixBudget(this.full, bundle, engine.ourActions, count, engine);
    const fullOk = this.full.search(bundle, this.fullDepth, engine.ourActions,
      engine.ourArguments, count, engine.enemyActions, engine.enemyArguments,
      engine.enemyCount, engine.hiddenWorldCell, engine.hiddenWorldMass,
      engine.hiddenWorldCount, 1, fullBudget, engine.policy.baseRisk,
      engine.adapter.lastEnemyDirection, 1, production.enemyProbability, 1, 0);
    this.fullNodes += this.full.nodes;
    const fullExact = fullOk && this.full.supportComplete && !this.full.approximate;
    if (fullExact) this.fullComplete += 1;
    if (compactCount < 2) {
      this.singleRowSkips += 1;
      state.undoTo(mark);
      if (state.hashLo !== lo || state.hashHi !== hi ||
          state.deltaUsed * 1024 + state.eventUsed !== mark)
        this.rootRestoreFailures += 1;
      return 1;
    }
    this.compactRows += compactCount;
    const compactBudget = this.matrixBudget(this.compact, bundle,
      this.compactActions, compactCount, engine);
    const compactOk = this.compact.search(bundle, this.compactDepth,
      this.compactActions, this.compactArguments, compactCount,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      engine.hiddenWorldCell, engine.hiddenWorldMass, engine.hiddenWorldCount,
      1, compactBudget, engine.policy.baseRisk, engine.adapter.lastEnemyDirection,
      1, production.enemyProbability, 1, 0);
    this.compactNodes += this.compact.nodes;
    const compactExact = compactOk && this.compact.supportComplete && !this.compact.approximate;
    if (compactExact) this.compactComplete += 1;
    if (fullExact && compactExact) {
      const fullWinner = this.bestRow(this.full.rootScore, count);
      let mapped = -1;
      for (let row = 0; row < compactCount; row += 1)
        if (this.rowMap[row] === fullWinner) { mapped = row; break; }
      if (mapped >= 0) this.fullWinnerIncluded += 1;
      const compactWinner = this.bestRow(this.compact.rootScore, compactCount);
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
      if (compactWinner >= 0 && this.rowMap[compactWinner] === fullWinner)
        this.compactWinnerAgreement += 1;
      const qualifiedWinner = this.bestQualifiedRow(engine, this.full.rootScore,
        count, selected);
      if (qualifiedWinner >= 0) {
        this.qualifiedFullWinners += 1; let qualifiedMapped = -1;
        for (let row = 0; row < compactCount; row += 1)
          if (this.rowMap[row] === qualifiedWinner) { qualifiedMapped = row; break; }
        if (qualifiedMapped >= 0) this.qualifiedFullWinnerIncluded += 1;
        if (compactWinner >= 0 && this.rowMap[compactWinner] === qualifiedWinner)
          this.qualifiedCompactWinnerAgreement += 1;
      }
      if (qualifiedWinner !== fullWinner) this.globalWinnerOutsideRisk += 1;
      let selectedCompact = -1;
      for (let row = 0; row < compactCount; row += 1)
        if (this.rowMap[row] === selected) { selectedCompact = row; break; }
      if (selectedCompact >= 0 && compactWinner >= 0 && compactWinner !== selectedCompact &&
          this.compact.rootScore[compactWinner] > this.compact.rootScore[selectedCompact]) {
        this.strictImprovementOpportunities += 1;
        if (mapped === compactWinner) this.strictImprovementAgreements += 1;
        const fullCandidate = this.rowMap[compactWinner];
        if (this.full.rootScore[fullCandidate] <= this.full.rootScore[selected])
          this.strictImprovementFalsePositives += 1;
      }
    }
    state.undoTo(mark);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark)
      this.rootRestoreFailures += 1;
    return 1;
  }

  summary() {
    return {
      maximumRows: this.maximumRows,
      attempts: this.attempts,
      geometrySupportSkips: this.geometrySupportSkips,
      fullComplete: this.fullComplete,
      compactComplete: this.compactComplete,
      fullRows: this.fullRows,
      compactRows: this.compactRows,
      fullNodes: this.fullNodes,
      compactNodes: this.compactNodes,
      nodeRatioBasisPoints: this.fullNodes > 0 ?
        Math.floor(this.compactNodes * 10000 / this.fullNodes) : 0,
      fullWinnerIncluded: this.fullWinnerIncluded,
      compactWinnerAgreement: this.compactWinnerAgreement,
      qualifiedFullWinners: this.qualifiedFullWinners,
      qualifiedFullWinnerIncluded: this.qualifiedFullWinnerIncluded,
      qualifiedCompactWinnerAgreement: this.qualifiedCompactWinnerAgreement,
      globalWinnerOutsideRisk: this.globalWinnerOutsideRisk,
      strictImprovementOpportunities: this.strictImprovementOpportunities,
      strictImprovementAgreements: this.strictImprovementAgreements,
      strictImprovementFalsePositives: this.strictImprovementFalsePositives,
      rowValueComparisons: this.rowValueComparisons,
      rowValueMismatches: this.rowValueMismatches,
      cellValueComparisons: this.cellValueComparisons,
      cellValueMismatches: this.cellValueMismatches,
      noSelectedRow: this.noSelectedRow,
      singleRowSkips: this.singleRowSkips,
      rootRestoreFailures: this.rootRestoreFailures,
      widthCounts: Array.from(this.widthCounts),
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { NONE_ROW, SelectiveGeometrySearchProbe };
