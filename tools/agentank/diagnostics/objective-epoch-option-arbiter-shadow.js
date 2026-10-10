"use strict";

// Behavior-neutral arbiter over support-complete Options that already exist in
// the production root. ObjectiveEpoch owns target identity only. This observer
// never expands the primitive domain and never changes an action.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { ObjectiveOptionRouter } = require(
  "../../../engine-v2/src/policy/objective-option-router");
const { LONG_OPTION, OPTION_NAME } = require("./event-driven-option-shadow");
const { TARGET_CLASS } = require("./stable-option-ledger-shadow");
const { OBJECTIVE_EPOCH_STATUS } = require(
  "./objective-epoch-continuity-shadow");
const { CONTINUATION_SEARCH_STATUS, OptionScopedTargetContinuationSearch } =
  require("./option-scoped-target-continuation-search");

const ACTION_BUCKETS = 16;

function named(values) {
  const output = {};
  for (let at = 0; at < LONG_OPTION.COUNT; at += 1)
    output[OPTION_NAME[at]] = values[at];
  return output;
}

function sourceKind(kind) {
  if (kind === OPTION_KIND.DIRECT_KILL || kind === OPTION_KIND.ATTACK_SETUP)
    return LONG_OPTION.ATTACK;
  if (kind === OPTION_KIND.STAR_CONTROL) return LONG_OPTION.STAR_CONTROL;
  if (kind === OPTION_KIND.POSITION) return LONG_OPTION.POSITION;
  return LONG_OPTION.NONE;
}

class ObjectiveEpochOptionArbiterShadow {
  constructor(epoch, options = {}) {
    if (!epoch) throw new Error(
      "ObjectiveEpochOptionArbiterShadow requires ObjectiveEpochContinuityShadow");
    this.epoch = epoch; this.router = new ObjectiveOptionRouter();
    this.interval = options.verifyInterval ?
      new OptionScopedTargetContinuationSearch(options.runtimeConfig || {}, {
        active: false, depth: options.depth || 2,
        nodeBudget: options.nodeBudget || 256 }) : null;
    this.proposalByAction = new Uint32Array(ACTION_BUCKETS);
    this.intervalAttemptByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalCompleteByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalWorseByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalEqualByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalDominanceByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalIncompleteByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.intervalSkippedByKind = new Uint32Array(LONG_OPTION.COUNT);
    this.decisionCount = 0; this.inactiveCount = 0; this.suspendedCount = 0;
    this.noStrictOptionCount = 0; this.currentInsideCount = 0;
    this.currentOutsideCount = 0; this.invalidCurrentRowCount = 0;
    this.verifiedAttackYieldCount = 0; this.proposalCount = 0;
    this.currentOptionSupportedCount = 0; this.currentOptionMissingCount = 0;
    this.searchUnavailableCount = 0; this.searchNotComparableCount = 0;
    this.searchComparableCount = 0; this.searchSupportsCount = 0;
    this.searchRefutesCount = 0; this.searchStrictlyImprovesCount = 0;
    this.searchSelectedProposalCount = 0; this.objectiveSelectedProposalCount = 0;
    this.intervalDominanceCount = 0;
    this.hotAllocationCount = 0; this.lastProposal = -1;
    this.lastCurrent = -1; this.lastMask = 0; this.lastSearchRelation = 0;
    this.sampleCapacity = 16; this.sampleCount = 0;
    this.sampleFrame = new Uint16Array(this.sampleCapacity);
    this.sampleKind = new Uint8Array(this.sampleCapacity);
    this.sampleCurrentAction = new Uint8Array(this.sampleCapacity);
    this.sampleProposalAction = new Uint8Array(this.sampleCapacity);
    this.sampleCurrentRow = new Int8Array(this.sampleCapacity);
    this.sampleProposalRow = new Int8Array(this.sampleCapacity);
    this.sampleTarget = new Uint16Array(this.sampleCapacity);
    this.sampleCurrentScore = new Int32Array(this.sampleCapacity);
    this.sampleProposalScore = new Int32Array(this.sampleCapacity);
    this.sampleNodes = new Uint16Array(this.sampleCapacity);
  }

  currentRow(engine, action) {
    const selected = engine.diagnosticInternalSelectedIndex;
    if (Number.isSafeInteger(selected) && selected >= 0 && selected < engine.ourCount)
      return selected;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }

  qualifiedAttack(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          (portfolio.kind[at] === OPTION_KIND.DIRECT_KILL ||
           portfolio.kind[at] === OPTION_KIND.ATTACK_SETUP)) return 1;
    return 0;
  }

  currentOptionSupported(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at]) return 1;
    return 0;
  }

  candidateOption(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0 || this.epoch.activeSlot < 0) return -1;
    for (let at = 0; at < portfolio.count; at += 1) {
      if (portfolio.primitiveRow[at] !== row || !portfolio.supportComplete[at] ||
          (typeof this.epoch.optionMatchesActiveTarget !== "function" &&
           sourceKind(portfolio.kind[at]) !== this.epoch.activeKind)) continue;
      if (typeof this.epoch.optionMatchesActiveTarget === "function") {
        if (this.epoch.optionMatchesActiveTarget(engine, at, row)) return at;
        continue;
      }
      this.epoch.ledger.deriveTarget(engine, this.epoch.activeKind, row,
        engine.ourActions[row], at);
      const slot = this.epoch.ledger.slotFor(this.epoch.activeKind,
        this.epoch.ledger.tempTargetSignature,
        this.epoch.ledger.tempTargetGeneration);
      if (slot === this.epoch.activeSlot &&
          this.epoch.ledger.generation[slot] === this.epoch.activeGeneration) return at;
    }
    return -1;
  }

  targetCell(engine) {
    const arrays = engine.adapter.state.arrays;
    if (this.epoch.activeKind === LONG_OPTION.ATTACK)
      return engine.adapter.enemyVisible ? arrays[ARRAY.TANK_CELL][1] : NONE_CELL;
    if (this.epoch.activeKind === LONG_OPTION.STAR_CONTROL)
      return arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (this.epoch.activeKind !== LONG_OPTION.POSITION ||
        this.epoch.activeSlot < 0) return NONE_CELL;
    const signature = this.epoch.ledger.targetSignature[this.epoch.activeSlot];
    return signature >>> 28 === TARGET_CLASS.STAR ?
      arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] :
      engine.adapter.enemyVisible ? arrays[ARRAY.TANK_CELL][1] : NONE_CELL;
  }

  objectiveTier(engine, row, target) {
    const action = engine.ourActions[row];
    if (this.epoch.activeKind === LONG_OPTION.ATTACK) {
      if (action === ACTION.FIRE) return 100000;
      return this.router.attackTier(engine, engine.projectedCell[row],
        engine.projectedDirection[row], target) * 100 -
        engine.manhattan(engine.projectedCell[row], target);
    }
    if (target === NONE_CELL) return -32768;
    const distance = engine.manhattan(engine.projectedCell[row], target);
    const desired = this.router.approachDirection(engine.adapter.state,
      engine.projectedCell[row], target);
    return -distance * 10 + (engine.projectedDirection[row] === desired ? 1 : 0);
  }

  betterObjective(engine, left, right, target) {
    if (right < 0) return 1;
    const leftTier = this.objectiveTier(engine, left, target);
    const rightTier = this.objectiveTier(engine, right, target);
    if (leftTier !== rightTier) return leftTier > rightTier ? 1 : 0;
    const risk = engine.riskController;
    if (risk && risk.lexicographicRiskLess(left, right)) return 1;
    if (risk && risk.lexicographicRiskLess(right, left)) return 0;
    return left < right ? 1 : 0;
  }

  searchRowAllowed(source, row) {
    return row >= 0 && row < source.rootOurCount &&
      (!source.rootDomainRestricted || !source.rootDomainMask ||
       source.rootDomainMask[row]);
  }

  recordDominance(engine, current, proposal) {
    if (this.sampleCount >= this.sampleCapacity) return;
    const at = this.sampleCount++;
    this.sampleFrame[at] = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.sampleKind[at] = this.epoch.activeKind;
    this.sampleCurrentAction[at] = engine.ourActions[current];
    this.sampleProposalAction[at] = engine.ourActions[proposal];
    this.sampleCurrentRow[at] = current; this.sampleProposalRow[at] = proposal;
    this.sampleTarget[at] = this.targetCell(engine);
    this.sampleCurrentScore[at] = this.interval.lastSelectedScore;
    this.sampleProposalScore[at] = this.interval.lastCandidateScore;
    this.sampleNodes[at] = this.interval.lastNodes;
  }

  observe(engine, action) {
    this.decisionCount += 1; this.lastProposal = -1;
    this.lastMask = this.epoch.lastExecutionRowMask >>> 0;
    this.lastSearchRelation = 0;
    if (!this.epoch.activeGeneration) { this.inactiveCount += 1; return; }
    if (this.epoch.lastStatus === OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD) {
      this.suspendedCount += 1; return;
    }
    if (!this.lastMask) { this.noStrictOptionCount += 1; return; }
    const current = this.currentRow(engine, action); this.lastCurrent = current;
    if (current < 0) { this.invalidCurrentRowCount += 1; return; }
    if (this.lastMask & (1 << current)) { this.currentInsideCount += 1; return; }
    this.currentOutsideCount += 1;
    if (this.currentOptionSupported(engine, current))
      this.currentOptionSupportedCount += 1;
    else this.currentOptionMissingCount += 1;
    if (this.qualifiedAttack(engine, current)) {
      this.verifiedAttackYieldCount += 1; return;
    }

    const source = this.epoch.searchSource(engine); let proposal = -1;
    if (source) {
      for (let row = 0; row < engine.ourCount; row += 1)
        if (this.lastMask & (1 << row) && this.searchRowAllowed(source, row) &&
            (proposal < 0 || source.rootScore[row] > source.rootScore[proposal]))
          proposal = row;
      if (proposal >= 0 && this.searchRowAllowed(source, current)) {
        this.searchComparableCount += 1;
        const candidateScore = source.rootScore[proposal];
        const currentScore = source.rootScore[current];
        if (candidateScore < currentScore) {
          this.searchRefutesCount += 1; this.lastSearchRelation = -1; return;
        }
        this.searchSupportsCount += 1; this.lastSearchRelation = 1;
        if (candidateScore > currentScore) {
          this.searchStrictlyImprovesCount += 1; this.lastSearchRelation = 2;
        }
        this.searchSelectedProposalCount += 1;
      } else {
        this.searchNotComparableCount += 1; proposal = -1;
      }
    } else this.searchUnavailableCount += 1;

    if (proposal < 0) {
      const target = this.targetCell(engine);
      for (let row = 0; row < engine.ourCount; row += 1)
        if (this.lastMask & (1 << row) &&
            this.betterObjective(engine, row, proposal, target)) proposal = row;
      if (proposal >= 0) this.objectiveSelectedProposalCount += 1;
    }
    if (proposal < 0) return;
    if (this.interval && this.lastSearchRelation === 0) {
      const sourceOption = this.candidateOption(engine, proposal);
      if (sourceOption >= 0) {
        const kind = this.epoch.activeKind;
        this.intervalAttemptByKind[kind] += 1;
        const portfolio = engine.optionPortfolio;
        const signature = this.epoch.ledger.targetSignature[
          this.epoch.activeSlot] >>> 0;
        this.interval.evaluate(engine, engine.adapter.bundle, current, proposal,
          portfolio.targetCell[sourceOption], portfolio.deadline[sourceOption],
          signature, portfolio.kind[sourceOption]);
        if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.DOMINATES) {
          this.intervalDominanceCount += 1;
          this.intervalCompleteByKind[kind] += 1;
          this.intervalDominanceByKind[kind] += 1;
          this.recordDominance(engine, current, proposal);
        } else if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.COMPLETE) {
          this.intervalCompleteByKind[kind] += 1;
          if (this.interval.lastCandidateScore < this.interval.lastSelectedScore)
            this.intervalWorseByKind[kind] += 1;
          else this.intervalEqualByKind[kind] += 1;
        } else if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.INCOMPLETE)
          this.intervalIncompleteByKind[kind] += 1;
        else this.intervalSkippedByKind[kind] += 1;
      }
    }
    this.lastProposal = proposal; this.proposalCount += 1;
    const candidateAction = engine.ourActions[proposal];
    if (candidateAction >= 0 && candidateAction < ACTION_BUCKETS)
      this.proposalByAction[candidateAction] += 1;
  }

  summary() {
    const proposalByAction = {};
    for (const [name, action] of Object.entries(ACTION))
      if (action < ACTION_BUCKETS) proposalByAction[name] = this.proposalByAction[action];
    const dominanceSamples = [];
    for (let at = 0; at < this.sampleCount; at += 1) dominanceSamples.push({
      frame: this.sampleFrame[at], kind: this.sampleKind[at],
      currentAction: this.sampleCurrentAction[at],
      proposalAction: this.sampleProposalAction[at],
      currentRow: this.sampleCurrentRow[at], proposalRow: this.sampleProposalRow[at],
      target: this.sampleTarget[at], currentScore: this.sampleCurrentScore[at],
      proposalScore: this.sampleProposalScore[at], nodes: this.sampleNodes[at] });
    return { decisionCount: this.decisionCount, inactiveCount: this.inactiveCount,
      suspendedCount: this.suspendedCount,
      noStrictOptionCount: this.noStrictOptionCount,
      currentInsideCount: this.currentInsideCount,
      currentOutsideCount: this.currentOutsideCount,
      invalidCurrentRowCount: this.invalidCurrentRowCount,
      verifiedAttackYieldCount: this.verifiedAttackYieldCount,
      currentOptionSupportedCount: this.currentOptionSupportedCount,
      currentOptionMissingCount: this.currentOptionMissingCount,
      proposalCount: this.proposalCount,
      searchUnavailableCount: this.searchUnavailableCount,
      searchNotComparableCount: this.searchNotComparableCount,
      searchComparableCount: this.searchComparableCount,
      searchSupportsCount: this.searchSupportsCount,
      searchRefutesCount: this.searchRefutesCount,
      searchStrictlyImprovesCount: this.searchStrictlyImprovesCount,
      searchSelectedProposalCount: this.searchSelectedProposalCount,
      objectiveSelectedProposalCount: this.objectiveSelectedProposalCount,
      intervalDominanceCount: this.intervalDominanceCount,
      intervalAttemptByKind: named(this.intervalAttemptByKind),
      intervalCompleteByKind: named(this.intervalCompleteByKind),
      intervalWorseByKind: named(this.intervalWorseByKind),
      intervalEqualByKind: named(this.intervalEqualByKind),
      intervalDominanceByKind: named(this.intervalDominanceByKind),
      intervalIncompleteByKind: named(this.intervalIncompleteByKind),
      intervalSkippedByKind: named(this.intervalSkippedByKind),
      interval: this.interval ? this.interval.summary() : null,
      dominanceSamples,
      proposalByAction, hotAllocationCount: this.hotAllocationCount,
      lastProposal: this.lastProposal, lastCurrent: this.lastCurrent,
      lastMask: this.lastMask, lastSearchRelation: this.lastSearchRelation };
  }
}

module.exports = { ObjectiveEpochOptionArbiterShadow };
