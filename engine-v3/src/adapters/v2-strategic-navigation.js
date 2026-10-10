"use strict";

const { HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");
const { WORK_KIND } = require("../../../engine-v2/src/abi/cache-runtime-codes");
const { ROOT_CONTROL_MODE } = require("../../../engine-v2/src/runtime/root-control-mode");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { PLAN_PURPOSE, NONE_HANDLE } =
  require("../../../engine-v2/src/abi/policy-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { V3_COMPONENT_ABI, V3_COMPONENT_MODE, V3_RESULT_STATUS,
  V3_PROPOSAL_CLASS, V3_EVIDENCE, V3_SLOT, actionFromLegacy, actionToLegacy } =
  require("../contracts");
const { ComponentResult } = require("../component-result");
const { RECOVERY_VERIFY_STATUS, RecoveryProposalVerifier } =
  require("../recovery-proposal-verifier");

class V2StrategicNavigationAdapter {
  constructor(bridge, mode = V3_COMPONENT_MODE.SHADOW, options = {}) {
    this.abi = V3_COMPONENT_ABI;
    this.slot = V3_SLOT.NAVIGATION;
    this.id = options.id || "V2_STRATEGIC_NAVIGATION";
    this.bridge = bridge;
    this.mode = mode;
    this.commitPlans = options.commitPlans ? 1 : 0;
    this.requireTacticalHandoff = options.requireTacticalHandoff ? 1 : 0;
    this.requireTacticalRecovery = options.requireTacticalRecovery ? 1 : 0;
    this.requireRecoveryPlanIdentity = options.requireRecoveryPlanIdentity ? 1 : 0;
    this.recoveryVerifier = options.recoveryVerificationDepth ?
      new RecoveryProposalVerifier(bridge.engine, {
        depth: options.recoveryVerificationDepth,
        nodeBudget: options.recoveryVerificationNodeBudget }) : null;
    this.allowRecoveryValueTie = options.allowRecoveryValueTie ? 1 : 0;
    this.result = new ComponentResult(bridge.proposals, V3_SLOT.NAVIGATION,
      mode === V3_COMPONENT_MODE.ACTIVE);
    this.callCount = 0;
    this.completeCount = 0;
    this.incompleteCount = 0;
    this.overrideCount = 0;
    this.contactFallbackCount = 0;
    this.searchViolationCount = 0;
    this.exceptionCount = 0;
    this.invalidPurposeCount = 0;
    this.invalidTargetCount = 0;
    this.noProgressCount = 0;
    this.riskWorseCount = 0;
    this.qualifiedCount = 0;
    this.lastFailure = 0;
    this.failureCounts = new Uint32Array(8);
    this.handoffBlockedCount = 0;
    this.handoffSelectionCount = 0;
    this.recoveryBlockedCount = 0;
    this.recoverySelectionCount = 0;
    this.recoveryRiskBlockedCount = 0;
    this.recoveryPlanMismatchCount = 0;
  }

  notRiskWorseThanLegacy(selected, legacyAction) {
    const engine = this.bridge.engine; const outcome = engine.riskController.outcome;
    let legacy = -1;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === legacyAction) { legacy = row; break; }
    if (legacy < 0 || selected < 0 || selected >= outcome.count || legacy >= outcome.count)
      return false;
    return outcome.committedFatalMass[selected] <= outcome.committedFatalMass[legacy] &&
      outcome.immediateFatalMass[selected] <= outcome.immediateFatalMass[legacy] &&
      outcome.horizonFatalMass[selected] <= outcome.horizonFatalMass[legacy] &&
      outcome.unknownMass[selected] <= outcome.unknownMass[legacy] &&
      outcome.escapeSlack[selected] >= outcome.escapeSlack[legacy];
  }

  captureLegacyNavigation(call) {
    const sandbox = call.runtime.sandbox;
    sandbox.V3_CAPTURED_ACTION = null;
    sandbox.V3_CAPTURE_ACTION = true;
    try { call.next(); }
    finally { sandbox.V3_CAPTURE_ACTION = false; }
    return sandbox.V3_CAPTURED_ACTION;
  }

  executeCaptured(call, action) {
    return call.runtime.sandbox.executeAction(call.me,
      action || "RIGHT", call.enemy, call.game);
  }

  attackPurpose(purpose) {
    return purpose === PLAN_PURPOSE.DIRECT_KILL || purpose === PLAN_PURPOSE.INTERCEPT ||
      purpose === PLAN_PURPOSE.ZONE_DENIAL || purpose === PLAN_PURPOSE.SHIELD_BREAK ||
      purpose === PLAN_PURPOSE.ESCAPE_FORCING || purpose === PLAN_PURPOSE.CADENCE_DENY;
  }

  preferAttack(selected) {
    const engine = this.bridge.engine; const sketches = engine.policy.sketches;
    const outcome = engine.riskController.outcome; let best = -1;
    for (let row = 0; row < engine.ourCount; row += 1) {
      const handle = engine.planSketchHandle[row];
      if (handle === NONE_HANDLE || handle >= sketches.used || !this.attackPurpose(sketches.purpose[handle]) ||
          sketches.rawScore[handle] <= 0 || sketches.targetSignature[handle] === 0 ||
          row >= outcome.count || !outcome.acceptable[row] || outcome.dominated[row] ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW) continue;
      if (best < 0) { best = row; continue; }
      const left = engine.planSketchHandle[row]; const right = engine.planSketchHandle[best];
      if (sketches.rawScore[left] > sketches.rawScore[right] ||
          (sketches.rawScore[left] === sketches.rawScore[right] &&
           (sketches.deadline[left] < sketches.deadline[right] ||
            (sketches.deadline[left] === sketches.deadline[right] && row < best)))) best = row;
    }
    return best >= 0 ? best : selected;
  }

  select() {
    const bridge = this.bridge; const engine = bridge.engine;
    this.lastFailure = 0;
    if (!bridge.prepared || !bridge.bundle) {
      this.lastFailure = 1;
      return -1;
    }
    if (this.requireTacticalHandoff && !bridge.hasActiveTacticalHandoff()) {
      this.handoffBlockedCount += 1;
      this.lastFailure = 4;
      return -1;
    }
    if (this.requireTacticalRecovery && !bridge.hasTacticalRecoveryWindow()) {
      this.recoveryBlockedCount += 1;
      this.lastFailure = 4;
      return -1;
    }
    if (engine.tacticalContact()) {
      if (bridge.prepared && bridge.bundle && engine.tacticalContact())
        this.contactFallbackCount += 1;
      this.lastFailure = 2;
      return -1;
    }
    const runtime = engine.runtime;
    runtime.beginCallback(bridge.frame, engine.adapter.mapHashLo,
      engine.adapter.mapHashHi, bridge.matchReset);
    runtime.charge(WORK_KIND.ROOT, 1);
    let selected = -1;
    try {
      if (!bridge.matchReset && this.commitPlans) engine.reconcilePlans();
      engine.generateActions();
      selected = engine.selectAction(bridge.bundle, engine.adapter.informationComplete);
      if (engine.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION ||
          engine.depthSearch.nodes > 0 || engine.informationSearch.nodes > 0) {
        this.searchViolationCount += 1; this.lastFailure = 3; selected = -1;
      }
      if (selected >= 0) selected = this.preferAttack(selected);
      if (selected >= 0 && this.commitPlans)
        engine.validatePlanContinuations(bridge.bundle, selected);
    } finally { runtime.finishCallback(); }
    if (selected < 0) {
      if (!this.lastFailure) this.lastFailure = 4;
      return -1;
    }
    if (selected >= engine.ourCount) {
      this.lastFailure = 5;
      return -1;
    }
    if (engine.hardStatus[selected] !== HARD_STATUS.ALLOW) {
      this.lastFailure = 6;
      return -1;
    }
    if (!engine.finalGate.finalAllows(bridge.bundle, engine.ourActions,
      engine.ourArguments, selected, engine.ourCount)) {
      this.lastFailure = 7;
      return -1;
    }
    return selected;
  }

  invoke(call) {
    this.callCount += 1;
    if (this.mode === V3_COMPONENT_MODE.PASS_THROUGH) return call.next();
    const recoveryLegacy = this.requireTacticalRecovery ?
      this.captureLegacyNavigation(call) : null;
    let selected = -1;
    try { selected = this.select(); }
    catch (_) { this.exceptionCount += 1; selected = -1; }
    if (selected < 0) {
      this.failureCounts[this.lastFailure] += 1;
      this.incompleteCount += 1;
      this.result.set(V3_RESULT_STATUS.INCOMPLETE, 0, -1, false,
        V3_EVIDENCE.INFORMATION | V3_EVIDENCE.FALLBACK, 0);
      return this.requireTacticalRecovery ?
        this.executeCaptured(call, recoveryLegacy) : call.next();
    }
    this.completeCount += 1;
    const engine = this.bridge.engine; const action = engine.ourActions[selected];
    const argument = engine.ourArguments[selected];
    if (action === ACTION.NONE) this.result.set(V3_RESULT_STATUS.NO_PROPOSAL,
      action, argument, true, V3_EVIDENCE.FALLBACK, engine.policy.sketches.used);
    else {
      const sketches = engine.policy.sketches; const handle = engine.planSketchHandle[selected];
      const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
      const validPurpose = handle !== NONE_HANDLE && handle < sketches.used &&
        sketches.purpose[handle] !== 0 && sketches.dependencyMask[handle] !== 0;
      const validTarget = validPurpose && sketches.targetSignature[handle] !== 0 &&
        sketches.deadline[handle] > frame;
      const progress = validTarget ? sketches.rawScore[handle] : 0;
      const candidateRisk = engine.possibleRisk(engine.projectedCell[selected],
        engine.projectedDirection[selected]);
      const riskLimit = 99 * Math.max(0, Math.min(100, engine.policy.baseRisk | 0));
      const recoveryRiskSafe = !this.requireTacticalRecovery ||
        this.notRiskWorseThanLegacy(selected, actionFromLegacy(recoveryLegacy));
      const recoveryPlanMatch = !this.requireTacticalRecovery ||
        !this.requireRecoveryPlanIdentity || this.bridge.matchesTacticalRecoveryPlan(selected);
      const recoveryVerifyStatus = !this.requireTacticalRecovery || !this.recoveryVerifier ?
        RECOVERY_VERIFY_STATUS.DOMINATES :
        this.recoveryVerifier.verify(this.bridge.bundle, engine, selected,
          actionFromLegacy(recoveryLegacy));
      const recoveryValueVerified = recoveryVerifyStatus === RECOVERY_VERIFY_STATUS.DOMINATES ||
        this.allowRecoveryValueTie &&
          recoveryVerifyStatus === RECOVERY_VERIFY_STATUS.NONINFERIOR;
      const qualified = validPurpose && validTarget && progress > 0 &&
        candidateRisk <= riskLimit && recoveryRiskSafe && recoveryPlanMatch &&
        recoveryValueVerified;
      if (!validPurpose) this.invalidPurposeCount += 1;
      if (!validTarget) this.invalidTargetCount += 1;
      if (progress <= 0) this.noProgressCount += 1;
      if (candidateRisk > riskLimit) this.riskWorseCount += 1;
      if (!recoveryRiskSafe) this.recoveryRiskBlockedCount += 1;
      if (!recoveryPlanMatch) this.recoveryPlanMismatchCount += 1;
      if (qualified) this.qualifiedCount += 1;
      this.result.set(V3_RESULT_STATUS.PROPOSED, action, argument, true,
        V3_EVIDENCE.OBSERVATION_COMPLETE, engine.policy.sketches.used,
        V3_PROPOSAL_CLASS.STRATEGIC_PROGRESS,
        this.mode === V3_COMPONENT_MODE.ACTIVE && qualified);
      if (this.mode === V3_COMPONENT_MODE.ACTIVE && qualified) {
        if (this.requireTacticalHandoff) this.handoffSelectionCount += 1;
        if (this.requireTacticalRecovery) this.recoverySelectionCount += 1;
        this.bridge.pendingTacticalIndex = selected;
        this.overrideCount += 1;
        return call.runtime.sandbox.executeAction(
          call.me, actionToLegacy(action), call.enemy, call.game);
      }
    }
    return this.requireTacticalRecovery ?
      this.executeCaptured(call, recoveryLegacy) : call.next();
  }

  summary() {
    const engine = this.bridge.engine;
    return { callCount: this.callCount, completeCount: this.completeCount,
      incompleteCount: this.incompleteCount, overrideCount: this.overrideCount,
      contactFallbackCount: this.contactFallbackCount,
      searchViolationCount: this.searchViolationCount, exceptionCount: this.exceptionCount,
      invalidPurposeCount: this.invalidPurposeCount, invalidTargetCount: this.invalidTargetCount,
      noProgressCount: this.noProgressCount, riskWorseCount: this.riskWorseCount,
      qualifiedCount: this.qualifiedCount,
      requireTacticalHandoff: this.requireTacticalHandoff,
      handoffBlockedCount: this.handoffBlockedCount,
      handoffSelectionCount: this.handoffSelectionCount,
      requireTacticalRecovery: this.requireTacticalRecovery,
      requireRecoveryPlanIdentity: this.requireRecoveryPlanIdentity,
      allowRecoveryValueTie: this.allowRecoveryValueTie,
      recoveryBlockedCount: this.recoveryBlockedCount,
      recoverySelectionCount: this.recoverySelectionCount,
      recoveryRiskBlockedCount: this.recoveryRiskBlockedCount,
      recoveryPlanMismatchCount: this.recoveryPlanMismatchCount,
      recoveryVerifier: this.recoveryVerifier ? this.recoveryVerifier.summary() : null,
      failureNone: this.failureCounts[0], failureNotPrepared: this.failureCounts[1],
      failureTacticalContact: this.failureCounts[2],
      failureControlModeOrSearch: this.failureCounts[3],
      failureNoSelection: this.failureCounts[4],
      failureSelectionRange: this.failureCounts[5],
      failureHardRejected: this.failureCounts[6],
      failureFinalRejected: this.failureCounts[7],
      planSketches: engine.policy.sketches.used,
      planCommits: engine.planCommitCount, planActivations: engine.planActivateCount,
      planCompletions: engine.planCompleteCount, planInvalidations: engine.planInvalidateCount,
      strategicSelections: engine.policy.strategicArbiter.strategicCount,
      pva: engine.policy.proposalArbiter.summary() };
  }
}

module.exports = { V2StrategicNavigationAdapter };
