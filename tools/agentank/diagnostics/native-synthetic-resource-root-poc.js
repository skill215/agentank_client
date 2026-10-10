"use strict";

// Diagnostic-only resource proposal.  The candidate action never enters the
// ProductionRoot action arrays, so action generation cannot accidentally give
// it ownership before this certificate is checked.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, NONE_CELL, NONE_FRAME } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");

const VALUE_MIN = -32000;

class NativeSyntheticResourceRootPoc {
  constructor(mode = "off") {
    this.mode = mode === "active" ? "active" : mode === "shadow" ?
      "shadow" : "off";
    this.checkCount = 0; this.eligibleCount = 0;
    this.strictOwnerBlockedCount = 0; this.committedBlockedCount = 0;
    this.skillBlockedCount = 0; this.visibilityBlockedCount = 0;
    this.effectBlockedCount = 0; this.cadenceBlockedCount = 0;
    this.relevanceBlockedCount = 0; this.baseRowMissingCount = 0;
    this.searchIncompleteCount = 0; this.baseSupportMissingCount = 0;
    this.cellwiseRegressionCount = 0; this.cellwiseTieCount = 0;
    this.terminalLossBlockedCount = 0; this.evidenceCount = 0;
    this.wouldOverrideCount = 0; this.overrideCount = 0;
    this.lastBaseRow = -1; this.lastBaseValue = VALUE_MIN;
    this.lastSyntheticValue = VALUE_MIN; this.lastSyntheticWorst = VALUE_MIN;
    this.hotAllocationCount = 0;
  }

  distance(state, left, right) {
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  incumbentRow(engine, search, action) {
    let best = -1; let value = VALUE_MIN;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] !== action ||
          search.rootDomainMask[row] !== 1) continue;
      if (best < 0 || search.rootScore[row] > value) {
        best = row; value = search.rootScore[row];
      }
    }
    return best;
  }

  eligible(engine) {
    const adapter = engine?.adapter; const state = adapter?.state;
    if (!state || !adapter.ownCanAct || !adapter.ownSkillReady ||
        state.arrays[ARRAY.TANK_SKILL][0] !== SKILL.POISON) {
      this.skillBlockedCount += 1; return 0;
    }
    if (!adapter.enemyVisible) {
      this.visibilityBlockedCount += 1; return 0;
    }
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const poisonUntil = a[ARRAY.TANK_POISON_UNTIL][1];
    const frozenUntil = a[ARRAY.TANK_FROZEN_UNTIL][1];
    const stunUntil = a[ARRAY.TANK_STUN_UNTIL][1];
    if (poisonUntil !== NONE_FRAME && poisonUntil > frame ||
        frozenUntil !== NONE_FRAME && frozenUntil > frame ||
        stunUntil !== NONE_FRAME && stunUntil > frame) {
      this.effectBlockedCount += 1; return 0;
    }
    if (!adapter.enemyCanAct) {
      this.cadenceBlockedCount += 1; return 0;
    }
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const relevant = adapter.enemyCanFire || this.distance(state, own, enemy) <= 9 ||
      star !== NONE_CELL && this.distance(state, enemy, star) <=
        this.distance(state, own, star) + 2;
    if (!relevant) {
      this.relevanceBlockedCount += 1; return 0;
    }
    return 1;
  }

  selectOverride(engine, incumbentAction, incumbentArgument, search,
      preparedThisRoot = true) {
    if (this.mode === "off") return null;
    this.checkCount += 1;
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      this.strictOwnerBlockedCount += 1; return null;
    }
    const escape = engine.escapeObligation;
    if (escape && escape.committedEntityCount > 0) {
      this.committedBlockedCount += 1; return null;
    }
    if (!this.eligible(engine)) return null;
    this.eligibleCount += 1;
    if (!preparedThisRoot || !search ||
        search.representativeSupportComplete !== 1) {
      this.searchIncompleteCount += 1; return null;
    }
    const baseRow = this.incumbentRow(engine, search, incumbentAction);
    this.lastBaseRow = baseRow;
    if (baseRow < 0) {
      this.baseRowMissingCount += 1; return null;
    }
    if (!search.evaluateSyntheticRoot(engine, ACTION.CAST_POISON,
      NONE_CELL, baseRow)) {
      this.searchIncompleteCount += 1; return null;
    }
    this.lastBaseValue = search.rootScore[baseRow];
    this.lastSyntheticValue = search.syntheticRootValue;
    this.lastSyntheticWorst = search.syntheticRootWorst;
    let strict = 0; let compared = 0;
    const baseOffset = baseRow * SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (!search.rootEnemyDomainMask[column]) continue;
      const base = search.rootCellScore[baseOffset + column];
      const candidate = search.syntheticRootCellScore[column];
      if (base === VALUE_MIN || candidate === VALUE_MIN) {
        this.baseSupportMissingCount += 1; return null;
      }
      compared += 1;
      if (candidate < base) {
        this.cellwiseRegressionCount += 1; return null;
      }
      if (candidate > base) strict = 1;
    }
    if (!compared) {
      this.baseSupportMissingCount += 1; return null;
    }
    if (!strict) {
      this.cellwiseTieCount += 1; return null;
    }
    if (search.syntheticRootWorst <= -30000) {
      this.terminalLossBlockedCount += 1; return null;
    }
    this.evidenceCount += 1;
    if (incumbentAction !== ACTION.CAST_POISON) this.wouldOverrideCount += 1;
    if (this.mode !== "active" || incumbentAction === ACTION.CAST_POISON)
      return null;
    this.overrideCount += 1;
    return { action: ACTION.CAST_POISON, argument: NONE_CELL };
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      checkCount: this.checkCount, eligibleCount: this.eligibleCount,
      strictOwnerBlockedCount: this.strictOwnerBlockedCount,
      committedBlockedCount: this.committedBlockedCount,
      skillBlockedCount: this.skillBlockedCount,
      visibilityBlockedCount: this.visibilityBlockedCount,
      effectBlockedCount: this.effectBlockedCount,
      cadenceBlockedCount: this.cadenceBlockedCount,
      relevanceBlockedCount: this.relevanceBlockedCount,
      baseRowMissingCount: this.baseRowMissingCount,
      searchIncompleteCount: this.searchIncompleteCount,
      baseSupportMissingCount: this.baseSupportMissingCount,
      cellwiseRegressionCount: this.cellwiseRegressionCount,
      cellwiseTieCount: this.cellwiseTieCount,
      terminalLossBlockedCount: this.terminalLossBlockedCount,
      evidenceCount: this.evidenceCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      lastBaseRow: this.lastBaseRow, lastBaseValue: this.lastBaseValue,
      lastSyntheticValue: this.lastSyntheticValue,
      lastSyntheticWorst: this.lastSyntheticWorst,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativeSyntheticResourceRootPoc };
