"use strict";

// Diagnostic-only owner for the tiny subset where a semantic-target Option is
// support-complete and a bounded two-Option Minimax strictly dominates the
// incumbent. It never owns incomplete, equal, generated or refuted actions.

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { StableOptionLedgerShadow } = require("./stable-option-ledger-shadow");
const { SemanticObjectiveEpochShadow } = require(
  "./semantic-objective-epoch-shadow");
const { ObjectiveEpochOptionArbiterShadow } = require(
  "./objective-epoch-option-arbiter-shadow");

class SemanticObjectiveEpochOptionActivePoc {
  constructor(runtimeConfig = {}, options = {}) {
    this.runtimeConfig = runtimeConfig; this.options = options;
    this.ledger = null; this.epoch = null; this.arbiter = null;
    this.decisionCount = 0; this.certificateCount = 0;
    this.overrideCount = 0; this.sameActionCount = 0;
    this.finalRejectCount = 0; this.hotAllocationCount = 0;
  }

  initialize(engine) {
    if (this.ledger) return;
    const runtimeConfig = engine && engine.runtime && engine.runtime.runtimeConfig ?
      engine.runtime.runtimeConfig : this.runtimeConfig;
    this.ledger = new StableOptionLedgerShadow();
    this.epoch = new SemanticObjectiveEpochShadow(this.ledger);
    this.arbiter = new ObjectiveEpochOptionArbiterShadow(this.epoch, {
      verifyInterval: true, runtimeConfig,
      depth: this.options.depth || 2,
      nodeBudget: this.options.nodeBudget || 256
    });
  }

  selectOverride(engine, action, argument) {
    this.decisionCount += 1;
    this.initialize(engine);
    this.ledger.observe(engine, action); this.epoch.observe(engine);
    const before = this.arbiter.intervalDominanceCount;
    this.arbiter.observe(engine, action);
    if (this.arbiter.intervalDominanceCount === before) return null;
    this.certificateCount += 1;
    const row = this.arbiter.lastProposal;
    if (row < 0 || row >= engine.ourCount ||
        engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
        !engine.finalGate.finalAllows(engine.adapter.bundle, engine.ourActions,
          engine.ourArguments, row, engine.ourCount)) {
      this.finalRejectCount += 1; return null;
    }
    if (engine.ourActions[row] === action && engine.ourArguments[row] === argument) {
      this.sameActionCount += 1; return null;
    }
    this.overrideCount += 1;
    return { action: engine.ourActions[row], argument: engine.ourArguments[row], row };
  }

  summary() {
    if (!this.ledger) return { decisionCount: this.decisionCount,
      certificateCount: this.certificateCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount, finalRejectCount: this.finalRejectCount,
      hotAllocationCount: this.hotAllocationCount, epoch: null, arbiter: null };
    return { decisionCount: this.decisionCount,
      certificateCount: this.certificateCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount, finalRejectCount: this.finalRejectCount,
      hotAllocationCount: this.hotAllocationCount + this.ledger.hotAllocationCount +
        this.epoch.hotAllocationCount + this.arbiter.hotAllocationCount +
        (this.arbiter.interval ? this.arbiter.interval.hotAllocationCount +
          this.arbiter.interval.search.hotAllocationCount : 0),
      epoch: this.epoch.summary(), arbiter: this.arbiter.summary() };
  }
}

module.exports = { SemanticObjectiveEpochOptionActivePoc };
