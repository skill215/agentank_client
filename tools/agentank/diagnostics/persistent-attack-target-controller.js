"use strict";

// Diagnostic target owner.  A complete ATTACK-over-STAR conflict adopts a
// deadline-bounded semantic target.  TURN/GO/FIRE remain per-frame execution
// choices and must re-enter Hard, committed EO and Risk on every callback.

const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { OPTION_KIND } = require(
  "../../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require(
  "../../../engine-v2/src/runtime/escape-obligation");
const { GLOBAL_MODE } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { AttackObjectiveFieldProposal } = require("./attack-objective-field");

const TARGET_STATUS = Object.freeze({ NONE: 0, ADOPTED: 1, CONTINUED: 2,
  SAME_PRIMITIVE: 3, EXECUTION_GAP: 4, SAFETY_YIELD: 5, EXPIRED: 6,
  SCORE_ABORT: 7, STRATEGIC_YIELD: 8, COUNT: 9 });
const TARGET_STATUS_NAME = Object.freeze([
  "NONE", "ADOPTED", "CONTINUED", "SAME_PRIMITIVE", "EXECUTION_GAP",
  "SAFETY_YIELD", "EXPIRED", "SCORE_ABORT", "STRATEGIC_YIELD"
]);

function named(values, names) {
  const output = {};
  for (let at = 0; at < names.length; at += 1) output[names[at]] = values[at];
  return output;
}

class PersistentAttackTargetController {
  constructor(owner, options = {}) {
    if (!owner) throw new Error(
      "PersistentAttackTargetController requires an adoption evidence owner");
    this.owner = owner; this.active = options.active ? 1 : 0;
    this.objective = options.objectiveField || new AttackObjectiveFieldProposal();
    this.continuationSearch = options.continuationSearch || null;
    this.statusCount = new Uint32Array(TARGET_STATUS.COUNT);
    this.actionCount = new Uint32Array(24);
    this.targetActive = 0; this.targetGeneration = 0;
    this.nextGeneration = 1; this.targetStartFrame = 0;
    this.targetDeadline = 0; this.targetEnemyCell = 0xffff;
    this.targetScoreBand = 0; this.previousFrame = -1;
    this.checkCount = 0; this.adoptionCount = 0; this.replanCount = 0;
    this.targetFrameCount = 0; this.continuationProposalCount = 0;
    this.samePrimitiveCount = 0; this.executionGapCount = 0;
    this.movementProposalCount = 0;
    this.safetyYieldCount = 0; this.strategicYieldCount = 0;
    this.deadlineExpiryCount = 0;
    this.exactValueCheckCount = 0; this.exactValueBlockedCount = 0;
    this.exactValueProposalCount = 0;
    this.scoreAbortCount = 0; this.supportAbortCount = 0;
    this.overrideCount = 0; this.finalRejectCount = 0;
    this.maximumTargetAge = 0; this.hotAllocationCount = 0;
    this.lastStatus = TARGET_STATUS.NONE; this.lastProposal = -1;
    this.lastSelected = -1; this.lastCandidateCount = 0;
  }

  resetMatch(frame) {
    this.targetActive = 0; this.targetGeneration = 0;
    this.targetStartFrame = frame; this.targetDeadline = frame;
    this.targetEnemyCell = 0xffff; this.lastStatus = TARGET_STATUS.NONE;
  }

  optionKind(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return OPTION_KIND.NONE;
    let kind = OPTION_KIND.NONE;
    for (let at = 0; at < portfolio.count; at += 1) {
      if (portfolio.primitiveRow[at] !== row ||
          !portfolio.supportComplete[at]) continue;
      if (portfolio.kind[at] === OPTION_KIND.DIRECT_KILL)
        return OPTION_KIND.DIRECT_KILL;
      if (portfolio.kind[at] === OPTION_KIND.ATTACK_SETUP)
        kind = OPTION_KIND.ATTACK_SETUP;
    }
    return kind;
  }

  rowHasKind(engine, row, kind) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio || row < 0) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.kind[at] === kind &&
          portfolio.supportComplete[at]) return 1;
    return 0;
  }

  mustYieldStrategicOwner(engine, selected) {
    if (selected < 0 || selected >= engine.ourCount) return 1;
    const action = engine.ourActions[selected];
    const resource = action === ACTION.THROW_BOMB ||
      action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST ||
      action >= ACTION.BOOST_LEFT_BOMB;
    return resource ||
      this.rowHasKind(engine, selected, OPTION_KIND.COMMITTED_RESCUE) ||
      this.rowHasKind(engine, selected, OPTION_KIND.TERMINAL) ||
      this.rowHasKind(engine, selected, OPTION_KIND.RESOURCE) ? 1 : 0;
  }

  riskNonRegressing(risk, candidate, selected) {
    if (selected < 0 || selected >= risk.count) return 1;
    if (risk.immediateFatalMass &&
        risk.immediateFatalMass[candidate] > risk.immediateFatalMass[selected])
      return 0;
    if (risk.horizonFatalMass &&
        risk.horizonFatalMass[candidate] > risk.horizonFatalMass[selected])
      return 0;
    if (risk.unknownMass && risk.unknownMass[candidate] > risk.unknownMass[selected])
      return 0;
    if (risk.earliestFatalFrame &&
        risk.earliestFatalFrame[candidate] < risk.earliestFatalFrame[selected])
      return 0;
    if (risk.escapeSlack && risk.escapeSlack[candidate] < risk.escapeSlack[selected])
      return 0;
    return 1;
  }

  eligible(engine, row, selected) {
    const risk = engine.riskController && engine.riskController.outcome;
    return risk && row >= 0 && row < engine.ourCount && row < risk.count &&
      engine.hardStatus[row] === HARD_STATUS.ALLOW && risk.acceptable[row] &&
      !risk.dominated[row] && this.optionKind(engine, row) !== OPTION_KIND.NONE &&
      this.riskNonRegressing(risk, row, selected) ? 1 : 0;
  }

  better(engine, left, right) {
    if (right < 0) return 1;
    const combat = engine.combat.vector;
    const leftKind = this.optionKind(engine, left);
    const rightKind = this.optionKind(engine, right);
    if (leftKind !== rightKind) return leftKind < rightKind ? 1 : 0;
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
    if (combat.hitDeadline[left] !== combat.hitDeadline[right])
      return combat.hitDeadline[left] < combat.hitDeadline[right] ? 1 : 0;
    const risk = engine.riskController.outcome;
    if (risk.robustLower[left] !== risk.robustLower[right])
      return risk.robustLower[left] > risk.robustLower[right] ? 1 : 0;
    if (risk.expectedValue[left] !== risk.expectedValue[right])
      return risk.expectedValue[left] > risk.expectedValue[right] ? 1 : 0;
    return left < right ? 1 : 0;
  }

  exactValueDominates(engine, bundle, candidate, selected) {
    this.exactValueCheckCount += 1;
    let source = null;
    const information = engine.informationSearch;
    if (information && information.completedDepth > 0 &&
        information.approximate === 0 && information.supportComplete === 1)
      source = information;
    const physical = engine.depthSearch;
    if (!source && physical && physical.completedDepth > 0 &&
        physical.representativeSupportComplete === 1) source = physical;
    if (source && candidate >= 0 && selected >= 0 &&
        candidate < source.rootOurCount && selected < source.rootOurCount &&
        (!source.rootDomainRestricted || !source.rootDomainMask ||
          source.rootDomainMask[candidate] && source.rootDomainMask[selected]) &&
        source.rootScore[candidate] > source.rootScore[selected]) {
      this.exactValueProposalCount += 1; return 1;
    }
    if (this.continuationSearch && this.continuationSearch.evaluate(engine, bundle,
        selected, candidate, engine.adapter.state.arrays[ARRAY.TANK_CELL][1],
        this.targetDeadline, this.targetGeneration)) {
      this.exactValueProposalCount += 1; return 1;
    }
    this.exactValueBlockedCount += 1; return 0;
  }

  adopt(engine, frame) {
    const deadline = this.owner.lastAttackDeadline;
    if (deadline >= 255) return 0;
    if (this.targetActive) this.replanCount += 1;
    else this.adoptionCount += 1;
    this.targetActive = 1; this.targetGeneration = this.nextGeneration++;
    if (!this.nextGeneration) this.nextGeneration = 1;
    this.targetStartFrame = frame;
    this.targetDeadline = Math.min(0xffff, frame + Math.max(1, deadline));
    const a = engine.adapter.state.arrays;
    this.targetEnemyCell = a[ARRAY.TANK_CELL] ? a[ARRAY.TANK_CELL][1] : 0xffff;
    this.targetScoreBand = this.owner.lastScoreBand;
    this.lastStatus = TARGET_STATUS.ADOPTED;
    this.statusCount[this.lastStatus] += 1; return 1;
  }

  expire(status) {
    this.targetActive = 0; this.targetGeneration = 0;
    this.lastStatus = status; this.statusCount[status] += 1;
  }

  evaluate(engine, bundle, selected, selectionCount) {
    // Keep direct diagnostic fixtures source-compatible; a real scoped search
    // always receives the physical bundle from selectFinalAction.
    if (typeof bundle === "number") {
      selectionCount = selected; selected = bundle; bundle = null;
    }
    this.checkCount += 1; this.lastProposal = -1; this.lastSelected = selected;
    this.lastCandidateCount = 0; this.lastStatus = TARGET_STATUS.NONE;
    const a = engine.adapter.state.arrays;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.previousFrame >= frame) this.resetMatch(frame);
    this.previousFrame = frame;

    const adoption = this.owner.evaluate(engine, selected, selectionCount);
    if (adoption >= 0 && this.adopt(engine, frame)) {
      this.lastProposal = adoption; this.actionCount[engine.ourActions[adoption]] += 1;
      return adoption;
    }
    if (!this.targetActive) return -1;
    this.targetFrameCount += 1;
    const age = frame - this.targetStartFrame + 1;
    if (age > this.maximumTargetAge) this.maximumTargetAge = age;
    if (frame > this.targetDeadline) {
      this.deadlineExpiryCount += 1; this.expire(TARGET_STATUS.EXPIRED); return -1;
    }
    const ownStars = a[ARRAY.TANK_STARS][0];
    const enemyStars = a[ARRAY.TANK_STARS][1];
    if (ownStars > enemyStars) {
      this.scoreAbortCount += 1; this.expire(TARGET_STATUS.SCORE_ABORT); return -1;
    }
    if (engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL ||
        engine.escapeObligation.supportStatus !== SUPPORT_STATUS.NONE) {
      this.safetyYieldCount += 1; this.lastStatus = TARGET_STATUS.SAFETY_YIELD;
      this.statusCount[this.lastStatus] += 1; return -1;
    }
    if (this.mustYieldStrategicOwner(engine, selected)) {
      this.strategicYieldCount += 1;
      this.lastStatus = TARGET_STATUS.STRATEGIC_YIELD;
      this.statusCount[this.lastStatus] += 1; return -1;
    }
    if (!engine.optionPortfolio || !engine.combat || !engine.combat.vector) {
      this.supportAbortCount += 1; this.executionGapCount += 1;
      this.lastStatus = TARGET_STATUS.EXECUTION_GAP;
      this.statusCount[this.lastStatus] += 1; return -1;
    }
    let best = -1;
    for (let row = 0; row < selectionCount; row += 1) {
      if (!this.eligible(engine, row, selected)) continue;
      this.lastCandidateCount += 1;
      if (this.better(engine, row, best)) best = row;
    }
    if (best < 0 && engine.adapter.enemyVisible &&
        typeof engine.adapter.state.x === "function") {
      best = this.objective.evaluateOwnedTarget(engine, selected, selectionCount);
      if (best >= 0) {
        this.lastCandidateCount += 1; this.movementProposalCount += 1;
      }
    }
    if (best < 0) {
      this.executionGapCount += 1; this.lastStatus = TARGET_STATUS.EXECUTION_GAP;
      this.statusCount[this.lastStatus] += 1; return -1;
    }
    if (best !== selected && !this.exactValueDominates(engine, bundle, best, selected)) {
      this.executionGapCount += 1; this.lastStatus = TARGET_STATUS.EXECUTION_GAP;
      this.statusCount[this.lastStatus] += 1; return -1;
    }
    this.lastProposal = best; this.actionCount[engine.ourActions[best]] += 1;
    if (best === selected) {
      this.samePrimitiveCount += 1; this.lastStatus = TARGET_STATUS.SAME_PRIMITIVE;
    } else {
      this.continuationProposalCount += 1;
      this.lastStatus = TARGET_STATUS.CONTINUED;
    }
    this.statusCount[this.lastStatus] += 1; return best;
  }

  confirmOverride() { this.overrideCount += 1; }
  rejectFinal() { this.finalRejectCount += 1; }

  summary() {
    const actionNames = new Array(24);
    for (const [name, value] of Object.entries(ACTION)) actionNames[value] = name;
    return { active: Boolean(this.active), actionOwnership: Boolean(this.active),
      checkCount: this.checkCount, adoptionCount: this.adoptionCount,
      replanCount: this.replanCount, targetFrameCount: this.targetFrameCount,
      continuationProposalCount: this.continuationProposalCount,
      samePrimitiveCount: this.samePrimitiveCount,
      executionGapCount: this.executionGapCount,
      movementProposalCount: this.movementProposalCount,
      safetyYieldCount: this.safetyYieldCount,
      strategicYieldCount: this.strategicYieldCount,
      exactValueCheckCount: this.exactValueCheckCount,
      exactValueBlockedCount: this.exactValueBlockedCount,
      exactValueProposalCount: this.exactValueProposalCount,
      deadlineExpiryCount: this.deadlineExpiryCount,
      scoreAbortCount: this.scoreAbortCount,
      supportAbortCount: this.supportAbortCount, overrideCount: this.overrideCount,
      finalRejectCount: this.finalRejectCount,
      maximumTargetAge: this.maximumTargetAge, targetActive: Boolean(this.targetActive),
      targetGeneration: this.targetGeneration, targetDeadline: this.targetDeadline,
      targetEnemyCell: this.targetEnemyCell, statusCount:
        named(this.statusCount, TARGET_STATUS_NAME),
      proposalByAction: named(this.actionCount, actionNames),
      lastStatus: TARGET_STATUS_NAME[this.lastStatus],
      lastProposal: this.lastProposal, lastSelected: this.lastSelected,
      lastCandidateCount: this.lastCandidateCount,
      adoptionOwner: this.owner.summary(), objectiveField: this.objective.summary(),
      continuationSearch: this.continuationSearch ?
        this.continuationSearch.summary() : null,
      hotAllocationCount: this.hotAllocationCount + this.owner.hotAllocationCount +
        this.objective.hotAllocationCount + (this.continuationSearch ?
          this.continuationSearch.hotAllocationCount : 0) };
  }
}

module.exports = { TARGET_STATUS, TARGET_STATUS_NAME,
  PersistentAttackTargetController };
