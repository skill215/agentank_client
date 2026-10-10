"use strict";

// Diagnostic-only Poison ResourceOption.  The cheap synthetic-root audit is a
// prefilter only.  Ownership requires a second, paired search over the full
// Poison effect deadline.  Baseline and candidate use the same enemy columns,
// continuation generator, backup and leaf semantics; they differ only in the
// root action and the resulting physical Poison cadence.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { RULE } = require("../../../engine-v2/src/generated/fast-config");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, SKILL, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");

const VALUE_MIN = -32000;
const POLICY_BASELINE_FEEDBACK = 1;
const POLICY_POISON_FEEDBACK = 2;
const PURPOSE_SUPPRESS_ENEMY_CADENCE = 1;

class NativePoisonResourceOptionPoc {
  constructor(mode = "off", options = {}) {
    this.mode = mode === "active" ? "active" : mode === "shadow" ?
      "shadow" : "off";
    this.depth = 4;
    this.feedbackMode = options.feedbackMode === "v1-shaped" ?
      "v1-shaped" : "representative";
    this.nodeBudget = Math.max(64, Math.min(4096,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 2048));
    this.checkCount = 0; this.prefilterPassCount = 0;
    this.searchIncompleteCount = 0; this.supportMissingCount = 0;
    this.cellIntervalRegressionCount = 0; this.cellIntervalTieCount = 0;
    this.worstNotImprovedCount = 0; this.robustNotImprovedCount = 0;
    this.terminalLossBlockedCount = 0; this.certificateCount = 0;
    this.wouldOverrideCount = 0; this.overrideCount = 0;
    this.lastPurpose = 0; this.lastDeadline = -1;
    this.lastBaselinePolicy = 0; this.lastCandidatePolicy = 0;
    this.lastBaseRow = -1; this.lastBaseWorst = VALUE_MIN;
    this.lastCandidateWorst = VALUE_MIN; this.lastBaseValue = VALUE_MIN;
    this.lastCandidateValue = VALUE_MIN; this.lastComparedColumns = 0;
    this.hotAllocationCount = 0;
  }

  selectOverride(engine, incumbentAction, incumbentArgument, search,
      syntheticPrefilter, syntheticPrefilterPassed) {
    if (this.mode === "off") return null;
    this.checkCount += 1; this.lastComparedColumns = 0;
    this.lastPurpose = 0; this.lastDeadline = -1;
    this.lastBaselinePolicy = 0; this.lastCandidatePolicy = 0;
    if (!syntheticPrefilterPassed) return null;
    this.prefilterPassCount += 1;
    const state = engine?.adapter?.state;
    const baseRow = syntheticPrefilter?.lastBaseRow ?? -1;
    this.lastBaseRow = baseRow;
    if (!state || !search || baseRow < 0 ||
        typeof search.evaluateSyntheticResourceOption !== "function" ||
        !search.evaluateSyntheticResourceOption(engine, ACTION.CAST_POISON,
          NONE_CELL, baseRow, this.depth, this.nodeBudget,
          this.feedbackMode)) {
      this.searchIncompleteCount += 1; return null;
    }
    let strict = 0;
    for (let column = 0; column < engine.enemyCount; column += 1) {
      if (!search.rootEnemyDomainMask[column]) continue;
      const baseUpper = search.resourceBaseCellUpper[column];
      const candidateLower = search.resourceCandidateCellLower[column];
      if (baseUpper === 32000 || candidateLower === VALUE_MIN) {
        this.supportMissingCount += 1; return null;
      }
      this.lastComparedColumns += 1;
      if (candidateLower < baseUpper) {
        this.cellIntervalRegressionCount += 1; return null;
      }
      if (candidateLower > baseUpper) strict = 1;
    }
    if (!this.lastComparedColumns) {
      this.supportMissingCount += 1; return null;
    }
    if (!strict) {
      this.cellIntervalTieCount += 1; return null;
    }
    this.lastBaseWorst = search.resourceOptionBaseWorst;
    this.lastCandidateWorst = search.resourceOptionCandidateWorst;
    this.lastBaseValue = search.resourceOptionBaseValue;
    this.lastCandidateValue = search.resourceOptionCandidateValue;
    if (this.lastCandidateWorst <= this.lastBaseWorst) {
      this.worstNotImprovedCount += 1; return null;
    }
    if (this.lastCandidateValue <= this.lastBaseValue) {
      this.robustNotImprovedCount += 1; return null;
    }
    if (this.lastCandidateWorst <= -30000) {
      this.terminalLossBlockedCount += 1; return null;
    }
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.lastPurpose = PURPOSE_SUPPRESS_ENEMY_CADENCE;
    this.lastDeadline = frame + RULE.SKILL_DURATION[SKILL.POISON];
    this.lastBaselinePolicy = POLICY_BASELINE_FEEDBACK;
    this.lastCandidatePolicy = POLICY_POISON_FEEDBACK;
    this.certificateCount += 1;
    if (incumbentAction !== ACTION.CAST_POISON) this.wouldOverrideCount += 1;
    if (this.mode !== "active" || incumbentAction === ACTION.CAST_POISON)
      return null;
    this.overrideCount += 1;
    return { action: ACTION.CAST_POISON, argument: NONE_CELL };
  }

  summary() {
    return { enabled: this.mode !== "off", mode: this.mode,
      semantics: "PAIRED_FULL_EFFECT_FEEDBACK_INTERVAL",
      depth: this.depth, nodeBudget: this.nodeBudget,
      feedbackMode: this.feedbackMode,
      checkCount: this.checkCount, prefilterPassCount: this.prefilterPassCount,
      searchIncompleteCount: this.searchIncompleteCount,
      supportMissingCount: this.supportMissingCount,
      cellIntervalRegressionCount: this.cellIntervalRegressionCount,
      cellIntervalTieCount: this.cellIntervalTieCount,
      worstNotImprovedCount: this.worstNotImprovedCount,
      robustNotImprovedCount: this.robustNotImprovedCount,
      terminalLossBlockedCount: this.terminalLossBlockedCount,
      certificateCount: this.certificateCount,
      wouldOverrideCount: this.wouldOverrideCount,
      overrideCount: this.overrideCount,
      lastPurpose: this.lastPurpose, lastDeadline: this.lastDeadline,
      lastBaselinePolicy: this.lastBaselinePolicy,
      lastCandidatePolicy: this.lastCandidatePolicy,
      lastBaseRow: this.lastBaseRow, lastBaseWorst: this.lastBaseWorst,
      lastCandidateWorst: this.lastCandidateWorst,
      lastBaseValue: this.lastBaseValue,
      lastCandidateValue: this.lastCandidateValue,
      lastComparedColumns: this.lastComparedColumns,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { NativePoisonResourceOptionPoc,
  POLICY_BASELINE_FEEDBACK, POLICY_POISON_FEEDBACK,
  PURPOSE_SUPPRESS_ENEMY_CADENCE };
