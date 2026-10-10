"use strict";

// Diagnostic-only bounded ObjectiveEpoch owner.  It adopts the production
// controller's semantic objective, then only repairs later callbacks that
// leave a still-supported objective.  Generated FIRE never owns an action;
// FIRE must already belong to the strict, purpose-complete Option domain.

const { ACTION, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require("./event-driven-option-shadow");
const { StableOptionLedgerShadow } = require("./stable-option-ledger-shadow");
const { OBJECTIVE_EPOCH_STATUS, ObjectiveEpochContinuityShadow } = require(
  "./objective-epoch-continuity-shadow");
const { ObjectiveEpochExecutionShadow } = require(
  "./objective-epoch-execution-shadow");

class ObjectiveEpochActivePoc {
  constructor(maximumFrames) {
    this.maximumFrames = maximumFrames;
    this.ledger = new StableOptionLedgerShadow();
    this.epoch = new ObjectiveEpochContinuityShadow(this.ledger);
    this.execution = new ObjectiveEpochExecutionShadow(this.epoch);
    this.decisionCount = 0; this.eligibleCount = 0; this.alreadyInsideCount = 0;
    this.horizonBlockedCount = 0; this.suspendedCount = 0;
    this.verifiedAttackYieldCount = 0;
    this.noExecutionCount = 0; this.noCandidateCount = 0;
    this.searchSelectedCount = 0; this.objectiveSelectedCount = 0;
    this.overrideCount = 0; this.fireOverrideCount = 0;
    this.goOverrideCount = 0; this.turnOverrideCount = 0;
    this.finalRejectCount = 0; this.hotAllocationCount = 0;
    this.lastProposal = -1; this.lastIncumbent = -1;
    this.sampleCapacity = 32; this.sampleCount = 0;
    this.sampleFrame = new Uint16Array(this.sampleCapacity);
    this.sampleKind = new Uint8Array(this.sampleCapacity);
    this.sampleAge = new Uint8Array(this.sampleCapacity);
    this.sampleIncumbent = new Uint8Array(this.sampleCapacity);
    this.sampleProposal = new Uint8Array(this.sampleCapacity);
    this.sampleIncumbentRow = new Int8Array(this.sampleCapacity);
    this.sampleProposalRow = new Int8Array(this.sampleCapacity);
    this.sampleTarget = new Uint16Array(this.sampleCapacity);
    this.sampleMask = new Uint32Array(this.sampleCapacity);
    this.sampleStrictMask = new Uint32Array(this.sampleCapacity);
    this.sampleSearch = new Uint8Array(this.sampleCapacity);
  }

  incumbentRow(engine, action, argument) {
    const internal = engine.diagnosticInternalSelectedIndex;
    if (Number.isSafeInteger(internal) && internal >= 0 &&
        internal < engine.ourCount && engine.ourActions[internal] === action &&
        engine.ourArguments[internal] === argument) return internal;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument &&
          engine.finalGate.finalAllows(engine.adapter.bundle, engine.ourActions,
            engine.ourArguments, row, engine.ourCount)) return row;
    return -1;
  }

  searchArgmax(engine, mask) {
    const source = this.epoch.searchSource(engine);
    if (!source || !source.rootScore || source.rootOurCount <= 0) return -1;
    let best = -1;
    for (let row = 0; row < source.rootOurCount; row += 1) {
      if (!(mask & (1 << row))) continue;
      if (source.rootDomainRestricted && source.rootDomainMask &&
          !source.rootDomainMask[row]) continue;
      if (best < 0 || source.rootScore[row] > source.rootScore[best]) best = row;
    }
    return best;
  }

  qualifiedAttack(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0) return 0;
    for (let at = 0; at < portfolio.count; at += 1) {
      if (portfolio.primitiveRow[at] !== row || !portfolio.supportComplete[at] ||
          (portfolio.kind[at] !== OPTION_KIND.DIRECT_KILL &&
           portfolio.kind[at] !== OPTION_KIND.ATTACK_SETUP)) continue;
      if (this.ledger.classifier.purposeComplete(engine, LONG_OPTION.ATTACK,
          row, engine.ourActions[row])) return 1;
    }
    return 0;
  }

  objectiveTier(engine, row, target) {
    const action = engine.ourActions[row];
    if (this.epoch.activeKind === LONG_OPTION.ATTACK) {
      if (action === ACTION.FIRE) return 100;
      return this.execution.router.attackTier(engine, engine.projectedCell[row],
        engine.projectedDirection[row], target) * 10 -
        engine.manhattan(engine.projectedCell[row], target);
    }
    const distance = engine.manhattan(engine.projectedCell[row], target);
    const desired = this.execution.router.approachDirection(engine.adapter.state,
      engine.projectedCell[row], target);
    return -distance * 10 +
      (engine.projectedDirection[row] === desired ? 1 : 0);
  }

  better(engine, left, right, target) {
    if (right < 0) return 1;
    const leftTier = this.objectiveTier(engine, left, target);
    const rightTier = this.objectiveTier(engine, right, target);
    if (leftTier !== rightTier) return leftTier > rightTier ? 1 : 0;
    if (engine.riskController.lexicographicRiskLess(left, right)) return 1;
    if (engine.riskController.lexicographicRiskLess(right, left)) return 0;
    return left < right ? 1 : 0;
  }

  record(engine, best, searchSelected) {
    if (this.sampleCount >= this.sampleCapacity) return;
    const at = this.sampleCount++;
    this.sampleFrame[at] = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.sampleKind[at] = this.epoch.activeKind;
    this.sampleAge[at] = Math.min(255, this.epoch.activeFrames);
    this.sampleIncumbent[at] = this.lastIncumbent < 0 ? ACTION.NONE :
      engine.ourActions[this.lastIncumbent];
    this.sampleProposal[at] = engine.ourActions[best];
    this.sampleIncumbentRow[at] = this.lastIncumbent;
    this.sampleProposalRow[at] = best;
    this.sampleTarget[at] = this.execution.targetCell(engine);
    this.sampleMask[at] = this.execution.lastExpandedMask;
    this.sampleStrictMask[at] = this.epoch.lastExecutionRowMask;
    this.sampleSearch[at] = searchSelected ? 1 : 0;
  }

  selectOverride(engine, action, argument) {
    this.decisionCount += 1; this.lastProposal = -1;
    this.lastIncumbent = this.incumbentRow(engine, action, argument);
    this.ledger.observe(engine, action); this.epoch.observe(engine);
    this.execution.observe(engine);
    if (this.epoch.lastStatus === OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD) {
      this.suspendedCount += 1; return null;
    }
    if (!this.epoch.activeGeneration ||
        this.epoch.activeFrames > this.maximumFrames) {
      if (this.epoch.activeGeneration) this.horizonBlockedCount += 1;
      return null;
    }
    const mask = this.execution.lastExpandedMask;
    if (!mask) { this.noExecutionCount += 1; return null; }
    this.eligibleCount += 1;
    if (this.lastIncumbent >= 0 && mask & (1 << this.lastIncumbent)) {
      this.alreadyInsideCount += 1; return null;
    }
    if (this.qualifiedAttack(engine, this.lastIncumbent)) {
      this.verifiedAttackYieldCount += 1; return null;
    }
    let best = this.searchArgmax(engine, mask);
    const searchSelected = best >= 0;
    if (searchSelected) this.searchSelectedCount += 1;
    else {
      const target = this.execution.targetCell(engine);
      for (let row = 0; row < engine.ourCount; row += 1) {
        if (!(mask & (1 << row))) continue;
        // Expanded FIRE is only geometric evidence.  Strict Option membership
        // is still required before FIRE may own an action.
        if (engine.ourActions[row] === ACTION.FIRE &&
            !(this.epoch.lastExecutionRowMask & (1 << row))) continue;
        if (this.better(engine, row, best, target)) best = row;
      }
      if (best >= 0) this.objectiveSelectedCount += 1;
    }
    if (best < 0) { this.noCandidateCount += 1; return null; }
    if (engine.hardStatus[best] !== HARD_STATUS.ALLOW ||
        !engine.finalGate.finalAllows(engine.adapter.bundle, engine.ourActions,
          engine.ourArguments, best, engine.ourCount)) {
      this.finalRejectCount += 1; return null;
    }
    this.lastProposal = best; this.overrideCount += 1;
    this.record(engine, best, searchSelected);
    const selectedAction = engine.ourActions[best];
    if (selectedAction === ACTION.FIRE) this.fireOverrideCount += 1;
    else if (selectedAction === ACTION.GO) this.goOverrideCount += 1;
    else if (selectedAction === ACTION.TURN_LEFT ||
        selectedAction === ACTION.TURN_RIGHT) this.turnOverrideCount += 1;
    return { action: selectedAction, argument: engine.ourArguments[best], row: best };
  }

  summary() {
    const samples = [];
    for (let at = 0; at < this.sampleCount; at += 1) samples.push({
      frame: this.sampleFrame[at], kind: this.sampleKind[at], age: this.sampleAge[at],
      incumbent: this.sampleIncumbent[at], proposal: this.sampleProposal[at],
      incumbentRow: this.sampleIncumbentRow[at],
      proposalRow: this.sampleProposalRow[at], target: this.sampleTarget[at],
      mask: this.sampleMask[at], strictMask: this.sampleStrictMask[at],
      searchSelected: this.sampleSearch[at]
    });
    return {
      maximumFrames: this.maximumFrames, decisionCount: this.decisionCount,
      eligibleCount: this.eligibleCount, alreadyInsideCount: this.alreadyInsideCount,
      horizonBlockedCount: this.horizonBlockedCount,
      suspendedCount: this.suspendedCount,
      verifiedAttackYieldCount: this.verifiedAttackYieldCount,
      noExecutionCount: this.noExecutionCount,
      noCandidateCount: this.noCandidateCount,
      searchSelectedCount: this.searchSelectedCount,
      objectiveSelectedCount: this.objectiveSelectedCount,
      overrideCount: this.overrideCount, fireOverrideCount: this.fireOverrideCount,
      goOverrideCount: this.goOverrideCount, turnOverrideCount: this.turnOverrideCount,
      finalRejectCount: this.finalRejectCount,
      samples,
      hotAllocationCount: this.hotAllocationCount + this.ledger.hotAllocationCount +
        this.epoch.hotAllocationCount + this.execution.hotAllocationCount,
      epoch: this.epoch.summary(), execution: this.execution.summary()
    };
  }
}

module.exports = { ObjectiveEpochActivePoc };
