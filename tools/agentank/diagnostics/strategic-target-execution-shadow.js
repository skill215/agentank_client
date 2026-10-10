"use strict";

// Behavior-neutral execution-side observer for a persistent semantic target.
// StrategicConflictArbiterShadow owns only ATTACK versus STAR target choice;
// this service asks whether the chosen ATTACK target can be expressed by a
// Hard/Risk-qualified primitive on each frame.  A gap means "fall back this
// frame while retaining the target", never ACTION.NONE and never target death.

const { ACTION, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { LONG_OPTION } = require("./event-driven-option-shadow");

const EXECUTION_STATUS = Object.freeze({ NONE: 0, TARGET_GAP: 1,
  QUALIFIED: 2, SAME_PRIMITIVE: 3, DIFFERENT_PRIMITIVE: 4, COUNT: 5 });
const EXECUTION_STATUS_NAME = Object.freeze([
  "NONE", "TARGET_GAP", "QUALIFIED", "SAME_PRIMITIVE", "DIFFERENT_PRIMITIVE"
]);

function named(values, names) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

class StrategicTargetExecutionShadow {
  constructor(arbiter) {
    if (!arbiter) throw new Error(
      "StrategicTargetExecutionShadow requires StrategicConflictArbiterShadow");
    this.arbiter = arbiter;
    this.statusCounts = new Uint32Array(EXECUTION_STATUS.COUNT);
    this.proposalByAction = new Uint32Array(24);
    this.observationCount = 0; this.attackTargetFrameCount = 0;
    this.proposalRootCount = 0; this.candidateRowCount = 0;
    this.targetGapCount = 0; this.samePrimitiveCount = 0;
    this.differentPrimitiveCount = 0; this.fireProposalCount = 0;
    this.setupProposalCount = 0; this.directKillProposalCount = 0;
    this.incompletePortfolioCount = 0; this.hotAllocationCount = 0;
    this.counterfactualBoundaryCount = 0;
    this.lastProposalRow = -1; this.lastSelectedRow = -1;
    this.lastCandidateCount = 0; this.lastStatus = EXECUTION_STATUS.NONE;
    this.lastObservedProposalAdoptionCount = 0;
  }

  rowOption(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    let result = 0;
    for (let at = 0; at < portfolio.count; at += 1) {
      if (portfolio.primitiveRow[at] !== row || !portfolio.supportComplete[at])
        continue;
      if (portfolio.kind[at] === OPTION_KIND.DIRECT_KILL) result = 2;
      else if (!result && portfolio.kind[at] === OPTION_KIND.ATTACK_SETUP)
        result = 1;
    }
    return result;
  }

  eligible(engine, row) {
    const risk = engine.riskController && engine.riskController.outcome;
    return risk && row >= 0 && row < engine.ourCount && row < risk.count &&
      engine.hardStatus[row] === HARD_STATUS.ALLOW && risk.acceptable[row] &&
      !risk.dominated[row] && this.rowOption(engine, row) ? 1 : 0;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const combat = engine.combat.vector;
    const leftKind = this.rowOption(engine, left);
    const rightKind = this.rowOption(engine, right);
    if (leftKind !== rightKind) return leftKind > rightKind ? 1 : 0;
    if (combat.directKill[left] !== combat.directKill[right])
      return combat.directKill[left] > combat.directKill[right] ? 1 : 0;
    if (combat.enemyDoomedFirstActions[left] !==
        combat.enemyDoomedFirstActions[right])
      return combat.enemyDoomedFirstActions[left] >
        combat.enemyDoomedFirstActions[right] ? 1 : 0;
    if (combat.enemyEndpointReduction[left] !==
        combat.enemyEndpointReduction[right])
      return combat.enemyEndpointReduction[left] >
        combat.enemyEndpointReduction[right] ? 1 : 0;
    if (combat.enemyMobilityLoss[left] !== combat.enemyMobilityLoss[right])
      return combat.enemyMobilityLoss[left] > combat.enemyMobilityLoss[right] ? 1 : 0;
    if (combat.purposeCompleteness[left] !== combat.purposeCompleteness[right])
      return combat.purposeCompleteness[left] >
        combat.purposeCompleteness[right] ? 1 : 0;
    if (combat.ownCounterExposure[left] !== combat.ownCounterExposure[right])
      return combat.ownCounterExposure[left] <
        combat.ownCounterExposure[right] ? 1 : 0;
    if (combat.postFireEscape[left] !== combat.postFireEscape[right])
      return combat.postFireEscape[left] > combat.postFireEscape[right] ? 1 : 0;
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    const risk = engine.riskController.outcome;
    if (risk.robustLower[left] !== risk.robustLower[right])
      return risk.robustLower[left] > risk.robustLower[right] ? 1 : 0;
    if (risk.expectedValue[left] !== risk.expectedValue[right])
      return risk.expectedValue[left] > risk.expectedValue[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  observe(engine, emittedAction) {
    this.observationCount += 1; this.lastProposalRow = -1;
    this.lastSelectedRow = this.arbiter.ledger.classifier.selectedRow(
      engine, emittedAction);
    this.lastCandidateCount = 0; this.lastStatus = EXECUTION_STATUS.NONE;
    if (!this.arbiter.shadowTargetProposalOwned ||
        this.arbiter.shadowTargetKind !== LONG_OPTION.ATTACK ||
        !this.arbiter.shadowTargetGeneration) return;
    this.attackTargetFrameCount += 1;
    if (!engine.optionPortfolio || !engine.combat || !engine.combat.vector) {
      this.incompletePortfolioCount += 1;
      this.lastStatus = EXECUTION_STATUS.TARGET_GAP;
      this.statusCounts[this.lastStatus] += 1; return;
    }
    let best = -1;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (!this.eligible(engine, row)) continue;
      this.lastCandidateCount += 1; this.candidateRowCount += 1;
      if (this.better(engine, row, best)) best = row;
    }
    if (best < 0) {
      this.targetGapCount += 1; this.lastStatus = EXECUTION_STATUS.TARGET_GAP;
      this.statusCounts[this.lastStatus] += 1; return;
    }
    this.proposalRootCount += 1; this.lastProposalRow = best;
    const newlyAdopted = this.arbiter.proposalTargetAdoptionCount >
      this.lastObservedProposalAdoptionCount;
    this.lastObservedProposalAdoptionCount =
      this.arbiter.proposalTargetAdoptionCount;
    if (best === this.lastSelectedRow) {
      this.samePrimitiveCount += 1;
      this.lastStatus = EXECUTION_STATUS.SAME_PRIMITIVE;
    } else {
      this.differentPrimitiveCount += 1;
      this.lastStatus = EXECUTION_STATUS.DIFFERENT_PRIMITIVE;
    }
    if (!newlyAdopted && this.lastStatus === EXECUTION_STATUS.DIFFERENT_PRIMITIVE)
      this.setupProposalCount += 1;
    if (this.rowOption(engine, best) === 2) this.directKillProposalCount += 1;
    if (engine.ourActions[best] === ACTION.FIRE) this.fireProposalCount += 1;
    this.proposalByAction[engine.ourActions[best]] += 1;
    this.statusCounts[this.lastStatus] += 1;
    if (this.lastStatus === EXECUTION_STATUS.DIFFERENT_PRIMITIVE) {
      this.counterfactualBoundaryCount += 1;
      this.arbiter.releaseCounterfactual();
    }
  }

  summary() {
    const actionNames = new Array(24);
    for (const [name, value] of Object.entries(ACTION)) actionNames[value] = name;
    return { enabled: true, behaviorNeutral: true, actionOwnership: false,
      targetOwnership: "STRATEGIC_CONFLICT_ARBITER",
      observationCount: this.observationCount,
      attackTargetFrameCount: this.attackTargetFrameCount,
      proposalRootCount: this.proposalRootCount,
      candidateRowCount: this.candidateRowCount,
      targetGapCount: this.targetGapCount,
      incompletePortfolioCount: this.incompletePortfolioCount,
      samePrimitiveCount: this.samePrimitiveCount,
      differentPrimitiveCount: this.differentPrimitiveCount,
      fireProposalCount: this.fireProposalCount,
      setupProposalCount: this.setupProposalCount,
      directKillProposalCount: this.directKillProposalCount,
      counterfactualBoundaryCount: this.counterfactualBoundaryCount,
      statusCounts: named(this.statusCounts, EXECUTION_STATUS_NAME),
      proposalByAction: named(this.proposalByAction, actionNames),
      lastProposalRow: this.lastProposalRow,
      lastSelectedRow: this.lastSelectedRow,
      lastCandidateCount: this.lastCandidateCount,
      lastStatus: EXECUTION_STATUS_NAME[this.lastStatus],
      hotAllocationCount: this.hotAllocationCount };
  }

  // Cold capture after the counterfactual boundary has already been found.
  // The hot observer remains allocation-free.
  sample(engine) {
    const proposal = this.lastProposalRow; const selected = this.lastSelectedRow;
    if (!engine || proposal < 0 || selected < 0) return null;
    const risk = engine.riskController.outcome; const combat = engine.combat.vector;
    const a = engine.adapter.state.arrays;
    const row = index => ({ row: index, action: engine.ourActions[index],
      argument: engine.ourArguments[index], hard: engine.hardStatus[index],
      acceptable: risk.acceptable[index], dominated: risk.dominated[index],
      immediateFatalMass: risk.immediateFatalMass[index],
      horizonFatalMass: risk.horizonFatalMass[index],
      unknownMass: risk.unknownMass[index],
      earliestFatalFrame: risk.earliestFatalFrame[index],
      escapeSlack: risk.escapeSlack[index], robustLower: risk.robustLower[index],
      expectedValue: risk.expectedValue[index],
      directKill: combat.directKill[index],
      enemyDoomedFirstActions: combat.enemyDoomedFirstActions[index],
      enemyEndpointReduction: combat.enemyEndpointReduction[index],
      enemyMobilityLoss: combat.enemyMobilityLoss[index],
      hitDeadline: combat.hitDeadline[index],
      postFireEscape: combat.postFireEscape[index],
      ownCounterExposure: combat.ownCounterExposure[index],
      purposeCompleteness: combat.purposeCompleteness[index] });
    return { sampleKind: "STRATEGIC_TARGET_EXECUTION_BOUNDARY",
      frame: a[ARRAY.SCALAR][SCALAR.FRAME],
      ownStars: a[ARRAY.TANK_STARS][0], enemyStars: a[ARRAY.TANK_STARS][1],
      eventMask: this.arbiter.ledger.lastEventMask,
      decision: this.arbiter.lastDecision,
      attackGeneration: this.arbiter.lastAttackGeneration,
      incumbentGeneration: this.arbiter.lastIncumbentGeneration,
      attackDeadline: this.arbiter.lastAttackDeadline,
      incumbentDeadline: this.arbiter.lastIncumbentDeadline,
      selected: row(selected), proposal: row(proposal),
      response: this.arbiter.responsePolicy.sample() };
  }
}

module.exports = { EXECUTION_STATUS, EXECUTION_STATUS_NAME,
  StrategicTargetExecutionShadow };
