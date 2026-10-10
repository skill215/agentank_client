"use strict";

const { HARD_STATUS, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE,
  V3_SLOT, V3_SLOT_COUNT, actionFromLegacy, actionToLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");
const { NONE_HANDLE } = require("../../../engine-v2/src/abi/policy-codes");
const { OPTION_CERTIFICATE_STATUS, OptionPolicyCertificate } =
  require("../option-policy-certificate");

class V2HardFinalAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, options = {}) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.FINAL_ACTION_GATE;
    this.id = "V2_HARD_FINAL_GATE";
    this.bridge = bridge;
    this.mode = mode;
    this.rescueOwner = options.rescueOwner || null;
    this.commitSelectedTacticalPlans = options.commitSelectedTacticalPlans ? 1 : 0;
    this.executeOptionPolicyCertificate = options.executeOptionPolicyCertificate ? 1 : 0;
    this.optionPolicyActive = this.executeOptionPolicyCertificate ?
      new OptionPolicyCertificate() : null;
    this.result = new ComponentResult(bridge.proposals, V3_SLOT.FINAL_ACTION_GATE, true);
    this.order = bridge.engine.orderedIndexes;
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.preferredRejectedCount = 0;
    this.overrideCount = 0;
    this.noSafeActionCount = 0;
    this.proposalSelectionCount = 0;
    this.proposalOverrideCount = 0;
    this.tacticalPlanCommitArmedCount = 0;
    this.tacticalPlanMissingCount = 0;
    this.optionPolicyArmCount = 0; this.optionPolicySelectionCount = 0;
    this.optionPolicyMismatchCount = 0; this.optionPolicyBlockedCount = 0;
    this.optionPolicyInterruptedCount = 0; this.optionPolicyCompletionCount = 0;
    this.selectedByClass = new Array(7).fill(0);
  }

  indexOf(action, argument = null) {
    for (let index = 0; index < this.bridge.actionCount; index += 1)
      if (this.bridge.actions[index] === action &&
          (argument === null || this.bridge.arguments[index] === argument)) return index;
    return -1;
  }

  optionContinuation(finalGate) {
    const active = this.optionPolicyActive; const bridge = this.bridge;
    if (!active || active.status !== OPTION_CERTIFICATE_STATUS.COMPLETE) return -1;
    if (bridge.matchReset || bridge.frame !== active.buildFrame + 1) {
      this.optionPolicyMismatchCount += 1; active.reset(); return -1;
    }
    const branch = active.lookup(bridge.bundle.state);
    if (branch < 0 || active.terminal[branch]) {
      this.optionPolicyMismatchCount += 1; active.reset(); return -1;
    }
    const row = this.indexOf(active.action[branch], active.argument[branch]);
    if (row < 0 || finalGate.status[row] !== HARD_STATUS.ALLOW) {
      this.optionPolicyBlockedCount += 1; active.reset(); return -1;
    }
    return row;
  }

  invoke(call) {
    this.callCount += 1;
    const legacyPreferred = call.next();
    const preferredAction = actionFromLegacy(legacyPreferred);
    const bridge = this.bridge;
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH || !bridge.prepared || !bridge.bundle) {
      bridge.recordResolvedLegacy(legacyPreferred);
      return legacyPreferred;
    }
    const count = bridge.actionCount;
    const finalGate = bridge.engine.finalGate;
    const evaluated = finalGate.evaluate(bridge.bundle, bridge.actions, bridge.arguments, count);
    const preferred = this.indexOf(preferredAction);
    if (evaluated !== count || !bridge.supportComplete || preferred < 0) {
      this.incompleteCount += 1;
      this.result.set(V3_RESULT_STATUS.INCOMPLETE, preferredAction, NONE_CELL, false,
        V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK, evaluated);
      bridge.recordResolvedLegacy(legacyPreferred);
      return legacyPreferred;
    }
    this.completeCount += 1;
    for (let index = 0; index < count; index += 1) this.order[index] = index;
    const rejected = finalGate.status[preferred] === HARD_STATUS.REJECT_PROVEN ||
      finalGate.status[preferred] === HARD_STATUS.REJECT_POLICY;
    let selected = preferred;
    if (rejected) {
      this.preferredRejectedCount += 1;
      selected = finalGate.select(bridge.bundle, bridge.actions, bridge.arguments,
        count, preferred, this.order, count);
    }
    if (selected < 0) {
      this.noSafeActionCount += 1;
      this.result.set(V3_RESULT_STATUS.INCOMPLETE, preferredAction, NONE_CELL, false,
        V3_EVIDENCE.PHYSICAL_HARD | V3_EVIDENCE.FALLBACK, evaluated);
      bridge.recordResolvedLegacy(legacyPreferred);
      return legacyPreferred;
    }
    let proposalSlot = -1; let proposalClass = V3_PROPOSAL_CLASS.NONE;
    if (this.mode === V3_COMPONENT_MODE.ACTIVE) {
      if (this.rescueOwner) this.rescueOwner.proposeFinal(preferredAction);
      const bus = bridge.proposals;
      for (let klass = V3_PROPOSAL_CLASS.COMMITTED_RESCUE;
          klass <= V3_PROPOSAL_CLASS.INTENTIONAL_WAIT && proposalSlot < 0; klass += 1)
        for (let slot = 0; slot < V3_SLOT_COUNT; slot += 1)
          if (slot !== V3_SLOT.FINAL_ACTION_GATE && bus.current(slot) && bus.eligible[slot] &&
              bus.status[slot] === V3_RESULT_STATUS.PROPOSED && bus.supportComplete[slot] &&
              bus.proposalClass[slot] === klass) {
            const row = this.indexOf(bus.action[slot]);
            if (row >= 0 && finalGate.status[row] === HARD_STATUS.ALLOW) {
              selected = row; proposalSlot = slot; proposalClass = klass; break;
            }
          }
      const optionRow = this.optionContinuation(finalGate);
      if (optionRow >= 0) {
        if (proposalClass === V3_PROPOSAL_CLASS.COMMITTED_RESCUE ||
            proposalClass === V3_PROPOSAL_CLASS.STRICT_FORCED_WIN) {
          this.optionPolicyInterruptedCount += 1; this.optionPolicyActive.reset();
        } else {
          selected = optionRow; proposalSlot = -2;
          proposalClass = V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE;
          this.optionPolicySelectionCount += 1;
        }
      }
    }
    const selectedAction = bridge.actions[selected];
    const selectedArgument = bridge.arguments[selected];
    const intentionalWait = selectedAction === 0 &&
      (proposalClass === V3_PROPOSAL_CLASS.INTENTIONAL_WAIT || !bridge.engine.adapter.ownCanAct);
    const finalStatus = this.mode === V3_COMPONENT_MODE.ACTIVE &&
      (selectedAction !== 0 || intentionalWait) ? V3_RESULT_STATUS.SELECTED :
      (this.mode === V3_COMPONENT_MODE.ACTIVE ? V3_RESULT_STATUS.NO_PROPOSAL :
        V3_RESULT_STATUS.PASS);
    this.result.set(finalStatus, selectedAction, selectedArgument, true,
      V3_EVIDENCE.PHYSICAL_HARD | (intentionalWait ? V3_EVIDENCE.INTENTIONAL_WAIT : 0),
      evaluated, intentionalWait ? V3_PROPOSAL_CLASS.INTENTIONAL_WAIT : proposalClass, true);
    if (this.mode === V3_COMPONENT_MODE.ACTIVE) {
      if (selectedAction !== preferredAction) this.overrideCount += 1;
      if (proposalSlot >= 0) {
        this.proposalSelectionCount += 1; this.selectedByClass[proposalClass] += 1;
        if (selectedAction !== preferredAction) this.proposalOverrideCount += 1;
        if (this.commitSelectedTacticalPlans && proposalSlot === V3_SLOT.TACTICAL_SEARCH &&
            proposalClass === V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE) {
          const handle = bridge.engine.planSketchHandle[selected];
          if (handle !== NONE_HANDLE) {
            bridge.pendingTacticalIndex = selected;
            bridge.pendingTacticalPlan = true;
            this.tacticalPlanCommitArmedCount += 1;
          } else this.tacticalPlanMissingCount += 1;
        }
      }
      if (proposalSlot === -2) {
        this.optionPolicyCompletionCount += 1; this.optionPolicyActive.reset();
      } else if (proposalSlot === V3_SLOT.TACTICAL_SEARCH &&
          proposalClass === V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE &&
          this.executeOptionPolicyCertificate) {
        const candidate = bridge.optionPolicyCandidate;
        if (candidate && candidate.status === OPTION_CERTIFICATE_STATUS.COMPLETE &&
            candidate.buildFrame === bridge.frame &&
            candidate.rootAction === selectedAction &&
            candidate.rootArgument === selectedArgument &&
            this.optionPolicyActive.copyPolicy(candidate)) this.optionPolicyArmCount += 1;
      }
      bridge.pendingResolvedAction = selectedAction;
      bridge.pendingResolvedArgument = selectedArgument;
      bridge.pendingResolvedValid = true;
      return actionToLegacy(selectedAction);
    }
    bridge.recordResolvedLegacy(legacyPreferred, bridge.arguments[preferred]);
    return legacyPreferred;
  }

  summary() {
    return { callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, preferredRejectedCount: this.preferredRejectedCount,
      overrideCount: this.overrideCount, noSafeActionCount: this.noSafeActionCount,
      proposalSelectionCount: this.proposalSelectionCount,
      proposalOverrideCount: this.proposalOverrideCount,
      tacticalPlanCommitArmedCount: this.tacticalPlanCommitArmedCount,
      tacticalPlanMissingCount: this.tacticalPlanMissingCount,
      optionPolicyArmCount: this.optionPolicyArmCount,
      optionPolicySelectionCount: this.optionPolicySelectionCount,
      optionPolicyMismatchCount: this.optionPolicyMismatchCount,
      optionPolicyBlockedCount: this.optionPolicyBlockedCount,
      optionPolicyInterruptedCount: this.optionPolicyInterruptedCount,
      optionPolicyCompletionCount: this.optionPolicyCompletionCount,
      committedRescueSelections: this.selectedByClass[V3_PROPOSAL_CLASS.COMMITTED_RESCUE],
      forcedWinSelections: this.selectedByClass[V3_PROPOSAL_CLASS.STRICT_FORCED_WIN],
      exactValueSelections: this.selectedByClass[V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE],
      verifiedAttackSelections: this.selectedByClass[V3_PROPOSAL_CLASS.VERIFIED_ATTACK],
      strategicSelections: this.selectedByClass[V3_PROPOSAL_CLASS.STRATEGIC_PROGRESS],
      finalRescue: this.rescueOwner ? this.rescueOwner.summary() : null };
  }
}

// R1 gives the final Hard gate the sole right to turn a proposal into a selection.
// Keep the historical export name because VC2 evidence and existing experiments bind it.
const V3FinalProposalArbiter = V2HardFinalAdapter;

module.exports = { V2HardFinalAdapter, V3FinalProposalArbiter };
