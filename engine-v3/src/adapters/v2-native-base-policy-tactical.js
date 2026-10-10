"use strict";

// Causal host for the latest native BasePolicy stack.  V1 keeps every root
// stage except chooseTacticalAction; the shared V2 bridge still owns one
// observation/tracker state and records the action that was actually emitted.
// This is intentionally separate from V2TacticalCoreAdapter: TC_FULL tests the
// old broad V2 controller, while this adapter tests only BP68 tactical choice.

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { WORK_KIND } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { NativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy-specialized/native-root");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_EVIDENCE, V3_SLOT, actionFromLegacy, actionToLegacy } = require("../contracts");
const { ComponentResult } = require("../component-result");

class V2NativeBasePolicyTacticalAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, options = {}) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.TACTICAL_SEARCH;
    this.id = "V2_NATIVE_BASE_POLICY_TACTICAL";
    this.bridge = bridge;
    this.mode = mode;
    this.root = options.root || new NativeBasePolicyRoot({
      targetDepth: options.targetDepth,
      nodeBudget: options.nodeBudget,
      rootBudgetMode: options.rootBudgetMode
    });
    this.preserveV1Initiative = options.preserveV1Initiative ? 1 : 0;
    this.preserveV1TurnAgainstGo = options.preserveV1TurnAgainstGo ? 1 : 0;
    this.activeFrameMask = Array.isArray(options.activeFrames) ? new Uint8Array(128) : null;
    if (this.activeFrameMask) for (const frame of options.activeFrames)
      if (Number.isSafeInteger(frame) && frame >= 0 && frame < this.activeFrameMask.length)
        this.activeFrameMask[frame] = 1;
    this.result = new ComponentResult();
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.proposalCount = 0;
    this.overrideCount = 0;
    this.sameActionCount = 0;
    this.resourceSkipCount = 0;
    this.invalidProposalCount = 0;
    this.exceptionCount = 0;
    this.searchNodeCount = 0;
    this.searchCompleteCount = 0;
    this.searchIncompleteCount = 0;
    this.actualActionCorrectionCount = 0;
    this.ownershipBlockedCount = 0;
    this.turnToGoBlockedCount = 0;
    this.legacyActionCount = new Uint32Array(16);
    this.proposalActionCount = new Uint32Array(16);
    this.proposalTransitionCount = new Uint32Array(16 * 16);
    this.selectionPrepared = false;
    this.pendingProposedAction = ACTION.NONE;
    this.pendingLegacyAction = ACTION.NONE;
    this.pendingFrame = -1;
    this.firstEffectiveOverrideFrame = -1;
    this.firstEffectiveLegacyAction = ACTION.NONE;
    this.firstEffectiveProposalAction = ACTION.NONE;
    this.firstEffectiveActualAction = ACTION.NONE;
    this.firstEffectiveProposalValue = 0;
    this.firstEffectiveLegacyValue = 0;
    this.firstEffectiveProposalExactBlock = 0;
    this.firstEffectiveLegacyExactBlock = 0;
    bridge.nativeBasePolicyTacticalObserver = this;
  }

  findRow(engine, action, argument) {
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === action && engine.ourArguments[row] === argument &&
          engine.hardStatus[row] === HARD_STATUS.ALLOW &&
          engine.finalGate.finalAllows(this.bridge.bundle, engine.ourActions,
            engine.ourArguments, row, engine.ourCount)) return row;
    return -1;
  }

  select(legacyAction) {
    const bridge = this.bridge; const engine = bridge.engine;
    if (!bridge.prepared || !bridge.bundle) return -1;
    const runtime = engine.runtime;
    runtime.beginCallback(bridge.frame, engine.adapter.mapHashLo,
      engine.adapter.mapHashHi, bridge.matchReset);
    runtime.charge(WORK_KIND.ROOT, 1);
    let incumbent = -1;
    try {
      if (!bridge.matchReset) engine.reconcilePlans();
      engine.generateActions();
      incumbent = engine.selectAction(bridge.bundle,
        engine.adapter.informationComplete);
      if (incumbent >= 0) engine.validatePlanContinuations(bridge.bundle, incumbent);
    } finally { runtime.finishCallback(); }

    // Match BP172/BP173 resource ownership.  A tactical BasePolicy must not
    // steal a skill action selected by V1's resource controller.
    if (legacyAction >= ACTION.CAST_SHIELD && legacyAction <= ACTION.CAST_BOOST &&
        legacyAction !== ACTION.CAST_POISON) {
      this.resourceSkipCount += 1;
      return -1;
    }

    this.selectionPrepared = true;
    const beforeNodes = this.root.policySearch.nodes;
    const proposal = this.root.selectOverride(engine, incumbent, legacyAction);
    const nodes = this.root.policySearch.nodes;
    this.searchNodeCount += nodes >= 0 ? nodes : Math.max(0, nodes - beforeNodes);
    if (this.root.policySearch.lastOwnershipSupportComplete)
      this.searchCompleteCount += 1;
    else this.searchIncompleteCount += 1;
    if (!proposal) return -1;
    const row = this.findRow(engine, proposal.action, proposal.argument);
    if (row < 0) this.invalidProposalCount += 1;
    return row;
  }

  observeEmission(action) {
    if (!this.selectionPrepared) return;
    // selectOverride records its proposal as intent continuity.  The V1 final
    // gate can still change that action, so overwrite continuity with reality.
    if (action !== this.pendingProposedAction)
      this.actualActionCorrectionCount += 1;
    if (this.firstEffectiveOverrideFrame < 0 &&
        action !== this.pendingLegacyAction &&
        this.pendingProposedAction !== this.pendingLegacyAction) {
      this.firstEffectiveOverrideFrame = this.pendingFrame;
      this.firstEffectiveLegacyAction = this.pendingLegacyAction;
      this.firstEffectiveProposalAction = this.pendingProposedAction;
      this.firstEffectiveActualAction = action;
    }
    this.root.intent.commitSelection(action);
    this.selectionPrepared = false;
    this.pendingProposedAction = ACTION.NONE;
    this.pendingLegacyAction = ACTION.NONE;
    this.pendingFrame = -1;
  }

  isInitiative(action) {
    return action === ACTION.FIRE || action === ACTION.THROW_BOMB ||
      action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST;
  }

  invoke(call) {
    this.callCount += 1;
    const legacy = call.next();
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return legacy;
    const legacyAction = actionFromLegacy(legacy);
    this.pendingProposedAction = legacyAction;
    this.pendingLegacyAction = legacyAction;
    this.pendingFrame = this.bridge.frame;
    if (legacyAction >= 0 && legacyAction < this.legacyActionCount.length)
      this.legacyActionCount[legacyAction] += 1;
    let row = -1;
    try { row = this.select(legacyAction); }
    catch (_) { this.exceptionCount += 1; row = -1; }
    if (row < 0) {
      this.incompleteCount += 1;
      this.result.set(V3_RESULT_STATUS.NO_PROPOSAL, legacyAction, -1,
        !!this.bridge.supportComplete,
        this.bridge.supportComplete ? V3_EVIDENCE.OBSERVATION_COMPLETE :
          V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK,
        this.root.policySearch.nodes);
      return legacy;
    }
    this.completeCount += 1;
    const engine = this.bridge.engine;
    const action = engine.ourActions[row];
    const argument = engine.ourArguments[row];
    this.pendingProposedAction = action;
    this.proposalCount += 1;
    if (action >= 0 && action < this.proposalActionCount.length) {
      this.proposalActionCount[action] += 1;
      if (legacyAction >= 0 && legacyAction < 16)
        this.proposalTransitionCount[legacyAction * 16 + action] += 1;
    }
    if (action === legacyAction) this.sameActionCount += 1;
    if (this.preserveV1Initiative && this.isInitiative(legacyAction)) {
      this.ownershipBlockedCount += 1;
      this.result.set(V3_RESULT_STATUS.PROPOSED, action, argument, true,
        V3_EVIDENCE.OBSERVATION_COMPLETE, this.root.policySearch.nodes);
      return legacy;
    }
    if (this.preserveV1TurnAgainstGo && action === ACTION.GO &&
        (legacyAction === ACTION.TURN_LEFT || legacyAction === ACTION.TURN_RIGHT)) {
      this.ownershipBlockedCount += 1;
      this.turnToGoBlockedCount += 1;
      this.result.set(V3_RESULT_STATUS.PROPOSED, action, argument, true,
        V3_EVIDENCE.OBSERVATION_COMPLETE, this.root.policySearch.nodes);
      return legacy;
    }
    const active = this.mode === V3_COMPONENT_MODE.ACTIVE &&
      (!this.activeFrameMask || this.activeFrameMask[this.bridge.frame]);
    if (active && this.firstEffectiveOverrideFrame < 0) {
      const source = this.root.policySearch;
      let legacyRow = -1;
      for (let candidate = 0; candidate < engine.ourCount; candidate += 1)
        if (engine.ourActions[candidate] === legacyAction) { legacyRow = candidate; break; }
      this.firstEffectiveProposalValue = source.rootScore[row] || 0;
      this.firstEffectiveLegacyValue = legacyRow >= 0 ? source.rootScore[legacyRow] || 0 : 0;
      this.firstEffectiveProposalExactBlock = source.rowExactBlockMask[row] || 0;
      this.firstEffectiveLegacyExactBlock = legacyRow >= 0 ?
        source.rowExactBlockMask[legacyRow] || 0 : 0;
    }
    if (active && action !== legacyAction) this.overrideCount += 1;
    this.result.set(active ? V3_RESULT_STATUS.SELECTED : V3_RESULT_STATUS.PROPOSED,
      action, argument, true, V3_EVIDENCE.OBSERVATION_COMPLETE,
      this.root.policySearch.nodes);
    return active ? actionToLegacy(action) : legacy;
  }

  summary() {
    return { kind: "NATIVE_BASE_POLICY_TACTICAL_ONLY",
      callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, proposalCount: this.proposalCount,
      overrideCount: this.overrideCount, sameActionCount: this.sameActionCount,
      resourceSkipCount: this.resourceSkipCount,
      invalidProposalCount: this.invalidProposalCount,
      exceptionCount: this.exceptionCount,
      searchNodeCount: this.searchNodeCount,
      searchCompleteCount: this.searchCompleteCount,
      searchIncompleteCount: this.searchIncompleteCount,
      actualActionCorrectionCount: this.actualActionCorrectionCount,
      ownershipBlockedCount: this.ownershipBlockedCount,
      turnToGoBlockedCount: this.turnToGoBlockedCount,
      preserveV1Initiative: this.preserveV1Initiative,
      preserveV1TurnAgainstGo: this.preserveV1TurnAgainstGo,
      legacyActionCount: Array.from(this.legacyActionCount),
      proposalActionCount: Array.from(this.proposalActionCount),
      proposalTransitionCount: Array.from(this.proposalTransitionCount),
      activeFrameLimited: this.activeFrameMask ? 1 : 0,
      firstEffectiveOverrideFrame: this.firstEffectiveOverrideFrame,
      firstEffectiveLegacyAction: this.firstEffectiveLegacyAction,
      firstEffectiveProposalAction: this.firstEffectiveProposalAction,
      firstEffectiveActualAction: this.firstEffectiveActualAction,
      firstEffectiveProposalValue: this.firstEffectiveProposalValue,
      firstEffectiveLegacyValue: this.firstEffectiveLegacyValue,
      firstEffectiveProposalExactBlock: this.firstEffectiveProposalExactBlock,
      firstEffectiveLegacyExactBlock: this.firstEffectiveLegacyExactBlock,
      ownershipMode: "native-bp68-direct-tactical-port",
      minimumOwnershipDepth: 0,
      refineDepthTwo: 0,
      refineMoveVariants: 0,
      refinementNodeBudget: 0,
      refinementMaximumRows: 0,
      depthRootRestoreFailures: this.bridge.engine.depthSearch.rootRestoreFailures,
      informationRootRestoreFailures:
        this.bridge.engine.informationSearch.rootRestoreFailures,
      proofRootRestoreFailures: this.bridge.engine.forcedWinSearch.rootRestoreFailures };
  }
}

module.exports = { V2NativeBasePolicyTacticalAdapter };
