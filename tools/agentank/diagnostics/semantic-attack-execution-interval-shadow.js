"use strict";

// Diagnostic-only bridge from a semantic ATTACK target to a route-proven
// execution candidate. Geometry proposes; complete two-Option Minimax decides.
// This class never owns or changes the emitted action.

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require("./event-driven-option-shadow");
const { OBJECTIVE_EPOCH_STATUS } = require(
  "./objective-epoch-continuity-shadow");
const { AttackObjectiveFieldProposal } = require("./attack-objective-field");
const { CONTINUATION_SEARCH_STATUS, OptionScopedTargetContinuationSearch } =
  require("./option-scoped-target-continuation-search");

const ACTION_BUCKETS = 16;

function namedActions(values) {
  const output = {};
  for (const [name, action] of Object.entries(ACTION))
    if (action >= 0 && action < ACTION_BUCKETS) output[name] = values[action];
  return output;
}

class SemanticAttackExecutionIntervalShadow {
  constructor(epoch, coverage, runtimeConfig = {}, options = {}) {
    this.epoch = epoch; this.coverage = coverage;
    this.field = options.field || new AttackObjectiveFieldProposal();
    this.interval = options.interval || new OptionScopedTargetContinuationSearch(
      runtimeConfig, { active: false, depth: options.depth || 2,
        nodeBudget: options.nodeBudget || 256 });
    this.candidateByAction = new Uint32Array(ACTION_BUCKETS);
    this.decisionCount = 0; this.inactiveCount = 0; this.suspendedCount = 0;
    this.strictExecutionAvailableCount = 0; this.invalidCurrentCount = 0;
    this.noCandidateCount = 0; this.sameCandidateCount = 0;
    this.candidateCount = 0; this.dominanceCount = 0;
    this.completeRefutationCount = 0; this.completeEqualCount = 0;
    this.incompleteCount = 0; this.skippedCount = 0;
    this.hotAllocationCount = 0; this.lastCandidate = -1;
    this.sampleCapacity = 16; this.sampleCount = 0;
    this.sampleFrame = new Uint16Array(this.sampleCapacity);
    this.sampleCurrentAction = new Uint8Array(this.sampleCapacity);
    this.sampleCandidateAction = new Uint8Array(this.sampleCapacity);
    this.sampleStatus = new Uint8Array(this.sampleCapacity);
    this.sampleCurrentScore = new Int32Array(this.sampleCapacity);
    this.sampleCandidateScore = new Int32Array(this.sampleCapacity);
    this.sampleNodes = new Uint16Array(this.sampleCapacity);
  }

  selectionCount(engine) {
    return engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
        engine.ourCount - 1 : engine.ourCount;
  }

  currentRow(engine, action, count) {
    const selected = engine.diagnosticInternalSelectedIndex;
    if (Number.isSafeInteger(selected) && selected >= 0 && selected < count)
      return selected;
    for (let row = 0; row < count; row += 1)
      if (engine.ourActions[row] === action) return row;
    return -1;
  }

  record(engine, current, candidate) {
    if (this.sampleCount >= this.sampleCapacity) return;
    const at = this.sampleCount++;
    this.sampleFrame[at] = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    this.sampleCurrentAction[at] = engine.ourActions[current];
    this.sampleCandidateAction[at] = engine.ourActions[candidate];
    this.sampleStatus[at] = this.interval.lastStatus;
    this.sampleCurrentScore[at] = this.interval.lastSelectedScore;
    this.sampleCandidateScore[at] = this.interval.lastCandidateScore;
    this.sampleNodes[at] = this.interval.lastNodes;
  }

  observe(engine, emittedAction) {
    this.decisionCount += 1; this.lastCandidate = -1;
    if (!this.epoch || !this.epoch.activeGeneration ||
        this.epoch.activeKind !== LONG_OPTION.ATTACK) {
      this.inactiveCount += 1; return;
    }
    if (this.epoch.lastStatus === OBJECTIVE_EPOCH_STATUS.INTERRUPT_YIELD) {
      this.suspendedCount += 1; return;
    }
    // The semantic epoch execution mask contains POSITION aliases and other
    // continuation rows. Only BP119's fully qualified ATTACK rows close the
    // execution gap that this diagnostic is designed to study.
    if (this.coverage && this.coverage.lastStrictMask) {
      this.strictExecutionAvailableCount += 1; return;
    }
    const count = this.selectionCount(engine);
    const current = this.currentRow(engine, emittedAction, count);
    if (current < 0) { this.invalidCurrentCount += 1; return; }
    const candidate = this.field.evaluateOwnedTarget(engine, current, count);
    if (candidate < 0) { this.noCandidateCount += 1; return; }
    if (candidate === current) { this.sameCandidateCount += 1; return; }
    this.candidateCount += 1; this.lastCandidate = candidate;
    const action = engine.ourActions[candidate];
    if (action >= 0 && action < ACTION_BUCKETS)
      this.candidateByAction[action] += 1;
    const enemy = engine.adapter.enemyVisible ?
      engine.adapter.state.arrays[ARRAY.TANK_CELL][1] : NONE_CELL;
    this.interval.evaluate(engine, engine.adapter.bundle, current, candidate,
      enemy, 0xffff, this.epoch.activeTargetSignature,
      OPTION_KIND.ATTACK_SETUP);
    if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.DOMINATES)
      this.dominanceCount += 1;
    else if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.COMPLETE) {
      if (this.interval.lastCandidateScore < this.interval.lastSelectedScore)
        this.completeRefutationCount += 1;
      else this.completeEqualCount += 1;
    } else if (this.interval.lastStatus === CONTINUATION_SEARCH_STATUS.INCOMPLETE)
      this.incompleteCount += 1;
    else this.skippedCount += 1;
    this.record(engine, current, candidate);
  }

  summary() {
    const samples = [];
    for (let at = 0; at < this.sampleCount; at += 1) samples.push({
      frame: this.sampleFrame[at], currentAction: this.sampleCurrentAction[at],
      candidateAction: this.sampleCandidateAction[at], status: this.sampleStatus[at],
      currentScore: this.sampleCurrentScore[at],
      candidateScore: this.sampleCandidateScore[at], nodes: this.sampleNodes[at]
    });
    return { decisionCount: this.decisionCount, inactiveCount: this.inactiveCount,
      suspendedCount: this.suspendedCount,
      strictExecutionAvailableCount: this.strictExecutionAvailableCount,
      invalidCurrentCount: this.invalidCurrentCount,
      noCandidateCount: this.noCandidateCount, sameCandidateCount: this.sameCandidateCount,
      candidateCount: this.candidateCount, dominanceCount: this.dominanceCount,
      completeRefutationCount: this.completeRefutationCount,
      completeEqualCount: this.completeEqualCount,
      incompleteCount: this.incompleteCount, skippedCount: this.skippedCount,
      candidateByAction: namedActions(this.candidateByAction),
      field: this.field.summary(), interval: this.interval.summary(), samples,
      hotAllocationCount: this.hotAllocationCount + this.field.hotAllocationCount +
        this.interval.hotAllocationCount, lastCandidate: this.lastCandidate };
  }
}

module.exports = { SemanticAttackExecutionIntervalShadow };
