"use strict";

// Diagnostic-only ACTIVE owner for newly completed BP121 branch-local policy
// dominance. Incomplete, equal, refuted, or already-strict roots never own.

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { StableOptionLedgerShadow } = require("./stable-option-ledger-shadow");
const { SemanticObjectiveEpochShadow } = require(
  "./semantic-objective-epoch-shadow");
const { SemanticAttackOptionCoverageShadow } = require(
  "./semantic-attack-option-coverage-shadow");
const { SemanticAttackPolicyIntervalShadow } = require(
  "./semantic-attack-policy-interval-shadow");

class SemanticAttackPolicyIntervalActivePoc {
  constructor(runtimeConfig = {}, options = {}) {
    this.runtimeConfig = runtimeConfig; this.options = options;
    this.ledger = null; this.epoch = null; this.coverage = null;
    this.shadow = null;
    this.decisionCount = 0; this.certificateCount = 0;
    this.overrideCount = 0; this.sameActionCount = 0;
    this.finalRejectCount = 0; this.hotAllocationCount = 0;
  }

  initialize(engine) {
    if (this.ledger) return;
    const runtimeConfig = engine?.runtime?.runtimeConfig || this.runtimeConfig;
    this.ledger = new StableOptionLedgerShadow();
    this.epoch = new SemanticObjectiveEpochShadow(this.ledger);
    this.coverage = new SemanticAttackOptionCoverageShadow(this.epoch);
    this.shadow = new SemanticAttackPolicyIntervalShadow(
      this.epoch, this.coverage, runtimeConfig, {
        depth: this.options.depth || 2,
        nodeBudget: this.options.nodeBudget || 256,
        commonContinuation: this.options.commonContinuation === true
      });
  }

  selectOverride(engine, action, argument) {
    this.decisionCount += 1; this.initialize(engine);
    this.ledger.observe(engine, action); this.epoch.observe(engine);
    this.coverage.observe(engine, action);
    const before = this.shadow.strictDominanceCount;
    this.shadow.observe(engine, action);
    if (this.shadow.strictDominanceCount === before) return null;
    this.certificateCount += 1;
    const row = this.shadow.lastProposal;
    if (row < 0 || row >= engine.ourCount ||
        engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
        !engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, row, engine.ourCount)) {
      this.finalRejectCount += 1; return null;
    }
    if (engine.ourActions[row] === action && engine.ourArguments[row] === argument) {
      this.sameActionCount += 1; return null;
    }
    this.overrideCount += 1;
    return { action: engine.ourActions[row], argument: engine.ourArguments[row], row };
  }

  summary() {
    if (!this.shadow) return { decisionCount: this.decisionCount,
      certificateCount: this.certificateCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount, finalRejectCount: this.finalRejectCount,
      hotAllocationCount: this.hotAllocationCount, shadow: null };
    return { decisionCount: this.decisionCount,
      certificateCount: this.certificateCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount, finalRejectCount: this.finalRejectCount,
      hotAllocationCount: this.hotAllocationCount + this.ledger.hotAllocationCount +
        this.epoch.hotAllocationCount + this.coverage.hotAllocationCount +
        this.shadow.totalHotAllocationCount(),
      shadow: this.shadow.summary() };
  }
}

module.exports = { SemanticAttackPolicyIntervalActivePoc };
