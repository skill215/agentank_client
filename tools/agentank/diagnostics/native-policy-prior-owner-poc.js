"use strict";

// Diagnostic policy-first owner. A coherent receding policy supplies the
// incumbent action. V2 search is a verifier: only a complete terminal result
// may refute the incumbent. Incomplete/heuristic point values never become a
// global action owner.

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");
const { NativeTacticalIntentPoc } = require("./native-tactical-domain-evaluator-poc");

function actionPriority(action) {
  if (action === ACTION.GO) return 5;
  if (action === ACTION.FIRE) return 4;
  if (action >= ACTION.CAST_SHIELD) return 3;
  if (action === ACTION.TURN_LEFT) return 2;
  if (action === ACTION.TURN_RIGHT) return 1;
  return 0;
}

class NativePolicyPriorOwnerPoc {
  constructor(options = {}) {
    this.intent = options.intent || new NativeTacticalIntentPoc(150);
    this.checkCount = 0; this.nonContactSkipCount = 0;
    this.strictOwnerSkipCount = 0; this.committedSkipCount = 0;
    this.noPriorCount = 0; this.hardBlockedCount = 0;
    this.riskRejectedObservedCount = 0; this.dominatedObservedCount = 0;
    this.completeVerifierCount = 0; this.incompleteVerifierCount = 0;
    this.terminalWinVetoCount = 0; this.terminalLossVetoCount = 0;
    this.proposalCount = 0; this.sameActionCount = 0; this.overrideCount = 0;
    this.goOverrideCount = 0; this.turnOverrideCount = 0;
    this.fireOverrideCount = 0; this.otherOverrideCount = 0;
    this.hotAllocationCount = 0;
  }

  completeSource(engine) {
    const information = engine.informationSearch;
    if (information?.completedDepth > 0 && information.supportComplete === 1 &&
        information.approximate === 0) return information;
    const physical = engine.depthSearch;
    if (physical?.completedDepth > 0 &&
        physical.representativeSupportComplete === 1) return physical;
    return null;
  }

  sourceSupports(source, row) {
    return !source.rootDomainRestricted || source.rootDomainMask[row] ? 1 : 0;
  }

  priorRow(engine, count) {
    let best = -1; let bestBonus = 0; let bestPriority = -1;
    for (let row = 0; row < count; row += 1) {
      const bonus = this.intent.bonus(row);
      if (bonus <= 0 || engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      const priority = actionPriority(engine.ourActions[row]);
      if (best < 0 || bonus > bestBonus || bonus === bestBonus &&
          (priority > bestPriority || priority === bestPriority && row < best)) {
        best = row; bestBonus = bonus; bestPriority = priority;
      }
    }
    return best;
  }

  selectOverride(engine, selected, action) {
    this.checkCount += 1;
    if (engine.lastControlMode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT ||
        !engine.adapter?.enemyVisible) {
      this.nonContactSkipCount += 1; return null;
    }
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.lastSelectionWasStrictRescue ||
        engine.lastSelectionWasVerifiedDirectKill) {
      this.strictOwnerSkipCount += 1; return null;
    }
    if (engine.escapeObligation?.committedEntityCount > 0) {
      this.committedSkipCount += 1; return null;
    }
    const count = engine.ourCount > 1 &&
      engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
      engine.ourCount - 1 : engine.ourCount;
    this.intent.prepare(engine, count);
    const prior = this.priorRow(engine, count);
    if (prior < 0) { this.noPriorCount += 1; return null; }
    if (engine.hardStatus[prior] !== HARD_STATUS.ALLOW) {
      this.hardBlockedCount += 1; return null;
    }
    const outcome = engine.riskController?.outcome;
    if (outcome && prior < outcome.count) {
      if (!outcome.acceptable[prior]) this.riskRejectedObservedCount += 1;
      if (outcome.dominated[prior]) this.dominatedObservedCount += 1;
    }
    const source = this.completeSource(engine);
    if (source && selected >= 0 && selected < count &&
        this.sourceSupports(source, prior) && this.sourceSupports(source, selected)) {
      this.completeVerifierCount += 1;
      const incumbentValue = source.rootScore[selected];
      const priorValue = source.rootScore[prior];
      if (incumbentValue >= 30000 && priorValue < 30000) {
        this.terminalWinVetoCount += 1; return null;
      }
      if (priorValue <= -30000 && incumbentValue > -30000) {
        this.terminalLossVetoCount += 1; return null;
      }
    } else this.incompleteVerifierCount += 1;
    this.proposalCount += 1;
    const proposed = engine.ourActions[prior];
    if (proposed === action) { this.sameActionCount += 1; return null; }
    this.overrideCount += 1;
    if (proposed === ACTION.GO) this.goOverrideCount += 1;
    else if (proposed === ACTION.TURN_LEFT || proposed === ACTION.TURN_RIGHT)
      this.turnOverrideCount += 1;
    else if (proposed === ACTION.FIRE) this.fireOverrideCount += 1;
    else this.otherOverrideCount += 1;
    return { action: proposed, argument: engine.ourArguments[prior] };
  }

  summary() {
    return { enabled: true, semantics: "POLICY_PRIOR_TERMINAL_VERIFIER",
      checkCount: this.checkCount, nonContactSkipCount: this.nonContactSkipCount,
      strictOwnerSkipCount: this.strictOwnerSkipCount,
      committedSkipCount: this.committedSkipCount, noPriorCount: this.noPriorCount,
      hardBlockedCount: this.hardBlockedCount,
      riskRejectedObservedCount: this.riskRejectedObservedCount,
      dominatedObservedCount: this.dominatedObservedCount,
      completeVerifierCount: this.completeVerifierCount,
      incompleteVerifierCount: this.incompleteVerifierCount,
      terminalWinVetoCount: this.terminalWinVetoCount,
      terminalLossVetoCount: this.terminalLossVetoCount,
      proposalCount: this.proposalCount, sameActionCount: this.sameActionCount,
      overrideCount: this.overrideCount, goOverrideCount: this.goOverrideCount,
      turnOverrideCount: this.turnOverrideCount,
      fireOverrideCount: this.fireOverrideCount,
      otherOverrideCount: this.otherOverrideCount,
      intent: this.intent.summary(), hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { actionPriority, NativePolicyPriorOwnerPoc };
