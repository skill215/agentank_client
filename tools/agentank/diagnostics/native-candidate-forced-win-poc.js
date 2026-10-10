"use strict";

// Diagnostic candidate-level proof owner. The bounded policy value may choose
// which row is worth proving, but it never authorizes the row. Authorization
// comes only from ProductionForcedWinSearch over the complete physical enemy
// action set and every chance outcome.

const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { ProductionForcedWinSearch } = require(
  "../../../engine-v2/src/search/production-forced-win-search");
const { INFORMATION_GAP } = require(
  "../../../engine-v2/src/runtime/production-root");

const ACTION_WIDTH = ACTION.BOOST_RIGHT_BOMB + 1;
const VALUE_MIN = -32000;

class NativeCandidateForcedWinPoc {
  constructor(mode = "shadow", options = {}) {
    this.mode = mode === "active" ? "active" :
      mode === "off" ? "off" : "shadow";
    this.exactDominanceMode = options.exactDominanceMode === "active" ?
      "active" : options.exactDominanceMode === "shadow" ? "shadow" : "off";
    this.depth = Math.max(1, Math.min(8,
      Number.isInteger(options.depth) ? options.depth : 4));
    this.nodeBudget = Math.max(16, Math.min(8192,
      Number.isInteger(options.nodeBudget) ? options.nodeBudget : 512));
    this.proof = options.proofSearch || new ProductionForcedWinSearch();
    this.rootAction = new Uint8Array(1);
    this.rootArgument = new Uint16Array(1);
    this.rootArgument[0] = NONE_CELL;
    this.candidateByAction = new Uint32Array(ACTION_WIDTH);
    this.provenByAction = new Uint32Array(ACTION_WIDTH);
    this.exactDominanceByAction = new Uint32Array(ACTION_WIDTH);
    this.beginRoot();
    this.checkCount = 0; this.informationBlockedCount = 0;
    this.resolvedProjectileGapCount = 0;
    this.possibleProjectileWorldBlockedCount = 0;
    this.incumbentMissingCount = 0; this.sameBestCount = 0;
    this.nonPositiveMarginCount = 0; this.proofCheckCount = 0;
    this.candidateExactCount = 0; this.incumbentExactCount = 0;
    this.exactPairCount = 0; this.exactDominanceCount = 0;
    this.exactDominanceWouldOverrideCount = 0;
    this.exactDominanceOverrideCount = 0;
    this.provenCount = 0; this.disprovenCount = 0; this.unknownCount = 0;
    this.wouldOverrideCount = 0; this.overrideCount = 0;
    this.nodeCount = 0; this.maximumNodes = 0; this.restoreFailureCount = 0;
    this.hotAllocationCount = 0;
  }

  beginRoot() {
    this.lastCertifiedRow = -1; this.lastCandidateRow = -1;
    this.lastExactDominanceRow = -1;
    this.lastIncumbentRow = -1; this.lastMargin = 0;
    this.lastStatus = PROOF_STATUS.UNKNOWN;
  }

  supportedRow(engine, source, row) {
    return engine.hardStatus[row] === HARD_STATUS.ALLOW &&
      (!source.rootDomainRestricted || source.rootDomainMask[row]);
  }

  physicalSupportComplete(engine) {
    if (engine.adapter?.informationComplete) return 1;
    if (engine.adapter?.informationGapMask !==
        INFORMATION_GAP.POSSIBLE_ENEMY_PROJECTILE) return 0;
    const possible = engine.possibleProjectiles;
    if (!possible?.pool?.complete) return 0;
    if (possible.count() > 0) {
      this.possibleProjectileWorldBlockedCount += 1; return 0;
    }
    this.resolvedProjectileGapCount += 1; return 1;
  }

  exactMatrixDominates(engine, source, candidate, incumbent) {
    if (!source.rootCellScore) return 0;
    const stride = Math.trunc(source.rootCellScore.length /
      source.rootScore.length);
    let strict = 0; let compared = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (source.rootEnemyDomainMask && !source.rootEnemyDomainMask[column])
        continue;
      compared += 1;
      const left = source.rootCellScore[candidate * stride + column];
      const right = source.rootCellScore[incumbent * stride + column];
      if (left < right) return 0;
      if (left > right) strict = 1;
    }
    return compared > 0 && strict ? 1 : 0;
  }

  audit(engine, source, count, incumbentAction) {
    this.checkCount += 1;
    if (!this.physicalSupportComplete(engine)) {
      this.informationBlockedCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    let incumbent = -1; let incumbentValue = VALUE_MIN;
    let candidate = -1; let candidateValue = VALUE_MIN;
    for (let row = 0; row < count; row += 1) {
      if (!this.supportedRow(engine, source, row)) continue;
      const value = source.rootScore[row];
      if (engine.ourActions[row] === incumbentAction &&
          (incumbent < 0 || value > incumbentValue)) {
        incumbent = row; incumbentValue = value;
      }
      if (candidate < 0 || value > candidateValue) {
        candidate = row; candidateValue = value;
      }
    }
    this.lastIncumbentRow = incumbent; this.lastCandidateRow = candidate;
    if (incumbent < 0) {
      this.incumbentMissingCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    if (candidate < 0 || engine.ourActions[candidate] === incumbentAction) {
      this.sameBestCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    this.lastMargin = candidateValue - incumbentValue;
    if (this.lastMargin <= 0) {
      this.nonPositiveMarginCount += 1; return PROOF_STATUS.UNKNOWN;
    }
    const action = engine.ourActions[candidate];
    if (source.rowExactBlockMask) {
      const candidateExact = source.rowExactBlockMask[candidate] === 0;
      const incumbentExact = source.rowExactBlockMask[incumbent] === 0;
      if (candidateExact) this.candidateExactCount += 1;
      if (incumbentExact) this.incumbentExactCount += 1;
      if (candidateExact && incumbentExact) {
        this.exactPairCount += 1;
        if (this.exactMatrixDominates(engine, source, candidate, incumbent)) {
          this.exactDominanceCount += 1;
          this.exactDominanceWouldOverrideCount += 1;
          this.lastExactDominanceRow = candidate;
          if (this.exactDominanceMode === "active")
            this.exactDominanceOverrideCount += 1;
          if (action >= 0 && action < ACTION_WIDTH)
            this.exactDominanceByAction[action] += 1;
        }
      }
    }
    if (action >= 0 && action < ACTION_WIDTH) this.candidateByAction[action] += 1;
    if (this.mode === "off") return PROOF_STATUS.UNKNOWN;
    this.rootAction[0] = action; this.rootArgument[0] = engine.ourArguments[candidate];
    this.proofCheckCount += 1;
    const status = this.proof.search(engine.adapter.bundle,
      this.rootAction, this.rootArgument, 1,
      engine.enemyActions, engine.enemyArguments, engine.enemyCount,
      this.depth, this.nodeBudget);
    this.lastStatus = status;
    this.nodeCount += this.proof.nodes || 0;
    this.maximumNodes = Math.max(this.maximumNodes, this.proof.nodes || 0);
    this.restoreFailureCount += this.proof.rootRestoreFailures || 0;
    if (status === PROOF_STATUS.PROVEN && this.proof.winningRootRow === 0 &&
        !(this.proof.rootRestoreFailures > 0)) {
      this.provenCount += 1; this.wouldOverrideCount += 1;
      this.lastCertifiedRow = candidate;
      if (action >= 0 && action < ACTION_WIDTH) this.provenByAction[action] += 1;
      if (this.mode === "active") this.overrideCount += 1;
    } else if (status === PROOF_STATUS.DISPROVEN) this.disprovenCount += 1;
    else this.unknownCount += 1;
    return status;
  }

  summary() {
    return { semantics: "HEURISTIC_PROPOSES_EXACT_POLICY_OR_STRICT_PROOF_AUTHORIZES",
      mode: this.mode, exactDominanceMode: this.exactDominanceMode,
      depth: this.depth, nodeBudget: this.nodeBudget,
      checkCount: this.checkCount,
      informationBlockedCount: this.informationBlockedCount,
      resolvedProjectileGapCount: this.resolvedProjectileGapCount,
      possibleProjectileWorldBlockedCount:
        this.possibleProjectileWorldBlockedCount,
      incumbentMissingCount: this.incumbentMissingCount,
      sameBestCount: this.sameBestCount,
      nonPositiveMarginCount: this.nonPositiveMarginCount,
      candidateExactCount: this.candidateExactCount,
      incumbentExactCount: this.incumbentExactCount,
      exactPairCount: this.exactPairCount,
      exactDominanceCount: this.exactDominanceCount,
      exactDominanceWouldOverrideCount:
        this.exactDominanceWouldOverrideCount,
      exactDominanceOverrideCount: this.exactDominanceOverrideCount,
      proofCheckCount: this.proofCheckCount,
      provenCount: this.provenCount,
      disprovenCount: this.disprovenCount,
      unknownCount: this.unknownCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      nodeCount: this.nodeCount, maximumNodes: this.maximumNodes,
      restoreFailureCount: this.restoreFailureCount,
      candidateByAction: Array.from(this.candidateByAction),
      exactDominanceByAction: Array.from(this.exactDominanceByAction),
      provenByAction: Array.from(this.provenByAction),
      lastCandidateRow: this.lastCandidateRow,
      lastIncumbentRow: this.lastIncumbentRow,
      lastCertifiedRow: this.lastCertifiedRow,
      lastExactDominanceRow: this.lastExactDominanceRow,
      lastMargin: this.lastMargin, lastStatus: this.lastStatus,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativeCandidateForcedWinPoc };
