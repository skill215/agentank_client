"use strict";

// Behavior-neutral bridge between cross-frame semantic Option identity and
// bounded multi-frame evidence.  It intentionally publishes two different
// bands:
//   1. current Risk robust/expected values (ordering evidence), and
//   2. a deterministic four-frame physical rollout (causal diagnostic only).
// The strict game-value interval remains full range unless an exhaustive
// terminal proof exists.  This class never selects or mutates an action.

const { SEARCH_CAPACITY } = require(
  "../../../engine-v2/src/generated/search-config");
const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require("./event-driven-option-shadow");
const { StatefulOptionRollout } = require("./stateful-option-rollout");

const STRICT_VALUE_MIN = -32000;
const STRICT_VALUE_MAX = 32000;

class StableOptionIntervalShadow {
  constructor(ledger, state = null, rollout = null) {
    this.ledger = ledger;
    this.rollout = rollout || new StatefulOptionRollout();
    if (state) this.rollout.bind(state);
    this.attackCandidate = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.evaluationCount = 0; this.eventConflictCount = 0;
    this.externalEventTriggerCount = 0; this.internalEventTriggerCount = 0;
    this.steadyConflictSkipCount = 0; this.noAttackConflictCount = 0;
    this.unsupportedSelectedCount = 0; this.committedSkipCount = 0;
    this.incompleteRolloutCount = 0; this.rootRestoreFailureCount = 0;
    this.nominalBalancedAttackWinCount = 0;
    this.nominalCombatAttackWinCount = 0;
    this.nominalAttackLossCount = 0; this.nominalAttackTieCount = 0;
    this.riskBandAttackSeparationCount = 0;
    this.riskBandIncumbentSeparationCount = 0;
    this.riskBandOverlapCount = 0;
    this.attackSurvivalPreservedCount = 0;
    this.attackSurvivalRegressedCount = 0;
    this.attackEnemyCrashGainCount = 0; this.attackStarRegressionCount = 0;
    this.strictFullRangeCount = 0; this.strictTerminalResolvedCount = 0;
    this.strictOwnershipCount = 0; this.rolloutTransitionCount = 0;
    this.hotAllocationCount = 0;
    this.evaluationSerial = 0;
    this.previousConflict = 0; this.previousSelectedGeneration = 0;
    this.previousAttackGeneration = 0;
    this.lastSelectedRow = -1; this.lastAttackRow = -1;
    this.lastAttackGeneration = 0;
    this.lastStrictLower = STRICT_VALUE_MIN; this.lastStrictUpper = STRICT_VALUE_MAX;
    this.lastRiskAttackLower = -10000; this.lastRiskAttackUpper = 10000;
    this.lastRiskIncumbentLower = -10000; this.lastRiskIncumbentUpper = 10000;
  }

  completeAttack(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          (portfolio.kind[at] === OPTION_KIND.DIRECT_KILL ||
           portfolio.kind[at] === OPTION_KIND.ATTACK_SETUP) &&
          this.ledger.classifier.purposeComplete(engine, LONG_OPTION.ATTACK,
            row, engine.ourActions[row])) return 1;
    return 0;
  }

  betterAttack(row, best) {
    return best < 0 || this.rollout.compare(row, best, true) ? row : best;
  }

  observe(engine, emittedAction) {
    if (!engine || !this.ledger || !engine.adapter || !engine.adapter.state) return;
    const selected = this.ledger.classifier.selectedRow(engine, emittedAction);
    const selectedKind = this.ledger.lastSelectedKind;
    if (selected < 0 || (selectedKind !== LONG_OPTION.STAR_CONTROL &&
        selectedKind !== LONG_OPTION.POSITION && selectedKind !== LONG_OPTION.TERMINAL)) {
      this.previousConflict = 0; this.previousSelectedGeneration = 0;
      this.previousAttackGeneration = 0;
      this.unsupportedSelectedCount += 1; return;
    }
    const risk = engine.riskController && engine.riskController.outcome;
    if (!risk) return;
    this.attackCandidate.fill(0, 0, engine.ourCount);
    let attackCount = 0;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (row !== selected && engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          row < risk.count && risk.acceptable[row] && !risk.dominated[row] &&
          this.completeAttack(engine, row)) {
        this.attackCandidate[row] = 1; attackCount += 1;
      }
    if (!attackCount) {
      this.previousConflict = 0;
      this.previousSelectedGeneration = this.ledger.lastSelectedGeneration;
      this.previousAttackGeneration = 0;
      this.noAttackConflictCount += 1; return;
    }
    const attackGeneration = this.ledger.availableGeneration(LONG_OPTION.ATTACK);
    const internalEvent = !this.previousConflict ||
      this.previousSelectedGeneration !== this.ledger.lastSelectedGeneration ||
      this.previousAttackGeneration !== attackGeneration;
    this.previousConflict = 1;
    this.previousSelectedGeneration = this.ledger.lastSelectedGeneration;
    this.previousAttackGeneration = attackGeneration;
    if (!this.ledger.lastEventMask && !internalEvent) {
      this.steadyConflictSkipCount += 1; return;
    }
    if (this.ledger.lastEventMask) this.externalEventTriggerCount += 1;
    else this.internalEventTriggerCount += 1;
    if (engine.lastProofStatus === PROOF_STATUS.PROVEN ||
        engine.escapeObligation && engine.escapeObligation.committedEntityCount > 0) {
      this.committedSkipCount += 1; return;
    }
    this.eventConflictCount += 1;
    const transitions = this.rollout.transitionCount;
    const restored = this.rollout.rootRestoreFailureCount;
    const count = this.rollout.evaluate(engine.adapter, engine.ourActions,
      engine.ourArguments, engine.ourCount);
    this.rolloutTransitionCount += this.rollout.transitionCount - transitions;
    this.rootRestoreFailureCount += this.rollout.rootRestoreFailureCount - restored;
    if (count !== engine.ourCount || !this.rollout.physicalComplete[selected] ||
        !this.rollout.rootRestored[selected]) {
      this.incompleteRolloutCount += 1; return;
    }
    let attack = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (this.attackCandidate[row] && this.rollout.physicalComplete[row] &&
          this.rollout.rootRestored[row]) attack = this.betterAttack(row, attack);
    if (attack < 0) { this.incompleteRolloutCount += 1; return; }
    this.evaluationCount += 1; this.evaluationSerial += 1;
    this.lastSelectedRow = selected; this.lastAttackRow = attack;
    this.lastAttackGeneration = attackGeneration;

    const balancedAttack = this.rollout.compare(attack, selected, false);
    const balancedIncumbent = this.rollout.compare(selected, attack, false);
    if (balancedAttack) this.nominalBalancedAttackWinCount += 1;
    else if (balancedIncumbent) this.nominalAttackLossCount += 1;
    else this.nominalAttackTieCount += 1;
    if (this.rollout.compare(attack, selected, true))
      this.nominalCombatAttackWinCount += 1;

    const attackLower = risk.robustLower[attack];
    const attackUpper = Math.max(attackLower, risk.expectedValue[attack]);
    const incumbentLower = risk.robustLower[selected];
    const incumbentUpper = Math.max(incumbentLower, risk.expectedValue[selected]);
    this.lastRiskAttackLower = attackLower; this.lastRiskAttackUpper = attackUpper;
    this.lastRiskIncumbentLower = incumbentLower;
    this.lastRiskIncumbentUpper = incumbentUpper;
    if (attackLower > incumbentUpper) this.riskBandAttackSeparationCount += 1;
    else if (incumbentLower > attackUpper)
      this.riskBandIncumbentSeparationCount += 1;
    else this.riskBandOverlapCount += 1;

    const attackFatal = this.rollout.hardFatal[attack] || this.rollout.ownCrashed[attack];
    const selectedFatal = this.rollout.hardFatal[selected] ||
      this.rollout.ownCrashed[selected];
    if (!attackFatal || selectedFatal) this.attackSurvivalPreservedCount += 1;
    else this.attackSurvivalRegressedCount += 1;
    if (this.rollout.enemyCrashed[attack] > this.rollout.enemyCrashed[selected])
      this.attackEnemyCrashGainCount += 1;
    if (this.rollout.starGain[attack] < this.rollout.starGain[selected])
      this.attackStarRegressionCount += 1;

    // A deterministic nominal continuation is not an adversarial certificate.
    // Even when it reaches a terminal, the strict interval remains full range.
    this.strictFullRangeCount += 1;
    if (this.rollout.terminalReached[attack] &&
        this.rollout.terminalReached[selected]) this.strictTerminalResolvedCount += 1;
    this.lastStrictLower = STRICT_VALUE_MIN; this.lastStrictUpper = STRICT_VALUE_MAX;
  }

  summary() {
    return { enabled: true, behaviorNeutral: true, nominalOnly: true,
      evaluationCount: this.evaluationCount, eventConflictCount: this.eventConflictCount,
      externalEventTriggerCount: this.externalEventTriggerCount,
      internalEventTriggerCount: this.internalEventTriggerCount,
      steadyConflictSkipCount: this.steadyConflictSkipCount,
      noAttackConflictCount: this.noAttackConflictCount,
      unsupportedSelectedCount: this.unsupportedSelectedCount,
      committedSkipCount: this.committedSkipCount,
      incompleteRolloutCount: this.incompleteRolloutCount,
      rootRestoreFailureCount: this.rootRestoreFailureCount,
      nominalBalancedAttackWinCount: this.nominalBalancedAttackWinCount,
      nominalCombatAttackWinCount: this.nominalCombatAttackWinCount,
      nominalAttackLossCount: this.nominalAttackLossCount,
      nominalAttackTieCount: this.nominalAttackTieCount,
      riskBandAttackSeparationCount: this.riskBandAttackSeparationCount,
      riskBandIncumbentSeparationCount: this.riskBandIncumbentSeparationCount,
      riskBandOverlapCount: this.riskBandOverlapCount,
      attackSurvivalPreservedCount: this.attackSurvivalPreservedCount,
      attackSurvivalRegressedCount: this.attackSurvivalRegressedCount,
      attackEnemyCrashGainCount: this.attackEnemyCrashGainCount,
      attackStarRegressionCount: this.attackStarRegressionCount,
      strictFullRangeCount: this.strictFullRangeCount,
      strictTerminalResolvedCount: this.strictTerminalResolvedCount,
      strictOwnershipCount: this.strictOwnershipCount,
      rolloutTransitionCount: this.rolloutTransitionCount,
      evaluationSerial: this.evaluationSerial,
      lastSelectedRow: this.lastSelectedRow, lastAttackRow: this.lastAttackRow,
      lastAttackGeneration: this.lastAttackGeneration,
      lastStrictLower: this.lastStrictLower, lastStrictUpper: this.lastStrictUpper,
      lastRiskAttackLower: this.lastRiskAttackLower,
      lastRiskAttackUpper: this.lastRiskAttackUpper,
      lastRiskIncumbentLower: this.lastRiskIncumbentLower,
      lastRiskIncumbentUpper: this.lastRiskIncumbentUpper,
      hotAllocationCount: this.hotAllocationCount + this.rollout.hotAllocationCount };
  }
}

module.exports = { STRICT_VALUE_MIN, STRICT_VALUE_MAX,
  StableOptionIntervalShadow };
